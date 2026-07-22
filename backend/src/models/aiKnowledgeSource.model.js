module.exports=(sequelize,D)=>sequelize.define('AiKnowledgeSource',{
  id:{type:D.BIGINT,autoIncrement:true,primaryKey:true},aiAgentId:{type:D.BIGINT,allowNull:true},sourceType:{type:D.STRING(40),allowNull:false,defaultValue:'answer'},title:{type:D.STRING(255),allowNull:false},content:{type:D.TEXT,allowNull:false},
  sourceRecordType:D.STRING(60),sourceRecordId:D.BIGINT,status:{type:D.STRING(20),allowNull:false,defaultValue:'draft'},version:{type:D.INTEGER,allowNull:false,defaultValue:1},validFrom:D.DATE,validUntil:D.DATE,createdBy:D.BIGINT
},{tableName:'ai_knowledge_sources',timestamps:true,underscored:true});
