import React from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Alert, Box, Button, Checkbox, Chip, Dialog, DialogActions, DialogContent, DialogTitle,
  FormControlLabel, Grid, IconButton, MenuItem, Paper, Stack, Step, StepLabel, Stepper,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TablePagination,
  TextField, Tooltip, Typography
} from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';
import * as service from '../services/smsCampaign.service';
import { getSmsGatewayMasks, getSmsGatewayBalance, getSmsGatewaySettings } from '../services/smsGateway.service';

const STATUS_COLOR = {
  draft: 'default', scheduled: 'info', queued: 'info', running: 'primary',
  paused: 'warning', completed: 'success', cancelled: 'default', failed: 'error'
};
const RECIPIENT_SOURCES = [
  { value: 'contacts', label: 'Contacts' },
  { value: 'leads', label: 'Leads' },
  { value: 'students', label: 'Students' },
  { value: 'course', label: 'Course (all enrolled students)' },
  { value: 'batch', label: 'Batch (all students in batch)' },
  { value: 'manual', label: 'Manual phone list' }
];
const STEPS = ['Campaign Details', 'Audience', 'Message', 'Preview', 'Send / Schedule'];

// Same GSM 03.38 rules as backend/src/utils/smsSegment.js, duplicated here
// only for instant client-side feedback while typing — the authoritative
// estimate shown in Preview always comes from the server.
const GSM_7_BASIC = '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞ\x1bÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà';
const GSM_7_EXTENDED = '^{}\\[~]|€';
function estimateSegmentsLocal(text) {
  const value = String(text || '');
  if (!value) return { encoding: 'GSM-7', characters: 0, segments: 0 };
  const chars = [...value];
  const gsm7 = chars.every((c) => GSM_7_BASIC.includes(c) || GSM_7_EXTENDED.includes(c));
  const characters = gsm7 ? chars.reduce((sum, c) => sum + (GSM_7_EXTENDED.includes(c) ? 2 : 1), 0) : chars.length;
  const singleLimit = gsm7 ? 160 : 70;
  const multiLimit = gsm7 ? 153 : 67;
  const segments = characters <= singleLimit ? 1 : Math.ceil(characters / multiLimit);
  return { encoding: gsm7 ? 'GSM-7' : 'UCS-2', characters, segments };
}

function emptyForm() {
  return { name: '', senderMask: '', recipientSource: 'contacts', audienceConfig: {}, message: '' };
}

export default function SmsCampaignsPage() {
  const navigate = useNavigate();
  const [rows, setRows] = React.useState([]);
  const [total, setTotal] = React.useState(0);
  const [page, setPage] = React.useState(0);
  const [pageSize, setPageSize] = React.useState(25);
  const [message, setMessage] = React.useState(null);
  const [loading, setLoading] = React.useState(false);

  const [wizardOpen, setWizardOpen] = React.useState(false);
  const [step, setStep] = React.useState(0);
  const [form, setForm] = React.useState(emptyForm());
  const [masks, setMasks] = React.useState(null);
  const [audienceOptions, setAudienceOptions] = React.useState({ leadStatuses: [], courses: [], batches: [] });
  const [preview, setPreview] = React.useState(null);
  const [previewing, setPreviewing] = React.useState(false);
  const [scheduleMode, setScheduleMode] = React.useState('now');
  const [scheduledAt, setScheduledAt] = React.useState('');
  const [confirmed, setConfirmed] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);

  const load = React.useCallback(async () => {
    setLoading(true); setMessage(null);
    try {
      const { data } = await service.listSmsCampaigns({ page: page + 1, pageSize });
      setRows(data.data.rows); setTotal(data.data.total);
    } catch (error) {
      setMessage({ severity: 'error', text: error.response?.data?.message || error.message });
    } finally { setLoading(false); }
  }, [page, pageSize]);
  React.useEffect(() => { load(); }, [load]);

  const openWizard = async () => {
    setForm(emptyForm()); setStep(0); setPreview(null); setScheduleMode('now'); setScheduledAt(''); setConfirmed(false);
    setWizardOpen(true);
    try {
      const [{ data: options }, { data: gateway }] = await Promise.all([service.getAudienceOptions(), getSmsGatewaySettings()]);
      setAudienceOptions(options.data);
      if (gateway.data.capabilities?.masks) {
        const { data: maskData } = await getSmsGatewayMasks().catch(() => ({ data: { data: [] } }));
        setMasks(Array.isArray(maskData.data) ? maskData.data : []);
      } else setMasks([]);
    } catch (error) {
      setMessage({ severity: 'error', text: error.response?.data?.message || error.message });
    }
  };

  const runPreview = async () => {
    setPreviewing(true); setMessage(null);
    try {
      const { data } = await service.previewSmsCampaignAudience({
        recipientSource: form.recipientSource, audienceConfig: form.audienceConfig, message: form.message
      });
      setPreview(data.data);
    } catch (error) {
      setMessage({ severity: 'error', text: error.response?.data?.message || error.message });
    } finally { setPreviewing(false); }
  };

  const goNext = async () => {
    if (step === 0 && !form.name.trim()) { setMessage({ severity: 'error', text: 'Campaign name is required.' }); return; }
    if (step === 2 && !form.message.trim()) { setMessage({ severity: 'error', text: 'Message is required.' }); return; }
    const nextStep = step + 1;
    if (nextStep === 3) await runPreview();
    setStep(nextStep);
  };

  const confirmSend = async () => {
    if (submitting) return;
    if (scheduleMode === 'now' && !confirmed) {
      setMessage({ severity: 'error', text: 'Please confirm before sending now.' });
      return;
    }
    if (scheduleMode === 'later' && !scheduledAt) {
      setMessage({ severity: 'error', text: 'Choose a schedule date/time.' });
      return;
    }
    setSubmitting(true); setMessage(null);
    try {
      const { data: created } = await service.createSmsCampaign({
        name: form.name, message: form.message, senderMask: form.senderMask || null,
        recipientSource: form.recipientSource, audienceConfig: form.audienceConfig
      });
      if (scheduleMode === 'now') await service.sendSmsCampaignNow(created.data.id);
      else await service.scheduleSmsCampaign(created.data.id, new Date(scheduledAt).toISOString());
      setWizardOpen(false);
      setMessage({ severity: 'success', text: scheduleMode === 'now' ? 'Campaign is sending now.' : 'Campaign scheduled.' });
      await load();
    } catch (error) {
      setMessage({ severity: 'error', text: error.response?.data?.message || error.message });
    } finally { setSubmitting(false); }
  };

  const saveDraft = async () => {
    if (submitting) return;
    setSubmitting(true); setMessage(null);
    try {
      await service.createSmsCampaign({
        name: form.name || 'Untitled campaign', message: form.message, senderMask: form.senderMask || null,
        recipientSource: form.recipientSource, audienceConfig: form.audienceConfig
      });
      setWizardOpen(false);
      setMessage({ severity: 'success', text: 'Draft saved.' });
      await load();
    } catch (error) {
      setMessage({ severity: 'error', text: error.response?.data?.message || error.message });
    } finally { setSubmitting(false); }
  };

  const runAction = async (id, fn, successText) => {
    setMessage(null);
    try { await fn(id); setMessage({ severity: 'success', text: successText }); await load(); }
    catch (error) { setMessage({ severity: 'error', text: error.response?.data?.message || error.message }); }
  };

  const updateAudienceConfig = (patch) => setForm((prev) => ({ ...prev, audienceConfig: { ...prev.audienceConfig, ...patch } }));

  const localEstimate = estimateSegmentsLocal(form.message);

  return <Box>
    <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
      <Typography variant="h4">SMS Campaigns</Typography>
      <Stack direction="row" spacing={1}>
        <Tooltip title="Refresh"><IconButton onClick={load}><RefreshIcon /></IconButton></Tooltip>
        <Button variant="contained" onClick={openWizard}>New Campaign</Button>
      </Stack>
    </Stack>
    {message && <Alert severity={message.severity} sx={{ mb: 2 }}>{message.text}</Alert>}

    <TableContainer component={Paper}>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>Name</TableCell>
            <TableCell>Audience</TableCell>
            <TableCell>Status</TableCell>
            <TableCell>Recipients</TableCell>
            <TableCell>Sent</TableCell>
            <TableCell>Delivered</TableCell>
            <TableCell>Failed</TableCell>
            <TableCell>Scheduled</TableCell>
            <TableCell>Created</TableCell>
            <TableCell>Actions</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {!loading && rows.length === 0 && <TableRow><TableCell colSpan={10} align="center">No SMS campaigns yet.</TableCell></TableRow>}
          {rows.map((row) => (
            <TableRow key={row.id} hover>
              <TableCell style={{ cursor: 'pointer' }} onClick={() => navigate(`/sms-campaigns/${row.id}`)}>{row.name}</TableCell>
              <TableCell>{row.recipientSource}</TableCell>
              <TableCell><Chip size="small" label={row.status} color={STATUS_COLOR[row.status] || 'default'} /></TableCell>
              <TableCell>{row.totalRecipients}</TableCell>
              <TableCell>{row.sentCount}</TableCell>
              <TableCell>{row.deliveredCount}</TableCell>
              <TableCell>{row.failedCount}</TableCell>
              <TableCell>{row.scheduledAt ? new Date(row.scheduledAt).toLocaleString() : '—'}</TableCell>
              <TableCell>{new Date(row.createdAt).toLocaleString()}</TableCell>
              <TableCell>
                <Stack direction="row" spacing={0.5}>
                  {['draft', 'failed'].includes(row.status) && <Button size="small" onClick={() => runAction(row.id, service.sendSmsCampaignNow, 'Campaign is sending now.')}>Send</Button>}
                  {['queued', 'running'].includes(row.status) && <Button size="small" onClick={() => runAction(row.id, service.pauseSmsCampaign, 'Campaign paused.')}>Pause</Button>}
                  {row.status === 'paused' && <Button size="small" onClick={() => runAction(row.id, service.resumeSmsCampaign, 'Campaign resumed.')}>Resume</Button>}
                  {!['completed', 'cancelled'].includes(row.status) && <Button size="small" color="error" onClick={() => runAction(row.id, service.cancelSmsCampaign, 'Campaign cancelled.')}>Cancel</Button>}
                </Stack>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <TablePagination
        component="div" count={total} page={page} onPageChange={(e, p) => setPage(p)}
        rowsPerPage={pageSize} onRowsPerPageChange={(e) => { setPageSize(Number(e.target.value)); setPage(0); }}
        rowsPerPageOptions={[10, 25, 50, 100]}
      />
    </TableContainer>

    <Dialog open={wizardOpen} onClose={() => !submitting && setWizardOpen(false)} fullWidth maxWidth="md">
      <DialogTitle>New SMS Campaign</DialogTitle>
      <DialogContent dividers>
        <Stepper activeStep={step} sx={{ mb: 3 }}>
          {STEPS.map((label) => <Step key={label}><StepLabel>{label}</StepLabel></Step>)}
        </Stepper>

        {step === 0 && <Stack spacing={2}>
          <TextField label="Campaign name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          {masks && masks.length > 0 ? (
            <TextField select label="Sender mask" value={form.senderMask} onChange={(e) => setForm({ ...form, senderMask: e.target.value })} helperText="Only approved masks are listed.">
              <MenuItem value="">Use gateway default</MenuItem>
              {masks.map((m) => <MenuItem key={m} value={m}>{m}</MenuItem>)}
            </TextField>
          ) : (
            <TextField label="Sender mask (optional)" value={form.senderMask} onChange={(e) => setForm({ ...form, senderMask: e.target.value })} helperText={masks && masks.length === 0 ? 'No approved sender masks are currently available from the SMS provider.' : 'Leave blank to use the gateway default mask.'} />
          )}
        </Stack>}

        {step === 1 && <Stack spacing={2}>
          <TextField select label="Recipient source" value={form.recipientSource} onChange={(e) => setForm({ ...form, recipientSource: e.target.value, audienceConfig: {} })}>
            {RECIPIENT_SOURCES.map((s) => <MenuItem key={s.value} value={s.value}>{s.label}</MenuItem>)}
          </TextField>

          {form.recipientSource === 'contacts' && <Grid container spacing={2}>
            <Grid item xs={6}><TextField select fullWidth label="Status" value={form.audienceConfig.status || ''} onChange={(e) => updateAudienceConfig({ status: e.target.value || undefined })}>
              <MenuItem value="">Any</MenuItem>
              {['new', 'active', 'inactive', 'archived'].map((s) => <MenuItem key={s} value={s}>{s}</MenuItem>)}
            </TextField></Grid>
            <Grid item xs={6}><TextField fullWidth label="Label / tag" value={form.audienceConfig.tag || ''} onChange={(e) => updateAudienceConfig({ tag: e.target.value || undefined })} /></Grid>
          </Grid>}

          {form.recipientSource === 'leads' && <Grid container spacing={2}>
            <Grid item xs={6}><TextField select fullWidth label="Lead status" value={form.audienceConfig.leadStatusId || ''} onChange={(e) => updateAudienceConfig({ leadStatusId: e.target.value || undefined })}>
              <MenuItem value="">Any</MenuItem>
              {audienceOptions.leadStatuses.map((s) => <MenuItem key={s.id} value={s.id}>{s.name}</MenuItem>)}
            </TextField></Grid>
            <Grid item xs={6}><TextField fullWidth label="Contact label / tag" value={form.audienceConfig.tag || ''} onChange={(e) => updateAudienceConfig({ tag: e.target.value || undefined })} /></Grid>
          </Grid>}

          {form.recipientSource === 'students' && <Grid container spacing={2}>
            <Grid item xs={4}><TextField select fullWidth label="Course" value={form.audienceConfig.courseId || ''} onChange={(e) => updateAudienceConfig({ courseId: e.target.value || undefined })}>
              <MenuItem value="">Any</MenuItem>
              {audienceOptions.courses.map((c) => <MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>)}
            </TextField></Grid>
            <Grid item xs={4}><TextField select fullWidth label="Batch" value={form.audienceConfig.batchId || ''} onChange={(e) => updateAudienceConfig({ batchId: e.target.value || undefined })}>
              <MenuItem value="">Any</MenuItem>
              {audienceOptions.batches.map((b) => <MenuItem key={b.id} value={b.id}>{b.name}</MenuItem>)}
            </TextField></Grid>
            <Grid item xs={4}><TextField select fullWidth label="Status" value={form.audienceConfig.status || ''} onChange={(e) => updateAudienceConfig({ status: e.target.value || undefined })}>
              <MenuItem value="">Any</MenuItem>
              {['enrolled', 'active', 'completed', 'dropped', 'suspended'].map((s) => <MenuItem key={s} value={s}>{s}</MenuItem>)}
            </TextField></Grid>
          </Grid>}

          {form.recipientSource === 'course' && <TextField select fullWidth label="Course" value={form.audienceConfig.courseId || ''} onChange={(e) => updateAudienceConfig({ courseId: e.target.value })}>
            {audienceOptions.courses.map((c) => <MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>)}
          </TextField>}

          {form.recipientSource === 'batch' && <TextField select fullWidth label="Batch" value={form.audienceConfig.batchId || ''} onChange={(e) => updateAudienceConfig({ batchId: e.target.value })}>
            {audienceOptions.batches.map((b) => <MenuItem key={b.id} value={b.id}>{b.name}</MenuItem>)}
          </TextField>}

          {form.recipientSource === 'manual' && <TextField
            multiline minRows={5} fullWidth label="Phone numbers"
            placeholder={'0771234567\n0779876543\n...one per line or comma separated'}
            value={form.audienceConfig.phoneNumbers || ''}
            onChange={(e) => updateAudienceConfig({ phoneNumbers: e.target.value })}
          />}
        </Stack>}

        {step === 2 && <Stack spacing={1}>
          <TextField
            multiline minRows={5} fullWidth label="Message" value={form.message}
            onChange={(e) => setForm({ ...form, message: e.target.value })}
            helperText="Personalize with {{name}}, {{first_name}}, {{phone}}, {{course}}, {{batch}}."
          />
          <Typography variant="caption" color="text.secondary">
            {localEstimate.characters} characters · {localEstimate.encoding} · ~{localEstimate.segments} segment{localEstimate.segments === 1 ? '' : 's'} per recipient
          </Typography>
        </Stack>}

        {step === 3 && <Box>
          {previewing && <Typography>Loading preview…</Typography>}
          {!previewing && preview && <Stack spacing={2}>
            <Grid container spacing={2}>
              <Grid item xs={4}><Typography variant="body2"><strong>Valid recipients:</strong> {preview.totalValid}</Typography></Grid>
              <Grid item xs={4}><Typography variant="body2"><strong>Duplicates removed:</strong> {preview.duplicatesRemoved}</Typography></Grid>
              <Grid item xs={4}><Typography variant="body2"><strong>Invalid excluded:</strong> {preview.totalInvalid}</Typography></Grid>
              <Grid item xs={4}><Typography variant="body2"><strong>Encoding:</strong> {preview.segmentEstimate.encoding}</Typography></Grid>
              <Grid item xs={4}><Typography variant="body2"><strong>Segments/recipient:</strong> {preview.segmentEstimate.segmentsPerRecipient}</Typography></Grid>
              <Grid item xs={4}><Typography variant="body2"><strong>Estimated total segments:</strong> {preview.segmentEstimate.estimatedTotalSegments}</Typography></Grid>
              <Grid item xs={4}><Typography variant="body2"><strong>Provider:</strong> {preview.settings?.provider || '—'}</Typography></Grid>
              <Grid item xs={4}><Typography variant="body2"><strong>Mode:</strong> {preview.settings?.mode || '—'}</Typography></Grid>
              <Grid item xs={4}><Typography variant="body2"><strong>Balance:</strong> {preview.balance ? `${preview.balance.currency || ''} ${preview.balance.balance}`.trim() : 'Not available'}</Typography></Grid>
            </Grid>
            <Typography variant="subtitle2">Sample recipients ({preview.recipients.length} of {preview.totalValid})</Typography>
            <TableContainer component={Paper} sx={{ maxHeight: 240 }}>
              <Table size="small" stickyHeader>
                <TableHead><TableRow><TableCell>Phone</TableCell><TableCell>Name</TableCell></TableRow></TableHead>
                <TableBody>{preview.recipients.map((r) => <TableRow key={r.phone}><TableCell>{r.phone}</TableCell><TableCell>{r.name || '—'}</TableCell></TableRow>)}</TableBody>
              </Table>
            </TableContainer>
            {preview.totalInvalid > 0 && <Alert severity="warning">{preview.totalInvalid} number(s) could not be normalized and will be excluded.</Alert>}
          </Stack>}
        </Box>}

        {step === 4 && <Stack spacing={2}>
          <TextField select label="When" value={scheduleMode} onChange={(e) => setScheduleMode(e.target.value)} sx={{ maxWidth: 240 }}>
            <MenuItem value="now">Send Now</MenuItem>
            <MenuItem value="later">Schedule</MenuItem>
          </TextField>
          {scheduleMode === 'later' && <TextField type="datetime-local" label="Scheduled time" InputLabelProps={{ shrink: true }} value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} sx={{ maxWidth: 320 }} />}
          {scheduleMode === 'now' && <FormControlLabel
            control={<Checkbox checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />}
            label={`I confirm I want to send this SMS campaign to ${preview?.totalValid ?? '—'} recipient(s) now.`}
          />}
        </Stack>}
      </DialogContent>
      <DialogActions>
        <Button disabled={submitting} onClick={() => setWizardOpen(false)}>Cancel</Button>
        <Button disabled={submitting} onClick={saveDraft}>Save Draft</Button>
        {step > 0 && <Button disabled={submitting} onClick={() => setStep(step - 1)}>Back</Button>}
        {step < STEPS.length - 1 && <Button variant="contained" disabled={submitting} onClick={goNext}>Next</Button>}
        {step === STEPS.length - 1 && <Button variant="contained" disabled={submitting} onClick={confirmSend}>{submitting ? 'Submitting…' : (scheduleMode === 'now' ? 'Confirm & Send Now' : 'Confirm & Schedule')}</Button>}
      </DialogActions>
    </Dialog>
  </Box>;
}
