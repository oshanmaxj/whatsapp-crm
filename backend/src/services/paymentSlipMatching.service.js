const { Op } = require('sequelize');
const { Student, StudentFee, FeeInstallment } = require('../models');
const { normalizePhone, sriLankanPhoneCandidates } = require('../utils/phone');

const OUTSTANDING = ['pending', 'due_soon', 'due_today', 'partially_paid', 'overdue', 'rejected'];

async function matchPaymentSlipOwner({ contact, lead, conversation, transaction }) {
  const phone = contact?.normalizedPhone || contact?.phone || conversation?.normalizedPhone;
  const variants = [...new Set([normalizePhone(phone), ...sriLankanPhoneCandidates(phone), phone].filter(Boolean))];
  const clauses = [];
  if (contact?.id) clauses.push({ contactId: contact.id });
  if (lead?.id) clauses.push({ leadId: lead.id });
  if (variants.length) clauses.push({ phone: { [Op.in]: variants } });
  const students = clauses.length ? await Student.findAll({ where: { [Op.or]: clauses, status: { [Op.in]: ['enrolled', 'active'] } }, transaction }) : [];
  const unique = [...new Map(students.map((student) => [String(student.id), student])).values()];
  const candidates = unique.map((student) => ({ id: student.id, studentNo: student.studentNo, name: student.name, phone: student.phone }));
  if (unique.length !== 1) return {
    matchedStudentId: null, matchedStudentFeeId: null, matchedInstallmentId: null,
    candidates: { students: candidates, fees: [], installments: [] }, warnings: unique.length > 1 ? ['AMBIGUOUS_STUDENT_MATCH'] : ['STUDENT_NOT_MATCHED']
  };
  const student = unique[0];
  const fees = await StudentFee.findAll({
    where: { studentId: student.id, status: { [Op.in]: ['pending', 'partial', 'overdue'] } },
    include: [{ model: FeeInstallment, as: 'installments', where: { status: { [Op.in]: OUTSTANDING } }, required: false }],
    transaction, order: [[{ model: FeeInstallment, as: 'installments' }, 'due_date', 'ASC']]
  });
  const installments = fees.flatMap((fee) => (fee.installments || []).map((item) => ({
    id: item.id, studentFeeId: fee.id, installmentNo: item.installmentNo, amount: item.amount,
    paidAmount: item.paidAmount, dueDate: item.dueDate, status: item.status
  })));
  return {
    matchedStudentId: student.id,
    matchedStudentFeeId: fees.length === 1 ? fees[0].id : null,
    matchedInstallmentId: installments.length === 1 ? installments[0].id : null,
    candidates: { students: candidates, fees: fees.map((fee) => ({ id: fee.id, balance: fee.balance, status: fee.status })), installments },
    warnings: installments.length > 1 ? ['AMBIGUOUS_INSTALLMENT_MATCH'] : installments.length ? [] : ['NO_OUTSTANDING_INSTALLMENT']
  };
}

module.exports = { matchPaymentSlipOwner, OUTSTANDING };
