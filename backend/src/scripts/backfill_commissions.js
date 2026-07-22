require('dotenv').config();
const { Op }=require('sequelize');
const { sequelize,FeeInstallment,StudentFee,CommissionLedger,LecturerAgreement }=require('../models');
const ledger=require('../services/commissionLedger.service');
(async()=>{const apply=process.argv.includes('--apply');const payments=await FeeInstallment.findAll({where:{status:{[Op.in]:['confirmed','paid']}},include:[{model:StudentFee,as:'fee'}],order:[['id','ASC']]});
 const report={mode:apply?'apply':'report',confirmedPayments:payments.length,alreadyProcessed:0,eligible:0,applied:0,ambiguousAgent:[],missingLecturerAgreement:[],errors:[]};
 for(const payment of payments){if(await CommissionLedger.count({where:{sourcePaymentId:payment.id,reversalOfId:null}})){report.alreadyProcessed++;continue;}if(!payment.creditedToUserId){report.ambiguousAgent.push(payment.id);continue;}
  const lecturerCount=await LecturerAgreement.count({where:{courseId:payment.fee?.courseId,status:'active'}});if(!lecturerCount)report.missingLecturerAgreement.push(payment.id);report.eligible++;if(apply)try{await ledger.generateForPayment(payment.id);report.applied++;}catch(error){report.errors.push({paymentId:payment.id,code:error.code,message:error.message});}}
 process.stdout.write(`${JSON.stringify(report,null,2)}\n`);await sequelize.close();process.exit(report.errors.length?2:0);})().catch(async error=>{process.stderr.write(`${error.stack}\n`);await sequelize.close().catch(()=>{});process.exit(1);});
