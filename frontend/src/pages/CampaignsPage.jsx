import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert, Box, Button, Checkbox, Chip, Dialog, DialogActions, DialogContent, DialogTitle,
  FormControl, Grid, IconButton, InputLabel, LinearProgress, MenuItem, Paper, Select,
  Stack, Step, StepLabel, Stepper, Table, TableBody, TableCell, TableContainer, TableHead,
  TableRow, TextField, Typography
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import AnalyticsIcon from '@mui/icons-material/Analytics';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import {
  createCampaign, deleteCampaign, getCampaignAnalytics, getCampaigns, importCampaignRecipients,
  getCampaignAudienceOptions, previewBroadcastAudience, scheduleCampaign, sendCampaign
} from '../services/campaign.service';
import { getContacts } from '../services/contact.service';
import { listWhatsAppTemplates } from '../services/whatsappTemplate.service';
import { getRoles } from '../services/userManagement.service';
import WhatsAppAccountSelect from '../components/WhatsAppAccountSelect';

const steps = ['Details', 'Template', 'Recipients', 'Variables', 'Schedule', 'Review'];
const leadStatuses = ['New', 'Contacted', 'Interested', 'Ignore', 'Agreed', 'Registered', 'Lost'];
const statusColors = { Draft: 'default', Scheduled: 'info', Processing: 'warning', Completed: 'success', Failed: 'error', Cancelled: 'default' };
const blankForm = () => ({
  name: '', description: '', whatsappTemplateId: '', recipientMode: 'all', contactIds: [],
  tag: '', leadStatus: '', departmentId: '', csv: '', startDate: '', endDate: '',
  statusId: '', sourceId: '', variables: {}, sendMode: 'now', scheduledAt: '', whatsappAccountId: ''
});

function displayName(contact) {
  return [contact.firstName, contact.lastName].filter(Boolean).join(' ') || contact.phone;
}

function formatDate(value) {
  if (!value) return '-';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '-' : date.toLocaleString();
}

function variableIndexes(template) {
  const matches = String(template?.body || '').matchAll(/\{\{\s*(\d+)\s*\}\}/g);
  return [...new Set(Array.from(matches, (match) => match[1]))].sort((a, b) => Number(a) - Number(b));
}

function apiMessage(error, fallback) {
  return error.response?.data?.details?.[0]?.message || error.response?.data?.message || fallback;
}

function CampaignsPage() {
  const [campaigns, setCampaigns] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [contacts, setContacts] = useState([]);
  const [roles, setRoles] = useState([]);
  const [audienceOptions, setAudienceOptions] = useState({ statuses: [], sources: [] });
  const [form, setForm] = useState(blankForm);
  const [step, setStep] = useState(0);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [analytics, setAnalytics] = useState(null);
  const [analyticsOpen, setAnalyticsOpen] = useState(false);
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [selectedAccountId, setSelectedAccountId] = useState('');

  const selectedTemplate = templates.find((template) => String(template.id) === String(form.whatsappTemplateId));
  const variables = useMemo(() => variableIndexes(selectedTemplate), [selectedTemplate]);
  const allTags = useMemo(() => [...new Set(contacts.flatMap((contact) => contact.tags || []))].sort(), [contacts]);

  const load = async () => {
    try {
      setLoading(true);
      setError('');
      const [campaignRes, templateRes, contactRes, roleRes, audienceOptionsRes] = await Promise.all([
        getCampaigns({ whatsappAccountId: selectedAccountId || undefined }),
        listWhatsAppTemplates({ status: 'APPROVED', whatsappAccountId: selectedAccountId || undefined }),
        getContacts({ limit: 100, whatsappAccountId: selectedAccountId || undefined }),
        getRoles(),
        getCampaignAudienceOptions()
      ]);
      setCampaigns(campaignRes.data.data || []);
      setTemplates(templateRes.data.data || []);
      setContacts(contactRes.data.data?.contacts || []);
      setRoles(roleRes.data.data || []);
      setAudienceOptions(audienceOptionsRes.data.data || { statuses: [], sources: [] });
    } catch (err) {
      setError(apiMessage(err, 'Unable to load broadcasting data.'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [selectedAccountId]);

  const openWizard = () => {
    setForm({ ...blankForm(), whatsappAccountId: selectedAccountId });
    setStep(0);
    setPreview(null);
    setError('');
    setWizardOpen(true);
  };

  const setField = (field, value) => setForm((current) => ({ ...current, [field]: value }));

  const validateStep = () => {
    if (step === 0 && !form.whatsappAccountId) return 'Select a WhatsApp number.';
    if (step === 0 && !form.name.trim()) return 'Campaign name is required.';
    if (step === 1 && !form.whatsappTemplateId) return 'Select an approved WhatsApp template.';
    if (step === 2) {
      if (form.recipientMode === 'selected' && !form.contactIds.length) return 'Select at least one contact.';
      if (form.recipientMode === 'tag' && !form.tag) return 'Select a contact tag.';
      if (form.recipientMode === 'lead_status' && !form.leadStatus) return 'Select a lead status.';
      if (form.recipientMode === 'department' && !form.departmentId) return 'Select a department.';
      if (form.recipientMode === 'lead_date_range' && (!form.startDate || !form.endDate)) return 'Choose both a start date and an end date.';
      if (form.recipientMode === 'lead_date_range' && form.startDate > form.endDate) return 'Start date must be on or before end date.';
      if (form.recipientMode === 'csv' && !form.csv.trim()) return 'Import a CSV containing phone and name columns.';
    }
    if (step === 3 && variables.some((key) => !form.variables[key])) return 'Map every template variable.';
    if (step === 4 && form.sendMode === 'schedule' && !form.scheduledAt) return 'Choose a schedule date and time.';
    return '';
  };

  const next = async () => {
    const validation = validateStep();
    if (validation) return setError(validation);
    setError('');
    if (step === 2 && !await previewRecipients()) return;
    setStep((current) => Math.min(current + 1, steps.length - 1));
  };

  const audiencePayload = () => {
    const filters = {};
    let audienceType = 'contacts';
    if (form.recipientMode === 'selected') filters.contactIds = form.contactIds;
    if (form.recipientMode === 'tag') filters.tag = form.tag;
    if (form.recipientMode === 'lead_status') { audienceType = 'leads'; filters.leadStatus = form.leadStatus; }
    if (form.recipientMode === 'department') { audienceType = 'leads'; filters.departmentId = form.departmentId; }
    if (form.recipientMode === 'lead_date_range') {
      audienceType = 'leads';
      filters.recipientSource = 'lead_date_range';
      filters.startDate = form.startDate;
      filters.endDate = form.endDate;
      if (form.statusId) filters.statusId = Number(form.statusId);
      if (form.sourceId) filters.sourceId = Number(form.sourceId);
      return {
        audienceType,
        filters,
        recipient_source: 'lead_date_range',
        start_date: form.startDate,
        end_date: form.endDate,
        status_id: form.statusId ? Number(form.statusId) : undefined,
        source_id: form.sourceId ? Number(form.sourceId) : undefined,
        limit: 10000
      };
    }
    return { audienceType, filters, limit: 10000 };
  };

  const previewRecipients = async () => {
    if (form.recipientMode === 'csv') {
      const rows = form.csv.split(/\r?\n/).filter((line) => line.trim());
      setPreview({ total: Math.max(rows.length - 1, 0), recipients: [] });
      return true;
    }
    try {
      setSaving(true);
      const response = await previewBroadcastAudience(audiencePayload());
      setPreview(response.data.data);
      return true;
    } catch (err) {
      setError(apiMessage(err, 'Unable to preview recipients.'));
      return false;
    } finally {
      setSaving(false);
    }
  };

  const confirm = async (saveOnly = false) => {
    try {
      setSaving(true);
      setError('');
      const audience = audiencePayload();
      const response = await createCampaign({
        name: form.name.trim(),
        description: form.description.trim() || null,
        whatsappTemplateId: Number(form.whatsappTemplateId),
        whatsappAccountId: form.whatsappAccountId,
        ...audience,
        variables: form.variables,
        scheduledAt: form.sendMode === 'schedule' ? new Date(form.scheduledAt).toISOString() : null
      });
      const campaign = response.data.data;
      if (form.recipientMode === 'csv') await importCampaignRecipients(campaign.id, { csv: form.csv });
      if (!saveOnly) {
        if (form.sendMode === 'schedule') await scheduleCampaign(campaign.id, new Date(form.scheduledAt).toISOString());
        else await sendCampaign(campaign.id);
      }
      setSuccess(saveOnly ? 'Broadcast saved as draft.' : form.sendMode === 'schedule' ? 'Broadcast scheduled and queued.' : 'Broadcast queued for sending.');
      setWizardOpen(false);
      await load();
    } catch (err) {
      setError(apiMessage(err, 'Unable to create broadcast.'));
    } finally {
      setSaving(false);
    }
  };

  const retryOrSend = async (campaign) => {
    if (!window.confirm(`Queue eligible recipients for "${campaign.name}"?`)) return;
    try {
      setLoading(true);
      setError('');
      const response = await sendCampaign(campaign.id);
      setSuccess(`${response.data.data?.queued || 0} recipient(s) queued; ${response.data.data?.skipped || 0} duplicate/completed recipient(s) skipped.`);
      await load();
    } catch (err) {
      setError(apiMessage(err, 'Unable to queue broadcast.'));
    } finally {
      setLoading(false);
    }
  };

  const remove = async (campaign) => {
    if (!window.confirm(`Delete broadcast "${campaign.name}"?`)) return;
    try {
      await deleteCampaign(campaign.id);
      setSuccess('Broadcast deleted.');
      await load();
    } catch (err) {
      setError(apiMessage(err, 'Unable to delete broadcast.'));
    }
  };

  const showAnalytics = async (campaign) => {
    try {
      setLoading(true);
      const response = await getCampaignAnalytics(campaign.id);
      setAnalytics(response.data.data);
      setAnalyticsOpen(true);
    } catch (err) {
      setError(apiMessage(err, 'Unable to load campaign analytics.'));
    } finally {
      setLoading(false);
    }
  };

  const readCsv = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setField('csv', String(reader.result || ''));
    reader.onerror = () => setError('Unable to read the selected CSV file.');
    reader.readAsText(file);
  };

  const renderStep = () => {
    if (step === 0) return <Grid container spacing={2}>
      <Grid item xs={12}><WhatsAppAccountSelect value={form.whatsappAccountId} onChange={(value) => {
        setField('whatsappAccountId', value);
        setSelectedAccountId(value);
        setForm((current) => ({ ...current, whatsappAccountId: value, whatsappTemplateId: '' }));
      }} fullWidth required /></Grid>
      <Grid item xs={12}><TextField label="Campaign name" value={form.name} onChange={(e) => setField('name', e.target.value)} required fullWidth /></Grid>
      <Grid item xs={12}><TextField label="Campaign description" value={form.description} onChange={(e) => setField('description', e.target.value)} multiline minRows={3} fullWidth /></Grid>
    </Grid>;
    if (step === 1) return <Stack spacing={2}>
      <FormControl fullWidth><InputLabel>Approved WhatsApp template</InputLabel><Select label="Approved WhatsApp template" value={form.whatsappTemplateId} onChange={(e) => {
        setField('whatsappTemplateId', e.target.value);
        setForm((current) => ({ ...current, whatsappTemplateId: e.target.value, variables: {} }));
      }}>{templates.map((template) => <MenuItem key={template.id} value={template.id}>{template.name} · {template.language}</MenuItem>)}</Select></FormControl>
      {selectedTemplate && <Paper variant="outlined" sx={{ p: 2, bgcolor: 'action.hover' }}><Typography fontWeight={850}>{selectedTemplate.name}</Typography><Typography sx={{ whiteSpace: 'pre-wrap', mt: 1 }}>{selectedTemplate.body}</Typography><Stack direction="row" spacing={1} sx={{ mt: 1 }}><Chip size="small" label={selectedTemplate.category} /><Chip size="small" color="success" label="APPROVED" /></Stack></Paper>}
    </Stack>;
    if (step === 2) return <Stack spacing={2}>
      <FormControl fullWidth><InputLabel>Recipient source</InputLabel><Select label="Recipient source" value={form.recipientMode} onChange={(e) => { setField('recipientMode', e.target.value); setPreview(null); }}>
        <MenuItem value="all">All contacts</MenuItem><MenuItem value="selected">Selected contacts</MenuItem><MenuItem value="tag">By label / tag</MenuItem>
        <MenuItem value="lead_status">By lead status</MenuItem><MenuItem value="department">By department</MenuItem><MenuItem value="csv">Imported CSV</MenuItem>
        <MenuItem value="lead_date_range">By Lead Date Range</MenuItem>
      </Select></FormControl>
      {form.recipientMode === 'selected' && <FormControl fullWidth><InputLabel>Contacts</InputLabel><Select multiple label="Contacts" value={form.contactIds} onChange={(e) => setField('contactIds', e.target.value)} renderValue={(selected) => `${selected.length} contact(s) selected`}>{contacts.map((contact) => <MenuItem key={contact.id} value={contact.id}><Checkbox checked={form.contactIds.includes(contact.id)} />{displayName(contact)} · {contact.phone}</MenuItem>)}</Select></FormControl>}
      {form.recipientMode === 'tag' && <TextField select label="Contact label / tag" value={form.tag} onChange={(e) => setField('tag', e.target.value)} fullWidth>{allTags.map((tag) => <MenuItem key={tag} value={tag}>{tag}</MenuItem>)}</TextField>}
      {form.recipientMode === 'lead_status' && <TextField select label="Lead status" value={form.leadStatus} onChange={(e) => setField('leadStatus', e.target.value)} fullWidth>{leadStatuses.map((status) => <MenuItem key={status} value={status}>{status}</MenuItem>)}</TextField>}
      {form.recipientMode === 'department' && <TextField select label="Department" value={form.departmentId} onChange={(e) => setField('departmentId', e.target.value)} fullWidth>{roles.map((role) => <MenuItem key={role.id} value={role.id}>{role.name}</MenuItem>)}</TextField>}
      {form.recipientMode === 'lead_date_range' && <Grid container spacing={2}>
        <Grid item xs={12} sm={6}><TextField label="Start date" type="date" value={form.startDate} onChange={(e) => { setField('startDate', e.target.value); setPreview(null); }} InputLabelProps={{ shrink: true }} required fullWidth /></Grid>
        <Grid item xs={12} sm={6}><TextField label="End date" type="date" value={form.endDate} onChange={(e) => { setField('endDate', e.target.value); setPreview(null); }} InputLabelProps={{ shrink: true }} required fullWidth /></Grid>
        <Grid item xs={12} sm={6}><TextField select label="Lead status (optional)" value={form.statusId} onChange={(e) => { setField('statusId', e.target.value); setPreview(null); }} fullWidth><MenuItem value="">All statuses</MenuItem>{audienceOptions.statuses.map((status) => <MenuItem key={status.id} value={status.id}>{status.name}</MenuItem>)}</TextField></Grid>
        <Grid item xs={12} sm={6}><TextField select label="Lead source (optional)" value={form.sourceId} onChange={(e) => { setField('sourceId', e.target.value); setPreview(null); }} fullWidth><MenuItem value="">All sources</MenuItem>{audienceOptions.sources.map((source) => <MenuItem key={source.id} value={source.id}>{source.name}</MenuItem>)}</TextField></Grid>
        <Grid item xs={12}><Button variant="outlined" onClick={previewRecipients} disabled={saving || !form.startDate || !form.endDate}>{saving ? 'Counting...' : 'Preview recipient count'}</Button></Grid>
      </Grid>}
      {form.recipientMode === 'csv' && <Stack spacing={1}><Button component="label" variant="outlined">Choose CSV<input hidden type="file" accept=".csv,text/csv" onChange={readCsv} /></Button><Typography variant="body2" color="text.secondary">CSV headers: phone, name, plus optional fields used in variable mapping.</Typography>{form.csv && <Chip color="success" label={`${Math.max(form.csv.split(/\r?\n/).filter(Boolean).length - 1, 0)} CSV row(s) loaded`} />}</Stack>}
      {preview && <Alert severity={preview.total ? 'success' : 'warning'}>{preview.total} unique recipient(s) matched.</Alert>}
    </Stack>;
    if (step === 3) return <Stack spacing={2}>
      <Typography color="text.secondary">Map each numbered template placeholder to recipient data.</Typography>
      {variables.map((key) => <TextField key={key} select label={`{{${key}}}`} value={form.variables[key] || ''} onChange={(e) => setForm((current) => ({ ...current, variables: { ...current.variables, [key]: e.target.value } }))} fullWidth>
        {['contact_name', 'phone', 'course_name', 'date', 'time', 'date_time', 'campaign_name'].map((value) => <MenuItem key={value} value={value}>{value.replaceAll('_', ' ')}</MenuItem>)}
      </TextField>)}
      {!variables.length && <Alert severity="info">This template has no numbered body variables.</Alert>}
    </Stack>;
    if (step === 4) return <Stack spacing={2}>
      <TextField select label="Delivery" value={form.sendMode} onChange={(e) => setField('sendMode', e.target.value)} fullWidth><MenuItem value="now">Send now</MenuItem><MenuItem value="schedule">Schedule date/time</MenuItem></TextField>
      {form.sendMode === 'schedule' && <TextField label="Schedule date/time" type="datetime-local" value={form.scheduledAt} onChange={(e) => setField('scheduledAt', e.target.value)} InputLabelProps={{ shrink: true }} inputProps={{ min: new Date().toISOString().slice(0, 16) }} fullWidth />}
    </Stack>;
    return <Grid container spacing={2}>
      {[['Campaign', form.name], ['Template', selectedTemplate?.name], ['Recipients', preview ? `${preview.total} unique recipient(s)` : form.recipientMode], ['Delivery', form.sendMode === 'schedule' ? formatDate(form.scheduledAt) : 'Send now']].map(([label, value]) => <Grid item xs={12} sm={6} key={label}><Paper variant="outlined" sx={{ p: 2 }}><Typography variant="caption" color="text.secondary">{label}</Typography><Typography fontWeight={850}>{value || '-'}</Typography></Paper></Grid>)}
      <Grid item xs={12}><Alert severity="warning">Confirming will create deduplicated queue jobs. Actual delivery requires valid WhatsApp Cloud API credentials.</Alert></Grid>
    </Grid>;
  };

  return <Stack spacing={2.5}>
    {error && <Alert severity="error" onClose={() => setError('')}>{error}</Alert>}
    {success && <Alert severity="success" onClose={() => setSuccess('')}>{success}</Alert>}
    {loading && <LinearProgress />}
    <Paper elevation={0} sx={{ p: 2.5, border: '1px solid', borderColor: 'divider' }}><Stack direction={{ xs: 'column', md: 'row' }} spacing={2} alignItems={{ md: 'center' }}><Box sx={{ flex: 1 }}><Typography variant="h5" fontWeight={850}>Broadcasting / Campaigns</Typography><Typography color="text.secondary">Create compliant WhatsApp broadcasts, schedule queue delivery, and monitor results.</Typography></Box><WhatsAppAccountSelect value={selectedAccountId} onChange={setSelectedAccountId} sx={{ minWidth: 260 }} /><Button variant="contained" startIcon={<AddIcon />} onClick={openWizard}>Create Broadcast</Button></Stack></Paper>
    <Paper elevation={0} sx={{ border: '1px solid', borderColor: 'divider', overflow: 'hidden' }}><TableContainer><Table><TableHead><TableRow><TableCell>Campaign</TableCell><TableCell>Template</TableCell><TableCell>Recipients</TableCell><TableCell>Status</TableCell><TableCell>Scheduled</TableCell><TableCell>Sent</TableCell><TableCell align="right">Actions</TableCell></TableRow></TableHead><TableBody>
      {campaigns.map((campaign) => <TableRow key={campaign.id} hover><TableCell><Typography fontWeight={850}>{campaign.name}</Typography><Typography variant="caption" color="text.secondary">{campaign.description || 'No description'}</Typography></TableCell><TableCell>{campaign.whatsappTemplate?.name || campaign.templateName || '-'}</TableCell><TableCell>{campaign.recipientCount || 0}</TableCell><TableCell><Chip size="small" label={campaign.status} color={statusColors[campaign.status] || 'default'} /></TableCell><TableCell>{formatDate(campaign.scheduledAt)}</TableCell><TableCell>{formatDate(campaign.sentAt)}</TableCell><TableCell align="right">{['Draft', 'Failed', 'Completed'].includes(campaign.status) && <IconButton title={campaign.status === 'Draft' ? 'Send now' : 'Retry failed recipients'} onClick={() => retryOrSend(campaign)}><PlayArrowIcon /></IconButton>}<IconButton title="Analytics" onClick={() => showAnalytics(campaign)}><AnalyticsIcon /></IconButton><IconButton color="error" title="Delete" onClick={() => remove(campaign)}><DeleteOutlineIcon /></IconButton></TableCell></TableRow>)}
      {!campaigns.length && !loading && <TableRow><TableCell colSpan={7}><Box sx={{ py: 6, textAlign: 'center' }}><Typography fontWeight={850}>No broadcasts yet</Typography><Typography color="text.secondary">Create your first professional WhatsApp campaign.</Typography></Box></TableCell></TableRow>}
    </TableBody></Table></TableContainer></Paper>

    <Dialog open={wizardOpen} onClose={() => !saving && setWizardOpen(false)} maxWidth="md" fullWidth><DialogTitle>Create Broadcast</DialogTitle><DialogContent><Stepper activeStep={step} alternativeLabel sx={{ py: 2 }}>{steps.map((label) => <Step key={label}><StepLabel>{label}</StepLabel></Step>)}</Stepper><Box sx={{ py: 2, minHeight: 300 }}>{renderStep()}</Box></DialogContent><DialogActions><Button onClick={() => setWizardOpen(false)} disabled={saving}>Cancel</Button>{step > 0 && <Button onClick={() => { setError(''); setStep((current) => current - 1); }} disabled={saving}>Back</Button>}{step < steps.length - 1 ? <Button variant="contained" onClick={next} disabled={saving}>{saving ? 'Checking...' : 'Next'}</Button> : <><Button onClick={() => confirm(true)} disabled={saving}>Save Draft</Button><Button variant="contained" onClick={() => confirm(false)} disabled={saving}>{saving ? 'Queueing...' : form.sendMode === 'schedule' ? 'Confirm Schedule' : 'Confirm & Send'}</Button></>}</DialogActions></Dialog>

    <Dialog open={analyticsOpen} onClose={() => setAnalyticsOpen(false)} maxWidth="md" fullWidth><DialogTitle>Campaign Analytics</DialogTitle><DialogContent>{analytics && <Stack spacing={2}><Typography variant="h6" fontWeight={850}>{analytics.campaign?.name}</Typography><Grid container spacing={2}>{Object.entries(analytics.totals || {}).map(([key, value]) => <Grid item xs={6} md={4} key={key}><Paper variant="outlined" sx={{ p: 2 }}><Typography variant="h5" fontWeight={900}>{value}</Typography><Typography color="text.secondary">{key.replaceAll(/([A-Z])/g, ' $1')}</Typography></Paper></Grid>)}</Grid><Stack direction="row" spacing={1}>{Object.entries(analytics.rates || {}).map(([key, value]) => <Chip key={key} color="primary" variant="outlined" label={`${key.replaceAll(/([A-Z])/g, ' $1')}: ${Number(value).toFixed(1)}%`} />)}</Stack><Typography fontWeight={850}>Failed recipients</Typography>{analytics.failureReport?.length ? <Table size="small"><TableHead><TableRow><TableCell>Name</TableCell><TableCell>Phone</TableCell><TableCell>Reason</TableCell></TableRow></TableHead><TableBody>{analytics.failureReport.map((item) => <TableRow key={item.id}><TableCell>{item.name}</TableCell><TableCell>{item.phone}</TableCell><TableCell>{item.errorMessage || item.status}</TableCell></TableRow>)}</TableBody></Table> : <Alert severity="success">No failed recipients.</Alert>}</Stack>}</DialogContent><DialogActions><Button onClick={() => setAnalyticsOpen(false)}>Close</Button></DialogActions></Dialog>
  </Stack>;
}

export default CampaignsPage;
