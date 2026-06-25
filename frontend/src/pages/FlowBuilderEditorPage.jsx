import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import ReactFlow, {
  addEdge,
  Background,
  Controls,
  MiniMap,
  ReactFlowProvider,
  useEdgesState,
  useNodesState
} from 'reactflow';
import 'reactflow/dist/style.css';
import {
  Alert, Box, Button, Chip, Divider, Grid, IconButton, MenuItem, Paper, Stack, TextField, Typography
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import SaveIcon from '@mui/icons-material/Save';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import RocketLaunchIcon from '@mui/icons-material/RocketLaunch';
import ZoomOutMapIcon from '@mui/icons-material/ZoomOutMap';
import {
  getFlow,
  getGoogleSheetConnections,
  publishFlow,
  saveFlowBuilder,
  sendGoogleSheetTestRow,
  testFlow,
  updateFlow
} from '../services/flowBuilder.service';

const blockGroups = [
  { title: 'Message Blocks', blocks: [['text_message', 'Text Message'], ['image_message', 'Image Message'], ['video_message', 'Video Message'], ['audio_message', 'Audio Message'], ['file_document', 'File / Document'], ['location', 'Location']] },
  { title: 'AI Blocks', blocks: [['ai_reply', 'AI Reply'], ['ai_assistant', 'AI Assistant']] },
  { title: 'Data Collection', blocks: [['user_input', 'User Input'], ['whatsapp_flow', 'WhatsApp Flow'], ['appointment_booking', 'Appointment Booking']] },
  { title: 'Interactive', blocks: [['button_message', 'Button Message'], ['list_message', 'List Message']] },
  { title: 'Actions', blocks: [['create_lead', 'Create Lead'], ['update_lead', 'Update Lead'], ['add_label', 'Add Label'], ['assign_agent', 'Assign Agent'], ['create_followup', 'Create Follow-up'], ['send_google_sheets', 'Send To Google Sheets']] },
  { title: 'Logic', blocks: [['delay_wait', 'Delay / Wait'], ['condition', 'Condition / If Else'], ['jump_to_node', 'Jump To Node'], ['end_flow', 'End Flow']] }
];

const defaultConfig = {
  text_message: { message: 'Hello {{contact.name}}, welcome to First Of Education International.' },
  image_message: { mediaUrl: '', caption: '' },
  video_message: { mediaUrl: '', caption: '' },
  audio_message: { mediaUrl: '' },
  file_document: { fileUrl: '', fileName: '', caption: '' },
  location: { latitude: '', longitude: '', name: '', address: '' },
  ai_reply: { prompt: 'Reply helpfully using the conversation context.' },
  ai_assistant: { assistantInstructions: 'Guide the student to the right course.' },
  user_input: { question: 'What course are you interested in?', saveAs: 'courseInterested', nextOnReply: true },
  whatsapp_flow: { flowId: '', screen: '' },
  appointment_booking: { title: 'Book an appointment', durationMinutes: 30 },
  button_message: { message: 'Please choose an option', buttons: 'Forex, IT, English' },
  list_message: { message: 'Select a course', sections: 'Popular Courses' },
  create_lead: { source: 'WhatsApp Ads', status: 'New', notes: 'Created by WhatsApp Flow Builder' },
  update_lead: { status: 'Interested', courseInterested: '{{courseInterested}}' },
  add_label: { label: 'Flow Lead' },
  assign_agent: { assignedAgentId: '' },
  create_followup: { note: 'Follow up from WhatsApp flow', dueInHours: 24 },
  send_google_sheets: {
    connectionId: '',
    spreadsheetId: '',
    sheetName: 'Leads',
    columns: [
      { column: 'A', label: 'Name', value: '{{contact.name}}' },
      { column: 'B', label: 'Phone', value: '{{contact.phone}}' },
      { column: 'C', label: 'Course', value: '{{lead.courseInterested}}' },
      { column: 'D', label: 'Source', value: '{{lead.source}}' },
      { column: 'E', label: 'Created At', value: '{{createdAt}}' }
    ]
  },
  delay_wait: { delayMinutes: 5 },
  condition: { field: 'courseInterested', operator: 'equals', value: 'Forex' },
  jump_to_node: { targetNodeKey: '' },
  end_flow: { message: 'End flow' }
};

function blockLabel(type) {
  return blockGroups.flatMap((group) => group.blocks).find(([key]) => key === type)?.[1] || type;
}

function makeNode(type, position) {
  const id = `${type}_${Date.now()}`;
  return {
    id,
    type: 'default',
    position,
    data: { label: blockLabel(type), nodeType: type, config: defaultConfig[type] || {} },
    style: { borderRadius: 8, border: '1px solid #25d366', padding: 8, minWidth: 170 }
  };
}

function configFields(type, config, setConfig, connections, sendTestRow) {
  const update = (field, value) => setConfig({ ...config, [field]: value });
  const text = (field, label, props = {}) => <TextField key={field} label={label} value={config[field] || ''} onChange={(e) => update(field, e.target.value)} fullWidth size="small" {...props} />;

  if (type === 'send_google_sheets') {
    const columns = config.columns || [];
    return (
      <Stack spacing={1.5}>
        <TextField select label="Google Sheets Connection" value={config.connectionId || ''} onChange={(e) => update('connectionId', e.target.value)} fullWidth size="small">
          <MenuItem value="">Use env credentials / manual sheet</MenuItem>
          {connections.map((connection) => <MenuItem key={connection.id} value={connection.id}>{connection.name}</MenuItem>)}
        </TextField>
        {text('spreadsheetId', 'Spreadsheet ID')}
        {text('sheetName', 'Sheet Name')}
        <Typography fontWeight={850}>Column Mapping</Typography>
        {columns.map((column, index) => (
          <Grid container spacing={1} key={`${column.column}-${index}`}>
            <Grid item xs={3}><TextField label="Col" value={column.column} onChange={(e) => { const next = [...columns]; next[index] = { ...column, column: e.target.value }; update('columns', next); }} size="small" fullWidth /></Grid>
            <Grid item xs={4}><TextField label="Label" value={column.label} onChange={(e) => { const next = [...columns]; next[index] = { ...column, label: e.target.value }; update('columns', next); }} size="small" fullWidth /></Grid>
            <Grid item xs={5}><TextField label="Value" value={column.value} onChange={(e) => { const next = [...columns]; next[index] = { ...column, value: e.target.value }; update('columns', next); }} size="small" fullWidth /></Grid>
          </Grid>
        ))}
        <Stack direction="row" spacing={1}>
          <Button size="small" onClick={() => update('columns', [...columns, { column: '', label: '', value: '' }])}>Add Column</Button>
          <Button size="small" variant="outlined" onClick={() => sendTestRow(config)}>Send Test Row</Button>
        </Stack>
      </Stack>
    );
  }

  if (['text_message', 'button_message', 'list_message'].includes(type)) return <Stack spacing={1.5}>{text('message', 'Message', { multiline: true, minRows: 4 })}{type === 'button_message' && text('buttons', 'Buttons')}{type === 'list_message' && text('sections', 'List Sections')}</Stack>;
  if (['image_message', 'video_message'].includes(type)) return <Stack spacing={1.5}>{text('mediaUrl', 'Media URL')}{text('caption', 'Caption')}</Stack>;
  if (type === 'audio_message') return <Stack spacing={1.5}>{text('mediaUrl', 'Audio URL')}</Stack>;
  if (type === 'file_document') return <Stack spacing={1.5}>{text('fileUrl', 'File URL')}{text('fileName', 'File Name')}{text('caption', 'Caption')}</Stack>;
  if (type === 'location') return <Stack spacing={1.5}>{text('latitude', 'Latitude')}{text('longitude', 'Longitude')}{text('name', 'Name')}{text('address', 'Address')}</Stack>;
  if (type === 'user_input') return <Stack spacing={1.5}>{text('question', 'Question')}{text('saveAs', 'Save As')}</Stack>;
  if (type === 'condition') return <Stack spacing={1.5}>{text('field', 'Field')}{text('operator', 'Operator')}{text('value', 'Value')}<Typography variant="caption" color="text.secondary">Use edge labels "true" and "false" for branches.</Typography></Stack>;
  if (type === 'assign_agent') return <Stack spacing={1.5}>{text('assignedAgentId', 'Agent ID (blank for round-robin)')}</Stack>;
  if (type === 'delay_wait') return <Stack spacing={1.5}>{text('delayMinutes', 'Delay Minutes')}</Stack>;
  return <Stack spacing={1.5}>{Object.keys(config).map((key) => text(key, key))}</Stack>;
}

function EditorInner() {
  const { id } = useParams();
  const navigate = useNavigate();
  const wrapperRef = useRef(null);
  const [flow, setFlow] = useState(null);
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [reactFlowInstance, setReactFlowInstance] = useState(null);
  const [selectedNodeId, setSelectedNodeId] = useState(null);
  const [connections, setConnections] = useState([]);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const selectedNode = useMemo(() => nodes.find((node) => node.id === selectedNodeId), [nodes, selectedNodeId]);

  useEffect(() => {
    Promise.all([getFlow(id), getGoogleSheetConnections()]).then(([flowRes, sheetsRes]) => {
      const loaded = flowRes.data.data;
      setFlow(loaded);
      setConnections(sheetsRes.data.data || []);
      setNodes((loaded.nodes || []).map((node) => ({
        id: node.nodeKey,
        position: { x: node.positionX, y: node.positionY },
        data: { label: node.label, nodeType: node.nodeType, config: node.configJson || {} },
        style: { borderRadius: 8, border: '1px solid #25d366', padding: 8, minWidth: 170 }
      })));
      setEdges((loaded.connections || []).map((edge) => ({
        id: String(edge.id),
        source: edge.sourceNodeKey,
        target: edge.targetNodeKey,
        sourceHandle: edge.sourceHandle,
        targetHandle: edge.targetHandle,
        label: edge.conditionLabel
      })));
    }).catch((err) => setError(err.response?.data?.message || 'Unable to load flow.'));
  }, [id, setEdges, setNodes]);

  const onConnect = useCallback((params) => setEdges((eds) => addEdge({ ...params, label: '' }, eds)), [setEdges]);

  const onDragStart = (event, type) => {
    event.dataTransfer.setData('application/reactflow', type);
    event.dataTransfer.effectAllowed = 'move';
  };

  const onDrop = (event) => {
    event.preventDefault();
    const type = event.dataTransfer.getData('application/reactflow');
    if (!type || !reactFlowInstance || !wrapperRef.current) return;
    const bounds = wrapperRef.current.getBoundingClientRect();
    const position = reactFlowInstance.project({ x: event.clientX - bounds.left, y: event.clientY - bounds.top });
    setNodes((current) => [...current, makeNode(type, position)]);
  };

  const setSelectedConfig = (config) => {
    setNodes((current) => current.map((node) => node.id === selectedNodeId ? { ...node, data: { ...node.data, config } } : node));
  };

  const save = async () => {
    const payload = {
      flow,
      nodes: nodes.map((node) => ({ id: node.id, nodeType: node.data.nodeType, label: node.data.label, position: node.position, configJson: node.data.config })),
      connections: edges.map((edge) => ({ source: edge.source, target: edge.target, sourceHandle: edge.sourceHandle, targetHandle: edge.targetHandle, conditionLabel: edge.label }))
    };
    await updateFlow(id, flow);
    await saveFlowBuilder(id, payload);
    setNotice('Flow saved.');
  };

  const publish = async () => {
    await save();
    const res = await publishFlow(id);
    setFlow(res.data.data);
    setNotice('Flow published.');
  };

  const test = async () => {
    await save();
    await testFlow(id, { contact: { name: 'Test Contact', phone: '94770000000' }, phone: '94770000000', courseInterested: 'Forex' });
    setNotice('Test flow executed. Check analytics/runs for logs.');
  };

  const sendTestRow = async (config) => {
    if (!config.connectionId && !config.spreadsheetId) {
      setError('Select a Google Sheets connection or enter a Spreadsheet ID before sending a test row.');
      return;
    }
    await sendGoogleSheetTestRow({
      connectionId: config.connectionId || undefined,
      spreadsheetId: config.spreadsheetId,
      sheetName: config.sheetName,
      values: (config.columns || []).map((column) => column.label || column.column || 'Test')
    });
    setNotice('Google Sheets test row sent.');
  };

  return (
    <Stack spacing={1.5} sx={{ height: { xs: 'auto', md: 'calc(100vh - 112px)' } }}>
      {notice && <Alert severity="success" onClose={() => setNotice('')}>{notice}</Alert>}
      {error && <Alert severity="error" onClose={() => setError('')}>{error}</Alert>}
      <Paper sx={{ p: 1.5, border: '1px solid', borderColor: 'divider' }} elevation={0}>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} alignItems={{ md: 'center' }}>
          <IconButton onClick={() => navigate('/flow-builder')}><ArrowBackIcon /></IconButton>
          <TextField label="Flow Name" value={flow?.name || ''} onChange={(e) => setFlow({ ...flow, name: e.target.value })} size="small" sx={{ minWidth: { md: 260 } }} />
          <TextField label="Trigger Keywords" value={(flow?.triggerKeywords || []).join(', ')} onChange={(e) => setFlow({ ...flow, triggerKeywords: e.target.value.split(',').map((item) => item.trim()) })} size="small" sx={{ flex: 1 }} />
          <Chip label="WhatsApp Cloud API" color="success" variant="outlined" />
          <Button startIcon={<ZoomOutMapIcon />} onClick={() => reactFlowInstance?.fitView()}>Fit</Button>
          <Button startIcon={<SaveIcon />} variant="outlined" onClick={save}>Save</Button>
          <Button startIcon={<RocketLaunchIcon />} variant="contained" onClick={publish}>Publish</Button>
          <Button startIcon={<PlayArrowIcon />} color="success" variant="contained" onClick={test}>Test Flow</Button>
        </Stack>
      </Paper>

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: '260px 1fr 340px' }, gap: 1.5, minHeight: 0, flex: 1 }}>
        <Paper sx={{ p: 1.5, border: '1px solid', borderColor: 'divider', overflow: 'auto' }} elevation={0}>
          <Typography fontWeight={850} sx={{ mb: 1 }}>Blocks</Typography>
          {blockGroups.map((group) => (
            <Box key={group.title} sx={{ mb: 2 }}>
              <Typography variant="caption" color="text.secondary" fontWeight={850}>{group.title}</Typography>
              <Stack spacing={0.75} sx={{ mt: 0.75 }}>
                {group.blocks.map(([type, label]) => (
                  <Paper key={type} draggable onDragStart={(event) => onDragStart(event, type)} variant="outlined" sx={{ p: 1, cursor: 'grab', bgcolor: 'background.default' }}>
                    <Typography variant="body2" fontWeight={750}>{label}</Typography>
                  </Paper>
                ))}
              </Stack>
            </Box>
          ))}
        </Paper>

        <Paper ref={wrapperRef} sx={{ border: '1px solid', borderColor: 'divider', minHeight: { xs: 520, lg: 0 }, overflow: 'hidden' }} elevation={0}>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onInit={setReactFlowInstance}
            onDrop={onDrop}
            onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; }}
            onNodeClick={(_, node) => setSelectedNodeId(node.id)}
            fitView
          >
            <MiniMap />
            <Controls />
            <Background gap={18} />
          </ReactFlow>
        </Paper>

        <Paper sx={{ p: 1.5, border: '1px solid', borderColor: 'divider', overflow: 'auto' }} elevation={0}>
          <Typography fontWeight={850}>Node Settings</Typography>
          <Divider sx={{ my: 1.5 }} />
          {!selectedNode && <Typography color="text.secondary">Select a node to configure it.</Typography>}
          {selectedNode && (
            <Stack spacing={1.5}>
              <TextField label="Label" value={selectedNode.data.label} onChange={(e) => setNodes((current) => current.map((node) => node.id === selectedNode.id ? { ...node, data: { ...node.data, label: e.target.value } } : node))} size="small" fullWidth />
              <Chip label={blockLabel(selectedNode.data.nodeType)} sx={{ alignSelf: 'flex-start' }} />
              {configFields(selectedNode.data.nodeType, selectedNode.data.config || {}, setSelectedConfig, connections, sendTestRow)}
              <Button color="error" onClick={() => { setNodes((current) => current.filter((node) => node.id !== selectedNode.id)); setEdges((current) => current.filter((edge) => edge.source !== selectedNode.id && edge.target !== selectedNode.id)); setSelectedNodeId(null); }}>Delete Node</Button>
            </Stack>
          )}
        </Paper>
      </Box>
    </Stack>
  );
}

function FlowBuilderEditorPage() {
  return (
    <ReactFlowProvider>
      <EditorInner />
    </ReactFlowProvider>
  );
}

export default FlowBuilderEditorPage;
