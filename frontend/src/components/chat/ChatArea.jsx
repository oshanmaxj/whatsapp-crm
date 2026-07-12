import React, { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  Avatar, Box, Button, Chip, CircularProgress, Divider, IconButton, Menu, MenuItem,
  ListItemText, Paper, Stack, TextField, Tooltip, Typography
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import AttachFileIcon from '@mui/icons-material/AttachFile';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import EmojiEmotionsOutlinedIcon from '@mui/icons-material/EmojiEmotionsOutlined';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import InsertDriveFileOutlinedIcon from '@mui/icons-material/InsertDriveFileOutlined';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import MicNoneOutlinedIcon from '@mui/icons-material/MicNoneOutlined';
import CloseIcon from '@mui/icons-material/Close';
import ReplyOutlinedIcon from '@mui/icons-material/ReplyOutlined';
import SendRoundedIcon from '@mui/icons-material/SendRounded';
import StarBorderRoundedIcon from '@mui/icons-material/StarBorderRounded';
import WhatsAppIcon from '@mui/icons-material/WhatsApp';
import { agentName, contactName, formatDateTime, formatTime, initials, resolveMediaUrl, safeArray } from './chatUtils';

function StatusTicks({ message }) {
  if (message.direction !== 'outbound') return null;
  const status = message.status || 'pending';
  const config = {
    pending: { symbol: '\uD83D\uDD52', label: 'Pending', color: 'text.disabled' },
    sent: { symbol: '\u2713', label: 'Sent', color: 'text.secondary' },
    delivered: { symbol: '\u2713\u2713', label: 'Delivered', color: 'text.secondary' },
    read: { symbol: '\u2713\u2713', label: 'Read', color: '#1687d9' },
    failed: { symbol: '\u274C', label: 'Failed', color: 'error.main' }
  };
  const view = config[status] || config.pending;
  const errorCode = message.errorCode || message.error_code;
  const errorMessage = message.errorMessage || message.error_message;
  const title = status === 'failed'
    ? [errorCode, errorMessage].filter(Boolean).join(': ') || 'Message delivery failed'
    : view.label;

  return (
    <Tooltip title={title} arrow>
      <Typography component="span" aria-label={`Message status: ${view.label}`} sx={{ color: view.color, fontSize: 11, fontWeight: 900, letterSpacing: -1 }}>
        {view.symbol}
      </Typography>
    </Tooltip>
  );
}

function MessageMedia({ message, onMediaLoad }) {
  const src = resolveMediaUrl(message.mediaUrl);
  if (!src) return null;

  if (message.type === 'image' || message.type === 'sticker') {
    return <Box component="img" src={src} alt={message.text || 'Message attachment'} loading="lazy" onLoad={onMediaLoad} sx={{ display: 'block', width: '100%', maxHeight: 340, objectFit: 'cover', borderRadius: 1.5, mb: 0.75 }} />;
  }
  if (message.type === 'video') {
    return <Box component="video" src={src} controls preload="metadata" onLoadedMetadata={onMediaLoad} sx={{ display: 'block', width: '100%', maxHeight: 340, borderRadius: 1.5, mb: 0.75 }} />;
  }
  if (message.type === 'audio') {
    return <Box component="audio" src={src} controls preload="metadata" onLoadedMetadata={onMediaLoad} sx={{ display: 'block', width: '100%', minWidth: 250, my: 0.5 }} />;
  }
  const fileName = message.rawPayload?.document?.filename
    || message.rawPayload?.file?.fileName
    || message.rawPayload?.fileName
    || message.rawPayload?.filename
    || 'Open document';
  return (
    <Button href={src} target="_blank" rel="noreferrer" variant="outlined" size="small" startIcon={<InsertDriveFileOutlinedIcon />} sx={{ my: 0.5, bgcolor: 'rgba(255,255,255,.45)' }}>
      {fileName}
    </Button>
  );
}

function messageSummary(message) {
  if (!message) return '';
  if (message.text) return message.text;
  if (message.templateName) return message.templateName;
  if (message.type === 'document') {
    return `Document: ${message.rawPayload?.file?.fileName || message.rawPayload?.document?.filename || message.rawPayload?.filename || 'Document'}`;
  }
  if (['image', 'video', 'audio'].includes(message.type)) {
    return message.type.charAt(0).toUpperCase() + message.type.slice(1);
  }
  return message.type || 'Message';
}

function repliedByLabel(message) {
  if (message.direction !== 'outbound') return null;
  const sentBy = message.sentBy || message.sent_by;
  if (sentBy) {
    return sentBy.name
      || [sentBy.firstName, sentBy.lastName].filter(Boolean).join(' ')
      || sentBy.email
      || null;
  }

  const source = String(message.source || message.rawPayload?.source || '').toLowerCase();
  const systemMessage = message.isBot
    || message.isAutoReply
    || message.rawPayload?.bot
    || message.rawPayload?.autoReply
    || message.rawPayload?.workflow
    || ['bot', 'automation', 'workflow', 'auto_reply', 'system'].includes(source);
  return systemMessage ? 'System' : null;
}

function messageBadges(message) {
  const messageType = message.messageType || message.message_type;
  const interactiveType = message.interactiveType || message.interactive_type;
  const internal = message.isInternalNotification || message.is_internal_notification;
  const badges = [];
  if (messageType === 'broadcast') badges.push({ label: 'Broadcast', color: 'primary' });
  if (message.type === 'template') badges.push({ label: 'Template', color: 'secondary' });
  if (messageType === 'button_reply' || interactiveType === 'button_reply' || interactiveType === 'button') {
    badges.push({ label: 'Button Reply', color: 'success' });
  } else if (interactiveType === 'list_reply') {
    badges.push({ label: 'List Reply', color: 'success' });
  }
  if (messageType === 'assignment_notification') badges.push({ label: 'Assignment Notification', color: 'warning' });
  if (internal) badges.push({ label: 'Internal', color: 'default' });
  return badges;
}

function messageBodyText(message) {
  const text = message.text || message.templateName || '';
  const messageType = message.messageType || message.message_type;
  const interactiveType = message.interactiveType || message.interactive_type;
  const payload = message.buttonPayload || message.button_payload;
  const isInteractiveReply = messageType === 'button_reply'
    || messageType === 'flow_reply'
    || interactiveType === 'button'
    || interactiveType === 'button_reply'
    || interactiveType === 'list_reply'
    || interactiveType === 'nfm_reply';
  if (!isInteractiveReply || !payload || String(text).includes('Payload:')) return text;
  return [text || 'Customer selected an option', `Payload: ${payload}`].join('\n');
}

function QuotedPreview({ preview, outbound, onClick }) {
  if (!preview) return null;
  return (
    <Box
      onClick={preview.id ? onClick : undefined}
      sx={{
        mb: 0.75,
        px: 1,
        py: 0.75,
        borderLeft: '3px solid',
        borderColor: outbound ? '#128c7e' : '#25d366',
        bgcolor: outbound ? 'rgba(18,140,126,.11)' : 'rgba(18,140,126,.08)',
        borderRadius: 1,
        cursor: preview.id ? 'pointer' : 'default',
        maxWidth: '100%'
      }}
    >
      <Typography sx={{ fontSize: 11, fontWeight: 900, color: outbound ? '#087b67' : '#128c7e' }} noWrap>
        {preview.sender || 'Previous message'}
      </Typography>
      <Typography sx={{ fontSize: 11, color: 'text.secondary' }} noWrap>
        {preview.text || 'Replied to a previous message'}
      </Typography>
    </Box>
  );
}

export const MessageBubble = memo(function MessageBubble({ message, onMediaLoad, onReply, onJumpToMessage, highlighted }) {
  const outbound = message.direction === 'outbound';
  const internal = message.isInternalNotification || message.is_internal_notification;
  const replyPreview = message.replyPreview;
  const repliedBy = repliedByLabel(message);
  const badges = messageBadges(message);
  const bodyText = messageBodyText(message);
  return (
    <Box sx={{ display: 'flex', justifyContent: internal ? 'center' : (outbound ? 'flex-end' : 'flex-start'), mb: 1 }}>
      <Paper
        elevation={0}
        onContextMenu={(event) => {
          event.preventDefault();
          if (!internal) onReply(message);
        }}
        sx={{
          position: 'relative',
          px: 1.4,
          py: 1,
          maxWidth: { xs: '88%', sm: '76%' },
          minWidth: 90,
          borderRadius: internal ? 2 : (outbound ? '14px 4px 14px 14px' : '4px 14px 14px 14px'),
          bgcolor: internal ? '#fff4d6' : (outbound ? '#d9fdd3' : '#fff'),
          border: internal ? '1px dashed #d6a72d' : 'none',
          color: '#17231f',
          boxShadow: highlighted ? '0 0 0 3px rgba(18,140,126,.35), 0 1px 2px rgba(15,23,42,.12)' : '0 1px 2px rgba(15,23,42,.12)',
          transition: 'box-shadow 180ms ease'
        }}
      >
        <Stack direction="row" spacing={0.5} alignItems="center" justifyContent={badges.length ? 'space-between' : 'flex-end'} sx={{ minHeight: 16, mb: 0.5 }}>
          {badges.length > 0 && <Stack direction="row" spacing={0.4} flexWrap="wrap" useFlexGap>{badges.map((badge) => <Chip key={badge.label} size="small" label={badge.label} color={badge.color} variant="outlined" sx={{ height: 19, fontSize: 9, fontWeight: 800 }} />)}</Stack>}
          {!internal && <Tooltip title="Reply">
            <IconButton size="small" onClick={() => onReply(message)} sx={{ width: 22, height: 22 }}>
              <ReplyOutlinedIcon sx={{ fontSize: 14 }} />
            </IconButton>
          </Tooltip>}
        </Stack>
        <QuotedPreview
          preview={replyPreview}
          outbound={outbound}
          onClick={() => replyPreview?.id && onJumpToMessage(replyPreview.id)}
        />
        <MessageMedia message={message} onMediaLoad={onMediaLoad} />
        {bodyText && (
          <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', lineHeight: 1.45 }}>
            {bodyText}
          </Typography>
        )}
        <Stack direction="row" spacing={0.6} alignItems="center" justifyContent="flex-end" sx={{ mt: 0.35 }}>
          <Typography variant="caption" sx={{ color: 'rgba(23,35,31,.58)', fontSize: 10 }}>
            {formatTime(message.createdAt)}
          </Typography>
          {!internal && <StatusTicks message={message} />}
        </Stack>
        {repliedBy && (
          <Typography sx={{ mt: 0.15, color: 'rgba(23,35,31,.52)', fontSize: 9.5, textAlign: 'right', lineHeight: 1.3 }}>
            Replied by: {repliedBy}
          </Typography>
        )}
      </Paper>
    </Box>
  );
});

export function ChatHeader({ conversation, onBack, onToggleWorkspace, onEdit, onStatusChange, mobile }) {
  const contact = conversation?.contact;
  return (
    <Box sx={{ px: { xs: 1.25, sm: 2 }, py: 1.25, borderBottom: (theme) => `1px solid ${theme.palette.divider}`, bgcolor: 'background.paper' }}>
      <Stack direction="row" alignItems="center" gap={1.25}>
        {mobile && <IconButton size="small" onClick={onBack}><ArrowBackIcon /></IconButton>}
        <Avatar sx={{ width: 42, height: 42, bgcolor: '#dff5ed', color: '#087b67', fontWeight: 800 }}>{initials(contact)}</Avatar>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Stack direction="row" alignItems="center" gap={0.5}>
            <Typography fontWeight={900} noWrap>{contactName(contact)}</Typography>
            <Tooltip title="Edit contact"><IconButton size="small" onClick={onEdit}><EditOutlinedIcon sx={{ fontSize: 16 }} /></IconButton></Tooltip>
          </Stack>
          <Stack direction="row" alignItems="center" gap={0.6}>
            <WhatsAppIcon sx={{ fontSize: 14, color: '#25d366' }} />
            <Typography variant="caption" color="text.secondary" noWrap>{contact?.phone || contact?.whatsappId || 'No phone number'}</Typography>
            {conversation?.whatsappAccount?.name && <Typography variant="caption" color="primary.main" fontWeight={700} noWrap>• {conversation.whatsappAccount.name}{conversation.whatsappAccount.phoneNumber ? ` (${conversation.whatsappAccount.phoneNumber})` : ''}</Typography>}
            <Typography variant="caption" color="text.disabled">•</Typography>
            <Typography variant="caption" color="text.secondary" noWrap>
              {[
                conversation?.assignedRole?.name,
                (conversation?.assignedUser || conversation?.assignee) ? agentName(conversation.assignedUser || conversation.assignee) : null
              ].filter(Boolean).join(' / ') || 'Unassigned'}
            </Typography>
          </Stack>
        </Box>
        <Chip
          size="small"
          label={conversation?.status || 'open'}
          color={conversation?.status === 'open' ? 'success' : 'default'}
          onClick={() => onStatusChange(conversation?.status === 'open' ? 'closed' : 'open')}
          sx={{ display: { xs: 'none', sm: 'flex' }, textTransform: 'capitalize', fontWeight: 700 }}
        />
        <Tooltip title="Contact workspace"><IconButton onClick={onToggleWorkspace}><InfoOutlinedIcon /></IconButton></Tooltip>
      </Stack>
    </Box>
  );
}

export function CustomerInfoBar({ conversation }) {
  const contact = conversation?.contact || {};
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    setNow(Date.now());
    const interval = window.setInterval(() => setNow(Date.now()), 60000);
    return () => window.clearInterval(interval);
  }, []);

  const lastInboundAt = conversation?.lastInboundAt || conversation?.last_inbound_at;
  const lastInboundTime = lastInboundAt ? new Date(lastInboundAt).getTime() : Number.NaN;
  const remainingMs = Number.isFinite(lastInboundTime)
    ? lastInboundTime + (24 * 60 * 60 * 1000) - now
    : 0;
  const insideWindow = remainingMs > 0;
  const remainingMinutes = insideWindow ? Math.ceil(remainingMs / 60000) : 0;
  const remainingHours = Math.floor(remainingMinutes / 60);
  const windowStatus = insideWindow ? 'Inside 24H' : 'Outside 24H';
  const windowDetail = insideWindow
    ? `${remainingHours}h ${remainingMinutes % 60}m left`
    : 'Template required';
  const interactionRate = conversation?.interactionRate || {};
  const interactionPercentage = Number(interactionRate.percentage || 0);
  const interactionPrecise = Number(interactionRate.precisePercentage ?? interactionPercentage);
  const interactionColor = interactionPercentage >= 70
    ? 'success.main'
    : interactionPercentage >= 30
      ? 'warning.main'
      : 'error.main';
  const interactionTone = interactionPercentage >= 70
    ? 'High Engagement'
    : interactionPercentage >= 30
      ? 'Moderate Engagement'
      : 'Low Engagement';
  const interactionTooltip = (
    <Box>
      <Typography variant="caption" display="block">Messages Sent: {interactionRate.messagesSent || 0}</Typography>
      <Typography variant="caption" display="block">Replies Received: {interactionRate.repliesReceived || 0}</Typography>
      <Typography variant="caption" display="block">Interaction Rate: {interactionPrecise}%</Typography>
    </Box>
  );

  const items = [
    ['Customer since', formatDateTime(contact.createdAt, 'Not set')],
    ['Last seen', formatDateTime(conversation?.lastMessageAt, 'Not seen')],
    ['Messaging window', windowStatus, windowDetail, insideWindow],
    ['Country', contact.country || 'Not set'],
    ['Interaction rate', `${interactionPercentage}%`, interactionTone, interactionColor, interactionTooltip]
  ];
  return (
    <Box sx={{ px: 2, py: 1, borderBottom: (theme) => `1px solid ${theme.palette.divider}`, bgcolor: 'rgba(18,140,126,.035)', overflowX: 'auto' }}>
      <Stack direction="row" divider={<Divider orientation="vertical" flexItem />} spacing={2.25} sx={{ minWidth: 'max-content' }}>
        {items.map(([label, value, detail, active, tooltip]) => (
          <Box key={label}>
            <Typography sx={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: 0.7, color: 'text.disabled', fontWeight: 800 }}>{label}</Typography>
            {label === 'Messaging window' ? (
              <>
                <Stack direction="row" spacing={0.6} alignItems="center">
                  <Box sx={{ width: 7, height: 7, borderRadius: '50%', bgcolor: active ? 'success.main' : 'warning.main' }} />
                  <Typography variant="caption" fontWeight={800} color={active ? 'success.main' : 'warning.dark'}>{value}</Typography>
                </Stack>
                <Typography sx={{ fontSize: 10, color: 'text.secondary', lineHeight: 1.1 }}>{detail}</Typography>
              </>
            ) : label === 'Interaction rate' ? (
              <Tooltip title={tooltip} arrow>
                <Box>
                  <Typography variant="caption" fontWeight={900} color={active}>{value}</Typography>
                  <Typography sx={{ fontSize: 10, color: active, lineHeight: 1.1, fontWeight: 700 }}>{detail}</Typography>
                </Box>
              </Tooltip>
            ) : (
              <Typography variant="caption" fontWeight={700}>{value}</Typography>
            )}
          </Box>
        ))}
      </Stack>
    </Box>
  );
}

export function MessageList({ messages, conversationId, messagesReady, onReply }) {
  const messagesContainerRef = useRef(null);
  const messagesEndRef = useRef(null);
  const messageRefs = useRef(new Map());
  const activeConversationRef = useRef(null);
  const initializedRef = useRef(false);
  const isInitialLoadRef = useRef(false);
  const previousCountRef = useRef(0);
  const nearBottomRef = useRef(true);
  const [showScrollToLatest, setShowScrollToLatest] = useState(false);
  const [highlightedMessageId, setHighlightedMessageId] = useState(null);

  const forceScrollToBottom = useCallback(() => {
    const container = messagesContainerRef.current;
    if (!container) return;
    container.scrollTop = container.scrollHeight;
    nearBottomRef.current = true;
    setShowScrollToLatest(false);
  }, []);

  const settleAtBottom = useCallback(() => {
    forceScrollToBottom();
    window.requestAnimationFrame(() => {
      forceScrollToBottom();
      window.requestAnimationFrame(forceScrollToBottom);
    });
  }, [forceScrollToBottom]);

  useLayoutEffect(() => {
    if (!conversationId) {
      activeConversationRef.current = null;
      initializedRef.current = false;
      isInitialLoadRef.current = false;
      previousCountRef.current = 0;
      return;
    }

    const count = safeArray(messages).length;
    const conversationChanged = String(activeConversationRef.current) !== String(conversationId);
    if (conversationChanged) {
      activeConversationRef.current = conversationId;
      initializedRef.current = false;
      isInitialLoadRef.current = true;
      previousCountRef.current = 0;
      nearBottomRef.current = true;
      setShowScrollToLatest(false);
    }

    if (!messagesReady) return;
    if (!initializedRef.current) {
      initializedRef.current = true;
      previousCountRef.current = count;
      settleAtBottom();
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
          isInitialLoadRef.current = false;
        });
      });
      return;
    }
  }, [conversationId, messages, messagesReady, settleAtBottom]);

  useEffect(() => {
    if (!conversationId || !messagesReady || !initializedRef.current) return;
    const rows = safeArray(messages);
    const count = rows.length;
    if (count > previousCountRef.current) {
      const latest = rows[count - 1];
      if (latest?.direction === 'outbound' || nearBottomRef.current) {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
        setShowScrollToLatest(false);
      } else {
        setShowScrollToLatest(true);
      }
    }
    previousCountRef.current = count;
  }, [conversationId, messages, messagesReady]);

  const handleScroll = () => {
    const container = messagesContainerRef.current;
    if (!container) return;
    nearBottomRef.current = container.scrollHeight - container.scrollTop - container.clientHeight < 140;
    if (nearBottomRef.current) setShowScrollToLatest(false);
  };

  const handleMediaLoad = useCallback(() => {
    if (isInitialLoadRef.current || nearBottomRef.current) settleAtBottom();
  }, [settleAtBottom]);

  const handleJumpToMessage = useCallback((messageId) => {
    const element = messageRefs.current.get(String(messageId));
    if (!element) return;
    element.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setHighlightedMessageId(String(messageId));
    window.setTimeout(() => setHighlightedMessageId((current) => (
      current === String(messageId) ? null : current
    )), 1800);
  }, []);

  const selected = Boolean(conversationId);

  return (
    <Box sx={{ position: 'relative', flex: 1, height: '100%', minHeight: 0, overflow: 'hidden' }}>
      <Box
        ref={messagesContainerRef}
        onScroll={handleScroll}
        sx={{
          height: '100%',
          overflowY: 'auto',
          p: { xs: 1.25, sm: 2.25 },
          bgcolor: '#efeae2',
          backgroundImage: 'radial-gradient(rgba(18,140,126,.055) 1px, transparent 1px)',
          backgroundSize: '18px 18px'
        }}
      >
      {!selected && (
        <Box sx={{ height: '100%', display: 'grid', placeItems: 'center', textAlign: 'center', px: 3 }}>
          <Box>
            <Avatar sx={{ width: 68, height: 68, mx: 'auto', mb: 2, bgcolor: '#dff5ed', color: '#128c7e' }}><WhatsAppIcon fontSize="large" /></Avatar>
            <Typography variant="h6" fontWeight={900} color="#25352f">Your conversations, one place</Typography>
            <Typography variant="body2" color="#607069">Select a contact from the inbox to view the conversation.</Typography>
          </Box>
        </Box>
      )}
      {selected && safeArray(messages).length === 0 && (
        <Box sx={{ textAlign: 'center', mt: 8 }}>
          <Chip label="No messages yet — say hello" sx={{ bgcolor: '#fff' }} />
        </Box>
      )}
      {selected && safeArray(messages).map((message) => (
        <Box
          key={message.id}
          ref={(node) => {
            if (node) messageRefs.current.set(String(message.id), node);
            else messageRefs.current.delete(String(message.id));
          }}
        >
          <MessageBubble
            message={message}
            onMediaLoad={handleMediaLoad}
            onReply={onReply || (() => {})}
            onJumpToMessage={handleJumpToMessage}
            highlighted={String(highlightedMessageId) === String(message.id)}
          />
        </Box>
      ))}
      <div ref={messagesEndRef} />
      </Box>
      {showScrollToLatest && (
        <Button
          size="small"
          variant="contained"
          startIcon={<KeyboardArrowDownIcon />}
          onClick={settleAtBottom}
          sx={{ position: 'absolute', left: '50%', bottom: 10, transform: 'translateX(-50%)', borderRadius: 4, textTransform: 'none', boxShadow: 3 }}
        >
          Scroll to latest
        </Button>
      )}
    </Box>
  );
}

export function MessageComposer({
  value,
  onChange,
  onSend,
  onAttach,
  onSaveTemplate,
  quickReplies,
  whatsappTemplates,
  selectedTemplate,
  onSelectTemplate,
  windowOpen,
  selected,
  sending,
  replyToMessage,
  onCancelReply
}) {
  const [emojiAnchor, setEmojiAnchor] = useState(null);
  const [templateAnchor, setTemplateAnchor] = useState(null);
  const slashQuery = value.startsWith('/') ? value.slice(1).trim().toLowerCase() : null;
  const matchingQuickReplies = slashQuery === null
    ? []
    : safeArray(quickReplies).filter((reply) => {
        const title = String(reply.title || reply.name || '').toLowerCase();
        const content = String(reply.body || reply.content || reply.text || '').toLowerCase();
        return title.includes(slashQuery) || content.includes(slashQuery);
      }).slice(0, 8);
  const emojis = ['😊', '👍', '🙏', '🎉', '❤️', '👋'];
  const handleKeyDown = (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      if (value.trim() && selected && !sending && (windowOpen || selectedTemplate)) onSend();
    }
  };

  return (
    <Box sx={{ px: { xs: 1, sm: 1.5 }, py: 1, borderTop: (theme) => `1px solid ${theme.palette.divider}`, bgcolor: 'background.paper' }}>
      {replyToMessage && (
        <Box sx={{ mb: 0.75, px: 1.25, py: 0.9, borderLeft: '3px solid #128c7e', bgcolor: 'rgba(18,140,126,.08)', borderRadius: 1.25 }}>
          <Stack direction="row" alignItems="center" spacing={1}>
            <ReplyOutlinedIcon sx={{ fontSize: 16, color: '#128c7e' }} />
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography sx={{ fontSize: 11, color: '#128c7e', fontWeight: 900 }} noWrap>
                Replying to {replyToMessage.direction === 'outbound' ? 'You' : 'Customer'}
              </Typography>
              <Typography sx={{ fontSize: 12, color: 'text.secondary' }} noWrap>
                {messageSummary(replyToMessage)}
              </Typography>
            </Box>
            <Tooltip title="Cancel reply">
              <IconButton size="small" onClick={onCancelReply}><CloseIcon sx={{ fontSize: 16 }} /></IconButton>
            </Tooltip>
          </Stack>
        </Box>
      )}
      <Stack direction="row" spacing={0.75} sx={{ mb: 0.75, overflowX: 'auto', pb: 0.25 }}>
        {safeArray(quickReplies).slice(0, 7).map((template) => (
          <Chip key={template.id} size="small" label={template.name} onClick={() => onChange(template.body)} sx={{ flexShrink: 0 }} />
        ))}
        {selectedTemplate && (
          <Chip
            size="small"
            color="success"
            label={`Template: ${selectedTemplate.name}`}
            onDelete={() => onSelectTemplate(null)}
            sx={{ flexShrink: 0 }}
          />
        )}
      </Stack>
      {!windowOpen && selected && (
        <Typography sx={{ mb: 0.75, px: 0.5, fontSize: 12, color: 'warning.dark', fontWeight: 700 }}>
          Template required to message this customer.
        </Typography>
      )}
      {slashQuery !== null && selected && (
        <Paper variant="outlined" sx={{ mb: 0.75, maxHeight: 230, overflowY: 'auto', borderRadius: 2 }}>
          {matchingQuickReplies.map((reply) => (
            <MenuItem key={reply.id} onClick={() => onChange(reply.body || reply.content || reply.text || '')}>
              <ListItemText
                primary={reply.title || reply.name || 'Quick reply'}
                secondary={reply.body || reply.content || reply.text || ''}
                secondaryTypographyProps={{ noWrap: true }}
              />
            </MenuItem>
          ))}
          {matchingQuickReplies.length === 0 && (
            <Typography variant="body2" color="text.secondary" sx={{ px: 2, py: 1.25 }}>
              No quick replies match “{slashQuery}”.
            </Typography>
          )}
        </Paper>
      )}
      <Stack direction="row" alignItems="flex-end" gap={0.4}>
        <Tooltip title="Attach media"><span><IconButton disabled={!selected} onClick={onAttach}><AttachFileIcon /></IconButton></span></Tooltip>
        <Button
          size="small"
          variant="outlined"
          disabled={!selected}
          onClick={(event) => setTemplateAnchor(event.currentTarget)}
          sx={{ mb: 0.35, minWidth: 86, borderRadius: 2.5, textTransform: 'none' }}
        >
          Templates
        </Button>
        <Menu anchorEl={templateAnchor} open={Boolean(templateAnchor)} onClose={() => setTemplateAnchor(null)}>
          {safeArray(whatsappTemplates).length === 0 && <MenuItem disabled>No approved templates</MenuItem>}
          {safeArray(whatsappTemplates).map((template) => (
            <MenuItem
              key={template.id}
              selected={selectedTemplate?.id === template.id}
              onClick={() => {
                onSelectTemplate(template);
                setTemplateAnchor(null);
              }}
            >
              <ListItemText
                primary={template.name}
                secondary={`${template.language || 'en_US'} • ${template.category || 'UTILITY'}`}
              />
            </MenuItem>
          ))}
        </Menu>
        <Tooltip title="Emoji"><IconButton onClick={(event) => setEmojiAnchor(event.currentTarget)}><EmojiEmotionsOutlinedIcon /></IconButton></Tooltip>
        <Menu anchorEl={emojiAnchor} open={Boolean(emojiAnchor)} onClose={() => setEmojiAnchor(null)}>
          <Stack direction="row" sx={{ px: 1 }}>
            {emojis.map((emoji) => <MenuItem key={emoji} onClick={() => { onChange(`${value}${emoji}`); setEmojiAnchor(null); }} sx={{ minWidth: 38, px: 0.75 }}>{emoji}</MenuItem>)}
          </Stack>
        </Menu>
        <TextField
          fullWidth
          multiline
          maxRows={5}
          value={value}
          disabled={!selected}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={!selected ? 'Select a conversation first' : (!windowOpen && !selectedTemplate ? 'Select an approved template' : 'Type a message')}
          sx={{ '& .MuiOutlinedInput-root': { borderRadius: 3, py: 0.5, bgcolor: 'action.hover' } }}
        />
        <Tooltip title="Save as quick reply"><span><IconButton disabled={!value.trim()} onClick={onSaveTemplate}><StarBorderRoundedIcon /></IconButton></span></Tooltip>
        <Tooltip title="Voice messages coming soon"><span><IconButton disabled><MicNoneOutlinedIcon /></IconButton></span></Tooltip>
        <Tooltip title="Send">
          <span>
            <IconButton
              color="primary"
              disabled={!selected || !value.trim() || sending || (!windowOpen && !selectedTemplate)}
              onClick={onSend}
              sx={{ bgcolor: 'primary.main', color: '#fff', '&:hover': { bgcolor: 'primary.dark' }, '&.Mui-disabled': { bgcolor: 'action.disabledBackground' } }}
            >
              {sending ? <CircularProgress size={20} color="inherit" /> : <SendRoundedIcon />}
            </IconButton>
          </span>
        </Tooltip>
      </Stack>
    </Box>
  );
}

export function ChatArea({
  conversation,
  messages,
  messagesReady,
  quickReplies,
  whatsappTemplates,
  selectedTemplate,
  onSelectTemplate,
  windowOpen,
  composerValue,
  onComposerChange,
  onSend,
  onAttach,
  onDropFile,
  onSaveTemplate,
  onBack,
  onToggleWorkspace,
  onEdit,
  onStatusChange,
  replyToMessage,
  onReply,
  onCancelReply,
  mobile,
  sending
}) {
  const dragDepthRef = useRef(0);
  const [dragActive, setDragActive] = useState(false);

  const handleDragEnter = (event) => {
    event.preventDefault();
    if (!conversation) return;
    dragDepthRef.current += 1;
    setDragActive(true);
  };
  const handleDragLeave = (event) => {
    event.preventDefault();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setDragActive(false);
  };
  const handleDrop = (event) => {
    event.preventDefault();
    dragDepthRef.current = 0;
    setDragActive(false);
    if (!conversation) return;
    const file = event.dataTransfer.files?.[0];
    if (file) onDropFile(file);
  };

  return (
    <Box
      onDragEnter={handleDragEnter}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      sx={{ position: 'relative', width: '100%', minWidth: 0, display: 'flex', flexDirection: 'column', bgcolor: 'background.paper' }}
    >
      {conversation && (
        <>
          <ChatHeader conversation={conversation} onBack={onBack} onToggleWorkspace={onToggleWorkspace} onEdit={onEdit} onStatusChange={onStatusChange} mobile={mobile} />
          <CustomerInfoBar conversation={conversation} />
        </>
      )}
      <MessageList messages={messages} conversationId={conversation?.id} messagesReady={messagesReady} onReply={onReply} />
      <MessageComposer
        value={composerValue}
        onChange={onComposerChange}
        onSend={onSend}
        onAttach={onAttach}
        onSaveTemplate={onSaveTemplate}
        quickReplies={quickReplies}
        whatsappTemplates={whatsappTemplates}
        selectedTemplate={selectedTemplate}
        onSelectTemplate={onSelectTemplate}
        windowOpen={windowOpen}
        selected={Boolean(conversation)}
        sending={sending}
        replyToMessage={replyToMessage}
        onCancelReply={onCancelReply}
      />
      {dragActive && (
        <Box
          sx={{
            position: 'absolute',
            inset: 10,
            zIndex: 20,
            display: 'grid',
            placeItems: 'center',
            border: '2px dashed',
            borderColor: 'primary.main',
            borderRadius: 3,
            bgcolor: 'rgba(232, 249, 243, .94)',
            pointerEvents: 'none'
          }}
        >
          <Stack alignItems="center" spacing={0.75}>
            <AttachFileIcon color="primary" />
            <Typography fontWeight={900} color="primary.main">Drop media to send</Typography>
            <Typography variant="caption" color="text.secondary">Images, video, audio, and documents</Typography>
          </Stack>
        </Box>
      )}
    </Box>
  );
}
