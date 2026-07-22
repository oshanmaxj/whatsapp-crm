module.exports = (sequelize, D) => sequelize.define('LecturerAgreement', {
  id:{type:D.BIGINT,autoIncrement:true,primaryKey:true}, lecturerUserId:{type:D.BIGINT,allowNull:false},
  courseId:{type:D.BIGINT,allowNull:false}, batchId:{type:D.BIGINT}, startDate:{type:D.DATEONLY,allowNull:false}, endDate:D.DATEONLY,
  calculationType:{type:D.STRING(50),allowNull:false}, percentageRate:D.DECIMAL(9,4), fixedAmount:D.DECIMAL(18,2),
  revenueBasis:{type:D.STRING(40),allowNull:false,defaultValue:'gross_collected'}, allocationPercentage:D.DECIMAL(9,4),
  minimumGuarantee:D.DECIMAL(18,2), maximumCap:D.DECIMAL(18,2), paymentPerStudent:D.DECIMAL(18,2),
  paymentPerSession:D.DECIMAL(18,2), numberOfSessions:D.INTEGER, tierConfiguration:D.JSONB,
  status:{type:D.STRING(20),allowNull:false,defaultValue:'draft'}, notes:D.TEXT, contractReference:D.STRING(180),
  approvedByUserId:D.BIGINT, createdByUserId:D.BIGINT, updatedByUserId:D.BIGINT, deletedAt:D.DATE
},{tableName:'lecturer_agreements',timestamps:true,paranoid:true,underscored:true});
