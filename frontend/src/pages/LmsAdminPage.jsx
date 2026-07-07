import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert, Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel,
  IconButton, MenuItem, Paper, Stack, Switch, Table, TableBody, TableCell, TableContainer, TableHead,
  TableRow, TextField, Tooltip, Typography
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import EditIcon from '@mui/icons-material/Edit';
import LinkIcon from '@mui/icons-material/Link';
import PublishIcon from '@mui/icons-material/Publish';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import {
  addLmsMaterial, createLmsLesson, deleteLmsLesson, deleteLmsMaterial, listLmsLessons,
  publishLmsLesson, updateLmsLesson, uploadLmsMaterialFile
} from '../services/lms.service';
import { listBatches, listCourses } from '../services/education.service';
import { getUsers } from '../services/userManagement.service';

const emptyLesson = {
  title: '', courseId: '', batchId: '', description: '', lessonOrder: 0, liveClassAt: '',
  zoomLink: '', recordingUrl: '', bunnyVideoId: '', bunnyEmbedUrl: '', embedCode: '',
  zoomMeetingId: '', zoomPassword: '', joinButtonLabel: 'Join Live Class',
  allowJoinBeforeMinutes: 30, allowJoinAfterMinutes: 150,
  lecturerId: '', durationMinutes: '', releaseAt: '', isPublished: false
};
const materialTypes = ['PDF', 'DOC', 'XLS', 'PPT', 'ZIP', 'Image', 'Video', 'Audio', 'External Link'];
const emptyMaterial = {
  title: '', courseId: '', batchId: '', lessonId: '', materialType: 'PDF', fileUrl: '',
  description: '', visibility: 'all_students', status: 'published', file: null
};

function materialTypeForFile(file) {
  const extension = String(file?.name || '').split('.').pop().toLowerCase();
  if (extension === 'pdf') return 'PDF';
  if (['doc', 'docx'].includes(extension)) return 'DOC';
  if (['xls', 'xlsx'].includes(extension)) return 'XLS';
  if (['ppt', 'pptx'].includes(extension)) return 'PPT';
  if (extension === 'zip') return 'ZIP';
  if (file?.type?.startsWith('image/')) return 'Image';
  if (file?.type?.startsWith('video/')) return 'Video';
  if (file?.type?.startsWith('audio/')) return 'Audio';
  return 'External Link';
}

function toInputDate(value) {
  if (!value) return '';
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

export default function LmsAdminPage({ view = 'lessons' }) {
  const [lessons, setLessons] = useState([]);
  const [courses, setCourses] = useState([]);
  const [batches, setBatches] = useState([]);
  const [users, setUsers] = useState([]);
  const [form, setForm] = useState(null);
  const [materialLesson, setMaterialLesson] = useState(null);
  const [material, setMaterial] = useState(emptyMaterial);
  const [error, setError] = useState('');

  const load = async () => {
    try {
      const [lessonRes, courseRes, batchRes, userRes] = await Promise.all([
        listLmsLessons(view === 'recordings' ? { kind: 'recordings' } : {}),
        listCourses(), listBatches(), getUsers().catch(() => ({ data: { data: [] } }))
      ]);
      setLessons(lessonRes.data.data || []);
      setCourses(courseRes.data.data || []);
      setBatches(batchRes.data.data || []);
      setUsers(userRes.data.data || []);
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Unable to load LMS content.');
    }
  };
  useEffect(() => { load(); }, [view]);

  const filteredBatches = useMemo(() => batches.filter((batch) => !form?.courseId || String(batch.courseId) === String(form.courseId)), [batches, form?.courseId]);
  const materialRows = lessons.flatMap((lesson) => (lesson.materials || []).map((item) => ({
    ...item, lessonTitle: lesson.title, course: lesson.course, batch: lesson.batch
  })));
  const rows = view === 'materials' ? materialRows : lessons;

  const save = async () => {
    try {
      const payload = {
        ...form,
        courseId: Number(form.courseId),
        batchId: form.batchId ? Number(form.batchId) : null,
        lecturerId: form.lecturerId ? Number(form.lecturerId) : null,
        lessonOrder: Number(form.lessonOrder || 0),
        durationMinutes: form.durationMinutes ? Number(form.durationMinutes) : null,
        allowJoinBeforeMinutes: Number(form.allowJoinBeforeMinutes ?? 30),
        allowJoinAfterMinutes: Number(form.allowJoinAfterMinutes ?? 150),
        liveClassAt: form.liveClassAt || null,
        releaseAt: form.releaseAt || null
      };
      if (form.id) await updateLmsLesson(form.id, payload);
      else await createLmsLesson(payload);
      setForm(null);
      await load();
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Unable to save lesson.');
    }
  };

  const saveMaterial = async () => {
    try {
      const lesson = lessons.find((item) => String(item.id) === String(material.lessonId || materialLesson?.id));
      if (!lesson) throw new Error('Select a lesson.');
      let fileUrl = material.fileUrl;
      if (material.file) {
        const upload = await uploadLmsMaterialFile(material.file);
        fileUrl = upload.data.data.fileUrl;
      }
      await addLmsMaterial(lesson.id, {
        ...material,
        courseId: lesson.courseId,
        batchId: lesson.batchId,
        fileUrl,
        fileType: material.materialType
      });
      setMaterialLesson(null);
      setMaterial(emptyMaterial);
      await load();
    } catch (requestError) {
      setError(requestError.response?.data?.message || requestError.message || 'Unable to save material.');
    }
  };

  const heading = view === 'recordings' ? 'LMS Recordings' : view === 'materials' ? 'Lesson Materials' : 'LMS Lessons';
  return <Stack spacing={2.5}>
    <Paper variant="outlined" sx={{ p: 2.5 }}>
      <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" spacing={2}>
        <Box><Typography variant="h5" fontWeight={850}>{heading}</Typography><Typography color="text.secondary">Manage live classes, recordings, release schedules, and downloadable resources.</Typography></Box>
        {view !== 'materials' ? <Button variant="contained" startIcon={<AddIcon />} onClick={() => setForm({ ...emptyLesson, isPublished: false })}>New Lesson</Button> : <Stack direction="row" spacing={1}>
          <Button variant="contained" startIcon={<AddIcon />} onClick={() => { setMaterial(emptyMaterial); setMaterialLesson({}); }}>Add Material</Button>
          <Button component="label" variant="outlined" startIcon={<UploadFileIcon />}>Upload File<input hidden type="file" onChange={(event) => { const file = event.target.files?.[0]; if (file) { setMaterial({ ...emptyMaterial, title: file.name.replace(/\.[^.]+$/, ''), materialType: materialTypeForFile(file), file }); setMaterialLesson({}); } event.target.value = ''; }} /></Button>
        </Stack>}
      </Stack>
    </Paper>
    {error && <Alert severity="error" onClose={() => setError('')}>{error}</Alert>}
    <TableContainer component={Paper} variant="outlined">
      <Table sx={{ minWidth: view === 'materials' ? 650 : 1050 }}>
        <TableHead><TableRow>
          {(view === 'materials' ? ['Title', 'Lesson', 'Type', 'File', 'Actions'] : ['Order', 'Lesson', 'Course / Batch', 'Live Class', 'Recording', 'Status', 'Actions']).map((label) => <TableCell key={label}>{label}</TableCell>)}
        </TableRow></TableHead>
        <TableBody>
          {view === 'materials' ? rows.map((row) => <TableRow key={row.id}>
            <TableCell><Typography fontWeight={750}>{row.title}</Typography><Typography variant="caption" color="text.secondary">{row.status || 'published'}</Typography></TableCell><TableCell>{row.lessonTitle}<br /><Typography variant="caption">{row.course?.name} · {row.batch?.name || 'All batches'}</Typography></TableCell><TableCell>{row.materialType || row.fileType || '-'}</TableCell>
            <TableCell><Button component="a" href={row.fileUrl} target="_blank" startIcon={<LinkIcon />}>Open</Button></TableCell>
            <TableCell><IconButton color="error" onClick={async () => { await deleteLmsMaterial(row.id); await load(); }}><DeleteOutlineIcon /></IconButton></TableCell>
          </TableRow>) : rows.map((row) => <TableRow key={row.id}>
            <TableCell>{row.lessonOrder}</TableCell>
            <TableCell><Typography fontWeight={800}>{row.title}</Typography><Typography variant="caption" color="text.secondary">{row.lecturer ? `${row.lecturer.firstName || ''} ${row.lecturer.lastName || ''}` : 'No lecturer'}</Typography></TableCell>
            <TableCell>{row.course?.name}<br /><Typography variant="caption">{row.batch?.name || 'All batches'}</Typography></TableCell>
            <TableCell>{row.liveClassAt ? new Date(row.liveClassAt).toLocaleString() : '-'}</TableCell>
            <TableCell>{row.bunnyVideoId || row.bunnyEmbedUrl || row.recordingUrl ? <Chip size="small" color="primary" label="Available" /> : '-'}</TableCell>
            <TableCell><Chip size="small" color={row.isPublished ? 'success' : 'default'} label={row.isPublished ? 'Published' : 'Draft'} /></TableCell>
            <TableCell><Stack direction="row">
              <Tooltip title="Edit"><IconButton onClick={() => setForm({ ...row, liveClassAt: toInputDate(row.liveClassAt), releaseAt: toInputDate(row.releaseAt) })}><EditIcon /></IconButton></Tooltip>
              <Tooltip title="Add material"><IconButton onClick={() => { setMaterial({ ...emptyMaterial, courseId: row.courseId, batchId: row.batchId || '', lessonId: row.id }); setMaterialLesson(row); }}><LinkIcon /></IconButton></Tooltip>
              <Tooltip title={row.isPublished ? 'Unpublish' : 'Publish'}><IconButton color="primary" onClick={async () => { await publishLmsLesson(row.id, !row.isPublished); await load(); }}><PublishIcon /></IconButton></Tooltip>
              <Tooltip title="Delete"><IconButton color="error" onClick={async () => { if (window.confirm('Delete this lesson and its progress?')) { await deleteLmsLesson(row.id); await load(); } }}><DeleteOutlineIcon /></IconButton></Tooltip>
            </Stack></TableCell>
          </TableRow>)}
          {!rows.length && <TableRow><TableCell colSpan={7} sx={{ py: 6, textAlign: 'center' }}>No LMS content found.</TableCell></TableRow>}
        </TableBody>
      </Table>
    </TableContainer>

    <Dialog open={Boolean(form)} onClose={() => setForm(null)} fullWidth maxWidth="md">
      <DialogTitle>{form?.id ? 'Edit Lesson' : 'Create Lesson'}</DialogTitle>
      {form && <DialogContent dividers><Stack spacing={2}>
        <TextField label="Title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required />
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
          <TextField select label="Course" value={form.courseId} onChange={(e) => setForm({ ...form, courseId: e.target.value, batchId: '' })} fullWidth required>{courses.map((row) => <MenuItem key={row.id} value={row.id}>{row.name}</MenuItem>)}</TextField>
          <TextField select label="Batch" value={form.batchId || ''} onChange={(e) => setForm({ ...form, batchId: e.target.value })} fullWidth><MenuItem value="">All batches</MenuItem>{filteredBatches.map((row) => <MenuItem key={row.id} value={row.id}>{row.name}</MenuItem>)}</TextField>
          <TextField label="Order" type="number" value={form.lessonOrder} onChange={(e) => setForm({ ...form, lessonOrder: e.target.value })} sx={{ width: 120 }} />
        </Stack>
        <TextField label="Description" value={form.description || ''} onChange={(e) => setForm({ ...form, description: e.target.value })} multiline minRows={3} />
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
          <TextField label="Live class date/time" type="datetime-local" value={form.liveClassAt || ''} onChange={(e) => setForm({ ...form, liveClassAt: e.target.value })} InputLabelProps={{ shrink: true }} fullWidth />
          <TextField select label="Lecturer" value={form.lecturerId || ''} onChange={(e) => setForm({ ...form, lecturerId: e.target.value })} fullWidth><MenuItem value="">Not assigned</MenuItem>{users.map((row) => <MenuItem key={row.id} value={row.id}>{row.name || `${row.firstName || ''} ${row.lastName || ''}`}</MenuItem>)}</TextField>
        </Stack>
        <Alert severity="info">Zoom credentials are private and are only released by the secure LMS join endpoint after access checks.</Alert>
        <TextField label="Zoom link (admin / lecturer only)" value={form.zoomLink || ''} onChange={(e) => setForm({ ...form, zoomLink: e.target.value })} />
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
          <TextField label="Zoom meeting ID (optional)" value={form.zoomMeetingId || ''} onChange={(e) => setForm({ ...form, zoomMeetingId: e.target.value })} fullWidth />
          <TextField label="Zoom password (optional)" type="password" value={form.zoomPassword || ''} onChange={(e) => setForm({ ...form, zoomPassword: e.target.value })} fullWidth />
        </Stack>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
          <TextField label="Join button label" value={form.joinButtonLabel || 'Join Live Class'} onChange={(e) => setForm({ ...form, joinButtonLabel: e.target.value })} fullWidth />
          <TextField label="Allow before (minutes)" type="number" value={form.allowJoinBeforeMinutes ?? 30} onChange={(e) => setForm({ ...form, allowJoinBeforeMinutes: e.target.value })} fullWidth />
          <TextField label="Allow after (minutes)" type="number" value={form.allowJoinAfterMinutes ?? 150} onChange={(e) => setForm({ ...form, allowJoinAfterMinutes: e.target.value })} fullWidth />
        </Stack>
        <TextField label="Recording URL" value={form.recordingUrl || ''} onChange={(e) => setForm({ ...form, recordingUrl: e.target.value })} />
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
          <TextField label="Bunny video ID" value={form.bunnyVideoId || ''} onChange={(e) => setForm({ ...form, bunnyVideoId: e.target.value })} fullWidth />
          <TextField label="Bunny embed URL" value={form.bunnyEmbedUrl || ''} onChange={(e) => setForm({ ...form, bunnyEmbedUrl: e.target.value })} fullWidth />
        </Stack>
        <TextField label="Bunny embed code (stored for reference)" value={form.embedCode || ''} onChange={(e) => setForm({ ...form, embedCode: e.target.value })} multiline minRows={2} />
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
          <TextField label="Duration (minutes)" type="number" value={form.durationMinutes || ''} onChange={(e) => setForm({ ...form, durationMinutes: e.target.value })} fullWidth />
          <TextField label="Drip release date" type="datetime-local" value={form.releaseAt || ''} onChange={(e) => setForm({ ...form, releaseAt: e.target.value })} InputLabelProps={{ shrink: true }} fullWidth />
        </Stack>
        <FormControlLabel control={<Switch checked={Boolean(form.isPublished)} onChange={(e) => setForm({ ...form, isPublished: e.target.checked })} />} label="Published" />
      </Stack></DialogContent>}
      <DialogActions><Button onClick={() => setForm(null)}>Cancel</Button><Button variant="contained" onClick={save} disabled={!form?.title || !form?.courseId}>Save</Button></DialogActions>
    </Dialog>
    <Dialog open={Boolean(materialLesson)} onClose={() => setMaterialLesson(null)} fullWidth maxWidth="md">
      <DialogTitle>Add Lesson Material</DialogTitle>
      <DialogContent dividers><Stack spacing={2}>
        <TextField label="Title" value={material.title} onChange={(e) => setMaterial({ ...material, title: e.target.value })} required />
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
          <TextField select label="Course" value={material.courseId} onChange={(e) => setMaterial({ ...material, courseId: e.target.value, batchId: '', lessonId: '' })} fullWidth required>{courses.map((row) => <MenuItem key={row.id} value={row.id}>{row.name}</MenuItem>)}</TextField>
          <TextField select label="Batch (optional)" value={material.batchId} onChange={(e) => setMaterial({ ...material, batchId: e.target.value, lessonId: '' })} fullWidth><MenuItem value="">All batches</MenuItem>{batches.filter((row) => String(row.courseId) === String(material.courseId)).map((row) => <MenuItem key={row.id} value={row.id}>{row.name}</MenuItem>)}</TextField>
          <TextField select label="Lesson" value={material.lessonId} onChange={(e) => { const lesson = lessons.find((row) => String(row.id) === String(e.target.value)); setMaterial({ ...material, lessonId: e.target.value, courseId: lesson?.courseId || material.courseId, batchId: lesson?.batchId || '' }); }} fullWidth required>{lessons.filter((row) => (!material.courseId || String(row.courseId) === String(material.courseId)) && (!material.batchId || String(row.batchId || '') === String(material.batchId))).map((row) => <MenuItem key={row.id} value={row.id}>{row.title}</MenuItem>)}</TextField>
        </Stack>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
          <TextField select label="Material Type" value={material.materialType} onChange={(e) => setMaterial({ ...material, materialType: e.target.value })} fullWidth>{materialTypes.map((type) => <MenuItem key={type} value={type}>{type}</MenuItem>)}</TextField>
          <TextField select label="Visibility" value={material.visibility} onChange={(e) => setMaterial({ ...material, visibility: e.target.value })} fullWidth><MenuItem value="all_students">All students</MenuItem><MenuItem value="specific_course">Specific course</MenuItem><MenuItem value="specific_batch">Specific batch</MenuItem></TextField>
          <TextField select label="Status" value={material.status} onChange={(e) => setMaterial({ ...material, status: e.target.value })} fullWidth><MenuItem value="draft">Draft</MenuItem><MenuItem value="published">Published</MenuItem></TextField>
        </Stack>
        <Button component="label" variant="outlined" startIcon={<UploadFileIcon />}>{material.file ? material.file.name : 'Choose File'}<input hidden type="file" onChange={(event) => { const file = event.target.files?.[0]; if (file) setMaterial({ ...material, file, materialType: materialTypeForFile(file), title: material.title || file.name.replace(/\.[^.]+$/, '') }); }} /></Button>
        <Typography variant="caption" color="text.secondary" textAlign="center">OR</Typography>
        <TextField label="External URL" value={material.fileUrl} onChange={(e) => setMaterial({ ...material, fileUrl: e.target.value, materialType: material.file ? material.materialType : 'External Link' })} placeholder="https://..." />
        <TextField label="Description" value={material.description} onChange={(e) => setMaterial({ ...material, description: e.target.value })} multiline minRows={3} />
      </Stack></DialogContent>
      <DialogActions><Button onClick={() => setMaterialLesson(null)}>Cancel</Button><Button variant="contained" onClick={saveMaterial} disabled={!material.title || !material.lessonId || (!material.file && !material.fileUrl)}>Save</Button></DialogActions>
    </Dialog>
  </Stack>;
}
