const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const permission=require('../src/middleware/permission.middleware');
const supervisor=require('../src/services/callCenterSupervisor.service');
function invoke(code,user){return new Promise(resolve=>{const req={user},res={statusCode:200,status(value){this.statusCode=value;return this},json(body){resolve({status:this.statusCode,body})}};permission(code)(req,res,()=>resolve({status:200}))})}
const agent={id:91,isSystemAdmin:false,roles:['Agent'],permissions:['call_center.agent_workspace','call_queue.view_own','call_queue.manage_own']};
test('normal agent receives 403 for every supervisor route permission',async()=>{
 for(const code of ['call_center.supervisor_dashboard','call_center.view_live_calls','call_center.view_all_agents','call_center.view_all_history','call_center.view_performance'])assert.equal((await invoke(code,agent)).status,403,code);
});
test('normal agent is rejected by supervisor services before any data query',async()=>{
 for(const call of [()=>supervisor.summary({},agent),()=>supervisor.liveCalls({},agent),()=>supervisor.agents({},agent),()=>supervisor.outcomes({},agent),()=>supervisor.history({},agent),()=>supervisor.agent(92,{},agent)])await assert.rejects(call,error=>error.status===403&&error.code==='CALL_CENTER_SUPERVISOR_FORBIDDEN');
});
test('supervisor routes declare all six permission boundaries',()=>{
 const source=fs.readFileSync(path.join(__dirname,'../src/routes/callCenter.routes.js'),'utf8');
 for(const code of ['call_center.supervisor_dashboard','call_center.view_live_calls','call_center.view_all_agents','call_center.view_all_history','call_center.view_performance'])assert.ok(source.includes(`p('${code}')`),code);
 assert.equal(source.split("r.get('/supervisor/").length-1,6);
});
