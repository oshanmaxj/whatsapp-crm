import React, { useEffect, useMemo, useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import {
  Alert, Box, Button, Checkbox, Chip, Dialog, DialogActions, DialogContent, DialogTitle,
  FormControl, FormControlLabel, InputLabel, ListItemText, MenuItem, Paper, Select, Stack,
  Switch, Tab, Tabs, Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  TextField, Typography
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import CalendarMonthIcon from '@mui/icons-material/CalendarMonth';
import CloudDownloadIcon from '@mui/icons-material/CloudDownload';
import SettingsIcon from '@mui/icons-material/Settings';
import {
  cancelScheduledLesson, createCourseSchedule, deleteCourseSchedule, generateScheduleLessons,
  getZoomSettings, importZoomRecordings, listCourseSchedules, listScheduledLessons,
  listZoomRecordingImports, updateCourseSchedule, updateScheduledLesson, updateZoomSettings
} from '../services/courseScheduler.service';
import { listBatches, listCourses } from '../services/education.service';
import { publishLmsLesson } from '../services/lms.service';

const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const emptySchedule = {
  courseId: '', batchId: '', titlePrefix: '', startDate: '', endDate: '', classDays: [],
  startTime: '20:30', endTime: '22:30', timezone: 'Asia/Colombo', instructorName: '', topicName: 'Live Classes',
  meetingProvider: 'zoom', zoomMeetingId: '', zoomJoinUrl: '', zoomPassword: '',
  joinButtonLabel: 'Join Live Class', allowJoinBeforeMinutes: 30, allowJoinAfterMinutes: 150, autoCreateLessons: true,
  autoImportRecordings: true, reminderEnabled: true, status: 'active'
};
const emptyZoom = {
  accountId: '', clientId: '', clientSecret: '', verificationToken: '',
  recordingImportEnabled: true, defaultRecordingStorage: 'external',
  bunnyLibraryId: '', bunnyApiKey: '', bunnyPullZoneUrl: ''
};

function message(error, fallback) {
  return error.response?.data?.message || error.message || fallback;
}

function ZoomSettings({ onSaved }) {
  const [form, setForm] = useState(emptyZoom);
  const [status, setStatus] = useState({});
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    getZoomSettings().then(({ data }) => {
      setStatus(data.data || {});
      setForm((current) => ({ ...current, ...(data.data || {}) }));
    }).catch((requestError) => setError(message(requestError, 'Unable to load Zoom settings.')));
  }, []);
  const save = async () => {
    try {
      setSaving(true); setError('');
      const { data } = await updateZoomSettings(form);
      setStatus(data.data || {});
      onSaved?.('Zoom integration settings saved.');
    } catch (requestError) {
      setError(message(requestError, 'Unable to save Zoom settings.'));
    } finally { setSaving(false); }
  };
  return <Paper variant="outlined" sx={{ p: 3 }}>
    <Stack spacing={2}>
      <Box><Typography variant="h5" fontWeight={850}>Zoom Integration</Typography><Typography color="text.secondary">Server-to-Server OAuth secrets are encrypted at rest and never returned after saving. Environment variables take precedence over saved values.</Typography></Box>
      {error && <Alert severity="error">{error}</Alert>}
      <Alert severity={status.configured ? 'success' : 'warning'}>{status.configured ? 'Zoom credentials configured.' : 'Zoom credentials are missing.'}</Alert>
      <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
        <TextField label="Account ID" value={form.accountId || ''} onChange={(e) => setForm({ ...form, accountId: e.target.value })} fullWidth />
        <TextField label="Client ID" value={form.clientId || ''} onChange={(e) => setForm({ ...form, clientId: e.target.value })} fullWidth />
        <TextField type="password" label="Client Secret" value={form.clientSecret || ''} onChange={(e) => setForm({ ...form, clientSecret: e.target.value })} fullWidth />
      </Stack>
      <TextField type="password" label="Verification Token (optional)" value={form.verificationToken || ''} onChange={(e) => setForm({ ...form, verificationToken: e.target.value })} />
      <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
        <TextField select label="Recording Storage" value={form.defaultRecordingStorage || 'external'} onChange={(e) => setForm({ ...form, defaultRecordingStorage: e.target.value })} fullWidth>
          <MenuItem value="bunny">Bunny Stream</MenuItem><MenuItem value="local">Local</MenuItem><MenuItem value="external">External Zoom URL</MenuItem>
        </TextField>
        <FormControlLabel control={<Switch checked={Boolean(form.recordingImportEnabled)} onChange={(e) => setForm({ ...form, recordingImportEnabled: e.target.checked })} />} label="Recording import enabled" />
      </Stack>
      {form.defaultRecordingStorage === 'bunny' && <>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
          <TextField type="password" label="Bunny Library ID" value={form.bunnyLibraryId || ''} onChange={(e) => setForm({ ...form, bunnyLibraryId: e.target.value })} fullWidth />
          <TextField type="password" label="Bunny API Key" value={form.bunnyApiKey || ''} onChange={(e) => setForm({ ...form, bunnyApiKey: e.target.value })} fullWidth />
        </Stack>
        <TextField label="Bunny Pull Zone URL" value={form.bunnyPullZoneUrl || ''} onChange={(e) => setForm({ ...form, bunnyPullZoneUrl: e.target.value })} />
      </>}
      <Box><Button variant="contained" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save Integration Settings'}</Button></Box>
    </Stack>
  </Paper>;
}

export default function CourseSchedulerPage({ settingsOnly = false }) {
  const [tab, setTab] = useState(0);
  const [schedules, setSchedules] = useState([]);
  const [scheduledLessons, setScheduledLessons] = useState([]);
  const [imports, setImports] = useState([]);
  const [courses, setCourses] = useState([]);
  const [batches, setBatches] = useState([]);
  const [form, setForm] = useState(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try {
      const [scheduleRes, lessonRes, importRes, courseRes, batchRes] = await Promise.all([
        listCourseSchedules(), listScheduledLessons(), listZoomRecordingImports(), listCourses(), listBatches()
      ]);
      setSchedules(scheduleRes.data.data || []);
      setScheduledLessons(lessonRes.data.data || []);
      setImports(importRes.data.data || []);
      setCourses(courseRes.data.data || []);
      setBatches(batchRes.data.data || []);
    } catch (requestError) { setError(message(requestError, 'Unable to load scheduler.')); }
  };
  useEffect(() => { if (!settingsOnly) load(); }, [settingsOnly]);
  const availableBatches = useMemo(() => batches.filter((row) => String(row.courseId) === String(form?.courseId)), [batches, form?.courseId]);

  const save = async () => {
    try {
      setBusy(true); setError('');
      if (form.id) await updateCourseSchedule(form.id, form);
      else await createCourseSchedule(form);
      setForm(null); setSuccess('Schedule saved.'); await load();
    } catch (requestError) { setError(message(requestError, 'Unable to save schedule.')); } finally { setBusy(false); }
  };
  const run = async (action, successMessage) => {
    try { setBusy(true); setError(''); const response = await action(); setSuccess(successMessage(response.data.data)); await load(); }
    catch (requestError) { setError(message(requestError, 'Scheduler action failed.')); } finally { setBusy(false); }
  };

  if (settingsOnly) return <Stack spacing={2.5}>{success && <Alert severity="success">{success}</Alert>}<ZoomSettings onSaved={setSuccess} /></Stack>;

  return <Stack spacing={2.5}>
    <Paper variant="outlined" sx={{ p: 2.5 }}>
      <Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" spacing={2}>
        <Box><Typography variant="h5" fontWeight={850}>Course Scheduler</Typography><Typography color="text.secondary">Generate recurring LMS lessons and import completed Zoom recordings.</Typography></Box>
        <Stack direction="row" spacing={1}>
          <Button component={RouterLink} to="/settings/integrations/zoom" startIcon={<SettingsIcon />}>Zoom Settings</Button>
          <Button variant="outlined" startIcon={<CloudDownloadIcon />} disabled={busy} onClick={() => run(() => importZoomRecordings(), (result) => `Checked ${result.checked}; imported ${result.imported}; pending ${result.pending}; failed ${result.failed}.`)}>Import Recordings</Button>
          <Button variant="contained" startIcon={<AddIcon />} onClick={() => setForm({ ...emptySchedule })}>Create Schedule</Button>
        </Stack>
      </Stack>
    </Paper>
    {error && <Alert severity="error" onClose={() => setError('')}>{error}</Alert>}
    {success && <Alert severity="success" onClose={() => setSuccess('')}>{success}</Alert>}
    <Paper variant="outlined">
      <Tabs value={tab} onChange={(_, value) => setTab(value)}><Tab label="Schedules" /><Tab label="Scheduled Lessons" /><Tab label="Recording Imports" /></Tabs>
      {tab === 0 && <TableContainer><Table><TableHead><TableRow>{['Course', 'Batch', 'Days', 'Time', 'Date Range', 'Status', 'Lessons', 'Actions'].map((label) => <TableCell key={label}>{label}</TableCell>)}</TableRow></TableHead><TableBody>
        {schedules.map((row) => <TableRow key={row.id}><TableCell>{row.course?.name}</TableCell><TableCell>{row.batch?.name || 'All batches'}</TableCell><TableCell>{(row.classDays || []).join(', ')}</TableCell><TableCell>{row.startTime}–{row.endTime}<br /><Typography variant="caption">{row.timezone}</Typography></TableCell><TableCell>{row.startDate}–{row.endDate}</TableCell><TableCell><Chip size="small" label={row.status} color={row.status === 'active' ? 'success' : 'default'} /></TableCell><TableCell>{row.scheduledLessons?.length || 0}</TableCell><TableCell><Stack direction="row" spacing={.5}>
          <Button size="small" onClick={() => setForm({ ...row })}>Edit</Button>
          <Button size="small" startIcon={<CalendarMonthIcon />} disabled={busy} onClick={() => run(() => generateScheduleLessons(row.id), (result) => `Generated ${result.created}; skipped ${result.skipped} existing lessons.`)}>Generate</Button>
          <Button size="small" onClick={() => run(() => updateCourseSchedule(row.id, { status: row.status === 'paused' ? 'active' : 'paused' }), () => row.status === 'paused' ? 'Schedule resumed.' : 'Schedule paused.')}>{row.status === 'paused' ? 'Resume' : 'Pause'}</Button>
          <Button size="small" color="error" onClick={() => { if (window.confirm('Delete this schedule? Generated lessons will be retained.')) run(() => deleteCourseSchedule(row.id), () => 'Schedule deleted.'); }}>Delete</Button>
        </Stack></TableCell></TableRow>)}
        {!schedules.length && <TableRow><TableCell colSpan={8} align="center" sx={{ py: 5 }}>No schedules created.</TableCell></TableRow>}
      </TableBody></Table></TableContainer>}
      {tab === 1 && <TableContainer><Table><TableHead><TableRow>{['Lesson', 'Course / Batch', 'Date / Time', 'Status', 'Recording', 'LMS', 'Actions'].map((label) => <TableCell key={label}>{label}</TableCell>)}</TableRow></TableHead><TableBody>
        {scheduledLessons.map((row) => <TableRow key={row.id}><TableCell>{row.title}</TableCell><TableCell>{row.course?.name}<br />{row.batch?.name || 'All batches'}</TableCell><TableCell>{new Date(row.scheduledStartAt).toLocaleString()}</TableCell><TableCell><Chip size="small" label={row.status} /></TableCell><TableCell><Chip size="small" label={row.recordingImportStatus} color={row.recordingImportStatus === 'imported' ? 'success' : row.recordingImportStatus === 'failed' ? 'error' : 'default'} /></TableCell><TableCell>{row.lessonId ? `#${row.lessonId}` : '-'}</TableCell><TableCell><Stack direction="row">
          <Button size="small" onClick={() => run(() => updateScheduledLesson(row.id, { status: 'completed' }), () => 'Lesson marked completed.')}>Complete</Button>
          <Button size="small" onClick={() => run(() => importZoomRecordings({ scheduledLessonId: row.id }), (result) => result.imported ? 'Recording imported.' : 'Recording not found yet.')}>Import</Button>
          {row.lessonId && <Button size="small" onClick={() => run(() => publishLmsLesson(row.lessonId, true), () => 'Lesson published.')}>Publish</Button>}
          <Button size="small" color="error" onClick={() => run(() => cancelScheduledLesson(row.id), () => 'Scheduled lesson cancelled.')}>Cancel</Button>
        </Stack></TableCell></TableRow>)}
        {!scheduledLessons.length && <TableRow><TableCell colSpan={7} align="center" sx={{ py: 5 }}>No scheduled lessons.</TableCell></TableRow>}
      </TableBody></Table></TableContainer>}
      {tab === 2 && <TableContainer><Table><TableHead><TableRow>{['Topic', 'Meeting', 'Start', 'Storage', 'Status', 'Lesson', 'Error'].map((label) => <TableCell key={label}>{label}</TableCell>)}</TableRow></TableHead><TableBody>
        {imports.map((row) => <TableRow key={row.id}><TableCell>{row.topic || '-'}</TableCell><TableCell>{row.zoomMeetingId}</TableCell><TableCell>{row.startTime ? new Date(row.startTime).toLocaleString() : '-'}</TableCell><TableCell>{row.storageProvider || '-'}</TableCell><TableCell><Chip size="small" label={row.status} color={row.status === 'imported' ? 'success' : row.status === 'failed' ? 'error' : 'default'} /></TableCell><TableCell>{row.lesson?.title || row.lessonId || '-'}</TableCell><TableCell>{row.errorMessage || '-'}</TableCell></TableRow>)}
        {!imports.length && <TableRow><TableCell colSpan={7} align="center" sx={{ py: 5 }}>No recording imports.</TableCell></TableRow>}
      </TableBody></Table></TableContainer>}
    </Paper>

    <Dialog open={Boolean(form)} onClose={() => { if (!busy) setForm(null); }} fullWidth maxWidth="md">
      <DialogTitle>{form?.id ? 'Edit Schedule' : 'Create Schedule'}</DialogTitle>
      {form && <DialogContent dividers><Stack spacing={2}>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
          <TextField select label="Course" value={form.courseId} onChange={(e) => setForm({ ...form, courseId: e.target.value, batchId: '' })} fullWidth required>{courses.map((row) => <MenuItem key={row.id} value={row.id}>{row.name}</MenuItem>)}</TextField>
          <TextField select label="Batch" value={form.batchId || ''} onChange={(e) => setForm({ ...form, batchId: e.target.value })} fullWidth><MenuItem value="">All batches</MenuItem>{availableBatches.map((row) => <MenuItem key={row.id} value={row.id}>{row.name}</MenuItem>)}</TextField>
        </Stack>
        <TextField label="Title Prefix" value={form.titlePrefix} onChange={(e) => setForm({ ...form, titlePrefix: e.target.value })} required />
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
          <TextField type="date" label="Start Date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} InputLabelProps={{ shrink: true }} fullWidth />
          <TextField type="date" label="End Date" value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} InputLabelProps={{ shrink: true }} fullWidth />
        </Stack>
        <FormControl fullWidth><InputLabel>Class Days</InputLabel><Select multiple label="Class Days" value={form.classDays || []} onChange={(e) => setForm({ ...form, classDays: e.target.value })} renderValue={(selected) => selected.join(', ')}>{days.map((day) => <MenuItem key={day} value={day}><Checkbox checked={(form.classDays || []).includes(day)} /><ListItemText primary={day} /></MenuItem>)}</Select></FormControl>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
          <TextField type="time" label="Start Time" value={String(form.startTime || '').slice(0, 5)} onChange={(e) => setForm({ ...form, startTime: e.target.value })} InputLabelProps={{ shrink: true }} fullWidth />
          <TextField type="time" label="End Time" value={String(form.endTime || '').slice(0, 5)} onChange={(e) => setForm({ ...form, endTime: e.target.value })} InputLabelProps={{ shrink: true }} fullWidth />
          <TextField label="Timezone" value={form.timezone} onChange={(e) => setForm({ ...form, timezone: e.target.value })} fullWidth />
        </Stack>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
          <TextField label="Curriculum Topic" value={form.topicName || 'Live Classes'} onChange={(e) => setForm({ ...form, topicName: e.target.value })} helperText="Reuses the same topic for this course and batch." fullWidth />
          <TextField label="Instructor Name" value={form.instructorName || ''} onChange={(e) => setForm({ ...form, instructorName: e.target.value })} fullWidth />
        </Stack>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
          <TextField select label="Meeting Provider" value={form.meetingProvider} onChange={(e) => setForm({ ...form, meetingProvider: e.target.value })} fullWidth><MenuItem value="zoom">Zoom</MenuItem><MenuItem value="manual">Manual</MenuItem></TextField>
          <TextField label="Zoom Meeting ID" value={form.zoomMeetingId || ''} onChange={(e) => setForm({ ...form, zoomMeetingId: e.target.value })} fullWidth />
        </Stack>
        <TextField label="Zoom Join URL" value={form.zoomJoinUrl || ''} onChange={(e) => setForm({ ...form, zoomJoinUrl: e.target.value })} helperText="Students only receive this URL through the access-controlled Join Class endpoint." />
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
          <TextField type="password" label="Zoom Password" value={form.zoomPassword || ''} onChange={(e) => setForm({ ...form, zoomPassword: e.target.value })} fullWidth />
          <TextField label="Join Button Label" value={form.joinButtonLabel || 'Join Live Class'} onChange={(e) => setForm({ ...form, joinButtonLabel: e.target.value })} fullWidth />
        </Stack>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
          <TextField type="number" label="Allow Join Before (minutes)" value={form.allowJoinBeforeMinutes ?? 30} onChange={(e) => setForm({ ...form, allowJoinBeforeMinutes: Number(e.target.value) })} inputProps={{ min: 0 }} fullWidth />
          <TextField type="number" label="Allow Join After (minutes)" value={form.allowJoinAfterMinutes ?? 150} onChange={(e) => setForm({ ...form, allowJoinAfterMinutes: Number(e.target.value) })} inputProps={{ min: 0 }} fullWidth />
        </Stack>
        <Stack direction={{ xs: 'column', md: 'row' }}>
          <FormControlLabel control={<Switch checked={Boolean(form.autoCreateLessons)} onChange={(e) => setForm({ ...form, autoCreateLessons: e.target.checked })} />} label="Auto create LMS lessons" />
          <FormControlLabel control={<Switch checked={Boolean(form.autoImportRecordings)} onChange={(e) => setForm({ ...form, autoImportRecordings: e.target.checked })} />} label="Auto import recordings" />
          <FormControlLabel control={<Switch checked={Boolean(form.reminderEnabled)} onChange={(e) => setForm({ ...form, reminderEnabled: e.target.checked })} />} label="Class reminders" />
        </Stack>
      </Stack></DialogContent>}
      <DialogActions><Button onClick={() => setForm(null)} disabled={busy}>Cancel</Button><Button variant="contained" onClick={save} disabled={busy || !form?.courseId || !form?.titlePrefix || !form?.classDays?.length}>{busy ? 'Saving…' : 'Save'}</Button></DialogActions>
    </Dialog>
  </Stack>;
}
