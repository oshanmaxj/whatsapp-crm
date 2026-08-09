require('dotenv').config();
const { Op } = require('sequelize');
const { Contact, Conversation, Lead, Student, sequelize } = require('../models');
const identityService = require('../services/studentCanonicalIdentity.service');

const apply = process.argv.includes('--apply');
const batchSizeArg = process.argv.find((value) => value.startsWith('--batch-size='));
const batchSize = Math.min(500, Math.max(1, Number(batchSizeArg?.split('=')[1]) || 100));
const placeholder = (contact) => {
  const name = [contact?.firstName, contact?.lastName].filter(Boolean).join(' ').trim();
  return !name || ['unnamed', 'unknown', 'recipient'].includes(name.toLowerCase()) || /^\+?[\d\s().-]+$/.test(name);
};

async function run() {
  const totals = { studentsInspected: 0, contactsEligible: 0, leadsEligible: 0, conversationsAffected: 0, ambiguousRecordsSkipped: 0, recordsAlreadyCorrect: 0, updated: 0 };
  const skippedIds = [];
  let lastId = 0;
  while (true) {
    const students = await Student.findAll({ where: { id: { [Op.gt]: lastId } }, include: [{ model: Contact, as: 'contact', required: false }], order: [['id', 'ASC']], limit: batchSize });
    if (!students.length) break;
    for (const student of students) {
      lastId = student.id;
      totals.studentsInspected += 1;
      if (!student.contact) { totals.ambiguousRecordsSkipped += 1; skippedIds.push(String(student.id)); continue; }
      const current = [student.contact.firstName, student.contact.lastName].filter(Boolean).join(' ').trim().replace(/\s+/g, ' ');
      const wanted = String(student.name || '').trim().replace(/\s+/gu, ' ');
      if (current === wanted) { totals.recordsAlreadyCorrect += 1; continue; }
      if (!placeholder(student.contact)) { totals.ambiguousRecordsSkipped += 1; skippedIds.push(String(student.id)); continue; }
      totals.contactsEligible += 1;
      totals.leadsEligible += await Lead.count({ where: { contactId: student.contactId } });
      totals.conversationsAffected += await Conversation.count({ where: { contactId: student.contactId } });
      if (apply) {
        const result = await sequelize.transaction((transaction) => identityService.sync({ studentId: student.id, contactId: student.contactId, leadId: student.leadId, source: 'repair_student_contact_identity', transaction }));
        if (result.synchronized) totals.updated += 1;
      }
    }
  }
  console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', ...totals, ambiguousStudentIds: skippedIds }));
}

run().then(() => sequelize.close()).catch(async (error) => {
  console.error(JSON.stringify({ error: error.code || error.name || 'REPAIR_FAILED' }));
  await sequelize.close().catch(() => {});
  process.exitCode = 1;
});
