const { Op } = require('sequelize');
const { LecturerAgreement, User, Course, Batch } = require('../models');
const can = actor => actor?.isSystemAdmin || actor?.permissions?.includes('commission.lecturer_agreement_manage');
const fail = (message, status = 422) => Object.assign(new Error(message), { status });

class LecturerAgreementService {
  include() { return [{ model: User, as: 'lecturer', attributes: ['id','firstName','lastName','email'] }, { model: Course, as: 'course' }, { model: Batch, as: 'batch', required: false }]; }
  list(filters = {}) { return LecturerAgreement.findAll({ where: { ...(filters.status ? { status: filters.status } : {}), ...(filters.courseId ? { courseId: filters.courseId } : {}), ...(filters.batchId ? { batchId: filters.batchId } : {}) }, include: this.include(), order: [['startDate','DESC'],['id','DESC']] }); }
  activeFor({ courseId, batchId, date }, transaction) { return LecturerAgreement.findAll({ where: { courseId, status:'active', startDate:{[Op.lte]:date}, [Op.and]: [{[Op.or]: [{ batchId }, { batchId:null }]},{[Op.or]: [{endDate:null},{endDate:{[Op.gte]:date}}]}] }, transaction, lock: transaction?.LOCK?.SHARE }); }
  async save(id, payload, actor) {
    if (!can(actor)) throw fail('Lecturer agreement management permission required.', 403);
    if (!payload.lecturerUserId || !payload.courseId || !payload.startDate || !payload.calculationType) throw fail('Lecturer, course, start date, and calculation type are required.');
    const row = id ? await LecturerAgreement.findByPk(id) : null;
    if (id && !row) throw fail('Lecturer agreement not found.', 404);
    const values={...payload,updatedByUserId:actor.id};['batchId','endDate','percentageRate','fixedAmount','allocationPercentage','minimumGuarantee','maximumCap','paymentPerStudent','paymentPerSession','numberOfSessions'].forEach(field=>{if(values[field]==='')values[field]=null;});
    return row ? row.update(values) : LecturerAgreement.create({ ...values, createdByUserId: actor.id });
  }
}
module.exports = new LecturerAgreementService();
