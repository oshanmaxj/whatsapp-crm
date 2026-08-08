import React, { memo, useEffect, useRef, useState } from 'react';
import {
  Avatar, Badge, Box, Button, Chip, Collapse, FormControl, IconButton, InputAdornment,
  InputLabel, LinearProgress, List, MenuItem, Select, Stack, TextField, Tooltip, Typography
} from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import FilterListIcon from '@mui/icons-material/FilterList';
import RefreshIcon from '@mui/icons-material/Refresh';
import WhatsAppIcon from '@mui/icons-material/WhatsApp';
import DoneAllIcon from '@mui/icons-material/DoneAll';
import { agentName, contactName, formatTime, initials, messagePreview, safeArray } from './chatUtils';
import WhatsAppAccountSelect from '../WhatsAppAccountSelect';

export const ConversationItem = memo(function ConversationItem({ conversation, selected, onSelect }) {
  const unread = Number(conversation.unreadCount || 0);
  const windowOpen = Boolean(conversation.messagingWindow?.isOpen) && new Date(conversation.messagingWindow?.expiresAt || 0).getTime() > Date.now();
  const lastMessageInternal = conversation.lastMessage?.isInternalNotification
    || conversation.lastMessage?.is_internal_notification;

  return (
    <Box
      component="button"
      type="button"
      onClick={() => onSelect(conversation.id)}
      sx={{
        width: '100%',
        display: 'flex',
        gap: 1.25,
        p: 1.5,
        border: 0,
        borderBottom: (theme) => `1px solid ${theme.palette.divider}`,
        bgcolor: selected ? 'rgba(18, 140, 126, 0.10)' : 'transparent',
        color: 'text.primary',
        textAlign: 'left',
        cursor: 'pointer',
        position: 'relative',
        '&:hover': { bgcolor: selected ? 'rgba(18, 140, 126, 0.12)' : 'action.hover' },
        '&::before': selected ? {
          content: '""',
          position: 'absolute',
          left: 0,
          top: 10,
          bottom: 10,
          width: 3,
          borderRadius: '0 4px 4px 0',
          bgcolor: 'primary.main'
        } : {}
      }}
    >
      <Badge
        overlap="circular"
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        badgeContent={(
          <Box sx={{ bgcolor: '#25d366', color: '#fff', width: 18, height: 18, borderRadius: '50%', display: 'grid', placeItems: 'center', border: '2px solid white' }}>
            <WhatsAppIcon sx={{ fontSize: 12 }} />
          </Box>
        )}
      >
        <Avatar sx={{ width: 44, height: 44, bgcolor: '#dff5ed', color: '#087b67', fontWeight: 800 }}>
          {initials(conversation.contact)}
        </Avatar>
      </Badge>

      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Stack direction="row" alignItems="center" justifyContent="space-between" gap={1}>
          <Typography variant="body2" fontWeight={800} noWrap>{contactName(conversation.contact)}</Typography>
          <Typography variant="caption" color={unread ? 'primary.main' : 'text.secondary'} flexShrink={0}>
            {formatTime(conversation.lastMessage?.createdAt || conversation.lastMessageAt)}
          </Typography>
        </Stack>
        <Stack direction="row" alignItems="center" gap={0.5} sx={{ mt: 0.25 }}>
          {conversation.lastMessage?.direction === 'outbound' && !lastMessageInternal && <DoneAllIcon sx={{ fontSize: 15, color: conversation.lastMessage?.status === 'read' ? '#1687d9' : 'text.disabled' }} />}
          <Typography variant="caption" color="text.secondary" noWrap sx={{ flex: 1 }}>
            {lastMessageInternal ? 'Internal: ' : ''}{messagePreview(conversation.lastMessage)}
          </Typography>
          {unread > 0 && (
            <Box sx={{ minWidth: 20, height: 20, px: 0.6, borderRadius: 10, bgcolor: '#25d366', color: '#fff', fontSize: 11, fontWeight: 800, display: 'grid', placeItems: 'center' }}>
              {unread > 99 ? '99+' : unread}
            </Box>
          )}
        </Stack>
        <Stack direction="row" alignItems="center" gap={0.75} sx={{ mt: 0.75 }}>
          <Tooltip title={windowOpen?'Customer messaging window is currently open.':'Only an approved template can be initiated outside the customer messaging window.'}><Chip size="small" label={windowOpen ? 'Open' : 'Outside window'} color={windowOpen ? 'success' : 'warning'} sx={{ height: 20, fontSize: 10 }} /></Tooltip>
          {conversation.whatsappAccount?.name && <Chip size="small" label={conversation.whatsappAccount.name} variant="outlined" sx={{ height: 20, fontSize: 10 }} />}
          {safeArray(conversation.labels).slice(0, 1).map((label) => (
            <Chip key={label.id || label.name} size="small" label={label.name} variant="outlined" sx={{ height: 20, fontSize: 10 }} />
          ))}
          <Typography variant="caption" color="text.disabled" noWrap sx={{ ml: 'auto', maxWidth: 95 }}>
            {[
              conversation.assignedRole?.name,
              (conversation.assignedUser || conversation.assignee) ? agentName(conversation.assignedUser || conversation.assignee) : null
            ].filter(Boolean).join(' / ') || 'Unassigned'}
          </Typography>
        </Stack>
      </Box>
    </Box>
  );
});

export function ConversationList({
  conversations,
  selectedId,
  onSelect,
  filters,
  onFiltersChange,
  agents,
  roles,
  leadStatuses,
  unread,
  connected,
  loading,
  onRefresh,
  loadingMore,
  hasMore,
  pageError,
  onLoadMore,
  windowCounts = { inside: 0, outside: 0, closing: 0 }
}) {
  const [filtersOpen, setFiltersOpen] = useState(false);
  const loadMoreRef = useRef(null);
  useEffect(() => {
    const node = loadMoreRef.current;
    if (!node || !hasMore || loadingMore) return undefined;
    const observer = new IntersectionObserver((entries) => { if (entries[0]?.isIntersecting) onLoadMore?.(); }, { rootMargin: '200px' });
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasMore, loadingMore, onLoadMore]);

  return (
    <Box sx={{ width: '100%', minWidth: 0, display: 'flex', flexDirection: 'column', bgcolor: 'background.paper' }}>
      <Box sx={{ p: 2, pb: 1.5 }}>
        <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1.5 }}>
          <Box>
            <Stack direction="row" alignItems="center" gap={1}>
              <Typography variant="h6" fontWeight={900}>Inbox</Typography>
              {unread > 0 && <Chip size="small" label={unread} color="success" sx={{ height: 22, fontWeight: 800 }} />}
            </Stack>
            <Stack direction="row" alignItems="center" gap={0.75}>
              <Box sx={{ width: 7, height: 7, borderRadius: '50%', bgcolor: connected ? '#25d366' : 'warning.main' }} />
              <Typography variant="caption" color="text.secondary">{connected ? 'Live updates connected' : 'Using 30s refresh'}</Typography>
            </Stack>
          </Box>
          <Stack direction="row">
            <Tooltip title="Filters">
              <IconButton size="small" color={filtersOpen ? 'primary' : 'default'} onClick={() => setFiltersOpen((value) => !value)}>
                <FilterListIcon fontSize="small" />
              </IconButton>
            </Tooltip>
            <Tooltip title="Refresh inbox">
              <span>
                <IconButton size="small" onClick={onRefresh} disabled={loading}>
                  <RefreshIcon fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>
          </Stack>
        </Stack>
        <TextField
          fullWidth
          size="small"
          value={filters.search}
          placeholder="Search name, phone or email"
          onChange={(event) => onFiltersChange({ ...filters, search: event.target.value })}
          InputProps={{
            startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment>
          }}
        />
        <Stack direction="row" spacing={0.5} sx={{pt:1}} flexWrap="wrap">
          <Chip size="small" clickable label={`Inside 24h: ${windowCounts.inside}`} color="success" onClick={()=>onFiltersChange({...filters,messagingWindow:'inside'})}/>
          <Chip size="small" clickable label={`Outside 24h: ${windowCounts.outside}`} color="warning" onClick={()=>onFiltersChange({...filters,messagingWindow:'outside'})}/>
          <Chip size="small" label={`Closing within 1h: ${windowCounts.closing}`} variant="outlined"/>
        </Stack>
        <Collapse in={filtersOpen}>
          <Box sx={{ pt: 1 }}><WhatsAppAccountSelect value={filters.whatsappAccountId || ''} onChange={(value) => onFiltersChange({ ...filters, whatsappAccountId: value })} allowAll fullWidth /></Box>
          <Stack direction="row" spacing={1} sx={{ pt: 1 }}>
            <FormControl size="small" fullWidth>
              <InputLabel>Agent</InputLabel>
              <Select label="Agent" value={filters.assignedUserId} onChange={(event) => onFiltersChange({ ...filters, assignedUserId: event.target.value })}>
                <MenuItem value="">All agents</MenuItem>
                {safeArray(agents).map((agent) => <MenuItem key={agent.id} value={agent.id}>{agentName(agent)}</MenuItem>)}
              </Select>
            </FormControl>
            <FormControl size="small" fullWidth>
              <InputLabel>Department</InputLabel>
              <Select label="Department" value={filters.assignedRoleId} onChange={(event) => onFiltersChange({ ...filters, assignedRoleId: event.target.value, mine: '' })}>
                <MenuItem value="">All departments</MenuItem>
                {safeArray(roles).map((role) => <MenuItem key={role.id} value={role.id}>{role.name}</MenuItem>)}
              </Select>
            </FormControl>
          </Stack>
          <FormControl size="small" fullWidth sx={{ mt: 1 }}><InputLabel>Messaging window</InputLabel><Select label="Messaging window" value={filters.messagingWindow||''} onChange={(event)=>onFiltersChange({...filters,messagingWindow:event.target.value})}><MenuItem value="">All</MenuItem><MenuItem value="inside">Inside 24 hours</MenuItem><MenuItem value="outside">Outside 24 hours</MenuItem></Select></FormControl>
          <FormControl size="small" fullWidth sx={{ mt: 1 }}>
            <InputLabel>Lead Status</InputLabel>
            <Select label="Lead Status" value={filters.leadStatus || ''} onChange={(event) => onFiltersChange({ ...filters, leadStatus: event.target.value })}>
              <MenuItem value="">All statuses</MenuItem>
              {safeArray(leadStatuses).map((status) => <MenuItem key={status.id} value={status.code || status.id}>{status.name}</MenuItem>)}
              <MenuItem value="none">No lead/status</MenuItem>
            </Select>
          </FormControl>
          <Stack direction="row" spacing={0.5} flexWrap="wrap">
            <Button size="small" variant={filters.mine === 'role' ? 'contained' : 'text'} onClick={() => onFiltersChange({ ...filters, mine: filters.mine === 'role' ? '' : 'role', assignedRoleId: '' })}>My department chats</Button>
            <Button size="small" variant={filters.mine === 'assigned' ? 'contained' : 'text'} onClick={() => onFiltersChange({ ...filters, mine: filters.mine === 'assigned' ? '' : 'assigned', assignedUserId: '' })}>My assigned chats</Button>
          </Stack>
          <Button
            size="small"
            sx={{ mt: 0.5 }}
            onClick={() => onFiltersChange({ ...filters, unread: filters.unread === 'true' ? '' : 'true' })}
          >
            {filters.unread === 'true' ? 'Showing unread only' : 'Show unread only'}
          </Button>
        </Collapse>
      </Box>
      {loading && <LinearProgress />}
      <List disablePadding sx={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
        {safeArray(conversations).map((conversation) => (
          <ConversationItem
            key={conversation.id}
            conversation={conversation}
            selected={String(selectedId) === String(conversation.id)}
            onSelect={onSelect}
          />
        ))}
        {!loading && safeArray(conversations).length === 0 && (
          <Box sx={{ p: 5, textAlign: 'center' }}>
            <Typography fontWeight={800}>No conversations</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>Try adjusting your search or filters.</Typography>
          </Box>
        )}
        <Box ref={loadMoreRef} sx={{ py: 1.5, textAlign: 'center' }}>
          {loadingMore && <Typography variant="caption" color="text.secondary">Loading more…</Typography>}
          {!loadingMore && pageError && <Button size="small" onClick={onLoadMore}>Retry loading conversations</Button>}
          {!loading && !loadingMore && !hasMore && safeArray(conversations).length > 0 && <Typography variant="caption" color="text.secondary">End of conversations</Typography>}
        </Box>
      </List>
    </Box>
  );
}
