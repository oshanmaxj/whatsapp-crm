import React from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Alert, Box, Button, Card, CardContent, Chip, Grid, IconButton, LinearProgress,
  MenuItem, Paper, Stack, Table, TableBody, TableCell, TableContainer, TableHead,
  TableRow, TablePagination, TextField, Tooltip, Typography
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import RefreshIcon from '@mui/icons-material/Refresh';
import * as service from '../services/smsCampaign.service';

const STATUS_COLOR = {
  draft: 'default', scheduled: 'info', queued: 'info', running: 'primary',
  paused: 'warning', completed: 'success', cancelled: 'default', failed: 'error'
};
const RECIPIENT_STATUS_OPTIONS = ['queued', 'processing', 'retrying', 'sent', 'delivered', 'failed', 'rejected', 'cancelled'];

function formatDate(value) { return value ? new Date(value).toLocaleString() : '—'; }

export default function SmsCampaignDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [campaign, setCampaign] = React.useState(null);
  const [recipients, setRecipients] = React.useState([]);
  const [total, setTotal] = React.useState(0);
  const [page, setPage] = React.useState(0);
  const [pageSize, setPageSize] = React.useState(25);
  const [statusFilter, setStatusFilter] = React.useState('');
  const [message, setMessage] = React.useState(null);
  const [loading, setLoading] = React.useState(false);

  const load = React.useCallback(async () => {
    setLoading(true); setMessage(null);
    try {
      const [{ data: campaignData }, { data: recipientData }] = await Promise.all([
        service.getSmsCampaign(id),
        service.listSmsCampaignRecipients(id, { page: page + 1, pageSize, ...(statusFilter ? { status: statusFilter } : {}) })
      ]);
      setCampaign(campaignData.data);
      setRecipients(recipientData.data.rows);
      setTotal(recipientData.data.total);
    } catch (error) {
      setMessage({ severity: 'error', text: error.response?.data?.message || error.message });
    } finally { setLoading(false); }
  }, [id, page, pageSize, statusFilter]);
  React.useEffect(() => { load(); }, [load]);

  // Auto-refresh while the campaign is actively sending, mirroring the
  // existing WhatsApp campaign analytics modal's polling pattern.
  React.useEffect(() => {
    if (!campaign || !['queued', 'running'].includes(campaign.status)) return undefined;
    const timer = setInterval(load, 5000);
    return () => clearInterval(timer);
  }, [campaign, load]);

  const runAction = async (fn, successText) => {
    setMessage(null);
    try { await fn(id); setMessage({ severity: 'success', text: successText }); await load(); }
    catch (error) { setMessage({ severity: 'error', text: error.response?.data?.message || error.message }); }
  };

  if (!campaign) return <Box>{message && <Alert severity={message.severity}>{message.text}</Alert>}</Box>;

  const finished = (campaign.sentCount || 0) + (campaign.deliveredCount || 0) + (campaign.failedCount || 0) + (campaign.rejectedCount || 0);
  const progress = campaign.totalRecipients ? Math.min(100, Math.round((finished / campaign.totalRecipients) * 100)) : 0;
  const remaining = Math.max(campaign.totalRecipients - finished, 0);

  return <Box>
    <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 2 }}>
      <IconButton onClick={() => navigate('/sms-campaigns')}><ArrowBackIcon /></IconButton>
      <Typography variant="h4">{campaign.name}</Typography>
      <Chip label={campaign.status} color={STATUS_COLOR[campaign.status] || 'default'} />
      <Box sx={{ flexGrow: 1 }} />
      <Tooltip title="Refresh"><IconButton onClick={load}><RefreshIcon /></IconButton></Tooltip>
    </Stack>
    {message && <Alert severity={message.severity} sx={{ mb: 2 }}>{message.text}</Alert>}

    <Card sx={{ mb: 3 }}>
      <CardContent>
        <Grid container spacing={2} sx={{ mb: 2 }}>
          <Grid item xs={12} md={6}><Typography variant="body2"><strong>Message:</strong> {campaign.message}</Typography></Grid>
          <Grid item xs={6} md={2}><Typography variant="body2"><strong>Sender mask:</strong> {campaign.senderMask || '—'}</Typography></Grid>
          <Grid item xs={6} md={2}><Typography variant="body2"><strong>Provider:</strong> {campaign.provider || '—'}</Typography></Grid>
          <Grid item xs={6} md={2}><Typography variant="body2"><strong>Mode:</strong> {campaign.mode || '—'}</Typography></Grid>
        </Grid>
        <Box sx={{ mb: 1 }}>
          <Stack direction="row" justifyContent="space-between"><Typography variant="caption">Progress</Typography><Typography variant="caption">{progress}%</Typography></Stack>
          <LinearProgress variant="determinate" value={progress} />
        </Box>
        <Grid container spacing={2}>
          <Grid item xs={4} sm={2}><Typography variant="body2"><strong>Total:</strong> {campaign.totalRecipients}</Typography></Grid>
          <Grid item xs={4} sm={2}><Typography variant="body2"><strong>Sent:</strong> {campaign.sentCount}</Typography></Grid>
          <Grid item xs={4} sm={2}><Typography variant="body2"><strong>Delivered:</strong> {campaign.deliveredCount}</Typography></Grid>
          <Grid item xs={4} sm={2}><Typography variant="body2"><strong>Failed:</strong> {campaign.failedCount}</Typography></Grid>
          <Grid item xs={4} sm={2}><Typography variant="body2"><strong>Rejected:</strong> {campaign.rejectedCount}</Typography></Grid>
          <Grid item xs={4} sm={2}><Typography variant="body2"><strong>Remaining:</strong> {remaining}</Typography></Grid>
        </Grid>
        {campaign.lastError && <Alert severity="warning" sx={{ mt: 2 }}>{campaign.lastError}</Alert>}
        <Stack direction="row" spacing={1} sx={{ mt: 2 }}>
          {['draft', 'failed'].includes(campaign.status) && <Button variant="contained" onClick={() => runAction(service.sendSmsCampaignNow, 'Campaign is sending now.')}>Send Now</Button>}
          {['queued', 'running'].includes(campaign.status) && <Button onClick={() => runAction(service.pauseSmsCampaign, 'Campaign paused.')}>Pause</Button>}
          {campaign.status === 'paused' && <Button onClick={() => runAction(service.resumeSmsCampaign, 'Campaign resumed.')}>Resume</Button>}
          {campaign.failedCount > 0 && <Button onClick={() => runAction(service.retrySmsCampaign, 'Eligible failed recipients requeued.')}>Retry Failed</Button>}
          {!['completed', 'cancelled'].includes(campaign.status) && <Button color="error" onClick={() => runAction(service.cancelSmsCampaign, 'Campaign cancelled.')}>Cancel</Button>}
        </Stack>
      </CardContent>
    </Card>

    <Stack direction="row" spacing={2} sx={{ mb: 2 }}>
      <TextField select size="small" label="Status" value={statusFilter} onChange={(e) => { setPage(0); setStatusFilter(e.target.value); }} sx={{ minWidth: 180 }}>
        <MenuItem value="">All</MenuItem>
        {RECIPIENT_STATUS_OPTIONS.map((s) => <MenuItem key={s} value={s}>{s}</MenuItem>)}
      </TextField>
    </Stack>

    <TableContainer component={Paper}>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>Name</TableCell>
            <TableCell>Phone</TableCell>
            <TableCell>Source</TableCell>
            <TableCell>Status</TableCell>
            <TableCell>Provider Msg ID</TableCell>
            <TableCell>Attempts</TableCell>
            <TableCell>Error</TableCell>
            <TableCell>Sent</TableCell>
            <TableCell>Delivered</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {!loading && recipients.length === 0 && <TableRow><TableCell colSpan={9} align="center">No recipients found.</TableCell></TableRow>}
          {recipients.map((row) => (
            <TableRow key={row.id}>
              <TableCell>{row.recipientName || '—'}</TableCell>
              <TableCell>{row.phone}</TableCell>
              <TableCell>{(row.matchedEntities || []).map((e) => e.type).join(', ') || '—'}</TableCell>
              <TableCell><Chip size="small" label={row.status} color={STATUS_COLOR[row.status] || 'default'} /></TableCell>
              <TableCell>{row.providerMessageId || '—'}</TableCell>
              <TableCell>{row.attempts}</TableCell>
              <TableCell>{row.errorMessage || '—'}</TableCell>
              <TableCell>{formatDate(row.sentAt)}</TableCell>
              <TableCell>{formatDate(row.deliveredAt)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <TablePagination
        component="div" count={total} page={page} onPageChange={(e, p) => setPage(p)}
        rowsPerPage={pageSize} onRowsPerPageChange={(e) => { setPageSize(Number(e.target.value)); setPage(0); }}
        rowsPerPageOptions={[25, 50, 100]}
      />
    </TableContainer>
  </Box>;
}
