import React, { useEffect, useState } from 'react';
import {
  Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle,
  List, ListItemButton, ListItemText, Stack, TextField, Typography
} from '@mui/material';
import { getInboxFlows, startInboxFlow } from '../../services/flowBuilder.service';

export default function InboxFlowDialog({ open, onClose, conversation, onStarted }) {
  const [search, setSearch] = useState('');
  const [flows, setFlows] = useState([]);
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open || !conversation?.id) return undefined;
    let active = true;
    const timer = window.setTimeout(async () => {
      setLoading(true); setError('');
      try {
        const response = await getInboxFlows(conversation.id, search);
        if (active) setFlows(response.data?.data || []);
      } catch (requestError) {
        if (active) setError(requestError.response?.data?.message || 'Unable to load flows.');
      } finally { if (active) setLoading(false); }
    }, search ? 250 : 0);
    return () => { active = false; window.clearTimeout(timer); };
  }, [open, conversation?.id, search]);

  const send = async () => {
    if (!selected || sending) return;
    setSending(true); setError('');
    try {
      const response = await startInboxFlow(selected.id, conversation.id, {});
      onStarted?.(response.data?.data);
      onClose();
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Unable to start this flow.');
    } finally { setSending(false); }
  };

  return (
    <Dialog open={open} onClose={sending ? undefined : onClose} fullWidth maxWidth="sm">
      <DialogTitle>Start a WhatsApp flow</DialogTitle>
      <DialogContent>
        <Stack spacing={1.5} sx={{ pt: 0.5 }}>
          <TextField size="small" label="Search by flow name" value={search} onChange={(event) => setSearch(event.target.value)} autoFocus />
          {error && <Alert severity="error">{error}</Alert>}
          {!loading && flows.length === 0 && <Typography color="text.secondary">No published flows are available for this WhatsApp account.</Typography>}
          <List dense sx={{ maxHeight: 360, overflowY: 'auto' }}>
            {flows.map((flow) => (
              <ListItemButton key={flow.id} selected={selected?.id === flow.id} onClick={() => setSelected(flow)}>
                <ListItemText
                  primary={flow.name}
                  secondary={`${flow.status} · Account ${flow.whatsappAccountId} · Updated ${new Date(flow.updatedAt || flow.updated_at).toLocaleString()}`}
                />
              </ListItemButton>
            ))}
          </List>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={sending}>Cancel</Button>
        <Button variant="contained" onClick={send} disabled={!selected || sending || !conversation?.contact?.id || !conversation?.whatsappAccountId}>
          {sending ? 'Starting…' : 'Start flow'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
