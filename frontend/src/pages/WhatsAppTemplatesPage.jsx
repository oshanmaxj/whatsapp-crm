import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert, Box, Button, Chip, Divider, Dialog, DialogActions, DialogContent, DialogTitle, FormControl, Grid, IconButton, InputLabel, LinearProgress, MenuItem, Select,
  Paper, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TextField, Typography
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import CloudSyncIcon from '@mui/icons-material/CloudSync';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import DescriptionIcon from '@mui/icons-material/Description';
import EditIcon from '@mui/icons-material/Edit';
import ImageIcon from '@mui/icons-material/Image';
import InsertLinkIcon from '@mui/icons-material/InsertLink';
import LocalPhoneIcon from '@mui/icons-material/LocalPhone';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import PlayCircleOutlineIcon from '@mui/icons-material/PlayCircleOutline';
import ReplyIcon from '@mui/icons-material/Reply';
import SendIcon from '@mui/icons-material/Send';
import {
  createWhatsAppTemplate,
  deleteWhatsAppTemplate,
  listWhatsAppTemplates,
  submitWhatsAppTemplate,
  syncWhatsAppTemplates,
  uploadWhatsAppTemplateSample,
  updateWhatsAppTemplate
} from '../services/whatsappTemplate.service';
import WhatsAppAccountSelect from '../components/WhatsAppAccountSelect';

const initialForm = {
  name: '',
  category: 'UTILITY',
  language: 'en_US',
  headerType: 'NONE',
  headerContent: '',
  body: '',
  footer: '',
  buttons: [],
  variablesText: '',
  status: 'DRAFT',
  qualityRating: 'UNKNOWN',
  whatsappAccountId: ''
};

const buttonTypes = ['QUICK_REPLY', 'URL', 'PHONE_NUMBER', 'COPY_CODE'];
const sampleVariables = {
  student_name: 'Nimal Perera',
  course_name: 'Forex Master Class',
  batch_name: 'Batch 124',
  amount: 'Rs.6000',
  due_date: '2026-07-05',
  class_date: '2026-07-10',
  class_time: '8.30 PM',
  lecturer_name: 'Oshan Mihira',
  zoom_link: 'https://zoom.us/example'
};

function parseJsonArray(value, fallback = []) {
  if (!String(value || '').trim()) return fallback;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function normalizeButton(button = {}) {
  const type = String(button.type || 'QUICK_REPLY').toUpperCase();
  const text = button.text || button.title || button.label || '';
  if (type === 'URL') return { type, text, url: button.url || '' };
  if (type === 'PHONE_NUMBER') return { type, text, phone_number: button.phone_number || button.phoneNumber || '' };
  if (type === 'COPY_CODE') return { type, example: button.example || button.code || button.text || '' };
  return { type: 'QUICK_REPLY', text };
}

function normalizeButtons(buttons) {
  return Array.isArray(buttons) ? buttons.map(normalizeButton) : [];
}

function validateButtons(buttons = []) {
  const counts = buttons.reduce((acc, button) => ({ ...acc, [button.type]: (acc[button.type] || 0) + 1 }), {});
  const ctaCount = (counts.URL || 0) + (counts.PHONE_NUMBER || 0);
  if ((counts.QUICK_REPLY || 0) > 3) return 'Quick Reply buttons cannot exceed 3.';
  if (ctaCount > 2) return 'Call To Action buttons cannot exceed 2 total.';
  if ((counts.URL || 0) > 2) return 'URL buttons cannot exceed 2.';
  if ((counts.PHONE_NUMBER || 0) > 1) return 'Phone buttons cannot exceed 1.';
  if ((counts.COPY_CODE || 0) > 1) return 'Copy code buttons cannot exceed 1.';
  for (const button of buttons) {
    if (button.type !== 'COPY_CODE' && !String(button.text || '').trim()) return `${button.type} button label is required.`;
    if (button.type === 'URL' && !String(button.url || '').trim()) return 'URL button requires a URL.';
    if (button.type === 'PHONE_NUMBER' && !String(button.phone_number || '').trim()) return 'Phone button requires a phone number.';
    if (button.type === 'COPY_CODE' && !String(button.example || '').trim()) return 'Copy code button requires a code example.';
  }
  return '';
}

function nextButton(type = 'QUICK_REPLY') {
  return normalizeButton({ type, text: type === 'COPY_CODE' ? '' : 'Button' });
}

function ButtonBuilder({ buttons, onChange }) {
  const addButton = (type) => onChange([...buttons, nextButton(type)]);
  const updateButton = (index, patch) => onChange(buttons.map((button, itemIndex) => (itemIndex === index ? normalizeButton({ ...button, ...patch }) : button)));
  const removeButton = (index) => onChange(buttons.filter((_, itemIndex) => itemIndex !== index));
  const validation = validateButtons(buttons);

  return (
    <Stack spacing={1.5}>
      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
        {buttonTypes.map((type) => <Button key={type} size="small" variant="outlined" startIcon={<AddIcon />} onClick={() => addButton(type)}>{type.replace('_', ' ')}</Button>)}
      </Stack>
      {validation && <Alert severity="warning">{validation}</Alert>}
      {buttons.map((button, index) => (
        <Paper key={`${button.type}-${index}`} elevation={0} sx={{ p: 1.5, border: '1px solid', borderColor: 'divider' }}>
          <Grid container spacing={1.5} alignItems="center">
            <Grid item xs={12} md={3}>
              <FormControl fullWidth size="small">
                <InputLabel>Type</InputLabel>
                <Select label="Type" value={button.type} onChange={(event) => updateButton(index, { type: event.target.value })}>
                  {buttonTypes.map((type) => <MenuItem key={type} value={type}>{type}</MenuItem>)}
                </Select>
              </FormControl>
            </Grid>
            {button.type !== 'COPY_CODE' && <Grid item xs={12} md={3}><TextField size="small" label="Label" value={button.text || ''} onChange={(event) => updateButton(index, { text: event.target.value })} fullWidth /></Grid>}
            {button.type === 'URL' && <Grid item xs={12} md={5}><TextField size="small" label="URL" value={button.url || ''} onChange={(event) => updateButton(index, { url: event.target.value })} fullWidth /></Grid>}
            {button.type === 'PHONE_NUMBER' && <Grid item xs={12} md={5}><TextField size="small" label="Phone Number" value={button.phone_number || ''} onChange={(event) => updateButton(index, { phone_number: event.target.value })} fullWidth /></Grid>}
            {button.type === 'COPY_CODE' && <Grid item xs={12} md={8}><TextField size="small" label="Copy Code Example" value={button.example || ''} onChange={(event) => updateButton(index, { example: event.target.value })} fullWidth /></Grid>}
            <Grid item xs={12} md={1}>
              <IconButton color="error" onClick={() => removeButton(index)} aria-label="Remove button"><DeleteOutlineIcon /></IconButton>
            </Grid>
          </Grid>
        </Paper>
      ))}
      {buttons.length === 0 && <Typography color="text.secondary">No buttons added.</Typography>}
    </Stack>
  );
}

function renderSampleVariables(text = '') {
  return String(text || '').replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (_, key) => sampleVariables[key] || `{{${key}}}`);
}

function HeaderPreview({ form }) {
  const type = form.headerType || 'NONE';
  if (type === 'NONE') return null;
  if (type === 'TEXT') {
    return <Typography fontWeight={900} sx={{ mb: 1, lineHeight: 1.35 }}>{renderSampleVariables(form.headerContent || 'Template header')}</Typography>;
  }

  const media = {
    IMAGE: { icon: <ImageIcon sx={{ fontSize: 42 }} />, label: 'Image header preview', detail: 'Template media image' },
    VIDEO: { icon: <PlayCircleOutlineIcon sx={{ fontSize: 46 }} />, label: 'Video header preview', detail: 'Template media video' },
    DOCUMENT: { icon: <DescriptionIcon sx={{ fontSize: 42 }} />, label: 'Document header preview', detail: form.headerContent || 'Document attachment' }
  }[type];

  return (
    <Box sx={{ mb: 1.25, height: 138, borderRadius: 2, display: 'grid', placeItems: 'center', textAlign: 'center', bgcolor: 'action.hover', color: 'text.secondary', border: '1px dashed', borderColor: 'divider' }}>
      <Box>
        {media?.icon}
        <Typography fontWeight={850} color="text.primary">{media?.label}</Typography>
        <Typography variant="caption">{media?.detail}</Typography>
      </Box>
    </Box>
  );
}

function PreviewButton({ button }) {
  const commonSx = { justifyContent: 'center', bgcolor: 'background.paper', borderTop: '1px solid', borderColor: 'divider', borderRadius: 0, py: 1 };
  if (button.type === 'URL') return <Button fullWidth startIcon={<InsertLinkIcon />} sx={commonSx}>{button.text || 'Visit Website'}</Button>;
  if (button.type === 'PHONE_NUMBER') return <Button fullWidth startIcon={<LocalPhoneIcon />} sx={commonSx}>{button.text || 'Call'}</Button>;
  if (button.type === 'COPY_CODE') return <Button fullWidth startIcon={<ContentCopyIcon />} sx={commonSx}>{button.example ? `Copy Code: ${button.example}` : 'Copy Code'}</Button>;
  return <Button fullWidth startIcon={<ReplyIcon />} sx={commonSx}>{button.text || 'Quick Reply'}</Button>;
}

function WhatsAppPreview({ form }) {
  const renderedBody = renderSampleVariables(form.body || 'Hello {{student_name}}, your class for {{course_name}} starts on {{class_date}} at {{class_time}}.');
  const renderedFooter = renderSampleVariables(form.footer || '');

  return (
    <Paper elevation={0} sx={{ p: 2, border: '1px solid', borderColor: 'divider', bgcolor: 'background.default', position: { md: 'sticky' }, top: 16 }}>
      <Typography variant="subtitle2" fontWeight={850} sx={{ mb: 1.5 }}>Phone Preview</Typography>
      <Box sx={{ mx: 'auto', width: '100%', maxWidth: 340, borderRadius: '30px', p: 1, bgcolor: (theme) => theme.palette.mode === 'dark' ? '#050807' : '#101010', boxShadow: 6 }}>
        <Box sx={{ borderRadius: '24px', overflow: 'hidden', bgcolor: (theme) => theme.palette.mode === 'dark' ? '#111b21' : '#efeae2', minHeight: 620 }}>
          <Box sx={{ height: 28, bgcolor: (theme) => theme.palette.mode === 'dark' ? '#0b141a' : '#075e54', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Box sx={{ width: 76, height: 5, borderRadius: 999, bgcolor: 'rgba(255,255,255,0.75)' }} />
          </Box>
          <Box sx={{ px: 1.5, py: 1.25, bgcolor: (theme) => theme.palette.mode === 'dark' ? '#202c33' : '#075e54', color: '#fff' }}>
            <Stack direction="row" spacing={1.25} alignItems="center">
              <Box sx={{ width: 38, height: 38, borderRadius: '50%', bgcolor: 'rgba(255,255,255,0.22)', display: 'grid', placeItems: 'center', fontWeight: 900 }}>FO</Box>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography fontWeight={850} noWrap>First Of Education</Typography>
                <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.76)' }} noWrap>online</Typography>
              </Box>
            </Stack>
          </Box>
          <Box sx={{ p: 1.5, minHeight: 520, backgroundImage: (theme) => theme.palette.mode === 'dark' ? 'linear-gradient(#0b141a, #0b141a)' : 'linear-gradient(#efeae2, #efeae2)' }}>
            <Box sx={{ maxWidth: 282, ml: 'auto', borderRadius: '8px 8px 2px 8px', overflow: 'hidden', bgcolor: (theme) => theme.palette.mode === 'dark' ? '#005c4b' : '#d9fdd3', color: 'text.primary', boxShadow: 2 }}>
              <Box sx={{ p: 1.25 }}>
                <HeaderPreview form={form} />
                <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', lineHeight: 1.45 }}>{renderedBody}</Typography>
                {renderedFooter && <Typography variant="caption" sx={{ display: 'block', mt: 1.25, color: (theme) => theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.68)' : 'text.secondary' }}>{renderedFooter}</Typography>}
                <Typography variant="caption" sx={{ display: 'block', mt: 1, textAlign: 'right', color: (theme) => theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.68)' : 'text.secondary' }}>8:30 PM</Typography>
              </Box>
              {form.buttons.length > 0 && <Divider />}
              <Stack spacing={0}>
                {form.buttons.map((button, index) => <PreviewButton key={`${button.type}-${index}`} button={button} />)}
              </Stack>
            </Box>
          </Box>
        </Box>
      </Box>
    </Paper>
  );
}

function WhatsAppTemplatesPage() {
  const [rows, setRows] = useState([]);
  const [filters, setFilters] = useState({ status: '', language: '', category: '', whatsappAccountId: '' });
  const [form, setForm] = useState(initialForm);
  const [editing, setEditing] = useState(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const filteredRows = useMemo(() => rows
    .filter((row) => !filters.status || row.status === filters.status)
    .filter((row) => !filters.language || row.language === filters.language)
    .filter((row) => !filters.category || row.category === filters.category), [rows, filters]);

  const load = async () => {
    try {
      setLoading(true);
      setError('');
      const response = await listWhatsAppTemplates(filters);
      setRows(response.data.data || []);
    } catch (err) {
      setError(err.response?.data?.message || 'Unable to load WhatsApp templates.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [filters.whatsappAccountId]);

  const openCreate = () => {
    setEditing(null);
    setForm({ ...initialForm, buttons: [], whatsappAccountId: filters.whatsappAccountId });
    setDialogOpen(true);
  };

  const openEdit = (row) => {
    setEditing(row);
    setForm({
      name: row.name || '',
      category: row.category || 'UTILITY',
      language: row.language || 'en_US',
      headerType: row.headerType || 'NONE',
      headerContent: row.headerContent || '',
      body: row.body || '',
      footer: row.footer || '',
      buttons: normalizeButtons(row.buttons || []),
      variablesText: JSON.stringify(row.variables || [], null, 2),
      status: row.status || 'DRAFT',
      qualityRating: row.qualityRating || 'UNKNOWN'
      , whatsappAccountId: row.whatsappAccountId || filters.whatsappAccountId
    });
    setDialogOpen(true);
  };

  const save = async () => {
    try {
      if (!/^[a-z][a-z0-9_]*$/.test(form.name.trim())) {
        return setError('Template name must use lowercase snake_case.');
      }
      if (!form.body.trim()) return setError('Template body is required.');
      if (['IMAGE', 'VIDEO', 'DOCUMENT'].includes(form.headerType) && !form.headerContent.trim()) {
        return setError(`${form.headerType} header requires a sample media handle or URL.`);
      }
      const buttonError = validateButtons(form.buttons);
      if (buttonError) return setError(buttonError);
      const payload = {
        ...form,
        buttons: normalizeButtons(form.buttons),
        variables: parseJsonArray(form.variablesText)
      };
      delete payload.variablesText;
      if (editing) await updateWhatsAppTemplate(editing.id, payload); else await createWhatsAppTemplate(payload);
      setSuccess(editing ? 'Template updated.' : 'Template created.');
      setDialogOpen(false);
      await load();
    } catch (err) {
      setError(err.response?.data?.message || 'Unable to save template.');
    }
  };

  const remove = async (row) => {
    if (!window.confirm('Delete this WhatsApp template?')) return;
    try {
      setError('');
      await deleteWhatsAppTemplate(row.id);
      setSuccess('Template deleted.');
      await load();
    } catch (err) {
      setError(err.response?.data?.message || 'Unable to delete template.');
    }
  };

  const submit = async (row) => {
    try {
      setLoading(true);
      setError('');
      const response = await submitWhatsAppTemplate(row.id);
      setSuccess(response.data.data?.simulated ? response.data.data.message : 'Template submitted to Meta.');
      await load();
    } catch (err) {
      const detail = err.response?.data?.details?.[0]?.message;
      setError(detail || err.response?.data?.message || 'Unable to submit template to Meta.');
    } finally {
      setLoading(false);
    }
  };

  const sync = async () => {
    try {
      setLoading(true);
      setError('');
      const response = await syncWhatsAppTemplates(filters.whatsappAccountId);
      setSuccess(response.data.data?.simulated ? response.data.data.message : `Synced ${response.data.data.synced} templates from Meta.`);
      await load();
    } catch (err) {
      const detail = err.response?.data?.details?.[0]?.message;
      setError(detail || err.response?.data?.message || 'Unable to sync templates from Meta.');
    } finally {
      setLoading(false);
    }
  };

  const uploadSample = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        setLoading(true);
        setError('');
        const response = await uploadWhatsAppTemplateSample({
          fileName: file.name,
          mimeType: file.type,
          dataBase64: String(reader.result || '').split(',')[1] || ''
          , whatsappAccountId: form.whatsappAccountId
        });
        setForm((current) => ({ ...current, headerContent: response.data.data.handle }));
        setSuccess(response.data.data.simulated ? response.data.data.message : 'Sample media uploaded to Meta.');
      } catch (err) {
        setError(err.response?.data?.details?.[0]?.message || err.response?.data?.message || 'Unable to upload sample media.');
      } finally {
        setLoading(false);
      }
    };
    reader.onerror = () => setError('Unable to read the selected sample media.');
    reader.readAsDataURL(file);
  };

  return (
    <Stack spacing={2.5}>
      {loading && <LinearProgress />}
      {error && <Alert severity="error" onClose={() => setError('')}>{error}</Alert>}
      {success && <Alert severity="success" onClose={() => setSuccess('')}>{success}</Alert>}

      <Paper elevation={0} sx={{ p: 2.5, border: '1px solid', borderColor: 'divider' }}>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} alignItems={{ md: 'center' }}>
          <Box sx={{ flex: 1 }}>
            <Typography variant="h5" fontWeight={850}>WhatsApp Template Manager</Typography>
            <Typography color="text.secondary">Create, submit, sync, and monitor approved Meta WhatsApp templates.</Typography>
          </Box>
          <WhatsAppAccountSelect value={filters.whatsappAccountId} onChange={(value) => setFilters((current) => ({ ...current, whatsappAccountId: value }))} sx={{ minWidth: 260 }} />
          <Button variant="outlined" startIcon={<CloudSyncIcon />} onClick={sync}>Sync From Meta</Button>
          <Button variant="contained" startIcon={<AddIcon />} onClick={openCreate}>Create Template</Button>
        </Stack>
      </Paper>

      <Paper elevation={0} sx={{ p: 2, border: '1px solid', borderColor: 'divider' }}>
        <Grid container spacing={2}>
          <Grid item xs={12} md={4}><TextField select label="Status" value={filters.status} onChange={(e) => setFilters((current) => ({ ...current, status: e.target.value }))} fullWidth><MenuItem value="">All Statuses</MenuItem>{['DRAFT', 'PENDING', 'APPROVED', 'REJECTED', 'DISABLED'].map((item) => <MenuItem key={item} value={item}>{item}</MenuItem>)}</TextField></Grid>
          <Grid item xs={12} md={4}><TextField label="Language" value={filters.language} onChange={(e) => setFilters((current) => ({ ...current, language: e.target.value }))} fullWidth /></Grid>
          <Grid item xs={12} md={4}><TextField select label="Category" value={filters.category} onChange={(e) => setFilters((current) => ({ ...current, category: e.target.value }))} fullWidth><MenuItem value="">All Categories</MenuItem>{['UTILITY', 'MARKETING', 'AUTHENTICATION'].map((item) => <MenuItem key={item} value={item}>{item}</MenuItem>)}</TextField></Grid>
          <Grid item xs={12}><Button variant="outlined" onClick={load}>Apply Filters</Button></Grid>
        </Grid>
      </Paper>

      <Paper elevation={0} sx={{ border: '1px solid', borderColor: 'divider', overflow: 'hidden' }}>
        <TableContainer><Table><TableHead><TableRow>{['Name', 'Category', 'Language', 'Status', 'Quality', 'Last Sync', 'Actions'].map((label) => <TableCell key={label}>{label}</TableCell>)}</TableRow></TableHead><TableBody>
          {filteredRows.map((row) => <TableRow key={row.id} hover><TableCell>{row.name}</TableCell><TableCell>{row.category}</TableCell><TableCell>{row.language}</TableCell><TableCell><Chip size="small" label={row.status} color={row.status === 'APPROVED' ? 'success' : row.status === 'REJECTED' ? 'error' : 'default'} /></TableCell><TableCell><Chip size="small" label={row.qualityRating} /></TableCell><TableCell>{row.lastSyncedAt ? new Date(row.lastSyncedAt).toLocaleString() : '-'}</TableCell><TableCell><Stack direction="row" spacing={0.5}><Button size="small" startIcon={<SendIcon />} onClick={() => submit(row)} disabled={!['DRAFT', 'REJECTED'].includes(row.status)}>Submit</Button><Button size="small" startIcon={<EditIcon />} onClick={() => openEdit(row)} disabled={!['DRAFT', 'REJECTED'].includes(row.status)}>Edit</Button><Button size="small" color="error" startIcon={<DeleteOutlineIcon />} onClick={() => remove(row)}>Delete</Button></Stack></TableCell></TableRow>)}
          {filteredRows.length === 0 && <TableRow><TableCell colSpan={7}><Box sx={{ py: 5, textAlign: 'center' }}><Typography fontWeight={800}>No templates found</Typography><Typography color="text.secondary">Create or sync templates to begin.</Typography></Box></TableCell></TableRow>}
        </TableBody></Table></TableContainer>
      </Paper>

      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} maxWidth="lg" fullWidth>
        <DialogTitle>{editing ? 'Edit Template' : 'Create Template'}</DialogTitle>
        <DialogContent><Grid container spacing={2} sx={{ mt: 0.5 }}>
          <Grid item xs={12} md={8}>
            <Grid container spacing={2}>
              <Grid item xs={12}><WhatsAppAccountSelect value={form.whatsappAccountId} onChange={(value) => setForm((current) => ({ ...current, whatsappAccountId: value }))} fullWidth required /></Grid>
              <Grid item xs={12} md={6}><TextField label="Name" value={form.name} onChange={(e) => setForm((current) => ({ ...current, name: e.target.value }))} fullWidth /></Grid>
              <Grid item xs={12} md={3}><TextField select label="Category" value={form.category} onChange={(e) => setForm((current) => ({ ...current, category: e.target.value }))} fullWidth>{['UTILITY', 'MARKETING', 'AUTHENTICATION'].map((item) => <MenuItem key={item} value={item}>{item}</MenuItem>)}</TextField></Grid>
              <Grid item xs={12} md={3}><TextField label="Language" value={form.language} onChange={(e) => setForm((current) => ({ ...current, language: e.target.value }))} fullWidth /></Grid>
              <Grid item xs={12} md={4}><TextField select label="Header Type" value={form.headerType} onChange={(e) => setForm((current) => ({ ...current, headerType: e.target.value }))} fullWidth>{['NONE', 'TEXT', 'IMAGE', 'VIDEO', 'DOCUMENT'].map((item) => <MenuItem key={item} value={item}>{item}</MenuItem>)}</TextField></Grid>
              <Grid item xs={12} md={8}><TextField label={['IMAGE', 'VIDEO', 'DOCUMENT'].includes(form.headerType) ? 'Sample Media Handle / URL' : 'Header Content'} helperText={['IMAGE', 'VIDEO', 'DOCUMENT'].includes(form.headerType) ? 'Required by Meta for media-header template review.' : ''} value={form.headerContent} onChange={(e) => setForm((current) => ({ ...current, headerContent: e.target.value }))} fullWidth /></Grid>
              {['IMAGE', 'VIDEO', 'DOCUMENT'].includes(form.headerType) && <Grid item xs={12}><Stack direction="row" spacing={1} alignItems="center"><Button component="label" variant="outlined" disabled={loading}>Upload Sample Media<input hidden type="file" accept={form.headerType === 'IMAGE' ? 'image/*' : form.headerType === 'VIDEO' ? 'video/*' : 'application/pdf' } onChange={uploadSample} /></Button>{form.headerContent && <Chip size="small" color="success" label="Sample attached" />}</Stack></Grid>}
              <Grid item xs={12}><TextField label="Body" value={form.body} onChange={(e) => setForm((current) => ({ ...current, body: e.target.value }))} multiline minRows={5} fullWidth /></Grid>
              <Grid item xs={12}><TextField label="Footer" value={form.footer} onChange={(e) => setForm((current) => ({ ...current, footer: e.target.value }))} fullWidth /></Grid>
              <Grid item xs={12}><Typography fontWeight={850} sx={{ mb: 1 }}>Template Buttons</Typography><ButtonBuilder buttons={form.buttons} onChange={(buttons) => setForm((current) => ({ ...current, buttons }))} /></Grid>
              <Grid item xs={12}><TextField label="Variables JSON" value={form.variablesText} onChange={(e) => setForm((current) => ({ ...current, variablesText: e.target.value }))} multiline minRows={4} fullWidth /></Grid>
            </Grid>
          </Grid>
          <Grid item xs={12} md={4}><WhatsAppPreview form={form} /></Grid>
        </Grid></DialogContent>
        <DialogActions><Button onClick={() => setDialogOpen(false)}>Cancel</Button><Button variant="contained" onClick={save}>Save</Button></DialogActions>
      </Dialog>
    </Stack>
  );
}

export default WhatsAppTemplatesPage;
