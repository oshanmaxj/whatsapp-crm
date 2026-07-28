module.exports=(s,D)=>s.define('CallCenterPresenceSession',{
 id:{type:D.BIGINT,autoIncrement:true,primaryKey:true},userId:{type:D.BIGINT,allowNull:false},
 sessionIdentifier:{type:D.STRING(180),allowNull:false},currentPage:D.STRING(255),
 lastActivityAt:{type:D.DATE,allowNull:false},lastHeartbeatAt:{type:D.DATE,allowNull:false}
},{tableName:'call_center_presence_sessions',timestamps:true,underscored:true});
