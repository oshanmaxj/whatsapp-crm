import React, { useEffect, useState } from 'react';
import {
  Alert, Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle,
  IconButton, Paper, Stack, Table, TableBody, TableCell, TableContainer, TableHead,
  TableRow, TextField, Typography
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import {
  createWhatsAppAccount, deactivateWhatsAppAccount, getWhatsAppAccounts,
  setDefaultWhatsAppAccount, testWhatsAppAccount, updateWhatsAppAccount,
  checkWhatsAppWebhook, subscribeWhatsAppWebhook, overrideWhatsAppWebhook
} from '../services/whatsappAccount.service';
import WhatsAppLeadRoutingPanel from '../components/WhatsAppLeadRoutingPanel';

const emptyForm = {
  name: '', phoneNumber: '', phoneNumberId: '', businessAccountId: '', accessToken: '',
  webhookVerifyToken: '', appId: '', appSecret: '', status: 'active'
};

export default function WhatsAppAccountsPage() {
  const [accounts, setAccounts] = useState([]);
  const [form, setForm] = useState(emptyForm);
  const [editing, setEditing] = useState(null);
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState(null);
  const [busy, setBusy] = useState(false);
  const [diagnostic, setDiagnostic] = useState(null);
  const [diagnosticAccountId, setDiagnosticAccountId] = useState(null);
  const [diagnosticOpen, setDiagnosticOpen] = useState(false);

  const load = () => getWhatsAppAccounts(true).then((response) => setAccounts(response.data.data || []));
  useEffect(() => { load().catch((error) => setMessage({ severity: 'error', text: error.response?.data?.message || 'Unable to load WhatsApp numbers.' })); }, []);
  const beginCreate = () => { setEditing(null); setForm(emptyForm); setOpen(true); };
  const beginEdit = (account) => {
    setEditing(account);
    setForm({ ...emptyForm, ...account, accessToken: '', appSecret: '' });
    setOpen(true);
  };
  const save = async () => {
    try {
      setBusy(true);
      if (editing) await updateWhatsAppAccount(editing.id, form);
      else await createWhatsAppAccount(form);
      await load();
      setOpen(false);
      setMessage({ severity: 'success', text: editing ? 'WhatsApp number updated.' : 'WhatsApp number connected.' });
    } catch (error) {
      setMessage({ severity: 'error', text: error.response?.data?.message || error.message });
    } finally { setBusy(false); }
  };
  const action = async (task, success) => {
    try { setBusy(true); await task(); await load(); setMessage({ severity: 'success', text: success }); }
    catch (error) { setMessage({ severity: 'error', text: error.response?.data?.message || error.message }); }
    finally { setBusy(false); }
  };
  const webhookAction = async (accountId, task, success) => {
    try {
      setBusy(true);
      const response = await task();
      setDiagnostic(response.data.data);
      setDiagnosticAccountId(accountId);
      setDiagnosticOpen(true);
      setMessage({ severity: 'success', text: success });
    } catch (error) {
      setMessage({ severity: 'error', text: error.response?.data?.message || error.message });
    } finally { setBusy(false); }
  };

  return (
    <Stack spacing={2.5}>
      {message && <Alert severity={message.severity} onClose={() => setMessage(null)}>{message.text}</Alert>}
      <Stack direction={{ xs: 'column', sm: 'row' }} alignItems={{ sm: 'center' }} spacing={2}>
        <Box flex={1}><Typography variant="h4" fontWeight={900}>WhatsApp Numbers</Typography><Typography color="text.secondary">Connect and manage the business numbers used across chats, broadcasts, templates, and flows.</Typography></Box>
        <Button variant="contained" startIcon={<AddIcon />} onClick={beginCreate}>Add number</Button>
      </Stack>
      <TableContainer component={Paper} variant="outlined">
        <Table>
          <TableHead><TableRow><TableCell>Name</TableCell><TableCell>Actual phone number</TableCell><TableCell>Phone number ID</TableCell><TableCell>Connection</TableCell><TableCell>Templates</TableCell><TableCell>Campaigns</TableCell><TableCell>Flows</TableCell><TableCell>Conversations</TableCell><TableCell align="right">Actions</TableCell></TableRow></TableHead>
          <TableBody>
            {accounts.map((account) => (
              <TableRow key={account.id}>
                <TableCell><Stack direction="row" spacing={1} alignItems="center"><Typography fontWeight={700}>{account.name}</Typography>{account.isDefault && <Chip size="small" color="success" label="Default" />}</Stack></TableCell>
                <TableCell>{account.phoneNumber || '—'}</TableCell><TableCell>{account.phoneNumberId}</TableCell>
                <TableCell><Chip size="small" color={(account.connectionStatus || account.status) === 'connected' || (account.connectionStatus || account.status) === 'active' ? 'success' : (account.connectionStatus || account.status) === 'disconnected' ? 'error' : 'default'} label={account.connectionStatus || account.status || 'connected'} /></TableCell>
                <TableCell>{account.statistics?.templates || 0}</TableCell>
                <TableCell>{account.statistics?.campaigns || 0}</TableCell>
                <TableCell>{account.statistics?.flows || 0}</TableCell>
                <TableCell>{account.statistics?.conversations || 0}</TableCell>
                <TableCell align="right">
                  <Button size="small" disabled={busy} onClick={() => action(() => testWhatsAppAccount(account.id), 'WhatsApp connection verified.')}>Verify WhatsApp Connection</Button>
                  <Button size="small" disabled={busy} onClick={() => webhookAction(account.id, () => checkWhatsAppWebhook(account.id), 'Webhook subscription checked.')}>Check Webhook Subscription</Button>
                  <Button size="small" disabled={busy} onClick={() => webhookAction(account.id, () => subscribeWhatsAppWebhook(account.id), 'CRM app webhook subscription confirmed.')}>Subscribe Webhook</Button>
                  {!account.isDefault && account.status === 'active' && <Button size="small" disabled={busy} startIcon={<CheckCircleOutlineIcon />} onClick={() => action(() => setDefaultWhatsAppAccount(account.id), 'Default WhatsApp number updated.')}>Set default</Button>}
                  <IconButton onClick={() => beginEdit(account)}><EditOutlinedIcon /></IconButton>
                  {account.status === 'active' && <IconButton color="error" disabled={busy || account.isDefault} onClick={() => action(() => deactivateWhatsAppAccount(account.id), 'WhatsApp number deactivated.')}><DeleteOutlineIcon /></IconButton>}
                </TableCell>
              </TableRow>
            ))}
            {!accounts.length && <TableRow><TableCell colSpan={9} align="center">No WhatsApp numbers configured.</TableCell></TableRow>}
          </TableBody>
        </Table>
      </TableContainer>
      <Dialog open={open} onClose={() => setOpen(false)} fullWidth maxWidth={editing ? 'md' : 'sm'}>
        <DialogTitle>{editing ? 'Edit WhatsApp number' : 'Add WhatsApp number'}</DialogTitle>
        <DialogContent><Stack spacing={2} sx={{ pt: 1 }}>
          <TextField label="Display name" required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
          <TextField label="Phone number" value={form.phoneNumber || ''} onChange={(event) => setForm({ ...form, phoneNumber: event.target.value })} />
          <TextField label="Phone number ID" required value={form.phoneNumberId} onChange={(event) => setForm({ ...form, phoneNumberId: event.target.value })} />
          <TextField label="Business account ID" value={form.businessAccountId || ''} onChange={(event) => setForm({ ...form, businessAccountId: event.target.value })} />
          <TextField label={editing ? 'New access token (leave blank to keep current)' : 'Access token'} type="password" required={!editing} value={form.accessToken} onChange={(event) => setForm({ ...form, accessToken: event.target.value })} />
          <TextField label="Webhook verify token" value={form.webhookVerifyToken || ''} onChange={(event) => setForm({ ...form, webhookVerifyToken: event.target.value })} />
          <TextField label="App ID (optional)" value={form.appId || ''} onChange={(event) => setForm({ ...form, appId: event.target.value })} />
          <TextField label="App secret (optional)" type="password" value={form.appSecret} onChange={(event) => setForm({ ...form, appSecret: event.target.value })} />
          {editing && <WhatsAppLeadRoutingPanel accountId={editing.id} />}
        </Stack></DialogContent>
        <DialogActions><Button onClick={() => setOpen(false)}>Cancel</Button><Button variant="contained" disabled={busy || !form.name || !form.phoneNumberId || (!editing && !form.accessToken)} onClick={save}>Save</Button></DialogActions>
      </Dialog>
      <Dialog open={diagnosticOpen} onClose={() => setDiagnosticOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>WhatsApp connection diagnostics</DialogTitle>
        <DialogContent>
          {diagnostic && <Stack spacing={1.5} sx={{ pt: 1 }}>
            {String(diagnostic.connectionVerificationResult || '').startsWith('warning:') && (
              <Alert severity="warning">{diagnostic.connectionVerificationResult.replace(/^warning:\s*/, '')}. An authorized administrator can replace it with the CRM callback.</Alert>
            )}
            <Typography>WABA ID last four digits: {diagnostic.wabaIdLastFour || 'not configured'}</Typography>
            <Typography>Phone Number ID last four digits: {diagnostic.phoneNumberIdLastFour || 'not configured'}</Typography>
            <Typography>CRM app ID: {diagnostic.crmAppId || 'not configured'}</Typography>
            <Typography>Subscription: {diagnostic.subscribed ? 'subscribed' : 'not subscribed'}</Typography>
            <Typography>Callback source: {diagnostic.callbackSource}</Typography>
            <Typography>Connection verification result: {diagnostic.connectionVerificationResult}</Typography>
          </Stack>}
        </DialogContent>
        <DialogActions>
          {diagnostic?.callbackSource === 'override' && String(diagnostic.connectionVerificationResult || '').startsWith('warning:') && (
            <Button color="warning" disabled={busy} onClick={() => webhookAction(diagnosticAccountId, () => overrideWhatsAppWebhook(diagnosticAccountId), 'CRM webhook callback override confirmed.')}>Use CRM callback</Button>
          )}
          <Button onClick={() => setDiagnosticOpen(false)}>Close</Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}
