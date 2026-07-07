const { Op } = require('sequelize');
const {
  Batch, Course, FeeInstallment, StudentEnrollment, StudentFee
} = require('../models');

const PAYMENT_BLOCKED_MESSAGE = 'Your access for this course is temporarily blocked due to pending payment.';

function evaluateFeeAccess(fee, installments = []) {
  const graceDays = Math.max(0, Number(process.env.LMS_PAYMENT_GRACE_DAYS || 0));
  const cutoff = new Date();
  cutoff.setHours(0, 0, 0, 0);
  cutoff.setDate(cutoff.getDate() - graceDays);
  const unpaid = (item) => (
    !['paid', 'confirmed', 'cancelled', 'reversed'].includes(item.status)
    && Number(item.paidAmount || 0) < Number(item.amount || 0)
  );
  const overdueInstallment = installments.some((item) => (
    item.dueDate && unpaid(item)
    && new Date(`${item.dueDate}T00:00:00`).getTime() < cutoff.getTime()
  ));
  const feePastDue = Boolean(
    fee?.dueDate
    && (fee.paymentType !== 'installment' || installments.length === 0)
    && new Date(`${fee.dueDate}T00:00:00`).getTime() < cutoff.getTime()
    && ['pending', 'partial', 'overdue'].includes(fee.status)
    && Number(fee.balance || 0) > 0
  );
  const feeMarkedOverdue = fee?.status === 'overdue' && (installments.length === 0 || installments.some(unpaid));
  const fullyPaid = Boolean(
    fee
    && ['full', 'free_card', 'scholarship'].includes(fee.paymentType)
    && (['paid', 'free'].includes(fee.status) || Number(fee.balance || 0) <= 0)
  );
  const installmentPlanCurrent = Boolean(
    fee && fee.paymentType === 'installment' && !overdueInstallment && !feePastDue && !feeMarkedOverdue
  );
  const accessAllowed = fullyPaid || installmentPlanCurrent;
  return {
    paymentStatus: !fee ? 'missing'
      : accessAllowed ? (fullyPaid ? 'paid' : 'current')
        : (overdueInstallment || feeMarkedOverdue || feePastDue) ? 'overdue' : fee.status,
    accessAllowed,
    reason: accessAllowed
      ? (fullyPaid ? 'full_payment_complete' : 'installment_plan_current')
      : !fee ? 'payment_plan_missing'
        : (overdueInstallment || feeMarkedOverdue) ? 'installment_overdue' : 'payment_overdue',
    warning: accessAllowed ? null : PAYMENT_BLOCKED_MESSAGE,
    graceDays
  };
}

async function feeForEnrollment(enrollment) {
  const fees = await StudentFee.findAll({
    where: { studentId: enrollment.studentId, status: { [Op.ne]: 'cancelled' } },
    include: [{ model: FeeInstallment, as: 'installments', required: false }],
    order: [['created_at', 'DESC']]
  });
  return fees.find((fee) => String(fee.enrollmentId || '') === String(enrollment.id))
    || fees.find((fee) => (
      !fee.enrollmentId
      && String(fee.courseId) === String(enrollment.courseId)
      && String(fee.batchId || '') === String(enrollment.batchId || '')
    ))
    || null;
}

async function checkEnrollmentAccess(studentId, courseId, batchId = null) {
  const enrollments = await StudentEnrollment.findAll({
    where: {
      studentId,
      courseId,
      enrollmentStatus: 'active',
      ...(batchId ? { batchId } : {})
    },
    include: [
      { model: Course, as: 'course', required: false },
      { model: Batch, as: 'batch', required: false }
    ],
    order: [['enrolled_at', 'DESC']]
  });
  if (!enrollments.length) {
    return {
      hasEnrollment: false,
      enrollment: null,
      paymentStatus: 'not_applicable',
      accessAllowed: false,
      reason: 'active_enrollment_missing',
      warning: 'You do not have an active enrollment for this course.'
    };
  }
  const evaluated = await Promise.all(enrollments.map(async (enrollment) => {
    const fee = await feeForEnrollment(enrollment);
    return { enrollment, fee, ...evaluateFeeAccess(fee, fee?.installments || []) };
  }));
  const selected = evaluated.find((item) => item.accessAllowed) || evaluated[0];
  return {
    hasEnrollment: true,
    ...selected
  };
}

module.exports = {
  PAYMENT_BLOCKED_MESSAGE,
  checkEnrollmentAccess,
  evaluateFeeAccess,
  feeForEnrollment
};
