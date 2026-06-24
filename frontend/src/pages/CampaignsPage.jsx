import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControl,
  Grid,
  IconButton,
  InputLabel,
  LinearProgress,
  MenuItem,
  Paper,
  Select,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import AnalyticsIcon from '@mui/icons-material/Analytics';
import CancelIcon from '@mui/icons-material/Cancel';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import PreviewIcon from '@mui/icons-material/Preview';
import ScheduleIcon from '@mui/icons-material/Schedule';
import {
  cancelCampaign,
  createCampaign,
  deleteCampaign,
  getCampaignAnalytics,
  getCampaigns,
  previewAudience,
  sendCampaign
} from '../services/campaign.service';
import { getAgents } from '../services/agent.service';
import { getTemplates } from '../services/chat.service';

const statusColors = {
  Draft: 'default',
  Scheduled: 'info',
  Processing: 'warning',
  Completed: 'success',
  Failed: 'error',
  Cancelled: 'default'
};

const leadStatuses = ['New', 'Contacted', 'Interested', 'Not Interested', 'Converted', 'Lost'];
const contactStatuses = ['new', 'active', 'inactive', 'archived'];
const sources = ['Facebook Ads', 'WhatsApp Ads', 'Website', 'Instagram', 'TikTok', 'Google Search', 'Referral', 'Organic', 'Manual Entry'];
const courses = ['Forex', 'Crypto', 'Stock Market', 'Home Decoration', 'Other'];

const initialForm = {
  name: '',
  description: '',
  audienceType: 'contacts',
  tag: '',
  status: '',
  source: '',
  courseInterested: '',
  assignedAgentId: '',
  templateId: '',
  messageBody: '',
  variables: '{}',
  mediaId: '',
  scheduledAt: ''
};

function getRows(payload) {
  if (Array.isArray(payload)) return payload;
  return payload?.data || payload?.campaigns || [];
}

function agentName(agent) {
  if (!agent) return 'Unassigned';
  return agent.name || [agent.firstName, agent.lastName].filter(Boolean).join(' ') || agent.email;
}

function formatDate(value) {
  if (!value) return '-';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '-' : date.toLocaleString();
}

function rate(value) {
  return `${Number(value || 0).toFixed(1)}%`;
}

function CampaignsPage() {
  const [campaigns, setCampaigns] = useState([]);
  const [agents, setAgents] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [form, setForm] = useState(initialForm);
  const [preview, setPreview] = useState(null);
  const [analytics, setAnalytics] = useState(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [analyticsOpen, setAnalyticsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const totals = useMemo(() => {
    const empty = { Draft: 0, Scheduled: 0, Processing: 0, Completed: 0, Failed: 0, Cancelled: 0 };
    return campaigns.reduce((acc, campaign) => {
      acc[campaign.status] = (acc[campaign.status] || 0) + 1;
      return acc;
    }, empty);
  }, [campaigns]);

  const loadCampaigns = async () => {
    try {
      setLoading(true);
      setError('');
      const response = await getCampaigns();
      setCampaigns(getRows(response.data));
    } catch (err) {
      setError(err.response?.data?.message || 'Unable to load campaigns.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadCampaigns();
    getAgents().then((response) => setAgents(response.data.data || [])).catch(() => {});
    getTemplates().then((response) => setTemplates(response.data.data || [])).catch(() => {});
  }, []);

  const setField = (field) => (event) => {
    const value = event.target.value;
    setForm((current) => {
      const next = { ...current, [field]: value };
      if (field === 'templateId') {
        const selected = templates.find((template) => String(template.id) === String(value));
        if (selected?.body) next.messageBody = selected.body;
      }
      return next;
    });
  };

  const buildPayload = (status) => {
    let variables = {};
    try {
      variables = form.variables.trim() ? JSON.parse(form.variables) : {};
    } catch (err) {
      const error = new Error('Variables must be valid JSON.');
      error.isValidation = true;
      throw error;
    }

    const filters = {};
    ['tag', 'status', 'source', 'courseInterested', 'assignedAgentId'].forEach((key) => {
      if (form[key]) filters[key] = form[key];
    });

    return {
      name: form.name.trim(),
      description: form.description || null,
      status,
      audienceType: form.audienceType,
      filters,
      templateId: form.templateId || null,
      messageBody: form.messageBody.trim(),
      variables,
      mediaId: form.mediaId || null,
      scheduledAt: form.scheduledAt ? new Date(form.scheduledAt).toISOString() : null
    };
  };

  const runPreview = async () => {
    try {
      setSaving(true);
      const response = await previewAudience({
        audienceType: form.audienceType,
        tag: form.tag || undefined,
        status: form.status || undefined,
        source: form.source || undefined,
        courseInterested: form.courseInterested || undefined,
        assignedAgentId: form.assignedAgentId || undefined,
        limit: 25
      });
      setPreview(response.data.data);
    } catch (err) {
      setError(err.response?.data?.message || 'Unable to preview audience.');
    } finally {
      setSaving(false);
    }
  };

  const saveCampaign = async (mode) => {
    try {
      setSaving(true);
      setError('');
      const payload = buildPayload(mode === 'schedule' ? 'Scheduled' : 'Draft');
      const response = await createCampaign(payload);
      const campaign = response.data.data;
      if (mode === 'send') {
        await sendCampaign(campaign.id);
        setSuccess('Campaign queued in local simulation mode.');
      } else {
        setSuccess(mode === 'schedule' ? 'Campaign scheduled.' : 'Campaign saved as draft.');
      }
      setDialogOpen(false);
      setForm(initialForm);
      setPreview(null);
      await loadCampaigns();
    } catch (err) {
      setError(err.isValidation ? err.message : err.response?.data?.message || 'Unable to save campaign.');
    } finally {
      setSaving(false);
    }
  };

  const sendExisting = async (campaign) => {
    if (!window.confirm(`Send campaign "${campaign.name}" in local simulation mode?`)) return;
    try {
      setLoading(true);
      await sendCampaign(campaign.id);
      setSuccess('Campaign sent through local simulation.');
      await loadCampaigns();
    } catch (err) {
      setError(err.response?.data?.message || 'Unable to send campaign.');
    } finally {
      setLoading(false);
    }
  };

  const cancelExisting = async (campaign) => {
    try {
      await cancelCampaign(campaign.id);
      setSuccess('Campaign cancelled.');
      await loadCampaigns();
    } catch (err) {
      setError(err.response?.data?.message || 'Unable to cancel campaign.');
    }
  };

  const removeCampaign = async (campaign) => {
    if (!window.confirm(`Delete campaign "${campaign.name}"?`)) return;
    await deleteCampaign(campaign.id);
    setSuccess('Campaign deleted.');
    await loadCampaigns();
  };

  const openAnalytics = async (campaign) => {
    try {
      setLoading(true);
      const response = await getCampaignAnalytics(campaign.id);
      setAnalytics(response.data.data);
      setAnalyticsOpen(true);
    } catch (err) {
      setError(err.response?.data?.message || 'Unable to load analytics.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Stack spacing={2.5}>
      {error && <Alert severity="error" onClose={() => setError('')}>{error}</Alert>}
      {success && <Alert severity="success" onClose={() => setSuccess('')}>{success}</Alert>}

      <Grid container spacing={2}>
        {Object.entries(totals).map(([status, count]) => (
          <Grid item xs={6} md={2} key={status}>
            <Paper sx={{ p: 2, border: '1px solid #e8edf2' }} elevation={0}>
              <Typography variant="h5" fontWeight={850}>{count}</Typography>
              <Typography variant="body2" color="text.secondary">{status}</Typography>
            </Paper>
          </Grid>
        ))}
      </Grid>

      <Paper sx={{ p: 2.5, border: '1px solid #e8edf2' }} elevation={0}>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} alignItems={{ md: 'center' }}>
          <Box sx={{ flex: 1 }}>
            <Typography variant="h5" fontWeight={850}>WhatsApp Broadcast Campaigns</Typography>
            <Typography color="text.secondary">Build audiences from contacts or leads, preview recipients, and test campaigns safely with simulated sends.</Typography>
          </Box>
          <Button variant="contained" startIcon={<AddIcon />} onClick={() => { setForm(initialForm); setPreview(null); setDialogOpen(true); }} sx={{ bgcolor: '#128c7e' }}>
            Create Campaign
          </Button>
        </Stack>
      </Paper>

      <Paper sx={{ border: '1px solid #e8edf2', overflow: 'hidden' }} elevation={0}>
        {loading && <LinearProgress />}
        <TableContainer>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>Campaign</TableCell>
                <TableCell>Status</TableCell>
                <TableCell>Audience</TableCell>
                <TableCell>Scheduled</TableCell>
                <TableCell>Sent</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {campaigns.map((campaign) => (
                <TableRow key={campaign.id} hover>
                  <TableCell>
                    <Typography fontWeight={800}>{campaign.name}</Typography>
                    <Typography variant="body2" color="text.secondary">{campaign.templateName || campaign.description || 'Custom message'}</Typography>
                  </TableCell>
                  <TableCell><Chip size="small" label={campaign.status} color={statusColors[campaign.status] || 'default'} /></TableCell>
                  <TableCell>{campaign.audienceType}</TableCell>
                  <TableCell>{formatDate(campaign.scheduledAt)}</TableCell>
                  <TableCell>{formatDate(campaign.sentAt)}</TableCell>
                  <TableCell align="right">
                    {['Draft', 'Scheduled', 'Failed'].includes(campaign.status) && (
                      <IconButton title="Send now" onClick={() => sendExisting(campaign)}><PlayArrowIcon /></IconButton>
                    )}
                    {['Draft', 'Scheduled'].includes(campaign.status) && (
                      <IconButton title="Cancel" onClick={() => cancelExisting(campaign)}><CancelIcon /></IconButton>
                    )}
                    <IconButton title="Analytics" onClick={() => openAnalytics(campaign)}><AnalyticsIcon /></IconButton>
                    <IconButton color="error" title="Delete" onClick={() => removeCampaign(campaign)}><DeleteOutlineIcon /></IconButton>
                  </TableCell>
                </TableRow>
              ))}
              {!loading && campaigns.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6}>
                    <Box sx={{ py: 5, textAlign: 'center' }}>
                      <Typography fontWeight={800}>No campaigns yet</Typography>
                      <Typography color="text.secondary">Create your first local test broadcast.</Typography>
                    </Box>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>

      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} maxWidth="lg" fullWidth>
        <DialogTitle>Create Broadcast Campaign</DialogTitle>
        <DialogContent>
          <Grid container spacing={2} sx={{ mt: 0.5 }}>
            <Grid item xs={12} md={8}>
              <TextField label="Campaign Name" required value={form.name} onChange={setField('name')} fullWidth />
            </Grid>
            <Grid item xs={12} md={4}>
              <FormControl fullWidth>
                <InputLabel>Audience</InputLabel>
                <Select label="Audience" value={form.audienceType} onChange={setField('audienceType')}>
                  <MenuItem value="contacts">Contacts</MenuItem>
                  <MenuItem value="leads">Leads</MenuItem>
                  <MenuItem value="mixed">Contacts and Leads</MenuItem>
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12}>
              <TextField label="Description" value={form.description} onChange={setField('description')} fullWidth />
            </Grid>

            <Grid item xs={12}><Divider><Chip label="Audience Filters" /></Divider></Grid>
            <Grid item xs={12} md={2.4}><TextField label="Tag" value={form.tag} onChange={setField('tag')} fullWidth /></Grid>
            <Grid item xs={12} md={2.4}>
              <FormControl fullWidth>
                <InputLabel>Status</InputLabel>
                <Select label="Status" value={form.status} onChange={setField('status')}>
                  <MenuItem value="">Any</MenuItem>
                  {(form.audienceType === 'contacts' ? contactStatuses : leadStatuses).map((item) => <MenuItem key={item} value={item}>{item}</MenuItem>)}
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12} md={2.4}>
              <FormControl fullWidth>
                <InputLabel>Source</InputLabel>
                <Select label="Source" value={form.source} onChange={setField('source')} disabled={form.audienceType === 'contacts'}>
                  <MenuItem value="">Any</MenuItem>
                  {sources.map((item) => <MenuItem key={item} value={item}>{item}</MenuItem>)}
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12} md={2.4}>
              <FormControl fullWidth>
                <InputLabel>Course</InputLabel>
                <Select label="Course" value={form.courseInterested} onChange={setField('courseInterested')} disabled={form.audienceType === 'contacts'}>
                  <MenuItem value="">Any</MenuItem>
                  {courses.map((item) => <MenuItem key={item} value={item}>{item}</MenuItem>)}
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12} md={2.4}>
              <FormControl fullWidth>
                <InputLabel>Agent</InputLabel>
                <Select label="Agent" value={form.assignedAgentId} onChange={setField('assignedAgentId')} disabled={form.audienceType === 'contacts'}>
                  <MenuItem value="">Any</MenuItem>
                  {agents.map((agent) => <MenuItem key={agent.id} value={agent.id}>{agentName(agent)}</MenuItem>)}
                </Select>
              </FormControl>
            </Grid>

            <Grid item xs={12}><Divider><Chip label="Message" /></Divider></Grid>
            <Grid item xs={12} md={6}>
              <FormControl fullWidth>
                <InputLabel>Template</InputLabel>
                <Select label="Template" value={form.templateId} onChange={setField('templateId')}>
                  <MenuItem value="">Custom message</MenuItem>
                  {templates.map((template) => <MenuItem key={template.id} value={template.id}>{template.name}</MenuItem>)}
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12} md={3}><TextField label="Media ID" value={form.mediaId} onChange={setField('mediaId')} fullWidth /></Grid>
            <Grid item xs={12} md={3}><TextField label="Schedule Date/Time" type="datetime-local" value={form.scheduledAt} onChange={setField('scheduledAt')} InputLabelProps={{ shrink: true }} fullWidth /></Grid>
            <Grid item xs={12}>
              <TextField
                label="Message Body"
                required
                value={form.messageBody}
                onChange={setField('messageBody')}
                helperText="Use placeholders like {{name}} or {{phone}}."
                multiline
                minRows={4}
                fullWidth
              />
            </Grid>
            <Grid item xs={12}>
              <TextField label="Variables JSON" value={form.variables} onChange={setField('variables')} multiline minRows={2} fullWidth />
            </Grid>
            <Grid item xs={12}>
              <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} alignItems={{ md: 'center' }}>
                <Button variant="outlined" startIcon={<PreviewIcon />} onClick={runPreview} disabled={saving}>Preview Audience</Button>
                {preview && <Chip color="success" label={`${preview.total} recipient(s) matched`} />}
              </Stack>
              {preview?.recipients?.length > 0 && (
                <TableContainer component={Paper} elevation={0} sx={{ mt: 2, border: '1px solid #e8edf2', maxHeight: 260 }}>
                  <Table size="small" stickyHeader>
                    <TableHead><TableRow><TableCell>Name</TableCell><TableCell>Phone</TableCell><TableCell>Status</TableCell><TableCell>Source</TableCell><TableCell>Course</TableCell></TableRow></TableHead>
                    <TableBody>
                      {preview.recipients.map((recipient) => (
                        <TableRow key={`${recipient.phone}-${recipient.leadId || recipient.contactId}`}>
                          <TableCell>{recipient.name}</TableCell>
                          <TableCell>{recipient.phone}</TableCell>
                          <TableCell>{recipient.status || '-'}</TableCell>
                          <TableCell>{recipient.source || '-'}</TableCell>
                          <TableCell>{recipient.courseInterested || '-'}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              )}
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialogOpen(false)}>Close</Button>
          <Button onClick={() => saveCampaign('draft')} disabled={saving || !form.name.trim() || !form.messageBody.trim()}>Save Draft</Button>
          <Button startIcon={<ScheduleIcon />} onClick={() => saveCampaign('schedule')} disabled={saving || !form.scheduledAt || !form.name.trim() || !form.messageBody.trim()}>Schedule</Button>
          <Button variant="contained" startIcon={<PlayArrowIcon />} onClick={() => saveCampaign('send')} disabled={saving || !form.name.trim() || !form.messageBody.trim()}>Send Now</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={analyticsOpen} onClose={() => setAnalyticsOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle>Campaign Analytics</DialogTitle>
        <DialogContent>
          {analytics && (
            <Stack spacing={2}>
              <Box>
                <Typography variant="h6" fontWeight={850}>{analytics.campaign?.name}</Typography>
                <Typography color="text.secondary">{analytics.totals.totalTargeted} total targeted</Typography>
              </Box>
              <Grid container spacing={2}>
                {Object.entries(analytics.totals).map(([key, value]) => (
                  <Grid item xs={6} md={3} key={key}>
                    <Paper sx={{ p: 2, border: '1px solid #e8edf2' }} elevation={0}>
                      <Typography variant="h5" fontWeight={850}>{value}</Typography>
                      <Typography variant="body2" color="text.secondary">{key}</Typography>
                    </Paper>
                  </Grid>
                ))}
              </Grid>
              {Object.entries(analytics.rates).map(([key, value]) => (
                <Box key={key}>
                  <Stack direction="row" justifyContent="space-between"><Typography fontWeight={800}>{key}</Typography><Typography>{rate(value)}</Typography></Stack>
                  <LinearProgress variant="determinate" value={Math.min(Number(value || 0), 100)} sx={{ height: 8, borderRadius: 1 }} />
                </Box>
              ))}
              <Divider />
              <Typography variant="subtitle1" fontWeight={850}>Failure Report</Typography>
              {analytics.failureReport?.length ? (
                <TableContainer>
                  <Table size="small">
                    <TableHead><TableRow><TableCell>Recipient</TableCell><TableCell>Phone</TableCell><TableCell>Error</TableCell></TableRow></TableHead>
                    <TableBody>
                      {analytics.failureReport.map((row) => (
                        <TableRow key={row.id}><TableCell>{row.name || '-'}</TableCell><TableCell>{row.phone}</TableCell><TableCell>{row.errorMessage || row.status}</TableCell></TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              ) : (
                <Typography color="text.secondary">No failures recorded.</Typography>
              )}
            </Stack>
          )}
        </DialogContent>
        <DialogActions><Button onClick={() => setAnalyticsOpen(false)}>Close</Button></DialogActions>
      </Dialog>
    </Stack>
  );
}

export default CampaignsPage;
