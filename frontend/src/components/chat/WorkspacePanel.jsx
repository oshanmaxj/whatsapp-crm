import React, { useEffect, useMemo, useState } from 'react';
import {
  Autocomplete, Avatar, Box, Button, Checkbox, Chip, Divider, FormControl, FormControlLabel, IconButton, InputLabel, LinearProgress,
  Dialog, DialogActions, DialogContent, DialogTitle, MenuItem, Paper, Select, Stack, Tab, Tabs, TextField, Typography
} from '@mui/material';
import AddCircleOutlineIcon from '@mui/icons-material/AddCircleOutline';
import AssignmentIndOutlinedIcon from '@mui/icons-material/AssignmentIndOutlined';
import CalendarMonthOutlinedIcon from '@mui/icons-material/CalendarMonthOutlined';
import CloseIcon from '@mui/icons-material/Close';
import DownloadIcon from '@mui/icons-material/Download';
import GoogleIcon from '@mui/icons-material/Google';
import MoreHorizIcon from '@mui/icons-material/MoreHoriz';
import PauseCircleOutlineIcon from '@mui/icons-material/PauseCircleOutline';
import PersonAddAltOutlinedIcon from '@mui/icons-material/PersonAddAltOutlined';
import SmartToyOutlinedIcon from '@mui/icons-material/SmartToyOutlined';
import TuneOutlinedIcon from '@mui/icons-material/TuneOutlined';
import { agentName, contactName, formatDateTime, initials, resolveMediaUrl, safeArray } from './chatUtils';
import { getAccessPayload } from '../../utils/access';

function DetailRow({ label, value }) {
  return (
    <Stack direction="row" justifyContent="space-between" gap={2}>
      <Typography variant="caption" color="text.secondary">{label}</Typography>
      <Typography variant="caption" fontWeight={700} textAlign="right">{value || 'Not set'}</Typography>
    </Stack>
  );
}

function Section({ title, children }) {
  return (
    <Box>
      <Typography sx={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.8, color: 'text.disabled', fontWeight: 900, mb: 1 }}>{title}</Typography>
      {children}
    </Box>
  );
}

export function ProfileTab({ conversation, agents, roles, labelText, onLabelTextChange, onAddLabel, onAssign, onUpdateContact, engagement }) {
  const contact = conversation?.contact || {};
  const lead = conversation?.lead || {};
  const assignableUsers = safeArray(agents);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ firstName: '', lastName: '', tags: '' });
  const [assignment, setAssignment] = useState({ assigned_user_id: '', assigned_role_id: '', notify_assigned_user: true });
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState('');
  const access = getAccessPayload();
  const currentUserId = access.id || access.userId;
  const currentOwnerId = conversation?.assignedUserId || conversation?.assignedTo || null;
  const canClaim = access.isSystemAdmin || access.permissions?.includes('conversation.claim_unassigned');
  const canReassign = access.isSystemAdmin || access.permissions?.includes('conversation.reassign');
  const ownerChanged = String(assignment.assigned_user_id || '') !== String(currentOwnerId || '');
  const selectedAssignee = assignableUsers.find((agent) => String(agent.id) === String(assignment.assigned_user_id)) || null;

  useEffect(() => {
    setForm({
      firstName: contact.firstName || '',
      lastName: contact.lastName || '',
      tags: safeArray(contact.tags).join(', ')
    });
    setEditing(false);
  }, [contact.id, contact.firstName, contact.lastName, contact.tags]);

  useEffect(() => {
    setAssignment({
      assigned_user_id: conversation?.assignedUserId || conversation?.assignedTo || '',
      assigned_role_id: conversation?.assignedRoleId || '',
      notify_assigned_user: true
    });
  }, [conversation?.id, conversation?.assignedUserId, conversation?.assignedTo, conversation?.assignedRoleId]);

  const saveContact = async () => {
    try {
      await onUpdateContact({
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        tags: form.tags.split(',').map((tag) => tag.trim()).filter(Boolean)
      });
      setEditing(false);
    } catch {
      // The page-level handler displays the API error and leaves the form open.
    }
  };

  return (
    <Stack spacing={2.25}>
      <Stack alignItems="center" spacing={0.75}>
        <Avatar sx={{ width: 64, height: 64, bgcolor: '#dff5ed', color: '#087b67', fontWeight: 900, fontSize: 22 }}>{initials(contact)}</Avatar>
        <Typography fontWeight={900}>{contactName(contact)}</Typography>
        <Typography variant="caption" color="text.secondary">{contact.phone || 'No phone number'}</Typography>
        <Stack direction="row" gap={0.5} flexWrap="wrap" justifyContent="center">
          {safeArray(conversation?.labels).map((label) => <Chip key={label.id || label.name} size="small" label={label.name} />)}
          {safeArray(contact.tags).map((tag) => <Chip key={tag} size="small" variant="outlined" label={tag} />)}
        </Stack>
      </Stack>
      <Divider />
      <Section title="Contact profile">
        {editing ? (
          <Stack spacing={1}>
            <Stack direction="row" spacing={1}>
              <TextField size="small" label="First name" value={form.firstName} onChange={(event) => setForm((current) => ({ ...current, firstName: event.target.value }))} fullWidth />
              <TextField size="small" label="Last name" value={form.lastName} onChange={(event) => setForm((current) => ({ ...current, lastName: event.target.value }))} fullWidth />
            </Stack>
            <TextField size="small" label="Tags" helperText="Separate tags with commas" value={form.tags} onChange={(event) => setForm((current) => ({ ...current, tags: event.target.value }))} fullWidth />
            <Stack direction="row" spacing={1}>
              <Button size="small" variant="contained" onClick={saveContact}>Save</Button>
              <Button size="small" onClick={() => setEditing(false)}>Cancel</Button>
            </Stack>
          </Stack>
        ) : (
          <Button size="small" variant="outlined" onClick={() => setEditing(true)}>Edit name and tags</Button>
        )}
      </Section>
      <Section title="Customer snapshot">
        <Stack spacing={1}>
          <DetailRow label="Phone" value={contact.phone || contact.whatsappId} />
          <DetailRow label="Email" value={contact.email} />
          <DetailRow label="Country" value={contact.country} />
          <DetailRow label="Timezone" value={contact.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone} />
          <DetailRow label="Customer since" value={formatDateTime(contact.createdAt)} />
          <DetailRow label="Last seen" value={formatDateTime(conversation?.lastMessageAt)} />
          <DetailRow label="Assigned agent" value={agentName(conversation?.assignee)} />
          <DetailRow label="Department" value={conversation?.assignedRole?.name} />
        </Stack>
      </Section>
      <Section title="Lead information">
        <Stack spacing={1}>
          <DetailRow label="Status" value={lead.status?.name || lead.stage} />
          <DetailRow label="Source" value={lead.source?.name} />
          <DetailRow label="Course interest" value={lead.courseInterested} />
          <DetailRow label="Budget" value={lead.budget ? Number(lead.budget).toLocaleString() : null} />
        </Stack>
      </Section>
      <Section title="Chat assignment">
        <Stack spacing={1.25}>
      <Autocomplete
        size="small"
        options={assignableUsers}
        value={selectedAssignee}
        onChange={(event, value) => setAssignment((current) => ({ ...current, assigned_user_id: value?.id || '' }))}
        getOptionLabel={(option) => option ? `${agentName(option)}${option.email ? ` - ${option.email}` : ''}` : ''}
        isOptionEqualToValue={(option, value) => String(option.id) === String(value.id)}
        ListboxProps={{ sx: { maxHeight: 280 } }}
        renderInput={(params) => <TextField {...params} label="Assigned User (Optional)" placeholder="Unassigned" />}
        disabled={Boolean(currentOwnerId) && !canReassign}
      />
      <FormControl fullWidth size="small">
        <InputLabel>Department</InputLabel>
        <Select label="Department" value={assignment.assigned_role_id} onChange={(event) => setAssignment((current) => ({ ...current, assigned_role_id: event.target.value }))}>
          <MenuItem value="">No department</MenuItem>
          {safeArray(roles).map((role) => <MenuItem key={role.id} value={role.id}>{role.name}</MenuItem>)}
        </Select>
      </FormControl>
      <FormControlLabel
        control={<Checkbox checked={assignment.notify_assigned_user} onChange={(event) => setAssignment((current) => ({ ...current, notify_assigned_user: event.target.checked }))} />}
        label="Notify assigned user on WhatsApp"
      />
      {currentOwnerId && !canReassign && <Typography variant="body2" color="text.secondary">Assigned to {agentName(conversation?.assignee)}. Only a manager can reassign this conversation.</Typography>}
      {!currentOwnerId && canClaim && <Button variant="contained" onClick={() => onAssign({ assigned_user_id: currentUserId, expected_assigned_user_id: null, notify_assigned_user: true })}>Claim conversation</Button>}
      {canReassign && <Button variant="contained" disabled={!ownerChanged} onClick={() => setConfirming(true)}>Save Assignment</Button>}
      <Dialog open={confirming} onClose={() => setConfirming(false)} fullWidth maxWidth="sm">
        <DialogTitle>Confirm conversation reassignment</DialogTitle>
        <DialogContent><Stack spacing={2} sx={{ pt: 1 }}><Typography>Previous owner: {agentName(conversation?.assignee)}</Typography><Typography>New owner: {agentName(selectedAssignee)}</Typography><TextField required multiline minRows={3} label="Reason" value={reason} onChange={(event) => setReason(event.target.value)} /></Stack></DialogContent>
        <DialogActions><Button onClick={() => setConfirming(false)}>Cancel</Button><Button variant="contained" disabled={!reason.trim()} onClick={async () => { await onAssign({ assigned_user_id: assignment.assigned_user_id || null, assigned_role_id: assignment.assigned_role_id || null, expected_assigned_user_id: currentOwnerId, reason: reason.trim(), notify_assigned_user: assignment.notify_assigned_user }); setConfirming(false); setReason(''); }}>Confirm reassignment</Button></DialogActions>
      </Dialog>
        </Stack>
      </Section>
      <Section title="Labels">
        <Stack direction="row" gap={0.75}>
          <TextField size="small" value={labelText} onChange={(event) => onLabelTextChange(event.target.value)} placeholder="Add a label" fullWidth />
          <Button variant="outlined" onClick={onAddLabel} disabled={!labelText.trim()}>Add</Button>
        </Stack>
      </Section>
      <Section title="Engagement score">
        <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 2 }}>
          <Stack spacing={1}>
            <DetailRow label="Messages sent" value={engagement.sent} />
            <DetailRow label="Replies received" value={engagement.received} />
            <DetailRow label="Broadcast opened" value={engagement.broadcastOpened} />
            <Box>
              <Stack direction="row" justifyContent="space-between">
                <Typography variant="caption" color="text.secondary">Interaction rate</Typography>
                <Typography variant="caption" fontWeight={900} color="primary.main">{engagement.rate}%</Typography>
              </Stack>
              <LinearProgress variant="determinate" value={engagement.rate} color="success" sx={{ mt: 0.75, height: 6, borderRadius: 4 }} />
            </Box>
          </Stack>
        </Paper>
      </Section>
    </Stack>
  );
}

export function NotesTab({ notes, noteText, onNoteTextChange, onAddNote }) {
  return (
    <Stack spacing={1.5}>
      <TextField multiline minRows={3} value={noteText} onChange={(event) => onNoteTextChange(event.target.value)} placeholder="Add an internal note..." />
      <Stack direction="row" gap={0.75}>
        <Button size="small" variant="contained" onClick={() => onAddNote('private')} disabled={!noteText.trim()}>Add note</Button>
        <Button size="small" variant="outlined" onClick={() => onAddNote('follow_up')} disabled={!noteText.trim()}>Follow-up</Button>
      </Stack>
      <Divider />
      <Box sx={{ position: 'relative', pl: 2 }}>
        <Box sx={{ position: 'absolute', left: 5, top: 4, bottom: 4, width: 2, bgcolor: 'divider' }} />
        <Stack spacing={1.25}>
          {safeArray(notes).map((note) => (
            <Paper key={note.id} variant="outlined" sx={{ p: 1.25, position: 'relative', borderRadius: 2 }}>
              <Box sx={{ position: 'absolute', left: -18, top: 15, width: 10, height: 10, borderRadius: '50%', bgcolor: 'primary.main', border: '2px solid white' }} />
              <Stack direction="row" justifyContent="space-between" alignItems="center">
                <Chip size="small" label={note.type?.replace('_', ' ')} sx={{ height: 20, textTransform: 'capitalize' }} />
                <Typography variant="caption" color="text.disabled">{formatDateTime(note.createdAt, '')}</Typography>
              </Stack>
              <Typography variant="body2" sx={{ mt: 0.75, whiteSpace: 'pre-wrap' }}>{note.note}</Typography>
              <Typography variant="caption" color="text.secondary">{agentName(note.author)}</Typography>
            </Paper>
          ))}
          {safeArray(notes).length === 0 && <Typography variant="body2" color="text.secondary">No notes have been added.</Typography>}
        </Stack>
      </Box>
    </Stack>
  );
}

export function MediaTab({ media, onDownload }) {
  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 1 }}>
      {safeArray(media).map((item) => {
        const url = resolveMediaUrl(item.publicUrl);
        const isImage = item.mediaType === 'image';
        const isVideo = item.mediaType === 'video';
        return (
          <Paper key={item.id} variant="outlined" sx={{ overflow: 'hidden', borderRadius: 2 }}>
            <Box sx={{ height: 105, bgcolor: 'action.hover', display: 'grid', placeItems: 'center', overflow: 'hidden' }}>
              {isImage && <Box component="img" src={url} alt={item.originalName || 'Media'} loading="lazy" sx={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
              {isVideo && <Box component="video" src={url} preload="metadata" sx={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
              {!isImage && !isVideo && <TuneOutlinedIcon color="disabled" />}
            </Box>
            <Box sx={{ p: 1 }}>
              <Typography variant="caption" fontWeight={800} noWrap display="block">{item.originalName || item.fileName}</Typography>
              <Typography variant="caption" color="text.disabled">{Math.max(1, Math.round((item.size || 0) / 1024))} KB</Typography>
              <Stack direction="row" sx={{ mt: 0.5 }}>
                <Button size="small" href={url} target="_blank">Open</Button>
                <IconButton size="small" onClick={() => onDownload(item)}><DownloadIcon fontSize="small" /></IconButton>
              </Stack>
            </Box>
          </Paper>
        );
      })}
      {safeArray(media).length === 0 && <Typography variant="body2" color="text.secondary" sx={{ gridColumn: '1 / -1' }}>Shared media will appear here.</Typography>}
    </Box>
  );
}

function ActionButton({ icon, label, onClick, color = 'inherit' }) {
  return (
    <Button
      variant="outlined"
      color={color}
      startIcon={icon}
      onClick={onClick}
      sx={{ justifyContent: 'flex-start', minHeight: 44, textAlign: 'left' }}
    >
      {label}
    </Button>
  );
}

export function ActionsTab({ onAction }) {
  return (
    <Stack spacing={2}>
      <Section title="Conversation controls">
        <Stack spacing={1}>
          <ActionButton icon={<PauseCircleOutlineIcon />} label="Pause bot" onClick={() => onAction('Pause bot')} />
          <ActionButton icon={<SmartToyOutlinedIcon />} label="Pause AI" onClick={() => onAction('Pause AI')} />
          <ActionButton icon={<AddCircleOutlineIcon />} label="Create follow-up" onClick={() => onAction('Create follow-up')} />
          <ActionButton icon={<CalendarMonthOutlinedIcon />} label="Create appointment" onClick={() => onAction('Create appointment')} />
          <ActionButton icon={<AssignmentIndOutlinedIcon />} label="Assign agent" onClick={() => onAction('Assign agent')} />
          <ActionButton icon={<PersonAddAltOutlinedIcon />} label="Convert to student" onClick={() => onAction('Convert to student')} color="success" />
        </Stack>
      </Section>
      <Divider />
      <Section title="Quick actions">
        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 1 }}>
          <ActionButton icon={<PauseCircleOutlineIcon />} label="Pause Bot" onClick={() => onAction('Pause bot')} />
          <ActionButton icon={<SmartToyOutlinedIcon />} label="Pause AI" onClick={() => onAction('Pause AI')} />
          <ActionButton icon={<GoogleIcon />} label="Google Meet" onClick={() => onAction('Google Meet')} />
          <ActionButton icon={<TuneOutlinedIcon />} label="Custom Field" onClick={() => onAction('Custom Field')} />
          <ActionButton icon={<MoreHorizIcon />} label="More" onClick={() => onAction('More')} />
        </Box>
      </Section>
    </Stack>
  );
}

export function WorkspacePanel({
  conversation,
  agents,
  roles,
  notes,
  media,
  noteText,
  onNoteTextChange,
  labelText,
  onLabelTextChange,
  onAddNote,
  onAddLabel,
  onAssign,
  onUpdateContact,
  onDownload,
  onAction,
  onClose,
  showClose = false
}) {
  const [tab, setTab] = useState('profile');
  const engagement = useMemo(() => {
    const interactionRate = conversation?.interactionRate || {};
    const sent = Number(interactionRate.messagesSent || 0);
    const received = Number(interactionRate.repliesReceived || 0);
    const rate = Number(interactionRate.percentage || 0);
    return { sent, received, broadcastOpened: 0, rate };
  }, [conversation?.interactionRate]);
  const handleAction = (action) => {
    if (action === 'Create follow-up') setTab('notes');
    if (action === 'Assign agent') setTab('profile');
    onAction(action);
  };

  return (
    <Box sx={{ width: '100%', minWidth: 0, display: 'flex', flexDirection: 'column', bgcolor: 'background.paper' }}>
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ px: 2, py: 1.5 }}>
        <Box>
          <Typography fontWeight={900}>Workspace</Typography>
          <Typography variant="caption" color="text.secondary">Customer context and actions</Typography>
        </Box>
        {showClose && <IconButton size="small" onClick={onClose}><CloseIcon /></IconButton>}
      </Stack>
      <Tabs value={tab} onChange={(event, value) => setTab(value)} variant="scrollable" scrollButtons={false} sx={{ minHeight: 42, borderBottom: (theme) => `1px solid ${theme.palette.divider}`, '& .MuiTab-root': { minHeight: 42, minWidth: 72, px: 1.25, fontSize: 12 } }}>
        <Tab value="profile" label="Profile" />
        <Tab value="notes" label="Notes" />
        <Tab value="media" label="Media" />
        <Tab value="actions" label="Actions" />
      </Tabs>
      <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto', p: 2 }}>
        {!conversation && <Typography variant="body2" color="text.secondary">Select a conversation to open its workspace.</Typography>}
        {conversation && tab === 'profile' && <ProfileTab conversation={conversation} agents={agents} roles={roles} labelText={labelText} onLabelTextChange={onLabelTextChange} onAddLabel={onAddLabel} onAssign={onAssign} onUpdateContact={onUpdateContact} engagement={engagement} />}
        {conversation && tab === 'notes' && <NotesTab notes={notes} noteText={noteText} onNoteTextChange={onNoteTextChange} onAddNote={onAddNote} />}
        {conversation && tab === 'media' && <MediaTab media={media} onDownload={onDownload} />}
        {conversation && tab === 'actions' && <ActionsTab onAction={handleAction} />}
      </Box>
    </Box>
  );
}
