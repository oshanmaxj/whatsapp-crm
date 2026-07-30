'use strict';

const LOCK=530055;
const PREFIX='[055_call_center_bulk_operations]';
const PERMISSIONS=[
 ['leads.bulk_assign','Bulk assign leads'],
 ['leads.assign_own','Assign leads to self'],
 ['leads.assign_unassigned','Claim unassigned leads'],
 ['leads.reassign_team','Reassign leads within permitted team'],
 ['leads.reassign_all','Reassign leads across permitted scope'],
 ['leads.unassign','Unassign leads']
];
const ADMIN_PERMISSION_CODES=PERMISSIONS.map(([code])=>code);
const TEAM_PERMISSION_CODES=['leads.bulk_assign','leads.reassign_team','leads.unassign'];
const ADMIN_ROLE_NAMES=['admin','administrator','system administrator'];
const TEAM_ROLE_NAMES=['manager','supervisor','call center supervisor','call-center supervisor'];

async function operation(name,callback){
 console.log(`${PREFIX} ${name}`);
 try{return await callback();}catch(error){error.migrationOperation=name;throw error;}
}

function query(q,sql,transaction,replacements={}){
 return q.sequelize.query(sql,{replacements,transaction});
}

async function columns(q,table,transaction){
 const[rows]=await operation(`inspect ${table}`,()=>query(q,
  `SELECT column_name,is_nullable,column_default,is_identity,is_generated
     FROM information_schema.columns
    WHERE table_schema=current_schema() AND table_name=:table
    ORDER BY ordinal_position`,transaction,{table}));
 return new Map(rows.map(row=>[row.column_name,row]));
}

async function requireTable(q,table,required,transaction){
 const found=await columns(q,table,transaction);
 if(!found.size)throw new Error(`Preflight failed: ${table} table is missing.`);
 for(const name of required)if(!found.has(name))throw new Error(`Preflight failed: ${table}.${name} is missing.`);
 return found;
}

function timestamp(columns,preferred){
 const name=preferred.find(column=>columns.has(column));
 return name?{column:`,${name}`,value:',NOW()'}:{column:'',value:''};
}

function requireInsertable(table,columns,provided){
 for(const[name,column]of columns){
  const generated=column.is_identity==='YES'||(column.is_generated&&column.is_generated!=='NEVER')||column.column_default!=null;
  if(column.is_nullable==='NO'&&!generated&&!provided.has(name))throw new Error(`Preflight failed: ${table}.${name} is required and has no default.`);
 }
}

function rolePredicate(roleColumns,namesReplacement){
 if(roleColumns.has('code'))return`LOWER(COALESCE(r.code,r.name)) IN (:${namesReplacement})`;
 return`LOWER(r.name) IN (:${namesReplacement})`;
}

async function requireHistoryColumns(q,transaction){
 const history=await requireTable(q,'lead_assignment_history',[
  'id','lead_id','previous_agent_user_id','new_agent_user_id','changed_by_user_id',
  'source','reason','bulk_operation_id','source_metadata','changed_at'
 ],transaction);
 return history;
}

module.exports={
 async up(q,S){
  return q.sequelize.transaction(async transaction=>{
   await operation('set local lock timeout',()=>query(q,"SET LOCAL lock_timeout = '10s'",transaction));
   await operation('set local statement timeout',()=>query(q,"SET LOCAL statement_timeout = '120s'",transaction));
   await operation('acquire advisory lock',()=>query(q,'SELECT pg_advisory_xact_lock(:lock)',transaction,{lock:LOCK}));

   const permissionColumns=await requireTable(q,'permissions',['id','code','name'],transaction);
   const roleColumns=await requireTable(q,'roles',['id','name'],transaction);
   const rolePermissionColumns=await requireTable(q,'role_permissions',['role_id','permission_id'],transaction);
   const overrideColumns=await requireTable(q,'user_permission_overrides',['user_id','permission_id','effect'],transaction);
   const userColumns=await requireTable(q,'users',['id'],transaction);
   await requireTable(q,'leads',['id'],transaction);
   await requireTable(q,'call_queues',['id','agent_user_id'],transaction);
   await requireTable(q,'call_queue_entries',['id','queue_id','lead_id'],transaction);

   await operation('add call queue capacity',()=>query(q,'ALTER TABLE call_queues ADD COLUMN IF NOT EXISTS capacity INTEGER',transaction));
   await operation('add queue bulk operation id',()=>query(q,'ALTER TABLE call_queue_entries ADD COLUMN IF NOT EXISTS bulk_operation_id UUID',transaction));

   const permissionCreated=timestamp(permissionColumns,['created_at']);
   const permissionDescription=permissionColumns.has('description');
   const permissionUpdated=permissionColumns.has('updated_at');
   requireInsertable('permissions',permissionColumns,new Set(['code','name',...(permissionDescription?['description']:[]),...(permissionCreated.column?[permissionCreated.column.slice(1)]:[]),...(permissionUpdated?['updated_at']:[])]));
   for(const[code,name]of PERMISSIONS){
    await operation(`seed permission ${code}`,()=>query(q,
     `INSERT INTO permissions(code,name${permissionDescription?',description':''}${permissionCreated.column}${permissionUpdated?',updated_at':''})
      VALUES(:code,:name${permissionDescription?',:name':''}${permissionCreated.value}${permissionUpdated?',NOW()':''})
      ON CONFLICT(code) DO UPDATE SET
       name=EXCLUDED.name${permissionDescription?',description=EXCLUDED.description':''}${permissionColumns.has('deleted_at')?',deleted_at=NULL':''}${permissionUpdated?',updated_at=NOW()':''}`,
     transaction,{code,name}));
   }

   const grantTimestamp=timestamp(rolePermissionColumns,['granted_at','created_at']);
   requireInsertable('role_permissions',rolePermissionColumns,new Set(['role_id','permission_id',...(grantTimestamp.column?[grantTimestamp.column.slice(1)]:[])]));
   await operation('grant admin permissions',()=>query(q,
    `INSERT INTO role_permissions(role_id,permission_id${grantTimestamp.column})
     SELECT r.id,p.id${grantTimestamp.value}
       FROM roles r CROSS JOIN permissions p
      WHERE ${rolePredicate(roleColumns,'adminRoleNames')}
        ${roleColumns.has('deleted_at')?'AND r.deleted_at IS NULL':''}
        AND p.code IN (:adminPermissionCodes)
     ON CONFLICT(role_id,permission_id) DO NOTHING`,
    transaction,{adminRoleNames:ADMIN_ROLE_NAMES,adminPermissionCodes:ADMIN_PERMISSION_CODES}));

   await operation('grant manager and supervisor team permissions',()=>query(q,
    `INSERT INTO role_permissions(role_id,permission_id${grantTimestamp.column})
     SELECT r.id,p.id${grantTimestamp.value}
       FROM roles r CROSS JOIN permissions p
      WHERE ${rolePredicate(roleColumns,'teamRoleNames')}
        ${roleColumns.has('deleted_at')?'AND r.deleted_at IS NULL':''}
        AND p.code IN (:teamPermissionCodes)
     ON CONFLICT(role_id,permission_id) DO NOTHING`,
    transaction,{teamRoleNames:TEAM_ROLE_NAMES,teamPermissionCodes:TEAM_PERMISSION_CODES}));

   if(userColumns.has('is_system_admin')){
    const overrideCreated=timestamp(overrideColumns,['granted_at','created_at']);
    const overrideUpdated=overrideColumns.has('updated_at');
    requireInsertable('user_permission_overrides',overrideColumns,new Set(['user_id','permission_id','effect',...(overrideCreated.column?[overrideCreated.column.slice(1)]:[]),...(overrideUpdated?['updated_at']:[])]));
    await operation('grant system administrator overrides',()=>query(q,
     `INSERT INTO user_permission_overrides(user_id,permission_id,effect${overrideCreated.column}${overrideUpdated?',updated_at':''})
      SELECT u.id,p.id,'allow'${overrideCreated.value}${overrideUpdated?',NOW()':''}
        FROM users u CROSS JOIN permissions p
       WHERE u.is_system_admin=TRUE
         ${userColumns.has('deleted_at')?'AND u.deleted_at IS NULL':''}
         AND p.code IN (:adminPermissionCodes)
      ON CONFLICT(user_id,permission_id) DO UPDATE SET
       effect=EXCLUDED.effect${overrideUpdated?',updated_at=NOW()':''}`,
     transaction,{adminPermissionCodes:ADMIN_PERMISSION_CODES}));
   }

   await operation('create lead assignment history table',()=>query(q,
    `CREATE TABLE IF NOT EXISTS lead_assignment_history(
      id BIGSERIAL PRIMARY KEY,
      lead_id BIGINT NOT NULL REFERENCES leads(id),
      previous_agent_user_id BIGINT REFERENCES users(id),
      new_agent_user_id BIGINT REFERENCES users(id),
      changed_by_user_id BIGINT NOT NULL REFERENCES users(id),
      source VARCHAR(60) NOT NULL,
      reason VARCHAR(1000),
      bulk_operation_id UUID NOT NULL,
      source_metadata JSONB,
      changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
     )`,transaction));
   await requireHistoryColumns(q,transaction);
   await operation('create assignment history operation index',()=>query(q,
    'CREATE UNIQUE INDEX IF NOT EXISTS lead_assignment_history_operation_lead_uq ON lead_assignment_history(bulk_operation_id,lead_id)',transaction));
  });
 },
 async down(){/* Additive production migration intentionally has no destructive rollback. */}
};

module.exports.constants={PERMISSIONS,ADMIN_PERMISSION_CODES,TEAM_PERMISSION_CODES,ADMIN_ROLE_NAMES,TEAM_ROLE_NAMES};
