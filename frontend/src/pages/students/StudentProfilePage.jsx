import React, { useEffect, useMemo, useState } from 'react';
import { Link as RouterLink, useNavigate, useParams } from 'react-router-dom';
import {
  Alert, Avatar, Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, Divider, FormControlLabel,
  Grid, IconButton, LinearProgress, Link, Paper, Stack, Switch, Tab, Table, TableBody, TableCell, TableContainer,
  TableHead, TableRow, Tabs, TextField, Typography, useTheme
} from '@mui/material';
import AssignmentTurnedInIcon from '@mui/icons-material/AssignmentTurnedIn';
import ChatIcon from '@mui/icons-material/Chat';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import DescriptionIcon from '@mui/icons-material/Description';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import NoteAddIcon from '@mui/icons-material/NoteAdd';
import NotificationsActiveIcon from '@mui/icons-material/NotificationsActive';
import PaymentsIcon from '@mui/icons-material/Payments';
import SchoolIcon from '@mui/icons-material/School';
import SendIcon from '@mui/icons-material/Send';
import WorkspacePremiumIcon from '@mui/icons-material/WorkspacePremium';
import PersonOutlineIcon from '@mui/icons-material/PersonOutline';
import WhatsAppIcon from '@mui/icons-material/WhatsApp';
import {
  createStudentGuardian,
  createStudentDocument,
  createStudentNote,
  deleteStudentGuardian,
  deleteStudentDocument,
  deleteStudentNote,
  getStudentProfile,
  updateStudentGuardian
} from '../../services/education.service';

const tabs = ['Overview', 'Fees', 'Attendance', 'Certificates', 'Guardians', 'Notes', 'Documents', 'WhatsApp'];
const emptyGuardian = {
  name: '',
  relationship: '',
  phone: '',
  whatsapp: '',
  email: '',
  dateOfBirth: '',
  isPrimary: false,
  isEmergencyContact: false,
  address: '',
  notes: ''
};

function money(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number.toFixed(2) : '0.00';
}

function dateText(value) {
  if (!value) return '-';
  return new Date(value).toLocaleDateString();
}

function EmptyState({ label }) {
  return <Box sx={{ py: 5, textAlign: 'center' }}><Typography fontWeight={800}>{label}</Typography><Typography color="text.secondary">Nothing to show yet.</Typography></Box>;
}

function InfoCard({ title, icon, children }) {
  const theme = useTheme();
  return <Paper elevation={0} sx={{ p: 2.5, border: `1px solid ${theme.palette.divider}`, height: '100%' }}>
    <Stack direction="row" spacing={1.25} alignItems="center" sx={{ mb: 2 }}>
      {icon}
      <Typography variant="h6" fontWeight={850}>{title}</Typography>
    </Stack>
    {children}
  </Paper>;
}

function DetailGrid({ rows }) {
  return <Grid container spacing={1.5}>{rows.map(([label, value]) => <Grid item xs={12} sm={6} key={label}>
    <Typography variant="caption" color="text.secondary">{label}</Typography>
    <Typography fontWeight={700} sx={{ wordBreak: 'break-word' }}>{value || '-'}</Typography>
  </Grid>)}</Grid>;
}

function StudentProfilePage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const theme = useTheme();
  const [profile, setProfile] = useState(null);
  const [tab, setTab] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [note, setNote] = useState('');
  const [documentForm, setDocumentForm] = useState({ fileName: '', fileUrl: '', type: '' });
  const [guardianDialog, setGuardianDialog] = useState(false);
  const [guardianForm, setGuardianForm] = useState(emptyGuardian);
  const [editingGuardianId, setEditingGuardianId] = useState(null);

  const load = async () => {
    try {
      setLoading(true);
      const response = await getStudentProfile(id);
      setProfile(response.data.data);
      setError('');
    } catch (err) {
      setError(err.response?.data?.message || 'Unable to load student profile.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [id]);

  const quickActions = [
    ['Add Payment', <PaymentsIcon />, '/fees'],
    ['Send Reminder', <NotificationsActiveIcon />, '/fees'],
    ['Send WhatsApp', <SendIcon />, '/chat'],
    ['Mark Attendance', <AssignmentTurnedInIcon />, '/attendance'],
    ['Issue Certificate', <WorkspacePremiumIcon />, '/certificates']
  ];

  const attendanceRows = profile?.attendance?.records || [];
  const noteRows = profile?.notes || [];
  const documentRows = profile?.documents || [];
  const certificates = profile?.certificates || [];
  const installments = profile?.installments || [];
  const guardians = profile?.guardians || [];
  const enrollments = profile?.enrollments || [];
  const activeEnrollments = enrollments.filter((item) => item.enrollmentStatus === 'active');

  const paymentColor = useMemo(() => {
    const status = profile?.fees?.paymentStatus;
    if (status === 'Paid' || status === 'Free Card' || status === 'Scholarship') return 'success';
    if (status === 'Overdue') return 'error';
    if (status === 'Partial') return 'warning';
    return 'default';
  }, [profile]);

  const saveNote = async () => {
    try {
      await createStudentNote(id, { note });
      setNote('');
      setSuccess('Note added.');
      await load();
    } catch (err) {
      setError(err.response?.data?.message || 'Unable to add note.');
    }
  };

  const removeNote = async (noteId) => {
    await deleteStudentNote(noteId);
    setSuccess('Note deleted.');
    await load();
  };

  const saveDocument = async () => {
    try {
      await createStudentDocument(id, documentForm);
      setDocumentForm({ fileName: '', fileUrl: '', type: '' });
      setSuccess('Document added.');
      await load();
    } catch (err) {
      setError(err.response?.data?.message || 'Unable to add document.');
    }
  };

  const removeDocument = async (documentId) => {
    await deleteStudentDocument(documentId);
    setSuccess('Document deleted.');
    await load();
  };

  const openGuardianDialog = (guardian = null) => {
    setEditingGuardianId(guardian?.id || null);
    setGuardianForm(guardian ? {
      name: guardian.name || '',
      relationship: guardian.relationship || '',
      phone: guardian.phone || '',
      whatsapp: guardian.whatsapp || '',
      email: guardian.email || '',
      dateOfBirth: guardian.dateOfBirth || '',
      isPrimary: guardian.isPrimary === true,
      isEmergencyContact: guardian.isEmergencyContact === true,
      address: guardian.address || '',
      notes: guardian.notes || ''
    } : emptyGuardian);
    setGuardianDialog(true);
  };

  const saveGuardian = async () => {
    try {
      if (editingGuardianId) await updateStudentGuardian(editingGuardianId, guardianForm);
      else await createStudentGuardian(id, guardianForm);
      setGuardianDialog(false);
      setSuccess(editingGuardianId ? 'Guardian updated.' : 'Guardian added.');
      await load();
    } catch (err) {
      setError(err.response?.data?.message || 'Unable to save guardian.');
    }
  };

  const removeGuardian = async (guardianId) => {
    try {
      await deleteStudentGuardian(guardianId);
      setSuccess('Guardian deleted.');
      await load();
    } catch (err) {
      setError(err.response?.data?.message || 'Unable to delete guardian.');
    }
  };

  if (loading && !profile) return <Stack spacing={2}><LinearProgress /><Typography color="text.secondary">Loading student profile...</Typography></Stack>;
  if (error && !profile) return <Alert severity="error">{error}</Alert>;

  const student = profile?.student || {};
  const fees = profile?.fees || {};
  const attendance = profile?.attendance || {};
  const whatsapp = profile?.whatsapp || {};

  return <Stack spacing={2.5}>
    {loading && <LinearProgress />}
    {error && <Alert severity="error" onClose={() => setError('')}>{error}</Alert>}
    {success && <Alert severity="success" onClose={() => setSuccess('')}>{success}</Alert>}

    <Paper elevation={0} sx={{ p: { xs: 2, md: 3 }, border: `1px solid ${theme.palette.divider}` }}>
      <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} alignItems={{ md: 'center' }}>
        <Avatar src={student.photo || undefined} sx={{ width: 72, height: 72, bgcolor: 'primary.main', fontWeight: 900 }}>
          {(student.fullName || 'S').slice(0, 1)}
        </Avatar>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
            <Typography variant="h4" fontWeight={900}>{student.fullName || 'Student'}</Typography>
            <Chip label={student.status || 'unknown'} size="small" />
            {fees.paymentStatus && <Chip label={fees.paymentStatus} size="small" color={paymentColor} />}
          </Stack>
          <Typography color="text.secondary">{student.studentId || '-'} · {activeEnrollments.length} active enrollment{activeEnrollments.length === 1 ? '' : 's'}</Typography>
        </Box>
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
          {quickActions.map(([label, icon, path]) => <Button key={label} variant="outlined" startIcon={icon} onClick={() => navigate(path)}>{label}</Button>)}
        </Stack>
      </Stack>
    </Paper>

    <Paper elevation={0} sx={{ border: `1px solid ${theme.palette.divider}` }}>
      <Tabs value={tab} onChange={(_, value) => setTab(value)} variant="scrollable" scrollButtons="auto">
        {tabs.map((label) => <Tab key={label} label={label} />)}
      </Tabs>
    </Paper>

    {tab === 0 && <Grid container spacing={2}>
      <Grid item xs={12} md={6}><InfoCard title="Student Information" icon={<SchoolIcon color="primary" />}><DetailGrid rows={[
        ['Full Name', student.fullName], ['Student ID', student.studentId], ['NIC', student.nic], ['Phone', student.phone],
        ['WhatsApp Number', student.whatsappNumber], ['Email', student.email], ['Date of Birth', dateText(student.dateOfBirth)], ['Address', student.address], ['Registration Date', dateText(student.registrationDate)]
      ]} /></InfoCard></Grid>
      <Grid item xs={12} md={6}><InfoCard title="Current Courses" icon={<SchoolIcon color="primary" />}><Stack spacing={1}>
        {activeEnrollments.map((item) => <Paper key={item.id} variant="outlined" sx={{ p: 1.5 }}><Typography fontWeight={800}>{item.course?.name || 'Course'}</Typography><Typography variant="body2" color="text.secondary">{item.course?.code || ''}</Typography></Paper>)}
        {!activeEnrollments.length && <Typography color="text.secondary">No active courses.</Typography>}
      </Stack></InfoCard></Grid>
      <Grid item xs={12} md={6}><InfoCard title="Current Batches" icon={<SchoolIcon color="primary" />}><Stack spacing={1}>
        {activeEnrollments.filter((item) => item.batch).map((item) => <Paper key={item.id} variant="outlined" sx={{ p: 1.5 }}><Typography fontWeight={800}>{item.batch?.name}</Typography><Typography variant="body2" color="text.secondary">{item.course?.name} · {item.batch?.schedule || 'Schedule not set'}</Typography></Paper>)}
        {!activeEnrollments.some((item) => item.batch) && <Typography color="text.secondary">No active batches.</Typography>}
      </Stack></InfoCard></Grid>
      <Grid item xs={12}><InfoCard title="Enrollment History" icon={<SchoolIcon color="primary" />}><TableContainer><Table size="small"><TableHead><TableRow>{['Course', 'Batch', 'Status', 'Payment', 'LMS Access', 'Enrolled', 'Completed'].map((label) => <TableCell key={label}>{label}</TableCell>)}</TableRow></TableHead><TableBody>
        {enrollments.map((item) => <TableRow key={item.id}><TableCell>{item.course?.name || '-'}</TableCell><TableCell>{item.batch?.name || 'All-course'}</TableCell><TableCell><Chip size="small" label={item.enrollmentStatus} color={item.enrollmentStatus === 'active' ? 'success' : 'default'} /></TableCell><TableCell><Chip size="small" label={item.paymentStatus || 'missing'} color={item.paymentStatus === 'paid' || item.paymentStatus === 'current' ? 'success' : 'warning'} /></TableCell><TableCell><Chip size="small" label={item.accessAllowed ? 'Allowed' : 'Blocked'} color={item.accessAllowed ? 'success' : 'warning'} /></TableCell><TableCell>{dateText(item.enrolledAt)}</TableCell><TableCell>{dateText(item.completedAt)}</TableCell></TableRow>)}
        {!enrollments.length && <TableRow><TableCell colSpan={7}><EmptyState label="No enrollment history found" /></TableCell></TableRow>}
      </TableBody></Table></TableContainer></InfoCard></Grid>
      <Grid item xs={12} md={6}><InfoCard title="Fee Summary" icon={<PaymentsIcon color="primary" />}><DetailGrid rows={[
        ['Original Fee', money(fees.originalFee)], ['Discount', money(fees.discount)], ['Final Fee', money(fees.finalFee)], ['Paid Amount', money(fees.paidAmount)],
        ['Balance', money(fees.balance)], ['Next Installment Date', dateText(fees.nextInstallmentDate)], ['Payment Status', fees.paymentStatus]
      ]} /></InfoCard></Grid>
      <Grid item xs={12} md={6}><InfoCard title="Attendance Summary" icon={<AssignmentTurnedInIcon color="primary" />}><DetailGrid rows={[
        ['Total Classes', attendance.totalClasses ?? 0], ['Attended', attendance.attended ?? 0], ['Absent', attendance.absent ?? 0], ['Attendance Percentage', `${attendance.attendancePercentage || 0}%`]
      ]} /></InfoCard></Grid>
    </Grid>}

    {tab === 1 && <InfoCard title="Installment History" icon={<PaymentsIcon color="primary" />}><TableContainer><Table><TableHead><TableRow>{['Date', 'Amount', 'Method', 'Reference', 'Status'].map((label) => <TableCell key={label}>{label}</TableCell>)}</TableRow></TableHead><TableBody>{installments.map((item) => <TableRow key={item.id}><TableCell>{dateText(item.date)}</TableCell><TableCell>{money(item.amount)}</TableCell><TableCell>{item.method || '-'}</TableCell><TableCell>{item.reference || '-'}</TableCell><TableCell><Chip size="small" label={item.status} /></TableCell></TableRow>)}{installments.length === 0 && <TableRow><TableCell colSpan={5}><EmptyState label="No installments found" /></TableCell></TableRow>}</TableBody></Table></TableContainer></InfoCard>}

    {tab === 2 && <InfoCard title="Attendance" icon={<AssignmentTurnedInIcon color="primary" />}><TableContainer><Table><TableHead><TableRow>{['Date', 'Status', 'Notes'].map((label) => <TableCell key={label}>{label}</TableCell>)}</TableRow></TableHead><TableBody>{attendanceRows.map((item) => <TableRow key={item.id}><TableCell>{dateText(item.attendanceDate)}</TableCell><TableCell><Chip size="small" label={item.status} /></TableCell><TableCell>{item.notes || '-'}</TableCell></TableRow>)}{attendanceRows.length === 0 && <TableRow><TableCell colSpan={3}><EmptyState label="No attendance records found" /></TableCell></TableRow>}</TableBody></Table></TableContainer></InfoCard>}

    {tab === 3 && <InfoCard title="Certificates" icon={<WorkspacePremiumIcon color="primary" />}><TableContainer><Table><TableHead><TableRow>{['Certificate Number', 'Issue Date', 'Status'].map((label) => <TableCell key={label}>{label}</TableCell>)}</TableRow></TableHead><TableBody>{certificates.map((item) => <TableRow key={item.id}><TableCell>{item.certificateNo}</TableCell><TableCell>{dateText(item.issuedAt)}</TableCell><TableCell><Chip size="small" label={item.status} /></TableCell></TableRow>)}{certificates.length === 0 && <TableRow><TableCell colSpan={3}><EmptyState label="No certificates found" /></TableCell></TableRow>}</TableBody></Table></TableContainer></InfoCard>}

    {tab === 4 && <InfoCard title="Parents / Guardians" icon={<PersonOutlineIcon color="primary" />}>
      <Stack spacing={2}>
        <Box><Button variant="contained" startIcon={<PersonOutlineIcon />} onClick={() => openGuardianDialog()}>Add Guardian</Button></Box>
        <TableContainer>
          <Table>
            <TableHead><TableRow>{['Guardian', 'Relationship', 'Contact', 'Flags', 'Actions'].map((label) => <TableCell key={label}>{label}</TableCell>)}</TableRow></TableHead>
            <TableBody>
              {guardians.map((guardian) => {
                const whatsappNumber = guardian.whatsapp || guardian.phone || '';
                const whatsappUrl = whatsappNumber ? `https://wa.me/${whatsappNumber.replace(/\D/g, '')}` : '';
                return <TableRow key={guardian.id}>
                  <TableCell><Typography fontWeight={750}>{guardian.name}</Typography><Typography variant="caption" color="text.secondary">{guardian.email || '-'}</Typography><Typography variant="caption" color="text.secondary" display="block">{dateText(guardian.dateOfBirth)}</Typography></TableCell>
                  <TableCell>{guardian.relationship}</TableCell>
                  <TableCell><Typography variant="body2">{guardian.phone || '-'}</Typography><Typography variant="caption" color="text.secondary">{guardian.whatsapp || '-'}</Typography></TableCell>
                  <TableCell><Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>{guardian.isPrimary && <Chip size="small" color="primary" label="Primary" />}{guardian.isEmergencyContact && <Chip size="small" color="warning" label="Emergency" />}</Stack></TableCell>
                  <TableCell>
                    <Stack direction="row" spacing={0.5}>
                      <IconButton size="small" onClick={() => openGuardianDialog(guardian)} aria-label="Edit guardian"><EditOutlinedIcon /></IconButton>
                      <IconButton size="small" color="error" onClick={() => removeGuardian(guardian.id)} aria-label="Delete guardian"><DeleteOutlineIcon /></IconButton>
                      <IconButton size="small" color="success" component="a" href={whatsappUrl || undefined} target="_blank" rel="noreferrer" disabled={!whatsappUrl} aria-label="Send guardian WhatsApp"><WhatsAppIcon /></IconButton>
                    </Stack>
                  </TableCell>
                </TableRow>;
              })}
              {guardians.length === 0 && <TableRow><TableCell colSpan={5}><EmptyState label="No guardians found" /></TableCell></TableRow>}
            </TableBody>
          </Table>
        </TableContainer>
      </Stack>
    </InfoCard>}

    {tab === 5 && <InfoCard title="Internal Notes" icon={<NoteAddIcon color="primary" />}>
      <Stack spacing={2}>
        <TextField label="Add note" value={note} onChange={(e) => setNote(e.target.value)} multiline minRows={3} fullWidth />
        <Box><Button variant="contained" startIcon={<NoteAddIcon />} onClick={saveNote} disabled={!note.trim()}>Add Note</Button></Box>
        <Divider />
        {noteRows.map((item) => <Paper key={item.id} elevation={0} sx={{ p: 2, border: `1px solid ${theme.palette.divider}` }}><Stack direction="row" spacing={1} alignItems="flex-start"><Box sx={{ flex: 1 }}><Typography>{item.note}</Typography><Typography variant="caption" color="text.secondary">{dateText(item.createdAt)}</Typography></Box><IconButton color="error" onClick={() => removeNote(item.id)}><DeleteOutlineIcon /></IconButton></Stack></Paper>)}
        {noteRows.length === 0 && <EmptyState label="No notes found" />}
      </Stack>
    </InfoCard>}

    {tab === 6 && <InfoCard title="Documents" icon={<DescriptionIcon color="primary" />}>
      <Grid container spacing={2} sx={{ mb: 2 }}>
        <Grid item xs={12} md={4}><TextField label="File Name" value={documentForm.fileName} onChange={(e) => setDocumentForm((current) => ({ ...current, fileName: e.target.value }))} fullWidth /></Grid>
        <Grid item xs={12} md={4}><TextField label="File URL" value={documentForm.fileUrl} onChange={(e) => setDocumentForm((current) => ({ ...current, fileUrl: e.target.value }))} fullWidth /></Grid>
        <Grid item xs={12} md={3}><TextField label="Type" value={documentForm.type} onChange={(e) => setDocumentForm((current) => ({ ...current, type: e.target.value }))} fullWidth /></Grid>
        <Grid item xs={12} md={1}><Button variant="contained" onClick={saveDocument} disabled={!documentForm.fileName.trim() || !documentForm.fileUrl.trim()} sx={{ height: '100%', minWidth: '100%' }}>Add</Button></Grid>
      </Grid>
      <TableContainer><Table><TableHead><TableRow>{['File Name', 'Type', 'Uploaded', 'Action'].map((label) => <TableCell key={label}>{label}</TableCell>)}</TableRow></TableHead><TableBody>{documentRows.map((item) => <TableRow key={item.id}><TableCell><Link href={item.fileUrl} target="_blank" rel="noreferrer">{item.fileName}</Link></TableCell><TableCell>{item.type || '-'}</TableCell><TableCell>{dateText(item.createdAt)}</TableCell><TableCell><IconButton color="error" onClick={() => removeDocument(item.id)}><DeleteOutlineIcon /></IconButton></TableCell></TableRow>)}{documentRows.length === 0 && <TableRow><TableCell colSpan={4}><EmptyState label="No documents found" /></TableCell></TableRow>}</TableBody></Table></TableContainer>
    </InfoCard>}

    {tab === 7 && <InfoCard title="WhatsApp" icon={<ChatIcon color="primary" />}>
      <DetailGrid rows={[
        ['Last Conversation Date', dateText(whatsapp.lastConversationDate)], ['Total Conversations', whatsapp.totalConversations ?? 0], ['Last Message Preview', whatsapp.lastMessagePreview]
      ]} />
      <Stack direction="row" spacing={1} sx={{ mt: 2 }} flexWrap="wrap" useFlexGap>
        <Button variant="contained" startIcon={<SendIcon />} component={RouterLink} to="/chat">Send Message</Button>
        <Button variant="outlined" startIcon={<ChatIcon />} component={RouterLink} to="/chat">Open Chat</Button>
      </Stack>
    </InfoCard>}

    <Dialog open={guardianDialog} onClose={() => setGuardianDialog(false)} fullWidth maxWidth="sm">
      <DialogTitle>{editingGuardianId ? 'Edit Guardian' : 'Add Guardian'}</DialogTitle>
      <DialogContent dividers>
        <Grid container spacing={2} sx={{ pt: 0.5 }}>
          <Grid item xs={12} sm={6}><TextField label="Guardian Name" value={guardianForm.name} onChange={(e) => setGuardianForm((current) => ({ ...current, name: e.target.value }))} fullWidth required /></Grid>
          <Grid item xs={12} sm={6}><TextField label="Relationship" value={guardianForm.relationship} onChange={(e) => setGuardianForm((current) => ({ ...current, relationship: e.target.value }))} fullWidth required /></Grid>
          <Grid item xs={12} sm={6}><TextField label="Phone" value={guardianForm.phone} onChange={(e) => setGuardianForm((current) => ({ ...current, phone: e.target.value }))} fullWidth /></Grid>
          <Grid item xs={12} sm={6}><TextField label="WhatsApp" value={guardianForm.whatsapp} onChange={(e) => setGuardianForm((current) => ({ ...current, whatsapp: e.target.value }))} fullWidth /></Grid>
          <Grid item xs={12}><TextField label="Email" type="email" value={guardianForm.email} onChange={(e) => setGuardianForm((current) => ({ ...current, email: e.target.value }))} fullWidth /></Grid>
          <Grid item xs={12}><TextField label="Date of Birth" type="date" value={guardianForm.dateOfBirth} onChange={(e) => setGuardianForm((current) => ({ ...current, dateOfBirth: e.target.value }))} InputLabelProps={{ shrink: true }} fullWidth /></Grid>
          <Grid item xs={12}><TextField label="Address" value={guardianForm.address} onChange={(e) => setGuardianForm((current) => ({ ...current, address: e.target.value }))} multiline minRows={2} fullWidth /></Grid>
          <Grid item xs={12}><TextField label="Notes" value={guardianForm.notes} onChange={(e) => setGuardianForm((current) => ({ ...current, notes: e.target.value }))} multiline minRows={2} fullWidth /></Grid>
          <Grid item xs={12}><Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
            <FormControlLabel control={<Switch checked={guardianForm.isPrimary} onChange={(e) => setGuardianForm((current) => ({ ...current, isPrimary: e.target.checked }))} />} label="Primary Contact" />
            <FormControlLabel control={<Switch checked={guardianForm.isEmergencyContact} onChange={(e) => setGuardianForm((current) => ({ ...current, isEmergencyContact: e.target.checked }))} />} label="Emergency Contact" />
          </Stack></Grid>
        </Grid>
      </DialogContent>
      <DialogActions>
        <Button onClick={() => setGuardianDialog(false)}>Cancel</Button>
        <Button variant="contained" onClick={saveGuardian} disabled={!guardianForm.name.trim() || !guardianForm.relationship.trim()}>Save Guardian</Button>
      </DialogActions>
    </Dialog>
  </Stack>;
}

export default StudentProfilePage;
