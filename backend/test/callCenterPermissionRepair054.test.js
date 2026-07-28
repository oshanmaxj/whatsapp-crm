const test=require('node:test'),assert=require('node:assert/strict'),migration=require('../migrations/054_repair_call_center_agent_permissions');
function environment(){
 let grants=[{role:'Agent',code:'call_center.supervisor_dashboard'},{role:'Agent',code:'call_center.view_all_agents'},{role:'Agent',code:'call_center.agent_workspace'},{role:'Manager',code:'call_center.supervisor_dashboard'},{role:'Admin',code:'call_center.view_all_agents'}],active;
 const q={sequelize:{async transaction(cb){const before=grants.map(x=>({...x}));active={id:'tx054'};try{return await cb(active)}catch(e){grants=before;throw e}finally{active=null}},async query(sql,o){assert.equal(o.transaction,active);if(sql.includes('information_schema.columns')){const cs={roles:['id','name','deleted_at'],permissions:['id','code','deleted_at'],role_permissions:['role_id','permission_id']}[o.replacements.table]||[];return[cs.map(column_name=>({column_name})),{}]}if(/pg_advisory_xact_lock/.test(sql))return[[],{}];if(/^SELECT r.id AS role_id/.test(sql.trim()))return[grants.filter(g=>g.role==='Agent'&&o.replacements.forbiddenAgentPermissions.includes(g.code)).map((g,i)=>({role_id:i+1,role_name:g.role,permission_code:g.code})),{}];if(/DELETE FROM role_permissions/.test(sql)){grants=grants.filter(g=>g.role!=='Agent'||!o.replacements.forbiddenAgentPermissions.includes(g.code));return[[],{}]}throw new Error(`Unexpected SQL ${sql}`)}}};
 return{q,get grants(){return grants}};
}
test('repair removes only agent supervisor grants and is idempotent',async()=>{
 const env=environment();await migration.up(env.q);await migration.up(env.q);
 assert.deepEqual(env.grants,[{role:'Agent',code:'call_center.agent_workspace'},{role:'Manager',code:'call_center.supervisor_dashboard'},{role:'Admin',code:'call_center.view_all_agents'}]);
});
