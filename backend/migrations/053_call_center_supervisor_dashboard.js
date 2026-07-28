'use strict';
const LOCK=530053;
const PERMISSIONS=[
 ['call_center.agent_workspace','Use Call Center agent workspace'],
 ['call_center.supervisor_dashboard','View Call Center supervisor dashboard'],
 ['call_center.view_all_agents','View all Call Center agents'],
 ['call_center.view_live_calls','View live Call Center calls'],
 ['call_center.view_all_history','View all Call Center history'],
 ['call_center.view_performance','View Call Center performance']
];
const run=(q,sql,transaction,replacements={})=>q.sequelize.query(sql,{replacements,transaction});
module.exports={
 async up(q){
  return q.sequelize.transaction(async transaction=>{
   console.log('[053_call_center_supervisor_dashboard] acquiring advisory lock');
   await run(q,'SELECT pg_advisory_xact_lock(:lock)',transaction,{lock:LOCK});
   await run(q,`CREATE TABLE IF NOT EXISTS call_center_presence_sessions (
    id BIGSERIAL PRIMARY KEY,user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    session_identifier VARCHAR(180) NOT NULL,current_page VARCHAR(255),
    last_activity_at TIMESTAMPTZ NOT NULL,last_heartbeat_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(user_id,session_identifier))`,transaction);
   await run(q,'CREATE INDEX IF NOT EXISTS call_center_presence_heartbeat_idx ON call_center_presence_sessions(last_heartbeat_at DESC)',transaction);
   await run(q,'CREATE UNIQUE INDEX IF NOT EXISTS call_activities_one_active_per_agent_idx ON call_activities(agent_user_id) WHERE ended_at IS NULL',transaction);
   for(const [code,name] of PERMISSIONS)await run(q,`INSERT INTO permissions(code,name,description,created_at,updated_at)
    VALUES(:code,:name,:name,NOW(),NOW()) ON CONFLICT(code) DO UPDATE SET deleted_at=NULL,name=EXCLUDED.name,updated_at=NOW()`,transaction,{code,name});
   await run(q,`INSERT INTO user_permission_overrides(user_id,permission_id,effect,created_at,updated_at)
    SELECT u.id,p.id,'allow',NOW(),NOW() FROM users u CROSS JOIN permissions p
    WHERE u.is_system_admin=TRUE AND u.deleted_at IS NULL AND p.code=ANY(CAST(:codes AS VARCHAR[]))
    ON CONFLICT(user_id,permission_id) DO UPDATE SET effect='allow',updated_at=NOW()`,transaction,{codes:PERMISSIONS.slice(1).map(x=>x[0])});
   await run(q,`INSERT INTO role_permissions(role_id,permission_id,granted_at)
    SELECT DISTINCT rp.role_id,target.id,NOW() FROM role_permissions rp
    JOIN permissions legacy ON legacy.id=rp.permission_id CROSS JOIN permissions target
    WHERE legacy.code IN ('call_queue.view_own','calls.create','calls.view.own')
      AND target.code='call_center.agent_workspace'
    ON CONFLICT(role_id,permission_id) DO NOTHING`,transaction);
   console.log('[053_call_center_supervisor_dashboard] completed');
  });
 },
 async down(q){return q.sequelize.transaction(async transaction=>{await run(q,'SELECT pg_advisory_xact_lock(:lock)',transaction,{lock:LOCK});await run(q,'DROP INDEX IF EXISTS call_activities_one_active_per_agent_idx',transaction);await run(q,'DROP TABLE IF EXISTS call_center_presence_sessions',transaction);});}
};
