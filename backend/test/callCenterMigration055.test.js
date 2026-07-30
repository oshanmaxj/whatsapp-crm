const test=require('node:test');
const assert=require('node:assert/strict');
const Sequelize=require('sequelize');
const migration=require('../migrations/055_call_center_bulk_operations');

function environment({failOperation=null}={}){
 let state={
  tables:{
   permissions:new Set(['id','code','name','description','created_at','updated_at','deleted_at']),
   roles:new Set(['id','name','deleted_at']),
   role_permissions:new Set(['role_id','permission_id','granted_at']),
   user_permission_overrides:new Set(['user_id','permission_id','effect','created_at','updated_at']),
   users:new Set(['id','is_system_admin','deleted_at']),
   leads:new Set(['id']),
   call_queues:new Set(['id','agent_user_id']),
   call_queue_entries:new Set(['id','queue_id','lead_id'])
  },
  permissions:new Map(),roleGrants:new Set(),overrides:new Set(),indexes:new Set()
 };
 const roles=[{id:1,name:'Admin'},{id:2,name:'Manager'},{id:3,name:'Supervisor'},{id:4,name:'Agent'}];
 let activeTransaction=null,operation=null,aborted=false;
 const snapshot=()=>structuredClone({
  tables:Object.entries(state.tables).map(([name,value])=>[name,[...value]]),
  permissions:[...state.permissions],roleGrants:[...state.roleGrants],overrides:[...state.overrides],indexes:[...state.indexes]
 });
 const restore=value=>{state={tables:Object.fromEntries(value.tables.map(([name,columns])=>[name,new Set(columns)])),permissions:new Map(value.permissions),roleGrants:new Set(value.roleGrants),overrides:new Set(value.overrides),indexes:new Set(value.indexes)};};
 const q={sequelize:{
  async transaction(callback){const before=snapshot();activeTransaction={id:'tx055'};aborted=false;try{return await callback(activeTransaction);}catch(error){restore(before);throw error;}finally{activeTransaction=null;}},
  async query(sql,options){
   assert.equal(options.transaction,activeTransaction,'query escaped migration transaction');
   if(aborted)throw Object.assign(new Error('current transaction is aborted'),{code:'25P02'});
   const normalized=sql.replace(/\s+/g,' ').trim();
   if(/SET LOCAL/.test(normalized)||/pg_advisory_xact_lock/.test(normalized))return[[],{}];
   if(/information_schema\.columns/.test(normalized)){
    operation=`inspect ${options.replacements.table}`;
    return[[...(state.tables[options.replacements.table]||[])].map(column_name=>({column_name,is_nullable:'YES',column_default:null,is_identity:'NO',is_generated:'NEVER'})),{}];
   }
   operation=
    /INSERT INTO permissions/.test(normalized)?`seed permission ${options.replacements.code}`:
    /INSERT INTO role_permissions/.test(normalized)&&options.replacements.adminRoleNames?'grant admin permissions':
    /INSERT INTO role_permissions/.test(normalized)?'grant manager and supervisor team permissions':
    /INSERT INTO user_permission_overrides/.test(normalized)?'grant system administrator overrides':
    /CREATE TABLE IF NOT EXISTS lead_assignment_history/.test(normalized)?'create lead assignment history table':
    /CREATE UNIQUE INDEX/.test(normalized)?'create assignment history operation index':
    /ALTER TABLE call_queues/.test(normalized)?'add call queue capacity':
    /ALTER TABLE call_queue_entries/.test(normalized)?'add queue bulk operation id':'unknown';
   if(failOperation===operation){aborted=true;throw Object.assign(new Error(`root failure at ${operation}`),{code:'23502',column:'granted_at',table:'role_permissions'});}
   if(operation==='add call queue capacity')state.tables.call_queues.add('capacity');
   else if(operation==='add queue bulk operation id')state.tables.call_queue_entries.add('bulk_operation_id');
   else if(operation.startsWith('seed permission'))state.permissions.set(options.replacements.code,options.replacements.name);
   else if(operation==='grant admin permissions'){
    assert.match(normalized,/role_id,permission_id,granted_at/);
    for(const role of roles.filter(x=>options.replacements.adminRoleNames.includes(x.name.toLowerCase())))for(const code of options.replacements.adminPermissionCodes)state.roleGrants.add(`${role.id}:${code}`);
   }else if(operation==='grant manager and supervisor team permissions'){
    assert.match(normalized,/role_id,permission_id,granted_at/);
    for(const role of roles.filter(x=>options.replacements.teamRoleNames.includes(x.name.toLowerCase())))for(const code of options.replacements.teamPermissionCodes)state.roleGrants.add(`${role.id}:${code}`);
   }else if(operation==='grant system administrator overrides')for(const code of options.replacements.adminPermissionCodes)state.overrides.add(`99:${code}`);
   else if(operation==='create lead assignment history table')state.tables.lead_assignment_history=new Set(['id','lead_id','previous_agent_user_id','new_agent_user_id','changed_by_user_id','source','reason','bulk_operation_id','source_metadata','changed_at']);
   else if(operation==='create assignment history operation index')state.indexes.add('lead_assignment_history_operation_lead_uq');
   else throw new Error(`Unexpected SQL: ${normalized}`);
   return[[],{}];
  }
 }};
 return{q,get state(){return state;}};
}

test('migration 055 succeeds and reruns on production granted_at schema',async()=>{
 const env=environment();
 await migration.up(env.q,Sequelize);
 await migration.up(env.q,Sequelize);
 assert.equal(env.state.permissions.size,6);
 assert.equal(env.state.roleGrants.size,12);
 assert.equal(env.state.indexes.size,1);
});

test('admin gets all, manager/supervisor only team grants, and agent gets none',async()=>{
 const env=environment();await migration.up(env.q,Sequelize);
 for(const code of migration.constants.ADMIN_PERMISSION_CODES)assert.ok(env.state.roleGrants.has(`1:${code}`));
 for(const roleId of[2,3]){
  for(const code of migration.constants.TEAM_PERMISSION_CODES)assert.ok(env.state.roleGrants.has(`${roleId}:${code}`));
  for(const code of['leads.assign_own','leads.assign_unassigned','leads.reassign_all'])assert.equal(env.state.roleGrants.has(`${roleId}:${code}`),false);
 }
 assert.equal([...env.state.roleGrants].some(grant=>grant.startsWith('4:')),false);
 assert.equal(env.state.roleGrants.size,new Set(env.state.roleGrants).size);
});

test('first database error is surfaced and rollback leaves no partial changes',async()=>{
 const env=environment({failOperation:'grant admin permissions'});
 await assert.rejects(migration.up(env.q,Sequelize),error=>error.code==='23502'&&/root failure/.test(error.message)&&error.migrationOperation==='grant admin permissions');
 assert.equal(env.state.permissions.size,0);
 assert.equal(env.state.tables.call_queues.has('capacity'),false);
 assert.equal(env.state.tables.lead_assignment_history,undefined);
});

test('migration 055 runs twice on an exact production-style PostgreSQL schema',{skip:process.env.RUN_MIGRATION_055_POSTGRES!=='1'},async()=>{
 require('../src/config/loadEnv');
 const base=require('../src/config/database');
 const database=new Sequelize(base.getDatabaseName(),base.config.username,base.config.password,{
  dialect:'postgres',host:base.config.host,port:base.config.port,logging:false,
  dialectOptions:base.options.dialectOptions,pool:{max:1,min:0,idle:1000}
 });
 const schema=`migration_055_test_${process.pid}_${Date.now()}`;
 assert.match(schema,/^migration_055_test_\d+_\d+$/);
 try{
  await database.query(`CREATE SCHEMA "${schema}"`);
  await database.query(`SET search_path TO "${schema}"`);
  await database.query(`
   CREATE TABLE users(id BIGSERIAL PRIMARY KEY,is_system_admin BOOLEAN NOT NULL DEFAULT FALSE,deleted_at TIMESTAMPTZ);
   CREATE TABLE permissions(id SERIAL PRIMARY KEY,code VARCHAR(120) NOT NULL UNIQUE,name VARCHAR(255) NOT NULL,description VARCHAR(255),created_at TIMESTAMPTZ NOT NULL,updated_at TIMESTAMPTZ NOT NULL,deleted_at TIMESTAMPTZ);
   CREATE TABLE roles(id BIGSERIAL PRIMARY KEY,name VARCHAR(120) NOT NULL,deleted_at TIMESTAMPTZ);
   CREATE TABLE role_permissions(role_id BIGINT NOT NULL REFERENCES roles(id),permission_id INTEGER NOT NULL REFERENCES permissions(id),granted_at TIMESTAMPTZ NOT NULL,UNIQUE(role_id,permission_id));
   CREATE TABLE user_permission_overrides(user_id BIGINT NOT NULL REFERENCES users(id),permission_id INTEGER NOT NULL REFERENCES permissions(id),effect VARCHAR(10) NOT NULL,created_at TIMESTAMPTZ NOT NULL,updated_at TIMESTAMPTZ NOT NULL,UNIQUE(user_id,permission_id));
   CREATE TABLE leads(id BIGSERIAL PRIMARY KEY);
   CREATE TABLE call_queues(id BIGSERIAL PRIMARY KEY,agent_user_id BIGINT NOT NULL REFERENCES users(id));
   CREATE TABLE call_queue_entries(id BIGSERIAL PRIMARY KEY,queue_id BIGINT NOT NULL REFERENCES call_queues(id),lead_id BIGINT NOT NULL REFERENCES leads(id));
   INSERT INTO users(is_system_admin) VALUES(TRUE),(FALSE);
   INSERT INTO roles(name) VALUES('Admin'),('Manager'),('Supervisor'),('Agent');
  `);
  const q=database.getQueryInterface();
  await migration.up(q,Sequelize);
  await migration.up(q,Sequelize);
  const[rows]=await database.query(`
   SELECT LOWER(r.name) role,p.code,COUNT(*)::int copies
   FROM role_permissions rp JOIN roles r ON r.id=rp.role_id JOIN permissions p ON p.id=rp.permission_id
   GROUP BY LOWER(r.name),p.code ORDER BY 1,2
  `);
  assert.ok(rows.length);
  assert.ok(rows.every(row=>row.copies===1));
  assert.equal(rows.some(row=>row.role==='agent'),false);
  assert.equal(rows.filter(row=>row.role==='admin').length,6);
  assert.equal(rows.filter(row=>['manager','supervisor'].includes(row.role)).length,6);
  const[columns]=await database.query(`SELECT table_name,column_name FROM information_schema.columns WHERE table_schema=:schema AND ((table_name='call_queues' AND column_name='capacity') OR (table_name='call_queue_entries' AND column_name='bulk_operation_id'))`,{replacements:{schema}});
  assert.equal(columns.length,2);
 }finally{
  await database.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`).catch(()=>{});
  await database.close();
 }
});
