import React, { useEffect, useState } from 'react';
import {
  Alert, Box, Button, Chip, FormControlLabel, MenuItem, Paper, Stack, Switch,
  TextField, Typography
} from '@mui/material';
import PreviewOutlinedIcon from '@mui/icons-material/PreviewOutlined';
import SaveOutlinedIcon from '@mui/icons-material/SaveOutlined';
import {
  listNotificationTemplates, previewNotificationTemplate, updateNotificationTemplate
} from '../services/notificationTemplate.service';
import { hasPermission } from '../utils/access';

const VARIABLES = [
  '{{student.name}}', '{{student.phone}}', '{{course.name}}', '{{batch.name}}',
  '{{fee.amount}}', '{{payment.amount}}', '{{payment.date}}', '{{payment.method}}',
  '{{installment.no}}', '{{installment.due_date}}', '{{zoom.link}}',
  '{{class.date}}', '{{class.time}}', '{{company.name}}', '{{agent.name}}'
];

const PREVIEW_VALUES = {
  student: { name: 'Nimali Perera', phone: '0771234567' },
  course: { name: 'Digital Marketing' },
  batch: { name: 'July 2026' },
  fee: { amount: '6000.00' },
  payment: { amount: '6000.00', date: '2026-07-04', method: 'Bank Transfer' },
  installment: { no: 1, due_date: '2026-07-04' },
  zoom: { link: 'https://zoom.us/j/example' },
  class: { date: '2026-07-05', time: '6:00 PM' },
  company: { name: 'First Of Education International' },
  agent: { name: 'Accounts Team' }
};

export default function NotificationMessageTemplatesPage() {
  const [templates, setTemplates] = useState([]);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [previews, setPreviews] = useState({});
  const canEdit = hasPermission('settings.edit');

  const load = () => listNotificationTemplates()
    .then((response) => setTemplates(response.data.data || []))
    .catch((err) => setError(err.response?.data?.message || 'Unable to load message templates.'));

  useEffect(() => { load(); }, []);

  const updateLocal = (id, changes) => setTemplates((current) => current.map((item) => (
    item.id === id ? { ...item, ...changes } : item
  )));

  const save = async (template) => {
    try {
      await updateNotificationTemplate(template.id, {
        title: template.title, channel: template.channel, body: template.body, isActive: template.isActive
      });
      setNotice(`${template.title} saved.`);
      await load();
    } catch (err) {
      setError(err.response?.data?.message || 'Unable to save message template.');
    }
  };

  const preview = async (template) => {
    try {
      const response = await previewNotificationTemplate(template.key, PREVIEW_VALUES);
      setPreviews((current) => ({ ...current, [template.key]: response.data.data.rendered }));
    } catch (err) {
      setError(err.response?.data?.message || 'Unable to preview message template.');
    }
  };

  return (
    <Stack spacing={2.5}>
      {notice && <Alert severity="success" onClose={() => setNotice('')}>{notice}</Alert>}
      {error && <Alert severity="error" onClose={() => setError('')}>{error}</Alert>}
      <Paper sx={{ p: 2.5, border: '1px solid #e8edf2' }} elevation={0}>
        <Typography variant="h5" fontWeight={850}>Notification Message Templates</Typography>
        <Typography color="text.secondary">Edit reusable WhatsApp, email, and SMS wording used by notifications.</Typography>
        <Stack direction="row" gap={1} flexWrap="wrap" sx={{ mt: 2 }}>
          {VARIABLES.map((variable) => <Chip key={variable} size="small" label={variable} variant="outlined" />)}
        </Stack>
      </Paper>
      {templates.map((template) => (
        <Paper key={template.id} sx={{ p: 2.5, border: '1px solid #e8edf2' }} elevation={0}>
          <Stack spacing={2}>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <TextField label="Title" value={template.title} onChange={(event) => updateLocal(template.id, { title: event.target.value })} fullWidth disabled={!canEdit} />
              <TextField select label="Channel" value={template.channel} onChange={(event) => updateLocal(template.id, { channel: event.target.value })} sx={{ minWidth: 180 }} disabled={!canEdit}>
                {['whatsapp', 'email', 'sms'].map((channel) => <MenuItem key={channel} value={channel}>{channel}</MenuItem>)}
              </TextField>
            </Stack>
            <TextField label="Message body" value={template.body} onChange={(event) => updateLocal(template.id, { body: event.target.value })} multiline minRows={4} fullWidth disabled={!canEdit} />
            <Stack direction="row" spacing={1} alignItems="center">
              <FormControlLabel control={<Switch checked={Boolean(template.isActive)} onChange={(event) => updateLocal(template.id, { isActive: event.target.checked })} disabled={!canEdit} />} label="Active" />
              <Box sx={{ flex: 1 }} />
              <Button startIcon={<PreviewOutlinedIcon />} onClick={() => preview(template)}>Preview</Button>
              {canEdit && <Button variant="contained" startIcon={<SaveOutlinedIcon />} onClick={() => save(template)}>Save</Button>}
            </Stack>
            {previews[template.key] && <Alert severity="info" icon={false} sx={{ whiteSpace: 'pre-wrap' }}>{previews[template.key]}</Alert>}
          </Stack>
        </Paper>
      ))}
    </Stack>
  );
}
