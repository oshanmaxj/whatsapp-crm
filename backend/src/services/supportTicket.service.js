const { Op, literal } = require('sequelize');
const { sequelize, SupportTicket, SupportTicketCategory, SupportTicketMessage, Student, StudentEnrollment, Course, Conversation, Contact, Role, User, Notification } = require('../models');
const socket = require('./socket.service');
const audit = require('./audit.service');

const STATUSES = ['new','assigned','in_progress','waiting_for_student','resolved','closed','reopened','cancelled'];
const PRIORITIES = ['low','normal','high','urgent'];
const transitions = {
  new:['assigned','in_progress','cancelled'], assigned:['in_progress','cancelled'], in_progress:['waiting_for_student','resolved','cancelled'],
  waiting_for_student:['in_progress','resolved','cancelled'], resolved:['closed','reopened'], closed:['reopened'], reopened:['assigned','in_progress','waiting_for_student','resolved','cancelled'], cancelled:['reopened']
};
const fail = (code, message, status=400) => Object.assign(new Error(message), { code, status });
const clean = (value, max=10000) => String(value || '').trim().replace(/\s+/g, ' ').slice(0,max);
const cursorEncode = (row) => Buffer.from(JSON.stringify({ t:row.updatedAt, id:String(row.id) })).toString('base64url');
function cursorDecode(value) { try { const x=JSON.parse(Buffer.from(String(value),'base64url').toString()); const t=new Date(x.t); if(!/^\d+$/.test(String(x.id))||Number.isNaN(t.getTime()))throw 0; return {t,id:String(x.id)}; } catch { throw fail('TICKET_CURSOR_INVALID','Invalid ticket cursor.',400); } }

class SupportTicketService {
  include(messages=false) { return [
    {model:Student,as:'student',attributes:['id','studentNo','name','phone','contactId'],include:[{model:Contact,as:'contact',attributes:['phone','whatsappId','email'],required:false}]},
    {model:StudentEnrollment,as:'enrollment',required:false,include:[{model:Course,as:'course',required:false}]},
    {model:Course,as:'course',required:false},{model:SupportTicketCategory,as:'category'},
    {model:Role,as:'department',attributes:['id','name'],required:false},{model:User,as:'assignedUser',attributes:['id','firstName','lastName','email'],required:false},
    ...(messages?[{model:SupportTicketMessage,as:'messages',required:false}]:[])
  ]; }
  permissions(actor) { return new Set(actor?.permissions || []); }
  async staffScope(actor) {
    if(actor?.isSystemAdmin||this.permissions(actor).has('support_tickets.view_all'))return {};
    const canOwn=this.permissions(actor).has('support_tickets.view_own'), canDepartment=this.permissions(actor).has('support_tickets.view_department');
    const ors=[]; if(canOwn)ors.push({assignedUserId:actor.id});
    if(canDepartment){const user=await User.findByPk(actor.id,{include:[{model:Role,as:'roles',attributes:['id']} ]}); const ids=(user?.roles||[]).map(r=>r.id); if(ids.length)ors.push({departmentId:{[Op.in]:ids}});}
    if(!ors.length)throw fail('TICKET_ACCESS_DENIED','Ticket access denied.',403);
    return {[Op.or]:ors};
  }
  async list(query={}, context) {
    const limit=Math.min(100,Math.max(1,Number(query.limit)||50));
    const where=context.student?{studentId:context.student.id}:{[Op.and]:[await this.staffScope(context.actor)]};
    if(query.status)where.status=query.status;if(query.priority)where.priority=query.priority;if(query.categoryId)where.categoryId=query.categoryId;
    if(query.departmentId)where.departmentId=query.departmentId;if(query.assignedUserId)where.assignedUserId=query.assignedUserId;if(query.courseId)where.courseId=query.courseId;
    if(query.overdue==='true')where[Op.and]=[literal(`("SupportTicket"."sla_response_due_at" < NOW() AND "SupportTicket"."first_response_at" IS NULL) OR ("SupportTicket"."sla_resolution_due_at" < NOW() AND "SupportTicket"."resolved_at" IS NULL)`)];
    const q=clean(query.q||query.search,200); const include=this.include(false);
    if(q)where[Op.or]=[{ticketNumber:{[Op.iLike]:`%${q}%`}},{subject:{[Op.iLike]:`%${q}%`}},{'$student.name$':{[Op.iLike]:`%${q}%`}},{'$student.student_no$':{[Op.iLike]:`%${q}%`}},{'$student.phone$':{[Op.iLike]:`%${q}%`}}];
    if(query.cursor){const c=cursorDecode(query.cursor);where[Op.and]=[...(where[Op.and]||[]),{[Op.or]:[{updatedAt:{[Op.lt]:c.t}},{updatedAt:c.t,id:{[Op.lt]:c.id}}]}];}
    const rows=await SupportTicket.findAll({where,include,order:[['updated_at','DESC'],['id','DESC']],limit:limit+1,subQuery:false,distinct:true});
    const hasMore=rows.length>limit;const items=rows.slice(0,limit);return {items,nextCursor:hasMore?cursorEncode(items[items.length-1]):null,hasMore};
  }
  async get(id, context) {
    const scope=context.student?{studentId:context.student.id}:await this.staffScope(context.actor);
    const row=await SupportTicket.findOne({where:{id,...scope},include:this.include(true),order:[[{model:SupportTicketMessage,as:'messages'},'created_at','ASC']]});
    if(!row)throw fail('TICKET_NOT_FOUND','Support ticket not found.',404);
    const data=row.toJSON();if(context.student)data.messages=(data.messages||[]).filter(m=>!m.isInternal);return data;
  }
  async history(ticketId, transaction) { return sequelize.query(`SELECT * FROM support_ticket_status_history WHERE ticket_id=:ticketId ORDER BY created_at`,{replacements:{ticketId},type:sequelize.QueryTypes.SELECT,transaction}); }
  async record(ticket, action, actor, data={}, transaction) {
    await sequelize.query(`INSERT INTO support_ticket_audit_events(ticket_id,action,actor_type,actor_user_id,student_id,data) VALUES(:ticketId,:action,:actorType,:userId,:studentId,:data::jsonb)`,{replacements:{ticketId:ticket.id,action,actorType:actor.student?'student':'staff',userId:actor.actor?.id||null,studentId:actor.student?.id||null,data:JSON.stringify(data)},transaction});
    await audit.record({userId:actor.actor?.id,action:`SUPPORT_TICKET_${action.toUpperCase()}`,entityType:'support_ticket',entityId:ticket.id,changes:data,transaction});
  }
  async emit(ticket,event='support_ticket.updated') { const payload={ticketId:ticket.id,ticketNumber:ticket.ticketNumber,status:ticket.status,departmentId:ticket.departmentId,assignedUserId:ticket.assignedUserId,updatedAt:ticket.updatedAt}; socket.emitToRoom('inbox_all',event,payload);if(ticket.departmentId)socket.emitToRoom(socket.roleRoom(ticket.departmentId),event,payload);if(ticket.assignedUserId)socket.emitToUser(ticket.assignedUserId,event,payload); }
  async create(payload, student) {
    const subject=clean(payload.subject,240),description=clean(payload.description);if(!subject||!description||!payload.categoryId)throw fail('TICKET_VALIDATION_FAILED','Category, subject and description are required.',422);
    const enrollment=payload.enrollmentId?await StudentEnrollment.findOne({where:{id:payload.enrollmentId,studentId:student.id}}):null;if(payload.enrollmentId&&!enrollment)throw fail('TICKET_ACCESS_DENIED','Enrollment does not belong to this student.',403);
    const category=await SupportTicketCategory.findOne({where:{id:payload.categoryId,isActive:true}});if(!category)throw fail('TICKET_CATEGORY_INVALID','Support category is unavailable.',422);
    const priority=PRIORITIES.includes(payload.priority)&&payload.allowStudentPriority?payload.priority:category.defaultPriority||'normal'; const now=new Date();
    const ticket=await sequelize.transaction(async transaction=>{const [[seq]]=await sequelize.query(`SELECT nextval('support_ticket_number_seq') AS value`,{transaction});const ticketNumber=`SUP-${now.getUTCFullYear()}-${String(seq.value).padStart(6,'0')}`;const assigned=Boolean(category.defaultDepartmentId);
      const row=await SupportTicket.create({ticketNumber,studentId:student.id,enrollmentId:enrollment?.id||null,courseId:enrollment?.courseId||null,conversationId:payload.conversationId||null,categoryId:category.id,subject,description,priority,status:assigned?'assigned':'new',departmentId:category.defaultDepartmentId||null,createdByType:'student',lastStudentReplyAt:now,slaResponseDueAt:category.slaResponseMinutes?new Date(now.getTime()+category.slaResponseMinutes*60000):null,slaResolutionDueAt:category.slaResolutionMinutes?new Date(now.getTime()+category.slaResolutionMinutes*60000):null},{transaction});
      await SupportTicketMessage.create({ticketId:row.id,authorType:'student',studentId:student.id,body:description},{transaction});if(assigned)await sequelize.query(`INSERT INTO support_ticket_assignment_history(ticket_id,new_department_id,reason,source) VALUES(:id,:department,'category default','automatic_category')`,{replacements:{id:row.id,department:category.defaultDepartmentId},transaction});await this.statusHistory(row,null,row.status,{student},'created',transaction);await this.record(row,'created',{student},{categoryId:category.id},transaction);return row;});
    await this.notify(ticket,'New support ticket created');await this.emit(ticket,'support_ticket.created');return this.get(ticket.id,{student});
  }
  async statusHistory(ticket,from,to,context,reason,transaction){await sequelize.query(`INSERT INTO support_ticket_status_history(ticket_id,previous_status,new_status,changed_by_type,changed_by_user_id,student_id,reason) VALUES(:id,:from,:to,:type,:uid,:sid,:reason)`,{replacements:{id:ticket.id,from,to,type:context.student?'student':'staff',uid:context.actor?.id||null,sid:context.student?.id||null,reason:reason||null},transaction});}
  async reply(id,payload,context){const ticket=await SupportTicket.findByPk(id);if(!ticket)throw fail('TICKET_NOT_FOUND','Support ticket not found.',404);if(context.student&&String(ticket.studentId)!==String(context.student.id))throw fail('TICKET_ACCESS_DENIED','Ticket access denied.',403);if(!context.student)await this.get(id,context);
    const body=clean(payload.body);if(!body)throw fail('TICKET_MESSAGE_REQUIRED','Reply is required.',422);const internal=Boolean(payload.internal);if(internal&&(context.student||!this.permissions(context.actor).has('support_tickets.add_internal_note')))throw fail('TICKET_ACCESS_DENIED','Internal note permission required.',403);
    await sequelize.transaction(async transaction=>{await SupportTicketMessage.create({ticketId:id,authorType:context.student?'student':'staff',authorUserId:context.actor?.id||null,studentId:context.student?.id||null,body,isInternal:internal},{transaction});const changes={};
      if(context.student){changes.lastStudentReplyAt=new Date();if(['resolved','closed'].includes(ticket.status)){const from=ticket.status;changes.status='reopened';changes.closedAt=null;changes.closedByUserId=null;await this.statusHistory(ticket,from,'reopened',context,'student_reply',transaction);}}
      else if(!internal){changes.lastStaffReplyAt=new Date();if(!ticket.firstResponseAt)changes.firstResponseAt=new Date();}
      await ticket.update(changes,{transaction});await this.record(ticket,internal?'internal_note':'reply',context,{},transaction);});await this.notify(ticket,context.student?'Student replied':'Staff replied');await this.emit(ticket,context.student?'support_ticket.student_replied':'support_ticket.staff_replied');return this.get(id,context);
  }
  async transition(id,to,payload,actor){if(!STATUSES.includes(to))throw fail('INVALID_STATUS_TRANSITION','Invalid ticket status.',422);const required={resolved:'support_tickets.resolve',closed:'support_tickets.close',reopened:'support_tickets.reopen'}[to]||'support_tickets.reply';if(!actor?.isSystemAdmin&&!this.permissions(actor).has(required))throw fail('TICKET_ACCESS_DENIED','Ticket action permission denied.',403);const context={actor};const ticket=await SupportTicket.findByPk(id);if(!ticket)throw fail('TICKET_NOT_FOUND','Support ticket not found.',404);await this.get(id,context);if(!transitions[ticket.status]?.includes(to))throw fail('INVALID_STATUS_TRANSITION',`Cannot change ${ticket.status} to ${to}.`,409);const summary=clean(payload.resolutionSummary);if(['resolved','closed'].includes(to)&&!(summary||ticket.resolutionSummary))throw fail('RESOLUTION_SUMMARY_REQUIRED','Resolution summary is required.',422);const from=ticket.status;
    await sequelize.transaction(async transaction=>{const changes={status:to};if(to==='resolved')Object.assign(changes,{resolutionSummary:summary,resolvedAt:new Date(),resolvedByUserId:actor.id});if(to==='closed')Object.assign(changes,{resolutionSummary:summary||ticket.resolutionSummary,closedAt:new Date(),closedByUserId:actor.id});if(to==='reopened')Object.assign(changes,{closedAt:null,closedByUserId:null});await ticket.update(changes,{transaction});await this.statusHistory(ticket,from,to,context,payload.reason,transaction);await this.record(ticket,to,context,{from,to},transaction);});await this.notify(ticket,`Ticket ${to.replace(/_/g,' ')}`);await this.emit(ticket);return this.get(id,context);
  }
  async confirm(id,student){const ticket=await SupportTicket.findOne({where:{id,studentId:student.id}});if(!ticket)throw fail('TICKET_NOT_FOUND','Support ticket not found.',404);if(ticket.status!=='resolved')throw fail('INVALID_STATUS_TRANSITION','Only a resolved ticket can be confirmed.',409);const context={student};await sequelize.transaction(async transaction=>{await ticket.update({status:'closed',closedAt:new Date(),closedByUserId:null},{transaction});await this.statusHistory(ticket,'resolved','closed',context,'student_confirmed_fixed',transaction);await this.record(ticket,'closed',context,{confirmedFixed:true},transaction);});await this.emit(ticket);return this.get(id,context);}
  async assign(id,payload,actor){const context={actor};const ticket=await SupportTicket.findByPk(id);if(!ticket)throw fail('TICKET_NOT_FOUND','Support ticket not found.',404);await this.get(id,context);const previous={departmentId:ticket.departmentId,userId:ticket.assignedUserId};await sequelize.transaction(async transaction=>{await sequelize.query(`INSERT INTO support_ticket_assignment_history(ticket_id,previous_department_id,previous_user_id,new_department_id,new_user_id,changed_by_user_id,reason,source) VALUES(:id,:pd,:pu,:nd,:nu,:by,:reason,'manual')`,{replacements:{id,pd:previous.departmentId,pu:previous.userId,nd:payload.departmentId||null,nu:payload.assignedUserId||null,by:actor.id,reason:clean(payload.reason)},transaction});await ticket.update({departmentId:payload.departmentId||null,assignedUserId:payload.assignedUserId||null,status:ticket.status==='new'?'assigned':ticket.status},{transaction});await this.record(ticket,'assigned',context,{previous,...payload},transaction);});await this.notify(ticket,'Ticket assigned');await this.emit(ticket);return this.get(id,context);}
  async notify(ticket,title){const users=[ticket.assignedUserId].filter(Boolean);for(const userId of users)await Notification.create({userId,type:'support_ticket',title,message:ticket.ticketNumber,data:{ticketId:ticket.id,status:ticket.status}}).catch(()=>null);}
  async categories(activeOnly=true){return SupportTicketCategory.findAll({where:activeOnly?{isActive:true}:{},order:[['name','ASC']]});}
  async markRead(ticketId,context){await this.get(ticketId,context);const readerType=context.student?'student':'staff',userId=context.actor?.id||null,studentId=context.student?.id||null;await sequelize.transaction(async transaction=>{await sequelize.query(`DELETE FROM support_ticket_read_state WHERE ticket_id=:ticketId AND reader_type=:readerType AND user_id IS NOT DISTINCT FROM :userId AND student_id IS NOT DISTINCT FROM :studentId`,{replacements:{ticketId,readerType,userId,studentId},transaction});await sequelize.query(`INSERT INTO support_ticket_read_state(ticket_id,reader_type,user_id,student_id,last_read_message_id,read_at) SELECT :ticketId,:readerType,:userId,:studentId,MAX(id),NOW() FROM support_ticket_messages WHERE ticket_id=:ticketId`,{replacements:{ticketId,readerType,userId,studentId},transaction});});return{ticketId,read:true};}
  async dashboard(actor){const scope=await this.staffScope(actor);const rows=await SupportTicket.findAll({where:scope,attributes:['status','assignedUserId','slaResponseDueAt','slaResolutionDueAt','firstResponseAt','resolvedAt','closedAt','createdAt']});const now=Date.now(),count=s=>rows.filter(r=>r.status===s).length;const avg=a=>{const v=rows.map(a).filter(Number.isFinite);return v.length?Math.round(v.reduce((x,y)=>x+y,0)/v.length/60000):0;};return {new:count('new'),unassigned:rows.filter(r=>!r.assignedUserId).length,inProgress:count('in_progress'),waitingForStudent:count('waiting_for_student'),resolved:count('resolved'),overdue:rows.filter(r=>(!r.firstResponseAt&&r.slaResponseDueAt<now)||(!r.resolvedAt&&r.slaResolutionDueAt<now)).length,closedToday:rows.filter(r=>r.closedAt&&new Date(r.closedAt).toDateString()===new Date().toDateString()).length,averageFirstResponseMinutes:avg(r=>r.firstResponseAt-new Date(r.createdAt)),averageResolutionMinutes:avg(r=>r.resolvedAt-new Date(r.createdAt))};}
}
module.exports=new SupportTicketService();
module.exports.transitions=transitions;
