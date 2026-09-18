import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import {
  Alert, Avatar, Box, Button, Chip, IconButton, List, ListItemButton, ListItemAvatar,
  ListItemText, MenuItem, Select, Stack, TextField, Typography
} from '@mui/material';
import FacebookIcon from '@mui/icons-material/Facebook';
import SendIcon from '@mui/icons-material/Send';
import AttachFileIcon from '@mui/icons-material/AttachFile';
import { ChatLayout } from '../components/chat';
import { getFacebookPages } from '../services/facebookPage.service';
import { getFacebookConversations, getFacebookConversationMessages, sendFacebookMessage } from '../services/facebookMessenger.service';
import { assignConversation } from '../services/chat.service';
import { getAccessPayload } from '../utils/access';

function contactName(conversation) {
  const contact = conversation?.contact;
  const name = [contact?.firstName, contact?.lastName].filter(Boolean).join(' ');
  return name || 'Facebook User';
}

function ConversationRow({ conversation, active, onClick }) {
  return (
    <ListItemButton selected={active} onClick={onClick} alignItems="flex-start" sx={{ borderBottom: '1px solid', borderColor: 'divider' }}>
      <ListItemAvatar><Avatar sx={{ bgcolor: '#1877F2' }}><FacebookIcon fontSize="small" /></Avatar></ListItemAvatar>
      <ListItemText
        primary={<Stack direction="row" justifyContent="space-between"><Typography fontWeight={700} noWrap>{contactName(conversation)}</Typography></Stack>}
        secondary={
          <Stack spacing={0.25}>
            <Typography variant="caption" color="text.secondary" noWrap>{conversation.facebookPage?.name || 'Facebook Page'}</Typography>
            <Typography variant="body2" color="text.secondary" noWrap>{conversation.lastMessage || 'No messages yet'}</Typography>
          </Stack>
        }
      />
    </ListItemButton>
  );
}

function MessageRow({ message }) {
  const outbound = message.direction === 'outbound';
  return (
    <Box sx={{ display: 'flex', justifyContent: outbound ? 'flex-end' : 'flex-start', mb: 1.5 }}>
      <Box sx={{
        maxWidth: '70%', px: 1.75, py: 1, borderRadius: 2,
        bgcolor: outbound ? 'primary.main' : 'background.default',
        color: outbound ? 'primary.contrastText' : 'text.primary',
        border: outbound ? 'none' : '1px solid', borderColor: 'divider'
      }}>
        {message.media?.url || message.mediaUrl ? (
          message.mediaType === 'image' || message.type === 'image'
            ? <Box component="img" src={message.media?.url || message.mediaUrl} alt="attachment" sx={{ maxWidth: '100%', borderRadius: 1, mb: message.text ? 1 : 0 }} />
            : <Button size="small" href={message.media?.url || message.mediaUrl} target="_blank" rel="noreferrer" startIcon={<AttachFileIcon />} sx={{ mb: message.text ? 1 : 0 }}>Attachment</Button>
        ) : null}
        {message.text && <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>{message.text}</Typography>}
        <Typography variant="caption" sx={{ opacity: 0.7, display: 'block', mt: 0.5 }}>
          {message.createdAt ? new Date(message.createdAt).toLocaleString() : ''}
        </Typography>
      </Box>
    </Box>
  );
}

export default function FacebookInboxPage() {
  const { socket } = useOutletContext() || {};
  const [pages, setPages] = useState([]);
  const [pageFilter, setPageFilter] = useState('');
  const [conversations, setConversations] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);
  const bottomRef = useRef(null);

  const selected = useMemo(() => conversations.find((item) => String(item.id) === String(selectedId)) || null, [conversations, selectedId]);

  const loadConversations = () => getFacebookPages().then((response) => setPages(response.data.data || []))
    .then(() => getFacebookConversations(pageFilter || null))
    .then((response) => setConversations(response.data.data || []))
    .catch((err) => setError(err.response?.data?.message || 'Unable to load Facebook conversations.'));

  useEffect(() => { loadConversations(); }, [pageFilter]);

  useEffect(() => {
    if (!selectedId) { setMessages([]); return; }
    getFacebookConversationMessages(selectedId).then((response) => setMessages(response.data.data?.items || [])).catch(() => setMessages([]));
  }, [selectedId]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  useEffect(() => {
    if (!socket || !selectedId) return undefined;
    socket.emit('facebook:join', { conversationId: selectedId });
    const handleMessage = (payload) => {
      if (String(payload.conversationId || payload.conversation_id) !== String(selectedId)) return;
      setMessages((current) => (current.some((item) => item.id === payload.id) ? current : [...current, payload]));
    };
    socket.on('facebook.message.received', handleMessage);
    return () => socket.off('facebook.message.received', handleMessage);
  }, [socket, selectedId]);

  useEffect(() => {
    if (!socket) return undefined;
    const handleUpdate = () => loadConversations();
    socket.on('facebook.conversation.updated', handleUpdate);
    return () => socket.off('facebook.conversation.updated', handleUpdate);
  }, [socket]);

  const send = async () => {
    if (!draft.trim() || !selectedId) return;
    const text = draft.trim();
    setDraft('');
    setSending(true);
    try {
      const response = await sendFacebookMessage(selectedId, text, `${selectedId}-${Date.now()}`);
      setMessages((current) => [...current, response.data.data]);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to send message.');
    } finally { setSending(false); }
  };

  const assignToMe = async () => {
    if (!selected) return;
    try {
      const currentUserId = getAccessPayload().id;
      await assignConversation(selected.id, { assigned_user_id: currentUserId });
      await loadConversations();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to assign conversation.');
    }
  };

  return (
    <Stack spacing={2} sx={{ height: '100%' }}>
      {error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}
      <Stack direction="row" alignItems="center" justifyContent="space-between">
        <Box>
          <Typography variant="h4" fontWeight={900}>Messenger</Typography>
          <Typography color="text.secondary">Facebook Messenger conversations across connected Pages.</Typography>
        </Box>
        <Select size="small" displayEmpty value={pageFilter} onChange={(event) => setPageFilter(event.target.value)} sx={{ minWidth: 220 }}>
          <MenuItem value="">All Pages</MenuItem>
          {pages.map((page) => <MenuItem key={page.id} value={page.id}>{page.name}</MenuItem>)}
        </Select>
      </Stack>
      <ChatLayout
        conversationList={
          <List disablePadding sx={{ width: '100%', overflowY: 'auto' }}>
            {conversations.map((conversation) => (
              <ConversationRow key={conversation.id} conversation={conversation} active={String(conversation.id) === String(selectedId)} onClick={() => setSelectedId(conversation.id)} />
            ))}
            {!conversations.length && <Typography color="text.secondary" sx={{ p: 2 }}>No Facebook Messenger conversations yet.</Typography>}
          </List>
        }
        chat={
          selected ? (
            <Stack sx={{ width: '100%', height: '100%' }}>
              <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ p: 1.5, borderBottom: '1px solid', borderColor: 'divider' }}>
                <Stack>
                  <Typography fontWeight={700}>{contactName(selected)}</Typography>
                  <Stack direction="row" spacing={1} alignItems="center">
                    <Chip size="small" icon={<FacebookIcon />} label="Facebook" sx={{ bgcolor: '#1877F2', color: '#fff' }} />
                    <Typography variant="caption" color="text.secondary">{selected.facebookPage?.name}</Typography>
                  </Stack>
                </Stack>
                <Stack alignItems="flex-end">
                  <Typography variant="caption" color="text.secondary">Assigned: {selected.assignedUser ? `${selected.assignedUser.firstName || ''} ${selected.assignedUser.lastName || ''}`.trim() : 'Unassigned'}</Typography>
                  <Button size="small" onClick={assignToMe}>Assign to me</Button>
                </Stack>
              </Stack>
              <Box sx={{ flex: 1, overflowY: 'auto', p: 2 }}>
                {messages.map((message) => <MessageRow key={message.id} message={message} />)}
                <div ref={bottomRef} />
              </Box>
              <Stack direction="row" spacing={1} sx={{ p: 1.5, borderTop: '1px solid', borderColor: 'divider' }}>
                <TextField
                  fullWidth size="small" placeholder="Type a message…" value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); send(); } }}
                />
                <IconButton color="primary" disabled={sending || !draft.trim()} onClick={send}><SendIcon /></IconButton>
              </Stack>
            </Stack>
          ) : (
            <Box sx={{ display: 'grid', placeItems: 'center', width: '100%', height: '100%' }}>
              <Typography color="text.secondary">Select a conversation to view the Messenger thread.</Typography>
            </Box>
          )
        }
        showWorkspace={false}
      />
    </Stack>
  );
}
