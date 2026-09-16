import React, { useEffect, useState } from 'react';
import {
  Alert, Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle,
  IconButton, Paper, Stack, Switch, FormControlLabel, Table, TableBody, TableCell,
  TableContainer, TableHead, TableRow, TextField, Typography
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import PauseCircleOutlineIcon from '@mui/icons-material/PauseCircleOutline';
import {
  createFacebookPage, deactivateFacebookPage, getFacebookPages,
  subscribeFacebookPageWebhook, updateFacebookPage, verifyFacebookPage
} from '../services/facebookPage.service';

const emptyForm = { name: '', pageId: '', pageAccessToken: '', appId: '', sendEnabled: true };

export default function FacebookPagesPage() {
  const [pages, setPages] = useState([]);
  const [form, setForm] = useState(emptyForm);
  const [editing, setEditing] = useState(null);
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState(null);
  const [busy, setBusy] = useState(false);
  const [deactivating, setDeactivating] = useState(null);
  const [filter, setFilter] = useState('all');

  const load = () => getFacebookPages(true).then((response) => setPages(response.data.data || []));
  useEffect(() => { load().catch((error) => setMessage({ severity: 'error', text: error.response?.data?.message || 'Unable to load Facebook Pages.' })); }, []);

  const beginCreate = () => { setEditing(null); setForm(emptyForm); setOpen(true); };
  const beginEdit = (page) => { setEditing(page); setForm({ ...emptyForm, ...page, pageAccessToken: '' }); setOpen(true); };

  const save = async () => {
    try {
      setBusy(true);
      if (editing) await updateFacebookPage(editing.id, form);
      else await createFacebookPage(form);
      await load();
      setOpen(false);
      setMessage({ severity: 'success', text: editing ? 'Facebook Page updated.' : 'Facebook Page connected.' });
    } catch (error) {
      setMessage({ severity: 'error', text: error.response?.data?.message || error.message });
    } finally { setBusy(false); }
  };

  const action = async (task, success) => {
    try { setBusy(true); await task(); await load(); setMessage({ severity: 'success', text: success }); }
    catch (error) { setMessage({ severity: 'error', text: error.response?.data?.message || error.message }); }
    finally { setBusy(false); }
  };

  return (
    <Stack spacing={2.5}>
      {message && <Alert severity={message.severity} onClose={() => setMessage(null)}>{message.text}</Alert>}
      <Stack direction={{ xs: 'column', sm: 'row' }} alignItems={{ sm: 'center' }} spacing={2}>
        <Box flex={1}>
          <Typography variant="h4" fontWeight={900}>Facebook Pages</Typography>
          <Typography color="text.secondary">Connect Facebook Pages to receive Messenger messages and comments.</Typography>
        </Box>
        <Button variant="contained" startIcon={<AddIcon />} onClick={beginCreate}>Add Page</Button>
      </Stack>
      <Stack direction="row" spacing={1}>
        {['all', 'active', 'inactive'].map((value) => (
          <Button key={value} size="small" variant={filter === value ? 'contained' : 'outlined'} onClick={() => setFilter(value)}>{value[0].toUpperCase() + value.slice(1)}</Button>
        ))}
      </Stack>
      <TableContainer component={Paper} variant="outlined">
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>Page Name</TableCell><TableCell>Page ID</TableCell><TableCell>Status</TableCell>
              <TableCell>Webhook</TableCell><TableCell>Messenger</TableCell><TableCell>Comments</TableCell>
              <TableCell align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {pages.filter((page) => filter === 'all' || (filter === 'active') === page.active).map((page) => (
              <TableRow key={page.id}>
                <TableCell><Typography fontWeight={700}>{page.name}</Typography></TableCell>
                <TableCell>{page.pageId}</TableCell>
                <TableCell><Chip size="small" color={page.active ? 'success' : 'default'} label={page.active ? 'Active' : 'Inactive'} /></TableCell>
                <TableCell><Chip size="small" color={page.webhookSubscribed ? 'success' : 'warning'} label={page.webhookSubscribed ? 'Subscribed' : 'Not subscribed'} /></TableCell>
                <TableCell><Chip size="small" color={page.sendEnabled ? 'success' : 'default'} label={page.sendEnabled ? 'Enabled' : 'Disabled'} /></TableCell>
                <TableCell><Chip size="small" color="default" label="Manual reply" /></TableCell>
                <TableCell align="right">
                  {page.active && <Button size="small" disabled={busy} onClick={() => action(() => verifyFacebookPage(page.id), 'Facebook Page connection verified.')}>Verify</Button>}
                  {page.active && <Button size="small" disabled={busy} onClick={() => action(() => subscribeFacebookPageWebhook(page.id), 'Webhook subscription updated.')}>Subscribe Webhook</Button>}
                  <IconButton onClick={() => beginEdit(page)}><EditOutlinedIcon /></IconButton>
                  {page.active && <Button color="warning" size="small" startIcon={<PauseCircleOutlineIcon />} disabled={busy} onClick={() => setDeactivating(page)}>Deactivate</Button>}
                </TableCell>
              </TableRow>
            ))}
            {!pages.length && <TableRow><TableCell colSpan={7} align="center">No Facebook Pages connected.</TableCell></TableRow>}
          </TableBody>
        </Table>
      </TableContainer>
      <Dialog open={open} onClose={() => setOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>{editing ? 'Edit Facebook Page' : 'Add Facebook Page'}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <TextField label="Page name" required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
            <TextField label="Facebook Page ID" required value={form.pageId} onChange={(event) => setForm({ ...form, pageId: event.target.value })} />
            <TextField label={editing ? 'New page access token (leave blank to keep current)' : 'Page access token'} type="password" required={!editing} value={form.pageAccessToken} onChange={(event) => setForm({ ...form, pageAccessToken: event.target.value })} />
            <TextField label="App ID (optional)" value={form.appId || ''} onChange={(event) => setForm({ ...form, appId: event.target.value })} />
            <FormControlLabel control={<Switch checked={form.sendEnabled !== false} onChange={(event) => setForm({ ...form, sendEnabled: event.target.checked })} />} label="Allow sending Messenger replies from this Page" />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)}>Cancel</Button>
          <Button variant="contained" disabled={busy || !form.name || !form.pageId || (!editing && !form.pageAccessToken)} onClick={save}>Save</Button>
        </DialogActions>
      </Dialog>
      <Dialog open={Boolean(deactivating)} onClose={() => setDeactivating(null)} maxWidth="sm" fullWidth>
        <DialogTitle>Deactivate {deactivating?.name}?</DialogTitle>
        <DialogContent><Alert severity="warning">Messenger and comment replies will stop, but existing conversations, messages, and comments will remain.</Alert></DialogContent>
        <DialogActions>
          <Button onClick={() => setDeactivating(null)}>Cancel</Button>
          <Button color="warning" variant="contained" disabled={busy} onClick={() => action(() => deactivateFacebookPage(deactivating.id), `${deactivating.name} was deactivated.`).then(() => setDeactivating(null))}>Deactivate</Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}
