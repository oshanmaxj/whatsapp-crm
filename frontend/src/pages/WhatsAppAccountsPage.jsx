import React, { useEffect, useState } from 'react';
import {
  Alert, Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle,
  IconButton, Paper, Stack, Table, TableBody, TableCell, TableContainer, TableHead,
  TableRow, TextField, Typography
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import PauseCircleOutlineIcon from '@mui/icons-material/PauseCircleOutline';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import {
  createWhatsAppAccount, deactivateWhatsAppAccount, getWhatsAppAccounts,
  reactivateWhatsAppAccount,
  setDefaultWhatsAppAccount, testWhatsAppAccount, updateWhatsAppAccount,
  checkWhatsAppWebhook, subscribeWhatsAppWebhook, overrideWhatsAppWebhook
} from '../services/whatsappAccount.service';
import WhatsAppLeadRoutingPanel from '../components/WhatsAppLeadRoutingPanel';

const emptyForm = {
  name: '', phoneNumber: '', phoneNumberId: '', businessAccountId: '', accessToken: '',
  webhookVerifyToken: '', appId: '', appSecret: '', status: 'active'
};

const statusInfo = {
  active: { color: 'success', action: 'Account is ready.' },
  connected: { color: 'success', action: 'Connection verified.' },
  disconnected: { color: 'error', action: 'Verify the connection or provide a new access token.' },
  inactive: { color: 'default', action: 'Reactivate this account to resume messages.' },
  token_expired: { color: 'error', action: 'Reactivate or edit the account with a new access token.' },
  webhook_not_subscribed: { color: 'warning', action: 'Subscribe the webhook after verifying the connection.' },
  verification_failed: { color: 'error', action: 'Check the Phone Number ID and credentials, then verify again.' }
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
  const [filter, setFilter] = useState('all');
  const [deactivating, setDeactivating] = useState(null);
  const [reactivating, setReactivating] = useState(null);
  const [reactivationForm, setReactivationForm] = useState({ accessToken: '', verifyToken: '', appId: '', appSecret: '' });

  const load = () => getWhatsAppAccounts(true).then((response) => setAccounts(response.data.data || []));
  useEffect(() => { load().catch((error) => setMessage({ severity: 'error', text: error.response?.data?.message || 'Unable to load WhatsApp numbers.' })); }, []);
  const beginCreate = () => { setEditing(null); setForm(emptyForm); setOpen(true); };
  const beginEdit = (account) => {
    setEditing(account);
    setForm({ ...emptyForm, ...account, accessToken: '', appSecret: '' });
    setOpen(true);
  };
  const beginReactivate = (account) => {
    setReactivating(account);
    setReactivationForm({ accessToken: '', verifyToken: '', appId: '', appSecret: '' });
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
      const data = error.response?.data;
      if (!editing && data?.code === 'WHATSAPP_ACCOUNT_INACTIVE' && data.canReactivate) {
        setOpen(false);
        beginReactivate({
          id: data.accountId,
          name: data.displayName,
          phoneNumber: data.phoneNumber,
          accessTokenConfigured: true
        });
        setMessage({ severity: 'warning', text: 'This WhatsApp number already exists as an inactive account. Reactivate it instead?' });
      } else {
        setMessage({ severity: 'error', text: data?.message || error.message });
      }
    } finally { setBusy(false); }
  };
  const reactivate = async () => {
    const payload = Object.fromEntries(Object.entries(reactivationForm).filter(([, value]) => value));
    try {
      setBusy(true);
      await reactivateWhatsAppAccount(reactivating.id, payload);
      await load();
      setReactivating(null);
      setMessage({ severity: 'success', text: `${reactivating.name} was reactivated. Verify its connection before subscribing the webhook.` });
    } catch (error) {
      await load().catch(() => null);
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
      <Stack direction="row" spacing={1}>
        {['all', 'active', 'inactive'].map((value) => <Button key={value} size="small" variant={filter === value ? 'contained' : 'outlined'} onClick={() => setFilter(value)}>{value[0].toUpperCase() + value.slice(1)}</Button>)}
      </Stack>
      <TableContainer component={Paper} variant="outlined">
        <Table>
          <TableHead><TableRow><TableCell>Name</TableCell><TableCell>Actual phone number</TableCell><TableCell>Phone number ID</TableCell><TableCell>Connection</TableCell><TableCell>Templates</TableCell><TableCell>Campaigns</TableCell><TableCell>Flows</TableCell><TableCell>Conversations</TableCell><TableCell align="right">Actions</TableCell></TableRow></TableHead>
          <TableBody>
            {accounts.filter((account) => filter === 'all' || account.status === filter).map((account) => {
              const effectiveStatus = account.status === 'inactive' ? 'inactive' : (account.connectionStatus || 'disconnected');
              const info = statusInfo[effectiveStatus] || statusInfo.disconnected;
              return (
              <TableRow key={account.id}>
                <TableCell><Stack direction="row" spacing={1} alignItems="center"><Typography fontWeight={700}>{account.name}</Typography>{account.isDefault && <Chip size="small" color="success" label="Default" />}</Stack></TableCell>
                <TableCell>{account.phoneNumber || '—'}</TableCell><TableCell>{account.phoneNumberId}</TableCell>
                <TableCell><Stack spacing={0.5}><Chip size="small" color={info.color} label={effectiveStatus.replaceAll('_', ' ')} /><Typography variant="caption" color="text.secondary">{account.name}: {info.action}</Typography></Stack></TableCell>
                <TableCell>{account.statistics?.templates || 0}</TableCell>
                <TableCell>{account.statistics?.campaigns || 0}</TableCell>
                <TableCell>{account.statistics?.flows || 0}</TableCell>
                <TableCell>{account.statistics?.conversations || 0}</TableCell>
                <TableCell align="right">
                  {account.status === 'active' && <Button size="small" disabled={busy} onClick={() => action(() => testWhatsAppAccount(account.id), 'WhatsApp connection verified.')}>Verify WhatsApp Connection</Button>}
                  {account.status === 'active' && <Button size="small" disabled={busy} onClick={() => webhookAction(account.id, () => checkWhatsAppWebhook(account.id), 'Webhook subscription checked.')}>Check Webhook Subscription</Button>}
                  {account.status === 'active' && effectiveStatus === 'connected' && <Button size="small" disabled={busy} onClick={() => webhookAction(account.id, () => subscribeWhatsAppWebhook(account.id), 'CRM app webhook subscription confirmed.')}>Subscribe Webhook</Button>}
                  {!account.isDefault && account.status === 'active' && <Button size="small" disabled={busy} startIcon={<CheckCircleOutlineIcon />} onClick={() => action(() => setDefaultWhatsAppAccount(account.id), 'Default WhatsApp number updated.')}>Set default</Button>}
                  <IconButton onClick={() => beginEdit(account)}><EditOutlinedIcon /></IconButton>
                  {account.status === 'inactive' && <Button size="small" color="success" disabled={busy} onClick={() => beginReactivate(account)}>Reactivate</Button>}
                  {account.status === 'active' && <Button color="warning" size="small" startIcon={<PauseCircleOutlineIcon />} disabled={busy || account.isDefault} onClick={() => setDeactivating(account)}>Deactivate</Button>}
                </TableCell>
              </TableRow>
            );})}
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
      <Dialog open={Boolean(deactivating)} onClose={() => setDeactivating(null)} maxWidth="sm" fullWidth>
        <DialogTitle>Deactivate {deactivating?.name}?</DialogTitle>
        <DialogContent><Alert severity="warning">Messages will stop, but credentials, conversations, messages, templates, flows, campaigns, routing rules, and audit history will remain.</Alert></DialogContent>
        <DialogActions><Button onClick={() => setDeactivating(null)}>Cancel</Button><Button color="warning" variant="contained" disabled={busy} onClick={() => action(() => deactivateWhatsAppAccount(deactivating.id), `${deactivating.name} was deactivated.`).then(() => setDeactivating(null))}>Deactivate</Button></DialogActions>
      </Dialog>
      <Dialog open={Boolean(reactivating)} onClose={() => setReactivating(null)} maxWidth="sm" fullWidth>
        <DialogTitle>Reactivate {reactivating?.name}</DialogTitle>
        <DialogContent><Stack spacing={2} sx={{ pt: 1 }}>
          <Alert severity="info">This restores the existing account and keeps all linked history. Provide a new access token if the saved token is unavailable or invalid.</Alert>
          <TextField label="New access token (optional when saved)" type="password" required={!reactivating?.accessTokenConfigured} value={reactivationForm.accessToken} onChange={(event) => setReactivationForm({ ...reactivationForm, accessToken: event.target.value })} />
          <TextField label="New webhook verify token (optional)" type="password" value={reactivationForm.verifyToken} onChange={(event) => setReactivationForm({ ...reactivationForm, verifyToken: event.target.value })} />
          <TextField label="App ID (optional)" value={reactivationForm.appId} onChange={(event) => setReactivationForm({ ...reactivationForm, appId: event.target.value })} />
          <TextField label="App secret (optional)" type="password" value={reactivationForm.appSecret} onChange={(event) => setReactivationForm({ ...reactivationForm, appSecret: event.target.value })} />
        </Stack></DialogContent>
        <DialogActions><Button onClick={() => setReactivating(null)}>Cancel</Button><Button color="success" variant="contained" disabled={busy || (!reactivating?.accessTokenConfigured && !reactivationForm.accessToken)} onClick={reactivate}>Reactivate Account</Button></DialogActions>
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
