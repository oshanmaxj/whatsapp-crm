import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import ReactFlow, {
  addEdge, Background, Controls, Handle, MiniMap, Position, ReactFlowProvider,
  useEdgesState, useNodesState
} from 'reactflow';
import 'reactflow/dist/style.css';
import {
  Alert, Box, Button, Chip, Divider, IconButton, MenuItem, Paper, Stack, TextField,
  Tooltip, Typography
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import SaveIcon from '@mui/icons-material/Save';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import RocketLaunchIcon from '@mui/icons-material/RocketLaunch';
import SearchIcon from '@mui/icons-material/Search';
import ZoomInIcon from '@mui/icons-material/ZoomIn';
import ZoomOutIcon from '@mui/icons-material/ZoomOut';
import ZoomOutMapIcon from '@mui/icons-material/ZoomOutMap';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import WarningAmberRoundedIcon from '@mui/icons-material/WarningAmberRounded';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import {
  getFlow, getFlowActionOptions, publishFlow, saveFlowBuilder, testFlow, unpublishFlow
} from '../services/flowBuilder.service';
import { getRoles, getUsers } from '../services/userManagement.service';
import FlowNodeConfigDialog from '../components/flow-builder/FlowNodeConfigDialog';
import { nodeConfigErrors, normalizeKeywords } from '../components/flow-builder/flowBuilderConfig';
import WhatsAppAccountSelect from '../components/WhatsAppAccountSelect';

const GROUPS = [
  { title: 'MESSAGES', blocks: [['text_message', 'Text', '💬'], ['image_message', 'Image', '🖼️'], ['audio_message', 'Audio', '🎧'], ['video_message', 'Video', '🎬'], ['file_document', 'File', '📄'], ['location', 'Location', '📍'], ['ai_reply', 'AI Reply', '✨']] },
  { title: 'DATA COLLECTION', blocks: [['user_input', 'User Input Flow', '⌨️'], ['whatsapp_flow', 'WhatsApp Flows', '🧩'], ['appointment_booking', 'Appointment', '📅']] },
  { title: 'INTERACTIVE', blocks: [['interactive_message', 'Interactive Message', '🔀'], ['button_message', 'Button', '🔘'], ['list_message', 'List Message', '📋']] },
  { title: 'ACTIONS', blocks: [['assign', 'Assign to Department/User', '👤'], ['add_label', 'Add Tag', '🏷️'], ['remove_label', 'Remove Tag', '➖'], ['update_lead', 'Update Lead', '📝'], ['delay_wait', 'Delay', '⏱️'], ['end_flow', 'End Flow', '🏁']] }
];

const META = Object.fromEntries(GROUPS.flatMap((group) => group.blocks).map(([type, label, icon]) => [type, { label, icon }]));
META.start = { label: 'Flow Start', icon: '⚡' };

const DEFAULTS = {
  start: { source: 'inbound_message', keywords: ['hi'], matchType: 'contains', departmentId: '', assignedUserId: '', googleSheetConnectionId: '' },
  text_message: { message: 'Hi {{LEAD_USER_FIRST_NAME}}, how can we help you?' },
  image_message: { sourceType: 'url', imageUrl: '', mediaUrl: '', whatsappMediaId: '', caption: '' },
  audio_message: { mediaUrl: '' },
  video_message: { mediaUrl: '', caption: '' },
  file_document: { fileUrl: '', fileName: '', caption: '' },
  location: { latitude: '', longitude: '', name: '', address: '' },
  ai_reply: { prompt: 'Reply helpfully using the conversation history.', contextSources: ['conversation_history'], fallbackMessage: 'A team member will help you shortly.' },
  user_input: { question: 'What would you like help with?', saveAs: 'custom.answer', timeoutMinutes: 60 },
  whatsapp_flow: { message: 'Continue in WhatsApp', flowId: '', flowToken: '', screen: '', data: {} },
  appointment_booking: { message: 'Choose an appointment slot', slots: [] },
  interactive_message: { headerType: 'none', headerText: '', headerMediaUrl: '', message: 'Please choose an option', footer: '', buttons: [{ id: 'option_1', payload: 'option_1', title: 'Option 1', actionType: 'reply' }] },
  button_message: { message: 'Tap below to continue', buttons: [{ id: 'join_group', title: 'Join Group' }] },
  list_message: { message: 'Select an option', sectionTitle: 'Options', buttonText: 'Choose', rows: [{ id: 'option_1', title: 'Option 1' }] },
  assign: { departmentId: '', assignedAgentId: '', notifyAssignee: true },
  add_label: { label: '' },
  remove_label: { label: '' },
  update_lead: { status: '', source: '', notes: '', courseInterested: '', batchInterested: '' },
  delay_wait: { amount: 5, unit: 'minutes' },
  end_flow: {}
};

function outputs(data) {
  const config = data.config || {};
  if (['interactive_message', 'button_message'].includes(data.nodeType)) {
    return [
      ...(Array.isArray(config.buttons) ? config.buttons : []).map((item) => ({ id: item.id || item.payload || item.title, label: item.title || item.label || item.id })),
      { id: 'fallback', label: 'Fallback' }
    ];
  }
  if (data.nodeType === 'list_message') {
    return [
      ...(Array.isArray(config.rows) ? config.rows : []).map((item) => ({ id: item.id || item.payload || item.title, label: item.title || item.label || item.id })),
      { id: 'fallback', label: 'Fallback' }
    ];
  }
  if (data.nodeType === 'user_input') return [{ id: 'reply', label: 'Reply' }, { id: 'timeout', label: 'Timeout' }];
  if (data.nodeType === 'appointment_booking') return [...(config.slots || []).map((item) => ({ id: item.id || item.title, label: item.title || item.id })), { id: 'fallback', label: 'Fallback' }];
  if (data.nodeType === 'whatsapp_flow') return [{ id: 'next', label: 'Submitted' }, { id: 'fallback', label: 'Fallback' }];
  return data.nodeType === 'end_flow' ? [] : [{ id: 'next', label: 'Next' }];
}

function preview(data) {
  const config = data.config || {};
  if (data.nodeType === 'image_message') return <Chip size="small" label={(config.whatsappMediaId || config.imageUrl || config.mediaUrl) ? 'Image attached' : 'Image not selected'} />;
  if (data.nodeType === 'video_message') return <Chip size="small" label={(config.whatsappMediaId || config.mediaUrl) ? 'Video attached' : 'Video not selected'} />;
  if (data.nodeType === 'audio_message') return <Chip size="small" label={(config.whatsappMediaId || config.mediaUrl) ? 'Audio attached' : 'Audio not selected'} />;
  if (data.nodeType === 'file_document') return <Chip size="small" label={config.fileName || 'File not selected'} />;
  if (['interactive_message', 'button_message'].includes(data.nodeType)) {
    return <Typography sx={{ fontSize: 11, color: 'text.secondary' }}>{(config.message || 'No message').slice(0, 72)}{(config.message || '').length > 72 ? '…' : ''}<br />{(config.buttons || []).length} button(s)</Typography>;
  }
  if (data.nodeType === 'list_message') {
    return <Typography sx={{ fontSize: 11, color: 'text.secondary' }}>{(config.message || 'No message').slice(0, 72)}<br />{(config.rows || []).length} option(s)</Typography>;
  }
  const text = config.message || config.question || config.prompt || config.caption || (data.nodeType === 'start' ? normalizeKeywords(config.keywords).join(', ') : '');
  const summary = String(text || 'Configure this block');
  return <Typography sx={{ fontSize: 11, color: 'text.secondary', whiteSpace: 'pre-wrap', maxHeight: 34, overflow: 'hidden' }}>{summary.slice(0, 92)}{summary.length > 92 ? '…' : ''}</Typography>;
}

const FlowCard = memo(({ data, selected }) => {
  const stats = { sent: 0, delivered: 0, subscribers: 0, errors: 0, ...(data.stats || {}) };
  const handles = outputs(data);
  const incomplete = Object.keys(nodeConfigErrors(data.nodeType, data.config)).length > 0;
  return (
    <Paper elevation={selected ? 6 : 1} sx={{ width: 230, border: '2px solid', borderColor: selected ? '#128c7e' : '#dce5e1', borderRadius: 2, overflow: 'visible', bgcolor: '#fff' }}>
      {data.nodeType !== 'start' && <Handle type="target" position={Position.Left} id="input" style={{ width: 10, height: 10, background: '#128c7e' }} />}
      <Stack direction="row" spacing={1} alignItems="center" sx={{ px: 1.25, py: 1, bgcolor: data.nodeType === 'start' ? '#e9fff7' : '#f8fbfa', borderRadius: '7px 7px 0 0' }}>
        <Typography fontSize={18}>{META[data.nodeType]?.icon || '🔧'}</Typography>
        <Box minWidth={0} flex={1}><Typography fontSize={12} fontWeight={900} noWrap>{data.label}</Typography><Typography fontSize={9} color="text.secondary">{META[data.nodeType]?.label || data.nodeType}</Typography></Box>
        {incomplete && <Tooltip title="Required settings are missing"><WarningAmberRoundedIcon color="warning" sx={{ fontSize: 17 }} /></Tooltip>}
        <Tooltip title="Edit block"><IconButton className="nodrag" size="small" onClick={(event) => { event.stopPropagation(); data.openEditor(); }} aria-label={`Edit ${data.label}`}><EditOutlinedIcon sx={{ fontSize: 16 }} /></IconButton></Tooltip>
        <Tooltip title="Delete block"><IconButton className="nodrag" size="small" color="error" onClick={(event) => { event.stopPropagation(); data.deleteNode(); }} aria-label={`Delete ${data.label}`}><DeleteOutlineIcon sx={{ fontSize: 16 }} /></IconButton></Tooltip>
      </Stack>
      <Box sx={{ p: 1.25 }}>{preview(data)}</Box>
      <Stack direction="row" justifyContent="space-around" sx={{ px: 0.5, py: 0.7, borderTop: '1px solid #edf1ef', bgcolor: '#fbfcfc' }}>
        {[['Sent', stats.sent], ['Delivered', stats.delivered], ['Entered', stats.subscribers], ['Errors', stats.errors]].map(([label, value]) => <Box key={label} textAlign="center"><Typography fontSize={10} fontWeight={900}>{value}</Typography><Typography fontSize={8} color="text.secondary">{label}</Typography></Box>)}
      </Stack>
      {handles.map((handle, index) => (
        <Tooltip key={handle.id} title={handle.label} placement="right">
          <Handle type="source" position={Position.Right} id={String(handle.id)} style={{ top: `${((index + 1) / (handles.length + 1)) * 100}%`, width: 10, height: 10, background: '#25d366' }} />
        </Tooltip>
      ))}
    </Paper>
  );
});

const nodeTypes = { flowCard: FlowCard };
const makeNode = (type, position) => ({
  id: `${type}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
  type: 'flowCard',
  position,
  data: { label: META[type]?.label || type, nodeType: type, config: structuredClone(DEFAULTS[type] || {}), stats: {} }
});

function OptionEditor({ label, value = [], onChange }) {
  const rows = Array.isArray(value) ? value : [];
  return <Stack spacing={1}><Typography fontSize={12} fontWeight={800}>{label}</Typography>{rows.map((row, index) => <Stack key={index} direction="row" spacing={1}><TextField size="small" label="ID / payload" value={row.id || ''} onChange={(e) => { const next = [...rows]; next[index] = { ...row, id: e.target.value }; onChange(next); }} /><TextField size="small" label="Label" value={row.title || ''} onChange={(e) => { const next = [...rows]; next[index] = { ...row, title: e.target.value }; onChange(next); }} /><Button color="error" onClick={() => onChange(rows.filter((_, itemIndex) => itemIndex !== index))}>×</Button></Stack>)}<Button size="small" onClick={() => onChange([...rows, { id: `option_${rows.length + 1}`, title: `Option ${rows.length + 1}` }])}>Add option</Button></Stack>;
}

function ConfigPanel({ node, onChange, onDelete }) {
  if (!node) return <Typography color="text.secondary">Select a node to configure it.</Typography>;
  const config = node.data.config || {};
  const set = (field, value) => onChange({ ...config, [field]: value });
  const field = (name, label, props = {}) => <TextField key={name} size="small" label={label} value={config[name] ?? ''} onChange={(e) => set(name, e.target.value)} fullWidth {...props} />;
  let controls;
  if (node.data.nodeType === 'start') controls = <>{field('source', 'Start flow from', { select: true, children: ['inbound_message', 'template_button_reply', 'interactive_button_reply', 'list_reply', 'campaign_response', 'manual'].map((value) => <MenuItem key={value} value={value}>{value.replaceAll('_', ' ')}</MenuItem>) })}{field('keywords', 'Trigger keywords', { value: normalizeKeywords(config.keywords).join(', '), onChange: (e) => set('keywords', normalizeKeywords(e.target.value)) })}{field('matchType', 'Keyword matching', { select: true, children: [['exact', 'Exact match'], ['contains', 'Contains'], ['starts_with', 'Starts with']].map(([value, label]) => <MenuItem key={value} value={value}>{label}</MenuItem>) })}{field('departmentId', 'Assign department ID')}{field('assignedUserId', 'Assign user ID')}{field('googleSheetConnectionId', 'Google Sheet connection ID')}</>;
  else if (['text_message', 'interactive_message', 'button_message', 'list_message'].includes(node.data.nodeType)) controls = <>{field('message', 'Message body', { multiline: true, minRows: 4, helperText: 'Variables: {{LEAD_USER_FIRST_NAME}}, {{contact.name}}, {{lead.course}}, {{agent.name}}, {{department.name}}' })}{node.data.nodeType !== 'text_message' && field('footer', 'Footer')}{['interactive_message', 'button_message'].includes(node.data.nodeType) && <OptionEditor label="Buttons" value={config.buttons} onChange={(value) => set('buttons', value)} />}{node.data.nodeType === 'list_message' && <><OptionEditor label="List rows" value={config.rows} onChange={(value) => set('rows', value)} />{field('sectionTitle', 'Section title')}{field('buttonText', 'Menu button text')}</>}</>;
  else if (node.data.nodeType === 'image_message') controls = <>{field('sourceType', 'Source type', { select: true, children: ['url', 'upload', 'media_id'].map((value) => <MenuItem key={value} value={value}>{value}</MenuItem>) })}{field('imageUrl', 'HTTPS image URL')}{field('whatsappMediaId', 'WhatsApp media ID')}{field('caption', 'Caption', { multiline: true })}</>;
  else if (node.data.nodeType === 'video_message') controls = <>{field('mediaUrl', 'Resource URL')}{field('caption', 'Caption', { multiline: true })}</>;
  else if (node.data.nodeType === 'audio_message') controls = field('mediaUrl', 'Audio resource URL');
  else if (node.data.nodeType === 'file_document') controls = <>{field('fileUrl', 'File URL')}{field('fileName', 'Filename')}{field('caption', 'Caption')}</>;
  else if (node.data.nodeType === 'location') controls = <>{field('latitude', 'Latitude')}{field('longitude', 'Longitude')}{field('name', 'Location name')}{field('address', 'Address')}</>;
  else if (node.data.nodeType === 'ai_reply') controls = <>{field('prompt', 'Prompt / instruction', { multiline: true, minRows: 4 })}{field('fallbackMessage', 'Fallback message', { multiline: true })}</>;
  else if (node.data.nodeType === 'user_input') controls = <>{field('question', 'Question', { multiline: true })}{field('saveAs', 'Save reply to')}{field('timeoutMinutes', 'Timeout minutes', { type: 'number' })}</>;
  else if (node.data.nodeType === 'whatsapp_flow') controls = <>{field('message', 'Message')}{field('flowId', 'Meta Flow ID')}{field('flowToken', 'Flow token')}{field('screen', 'Initial screen')}</>;
  else if (node.data.nodeType === 'appointment_booking') controls = <>{field('message', 'Prompt')}{<OptionEditor label="Available slots" value={config.slots} onChange={(value) => set('slots', value)} />}{field('departmentId', 'Department ID')}{field('assignedAgentId', 'User ID')}</>;
  else if (node.data.nodeType === 'assign') controls = <>{field('departmentId', 'Department ID')}{field('assignedAgentId', 'User ID')}</>;
  else if (['add_label', 'remove_label'].includes(node.data.nodeType)) controls = field('label', 'Contact tag');
  else if (node.data.nodeType === 'update_lead') controls = <>{field('status', 'Lead status')}{field('source', 'Lead source')}{field('notes', 'Note', { multiline: true })}{field('courseInterested', 'Course')}{field('batchInterested', 'Batch')}</>;
  else if (node.data.nodeType === 'delay_wait') controls = <>{field('amount', 'Wait amount', { type: 'number' })}{field('unit', 'Unit', { select: true, children: ['minutes', 'hours', 'days'].map((value) => <MenuItem key={value} value={value}>{value}</MenuItem>) })}</>;
  else controls = <Typography variant="body2" color="text.secondary">No configuration required.</Typography>;
  return <Stack spacing={1.4}><TextField size="small" label="Node title" value={node.data.label} onChange={(e) => node.data.setLabel(e.target.value)} fullWidth /><Chip size="small" label={META[node.data.nodeType]?.label || node.data.nodeType} sx={{ alignSelf: 'flex-start' }} />{controls}<Divider /><Button color="error" onClick={onDelete}>Delete node</Button></Stack>;
}

function Editor() {
  const { id } = useParams();
  const navigate = useNavigate();
  const wrapper = useRef(null);
  const [flow, setFlow] = useState(null);
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [instance, setInstance] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [departments, setDepartments] = useState([]);
  const [users, setUsers] = useState([]);
  const [actionOptions, setActionOptions] = useState({ labels: [], lists: [], sequences: [], departments: [], agents: [], flows: [], courses: [], campaigns: [], customFields: [] });
  const [isDirty, setIsDirty] = useState(false);
  const [search, setSearch] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const selected = useMemo(() => nodes.find((node) => node.id === selectedId), [nodes, selectedId]);

  const deleteNode = useCallback((nodeId) => {
    const target = nodes.find((node) => node.id === nodeId);
    if (!target) return;
    if (!window.confirm('Delete this block and all its connections?')) return;
    const startCount = nodes.filter((node) => node.data.nodeType === 'start').length;
    if (
      target.data.nodeType === 'start'
      && startCount <= 1
      && !window.confirm('This is the only Start block. Deleting it will make the flow invalid until another Start block is added. Delete it anyway?')
    ) return;
    setNodes((rows) => rows.filter((node) => node.id !== nodeId));
    setEdges((rows) => rows.filter((edge) => edge.source !== nodeId && edge.target !== nodeId));
    setSelectedId((current) => current === nodeId ? null : current);
    setEditorOpen(false);
    setIsDirty(true);
  }, [nodes, setEdges, setNodes]);

  useEffect(() => {
    getFlow(id).then((response) => {
      const loaded = response.data.data;
      setFlow(loaded);
      const loadedNodes = (loaded.nodes || []).map((node) => ({
        id: node.nodeKey, type: 'flowCard', position: { x: node.positionX, y: node.positionY },
        data: { label: node.label, nodeType: node.nodeType, config: node.configJson || {}, stats: node.stats || {} }
      }));
      setNodes(loadedNodes.length ? loadedNodes : [makeNode('start', { x: 80, y: 180 })]);
      setEdges((loaded.connections || []).map((edge) => ({
        id: String(edge.id), source: edge.sourceNodeKey, target: edge.targetNodeKey,
        sourceHandle: edge.sourceHandle || 'next', targetHandle: edge.targetHandle || 'input',
        label: edge.conditionLabel, type: 'smoothstep', animated: true
      })));
      setIsDirty(false);
    }).catch((requestError) => setError(requestError.response?.data?.message || 'Unable to load flow.'));
  }, [id, setEdges, setNodes]);

  useEffect(() => {
    Promise.all([getRoles(), getUsers(), getFlowActionOptions(id)]).then(([rolesResponse, usersResponse, optionsResponse]) => {
      setDepartments(rolesResponse.data.data || []);
      setUsers(usersResponse.data.data || []);
      setActionOptions(optionsResponse.data.data || {});
    }).catch(() => {});
  }, []);

  const decoratedNodes = useMemo(() => nodes.map((node) => ({
    ...node, data: {
      ...node.data,
      setLabel: (label) => setNodes((rows) => rows.map((row) => row.id === node.id ? { ...row, data: { ...row.data, label } } : row)),
      openEditor: () => { setSelectedId(node.id); setEditorOpen(true); },
      deleteNode: () => deleteNode(node.id)
    }
  })), [deleteNode, nodes, setNodes]);
  useEffect(() => {
    const handleDeleteKey = (event) => {
      if (!selectedId || editorOpen || !['Delete', 'Backspace'].includes(event.key)) return;
      const element = event.target;
      if (element?.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(element?.tagName)) return;
      event.preventDefault();
      deleteNode(selectedId);
    };
    window.addEventListener('keydown', handleDeleteKey);
    return () => window.removeEventListener('keydown', handleDeleteKey);
  }, [deleteNode, editorOpen, selectedId]);
  const handleNodesChange = useCallback((changes) => {
    onNodesChange(changes);
    if (changes.some((change) => !['select', 'dimensions'].includes(change.type))) setIsDirty(true);
  }, [onNodesChange]);
  const handleEdgesChange = useCallback((changes) => {
    onEdgesChange(changes);
    if (changes.some((change) => change.type !== 'select')) setIsDirty(true);
  }, [onEdgesChange]);
  const onConnect = useCallback((params) => {
    setEdges((rows) => addEdge({ ...params, type: 'smoothstep', animated: true }, rows));
    setIsDirty(true);
  }, [setEdges]);
  const onDrop = (event) => {
    event.preventDefault();
    const type = event.dataTransfer.getData('application/reactflow');
    if (!type || !instance || !wrapper.current) return;
    const bounds = wrapper.current.getBoundingClientRect();
    setNodes((rows) => [...rows, makeNode(type, instance.project({ x: event.clientX - bounds.left, y: event.clientY - bounds.top }))]);
    setIsDirty(true);
  };
  const validationErrors = () => {
    const problems = [];
    if (!nodes.some((node) => node.data.nodeType === 'start')) problems.push('A Flow Start node is required.');
    const ids = new Set(nodes.map((node) => node.id));
    if (edges.some((edge) => !ids.has(edge.source) || !ids.has(edge.target))) problems.push('Remove broken connections.');
    nodes.forEach((node) => {
      const configProblems = Object.values(nodeConfigErrors(node.data.nodeType, node.data.config));
      if (configProblems.length) problems.push(`${node.data.label}: ${configProblems[0]}`);
    });
    nodes.filter((node) => ['interactive_message', 'button_message', 'list_message'].includes(node.data.nodeType)).forEach((node) => {
      outputs(node.data).filter((output) => output.id !== 'fallback').forEach((output) => {
        if (!edges.some((edge) => edge.source === node.id && (edge.sourceHandle === output.id || ['next', 'fallback'].includes(edge.sourceHandle)))) problems.push(`${node.data.label}: connect "${output.label}" or add a fallback.`);
      });
    });
    return [...new Set(problems)];
  };
  const save = async () => {
    const start = nodes.find((node) => node.data.nodeType === 'start');
    const startConfig = start?.data.config || {};
    const keywords = normalizeKeywords(startConfig.keywords || flow.triggerKeywords);
    const nextFlow = {
      ...flow,
      triggerType: startConfig.source || flow.triggerType,
      triggerKeywords: keywords,
      keywordMatchMode: startConfig.matchType || startConfig.keywordMatchMode || 'contains',
      triggerConfig: { ...startConfig, keywords, keywordMatchMode: startConfig.matchType || startConfig.keywordMatchMode || 'contains' }
    };
    const response = await saveFlowBuilder(id, {
      flow: nextFlow,
      nodes: nodes.map((node) => ({ id: node.id, nodeType: node.data.nodeType, label: node.data.label, position: node.position, configJson: node.data.config, stats: node.data.stats })),
      connections: edges.map((edge) => ({ source: edge.source, target: edge.target, sourceHandle: edge.sourceHandle, targetHandle: edge.targetHandle, conditionLabel: edge.label }))
    });
    setFlow(response.data.data);
    setIsDirty(false);
    setNotice('Flow saved.');
  };
  const publish = async () => {
    if (flow.status === 'published') {
      const response = await unpublishFlow(id);
      setFlow(response.data.data);
      setNotice('Flow unpublished.');
      return;
    }
    const problems = validationErrors();
    if (problems.length) return setError(problems.join(' '));
    await save();
    const response = await publishFlow(id);
    setFlow(response.data.data);
    setNotice('Flow published.');
  };
  const test = async () => {
    await save();
    await testFlow(id, { contact: { name: 'Test Contact', firstName: 'Test', phone: '94770000000' }, phone: '94770000000' });
    setNotice('Test run created. No WhatsApp message is sent in simulation mode.');
  };

  return <Stack spacing={1} sx={{ height: 'calc(100vh - 92px)', minHeight: 650 }}>
    {notice && <Alert severity="success" onClose={() => setNotice('')}>{notice}</Alert>}
    {error && <Alert severity="error" onClose={() => setError('')}>{error}</Alert>}
    <Paper elevation={0} sx={{ p: 1, border: '1px solid', borderColor: 'divider' }}><Stack direction="row" spacing={1} alignItems="center">
      <IconButton onClick={() => navigate('/flow-builder')}><ArrowBackIcon /></IconButton>
      <TextField size="small" value={flow?.name || ''} onChange={(e) => setFlow({ ...flow, name: e.target.value })} sx={{ width: 260 }} />
      <Box flex={1} />
      <WhatsAppAccountSelect value={flow?.whatsappAccountId || ''} onChange={(value) => { setFlow({ ...flow, whatsappAccountId: value || null }); setIsDirty(true); }} sx={{ width: 260 }} />
      <TextField select size="small" label="Department" value={flow?.departmentId || ''} onChange={(event) => { setFlow({ ...flow, departmentId: event.target.value || null }); setIsDirty(true); }} sx={{ width: 210 }}>
        <MenuItem value="">All assigned departments</MenuItem>
        {departments.map((department) => <MenuItem key={department.id} value={department.id}>{department.name}</MenuItem>)}
      </TextField>
      <Tooltip title="Zoom out"><IconButton onClick={() => instance?.zoomOut()}><ZoomOutIcon /></IconButton></Tooltip>
      <Tooltip title="Zoom in"><IconButton onClick={() => instance?.zoomIn()}><ZoomInIcon /></IconButton></Tooltip>
      <Button startIcon={<ZoomOutMapIcon />} onClick={() => instance?.fitView()}>Fit</Button>
      {isDirty && <Chip size="small" color="warning" label="Unsaved" />}
      <Button startIcon={<SaveIcon />} variant="outlined" onClick={() => save().catch((e) => setError(e.response?.data?.message || e.message))}>Save</Button>
      <Button startIcon={<RocketLaunchIcon />} variant="contained" color={flow?.status === 'published' ? 'warning' : 'primary'} onClick={() => publish().catch((e) => setError(e.response?.data?.message || e.message))}>{flow?.status === 'published' ? 'Unpublish' : 'Publish'}</Button>
      <Button startIcon={<PlayArrowIcon />} color="success" variant="contained" onClick={() => test().catch((e) => setError(e.response?.data?.message || e.message))}>Test flow</Button>
    </Stack></Paper>
    <Box sx={{ display: 'grid', gridTemplateColumns: '250px minmax(500px, 1fr)', gap: 1, flex: 1, minHeight: 0 }}>
      <Paper elevation={0} sx={{ p: 1.5, border: '1px solid', borderColor: 'divider', overflow: 'auto' }}>
        <Typography variant="h6" fontWeight={900}>Flow blocks</Typography>
        <TextField size="small" placeholder="Search blocks" value={search} onChange={(e) => setSearch(e.target.value)} fullWidth sx={{ my: 1.25 }} InputProps={{ startAdornment: <SearchIcon fontSize="small" sx={{ mr: 0.7, color: 'text.disabled' }} /> }} />
        {GROUPS.map((group) => {
          const blocks = group.blocks.filter(([, label]) => label.toLowerCase().includes(search.toLowerCase()));
          return blocks.length ? <Box key={group.title} sx={{ mb: 2 }}><Typography fontSize={10} letterSpacing={1} fontWeight={900} color="text.secondary">{group.title}</Typography><Stack spacing={0.6} mt={0.7}>{blocks.map(([type, label, icon]) => <Paper key={type} draggable onDragStart={(event) => { event.dataTransfer.setData('application/reactflow', type); event.dataTransfer.effectAllowed = 'move'; }} variant="outlined" sx={{ p: 0.9, cursor: 'grab', '&:hover': { borderColor: '#25d366', bgcolor: '#f2fff9' } }}><Stack direction="row" spacing={1}><span>{icon}</span><Typography fontSize={12} fontWeight={750}>{label}</Typography></Stack></Paper>)}</Stack></Box> : null;
        })}
      </Paper>
      <Paper ref={wrapper} elevation={0} sx={{ border: '1px solid', borderColor: 'divider', overflow: 'hidden' }}>
        <ReactFlow deleteKeyCode={null} nodeTypes={nodeTypes} nodes={decoratedNodes} edges={edges} onNodesChange={handleNodesChange} onEdgesChange={handleEdgesChange} onConnect={onConnect} onInit={setInstance} onDrop={onDrop} onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; }} onNodeClick={(_, node) => setSelectedId(node.id)} onNodeDoubleClick={(_, node) => { setSelectedId(node.id); setEditorOpen(true); }} fitView>
          <MiniMap nodeColor={(node) => node.data.nodeType === 'start' ? '#25d366' : '#128c7e'} /><Controls /><Background gap={20} color="#d9e5df" />
        </ReactFlow>
      </Paper>
    </Box>
    <FlowNodeConfigDialog
      node={selected}
      flowId={id}
      whatsappAccountId={flow?.whatsappAccountId || null}
      open={editorOpen}
      departments={departments}
      users={users}
      actionOptions={actionOptions}
      onLabelOptionsChange={(labels) => setActionOptions((current) => ({ ...current, labels }))}
      onDelete={() => selected && deleteNode(selected.id)}
      onClose={() => setEditorOpen(false)}
      onSave={({ label, config }) => {
        const validHandleIds = new Set(outputs({ ...selected.data, config }).map((item) => String(item.id)));
        setNodes((rows) => rows.map((node) => node.id === selected.id ? { ...node, data: { ...node.data, label, config } } : node));
        setEdges((rows) => rows.filter((edge) => edge.source !== selected.id || validHandleIds.has(String(edge.sourceHandle))));
        setIsDirty(true);
        setEditorOpen(false);
      }}
    />
  </Stack>;
}

export default function FlowBuilderEditorPage() {
  return <ReactFlowProvider><Editor /></ReactFlowProvider>;
}
