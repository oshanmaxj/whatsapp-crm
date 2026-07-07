import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert, Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle,
  FormControlLabel, MenuItem, Paper, Stack, Switch, TextField, Typography
} from '@mui/material';
import PreviewIcon from '@mui/icons-material/Preview';
import SaveIcon from '@mui/icons-material/Save';
import SendIcon from '@mui/icons-material/Send';
import {
  listStudentMessageTemplates, previewStudentMessageTemplate,
  testStudentMessageTemplate, updateStudentMessageTemplate
} from '../services/studentMessageTemplate.service';

const categories = ['Student', 'Payment', 'Class', 'Certificate', 'Internal'];

export default function StudentMessageTemplatesPage() {
  const [templates, setTemplates] = useState([]);
  const [variables, setVariables] = useState([]);
  const [category, setCategory] = useState('Student');
  const [editing, setEditing] = useState(null);
  const [preview, setPreview] = useState(null);
  const [testPhone, setTestPhone] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const load = async () => {
    try {
      const response = await listStudentMessageTemplates();
      setTemplates(response.data.data.templates || []);
      setVariables(response.data.data.variables || []);
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Unable to load message templates.');
    }
  };
  useEffect(() => { load(); }, []);
  const rows = useMemo(() => templates.filter((item) => item.category === category), [templates, category]);

  const save = async () => {
    try {
      let buttons;
      try { buttons = JSON.parse(editing.buttonsText || '[]'); } catch { throw new Error('Buttons must be valid JSON.'); }
      await updateStudentMessageTemplate(editing.id, {
        title: editing.title, category: editing.category, body: editing.body, buttons,
        isActive: editing.isActive, automationEnabled: editing.automationEnabled
      });
      setEditing(null); setNotice('Message template saved.'); await load();
    } catch (requestError) {
      setError(requestError.response?.data?.message || requestError.message || 'Unable to save template.');
    }
  };

  const showPreview = async (template) => {
    try {
      const response = await previewStudentMessageTemplate(template.key, {
        student_name: 'Sample Student', registration_number: 'STU-001', course_name: 'Sample Course',
        batch_name: 'July Batch', email: 'student@example.com', class_date: '10/07/2026',
        class_time: '07:00 PM', lesson_id: '42', lesson_name: 'Introduction',
        payment_amount: 'LKR 10,000', installment_no: '2', installment_due_date: '15/07/2026'
      });
      setPreview({ key: template.key, title: template.title, ...response.data.data });
    } catch (requestError) { setError(requestError.response?.data?.message || 'Unable to preview template.'); }
  };

  const sendTest = async () => {
    try {
      await testStudentMessageTemplate(preview.key || editing?.key, { phone: testPhone });
      setNotice('Test message queued.'); setPreview(null);
    } catch (requestError) { setError(requestError.response?.data?.message || 'Unable to queue test message.'); }
  };

  return <Stack spacing={2.5}>
    <Paper variant="outlined" sx={{ p: 2.5 }}>
      <Typography variant="h5" fontWeight={850}>Student Automation Messages</Typography>
      <Typography color="text.secondary">Edit lifecycle WhatsApp messages, preview variables, and enable or disable each automation.</Typography>
    </Paper>
    {notice && <Alert severity="success" onClose={() => setNotice('')}>{notice}</Alert>}
    {error && <Alert severity="error" onClose={() => setError('')}>{error}</Alert>}
    <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
      {categories.map((name) => <Button key={name} variant={category === name ? 'contained' : 'outlined'} onClick={() => setCategory(name)}>{name}</Button>)}
    </Stack>
    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: 'repeat(2, 1fr)' }, gap: 2 }}>
      {rows.map((template) => <Paper key={template.id} variant="outlined" sx={{ p: 2.5 }}>
        <Stack spacing={1.5}>
          <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
            <Box><Typography variant="h6" fontWeight={850}>{template.title}</Typography><Typography variant="caption" color="text.secondary">{template.key} · {template.channel}</Typography></Box>
            <Stack direction="row" spacing={0.5}><Chip size="small" color={template.isActive ? 'success' : 'default'} label={template.isActive ? 'Active' : 'Inactive'} /><Chip size="small" color={template.automationEnabled ? 'primary' : 'default'} label={template.automationEnabled ? 'Auto' : 'Manual'} /></Stack>
          </Stack>
          <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', maxHeight: 170, overflow: 'auto' }}>{template.body}</Typography>
          <Stack direction="row" spacing={1}><Button startIcon={<SaveIcon />} onClick={() => setEditing({ ...template, buttonsText: JSON.stringify(template.buttons || [], null, 2) })}>Edit</Button><Button startIcon={<PreviewIcon />} onClick={() => { setPreview({ key: template.key, title: template.title, loading: true }); showPreview(template); }}>Preview / Test</Button></Stack>
        </Stack>
      </Paper>)}
      {!rows.length && <Paper variant="outlined" sx={{ p: 5, textAlign: 'center', color: 'text.secondary' }}>No templates in this category.</Paper>}
    </Box>
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Typography fontWeight={800}>Supported variables</Typography>
      <Stack direction="row" spacing={0.75} useFlexGap flexWrap="wrap" sx={{ mt: 1 }}>{variables.map((name) => <Chip key={name} size="small" label={`{{${name}}}`} />)}</Stack>
    </Paper>

    <Dialog open={Boolean(editing)} onClose={() => setEditing(null)} fullWidth maxWidth="md">
      <DialogTitle>Edit {editing?.title}</DialogTitle>
      {editing && <DialogContent dividers><Stack spacing={2}>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}><TextField label="Title" value={editing.title} onChange={(e) => setEditing({ ...editing, title: e.target.value })} fullWidth /><TextField select label="Category" value={editing.category} onChange={(e) => setEditing({ ...editing, category: e.target.value })} fullWidth>{categories.map((name) => <MenuItem key={name} value={name}>{name}</MenuItem>)}</TextField></Stack>
        <TextField label="Key" value={editing.key} disabled helperText="Keys are stable automation identifiers." />
        <TextField label="Body" value={editing.body} onChange={(e) => setEditing({ ...editing, body: e.target.value })} multiline minRows={10} />
        <TextField label="Buttons JSON (optional)" value={editing.buttonsText} onChange={(e) => setEditing({ ...editing, buttonsText: e.target.value })} multiline minRows={4} helperText='Example: [{"type":"url","title":"Open LMS","url":"{{portal_url}}"}]' />
        <Stack direction="row" spacing={2}><FormControlLabel control={<Switch checked={Boolean(editing.isActive)} onChange={(e) => setEditing({ ...editing, isActive: e.target.checked })} />} label="Template active" /><FormControlLabel control={<Switch checked={Boolean(editing.automationEnabled)} onChange={(e) => setEditing({ ...editing, automationEnabled: e.target.checked })} />} label="Automation enabled" /></Stack>
      </Stack></DialogContent>}
      <DialogActions><Button onClick={() => setEditing(null)}>Cancel</Button><Button variant="contained" startIcon={<SaveIcon />} onClick={save}>Save</Button></DialogActions>
    </Dialog>

    <Dialog open={Boolean(preview)} onClose={() => setPreview(null)} fullWidth maxWidth="sm">
      <DialogTitle>Preview · {preview?.title}</DialogTitle>
      <DialogContent dividers><Stack spacing={2}>
        <Paper variant="outlined" sx={{ p: 2, bgcolor: 'action.hover' }}><Typography sx={{ whiteSpace: 'pre-wrap' }}>{preview?.loading ? 'Loading preview…' : preview?.text}</Typography></Paper>
        <TextField label="Test WhatsApp number" value={testPhone} onChange={(e) => setTestPhone(e.target.value)} placeholder="9477..." helperText="The rendered preview will be added to the WhatsApp queue." />
      </Stack></DialogContent>
      <DialogActions><Button onClick={() => setPreview(null)}>Close</Button><Button variant="contained" startIcon={<SendIcon />} disabled={!testPhone || preview?.loading} onClick={sendTest}>Send Test</Button></DialogActions>
    </Dialog>
  </Stack>;
}
