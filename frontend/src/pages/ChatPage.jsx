import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert, Avatar, Badge, Box, Button, Chip, Divider, Drawer, FormControl, Grid, IconButton,
  InputLabel, LinearProgress, List, ListItemButton, ListItemText, MenuItem, Paper, Select,
  Stack, Tab, Tabs, TextField, Tooltip, Typography
} from '@mui/material';
import AttachFileIcon from '@mui/icons-material/AttachFile';
import CloseIcon from '@mui/icons-material/Close';
import DownloadIcon from '@mui/icons-material/Download';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import LocalOfferIcon from '@mui/icons-material/LocalOffer';
import NotesIcon from '@mui/icons-material/Notes';
import SendIcon from '@mui/icons-material/Send';
import {
  assignConversation,
  createNote,
  createTemplate,
  getConversation,
  getConversationMessages,
  getConversations,
  downloadMedia,
  getMedia,
  getNotes,
  getTemplates,
  getUnreadCount,
  setConversationLabels,
  updateConversation,
  uploadMedia
} from '../services/chat.service';
import { getAgents } from '../services/agent.service';
import { useSocket } from '../hooks/useSocket';

const API_ORIGIN = (process.env.REACT_APP_API_URL || 'http://localhost:4000/api').replace('/api', '');

function contactName(contact) {
  if (!contact) return 'Unknown contact';
  return [contact.firstName, contact.lastName].filter(Boolean).join(' ') || contact.phone || 'Unnamed contact';
}

function agentName(agent) {
  if (!agent) return 'Unassigned';
  return agent.name || [agent.firstName, agent.lastName].filter(Boolean).join(' ') || agent.email;
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function inferMediaType(file) {
  if (file.type.startsWith('image/')) return 'image';
  if (file.type.startsWith('video/')) return 'video';
  if (file.type.startsWith('audio/')) return 'audio';
  if (file.type === 'application/pdf') return 'pdf';
  return 'document';
}

function ChatPage() {
  const token = localStorage.getItem('accessToken');
  const { socket, connected } = useSocket(token);
  const fileInputRef = useRef(null);
  const [conversations, setConversations] = useState([]);
  const [agents, setAgents] = useState([]);
  const [selected, setSelected] = useState(null);
  const [conversation, setConversation] = useState(null);
  const [messages, setMessages] = useState([]);
  const [media, setMedia] = useState([]);
  const [notes, setNotes] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [newMessage, setNewMessage] = useState('');
  const [noteText, setNoteText] = useState('');
  const [labelText, setLabelText] = useState('');
  const [filters, setFilters] = useState({ search: '', assignedTo: '', status: '', unread: '' });
  const [sideOpen, setSideOpen] = useState(true);
  const [tab, setTab] = useState('profile');
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const selectedConversation = useMemo(
    () => conversations.find((item) => item.id === selected) || conversation,
    [conversations, selected, conversation]
  );

  const loadConversations = async () => {
    setLoading(true);
    try {
      const response = await getConversations({
        search: filters.search || undefined,
        assignedTo: filters.assignedTo || undefined,
        status: filters.status || undefined,
        unread: filters.unread || undefined
      });
      setConversations(response.data.data || []);
    } catch (err) {
      setError(err.response?.data?.message || 'Unable to load conversations.');
    } finally {
      setLoading(false);
    }
  };

  const loadDetails = async (conversationId) => {
    if (!conversationId) return;
    const [conversationResponse, messageResponse, mediaResponse, noteResponse] = await Promise.all([
      getConversation(conversationId),
      getConversationMessages(conversationId),
      getMedia(conversationId),
      getNotes(conversationId)
    ]);
    setConversation(conversationResponse.data.data);
    setMessages(messageResponse.data.data || []);
    setMedia(mediaResponse.data.data || []);
    setNotes(noteResponse.data.data || []);
    socket?.emit('chat:join', { conversationId });
    socket?.emit('chat:markRead', { conversationId });
  };

  useEffect(() => {
    loadConversations();
  }, [filters]);

  useEffect(() => {
    getAgents().then((response) => setAgents(response.data.data || [])).catch(() => {});
    getTemplates().then((response) => setTemplates(response.data.data || [])).catch(() => {});
    getUnreadCount().then((response) => setUnread(response.data.data.unread || 0)).catch(() => {});
  }, []);

  useEffect(() => {
    if (!selected) return;
    loadDetails(selected);
  }, [selected]);

  useEffect(() => {
    if (!socket) return;

    const handleNewMessage = (message) => {
      if (message.conversationId === selected) {
        setMessages((current) => [...current, message]);
      }
      loadConversations();
      getUnreadCount().then((response) => setUnread(response.data.data.unread || 0)).catch(() => {});
    };

    socket.on('chat:message', handleNewMessage);
    return () => socket.off('chat:message', handleNewMessage);
  }, [socket, selected]);

  const handleSendMessage = () => {
    if (!newMessage.trim() || !selected) return;
    socket?.emit('chat:message', { conversationId: selected, text: newMessage });
    setMessages((current) => [
      ...current,
      { id: Date.now(), conversationId: selected, direction: 'outbound', text: newMessage, type: 'text', createdAt: new Date().toISOString() }
    ]);
    setNewMessage('');
  };

  const handleAssign = async (assignedTo) => {
    if (!selected) return;
    await assignConversation(selected, assignedTo || null);
    await loadDetails(selected);
    await loadConversations();
  };

  const handleStatus = async (status) => {
    if (!selected) return;
    await updateConversation(selected, { status });
    await loadDetails(selected);
    await loadConversations();
  };

  const addNote = async (type = 'private') => {
    if (!selected || !noteText.trim()) return;
    await createNote({ conversationId: selected, type, note: noteText });
    setNoteText('');
    const response = await getNotes(selected);
    setNotes(response.data.data || []);
  };

  const addLabel = async () => {
    if (!selected || !labelText.trim()) return;
    const current = (conversation?.labels || []).map((label) => ({ name: label.name, color: label.color }));
    await setConversationLabels(selected, [...current, { name: labelText, color: '#25d366' }]);
    setLabelText('');
    await loadDetails(selected);
    await loadConversations();
  };

  const handleFileUpload = async (event) => {
    const file = event.target.files?.[0];
    if (!file || !selected) return;
    try {
      const dataBase64 = await fileToBase64(file);
      await uploadMedia({
        conversationId: selected,
        fileName: file.name,
        mimeType: file.type || 'application/octet-stream',
        mediaType: inferMediaType(file),
        dataBase64,
        caption: newMessage || file.name
      });
      setNewMessage('');
      await loadDetails(selected);
      await loadConversations();
    } catch (err) {
      setError(err.response?.data?.message || 'Unable to upload media.');
    } finally {
      event.target.value = '';
    }
  };

  const handleDownload = async (item) => {
    const response = await downloadMedia(item.id);
    const blobUrl = window.URL.createObjectURL(response.data);
    const link = document.createElement('a');
    link.href = blobUrl;
    link.download = item.originalName || item.fileName || 'media';
    link.click();
    window.URL.revokeObjectURL(blobUrl);
  };

  const saveTemplate = async () => {
    if (!newMessage.trim()) return;
    await createTemplate({ name: newMessage.slice(0, 40), category: 'saved_reply', body: newMessage });
    const response = await getTemplates();
    setTemplates(response.data.data || []);
  };

  return (
    <Box sx={{ height: 'calc(100vh - 120px)', display: 'grid', gridTemplateColumns: { xs: '1fr', lg: sideOpen ? '340px 1fr 360px' : '340px 1fr' }, gap: 2 }}>
      {error && <Alert severity="error" onClose={() => setError('')} sx={{ position: 'fixed', right: 24, bottom: 24, zIndex: 20 }}>{error}</Alert>}

      <Paper elevation={0} sx={{ border: '1px solid #e8edf2', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <Box sx={{ p: 2 }}>
          <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1.5 }}>
            <Box>
              <Typography variant="h6" fontWeight={850}>Inbox</Typography>
              <Typography variant="caption" color="text.secondary">{connected ? 'Socket connected' : 'Socket offline'} • unread {unread}</Typography>
            </Box>
            <Badge badgeContent={unread} color="success" />
          </Stack>
          <Stack spacing={1}>
            <TextField size="small" label="Search conversations" value={filters.search} onChange={(e) => setFilters({ ...filters, search: e.target.value })} />
            <Stack direction="row" spacing={1}>
              <FormControl size="small" fullWidth><InputLabel>Agent</InputLabel><Select label="Agent" value={filters.assignedTo} onChange={(e) => setFilters({ ...filters, assignedTo: e.target.value })}><MenuItem value="">All</MenuItem>{agents.map((agent) => <MenuItem key={agent.id} value={agent.id}>{agentName(agent)}</MenuItem>)}</Select></FormControl>
              <FormControl size="small" fullWidth><InputLabel>Status</InputLabel><Select label="Status" value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })}><MenuItem value="">All</MenuItem><MenuItem value="open">Open</MenuItem><MenuItem value="pending">Pending</MenuItem><MenuItem value="closed">Closed</MenuItem><MenuItem value="archived">Archived</MenuItem></Select></FormControl>
            </Stack>
            <FormControl size="small"><InputLabel>Unread</InputLabel><Select label="Unread" value={filters.unread} onChange={(e) => setFilters({ ...filters, unread: e.target.value })}><MenuItem value="">All</MenuItem><MenuItem value="true">Unread only</MenuItem></Select></FormControl>
          </Stack>
        </Box>
        {loading && <LinearProgress />}
        <Divider />
        <List sx={{ overflowY: 'auto', flex: 1 }}>
          {conversations.map((item) => (
            <ListItemButton key={item.id} selected={selected === item.id} onClick={() => setSelected(item.id)}>
              <Avatar sx={{ mr: 1.5, bgcolor: '#e7f7ee', color: '#128c7e' }}>{contactName(item.contact).slice(0, 1)}</Avatar>
              <ListItemText
                primary={<Stack direction="row" justifyContent="space-between"><Typography fontWeight={800}>{contactName(item.contact)}</Typography><Chip size="small" label={item.status} /></Stack>}
                secondary={<>{item.contact?.phone || item.whatsappThreadId || `Conversation ${item.id}`} {item.unreadCount > 0 ? `• ${item.unreadCount} unread` : ''}</>}
              />
            </ListItemButton>
          ))}
          {!loading && conversations.length === 0 && <Box sx={{ p: 3, textAlign: 'center' }}><Typography color="text.secondary">No conversations found.</Typography></Box>}
        </List>
      </Paper>

      <Paper elevation={0} sx={{ border: '1px solid #e8edf2', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <Box sx={{ p: 2, borderBottom: '1px solid #e8edf2' }}>
          <Stack direction="row" alignItems="center" justifyContent="space-between">
            <Box>
              <Typography variant="h6" fontWeight={850}>{contactName(selectedConversation?.contact)}</Typography>
              <Typography variant="body2" color="text.secondary">Assigned to {agentName(selectedConversation?.assignee)}</Typography>
            </Box>
            <Stack direction="row" spacing={1}>
              <Button size="small" variant={selectedConversation?.status === 'open' ? 'contained' : 'outlined'} onClick={() => handleStatus('open')}>Open</Button>
              <Button size="small" variant={selectedConversation?.status === 'closed' ? 'contained' : 'outlined'} onClick={() => handleStatus('closed')}>Closed</Button>
              <Tooltip title="Details"><IconButton onClick={() => setSideOpen((value) => !value)}><InfoOutlinedIcon /></IconButton></Tooltip>
            </Stack>
          </Stack>
        </Box>
        <Box sx={{ flex: 1, overflowY: 'auto', p: 2, bgcolor: '#eef7f2' }}>
          {messages.map((message) => (
            <Box key={message.id} sx={{ display: 'flex', justifyContent: message.direction === 'outbound' ? 'flex-end' : 'flex-start', mb: 1 }}>
              <Paper elevation={0} sx={{ p: 1.5, maxWidth: '75%', borderRadius: 2, bgcolor: message.direction === 'outbound' ? '#dcf8c6' : '#fff' }}>
                <Typography variant="body2">{message.text || message.templateName || message.type}</Typography>
                {message.mediaUrl && <Button size="small" href={`${API_ORIGIN}${message.mediaUrl}`} target="_blank">Open attachment</Button>}
                <Typography display="block" variant="caption" color="text.secondary">{message.createdAt ? new Date(message.createdAt).toLocaleString() : ''}</Typography>
              </Paper>
            </Box>
          ))}
          {!selected && <Box sx={{ textAlign: 'center', mt: 10 }}><Typography color="text.secondary">Select a conversation to start.</Typography></Box>}
        </Box>
        <Box sx={{ p: 2, borderTop: '1px solid #e8edf2' }}>
          <Stack direction="row" spacing={1} sx={{ mb: 1, overflowX: 'auto' }}>
            {templates.slice(0, 8).map((template) => <Chip key={template.id} label={template.name} onClick={() => setNewMessage(template.body)} />)}
          </Stack>
          <Stack direction="row" spacing={1} alignItems="flex-end">
            <input ref={fileInputRef} type="file" hidden onChange={handleFileUpload} />
            <IconButton disabled={!selected} onClick={() => fileInputRef.current?.click()}><AttachFileIcon /></IconButton>
            <TextField value={newMessage} onChange={(e) => setNewMessage(e.target.value)} placeholder="Type a message, quick reply, or caption..." fullWidth multiline minRows={2} />
            <Button disabled={!newMessage.trim()} onClick={saveTemplate}>Save Reply</Button>
            <IconButton color="primary" disabled={!selected || !newMessage.trim()} onClick={handleSendMessage}><SendIcon /></IconButton>
          </Stack>
        </Box>
      </Paper>

      {sideOpen && (
        <Paper elevation={0} sx={{ border: '1px solid #e8edf2', overflow: 'hidden', display: { xs: 'none', lg: 'flex' }, flexDirection: 'column' }}>
          <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ p: 2 }}>
            <Typography variant="h6" fontWeight={850}>Workspace</Typography>
            <IconButton onClick={() => setSideOpen(false)}><CloseIcon /></IconButton>
          </Stack>
          <Tabs value={tab} onChange={(e, value) => setTab(value)} variant="fullWidth">
            <Tab value="profile" label="Profile" />
            <Tab value="notes" label="Notes" />
            <Tab value="media" label="Media" />
          </Tabs>
          <Divider />
          <Box sx={{ p: 2, overflowY: 'auto' }}>
            {tab === 'profile' && (
              <Stack spacing={2}>
                <Box><Typography fontWeight={800}>Contact</Typography><Typography>{contactName(conversation?.contact)}</Typography><Typography color="text.secondary">{conversation?.contact?.phone || '-'}</Typography><Typography color="text.secondary">{conversation?.contact?.email || '-'}</Typography></Box>
                <Box><Typography fontWeight={800}>Lead Information</Typography><Typography>Status: {conversation?.lead?.status?.name || '-'}</Typography><Typography>Source: {conversation?.lead?.source?.name || '-'}</Typography><Typography>Course: {conversation?.lead?.courseInterested || '-'}</Typography><Typography>Budget: {conversation?.lead?.budget || '-'}</Typography></Box>
                <FormControl fullWidth size="small"><InputLabel>Assign Agent</InputLabel><Select label="Assign Agent" value={conversation?.assignedTo || ''} onChange={(e) => handleAssign(e.target.value)}><MenuItem value="">Unassigned</MenuItem>{agents.map((agent) => <MenuItem key={agent.id} value={agent.id}>{agentName(agent)}</MenuItem>)}</Select></FormControl>
                <Box>
                  <Typography fontWeight={800} sx={{ mb: 1 }}>Labels</Typography>
                  <Stack direction="row" gap={0.75} flexWrap="wrap" sx={{ mb: 1 }}>{(conversation?.labels || []).map((label) => <Chip key={label.id} size="small" icon={<LocalOfferIcon />} label={label.name} />)}</Stack>
                  <Stack direction="row" spacing={1}><TextField size="small" label="Add label" value={labelText} onChange={(e) => setLabelText(e.target.value)} fullWidth /><Button onClick={addLabel}>Add</Button></Stack>
                </Box>
              </Stack>
            )}
            {tab === 'notes' && (
              <Stack spacing={2}>
                <TextField label="Internal note" value={noteText} onChange={(e) => setNoteText(e.target.value)} multiline minRows={3} fullWidth />
                <Grid container spacing={1}><Grid item xs={4}><Button fullWidth onClick={() => addNote('private')}>Private</Button></Grid><Grid item xs={4}><Button fullWidth onClick={() => addNote('agent')}>Agent</Button></Grid><Grid item xs={4}><Button fullWidth onClick={() => addNote('follow_up')}>Follow-up</Button></Grid></Grid>
                <Divider />
                {notes.map((note) => <Paper key={note.id} variant="outlined" sx={{ p: 1.5 }}><Stack direction="row" spacing={1} alignItems="center"><NotesIcon fontSize="small" /><Chip size="small" label={note.type} /></Stack><Typography sx={{ mt: 1 }}>{note.note}</Typography><Typography variant="caption" color="text.secondary">{note.createdAt ? new Date(note.createdAt).toLocaleString() : ''}</Typography></Paper>)}
              </Stack>
            )}
            {tab === 'media' && (
              <Stack spacing={1.5}>
                {media.map((item) => <Paper key={item.id} variant="outlined" sx={{ p: 1.5 }}><Typography fontWeight={800}>{item.originalName}</Typography><Typography variant="body2" color="text.secondary">{item.mediaType} • {Math.round((item.size || 0) / 1024)} KB</Typography><Stack direction="row" spacing={1} sx={{ mt: 1 }}><Button size="small" href={`${API_ORIGIN}${item.publicUrl}`} target="_blank">Preview</Button><Button size="small" startIcon={<DownloadIcon />} onClick={() => handleDownload(item)}>Download</Button></Stack></Paper>)}
                {media.length === 0 && <Typography color="text.secondary">No media history yet.</Typography>}
              </Stack>
            )}
          </Box>
        </Paper>
      )}

      <Drawer anchor="right" open={sideOpen && window.innerWidth < 1200} onClose={() => setSideOpen(false)}>
        <Box sx={{ width: 340, p: 2 }}><Typography>Conversation details are available on desktop or wider screens.</Typography></Box>
      </Drawer>
    </Box>
  );
}

export default ChatPage;
