import React, { useEffect, useState } from 'react';
import {
  Alert, Box, Button, Chip, Grid, LinearProgress, Paper, Stack, Table, TableBody, TableCell, TableContainer,
  TableHead, TableRow, TextField, Typography
} from '@mui/material';
import FactCheckIcon from '@mui/icons-material/FactCheck';
import { checkWhatsAppMessage, getWhatsAppComplianceStatus } from '../services/whatsappTemplate.service';

function contactName(contact) {
  return [contact?.firstName, contact?.lastName].filter(Boolean).join(' ') || contact?.phone || '-';
}

function ComplianceCenterPage() {
  const [status, setStatus] = useState({ qualityRatings: [], logs: [], conversationWindowStatus: {} });
  const [contactId, setContactId] = useState('');
  const [checkResult, setCheckResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

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

  useEffect(() => { load(); }, []);

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
