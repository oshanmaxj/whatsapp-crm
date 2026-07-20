import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link as RouterLink, useLocation, useNavigate } from 'react-router-dom';
import {
  Alert, Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, Divider, FormControl, Grid,
  IconButton, InputLabel, LinearProgress, MenuItem, Paper, Select, Stack, Table, TableBody, TableCell,
  TableContainer, TableHead, TableRow, TextField, Typography, Pagination, Tooltip
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import EditIcon from '@mui/icons-material/Edit';
import NotificationsActiveIcon from '@mui/icons-material/NotificationsActive';
import PaymentsIcon from '@mui/icons-material/Payments';
import VisibilityIcon from '@mui/icons-material/Visibility';
import LockResetIcon from '@mui/icons-material/LockReset';
import ReceiptLongIcon from '@mui/icons-material/ReceiptLong';
import AsyncSearchSelect from '../components/AsyncSearchSelect';
import { downloadReceipt, saveBlob } from '../services/paymentReceipt.service';
import {
  confirmInstallmentPayment, convertLeadToStudent, createAttendance, createBatch, createCertificate, createCourse, createFee, createStudent, deleteAttendance,
  deleteBatch, deleteCertificate, deleteCourse, deleteFee, deleteStudent, listAttendance, listBatches,
  listCertificates, listCourses, listFees, listStudents, payInstallment, rejectInstallmentPayment, reverseInstallmentPayment, sendFeeReminder, updateAttendance,
  updateBatch, updateCertificate, updateCourse, updateFee, updateStudent, resetStudentPortalPassword,
  searchStudents, searchCourses, searchBatches
} from '../services/education.service';
import { getAccessPayload, hasAnyPermission } from '../utils/access';

const paymentMethods = ['Cash', 'Bank Deposit', 'Bank Transfer', 'Card', 'Online Payment', 'Cheque', 'Free Card', 'Scholarship', 'Other'];
const paymentTypes = ['full', 'installment', 'free_card', 'scholarship'];
const discountTypes = ['none', 'fixed', 'percentage', 'scholarship', 'promotional', 'special_approval'];

const modules = {
  courses: {
    title: 'Course Management',
    list: listCourses,
    create: createCourse,
    update: updateCourse,
    remove: deleteCourse,
    initial: { name: '', code: '', category: '', feeAmount: '', defaultInstallmentCount: 1, durationWeeks: '', status: 'active', whatsappGroupName: '', whatsappGroupLink: '', description: '' },
    fields: ['code', 'name', 'category', 'feeAmount', 'defaultInstallmentCount', 'durationWeeks', 'status', 'whatsappGroupName', 'whatsappGroupLink', 'description'],
    columns: ['code', 'name', 'category', 'feeAmount', 'defaultInstallmentCount', 'durationWeeks', 'status']
  },
  batches: {
    title: 'Batch Management',
    list: listBatches,
    create: createBatch,
    update: updateBatch,
    remove: deleteBatch,
    initial: { courseId: '', name: '', code: '', startDate: '', endDate: '', schedule: '', capacity: '', status: 'upcoming', whatsappGroupName: '', whatsappGroupLink: '' },
    fields: ['courseId', 'name', 'code', 'startDate', 'endDate', 'schedule', 'capacity', 'status', 'whatsappGroupName', 'whatsappGroupLink'],
    columns: ['name', 'code', 'course.code', 'course.name', 'startDate', 'schedule', 'status']
  },
  students: {
    title: 'Student Management',
    list: listStudents,
    create: createStudent,
    update: updateStudent,
    remove: deleteStudent,
    initial: {
      name: '', phone: '', email: '', contactId: '', leadId: '', dateOfBirth: '',
      enrollments: [{ courseId: '', batchId: '', status: 'active', feePlan: 'full', installments: 1 }],
      leadSource: '', status: 'enrolled', studentPortalPassword: '', notes: ''
    },
    fields: ['name', 'phone', 'email', 'dateOfBirth', 'leadSource', 'status', 'studentPortalPassword', 'notes'],
    columns: ['studentNo', 'name', 'phone', 'dateOfBirth', 'currentCourses', 'currentBatches', 'status']
  },
  fees: {
    title: 'Fee & Installment Tracking',
    list: listFees,
    create: createFee,
    update: updateFee,
    remove: deleteFee,
    initial: {
      studentId: '', enrollmentId: '', courseId: '', batchId: '', originalAmount: '', discountType: 'none', discountValue: '', discountReason: '', approvedBy: '',
      paymentType: 'full', installmentCount: 1, dueDate: new Date().toISOString().slice(0, 10), notes: '',
      paymentAmount: '', paymentMethod: 'Cash', transactionReference: '', paidDate: new Date().toISOString().slice(0, 10)
    },
    columns: ['studentSummary', 'courseBatch', 'totalAmount', 'paidAmount', 'balance', 'paymentType', 'installmentCount', 'status']
  },
  attendance: {
    title: 'Attendance Tracking',
    list: listAttendance,
    create: createAttendance,
    update: updateAttendance,
    remove: deleteAttendance,
    initial: { studentId: '', attendanceDate: new Date().toISOString().slice(0, 10), status: 'present', notes: '' },
    fields: ['studentId', 'attendanceDate', 'status', 'notes'],
    columns: ['student.name', 'attendanceDate', 'status', 'course.name', 'batch.name', 'notes']
  },
  certificates: {
    title: 'Certificate Management',
    list: listCertificates,
    create: createCertificate,
    update: updateCertificate,
    remove: deleteCertificate,
    initial: { studentId: '', issuedAt: '', status: 'draft', certificateUrl: '', notes: '' },
    fields: ['studentId', 'issuedAt', 'status', 'certificateUrl', 'notes'],
    columns: ['certificateNo', 'student.name', 'course.name', 'issuedAt', 'status', 'certificateUrl']
  }
};

function money(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number : 0;
}

function moneyText(value) {
  return new Intl.NumberFormat('en-LK', { style: 'currency', currency: 'LKR', minimumFractionDigits: 2 }).format(money(value));
}

function getValue(row, path) {
  if (path === 'studentSummary') return row.student?.name || '-';
  if (path === 'courseBatch') return row.course?.name || '-';
  if (path === 'currentCourses') return [...new Set((row.enrollments || []).filter((item) => item.enrollmentStatus === 'active').map((item) => item.course?.name).filter(Boolean))].join(', ') || '-';
  if (path === 'currentBatches') return [...new Set((row.enrollments || []).filter((item) => item.enrollmentStatus === 'active').map((item) => item.batch?.name).filter(Boolean))].join(', ') || '-';
  if (path === 'nextDueDate') {
    const next = [...(row.installments || [])].filter((item) => !['paid', 'cancelled'].includes(item.status)).sort((a, b) => String(a.dueDate).localeCompare(String(b.dueDate)))[0];
    return next?.dueDate || '-';
  }
  const value = path.split('.').reduce((acc, key) => (acc ? acc[key] : undefined), row);
  if (['originalAmount', 'discountAmount', 'totalAmount', 'paidAmount', 'balance', 'feeAmount'].includes(path)) return moneyText(value);
  return value ?? '-';
}

function normalizePayload(form) {
  const payload = {};
  Object.entries(form).forEach(([key, value]) => { if (!key.startsWith('_')) payload[key] = value === '' ? null : value; });
  return payload;
}

const optionData = (response) => response.data.data;
const loadStudentOptions = async (q, page, limit, filters) => optionData(await searchStudents(q, page, limit, filters));
const loadCourseOptions = async (q, page, limit, filters) => optionData(await searchCourses(q, page, limit, filters));
const loadBatchOptions = async (q, page, limit, filters) => optionData(await searchBatches(q, page, limit, filters));

function normalizeStudentEnrollments(enrollments = []) {
  return enrollments
    .filter((row) => row.courseId || row.course_id)
    .map((row) => {
      const feePlan = row.feePlan || row.fee_plan || row.paymentType || row.payment_type || 'full';
      const rawInstallments = row.installments ?? row.installmentCount ?? row.installment_count;
      const installmentCount = Number(rawInstallments);
      return {
        ...(row.id ? { id: row.id } : {}),
        courseId: row.courseId || row.course_id,
        batchId: row.batchId || row.batch_id || null,
        status: row.status || row.enrollmentStatus || row.enrollment_status || 'active',
        feePlan,
        installments: feePlan === 'installment' && Number.isFinite(installmentCount) && installmentCount >= 1
          ? Math.floor(installmentCount)
          : feePlan === 'installment' ? null : 1
      };
    });
}

function courseLabel(course) {
  return [course.code, course.name, course.category].filter(Boolean).join(' - ');
}

function batchLabel(batch) {
  return [batch.name, batch.course?.name, batch.schedule].filter(Boolean).join(' - ');
}

function safeInstallmentCount(value) {
  const count = Number(value);
  return Number.isFinite(count) && count >= 1 ? Math.floor(count) : 1;
}

function courseDefaultInstallments(courses, courseId) {
  const course = courses.find((item) => String(item.id) === String(courseId));
  return safeInstallmentCount(course?.defaultInstallmentCount);
}

function studentLabel(student) {
  return [student.studentNo || student.registration_no, student.name, student.phone || student.contact?.phone].filter(Boolean).join(' — ');
}

function contactName(contact) {
  return contact?.name
    || contact?.fullName
    || contact?.profileName
    || [contact?.firstName, contact?.lastName].filter(Boolean).join(' ')
    || '';
}

function lookupId(rows, value, courseId = null) {
  if (!value) return '';
  if (!rows.length && /^\d+$/.test(String(value))) return value;
  const direct = rows.find((item) => String(item.id) === String(value));
  if (direct) return direct.id;
  const normalized = String(value).trim().toLowerCase();
  return rows.find((item) => (
    (!courseId || String(item.courseId) === String(courseId)) &&
    [item.name, item.code].some((field) => String(field || '').trim().toLowerCase() === normalized)
  ))?.id || '';
}

function studentFormFromNavigation(initial, state, lookups) {
  const conversation = state?.selectedConversation || state?.conversation || {};
  const contact = state?.selectedContact || state?.contact || conversation.contact || {};
  const lead = state?.lead || conversation.lead || {};
  const conversationId = conversation.id || state?.conversationId;
  const leadSource = lead.source?.name || lead.source || state?.leadSource || '';
  const courseId = lookupId(lookups.courses, state?.courseId || lead.courseId || contact.courseId || lead.courseInterested);
  const batchId = lookupId(lookups.batches, state?.batchId || lead.batchId || contact.batchId || lead.batchInterested, courseId);
  const sourceNote = [
    conversationId ? `Converted from chat conversation #${conversationId}` : 'Converted from lead',
    lead.notes || '',
    leadSource ? `Lead source: ${leadSource}` : ''
  ].filter(Boolean).join('\n');

  return {
    ...initial,
    name: contactName(contact),
    phone: contact.phone || contact.phoneNumber || contact.whatsappNumber || contact.whatsappId || '',
    email: contact.email || '',
    contactId: contact.id || conversation.contactId || '',
    leadId: lead.id || conversation.leadId || '',
    courseId,
    batchId,
    leadSource,
    status: 'enrolled',
    enrollments: courseId ? [{ courseId, batchId: batchId || '', status: 'active', feePlan: 'full', installments: 1 }] : initial.enrollments,
    notes: sourceNote
  };
}

function discountPreview(form) {
  const original = money(form.originalAmount);
  const value = money(form.discountValue);
  if (form.paymentType === 'free_card') return { discountAmount: original, totalAmount: 0 };
  let discountAmount = 0;
  if (['fixed', 'promotional', 'special_approval', 'scholarship'].includes(form.discountType)) discountAmount = Math.min(value, original);
  if (form.discountType === 'percentage') discountAmount = Math.min(original * value / 100, original);
  return { discountAmount, totalAmount: Math.max(original - discountAmount, 0) };
}

function Field({ name, value, onChange, moduleKey, form, lookups }) {
  const label = name.replace(/([A-Z])/g, ' $1').replace(/^./, (char) => char.toUpperCase());
  const selectOptions = {
    status: ['active', 'inactive', 'archived', 'upcoming', 'completed', 'cancelled', 'enrolled', 'dropped', 'suspended', 'pending', 'partial', 'paid', 'free', 'overdue', 'present', 'absent', 'late', 'excused', 'draft', 'issued', 'revoked'],
    paymentType: paymentTypes
  };
  if (selectOptions[name]) {
    return <FormControl fullWidth><InputLabel>{label}</InputLabel><Select label={label} value={value || ''} onChange={(e) => onChange(name, e.target.value)}>{selectOptions[name].map((item) => <MenuItem key={item} value={item}>{item}</MenuItem>)}</Select></FormControl>;
  }
  if (name === 'leadSource') return <TextField label="Lead Source" value={value || ''} fullWidth disabled />;
  if (name === 'studentPortalPassword') return <TextField type="password" label="Student Portal Password" helperText="Leave blank to auto-generate a password; students can also use WhatsApp OTP." value={value || ''} onChange={(e) => onChange(name, e.target.value)} fullWidth />;
  if (name === 'courseId') {
    const selected = form._courseOption || lookups.courses.find((course) => String(course.id) === String(value));
    return <AsyncSearchSelect label="Course" value={value} selectedOption={selected} loadOptions={loadCourseOptions}
      filters={['batches', 'students'].includes(moduleKey) ? { status: 'active' } : {}}
      getOptionLabel={courseLabel} required={moduleKey === 'batches' || moduleKey === 'students'}
      placeholder="Search code, title or category" onChange={(option) => onChange(name, option?.id || '', option)} />;
  }
  if (name === 'batchId') {
    const courseId = String(form.courseId || '');
    const selected = form._batchOption || lookups.batches.find((batch) => String(batch.id) === String(value));
    return <AsyncSearchSelect label="Batch" value={value} selectedOption={selected} loadOptions={loadBatchOptions}
      filters={{ courseId }} disabled={!courseId} getOptionLabel={batchLabel} required={moduleKey === 'students'}
      placeholder="Search batch code or name" onChange={(option) => onChange(name, option?.id || '', option)} />;
  }
  if (name === 'studentId') {
    const selected = form._studentOption || lookups.students.find((student) => String(student.id) === String(value));
    return <AsyncSearchSelect label="Student" value={value} selectedOption={selected} loadOptions={loadStudentOptions}
      getOptionLabel={studentLabel} required placeholder="Search student number, name, phone or email"
      onChange={(option) => onChange(name, option?.id || '', option)} />;
  }
  const type = name.toLowerCase().includes('date') || name === 'issuedAt' ? 'date' : name.toLowerCase().includes('amount') || name.includes('Id') || name.includes('Weeks') || name.includes('Count') || name === 'capacity' ? 'number' : 'text';
  return <TextField label={label} type={type} value={value || ''} onChange={(e) => onChange(name, e.target.value)} multiline={name === 'notes' || name === 'description'} minRows={name === 'notes' || name === 'description' ? 3 : undefined} InputLabelProps={type === 'date' ? { shrink: true } : undefined} fullWidth />;
}

function StudentEnrollmentFields({ form, setForm, lookups }) {
  const enrollments = form.enrollments || [];
  const update = (index, changes) => setForm((current) => ({
    ...current,
    enrollments: (current.enrollments || []).map((item, itemIndex) => itemIndex === index ? { ...item, ...changes } : item)
  }));
  const updateCourse = (index, courseId, courseOption) => {
    const enrollment = enrollments[index] || {};
    const feePlan = enrollment.feePlan || enrollment.paymentType || 'full';
    update(index, {
      courseId,
      batchId: '',
      _courseOption: courseOption || null,
      _batchOption: null,
      ...(feePlan === 'installment' ? { installments: safeInstallmentCount(courseOption?.defaultInstallmentCount) } : {})
    });
  };
  const updateFeePlan = (index, feePlan) => {
    const enrollment = enrollments[index] || {};
    update(index, {
      feePlan,
      installments: feePlan === 'installment'
        ? courseDefaultInstallments(lookups.courses, enrollment.courseId)
        : 1
    });
  };
  const remove = (index) => setForm((current) => ({
    ...current,
    enrollments: (current.enrollments || []).filter((_, itemIndex) => itemIndex !== index)
  }));
  return <Grid item xs={12}>
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1.5 }}>
        <Box><Typography fontWeight={850}>Enrollments</Typography><Typography variant="body2" color="text.secondary">Add every course and batch this student belongs to.</Typography></Box>
        <Button startIcon={<AddIcon />} onClick={() => setForm((current) => ({ ...current, enrollments: [...(current.enrollments || []), { courseId: '', batchId: '', status: 'active', feePlan: 'full', installments: 1 }] }))}>Add Enrollment</Button>
      </Stack>
      <Stack spacing={1.5}>
        {enrollments.map((enrollment, index) => {
          const feePlan = enrollment.feePlan || enrollment.paymentType || 'full';
          return <Box key={enrollment.id || index} sx={{
            display: 'grid',
            gridTemplateColumns: {
              xs: '1fr',
              md: 'minmax(240px, 2fr) minmax(200px, 1.5fr) minmax(140px, 1fr) minmax(160px, 1fr) minmax(120px, 0.8fr) 40px'
            },
            gap: 1.5,
            alignItems: 'center',
            minWidth: 0
          }}>
            <AsyncSearchSelect label="Course" value={enrollment.courseId} selectedOption={enrollment._courseOption || enrollment.course}
              loadOptions={loadCourseOptions} filters={{ status: 'active' }} getOptionLabel={courseLabel} required
              placeholder="Search course" onChange={(option) => updateCourse(index, option?.id || '', option)} />
            <AsyncSearchSelect label="Batch (optional)" value={enrollment.batchId} selectedOption={enrollment._batchOption || enrollment.batch}
              loadOptions={loadBatchOptions} filters={{ courseId: enrollment.courseId }} getOptionLabel={batchLabel}
              disabled={!enrollment.courseId} placeholder="Search batch" onChange={(option) => update(index, { batchId: option?.id || '', _batchOption: option })} />
            <TextField select label="Status" value={enrollment.status || enrollment.enrollmentStatus || 'active'} onChange={(event) => update(index, { status: event.target.value })} sx={{ minWidth: { xs: '100%', md: 140 } }}>
              {['active', 'completed', 'suspended', 'cancelled', 'expired'].map((status) => <MenuItem key={status} value={status}>{status}</MenuItem>)}
            </TextField>
            <TextField select label="Fee plan" value={feePlan} onChange={(event) => updateFeePlan(index, event.target.value)} sx={{ minWidth: { xs: '100%', md: 150 } }}>
              {paymentTypes.map((type) => <MenuItem value={type} key={type}>{type.replaceAll('_', ' ')}</MenuItem>)}
            </TextField>
            {feePlan === 'installment'
              ? <TextField type="number" label="Installments" value={enrollment.installments || enrollment.installmentCount || 1} onChange={(event) => update(index, { installments: event.target.value })} inputProps={{ min: 1 }} sx={{ minWidth: 110 }} />
              : <TextField type="number" label="Installments" value={1} disabled sx={{ minWidth: 110 }} />}
            <IconButton color="error" onClick={() => remove(index)} disabled={enrollments.length === 1}><DeleteOutlineIcon /></IconButton>
          </Box>;
        })}
      </Stack>
    </Paper>
  </Grid>;
}

function FeeFields({ form, setForm, lookups, selectedStudent = null, lockStudent = false }) {
  const student = selectedStudent || form._studentOption || lookups.students.find((item) => String(item.id) === String(form.studentId));
  const activeEnrollments = (student?.enrollments || []).filter((item) => item.enrollmentStatus === 'active');
  const enrollment = activeEnrollments.find((item) => String(item.id) === String(form.enrollmentId))
    || activeEnrollments.find((item) => String(item.courseId) === String(form.courseId) && String(item.batchId || '') === String(form.batchId || ''))
    || activeEnrollments[0];
  const course = enrollment?.course || student?.course;
  const batch = enrollment?.batch || student?.batch;
  const totals = discountPreview(form);
  const set = (name, value, option = null) => setForm((current) => {
    const next = { ...current, [name]: value };
    if (name === 'studentId') {
      const selected = option || lookups.students.find((item) => String(item.id) === String(value));
      next._studentOption = selected || null;
      const selectedEnrollment = (selected?.enrollments || []).find((item) => item.enrollmentStatus === 'active');
      next.enrollmentId = selectedEnrollment?.id || '';
      next.courseId = selectedEnrollment?.courseId || '';
      next.batchId = selectedEnrollment?.batchId || '';
      next.originalAmount = selectedEnrollment?.course?.feeAmount ?? selected?.course?.feeAmount ?? '';
      next.installmentCount = selectedEnrollment?.course?.defaultInstallmentCount || selected?.course?.defaultInstallmentCount || 1;
    }
    if (name === 'enrollmentId') {
      const selectedEnrollment = activeEnrollments.find((item) => String(item.id) === String(value));
      next.courseId = selectedEnrollment?.courseId || '';
      next.batchId = selectedEnrollment?.batchId || '';
      next.originalAmount = selectedEnrollment?.course?.feeAmount ?? '';
      next.installmentCount = selectedEnrollment?.course?.defaultInstallmentCount || 1;
    }
    if (name === 'paymentType' && value === 'full') next.installmentCount = 1;
    if (name === 'paymentType' && value === 'free_card') {
      next.installmentCount = 1;
      next.discountType = 'scholarship';
      next.discountValue = next.originalAmount || 0;
    }
    return next;
  });

  return <Grid container spacing={2} sx={{ mt: 0.5 }}>
    <Grid item xs={12}>{lockStudent ? <TextField label="Student" value={student?.name || ''} fullWidth disabled /> : <Field name="studentId" value={form.studentId} onChange={set} moduleKey="fees" form={form} lookups={lookups} />}</Grid>
    <Grid item xs={12} md={6}><TextField label="Student Registration Number" value={student?.studentNo || student?.registration_no || student?.registrationNumber || student?.admissionNo || '-'} fullWidth disabled /></Grid>
    <Grid item xs={12} md={6}><TextField select label="Enrollment" value={enrollment?.id || ''} onChange={(e) => set('enrollmentId', e.target.value)} fullWidth disabled={!student}>
      {activeEnrollments.map((item) => <MenuItem key={item.id} value={item.id}>{item.course?.name || 'Course'}{item.batch?.name ? ` — ${item.batch.name}` : ''}</MenuItem>)}
    </TextField></Grid>
    <Grid item xs={12} md={6}><TextField label="Course" value={course ? courseLabel(course) : 'Select an enrollment'} fullWidth disabled /></Grid>
    <Grid item xs={12} md={6}><TextField label="Batch" value={batch ? batchLabel(batch) : 'Select a student'} fullWidth disabled /></Grid>
    <Grid item xs={12} md={6}><TextField label="Original Course Fee" type="number" value={form.originalAmount || ''} onChange={(e) => set('originalAmount', e.target.value)} fullWidth /></Grid>
    <Grid item xs={12} md={6}><FormControl fullWidth><InputLabel>Payment Type</InputLabel><Select label="Payment Type" value={form.paymentType || 'full'} onChange={(e) => set('paymentType', e.target.value)}>{paymentTypes.map((item) => <MenuItem key={item} value={item}>{item}</MenuItem>)}</Select></FormControl></Grid>
    <Grid item xs={12}><Divider><Typography variant="caption" color="text.secondary">Discount</Typography></Divider></Grid>
    <Grid item xs={12} md={6}><FormControl fullWidth><InputLabel>Discount Type</InputLabel><Select label="Discount Type" value={form.discountType || 'none'} onChange={(e) => set('discountType', e.target.value)}>{discountTypes.map((item) => <MenuItem key={item} value={item}>{item}</MenuItem>)}</Select></FormControl></Grid>
    <Grid item xs={12} md={6}><TextField label="Discount Value" type="number" value={form.discountValue || ''} onChange={(e) => set('discountValue', e.target.value)} fullWidth /></Grid>
    <Grid item xs={12} md={6}><TextField label="Discount Reason" value={form.discountReason || ''} onChange={(e) => set('discountReason', e.target.value)} fullWidth /></Grid>
    <Grid item xs={12} md={6}><TextField label="Approved By" value={form.approvedBy || ''} onChange={(e) => set('approvedBy', e.target.value)} fullWidth /></Grid>
    <Grid item xs={12} md={6}><TextField label="Calculated Discount Amount" value={moneyText(totals.discountAmount)} fullWidth disabled /></Grid>
    <Grid item xs={12} md={6}><TextField label="Final Payable Amount" value={moneyText(totals.totalAmount)} fullWidth disabled /></Grid>
    <Grid item xs={12} md={6}><TextField label="Installment Count" type="number" value={form.installmentCount || 1} onChange={(e) => set('installmentCount', e.target.value)} fullWidth disabled={form.paymentType !== 'installment'} /></Grid>
    <Grid item xs={12} md={6}><TextField label="Due Date" type="date" value={form.dueDate || ''} onChange={(e) => set('dueDate', e.target.value)} InputLabelProps={{ shrink: true }} fullWidth /></Grid>
    <Grid item xs={12}><Divider><Typography variant="caption" color="text.secondary">Payment</Typography></Divider></Grid>
    <Grid item xs={12} md={6}><TextField label="Payment Amount" type="number" value={form.paymentAmount || ''} onChange={(e) => set('paymentAmount', e.target.value)} fullWidth /></Grid>
    <Grid item xs={12} md={6}><FormControl fullWidth><InputLabel>Payment Method</InputLabel><Select label="Payment Method" value={form.paymentMethod || 'Cash'} onChange={(e) => set('paymentMethod', e.target.value)}>{paymentMethods.map((item) => <MenuItem key={item} value={item}>{item}</MenuItem>)}</Select></FormControl></Grid>
    <Grid item xs={12} md={6}><TextField label="Transaction Reference" value={form.transactionReference || ''} onChange={(e) => set('transactionReference', e.target.value)} fullWidth /></Grid>
    <Grid item xs={12} md={6}><TextField label="Paid Date" type="date" value={form.paidDate || ''} onChange={(e) => set('paidDate', e.target.value)} InputLabelProps={{ shrink: true }} fullWidth /></Grid>
    <Grid item xs={12}><TextField label="Notes" value={form.notes || ''} onChange={(e) => set('notes', e.target.value)} multiline minRows={3} fullWidth /></Grid>
  </Grid>;
}

function EducationModulePage({ moduleKey }) {
  const config = modules[moduleKey];
  const location = useLocation();
  const navigate = useNavigate();
  const consumedNavigationStateRef = useRef(false);
  const conversionFlowRef = useRef(false);
  const [rows, setRows] = useState([]);
  const [form, setForm] = useState(config.initial);
  const [editing, setEditing] = useState(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [lookups, setLookups] = useState({ courses: [], batches: [], students: [] });
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [installmentFee, setInstallmentFee] = useState(null);
  const [payTarget, setPayTarget] = useState(null);
  const [paymentForm, setPaymentForm] = useState({ amount: '', paymentMethod: 'Cash', transactionReference: '', paidDate: new Date().toISOString().slice(0, 10), notes: '' });
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [filters, setFilters] = useState({});
  const [page, setPage] = useState(1);
  const [resultMeta, setResultMeta] = useState({ total: 0, page: 1, limit: 20 });
  const filterKey = JSON.stringify(filters);
  const access = getAccessPayload();
  const canConfirmPayment = access.isSystemAdmin ||
    (access.roles || []).some((role) => ['admin', 'accountant', 'manager'].includes(String(role).toLowerCase())) ||
    hasAnyPermission(['fees.confirm_payment', 'accounting.confirm_income']);
  const canEditStudents = access.isSystemAdmin || access.permissions?.includes('students.edit');
  const canDelete = access.isSystemAdmin || hasAnyPermission([`${moduleKey}.delete`, 'education.delete']);

  const totals = useMemo(() => ({
    total: resultMeta.total || rows.length,
    active: rows.filter((row) => ['active', 'enrolled', 'present', 'issued', 'paid', 'free'].includes(row.status)).length,
    pending: rows.filter((row) => ['pending', 'partial', 'overdue', 'draft'].includes(row.status)).length
  }), [rows, resultMeta.total]);

  const load = async () => {
    try {
      setLoading(true);
      const serverPage = ['students', 'fees'].includes(moduleKey);
      const publicFilters = Object.fromEntries(Object.entries(filters).filter(([key]) => !key.startsWith('_')));
      const response = await config.list(serverPage ? { q: debouncedSearch, page, limit: 20, ...publicFilters } : {});
      const data = response.data.data || [];
      setRows(data.items || data);
      setResultMeta(data.items ? data : { total: data.length, page: 1, limit: data.length || 20 });
    } catch (err) {
      setError(err.response?.data?.message || `Unable to load ${config.title}.`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const timer = setTimeout(() => { setPage(1); setDebouncedSearch(search); }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => { load(); }, [moduleKey, debouncedSearch, page, filterKey]);

  useEffect(() => {
    const state = location.state || {};
    if (moduleKey !== 'students' || !state.openCreate || consumedNavigationStateRef.current) return;
    consumedNavigationStateRef.current = true;
    conversionFlowRef.current = true;
    setEditing(null);
    setForm(studentFormFromNavigation(config.initial, state, lookups));
    setDialogOpen(true);
    navigate(`${location.pathname}${location.search}`, { replace: true, state: null });
  }, [config.initial, location.pathname, location.search, location.state, lookups, moduleKey, navigate]);

  const openCreate = () => { setError(''); setEditing(null); setForm(config.initial); setDialogOpen(true); };
  const openEdit = (row) => {
    setEditing(row);
    const next = { ...config.initial };
    Object.keys(next).forEach((key) => { next[key] = row[key] ?? ''; });
    if (row.student) next._studentOption = row.student;
    if (row.course) next._courseOption = row.course;
    if (row.batch) next._batchOption = row.batch;
    setForm(next);
    setDialogOpen(true);
  };

  const save = async () => {
    let payload = normalizePayload(form);
    delete payload.leadSource;
    if (moduleKey === 'students') {
      payload.enrollments = normalizeStudentEnrollments(form.enrollments);
      if (payload.enrollments.length === 0) {
        setError('Please add at least one enrollment.');
        return;
      }
    }
    try {
      setSubmitting(true);
      setError('');
      if (moduleKey === 'batches' && !payload.courseId) return setError('Course is required when creating a batch.');
      if (moduleKey === 'courses' && Number(payload.defaultInstallmentCount || 1) < 1) return setError('Default installment count must be at least 1.');
      if (moduleKey === 'fees') {
        if (!payload.studentId) return setError('Student is required.');
        if (Number(payload.installmentCount || 1) < 1) return setError('Installment count must be at least 1.');
      }
      let response;
      if (editing) {
        response = await config.update(editing.id, payload);
      } else if (moduleKey === 'students' && payload.leadId) {
        response = await convertLeadToStudent(payload.leadId, payload);
      } else {
        response = await config.create(payload);
      }
      const result = response?.data?.data;
      if (moduleKey === 'students' && !editing && conversionFlowRef.current && result) {
        setDialogOpen(false);
        setSuccess(`Student ${result.studentNo || result.registration_no || ''} registered with enrollment and fee plan.${result.generatedPortalPassword ? ` Portal password: ${result.generatedPortalPassword} (shown once).` : ''}`);
        conversionFlowRef.current = false;
        await load();
        return;
      }
      const generatedPasswordNotice = result?.generatedPortalPassword
        ? ` Student portal password: ${result.generatedPortalPassword} (shown once)`
        : '';
      setSuccess(moduleKey === 'fees' && !editing ? (result?.message || 'Fee added.') : editing ? 'Record updated.' : `Record created.${generatedPasswordNotice}`);
      setDialogOpen(false);
      await load();
    } catch (err) {
      setError(err.response?.data?.message || 'Unable to save record.');
    } finally {
      setSubmitting(false);
    }
  };

  const remove = async (row) => {
    if (!window.confirm('Delete this record?')) return;
    await config.remove(row.id);
    setSuccess('Record deleted.');
    await load();
  };

  const resetPortalPassword = async (row) => {
    const password = window.prompt('Enter a new student portal password, or leave blank to auto-generate one:');
    if (password === null) return;
    try {
      const response = await resetStudentPortalPassword(row.id, password.trim());
      const generated = response.data.data.generatedPassword;
      setSuccess(generated
        ? `New portal password for ${row.studentNo}: ${generated} (shown once)`
        : `Portal password reset for ${row.studentNo}.`);
    } catch (err) {
      setError(err.response?.data?.message || 'Unable to reset student portal password.');
    }
  };

  const openPay = (installment) => {
    const remaining = Math.max(money(installment.amount) - money(installment.paidAmount), 0);
    setPayTarget(installment);
    setPaymentForm({ amount: remaining, paymentMethod: 'Cash', transactionReference: '', paidDate: new Date().toISOString().slice(0, 10), notes: '' });
  };

  const submitPay = async () => {
    try {
      const response = await payInstallment(payTarget.id, paymentForm);
      setSuccess('Payment added. Waiting for confirmation.');
      setPayTarget(null);
      setInstallmentFee(response.data.data.fee);
      await load();
    } catch (err) {
      setError(err.response?.data?.message || 'Unable to pay installment.');
    }
  };

  const confirmPayment = async (installment) => {
    try {
      const response = await confirmInstallmentPayment(installment.id);
      setInstallmentFee(response.data.data.fee);
      setSuccess('Payment confirmed and income recorded.');
      await load();
    } catch (err) {
      setError(err.response?.data?.message || 'Unable to confirm payment.');
    }
  };

  const rejectPayment = async (installment) => {
    const reason = window.prompt('Reason for rejecting this payment (optional):') || '';
    try {
      const response = await rejectInstallmentPayment(installment.id, { reason });
      setInstallmentFee(response.data.data.fee);
      setSuccess('Payment rejected. No income was recorded.');
      await load();
    } catch (err) {
      setError(err.response?.data?.message || 'Unable to reject payment.');
    }
  };

  const reversePayment = async (installment) => {
    const reason = window.prompt('Reason for reversing this confirmed payment:');
    if (reason === null) return;
    try {
      const response = await reverseInstallmentPayment(installment.id, { reason });
      setInstallmentFee(response.data.data.fee);
      setSuccess('Payment reversed and a compensating accounting transaction was recorded.');
      await load();
    } catch (err) {
      setError(err.response?.data?.message || 'Unable to reverse payment.');
    }
  };

  const remind = async (installment) => {
    const response = await sendFeeReminder(installment.id);
    setSuccess(`Reminder ${response.data.data.notification.mode}: ${response.data.data.notification.to}`);
  };

  const openReceipt = async (receipt) => {
    try {
      const response = await downloadReceipt(receipt.id);
      saveBlob(response.data, `${receipt.receiptNumber}.pdf`);
    } catch (err) {
      setError(err.response?.data?.message || 'Receipt PDF is not ready.');
    }
  };

  return <Stack spacing={2.5}>
    {error && <Alert severity="error" onClose={() => setError('')}>{error}</Alert>}
    {success && <Alert severity="success" onClose={() => setSuccess('')}>{success}</Alert>}

    <Grid container spacing={2}>{Object.entries(totals).map(([key, value]) => <Grid item xs={12} md={4} key={key}><Paper sx={{ p: 2.5, border: '1px solid #e8edf2' }} elevation={0}><Typography variant="h4" fontWeight={850}>{value}</Typography><Typography color="text.secondary">{key}</Typography></Paper></Grid>)}</Grid>

    <Paper sx={{ p: 2.5, border: '1px solid #e8edf2' }} elevation={0}>
      <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} alignItems={{ md: 'center' }}>
        <Box sx={{ flex: 1 }}><Typography variant="h5" fontWeight={850}>{config.title}</Typography><Typography color="text.secondary">Education CRM records linked with contacts, leads, courses, and batches.</Typography></Box>
        <Button variant="contained" startIcon={<AddIcon />} onClick={openCreate} sx={{ bgcolor: '#128c7e' }}>Add Record</Button>
      </Stack>
    </Paper>

    {['students', 'fees'].includes(moduleKey) && <Paper sx={{ p: 2, border: '1px solid #e8edf2' }} elevation={0}>
      <Stack spacing={1.5}>
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'minmax(260px,2fr) repeat(3,minmax(170px,1fr))' }, gap: 1.5 }}>
          <TextField label={moduleKey === 'fees' ? 'Search student, course, batch or status' : 'Search student number, name, phone, course or batch'} value={search} onChange={(event) => setSearch(event.target.value)} />
          <AsyncSearchSelect label="Course filter" value={filters.courseId || ''} selectedOption={filters._courseOption} loadOptions={loadCourseOptions} getOptionLabel={courseLabel}
            onChange={(option) => { setPage(1); setFilters((current) => ({ ...current, courseId: option?.id || '', batchId: '', _courseOption: option, _batchOption: null })); }} />
          <AsyncSearchSelect label="Batch filter" value={filters.batchId || ''} selectedOption={filters._batchOption} loadOptions={loadBatchOptions} filters={{ courseId: filters.courseId }} getOptionLabel={batchLabel}
            onChange={(option) => { setPage(1); setFilters((current) => ({ ...current, batchId: option?.id || '', _batchOption: option })); }} />
          <TextField select label="Status" value={filters.status || ''} onChange={(event) => { setPage(1); setFilters((current) => ({ ...current, status: event.target.value })); }}>
            <MenuItem value="">All statuses</MenuItem>
            {(moduleKey === 'fees' ? ['pending', 'partial', 'paid', 'free', 'overdue', 'cancelled'] : ['enrolled', 'active', 'completed', 'dropped', 'suspended']).map((item) => <MenuItem key={item} value={item}>{item}</MenuItem>)}
          </TextField>
        </Box>
        {moduleKey === 'fees' && <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr 1fr', md: 'repeat(5,minmax(150px,1fr))' }, gap: 1.5 }}>
          <TextField select label="Payment type" value={filters.paymentType || ''} onChange={(event) => setFilters((current) => ({ ...current, paymentType: event.target.value }))}><MenuItem value="">All types</MenuItem>{paymentTypes.map((item) => <MenuItem key={item} value={item}>{item.replaceAll('_', ' ')}</MenuItem>)}</TextField>
          <TextField select label="Payment state" value={filters.paymentState || ''} onChange={(event) => setFilters((current) => ({ ...current, paymentState: event.target.value }))}><MenuItem value="">Any balance</MenuItem>{['outstanding', 'fully_paid', 'partial', 'unpaid', 'overdue'].map((item) => <MenuItem key={item} value={item}>{item.replaceAll('_', ' ')}</MenuItem>)}</TextField>
          <TextField type="date" label="From" value={filters.dateFrom || ''} InputLabelProps={{ shrink: true }} onChange={(event) => setFilters((current) => ({ ...current, dateFrom: event.target.value }))} />
          <TextField type="date" label="To" value={filters.dateTo || ''} InputLabelProps={{ shrink: true }} onChange={(event) => setFilters((current) => ({ ...current, dateTo: event.target.value }))} />
          <TextField select label="Sort" value={filters.sort || 'newest'} onChange={(event) => setFilters((current) => ({ ...current, sort: event.target.value }))}>{['newest', 'oldest', 'balance_desc', 'balance_asc', 'student'].map((item) => <MenuItem key={item} value={item}>{item.replaceAll('_', ' ')}</MenuItem>)}</TextField>
        </Box>}
        {moduleKey === 'students' && <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
          <TextField select fullWidth label="Enrollment status" value={filters.enrollmentStatus || ''} onChange={(event) => setFilters((current) => ({ ...current, enrollmentStatus: event.target.value }))}><MenuItem value="">All enrollments</MenuItem>{['active', 'completed', 'suspended', 'cancelled', 'expired'].map((item) => <MenuItem key={item} value={item}>{item}</MenuItem>)}</TextField>
          <TextField select fullWidth label="Payment status" value={filters.paymentStatus || ''} onChange={(event) => setFilters((current) => ({ ...current, paymentStatus: event.target.value }))}><MenuItem value="">All payment statuses</MenuItem>{['pending', 'partial', 'paid', 'free', 'overdue', 'cancelled'].map((item) => <MenuItem key={item} value={item}>{item}</MenuItem>)}</TextField>
        </Stack>}
        <Stack direction="row" justifyContent="space-between" alignItems="center"><Typography color="text.secondary">{resultMeta.total} results</Typography><Button onClick={() => { setSearch(''); setFilters({}); setPage(1); }}>Clear filters</Button></Stack>
      </Stack>
    </Paper>}

    <Paper sx={{ border: '1px solid #e8edf2', overflow: 'hidden' }} elevation={0}>
      {loading && <LinearProgress />}
      <TableContainer sx={{ display: { xs: moduleKey === 'fees' ? 'none' : 'block', md: 'block' } }}><Table size={moduleKey === 'fees' ? 'small' : 'medium'}><TableHead><TableRow>{config.columns.map((column) => <TableCell key={column}>{column.replaceAll(/([A-Z])/g, ' $1').replaceAll('.', ' / ')}</TableCell>)}<TableCell align="right" sx={{ position: 'sticky', right: 0, bgcolor: 'background.paper', zIndex: 2 }}>Actions</TableCell></TableRow></TableHead><TableBody>
        {rows.map((row) => <TableRow hover key={row.id}>{config.columns.map((column) => <TableCell key={column}>{column === 'status' ? <Chip size="small" label={getValue(row, column)} /> : column === 'studentSummary' ? <Box><Typography variant="body2" fontWeight={750}>{row.student?.name || '-'}</Typography><Typography variant="caption" color="text.secondary">{row.student?.studentNo || '-'}</Typography></Box> : column === 'courseBatch' ? <Box><Typography variant="body2">{row.course?.name || '-'}</Typography><Typography variant="caption" color="text.secondary">{row.batch?.name || 'All batches'}</Typography></Box> : getValue(row, column)}</TableCell>)}<TableCell align="right" sx={{ position: 'sticky', right: 0, bgcolor: 'background.paper', zIndex: 1 }}><Stack direction="row" spacing={0.25} justifyContent="flex-end">{moduleKey === 'students' && <><Tooltip title="View"><IconButton component={RouterLink} to={`/students/${row.id}`}><VisibilityIcon /></IconButton></Tooltip>{canEditStudents && <Tooltip title="Reset portal password"><IconButton onClick={() => resetPortalPassword(row)}><LockResetIcon /></IconButton></Tooltip>}</>}{moduleKey === 'fees' && <><Tooltip title="View installments"><IconButton onClick={() => setInstallmentFee(row)}><VisibilityIcon /></IconButton></Tooltip><Tooltip title="Record payment"><span><IconButton onClick={() => openPay((row.installments || []).find((item) => !['paid', 'cancelled', 'pending_confirmation'].includes(item.status)))} disabled={!(row.installments || []).some((item) => !['paid', 'cancelled', 'pending_confirmation'].includes(item.status))}><PaymentsIcon /></IconButton></span></Tooltip>{(row.installments || []).flatMap((item) => item.receipts || []).find((item) => item.status === 'ACTIVE') && <Tooltip title="Receipt"><IconButton onClick={() => openReceipt((row.installments || []).flatMap((item) => item.receipts || []).find((item) => item.status === 'ACTIVE'))}><ReceiptLongIcon /></IconButton></Tooltip>}</>}<Tooltip title="Edit"><IconButton onClick={() => openEdit(row)}><EditIcon /></IconButton></Tooltip>{canDelete && <Tooltip title="Delete"><IconButton color="error" onClick={() => remove(row)}><DeleteOutlineIcon /></IconButton></Tooltip>}</Stack></TableCell></TableRow>)}
        {!loading && rows.length === 0 && <TableRow><TableCell colSpan={config.columns.length + 1}><Box sx={{ py: 5, textAlign: 'center' }}><Typography fontWeight={800}>No records found</Typography><Typography color="text.secondary">Create the first record for this module.</Typography></Box></TableCell></TableRow>}
      </TableBody></Table></TableContainer>
      {moduleKey === 'fees' && <Stack sx={{ display: { xs: 'flex', md: 'none' }, p: 1.5 }} spacing={1.5}>{rows.map((row) => <Paper variant="outlined" key={row.id} sx={{ p: 2 }}><Typography fontWeight={850}>{row.student?.name}</Typography><Typography variant="caption" color="text.secondary">{row.student?.studentNo} · {row.course?.name} · {row.batch?.name || 'All batches'}</Typography><Stack direction="row" justifyContent="space-between" sx={{ my: 1.5 }}><Box><Typography variant="caption">Balance</Typography><Typography fontWeight={800}>{moneyText(row.balance)}</Typography></Box><Chip size="small" label={row.status} /></Stack><Stack direction="row"><Button size="small" onClick={() => setInstallmentFee(row)}>View</Button><Button size="small" onClick={() => openEdit(row)}>Edit</Button>{canDelete && <Button size="small" color="error" onClick={() => remove(row)}>Delete</Button>}</Stack></Paper>)}</Stack>}
      {['students', 'fees'].includes(moduleKey) && resultMeta.total > resultMeta.limit && <Box sx={{ display: 'flex', justifyContent: 'center', p: 2 }}><Pagination page={page} count={Math.ceil(resultMeta.total / resultMeta.limit)} onChange={(_, next) => setPage(next)} /></Box>}
    </Paper>

    <Dialog
      open={dialogOpen}
      onClose={() => { if (!submitting) setDialogOpen(false); }}
      maxWidth={false}
      fullWidth
      PaperProps={{ sx: { width: { xs: '95vw', md: 'min(1100px, 95vw)' }, maxWidth: '95vw', maxHeight: '92vh' } }}
    >
      <DialogTitle>{editing ? 'Edit Record' : 'Add Record'}</DialogTitle>
      <DialogContent dividers sx={{ overflowY: 'auto' }}>{error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}{moduleKey === 'fees' ? <FeeFields form={form} setForm={setForm} lookups={lookups} /> : <Grid container spacing={2} sx={{ mt: 0.5 }}>{config.fields.map((field) => <Grid item xs={12} md={field === 'description' || field === 'notes' ? 12 : 6} key={field}><Field name={field} value={form[field]} moduleKey={moduleKey} form={form} lookups={lookups} onChange={(name, value, option) => setForm((current) => ({ ...current, [name]: value, ...(name === 'courseId' ? { batchId: '', _courseOption: option, _batchOption: null } : {}), ...(name === 'batchId' ? { _batchOption: option } : {}), ...(name === 'studentId' ? { _studentOption: option } : {}) }))} /></Grid>)}{moduleKey === 'students' && <StudentEnrollmentFields form={form} setForm={setForm} lookups={lookups} />}</Grid>}</DialogContent>
      <DialogActions><Button onClick={() => setDialogOpen(false)} disabled={submitting}>Cancel</Button><Button variant="contained" onClick={save} disabled={submitting}>{submitting ? 'Saving…' : 'Save'}</Button></DialogActions>
    </Dialog>

    <Dialog open={!!installmentFee} onClose={() => setInstallmentFee(null)} maxWidth="lg" fullWidth>
      <DialogTitle>View Installments</DialogTitle>
      <DialogContent>
        {!canConfirmPayment && (installmentFee?.installments || []).some((item) => item.status === 'pending_confirmation') && <Alert severity="info" sx={{ mb: 2 }}>Payment added. Waiting for confirmation by Accounting or an administrator.</Alert>}
        <TableContainer><Table size="small"><TableHead><TableRow>{['Installment No', 'Amount', 'Due Date', 'Paid Amount', 'Pending Amount', 'Paid Date', 'Payment Method', 'Status', 'Action'].map((label) => <TableCell key={label}>{label}</TableCell>)}</TableRow></TableHead><TableBody>{(installmentFee?.installments || []).map((item) => { const receipt = (item.receipts || []).find((row) => row.status === 'ACTIVE') || item.receipts?.[0]; return <TableRow key={item.id}><TableCell>{item.installmentNo}</TableCell><TableCell>{moneyText(item.amount)}</TableCell><TableCell>{item.dueDate}</TableCell><TableCell>{moneyText(item.paidAmount)}</TableCell><TableCell>{item.pendingPaymentAmount ? moneyText(item.pendingPaymentAmount) : '-'}</TableCell><TableCell>{item.paidDate || '-'}</TableCell><TableCell>{item.paymentMethod || '-'}</TableCell><TableCell><Chip size="small" color={item.status === 'confirmed' ? 'success' : item.status === 'rejected' || item.status === 'reversed' ? 'error' : item.status === 'pending_confirmation' ? 'warning' : 'default'} label={String(item.status).replaceAll('_', ' ')} /></TableCell><TableCell><Stack direction="row" spacing={0.5} alignItems="center"><IconButton title="Add payment" size="small" onClick={() => openPay(item)} disabled={['paid', 'pending_confirmation'].includes(item.status) || Number(item.paidAmount) >= Number(item.amount)}><PaymentsIcon /></IconButton><IconButton title="Send reminder" size="small" onClick={() => remind(item)}><NotificationsActiveIcon /></IconButton>{receipt && <IconButton title="Download receipt" size="small" onClick={() => openReceipt(receipt)}><ReceiptLongIcon /></IconButton>}{canConfirmPayment && item.status === 'pending_confirmation' && <><Button size="small" variant="contained" color="success" onClick={() => confirmPayment(item)}>Confirm Payment</Button><Button size="small" variant="outlined" color="error" onClick={() => rejectPayment(item)}>Reject Payment</Button></>}{canConfirmPayment && item.status === 'confirmed' && <Button size="small" variant="outlined" color="warning" onClick={() => reversePayment(item)}>Reverse</Button>}</Stack></TableCell></TableRow>; })}{(!installmentFee?.installments || installmentFee.installments.length === 0) && <TableRow><TableCell colSpan={9}>No installments for this fee plan.</TableCell></TableRow>}</TableBody></Table></TableContainer>
      </DialogContent>
      <DialogActions><Button onClick={() => setInstallmentFee(null)}>Close</Button></DialogActions>
    </Dialog>

    <Dialog open={!!payTarget} onClose={() => setPayTarget(null)} maxWidth="sm" fullWidth>
      <DialogTitle>Pay Installment {payTarget?.installmentNo}</DialogTitle>
      <DialogContent><Grid container spacing={2} sx={{ mt: 0.5 }}><Grid item xs={12} md={6}><TextField label="Amount Paying" type="number" value={paymentForm.amount} onChange={(e) => setPaymentForm((current) => ({ ...current, amount: e.target.value }))} fullWidth /></Grid><Grid item xs={12} md={6}><FormControl fullWidth><InputLabel>Payment Method</InputLabel><Select label="Payment Method" value={paymentForm.paymentMethod} onChange={(e) => setPaymentForm((current) => ({ ...current, paymentMethod: e.target.value }))}>{paymentMethods.map((item) => <MenuItem key={item} value={item}>{item}</MenuItem>)}</Select></FormControl></Grid><Grid item xs={12} md={6}><TextField label="Reference" value={paymentForm.transactionReference} onChange={(e) => setPaymentForm((current) => ({ ...current, transactionReference: e.target.value }))} fullWidth /></Grid><Grid item xs={12} md={6}><TextField label="Paid Date" type="date" value={paymentForm.paidDate} onChange={(e) => setPaymentForm((current) => ({ ...current, paidDate: e.target.value }))} InputLabelProps={{ shrink: true }} fullWidth /></Grid><Grid item xs={12}><TextField label="Notes" value={paymentForm.notes} onChange={(e) => setPaymentForm((current) => ({ ...current, notes: e.target.value }))} multiline minRows={3} fullWidth /></Grid></Grid></DialogContent>
      <DialogActions><Button onClick={() => setPayTarget(null)}>Cancel</Button><Button variant="contained" onClick={submitPay}>Pay</Button></DialogActions>
    </Dialog>
  </Stack>;
}

export const CoursesPage = () => <EducationModulePage moduleKey="courses" />;
export const BatchesPage = () => <EducationModulePage moduleKey="batches" />;
export const StudentsPage = () => <EducationModulePage moduleKey="students" />;
export const FeesPage = () => <EducationModulePage moduleKey="fees" />;
export const AttendancePage = () => <EducationModulePage moduleKey="attendance" />;
export const CertificatesPage = () => <EducationModulePage moduleKey="certificates" />;
