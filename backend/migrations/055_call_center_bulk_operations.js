const permissions=[
 ['leads.bulk_assign','Bulk assign leads'],
 ['leads.assign_own','Assign leads to self'],
 ['leads.assign_unassigned','Claim unassigned leads'],
 ['leads.reassign_team','Reassign leads within permitted team'],
 ['leads.reassign_all','Reassign leads across permitted scope'],
 ['leads.unassign','Unassign leads']
];

async function column(q,table,name,definition,transaction){
 const fields=await q.describeTable(table,{transaction});
 if(!fields[name])await q.addColumn(table,name,definition,{transaction});
}

module.exports={
 async up(q,S){
  const D=S.DataTypes||S;
  await q.sequelize.transaction(async transaction=>{
   await column(q,'call_queues','capacity',{type:D.INTEGER,allowNull:true},transaction);
   await column(q,'call_queue_entries','bulk_operation_id',{type:D.UUID,allowNull:true},transaction);
   const permissionFields=await q.describeTable('permissions',{transaction});
   for(const[code,name]of permissions){
    const columns=['code','name'],values=[':code',':name'],replacements={code,name};
    if(permissionFields.description){columns.push('description');values.push(':name');}
    if(permissionFields.created_at){columns.push('created_at');values.push('CURRENT_TIMESTAMP');}
    if(permissionFields.updated_at){columns.push('updated_at');values.push('CURRENT_TIMESTAMP');}
    await q.sequelize.query(`INSERT INTO permissions (${columns.join(',')}) VALUES (${values.join(',')}) ON CONFLICT (code) DO NOTHING`,{replacements,transaction});
   }
   const rolePermissionFields=await q.describeTable('role_permissions',{transaction});
   const timestamps=rolePermissionFields.created_at&&rolePermissionFields.updated_at?',created_at,updated_at':'';
   const timestampValues=timestamps?',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP':'';
   await q.sequelize.query(
    `INSERT INTO role_permissions (role_id,permission_id${timestamps})
     SELECT r.id,p.id${timestampValues} FROM roles r JOIN permissions p ON
       (LOWER(r.name) IN ('admin','administrator','system administrator') AND p.code IN (:adminCodes))
       OR (LOWER(r.name) IN ('supervisor','call center supervisor','call-center supervisor') AND p.code IN (:supervisorCodes))
     WHERE NOT EXISTS (SELECT 1 FROM role_permissions rp WHERE rp.role_id=r.id AND rp.permission_id=p.id)`,
    {replacements:{adminCodes:permissions.map(x=>x[0]),supervisorCodes:['leads.bulk_assign','leads.reassign_team','leads.unassign']},transaction}
   );
   const tables=(await q.showAllTables({transaction})).map(x=>String(x.tableName||x).toLowerCase());
   if(!tables.includes('lead_assignment_history')){
    await q.createTable('lead_assignment_history',{
     id:{type:D.BIGINT,autoIncrement:true,primaryKey:true},
     lead_id:{type:D.BIGINT,allowNull:false,references:{model:'leads',key:'id'}},
     previous_agent_user_id:{type:D.BIGINT,allowNull:true,references:{model:'users',key:'id'}},
     new_agent_user_id:{type:D.BIGINT,allowNull:true,references:{model:'users',key:'id'}},
     changed_by_user_id:{type:D.BIGINT,allowNull:false,references:{model:'users',key:'id'}},
     source:{type:D.STRING(60),allowNull:false},
     reason:{type:D.STRING(1000),allowNull:true},
     bulk_operation_id:{type:D.UUID,allowNull:false},
     source_metadata:{type:D.JSON,allowNull:true},
     changed_at:{type:D.DATE,allowNull:false,defaultValue:S.literal('CURRENT_TIMESTAMP')}
    },{transaction});
    await q.addIndex('lead_assignment_history',['bulk_operation_id','lead_id'],{unique:true,name:'lead_assignment_history_operation_lead_uq',transaction});
   }
  });
 },
 async down(){/* Additive production migration intentionally has no destructive rollback. */}
};
