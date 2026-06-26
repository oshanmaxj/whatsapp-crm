import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert, Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, Divider, FormControl, Grid,
  IconButton, InputLabel, LinearProgress, MenuItem, Paper, Select, Stack, Table, TableBody, TableCell,
  TableContainer, TableHead, TableRow, TextField, Typography
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import EditIcon from '@mui/icons-material/Edit';
import NotificationsActiveIcon from '@mui/icons-material/NotificationsActive';
import PaymentsIcon from '@mui/icons-material/Payments';
import VisibilityIcon from '@mui/icons-material/Visibility';
import {
  createAttendance, createBatch, createCertificate, createCourse, createFee, createStudent, deleteAttendance,
  deleteBatch, deleteCertificate, deleteCourse, deleteFee, deleteStudent, listAttendance, listBatches,
  listCertificates, listCourses, listFees, listStudents, payInstallment, sendFeeReminder, updateAttendance,
  updateBatch, updateCertificate, updateCourse, updateFee, updateStudent
} from '../services/education.service';

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
    initial: { name: '', code: '', category: '', feeAmount: '', defaultInstallmentCount: 1, durationWeeks: '', status: 'active', description: '' },
    fields: ['code', 'name', 'category', 'feeAmount', 'defaultInstallmentCount', 'durationWeeks', 'status', 'description'],
    columns: ['code', 'name', 'category', 'feeAmount', 'defaultInstallmentCount', 'durationWeeks', 'status']
  },
  batches: {
    title: 'Batch Management',
    list: listBatches,
    create: createBatch,
    update: updateBatch,
    remove: deleteBatch,
    initial: { courseId: '', name: '', code: '', startDate: '', endDate: '', schedule: '', capacity: '', status: 'upcoming' },
    fields: ['courseId', 'name', 'code', 'startDate', 'endDate', 'schedule', 'capacity', 'status'],
    columns: ['name', 'code', 'course.code', 'course.name', 'startDate', 'schedule', 'status']
  },
  students: {
    title: 'Student Management',
    list: listStudents,
    create: createStudent,
    update: updateStudent,
    remove: deleteStudent,
    initial: { name: '', phone: '', email: '', courseId: '', batchId: '', status: 'enrolled', notes: '' },
    fields: ['name', 'phone', 'email', 'courseId', 'batchId', 'status', 'notes'],
    columns: ['studentNo', 'name', 'phone', 'course.name', 'batch.name', 'status']
  },
  fees: {
    title: 'Fee & Installment Tracking',
    list: listFees,
    create: createFee,
    update: updateFee,
    remove: deleteFee,
    initial: {
      studentId: '', originalAmount: '', discountType: 'none', discountValue: '', discountReason: '', approvedBy: '',
      paymentType: 'full', installmentCount: 1, dueDate: new Date().toISOString().slice(0, 10), notes: ''
    },
    columns: ['student.name', 'course.name', 'batch.name', 'originalAmount', 'discountAmount', 'totalAmount', 'paidAmount', 'balance', 'paymentType', 'installmentCount', 'nextDueDate', 'status']
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
  return money(value).toFixed(2);
}

function getValue(row, path) {
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
  Object.entries(form).forEach(([key, value]) => { payload[key] = value === '' ? null : value; });
  return payload;
}

function courseLabel(course) {
  return [course.code, course.name, course.category].filter(Boolean).join(' - ');
}

function batchLabel(batch) {
  return [batch.name, batch.course?.name, batch.schedule].filter(Boolean).join(' - ');
}

function studentLabel(student) {
  return [student.studentNo, student.name, student.course?.name, student.batch?.name].filter(Boolean).join(' - ');
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
  if (name === 'courseId') {
    const activeCourses = lookups.courses.filter((course) => !['batches', 'students'].includes(moduleKey) || course.status === 'active');
    return <FormControl fullWidth required={moduleKey === 'batches' || moduleKey === 'students'}><InputLabel>Course</InputLabel><Select label="Course" value={value || ''} onChange={(e) => onChange(name, e.target.value)}>{activeCourses.map((course) => <MenuItem key={course.id} value={course.id}>{courseLabel(course)}</MenuItem>)}{activeCourses.length === 0 && <MenuItem disabled>No active courses available</MenuItem>}</Select></FormControl>;
  }
  if (name === 'batchId') {
    const courseId = String(form.courseId || '');
    const batches = lookups.batches.filter((batch) => String(batch.courseId) === courseId);
    return <FormControl fullWidth disabled={!courseId || batches.length === 0} required={moduleKey === 'students'}><InputLabel>Batch</InputLabel><Select label="Batch" value={value || ''} onChange={(e) => onChange(name, e.target.value)}>{batches.map((batch) => <MenuItem key={batch.id} value={batch.id}>{batchLabel(batch)}</MenuItem>)}{!courseId && <MenuItem disabled>Select a course first</MenuItem>}{courseId && batches.length === 0 && <MenuItem disabled>No batches available for this course</MenuItem>}</Select></FormControl>;
  }
  if (name === 'studentId') {
    return <FormControl fullWidth required><InputLabel>Student</InputLabel><Select label="Student" value={value || ''} onChange={(e) => onChange(name, e.target.value)}>{lookups.students.map((student) => <MenuItem key={student.id} value={student.id}>{studentLabel(student)}</MenuItem>)}{lookups.students.length === 0 && <MenuItem disabled>No students available</MenuItem>}</Select></FormControl>;
  }
  const type = name.toLowerCase().includes('date') || name === 'issuedAt' ? 'date' : name.toLowerCase().includes('amount') || name.includes('Id') || name.includes('Weeks') || name.includes('Count') || name === 'capacity' ? 'number' : 'text';
  return <TextField label={label} type={type} value={value || ''} onChange={(e) => onChange(name, e.target.value)} multiline={name === 'notes' || name === 'description'} minRows={name === 'notes' || name === 'description' ? 3 : undefined} InputLabelProps={type === 'date' ? { shrink: true } : undefined} fullWidth />;
}

function FeeFields({ form, setForm, lookups }) {
  const student = lookups.students.find((item) => String(item.id) === String(form.studentId));
  const course = student?.course;
  const batch = student?.batch;
  const totals = discountPreview(form);
  const set = (name, value) => setForm((current) => {
    const next = { ...current, [name]: value };
    if (name === 'studentId') {
      const selected = lookups.students.find((item) => String(item.id) === String(value));
      next.originalAmount = selected?.course?.feeAmount ?? '';
      next.installmentCount = selected?.course?.defaultInstallmentCount || 1;
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
    <Grid item xs={12}><Field name="studentId" value={form.studentId} onChange={set} moduleKey="fees" form={form} lookups={lookups} /></Grid>
    <Grid item xs={12} md={6}><TextField label="Course" value={course ? courseLabel(course) : 'Select a student'} fullWidth disabled /></Grid>
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
    <Grid item xs={12}><TextField label="Notes" value={form.notes || ''} onChange={(e) => set('notes', e.target.value)} multiline minRows={3} fullWidth /></Grid>
  </Grid>;
}

function EducationModulePage({ moduleKey }) {
  const config = modules[moduleKey];
  const [rows, setRows] = useState([]);
  const [form, setForm] = useState(config.initial);
  const [editing, setEditing] = useState(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [lookups, setLookups] = useState({ courses: [], batches: [], students: [] });
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [installmentFee, setInstallmentFee] = useState(null);
  const [payTarget, setPayTarget] = useState(null);
  const [paymentForm, setPaymentForm] = useState({ amount: '', paymentMethod: 'Cash', transactionReference: '', paidDate: new Date().toISOString().slice(0, 10), notes: '' });

  const totals = useMemo(() => ({
    total: rows.length,
    active: rows.filter((row) => ['active', 'enrolled', 'present', 'issued', 'paid', 'free'].includes(row.status)).length,
    pending: rows.filter((row) => ['pending', 'partial', 'overdue', 'draft'].includes(row.status)).length
  }), [rows]);

  const load = async () => {
    try {
      setLoading(true);
      const [response, coursesRes, batchesRes, studentsRes] = await Promise.all([
        config.list(),
        ['batches', 'students', 'fees', 'attendance', 'certificates'].includes(moduleKey) ? listCourses() : Promise.resolve({ data: { data: [] } }),
        ['students', 'fees', 'attendance', 'certificates'].includes(moduleKey) ? listBatches() : Promise.resolve({ data: { data: [] } }),
        ['fees', 'attendance', 'certificates'].includes(moduleKey) ? listStudents() : Promise.resolve({ data: { data: [] } })
      ]);
      setRows(response.data.data || []);
      setLookups({ courses: coursesRes.data.data || [], batches: batchesRes.data.data || [], students: studentsRes.data.data || [] });
    } catch (err) {
      setError(err.response?.data?.message || `Unable to load ${config.title}.`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [moduleKey]);

  const openCreate = () => { setEditing(null); setForm(config.initial); setDialogOpen(true); };
  const openEdit = (row) => {
    setEditing(row);
    const next = { ...config.initial };
    Object.keys(next).forEach((key) => { next[key] = row[key] ?? ''; });
    setForm(next);
    setDialogOpen(true);
  };

  const save = async () => {
    try {
      const payload = normalizePayload(form);
      if (moduleKey === 'batches' && !payload.courseId) return setError('Course is required when creating a batch.');
      if (moduleKey === 'students' && !payload.courseId) return setError('Course is required when creating a student.');
      if (moduleKey === 'students' && !payload.batchId) return setError('Batch is required when creating a student.');
      if (moduleKey === 'courses' && Number(payload.defaultInstallmentCount || 1) < 1) return setError('Default installment count must be at least 1.');
      if (moduleKey === 'fees') {
        if (!payload.studentId) return setError('Student is required.');
        if (Number(payload.installmentCount || 1) < 1) return setError('Installment count must be at least 1.');
      }
      if (editing) await config.update(editing.id, payload); else await config.create(payload);
      setSuccess(editing ? 'Record updated.' : 'Record created.');
      setDialogOpen(false);
      await load();
    } catch (err) {
      setError(err.response?.data?.message || 'Unable to save record.');
    }
  };

  const remove = async (row) => {
    if (!window.confirm('Delete this record?')) return;
    await config.remove(row.id);
    setSuccess('Record deleted.');
    await load();
  };

  const openPay = (installment) => {
    const remaining = Math.max(money(installment.amount) - money(installment.paidAmount), 0);
    setPayTarget(installment);
    setPaymentForm({ amount: remaining, paymentMethod: 'Cash', transactionReference: '', paidDate: new Date().toISOString().slice(0, 10), notes: '' });
  };

  const submitPay = async () => {
    try {
      await payInstallment(payTarget.id, paymentForm);
      setSuccess('Installment payment recorded.');
      setPayTarget(null);
      setInstallmentFee(null);
      await load();
    } catch (err) {
      setError(err.response?.data?.message || 'Unable to pay installment.');
    }
  };

  const remind = async (installment) => {
    const response = await sendFeeReminder(installment.id);
    setSuccess(`Reminder ${response.data.data.notification.mode}: ${response.data.data.notification.to}`);
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

    <Paper sx={{ border: '1px solid #e8edf2', overflow: 'hidden' }} elevation={0}>
      {loading && <LinearProgress />}
      <TableContainer><Table><TableHead><TableRow>{config.columns.map((column) => <TableCell key={column}>{column}</TableCell>)}<TableCell align="right">Actions</TableCell></TableRow></TableHead><TableBody>
        {rows.map((row) => <TableRow hover key={row.id}>{config.columns.map((column) => <TableCell key={column}>{column === 'status' ? <Chip size="small" label={getValue(row, column)} /> : getValue(row, column)}</TableCell>)}<TableCell align="right"><Stack direction="row" spacing={0.5} justifyContent="flex-end">{moduleKey === 'fees' && <IconButton onClick={() => setInstallmentFee(row)}><VisibilityIcon /></IconButton>}<IconButton onClick={() => openEdit(row)}><EditIcon /></IconButton><IconButton color="error" onClick={() => remove(row)}><DeleteOutlineIcon /></IconButton></Stack></TableCell></TableRow>)}
        {!loading && rows.length === 0 && <TableRow><TableCell colSpan={config.columns.length + 1}><Box sx={{ py: 5, textAlign: 'center' }}><Typography fontWeight={800}>No records found</Typography><Typography color="text.secondary">Create the first record for this module.</Typography></Box></TableCell></TableRow>}
      </TableBody></Table></TableContainer>
    </Paper>

    <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} maxWidth="md" fullWidth>
      <DialogTitle>{editing ? 'Edit Record' : 'Add Record'}</DialogTitle>
      <DialogContent>{moduleKey === 'fees' ? <FeeFields form={form} setForm={setForm} lookups={lookups} /> : <Grid container spacing={2} sx={{ mt: 0.5 }}>{config.fields.map((field) => <Grid item xs={12} md={field === 'description' || field === 'notes' ? 12 : 6} key={field}><Field name={field} value={form[field]} moduleKey={moduleKey} form={form} lookups={lookups} onChange={(name, value) => setForm((current) => ({ ...current, [name]: value, ...(name === 'courseId' ? { batchId: '' } : {}) }))} /></Grid>)}{moduleKey === 'students' && form.courseId && lookups.batches.filter((batch) => String(batch.courseId) === String(form.courseId)).length === 0 && <Grid item xs={12}><Alert severity="info">No batches available for this course.</Alert></Grid>}</Grid>}</DialogContent>
      <DialogActions><Button onClick={() => setDialogOpen(false)}>Cancel</Button><Button variant="contained" onClick={save}>Save</Button></DialogActions>
    </Dialog>

    <Dialog open={!!installmentFee} onClose={() => setInstallmentFee(null)} maxWidth="lg" fullWidth>
      <DialogTitle>View Installments</DialogTitle>
      <DialogContent><TableContainer><Table size="small"><TableHead><TableRow>{['Installment No', 'Amount', 'Due Date', 'Paid Amount', 'Paid Date', 'Payment Method', 'Status', 'Action'].map((label) => <TableCell key={label}>{label}</TableCell>)}</TableRow></TableHead><TableBody>{(installmentFee?.installments || []).map((item) => <TableRow key={item.id}><TableCell>{item.installmentNo}</TableCell><TableCell>{moneyText(item.amount)}</TableCell><TableCell>{item.dueDate}</TableCell><TableCell>{moneyText(item.paidAmount)}</TableCell><TableCell>{item.paidDate || '-'}</TableCell><TableCell>{item.paymentMethod || '-'}</TableCell><TableCell><Chip size="small" label={item.status} /></TableCell><TableCell><Stack direction="row" spacing={0.5}><IconButton size="small" onClick={() => openPay(item)} disabled={item.status === 'paid'}><PaymentsIcon /></IconButton><IconButton size="small" onClick={() => remind(item)}><NotificationsActiveIcon /></IconButton></Stack></TableCell></TableRow>)}{(!installmentFee?.installments || installmentFee.installments.length === 0) && <TableRow><TableCell colSpan={8}>No installments for this fee plan.</TableCell></TableRow>}</TableBody></Table></TableContainer></DialogContent>
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