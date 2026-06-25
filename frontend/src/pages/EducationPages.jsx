import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert, Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, FormControl, Grid,
  IconButton, InputLabel, LinearProgress, MenuItem, Paper, Select, Stack, Table, TableBody, TableCell,
  TableContainer, TableHead, TableRow, TextField, Typography
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import EditIcon from '@mui/icons-material/Edit';
import NotificationsActiveIcon from '@mui/icons-material/NotificationsActive';
import PaymentsIcon from '@mui/icons-material/Payments';
import {
  createAttendance, createBatch, createCertificate, createCourse, createFee, createStudent, deleteAttendance,
  deleteBatch, deleteCertificate, deleteCourse, deleteFee, deleteStudent, listAttendance, listBatches,
  listCertificates, listCourses, listFees, listStudents, payInstallment, sendFeeReminder, updateAttendance,
  updateBatch, updateCertificate, updateCourse, updateFee, updateStudent
} from '../services/education.service';

const modules = {
  courses: {
    title: 'Course Management',
    list: listCourses,
    create: createCourse,
    update: updateCourse,
    remove: deleteCourse,
    initial: { name: '', code: '', category: '', durationWeeks: '', feeAmount: '', status: 'active', description: '' },
    fields: ['code', 'name', 'category', 'feeAmount', 'durationWeeks', 'status', 'description'],
    columns: ['code', 'name', 'category', 'feeAmount', 'durationWeeks', 'status']
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
    initial: { studentId: '', totalAmount: '', paymentType: 'full', installmentCount: 2, dueDate: '', notes: '' },
    fields: ['studentId', 'totalAmount', 'paymentType', 'installmentCount', 'dueDate', 'notes'],
    columns: ['student.name', 'paymentType', 'totalAmount', 'paidAmount', 'status', 'dueDate']
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

function getValue(row, path) {
  return path.split('.').reduce((acc, key) => (acc ? acc[key] : undefined), row) ?? '-';
}

function normalizePayload(form) {
  const payload = {};
  Object.entries(form).forEach(([key, value]) => {
    payload[key] = value === '' ? null : value;
  });
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

function Field({ name, value, onChange, moduleKey, form, lookups }) {
  const label = name.replace(/([A-Z])/g, ' $1').replace(/^./, (char) => char.toUpperCase());
  const selectOptions = {
    status: ['active', 'inactive', 'archived', 'upcoming', 'completed', 'cancelled', 'enrolled', 'dropped', 'suspended', 'pending', 'partial', 'paid', 'overdue', 'present', 'absent', 'late', 'excused', 'draft', 'issued', 'revoked'],
    paymentType: ['full', 'installment']
  };
  if (selectOptions[name]) {
    return <FormControl fullWidth><InputLabel>{label}</InputLabel><Select label={label} value={value || ''} onChange={(e) => onChange(name, e.target.value)}>{selectOptions[name].map((item) => <MenuItem key={item} value={item}>{item}</MenuItem>)}</Select></FormControl>;
  }
  if (name === 'courseId') {
    const activeCourses = lookups.courses.filter((course) => !['batches', 'students'].includes(moduleKey) || course.status === 'active');
    return (
      <FormControl fullWidth required={moduleKey === 'batches' || moduleKey === 'students'}>
        <InputLabel>Course</InputLabel>
        <Select label="Course" value={value || ''} onChange={(e) => onChange(name, e.target.value)}>
          {activeCourses.map((course) => <MenuItem key={course.id} value={course.id}>{courseLabel(course)}</MenuItem>)}
          {activeCourses.length === 0 && <MenuItem disabled>No active courses available</MenuItem>}
        </Select>
      </FormControl>
    );
  }
  if (name === 'batchId') {
    const courseId = String(form.courseId || '');
    const batches = lookups.batches.filter((batch) => String(batch.courseId) === courseId);
    return (
      <FormControl fullWidth disabled={!courseId || batches.length === 0} required={moduleKey === 'students'}>
        <InputLabel>Batch</InputLabel>
        <Select label="Batch" value={value || ''} onChange={(e) => onChange(name, e.target.value)}>
          {batches.map((batch) => <MenuItem key={batch.id} value={batch.id}>{batchLabel(batch)}</MenuItem>)}
          {!courseId && <MenuItem disabled>Select a course first</MenuItem>}
          {courseId && batches.length === 0 && <MenuItem disabled>No batches available for this course</MenuItem>}
        </Select>
      </FormControl>
    );
  }
  if (name === 'studentId') {
    return (
      <FormControl fullWidth required>
        <InputLabel>Student</InputLabel>
        <Select label="Student" value={value || ''} onChange={(e) => onChange(name, e.target.value)}>
          {lookups.students.map((student) => <MenuItem key={student.id} value={student.id}>{studentLabel(student)}</MenuItem>)}
          {lookups.students.length === 0 && <MenuItem disabled>No students available</MenuItem>}
        </Select>
      </FormControl>
    );
  }
  const type = name.toLowerCase().includes('date') || name === 'issuedAt' ? 'date' : name.toLowerCase().includes('amount') || name.includes('Id') || name.includes('Weeks') || name.includes('Count') || name === 'capacity' ? 'number' : 'text';
  return <TextField label={label} type={type} value={value || ''} onChange={(e) => onChange(name, e.target.value)} multiline={name === 'notes' || name === 'description'} minRows={name === 'notes' || name === 'description' ? 3 : undefined} InputLabelProps={type === 'date' ? { shrink: true } : undefined} fullWidth />;
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

  const totals = useMemo(() => ({
    total: rows.length,
    active: rows.filter((row) => ['active', 'enrolled', 'present', 'issued', 'paid'].includes(row.status)).length,
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
      setLookups({
        courses: coursesRes.data.data || [],
        batches: batchesRes.data.data || [],
        students: studentsRes.data.data || []
      });
    } catch (err) {
      setError(err.response?.data?.message || `Unable to load ${config.title}.`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [moduleKey]);

  const openCreate = () => {
    setEditing(null);
    setForm(config.initial);
    setDialogOpen(true);
  };

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
      if (moduleKey === 'batches' && !payload.courseId) {
        setError('Course is required when creating a batch.');
        return;
      }
      if (moduleKey === 'students' && !payload.courseId) {
        setError('Course is required when creating a student.');
        return;
      }
      if (moduleKey === 'students' && !payload.batchId) {
        setError('Batch is required when creating a student.');
        return;
      }
      if (editing) await config.update(editing.id, payload);
      else await config.create(payload);
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

  const pay = async (installment) => {
    await payInstallment(installment.id, { amount: installment.amount });
    setSuccess('Installment marked paid.');
    await load();
  };

  const remind = async (installment) => {
    const response = await sendFeeReminder(installment.id);
    setSuccess(`Reminder ${response.data.data.notification.mode}: ${response.data.data.notification.to}`);
  };

  return (
    <Stack spacing={2.5}>
      {error && <Alert severity="error" onClose={() => setError('')}>{error}</Alert>}
      {success && <Alert severity="success" onClose={() => setSuccess('')}>{success}</Alert>}

      <Grid container spacing={2}>
        {Object.entries(totals).map(([key, value]) => (
          <Grid item xs={12} md={4} key={key}><Paper sx={{ p: 2.5, border: '1px solid #e8edf2' }} elevation={0}><Typography variant="h4" fontWeight={850}>{value}</Typography><Typography color="text.secondary">{key}</Typography></Paper></Grid>
        ))}
      </Grid>

      <Paper sx={{ p: 2.5, border: '1px solid #e8edf2' }} elevation={0}>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} alignItems={{ md: 'center' }}>
          <Box sx={{ flex: 1 }}><Typography variant="h5" fontWeight={850}>{config.title}</Typography><Typography color="text.secondary">Education CRM records linked with contacts, leads, courses, and batches.</Typography></Box>
          <Button variant="contained" startIcon={<AddIcon />} onClick={openCreate} sx={{ bgcolor: '#128c7e' }}>Add Record</Button>
        </Stack>
      </Paper>

      <Paper sx={{ border: '1px solid #e8edf2', overflow: 'hidden' }} elevation={0}>
        {loading && <LinearProgress />}
        <TableContainer>
          <Table>
            <TableHead><TableRow>{config.columns.map((column) => <TableCell key={column}>{column}</TableCell>)}<TableCell align="right">Actions</TableCell></TableRow></TableHead>
            <TableBody>
              {rows.map((row) => (
                <React.Fragment key={row.id}>
                  <TableRow hover>
                    {config.columns.map((column) => <TableCell key={column}>{column === 'status' ? <Chip size="small" label={getValue(row, column)} /> : getValue(row, column)}</TableCell>)}
                    <TableCell align="right"><IconButton onClick={() => openEdit(row)}><EditIcon /></IconButton><IconButton color="error" onClick={() => remove(row)}><DeleteOutlineIcon /></IconButton></TableCell>
                  </TableRow>
                  {moduleKey === 'fees' && row.installments?.length > 0 && (
                    <TableRow>
                      <TableCell colSpan={config.columns.length + 1} sx={{ bgcolor: '#f8fafc' }}>
                        <Stack direction="row" spacing={1} flexWrap="wrap">
                          {row.installments.map((item) => (
                            <Chip key={item.id} label={`#${item.installmentNo} ${item.amount} due ${item.dueDate} - ${item.status}`} color={item.status === 'overdue' ? 'error' : item.status === 'paid' ? 'success' : 'default'} onDelete={() => remind(item)} deleteIcon={<NotificationsActiveIcon />} icon={<PaymentsIcon />} onClick={() => pay(item)} />
                          ))}
                        </Stack>
                      </TableCell>
                    </TableRow>
                  )}
                </React.Fragment>
              ))}
              {!loading && rows.length === 0 && <TableRow><TableCell colSpan={config.columns.length + 1}><Box sx={{ py: 5, textAlign: 'center' }}><Typography fontWeight={800}>No records found</Typography><Typography color="text.secondary">Create the first record for this module.</Typography></Box></TableCell></TableRow>}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>

      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle>{editing ? 'Edit Record' : 'Add Record'}</DialogTitle>
        <DialogContent>
          <Grid container spacing={2} sx={{ mt: 0.5 }}>
            {config.fields.map((field) => (
              <Grid item xs={12} md={field === 'description' || field === 'notes' ? 12 : 6} key={field}>
                <Field
                  name={field}
                  value={form[field]}
                  moduleKey={moduleKey}
                  form={form}
                  lookups={lookups}
                  onChange={(name, value) => setForm((current) => ({
                    ...current,
                    [name]: value,
                    ...(name === 'courseId' ? { batchId: '' } : {})
                  }))}
                />
              </Grid>
            ))}
            {moduleKey === 'students' && form.courseId && lookups.batches.filter((batch) => String(batch.courseId) === String(form.courseId)).length === 0 && (
              <Grid item xs={12}><Alert severity="info">No batches available for this course.</Alert></Grid>
            )}
          </Grid>
        </DialogContent>
        <DialogActions><Button onClick={() => setDialogOpen(false)}>Cancel</Button><Button variant="contained" onClick={save}>Save</Button></DialogActions>
      </Dialog>
    </Stack>
  );
}

export const CoursesPage = () => <EducationModulePage moduleKey="courses" />;
export const BatchesPage = () => <EducationModulePage moduleKey="batches" />;
export const StudentsPage = () => <EducationModulePage moduleKey="students" />;
export const FeesPage = () => <EducationModulePage moduleKey="fees" />;
export const AttendancePage = () => <EducationModulePage moduleKey="attendance" />;
export const CertificatesPage = () => <EducationModulePage moduleKey="certificates" />;
