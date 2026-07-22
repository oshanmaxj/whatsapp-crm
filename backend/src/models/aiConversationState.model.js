module.exports=(sequelize,D)=>sequelize.define('AiConversationState',{
  id:{type:D.BIGINT,autoIncrement:true,primaryKey:true},conversationId:{type:D.BIGINT,allowNull:false,unique:true},aiAgentId:{type:D.BIGINT,allowNull:true},
  state:{type:D.STRING(60),allowNull:false,defaultValue:'new_lead'},status:{type:D.STRING(25),allowNull:false,defaultValue:'active'},extractedData:{type:D.JSONB,allowNull:false,defaultValue:{}},
  replyCount:{type:D.INTEGER,allowNull:false,defaultValue:0},pausedUntil:D.DATE,pauseReason:D.STRING(255),summary:D.TEXT,lastInboundMessageId:D.BIGINT,lastAiReplyAt:D.DATE,handoverAt:D.DATE
},{tableName:'ai_conversation_states',timestamps:true,underscored:true});
