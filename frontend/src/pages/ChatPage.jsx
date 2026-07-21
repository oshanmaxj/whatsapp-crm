import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Box, Drawer, Snackbar, useMediaQuery } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { useNavigate, useOutletContext, useSearchParams } from 'react-router-dom';
import {
  assignConversation,
  createNote,
  getAssignableUsers,
  createTemplate,
  downloadMedia,
  getConversation,
  getConversationMessages,
  getConversations,
  getMedia,
  getNotes,
  getTemplates,
  getLabels,
  getTemplateDiagnostics,
  getUnreadCount,
  sendConversationMessage,
  sendConversationInteractive,
  sendConversationTemplate,
  setConversationLabels,
  updateConversation,
  uploadMedia
} from '../services/chat.service';
import { getRoles } from '../services/userManagement.service';
import { updateContact } from '../services/contact.service';
import { updateLeadStatus } from '../services/lead.service';
import { listWhatsAppTemplates } from '../services/whatsappTemplate.service';
import { markMessageAsPaymentSlip } from '../services/paymentSlip.service';
import {
  ChatArea,
  ChatLayout,
  ConversationList,
  WorkspacePanel,
  safeArray
} from '../components/chat';

function useDebouncedValue(value, delay = 250) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timeout = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(timeout);
  }, [value, delay]);
  return debounced;
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

const MEDIA_ACCEPT = [
  '.jpg', '.jpeg', '.png', '.webp',
  '.mp4', '.3gp',
  '.mp3', '.ogg', '.amr', '.m4a',
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.txt', '.csv'
].join(',');
const selectedConversationStorageKey = 'crmSelectedConversationId';

function inferMediaType(file) {
  const extension = `.${String(file.name || '').split('.').pop().toLowerCase()}`;
  if (['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || ['.jpg', '.jpeg', '.png', '.webp'].includes(extension)) return 'image';
  if (['video/mp4', 'video/3gpp'].includes(file.type) || ['.mp4', '.3gp'].includes(extension)) return 'video';
  if (['audio/mpeg', 'audio/ogg', 'audio/amr', 'audio/mp4', 'audio/m4a', 'audio/webm'].includes(file.type) || ['.mp3', '.ogg', '.amr', '.m4a', '.webm'].includes(extension)) return 'audio';
  if (['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.txt', '.csv'].includes(extension)) return 'document';
  return null;
}

function isMessagingWindowOpen(conversation, now = Date.now()) {
  const value = conversation?.lastInboundAt || conversation?.last_inbound_at;
  const lastInboundTime = value ? new Date(value).getTime() : Number.NaN;
  return Number.isFinite(lastInboundTime)
    && lastInboundTime + (24 * 60 * 60 * 1000) > now;
}

function ChatPage() {
  const { socket, connected } = useOutletContext() || {};
  const theme = useTheme();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const compactLayout = useMediaQuery(theme.breakpoints.down('lg'));
  const inlineWorkspace = useMediaQuery(theme.breakpoints.up('xl'));
  const fileInputRef = useRef(null);
  const selectedRef = useRef(null);
  const seenSocketMessageIdsRef = useRef(new Set());

  const [conversations, setConversations] = useState([]);
  const [agents, setAgents] = useState([]);
  const [roles, setRoles] = useState([]);
  const [selected, setSelected] = useState(() => searchParams.get('conversationId') || null);
  const [conversation, setConversation] = useState(null);
  const [messages, setMessages] = useState([]);
  const [media, setMedia] = useState([]);
  const [notes, setNotes] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [labels, setLabels] = useState([]);
  const [whatsappTemplates, setWhatsAppTemplates] = useState([]);
  const [selectedTemplate, setSelectedTemplate] = useState(null);
  const [templateDiagnostics, setTemplateDiagnostics] = useState(null);
  const [replyToMessage, setReplyToMessage] = useState(null);
  const [windowNow, setWindowNow] = useState(() => Date.now());
  const [newMessage, setNewMessage] = useState('');
  const [noteText, setNoteText] = useState('');
  const [filters, setFilters] = useState({ search: '', assignedUserId: '', assignedRoleId: '', mine: '', status: '', leadStatus: '', unread: '', whatsappAccountId: '' });
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [leadStatusSaving, setLeadStatusSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const debouncedSearch = useDebouncedValue(filters.search);
  const queryFilters = useMemo(() => ({
    search: debouncedSearch || undefined,
    assignedUserId: filters.assignedUserId || undefined,
    assignedRoleId: filters.assignedRoleId || undefined,
    mine: filters.mine || undefined,
    status: filters.status || undefined,
    unread: filters.unread || undefined,
    leadStatus: filters.leadStatus || undefined
    , whatsappAccountId: filters.whatsappAccountId || undefined
  }), [debouncedSearch, filters.assignedUserId, filters.assignedRoleId, filters.mine, filters.status, filters.leadStatus, filters.unread, filters.whatsappAccountId]);

  const selectedConversation = conversation
    || safeArray(conversations).find((item) => String(item.id) === String(selected))
    || null;
  const windowOpen = isMessagingWindowOpen(selectedConversation, windowNow);

  const handleMarkPaymentSlip = async (message, alreadyDetected) => {
    if (alreadyDetected && message.paymentSlip?.id) {
      navigate(`/payment-verification?slipId=${message.paymentSlip.id}`);
      return;
    }
    try {
      const slip = (await markMessageAsPaymentSlip(message.id)).data?.data;
      setMessages((current) => current.map((item) => String(item.id) === String(message.id)
        ? { ...item, paymentSlip: { id: slip.id, verificationStatus: slip.verificationStatus, detectionConfidence: slip.detectionConfidence } }
        : item));
      setNotice('Message added to the finance payment verification queue.');
    } catch (err) {
      setError(err.response?.data?.message || 'Unable to mark this message as a payment slip.');
    }
  };

  useEffect(() => {
    const interval = window.setInterval(() => setWindowNow(Date.now()), 60000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!conversation?.whatsappAccountId) return;
    listWhatsAppTemplates({ status: 'APPROVED', whatsappAccountId: conversation.whatsappAccountId })
      .then((response) => setWhatsAppTemplates(safeArray(response.data?.data)))
      .catch(() => {});
  }, [conversation?.whatsappAccountId]);
  useEffect(() => {
    if (!selected || !selectedTemplate) { setTemplateDiagnostics(null); return; }
    getTemplateDiagnostics(selected, { templateName: selectedTemplate.name, languageCode: selectedTemplate.language || 'en_US' })
      .then((response) => setTemplateDiagnostics(response.data.data || null)).catch(() => setTemplateDiagnostics(null));
  }, [selected, selectedTemplate]);

  useEffect(() => {
    selectedRef.current = selected;
    if (selected) {
      localStorage.setItem(selectedConversationStorageKey, String(selected));
    } else {
      localStorage.removeItem(selectedConversationStorageKey);
    }
  }, [selected]);

  useEffect(() => {
    setWorkspaceOpen(inlineWorkspace);
  }, [inlineWorkspace]);

  const loadConversations = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    try {
      const response = await getConversations(queryFilters);
      setConversations(safeArray(response.data?.data));
    } catch (requestError) {
      if (!silent) setError(requestError.response?.data?.message || 'Unable to load conversations.');
    } finally {
      if (!silent) setLoading(false);
    }
  }, [queryFilters]);

  const loadDetails = useCallback(async (conversationId, { silent = false } = {}) => {
    if (!conversationId) return;
    try {
      const [conversationResponse, messageResponse, mediaResponse, noteResponse] = await Promise.all([
        getConversation(conversationId),
        getConversationMessages(conversationId),
        getMedia(conversationId),
        getNotes(conversationId)
      ]);
      if (String(selectedRef.current) !== String(conversationId)) return;
      setConversation(conversationResponse.data?.data || null);
      setMessages(safeArray(messageResponse.data?.data));
      setMedia(safeArray(mediaResponse.data?.data));
      setNotes(safeArray(noteResponse.data?.data));
    } catch (requestError) {
      if (!silent) setError(requestError.response?.data?.message || 'Unable to load conversation details.');
    }
  }, []);

  const refreshUnread = useCallback(() => {
    getUnreadCount()
      .then((response) => setUnread(response.data?.data?.unread || 0))
      .catch(() => {});
  }, []);

  const applyInteractionMessage = useCallback((currentConversation, message) => {
    if (!currentConversation || String(currentConversation.id) !== String(message.conversationId)) return currentConversation;
    const currentRate = currentConversation.interactionRate || {};
    const internal = message.isInternalNotification || message.is_internal_notification;
    const successfulOutbound = message.direction === 'outbound' && message.status !== 'failed' && !internal;
    const inbound = message.direction === 'inbound' || message.status === 'received';
    if (!successfulOutbound && !inbound) return currentConversation;
    const messagesSent = Number(currentRate.messagesSent || 0) + (successfulOutbound ? 1 : 0);
    const repliesReceived = Number(currentRate.repliesReceived || 0) + (inbound ? 1 : 0);
    const precisePercentage = messagesSent > 0 ? (repliesReceived / messagesSent) * 100 : 0;
    return {
      ...currentConversation,
      interactionRate: {
        messagesSent,
        repliesReceived,
        percentage: Math.round(precisePercentage),
        precisePercentage: Math.round(precisePercentage * 10) / 10
      }
    };
  }, []);

  useEffect(() => {
    loadConversations();
  }, [loadConversations]);

  useEffect(() => {
    Promise.allSettled([
      getAssignableUsers({ includeAll: true }).then((response) => setAgents(safeArray(response.data?.data))),
      getRoles().then((response) => setRoles(safeArray(response.data?.data))),
      getTemplates().then((response) => setTemplates(safeArray(response.data?.data))),
      getLabels().then((response) => setLabels(safeArray(response.data?.data))),
      listWhatsAppTemplates({ status: 'APPROVED' }).then((response) => setWhatsAppTemplates(safeArray(response.data?.data))),
      getUnreadCount().then((response) => setUnread(response.data?.data?.unread || 0))
    ]);
  }, []);

  useEffect(() => {
    if (!selected) {
      setConversation(null);
      setMessages([]);
      setMedia([]);
      setNotes([]);
      setReplyToMessage(null);
      return;
    }
    loadDetails(selected);
  }, [selected, loadDetails]);

  useEffect(() => {
    if (!socket) return undefined;

    const handleNewMessage = (payload) => {
      if (!payload || typeof payload !== 'object' || payload.conversationId == null) return;
      const incoming = {
        contactId: null,
        leadId: null,
        mediaUrl: null,
        text: null,
        type: 'text',
        direction: 'inbound',
        ...payload
      };
      if (incoming.id != null) {
        const messageId = String(incoming.id);
        if (seenSocketMessageIdsRef.current.has(messageId)) return;
        seenSocketMessageIdsRef.current.add(messageId);
      }

      if (String(incoming.conversationId) === String(selectedRef.current)) {
        setMessages((current) => {
          const rows = safeArray(current);
          if (incoming.id != null && rows.some((item) => String(item.id) === String(incoming.id))) return rows;
          return [...rows, incoming];
        });
        if (incoming.direction === 'inbound' || incoming.status === 'received') {
          setConversation((current) => current
            ? { ...current, lastInboundAt: incoming.createdAt || new Date().toISOString() }
            : current);
        }
        setConversation((current) => applyInteractionMessage(current, incoming));
      }
      setConversations((current) => {
        const updated = safeArray(current).map((item) => (
          String(item.id) === String(incoming.conversationId)
            ? {
                ...item,
                lastMessage: incoming,
                lastMessageAt: incoming.createdAt || new Date().toISOString(),
                lastInboundAt: incoming.direction === 'inbound' || incoming.status === 'received'
                  ? incoming.createdAt || new Date().toISOString()
                  : item.lastInboundAt,
                interactionRate: applyInteractionMessage(item, incoming).interactionRate
              }
            : item
        ));
        return updated.sort((a, b) => new Date(b.lastMessageAt || 0) - new Date(a.lastMessageAt || 0));
      });
      loadConversations({ silent: true });
      refreshUnread();
    };

    const handleStatusUpdate = (update) => {
      if (!update || update.messageId == null) return;
      setMessages((current) => safeArray(current).map((message) => (
        String(message.id) === String(update.messageId)
          || (update.whatsappMessageId && String(message.whatsappMessageId) === String(update.whatsappMessageId))
          ? {
              ...message,
              status: update.status,
              statusUpdatedAt: update.timestamp,
              errorCode: update.status === 'failed' ? (update.errorCode ?? message.errorCode) : null,
              errorMessage: update.status === 'failed' ? (update.errorMessage ?? message.errorMessage) : null
            }
          : message
      )));
      setConversations((current) => safeArray(current).map((item) => (
        item.lastMessage && (
          String(item.lastMessage.id) === String(update.messageId)
          || (update.whatsappMessageId && String(item.lastMessage.whatsappMessageId) === String(update.whatsappMessageId))
        )
          ? { ...item, lastMessage: { ...item.lastMessage, status: update.status } }
          : item
      )));
      if (update.status) {
        if (selectedRef.current) loadDetails(selectedRef.current, { silent: true });
        loadConversations({ silent: true });
      }
    };

    const handleSocketError = ({ message } = {}) => setError(message || 'Unable to send WhatsApp message.');
    const applyLeadUpdate = (payload = {}) => {
      if (payload.leadId == null && payload.conversationId == null) return;
      const owner = payload.ownerId == null
        ? null
        : agents.find((agent) => String(agent.id) === String(payload.ownerId)) || null;
      const matches = (item) => String(item?.lead?.id ?? '') === String(payload.leadId ?? '')
        || String(item?.id ?? '') === String(payload.conversationId ?? '')
        || safeArray(payload.conversationIds).some((id) => String(id) === String(item?.id));
      const patchConversation = (item) => !item || !matches(item) ? item : {
        ...item,
        ...(Object.prototype.hasOwnProperty.call(payload, 'ownerId') ? {
          assignedUserId: payload.ownerId,
          assigned_user_id: payload.ownerId,
          assignedTo: payload.ownerId,
          assignedUser: owner,
          assignee: owner
        } : {}),
        lead: item.lead ? {
          ...item.lead,
          ...(payload.statusCode ? {
            statusId: payload.statusId,
            stage: payload.statusCode,
            status: payload.status || { ...item.lead.status, id: payload.statusId, code: payload.statusCode }
          } : {}),
          ...(Object.prototype.hasOwnProperty.call(payload, 'ownerId') ? { ownerId: payload.ownerId, owner } : {}),
          updatedAt: payload.updatedAt || item.lead.updatedAt
        } : item.lead
      };
      setConversation((current) => patchConversation(current));
      setConversations((current) => safeArray(current).map(patchConversation));
    };
    const handleLeadStatusUpdate = applyLeadUpdate;
    const handleConversationMerged = (payload = {}) => {
      const mergedIds = new Set(safeArray(payload.mergedConversationIds).map(String));
      if (!payload.canonicalConversationId || mergedIds.size === 0) return;
      setConversations((current) => safeArray(current).filter((item) => !mergedIds.has(String(item.id))));
      if (mergedIds.has(String(selectedRef.current))) {
        setSelected(String(payload.canonicalConversationId));
      }
      loadConversations({ silent: true });
    };
    socket.on('chat:message', handleNewMessage);
    socket.on('whatsapp.message.received', handleNewMessage);
    socket.on('message_status_updated', handleStatusUpdate);
    socket.on('chat:error', handleSocketError);
    socket.on('lead:status-updated', handleLeadStatusUpdate);
    socket.on('lead.updated', applyLeadUpdate);
    socket.on('lead.status.changed', applyLeadUpdate);
    socket.on('lead.agent.changed', applyLeadUpdate);
    socket.on('conversation.merged', handleConversationMerged);
    return () => {
      socket.off('chat:message', handleNewMessage);
      socket.off('whatsapp.message.received', handleNewMessage);
      socket.off('message_status_updated', handleStatusUpdate);
      socket.off('chat:error', handleSocketError);
      socket.off('lead:status-updated', handleLeadStatusUpdate);
      socket.off('lead.updated', applyLeadUpdate);
      socket.off('lead.status.changed', applyLeadUpdate);
      socket.off('lead.agent.changed', applyLeadUpdate);
      socket.off('conversation.merged', handleConversationMerged);
    };
  }, [socket, loadConversations, loadDetails, refreshUnread, applyInteractionMessage, agents]);

  useEffect(() => {
    if (!socket || !connected || !selected) return;
    socket.emit('chat:join', { conversationId: selected });
    socket.emit('chat:markRead', { conversationId: selected });
  }, [socket, connected, selected]);

  useEffect(() => {
    if (connected) return undefined;
    const interval = window.setInterval(() => {
      loadConversations({ silent: true });
      refreshUnread();
    }, 30000);
    return () => window.clearInterval(interval);
  }, [connected, loadConversations, refreshUnread]);

  useEffect(() => {
    if (!selected) return undefined;
    const interval = window.setInterval(() => {
      getConversationMessages(selected)
        .then((response) => {
          if (String(selectedRef.current) === String(selected)) {
            setMessages(safeArray(response.data?.data));
          }
        })
        .catch(() => {});
    }, 30000);
    return () => window.clearInterval(interval);
  }, [selected]);

  const handleSelectConversation = useCallback((conversationId) => {
    setConversation(null);
    setMessages([]);
    setMedia([]);
    setNotes([]);
    setSelectedTemplate(null);
    setReplyToMessage(null);
    setNewMessage('');
    setSelected(conversationId);
  }, []);

  const handleBack = useCallback(() => {
    setSelected(null);
    setSelectedTemplate(null);
    setReplyToMessage(null);
    setWorkspaceOpen(false);
  }, []);

  const handleSendMessage = useCallback(async () => {
    const text = newMessage.trim();
    if (!text || !selected || sending) return;
    if (!selectedTemplate && !isMessagingWindowOpen(selectedConversation)) {
      setNotice('Template required to message this customer.');
      return;
    }
    const optimisticId = `pending-${Date.now()}`;
    const optimisticMessage = {
      id: optimisticId,
      conversationId: selected,
      direction: 'outbound',
      type: selectedTemplate ? 'template' : 'text',
      text,
      templateName: selectedTemplate?.name || null,
      replyToMessageId: replyToMessage?.id || null,
      replyPreview: replyToMessage ? {
        id: replyToMessage.id,
        whatsappMessageId: replyToMessage.whatsappMessageId,
        sender: replyToMessage.direction === 'outbound' ? 'You' : 'Customer',
        direction: replyToMessage.direction,
        type: replyToMessage.type,
        text: replyToMessage.text || replyToMessage.templateName || replyToMessage.type
      } : null,
      status: 'pending',
      statusUpdatedAt: new Date().toISOString(),
      createdAt: new Date().toISOString()
    };
    setMessages((current) => [...safeArray(current), optimisticMessage]);
    setNewMessage('');
    setSending(true);
    setError('');

    try {
      const response = selectedTemplate
        ? await sendConversationTemplate(selected, {
            templateName: selectedTemplate.name,
            languageCode: selectedTemplate.language || 'en_US',
            components: [],
            replyToMessageId: replyToMessage?.id || null
          })
        : await sendConversationMessage(selected, { text, replyToMessageId: replyToMessage?.id || null });
      const sentMessage = response.data?.data;
      if (!sentMessage || typeof sentMessage !== 'object') throw new Error('The server returned an invalid message response.');
      if (sentMessage.id != null) seenSocketMessageIdsRef.current.add(String(sentMessage.id));
      setMessages((current) => {
        const withoutOptimistic = safeArray(current).filter((item) => item.id !== optimisticId);
        if (sentMessage.id != null && withoutOptimistic.some((item) => String(item.id) === String(sentMessage.id))) return withoutOptimistic;
        return [...withoutOptimistic, sentMessage];
      });
      setConversation((current) => applyInteractionMessage(current, sentMessage));
      setConversations((current) => safeArray(current).map((item) => (
        String(item.id) === String(selected)
          ? {
              ...applyInteractionMessage(item, sentMessage),
              lastMessage: sentMessage,
              lastMessageAt: sentMessage.createdAt || new Date().toISOString()
            }
          : item
      )));
      setSelectedTemplate(null);
      setReplyToMessage(null);
      loadConversations({ silent: true });
    } catch (requestError) {
      const message = requestError.response?.data?.message || requestError.message || 'Unable to send WhatsApp message.';
      const failedRecord = requestError.response?.data?.data;
      const metaError = requestError.response?.data?.metaError?.error || requestError.response?.data?.metaError || {};
      setMessages((current) => safeArray(current).map((item) => (
        item.id === optimisticId
          ? {
              ...item,
              ...(failedRecord && typeof failedRecord === 'object' ? failedRecord : {}),
              status: 'failed',
              statusUpdatedAt: failedRecord?.statusUpdatedAt || new Date().toISOString(),
              errorCode: failedRecord?.errorCode || (metaError.code == null ? null : String(metaError.code)),
              errorMessage: failedRecord?.errorMessage || metaError.error_user_msg || metaError.message || message
            }
          : item
      )));
      setError(`Message send failed: ${message}`);
    } finally {
      setSending(false);
    }
  }, [newMessage, selected, sending, selectedTemplate, selectedConversation, replyToMessage, loadConversations, applyInteractionMessage]);

  const handleAssign = useCallback(async (assignment) => {
    if (!selected) return;
    try {
      const response = await assignConversation(selected, assignment);
      const updated = response.data?.data;
      if (updated) {
        setConversation(updated);
        setConversations((current) => safeArray(current).map((item) => String(item.id) === String(updated.id) ? updated : item));
      }
      setNotice('Agent assignment updated.');
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Unable to assign this conversation.');
    }
  }, [selected, loadDetails, loadConversations]);

  const handleStatus = useCallback(async (status) => {
    if (!selected) return;
    try {
      await updateConversation(selected, { status });
      await Promise.all([loadDetails(selected), loadConversations({ silent: true })]);
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Unable to update conversation status.');
    }
  }, [selected, loadDetails, loadConversations]);

  const handleLeadStatus = useCallback(async (statusCode) => {
    const lead = selectedConversation?.lead;
    if (!lead?.id) return;
    try {
      setLeadStatusSaving(true);
      const response = await updateLeadStatus(lead.id, { statusCode, expectedCurrentStatusCode: lead.status?.code || lead.stage, source: 'chat_workspace' });
      const updatedStatus = response.data?.data?.status;
      const patch = (item) => item?.lead && String(item.lead.id) === String(lead.id)
        ? { ...item, lead: { ...item.lead, statusId: updatedStatus?.id, stage: statusCode, status: updatedStatus } }
        : item;
      setConversation((current) => patch(current));
      setConversations((current) => safeArray(current).map(patch));
      setNotice('Lead status updated.');
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Unable to update lead status.');
    } finally { setLeadStatusSaving(false); }
  }, [selected, selectedConversation, loadDetails, loadConversations]);

  const handleAddNote = useCallback(async (type = 'private') => {
    if (!selected || !noteText.trim()) return;
    try {
      await createNote({ conversationId: selected, type, note: noteText.trim() });
      setNoteText('');
      const response = await getNotes(selected);
      setNotes(safeArray(response.data?.data));
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Unable to add note.');
    }
  }, [selected, noteText]);

  const handleSetLabels = useCallback(async (labelIds) => {
    if (!selected) return;
    try {
      const response = await setConversationLabels(selected, labelIds.map((id) => ({ id })));
      const updated = response.data.data;
      setConversation(updated);
      setConversations((rows) => safeArray(rows).map((row) => String(row.id) === String(updated.id) ? updated : row));
    } catch (requestError) { setError(requestError.response?.data?.message || 'Unable to update labels.'); }
  }, [selected]);

  const sendAttachment = useCallback(async (file, onProgress = () => {}) => {
    if (!file || !selected) return;
    const mediaType = inferMediaType(file);
    if (!mediaType) {
      setError('Unsupported attachment type.');
      return;
    }
    const previewUrl = window.URL.createObjectURL(file);
    const optimisticId = `media-${Date.now()}`;
    setMessages((current) => [
      ...safeArray(current),
      {
        id: optimisticId,
        conversationId: selected,
        direction: 'outbound',
        type: mediaType,
        text: newMessage || file.name,
        mediaUrl: previewUrl,
        status: 'pending',
        createdAt: new Date().toISOString(),
        rawPayload: { fileName: file.name },
        replyToMessageId: replyToMessage?.id || null,
        replyPreview: replyToMessage ? {
          id: replyToMessage.id,
          whatsappMessageId: replyToMessage.whatsappMessageId,
          sender: replyToMessage.direction === 'outbound' ? 'You' : 'Customer',
          direction: replyToMessage.direction,
          type: replyToMessage.type,
          text: replyToMessage.text || replyToMessage.templateName || replyToMessage.type
        } : null
      }
    ]);
    try {
      const dataBase64 = await fileToBase64(file);
      const response = await uploadMedia({
        conversationId: selected,
        fileName: file.name,
        mimeType: file.type || 'application/octet-stream',
        mediaType,
        dataBase64,
        caption: newMessage || file.name,
        replyToMessageId: replyToMessage?.id || null
      }, (event) => onProgress(event.total ? Math.min(95, Math.round((event.loaded * 95) / event.total)) : 50));
      onProgress(100);
      const sentMessage = response.data?.data?.message;
      if (sentMessage?.id != null) {
        seenSocketMessageIdsRef.current.add(String(sentMessage.id));
        setMessages((current) => {
          const withoutOptimistic = safeArray(current).filter((item) => item.id !== optimisticId);
          return withoutOptimistic.some((item) => String(item.id) === String(sentMessage.id))
            ? withoutOptimistic
            : [...withoutOptimistic, sentMessage];
        });
      }
      setNewMessage('');
      setReplyToMessage(null);
      await Promise.all([loadDetails(selected), loadConversations({ silent: true })]);
    } catch (requestError) {
      setMessages((current) => safeArray(current).filter((item) => item.id !== optimisticId));
      setError(requestError.response?.data?.message || 'Unable to send media.');
    } finally {
      window.URL.revokeObjectURL(previewUrl);
    }
  }, [selected, newMessage, replyToMessage, loadDetails, loadConversations]);

  const handleSendInteractive = useCallback(async (payload, setProgress = () => {}) => {
    if (!selected) return;
    setSending(true);
    try {
      const response = await sendConversationInteractive(selected, payload, (event) => {
        setProgress(event.total ? Math.min(90, Math.round((event.loaded * 90) / event.total)) : 45);
      });
      setProgress(100);
      const sentMessage = response.data?.data;
      if (sentMessage?.id != null) {
        seenSocketMessageIdsRef.current.add(String(sentMessage.id));
        setMessages((current) => safeArray(current).some((item) => String(item.id) === String(sentMessage.id)) ? current : [...safeArray(current), sentMessage]);
      }
      await Promise.all([loadDetails(selected), loadConversations({ silent: true })]);
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Unable to send interactive message.');
      throw requestError;
    } finally { setSending(false); }
  }, [selected, loadDetails, loadConversations]);

  const handleFileUpload = useCallback(async (event) => {
    const file = event.target.files?.[0];
    await sendAttachment(file);
    event.target.value = '';
  }, [sendAttachment]);

  const handleUpdateContact = useCallback(async (payload) => {
    const contactId = selectedConversation?.contact?.id;
    if (!contactId || !selected) return;
    try {
      await updateContact(contactId, payload);
      await Promise.all([loadDetails(selected), loadConversations({ silent: true })]);
      setNotice('Contact profile updated.');
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Unable to update contact profile.');
      throw requestError;
    }
  }, [selectedConversation, selected, loadDetails, loadConversations]);

  const handleDownload = useCallback(async (item) => {
    try {
      const response = await downloadMedia(item.id);
      const blobUrl = window.URL.createObjectURL(response.data);
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = item.originalName || item.fileName || 'media';
      link.click();
      window.URL.revokeObjectURL(blobUrl);
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Unable to download media.');
    }
  }, []);

  const handleSaveTemplate = useCallback(async () => {
    if (!newMessage.trim()) return;
    try {
      await createTemplate({ name: newMessage.slice(0, 40), category: 'saved_reply', body: newMessage });
      const response = await getTemplates();
      setTemplates(safeArray(response.data?.data));
      setNotice('Quick reply saved.');
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Unable to save quick reply.');
    }
  }, [newMessage]);

  const handleWorkspaceAction = useCallback((action) => {
    if (action === 'Create appointment') {
      const contact = selectedConversation?.contact || {};
      navigate('/appointments', {
        state: {
          openCreate: true,
          contact,
          selectedContact: contact,
          conversation: selectedConversation,
          selectedConversation
        }
      });
      return;
    }
    if (action === 'Convert to student') {
      const contact = selectedConversation?.contact || {};
      const lead = selectedConversation?.lead || null;
      navigate('/students', {
        state: {
          openCreate: true,
          source: 'chat',
          contact,
          selectedContact: contact,
          conversation: selectedConversation,
          selectedConversation,
          lead
        }
      });
      return;
    }
    if (action === 'Create follow-up') {
      setNoteText('Follow up: ');
      setNotice('Add the follow-up details in the Notes tab.');
      return;
    }
    if (action === 'Assign agent') {
      setNotice('Choose an agent from the Profile tab.');
      return;
    }
    setNotice(`${action} is ready for a future automation integration.`);
  }, [navigate, selectedConversation]);

  const workspace = (
    <WorkspacePanel
      conversation={selectedConversation}
      agents={agents}
      roles={roles}
      notes={notes}
      media={media}
      labels={labels}
      onLabelsChange={handleSetLabels}
      onLabelOptionsChange={setLabels}
      noteText={noteText}
      onNoteTextChange={setNoteText}
      onAddNote={handleAddNote}
      onAssign={handleAssign}
      onUpdateContact={handleUpdateContact}
      onDownload={handleDownload}
      onAction={handleWorkspaceAction}
      onLeadStatusChange={handleLeadStatus}
      leadStatusSaving={leadStatusSaving}
      onClose={() => setWorkspaceOpen(false)}
      showClose={!inlineWorkspace}
    />
  );

  return (
    <Box sx={{ mx: { xs: -2, md: -1 }, mt: { xs: -2, md: -1 } }}>
      <input ref={fileInputRef} type="file" hidden onChange={handleFileUpload} accept={MEDIA_ACCEPT} />
      <ChatLayout
        showConversationList={!compactLayout || !selected}
        showChat={!compactLayout || Boolean(selected)}
        showWorkspace={inlineWorkspace && workspaceOpen}
        conversationList={(
          <ConversationList
            conversations={conversations}
            selectedId={selected}
            onSelect={handleSelectConversation}
            filters={filters}
            onFiltersChange={setFilters}
            agents={agents}
            roles={roles}
            unread={unread}
            connected={connected}
            loading={loading}
            onRefresh={() => {
              loadConversations();
              refreshUnread();
            }}
          />
        )}
        chat={(
          <ChatArea
            conversation={selectedConversation}
            messages={messages}
            messagesReady={Boolean(conversation)}
            quickReplies={templates}
            whatsappTemplates={whatsappTemplates}
            selectedTemplate={selectedTemplate}
            templateDiagnostics={templateDiagnostics}
            onSelectTemplate={(template) => {
              setSelectedTemplate(template);
              setNewMessage(template?.body || '');
            }}
            windowOpen={windowOpen}
            composerValue={newMessage}
            onComposerChange={(value) => {
              setSelectedTemplate(null);
              setNewMessage(value);
            }}
            onSend={handleSendMessage}
            onSendInteractive={handleSendInteractive}
            onAttach={() => fileInputRef.current?.click()}
            onSendVoice={sendAttachment}
            onDropFile={sendAttachment}
            onSaveTemplate={handleSaveTemplate}
            onBack={handleBack}
            onToggleWorkspace={() => setWorkspaceOpen((value) => !value)}
            onEdit={() => setWorkspaceOpen(true)}
            onStatusChange={handleStatus}
            replyToMessage={replyToMessage}
            onReply={(message) => setReplyToMessage(message)}
            onMarkPaymentSlip={handleMarkPaymentSlip}
            onCancelReply={() => setReplyToMessage(null)}
            mobile={compactLayout}
            sending={sending}
          />
        )}
        workspace={inlineWorkspace ? workspace : null}
      />

      {!inlineWorkspace && (
        <Drawer
          anchor="right"
          open={workspaceOpen && Boolean(selectedConversation)}
          onClose={() => setWorkspaceOpen(false)}
          PaperProps={{ sx: { width: { xs: '100%', sm: 380 }, maxWidth: '100vw' } }}
        >
          {workspace}
        </Drawer>
      )}

      <Snackbar open={Boolean(error)} autoHideDuration={6500} onClose={() => setError('')} anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}>
        <Alert severity="error" variant="filled" onClose={() => setError('')}>{error}</Alert>
      </Snackbar>
      <Snackbar open={Boolean(notice)} autoHideDuration={3500} onClose={() => setNotice('')} message={notice} />
    </Box>
  );
}

export default ChatPage;
