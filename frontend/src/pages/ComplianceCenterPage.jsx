import React, { useEffect, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import {
  Alert, Box, Button, Chip, Grid, LinearProgress, Paper, Stack, Table, TableBody, TableCell, TableContainer,
  TableHead, TableRow, TextField, Tooltip, Typography
} from '@mui/material';
import FactCheckIcon from '@mui/icons-material/FactCheck';
import { checkWhatsAppMessage, getWhatsAppComplianceStatus, getWhatsAppWindowStats } from '../services/whatsappTemplate.service';
import WhatsAppAccountSelect from '../components/WhatsAppAccountSelect';

// Separate, clearly-labeled stat tiles for one window block — never summed
// across the two window types (a contact can have both open at once, so
// "24H active + 72H active" is not a meaningful "unique customers" figure;
// see the dedicated uniqueActiveCustomers tile instead).
function WindowStatBlock({ title, subtitle, data, color }) {
  // A cumulative funnel, not five independent buckets: Attempted includes
  // every outbound message regardless of outcome; Sent/Delivered/Read each
  // include every later stage they imply (a read message was also sent and
  // delivered — it isn't double-counted away from "Sent" just because it
  // progressed). Failed is the one separate, terminal exception.
  const tiles = data ? [
    ['Active conversations', data.activeConversations, 'unique conversations'],
    ['Expired conversations', data.expiredConversations, 'unique conversations'],
    ['Messages attempted', data.messages?.attempted, 'individual messages — every status, including pending/failed'],
    ['Messages sent', data.messages?.sent, 'individual messages — includes delivered and read'],
    ['Messages delivered', data.messages?.delivered, 'individual messages — includes read'],
    ['Messages read', data.messages?.read, 'individual messages'],
    ['Messages failed', data.messages?.failed, 'individual messages — terminal, never also counted as sent']
  ] : [];
  return (
    <Paper elevation={0} sx={{ p: 2.5, border: '1px solid', borderColor: 'divider', height: '100%' }}>
      <Typography variant="h6" fontWeight={850}>{title}</Typography>
      <Typography color="text.secondary" sx={{ mb: 2 }}>{subtitle}</Typography>
      <Grid container spacing={1.5}>
        {tiles.map(([label, value, unit]) => (
          <Grid item xs={6} sm={4} key={label}>
            <Tooltip title={`Counted as: ${unit}`}>
              <Paper variant="outlined" sx={{ p: 1.5, borderColor: `${color}.light` }}>
                <Typography variant="h5" fontWeight={900} color={`${color}.dark`}>{value ?? 0}</Typography>
                <Typography variant="caption" color="text.secondary">{label}</Typography>
              </Paper>
            </Tooltip>
          </Grid>
        ))}
      </Grid>
    </Paper>
  );
}

function contactName(contact) {
  return [contact?.firstName, contact?.lastName].filter(Boolean).join(' ') || contact?.phone || '-';
}

function ComplianceCenterPage() {
  const [status, setStatus] = useState({ qualityRatings: [], logs: [], conversationWindowStatus: {} });
  const [contactId, setContactId] = useState('');
  const [checkResult, setCheckResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [whatsappAccountId, setWhatsappAccountId] = useState('');
  const [windowStats, setWindowStats] = useState(null);
  const [windowStatsLoading, setWindowStatsLoading] = useState(false);
  const [windowStatsError, setWindowStatsError] = useState('');

  const load = async () => {
    try {
      setLoading(true);
      const response = await getWhatsAppComplianceStatus();
      setStatus(response.data.data || {});
      setError('');
    } catch (err) {
      setError(err.response?.data?.message || 'Unable to load compliance status.');
    } finally {
      setLoading(false);
    }
  };

  const loadWindowStats = async (accountId) => {
    try {
      setWindowStatsLoading(true);
      const response = await getWhatsAppWindowStats(accountId || null);
      setWindowStats(response.data.data || null);
      setWindowStatsError('');
    } catch (err) {
      setWindowStatsError(err.response?.data?.message || 'Unable to load window statistics.');
    } finally {
      setWindowStatsLoading(false);
    }
  };

  useEffect(() => { load(); }, []);
  useEffect(() => { loadWindowStats(whatsappAccountId); }, [whatsappAccountId]);

  // Reuses the existing CRM-wide socket connection (CrmLayout's Outlet
  // context) rather than opening a second one. The server only ever adds
  // this socket to a given account's room after re-checking
  // whatsappAccountAccessService itself (see sockets/socket.js's
  // windows:join handler) — joining a specific account here never bypasses
  // that, and "All WhatsApp numbers" (empty accountId) simply skips the
  // join and relies on the initial/manual load instead of a live per-
  // account room, since there is no single room for an aggregate view.
  const { socket } = useOutletContext() || {};
  useEffect(() => {
    if (!socket || !whatsappAccountId) return undefined;
    socket.emit('windows:join', { whatsappAccountId });
    const onChanged = (payload) => {
      if (String(payload?.whatsappAccountId) === String(whatsappAccountId)) loadWindowStats(whatsappAccountId);
    };
    socket.on('whatsapp.windows.changed', onChanged);
    return () => socket.off('whatsapp.windows.changed', onChanged);
  }, [socket, whatsappAccountId]);

  const runCheck = async () => {
    try {
      const response = await checkWhatsAppMessage({ contactId });
      setCheckResult(response.data.data);
      setError('');
    } catch (err) {
      setError(err.response?.data?.message || 'Unable to check message compliance.');
    }
  };

  return (
    <Stack spacing={2.5}>
      {loading && <LinearProgress />}
      {error && <Alert severity="error" onClose={() => setError('')}>{error}</Alert>}

      <Paper elevation={0} sx={{ p: 2.5, border: '1px solid', borderColor: 'divider' }}>
        <Typography variant="h5" fontWeight={850}>Meta Compliance Center</Typography>
        <Typography color="text.secondary">Central WhatsApp window, template, quality, and compliance log monitoring.</Typography>
      </Paper>

      <Grid container spacing={2}>
        {[
          ['Approved Templates', status.approvedTemplates || 0],
          ['Pending Approval', status.pendingTemplates || 0],
          ['Rejected Templates', status.rejectedTemplates || 0],
          ['24 Hour Open Contacts', status.conversationWindowStatus?.openContacts || 0]
        ].map(([label, value]) => <Grid item xs={12} sm={6} md={3} key={label}><Paper elevation={0} sx={{ p: 2, border: '1px solid', borderColor: 'divider' }}><Typography variant="h5" fontWeight={900}>{value}</Typography><Typography color="text.secondary">{label}</Typography></Paper></Grid>)}
      </Grid>

      <Paper elevation={0} sx={{ p: 2.5, border: '1px solid', borderColor: 'divider' }}>
        <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" alignItems={{ sm: 'center' }} spacing={2} sx={{ mb: 2 }}>
          <Box>
            <Typography variant="h6" fontWeight={850}>WhatsApp Window Statistics</Typography>
            <Typography color="text.secondary">24-hour Customer Service Window and 72-hour Free Entry Point — tracked and counted separately.</Typography>
          </Box>
          <WhatsAppAccountSelect value={whatsappAccountId} onChange={setWhatsappAccountId} allowAll label="WhatsApp Number" sx={{ minWidth: 260 }} />
        </Stack>
        {windowStatsLoading && <LinearProgress sx={{ mb: 2 }} />}
        {windowStatsError && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setWindowStatsError('')}>{windowStatsError}</Alert>}
        {windowStats && <Stack spacing={2}>
          <Grid container spacing={2}>
            <Grid item xs={12} md={6}>
              <WindowStatBlock title="24H Customer Service Window" subtitle="Opens on any inbound customer message; resets on each new one." data={windowStats.serviceWindow24h} color="success" />
            </Grid>
            <Grid item xs={12} md={6}>
              <WindowStatBlock title="72H Free Entry Point Window" subtitle="Only when a verified ad/Page-CTA referral got a business reply within 24h." data={windowStats.freeEntryWindow72h} color="info" />
            </Grid>
          </Grid>
          <Paper variant="outlined" sx={{ p: 2 }}>
            <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" alignItems={{ sm: 'center' }} spacing={1}>
              <Box>
                <Typography fontWeight={850}>{windowStats.uniqueActiveCustomers ?? 0} unique customers with an active window</Typography>
                <Typography variant="caption" color="text.secondary">Deduplicated across both window types — a customer with both windows active is counted once here, never added twice.</Typography>
              </Box>
              <Stack direction="row" spacing={1}>
                <Chip size="small" label={`Confirmed free: ${windowStats.pricing?.confirmedFree ?? 0}`} color="success" variant="outlined" />
                <Chip size="small" label={`Confirmed billable: ${windowStats.pricing?.confirmedBillable ?? 0}`} color="warning" variant="outlined" />
                <Chip size="small" label={`Unknown: ${windowStats.pricing?.unknown ?? 0}`} variant="outlined" />
              </Stack>
            </Stack>
          </Paper>
        </Stack>}
      </Paper>

      <Grid container spacing={2}>
        <Grid item xs={12} md={5}>
          <Paper elevation={0} sx={{ p: 2.5, border: '1px solid', borderColor: 'divider', height: '100%' }}>
            <Typography variant="h6" fontWeight={850} sx={{ mb: 2 }}>Message Check</Typography>
            <Stack spacing={2}>
              <TextField label="Contact ID" value={contactId} onChange={(e) => setContactId(e.target.value)} fullWidth />
              <Button variant="contained" startIcon={<FactCheckIcon />} onClick={runCheck} disabled={!contactId}>Check Compliance</Button>
              {checkResult && <Alert severity={checkResult.canSend ? 'success' : 'warning'}>
                {checkResult.canSend ? 'Can send free-form message.' : 'Approved template required.'} {checkResult.reason}
              </Alert>}
            </Stack>
          </Paper>
        </Grid>
        <Grid item xs={12} md={7}>
          <Paper elevation={0} sx={{ p: 2.5, border: '1px solid', borderColor: 'divider', height: '100%' }}>
            <Typography variant="h6" fontWeight={850} sx={{ mb: 2 }}>Quality Rating Summary</Typography>
            <Stack spacing={1}>{(status.qualityRatings || []).map((item) => <Stack key={item.rating} direction="row" justifyContent="space-between"><Chip label={item.rating} size="small" /><Typography fontWeight={800}>{item.count}</Typography></Stack>)}{(!status.qualityRatings || status.qualityRatings.length === 0) && <Typography color="text.secondary">No quality ratings synced yet.</Typography>}</Stack>
          </Paper>
        </Grid>
      </Grid>

      <Paper elevation={0} sx={{ border: '1px solid', borderColor: 'divider', overflow: 'hidden' }}>
        <Box sx={{ p: 2 }}><Typography variant="h6" fontWeight={850}>Compliance Logs</Typography></Box>
        <TableContainer><Table><TableHead><TableRow>{['Date', 'Contact', 'Message Type', 'Window', 'Template', 'Allowed', 'Reason'].map((label) => <TableCell key={label}>{label}</TableCell>)}</TableRow></TableHead><TableBody>
          {(status.logs || []).map((row) => <TableRow key={row.id} hover><TableCell>{row.createdAt ? new Date(row.createdAt).toLocaleString() : '-'}</TableCell><TableCell>{contactName(row.contact)}</TableCell><TableCell>{row.messageType}</TableCell><TableCell><Chip size="small" label={row.windowStatus} /></TableCell><TableCell>{row.template?.name || row.templateId || '-'}</TableCell><TableCell><Chip size="small" label={row.allowed ? 'Allowed' : 'Blocked'} color={row.allowed ? 'success' : 'error'} /></TableCell><TableCell>{row.reason || '-'}</TableCell></TableRow>)}
          {(!status.logs || status.logs.length === 0) && <TableRow><TableCell colSpan={7}><Box sx={{ py: 5, textAlign: 'center' }}><Typography fontWeight={800}>No compliance logs yet</Typography><Typography color="text.secondary">Logs are created when automations validate messages.</Typography></Box></TableCell></TableRow>}
        </TableBody></Table></TableContainer>
      </Paper>
    </Stack>
  );
}

export default ComplianceCenterPage;
