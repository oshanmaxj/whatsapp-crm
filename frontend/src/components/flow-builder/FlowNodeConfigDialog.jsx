import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert, Autocomplete, Box, Button, Card, CardActionArea, Checkbox, Chip, Dialog, DialogActions,
  DialogContent, DialogTitle, Divider, FormControlLabel, Grid, IconButton, MenuItem,
  Paper, Stack, TextField, Typography
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import InsertEmoticonIcon from '@mui/icons-material/InsertEmoticon';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import { uploadFlowMedia } from '../../services/flowBuilder.service';
import { compatibleButton, FLOW_VARIABLES, nodeConfigErrors, normalizeKeywords } from './flowBuilderConfig';

const EMOJIS = ['😊', '👍', '🙏', '🎉', '❤️', '👋'];
const clone = (value) => JSON.parse(JSON.stringify(value || {}));

function Section({ title, description, children }) {
  return (
    <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
      <Typography fontWeight={800}>{title}</Typography>
      {description && <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>{description}</Typography>}
      <Stack spacing={1.5} sx={{ mt: description ? 0 : 1.5 }}>{children}</Stack>
    </Paper>
  );
}

function VariableButtons({ onInsert }) {
  return (
    <Stack direction="row" gap={0.75} flexWrap="wrap">
      {FLOW_VARIABLES.map((variable) => (
        <Chip key={variable} size="small" label={variable} onClick={() => onInsert(variable)} sx={{ fontFamily: 'monospace' }} />
      ))}
    </Stack>
  );
}

function MessageField({ label = 'Message', value = '', onChange, error, maxLength = 4096, variables = true, emoji = false }) {
  const inputRef = useRef(null);
  const insert = (text) => {
    const field = inputRef.current;
    const start = field?.selectionStart ?? value.length;
    const end = field?.selectionEnd ?? value.length;
    onChange(`${value.slice(0, start)}${text}${value.slice(end)}`);
    setTimeout(() => field?.focus(), 0);
  };
  return (
    <Stack spacing={1}>
      <TextField
        label={label}
        value={value}
        onChange={(event) => onChange(event.target.value.slice(0, maxLength))}
        inputRef={inputRef}
        multiline
        minRows={5}
        fullWidth
        error={Boolean(error)}
        helperText={error || `${value.length} / ${maxLength}`}
      />
      {variables && <VariableButtons onInsert={(variable) => insert(` ${variable} `)} />}
      {emoji && (
        <Stack direction="row" alignItems="center" spacing={0.5}>
          <InsertEmoticonIcon color="action" fontSize="small" />
          {EMOJIS.map((item) => <Button key={item} size="small" onClick={() => insert(item)} sx={{ minWidth: 30 }}>{item}</Button>)}
        </Stack>
      )}
    </Stack>
  );
}

function MediaPicker({ label, accept, value, onChange, error, fileNameField, onFileName }) {
  const selectFile = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      onChange(String(reader.result || ''));
      if (onFileName) onFileName(file.name);
    };
    reader.readAsDataURL(file);
  };
  return (
    <Stack spacing={1}>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
        <Button component="label" variant="outlined" startIcon={<UploadFileIcon />} sx={{ whiteSpace: 'nowrap' }}>
          Select file
          <input hidden type="file" accept={accept} onChange={selectFile} />
        </Button>
        <TextField
          label={`${label} URL`}
          value={value || ''}
          onChange={(event) => onChange(event.target.value)}
          error={Boolean(error)}
          helperText={error}
          fullWidth
        />
      </Stack>
      {fileNameField}
      <Typography variant="caption" color="text.secondary">
        Selected files are embedded in the draft for preview. Use a hosted HTTPS URL before publishing large media.
      </Typography>
    </Stack>
  );
}

function ImageSourceEditor({ config, set, errors }) {
  const sourceType = config.sourceType || (config.whatsappMediaId ? 'media_id' : 'url');
  const selectFile = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const allowed = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
    if (!allowed.includes(file.type)) {
      set('fileError', 'Use JPG, PNG, or WebP.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result || '');
      set('sourceType', 'upload');
      set('fileName', file.name);
      set('mimeType', file.type);
      set('fileDataBase64', dataUrl.split(',')[1] || '');
      set('mediaUrl', dataUrl);
      set('whatsappMediaId', '');
      set('fileError', '');
    };
    reader.readAsDataURL(file);
  };
  return (
    <Stack spacing={1.5}>
      <TextField select label="Image source" value={sourceType} onChange={(event) => set('sourceType', event.target.value)} fullWidth>
        <MenuItem value="url">HTTPS URL</MenuItem>
        <MenuItem value="upload">Upload file</MenuItem>
        <MenuItem value="media_id">WhatsApp media ID</MenuItem>
      </TextField>
      {sourceType === 'url' && (
        <TextField
          label="Image HTTPS URL"
          value={config.imageUrl || config.mediaUrl || ''}
          onChange={(event) => { set('imageUrl', event.target.value); set('mediaUrl', event.target.value); }}
          error={Boolean(errors.imageUrl)}
          helperText={errors.imageUrl || 'Must be a public HTTPS URL. Localhost is not accepted by WhatsApp.'}
          fullWidth
        />
      )}
      {sourceType === 'upload' && (
        <Stack spacing={1}>
          <Button component="label" variant="outlined" startIcon={<UploadFileIcon />} sx={{ alignSelf: 'flex-start' }}>
            Select image
            <input hidden type="file" accept="image/jpeg,image/png,image/webp" onChange={selectFile} />
          </Button>
          {config.fileName && <Chip size="small" label={config.whatsappMediaId ? `${config.fileName} uploaded` : config.fileName} sx={{ alignSelf: 'flex-start' }} />}
          {(errors.file || config.fileError) && <Alert severity="error">{errors.file || config.fileError}</Alert>}
          <Typography variant="caption" color="text.secondary">
            The image is uploaded to WhatsApp Media API when you save this node.
          </Typography>
        </Stack>
      )}
      {sourceType === 'media_id' && (
        <TextField
          label="WhatsApp media ID"
          value={config.whatsappMediaId || ''}
          onChange={(event) => set('whatsappMediaId', event.target.value)}
          error={Boolean(errors.whatsappMediaId)}
          helperText={errors.whatsappMediaId}
          fullWidth
        />
      )}
    </Stack>
  );
}

const ACTION_LABELS = {
  ADD_LABELS: 'Add Labels', REMOVE_LABELS: 'Remove Labels', ADD_TO_LISTS: 'Add to Lists', REMOVE_FROM_LISTS: 'Remove from Lists',
  SUBSCRIBE_SEQUENCE: 'Subscribe to Sequence', UNSUBSCRIBE_SEQUENCE: 'Unsubscribe from Sequence', ASSIGN_TEAM: 'Assign Conversation to Team',
  ASSIGN_AGENT: 'Assign Conversation to Agent', AUTO_ASSIGN: 'Auto Assign', UNASSIGN_AGENT: 'Unassign Agent', REMOVE_TEAM: 'Remove Team Assignment',
  SET_CUSTOM_FIELD: 'Set Custom Field', SEND_WEBHOOK: 'Send to Webhook', SEND_GOOGLE_SHEETS: 'Send to Google Sheets',
  CREATE_CALENDAR_EVENT: 'Send to Google Calendar', START_FLOW: 'Start Another Flow', STOP_FLOW: 'Stop Current Flow'
};

function OptionMultiSelect({ label, options = [], value = [], onChange }) {
  const selected = options.filter((item) => value.map(String).includes(String(item.id)));
  return <Autocomplete multiple size="small" options={options} value={selected} getOptionLabel={(item) => item.name || item.email || String(item.id)} isOptionEqualToValue={(a, b) => String(a.id) === String(b.id)} onChange={(_, rows) => onChange(rows.map((item) => item.id))} renderInput={(params) => <TextField {...params} label={label} />} />;
}

function AutomationActionsEditor({ value, onChange, options = {} }) {
  const actions = Array.isArray(value) ? value : [];
  const update = (index, patch) => onChange(actions.map((action, itemIndex) => itemIndex === index ? { ...action, ...patch } : action));
  const updateConfig = (index, patch) => update(index, { config: { ...(actions[index].config || {}), ...patch } });
  return <Stack spacing={1.25}>
    {actions.map((action, index) => {
      const type = action.actionType || 'ADD_LABELS';
      const config = action.config || {};
      return <Paper key={action.id || index} variant="outlined" sx={{ p: 1.25 }}><Stack spacing={1}>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={1}>
          <TextField select size="small" label="Automation action" value={type} onChange={(event) => update(index, { actionType: event.target.value, config: {} })} fullWidth>{Object.entries(ACTION_LABELS).map(([id, name]) => <MenuItem key={id} value={id}>{name}</MenuItem>)}</TextField>
          <TextField select size="small" label="Phase" value={action.phase || 'pre'} onChange={(event) => update(index, { phase: event.target.value })} sx={{ minWidth: 105 }}><MenuItem value="pre">Before</MenuItem><MenuItem value="post">After</MenuItem></TextField>
          <TextField size="small" type="number" label="Order" value={action.executionOrder ?? index} onChange={(event) => update(index, { executionOrder: Number(event.target.value) })} sx={{ width: 90 }} />
          <TextField select size="small" label="On failure" value={action.failurePolicy || 'CONTINUE'} onChange={(event) => update(index, { failurePolicy: event.target.value })} sx={{ minWidth: 130 }}><MenuItem value="CONTINUE">Continue</MenuItem><MenuItem value="STOP_FLOW">Stop flow</MenuItem><MenuItem value="RETRY">Retry</MenuItem><MenuItem value="ROUTE_TO_ERROR_NODE">Error node</MenuItem></TextField>
          <IconButton color="error" onClick={() => onChange(actions.filter((_, itemIndex) => itemIndex !== index))}><DeleteOutlineIcon /></IconButton>
        </Stack>
        {['ADD_LABELS', 'REMOVE_LABELS'].includes(type) && <OptionMultiSelect label="Labels" options={options.labels} value={config.labelIds || []} onChange={(labelIds) => updateConfig(index, { labelIds })} />}
        {['ADD_TO_LISTS', 'REMOVE_FROM_LISTS'].includes(type) && <OptionMultiSelect label="Contact lists" options={options.lists} value={config.listIds || []} onChange={(listIds) => updateConfig(index, { listIds })} />}
        {['SUBSCRIBE_SEQUENCE', 'UNSUBSCRIBE_SEQUENCE'].includes(type) && <OptionMultiSelect label="Sequences" options={options.sequences} value={config.sequenceIds || []} onChange={(sequenceIds) => updateConfig(index, { sequenceIds })} />}
        {type === 'ASSIGN_TEAM' && <Autocomplete size="small" options={options.departments || []} value={(options.departments || []).find((item) => String(item.id) === String(config.roleId)) || null} getOptionLabel={(item) => item.name || ''} onChange={(_, item) => updateConfig(index, { roleId: item?.id || '' })} renderInput={(params) => <TextField {...params} label="Team" />} />}
        {type === 'ASSIGN_AGENT' && <Autocomplete size="small" options={options.agents || []} value={(options.agents || []).find((item) => String(item.id) === String(config.userId)) || null} getOptionLabel={(item) => item.name || ''} onChange={(_, item) => updateConfig(index, { userId: item?.id || '' })} renderInput={(params) => <TextField {...params} label="Agent" />} />}
        {type === 'SET_CUSTOM_FIELD' && <Stack direction="row" spacing={1}><TextField select size="small" label="Record" value={config.entity || 'contact'} onChange={(event) => updateConfig(index, { entity: event.target.value })}><MenuItem value="contact">Contact</MenuItem><MenuItem value="lead">Lead</MenuItem><MenuItem value="conversation">Conversation</MenuItem></TextField><TextField size="small" label="Field key" value={config.field || ''} onChange={(event) => updateConfig(index, { field: event.target.value })} fullWidth /><TextField size="small" label="Value / {{variable}}" value={config.value || ''} onChange={(event) => updateConfig(index, { value: event.target.value })} fullWidth /></Stack>}
        {type === 'SEND_WEBHOOK' && <TextField size="small" label="HTTPS webhook URL" value={config.url || ''} onChange={(event) => updateConfig(index, { url: event.target.value })} fullWidth />}
        {type === 'START_FLOW' && <Autocomplete size="small" options={options.flows || []} value={(options.flows || []).find((item) => String(item.id) === String(config.targetFlowId)) || null} getOptionLabel={(item) => item.name || ''} onChange={(_, item) => updateConfig(index, { targetFlowId: item?.id || '' })} renderInput={(params) => <TextField {...params} label="Published flow" />} />}
        <FormControlLabel control={<Checkbox checked={action.enabled !== false} onChange={(event) => update(index, { enabled: event.target.checked })} />} label="Enabled" />
      </Stack></Paper>;
    })}
    <Button size="small" variant="outlined" onClick={() => onChange([...actions, { id: `action_${Date.now()}`, actionType: 'ADD_LABELS', config: {}, phase: 'pre', executionOrder: actions.length, failurePolicy: 'CONTINUE', enabled: true }])}>Add automation action</Button>
  </Stack>;
}

function ButtonEditor({ value, onChange, errors, options }) {
  const rows = Array.isArray(value) ? value : [];
  const add = () => {
    const number = rows.length + 1;
    onChange([...rows, {
      id: `button_${Date.now()}_${number}`,
      payload: `button_${Date.now()}_${number}`,
      title: `Option ${number}`,
      primaryActionType: 'CONTINUE_FLOW', primaryActionConfig: {}, automationActions: []
    }]);
  };
  const update = (index, patch) => onChange(rows.map((row, itemIndex) => itemIndex === index ? { ...row, ...patch } : row));
  return (
    <Stack spacing={1.25}>
      {rows.map((row, index) => {
        const type = String(row.primaryActionType || row.actionType || 'CONTINUE_FLOW').toUpperCase();
        return (
          <Paper key={`${row.id || 'button'}_${index}`} variant="outlined" sx={{ p: 1.5 }}>
            <Stack direction={{ xs: 'column', md: 'row' }} spacing={1} alignItems={{ md: 'flex-start' }}>
              <TextField
                size="small"
                label="Label"
                value={row.title || ''}
                onChange={(event) => update(index, { title: event.target.value.slice(0, 20) })}
                error={Boolean(errors[`button_${index}_title`])}
                helperText={errors[`button_${index}_title`] || `${(row.title || '').length} / 20`}
                fullWidth
              />
              <TextField
                size="small"
                select
                label="Action"
                value={type}
                onChange={(event) => update(index, { primaryActionType: event.target.value, primaryActionConfig: {} })}
                sx={{ minWidth: 140 }}
              >
                <MenuItem value="SEND_MESSAGE">Send Message</MenuItem><MenuItem value="START_FLOW">Start a Flow</MenuItem><MenuItem value="CONTINUE_FLOW">Continue Flow</MenuItem><MenuItem value="OPEN_URL">Open URL</MenuItem><MenuItem value="CALL_PHONE">Call Phone</MenuItem><MenuItem value="SYSTEM_DEFAULT_ACTION">System Default Action</MenuItem>
              </TextField>
              <IconButton color="error" onClick={() => onChange(rows.filter((_, itemIndex) => itemIndex !== index))} aria-label="Delete button">
                <DeleteOutlineIcon />
              </IconButton>
            </Stack>
            <Typography variant="caption" color="text.secondary">Stable action ID: {row.id}</Typography>
            {type === 'SEND_MESSAGE' && <MessageField label="Message sent when pressed" value={row.primaryActionConfig?.message || row.message || ''} onChange={(message) => update(index, { primaryActionConfig: { ...(row.primaryActionConfig || {}), message } })} />}
            {type === 'START_FLOW' && <Stack spacing={1}><Autocomplete options={options.flows || []} value={(options.flows || []).find((item) => String(item.id) === String(row.primaryActionConfig?.targetFlowId || row.targetFlowId)) || null} getOptionLabel={(item) => item.name || ''} onChange={(_, item) => update(index, { primaryActionConfig: { ...(row.primaryActionConfig || {}), targetFlowId: item?.id || '' } })} renderInput={(params) => <TextField {...params} label="Published flow" />} /><FormControlLabel control={<Checkbox checked={Boolean(row.primaryActionConfig?.pauseCurrentFlow)} onChange={(event) => update(index, { primaryActionConfig: { ...(row.primaryActionConfig || {}), pauseCurrentFlow: event.target.checked, stopCurrentFlow: event.target.checked ? false : row.primaryActionConfig?.stopCurrentFlow } })} />} label="Pause and resume this flow when the child completes" /><FormControlLabel control={<Checkbox checked={Boolean(row.primaryActionConfig?.stopCurrentFlow)} onChange={(event) => update(index, { primaryActionConfig: { ...(row.primaryActionConfig || {}), stopCurrentFlow: event.target.checked, pauseCurrentFlow: event.target.checked ? false : row.primaryActionConfig?.pauseCurrentFlow } })} />} label="Stop current flow after starting target" /></Stack>}
            {type === 'OPEN_URL' && <TextField size="small" label="HTTPS URL" value={row.primaryActionConfig?.url || row.url || ''} onChange={(event) => update(index, { primaryActionConfig: { ...(row.primaryActionConfig || {}), url: event.target.value } })} fullWidth />}
            {type === 'CALL_PHONE' && <TextField size="small" label="Phone number" value={row.primaryActionConfig?.phone || row.phone || ''} onChange={(event) => update(index, { primaryActionConfig: { ...(row.primaryActionConfig || {}), phone: event.target.value } })} fullWidth />}
            {type === 'OPEN_URL' && <Alert severity="warning">Regular WhatsApp reply buttons cannot both open a URL and return a press webhook. Use an approved URL CTA template for native opening; CTA clicks cannot run these automations.</Alert>}
            {type === 'CALL_PHONE' && <Alert severity="warning">Native phone-call buttons require a supported approved template. A regular reply button can return a webhook, but it cannot initiate the call.</Alert>}
            <Divider sx={{ my: 1 }} /><Typography fontWeight={700} fontSize={13}>Automation actions</Typography><AutomationActionsEditor value={row.automationActions || []} onChange={(automationActions) => update(index, { automationActions })} options={options} />
            <Alert severity="info" sx={{ mt: 1 }}>On press: run enabled pre-actions → {type.replaceAll('_', ' ').toLowerCase()} → transition if configured → run post-actions.</Alert>
          </Paper>
        );
      })}
      {errors.buttons && <Alert severity="error">{errors.buttons}</Alert>}
      <Stack direction="row" gap={1} flexWrap="wrap">
        <Button size="small" variant="outlined" onClick={add}>Add Button</Button>
      </Stack>
    </Stack>
  );
}

function OptionEditor({ label, value, onChange, error }) {
  const rows = Array.isArray(value) ? value : [];
  return (
    <Stack spacing={1}>
      <Typography fontWeight={700} fontSize={13}>{label}</Typography>
      {rows.map((row, index) => (
        <Stack key={index} direction="row" spacing={1}>
          <TextField size="small" label="ID / payload" value={row.id || ''} onChange={(event) => onChange(rows.map((item, itemIndex) => itemIndex === index ? { ...item, id: event.target.value } : item))} fullWidth />
          <TextField size="small" label="Label" value={row.title || ''} onChange={(event) => onChange(rows.map((item, itemIndex) => itemIndex === index ? { ...item, title: event.target.value } : item))} fullWidth />
          <IconButton color="error" onClick={() => onChange(rows.filter((_, itemIndex) => itemIndex !== index))}><DeleteOutlineIcon /></IconButton>
        </Stack>
      ))}
      {error && <Typography color="error" variant="caption">{error}</Typography>}
      <Button size="small" sx={{ alignSelf: 'flex-start' }} onClick={() => onChange([...rows, { id: `option_${rows.length + 1}`, title: `Option ${rows.length + 1}` }])}>Add option</Button>
    </Stack>
  );
}

function WhatsAppPreview({ type, config, label }) {
  const buttons = config.buttons || [];
  const body = config.message || config.question || config.prompt || config.caption || 'Your message preview will appear here.';
  const mediaUrl = config.mediaUrl || config.imageUrl || config.headerMediaUrl;
  return (
    <Box sx={{ bgcolor: '#efeae2', borderRadius: 3, minHeight: 500, p: 2, backgroundImage: 'radial-gradient(#d8d1c7 0.7px, transparent 0.7px)', backgroundSize: '12px 12px' }}>
      <Typography variant="caption" fontWeight={800} color="text.secondary">LIVE WHATSAPP PREVIEW</Typography>
      <Paper elevation={2} sx={{ mt: 2, ml: 'auto', maxWidth: 340, borderRadius: '12px 12px 3px 12px', overflow: 'hidden', bgcolor: '#d9fdd3' }}>
        {mediaUrl && ['image_message', 'video_message', 'interactive_message'].includes(type) && config.headerMediaType !== 'document' && (
          type === 'video_message' || (type === 'interactive_message' && config.headerMediaType === 'video')
            ? <Box component="video" src={mediaUrl} controls sx={{ width: '100%', maxHeight: 190, display: 'block', bgcolor: '#111' }} />
            : <Box component="img" src={mediaUrl} alt="" sx={{ width: '100%', maxHeight: 190, objectFit: 'cover', display: 'block' }} />
        )}
        {type === 'interactive_message' && config.headerMediaType === 'document' && mediaUrl && <Chip size="small" label="Header document" sx={{ m: 1 }} />}
        {type === 'interactive_message' && config.headerType === 'text' && config.headerText && (
          <Typography fontWeight={800} sx={{ px: 1.5, pt: 1.25 }}>{config.headerText}</Typography>
        )}
        <Typography sx={{ px: 1.5, pt: 1.25, pb: 0.75, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontSize: 14 }}>{body}</Typography>
        {config.footer && <Typography sx={{ px: 1.5, pb: 1, fontSize: 11 }} color="text.secondary">{config.footer}</Typography>}
        {type === 'file_document' && <Chip size="small" label={config.fileName || 'Document'} sx={{ m: 1 }} />}
        {buttons.map((button, index) => <Box key={index} sx={{ borderTop: '1px solid rgba(0,0,0,.1)', py: 0.8, textAlign: 'center', color: '#027eb5', fontSize: 13, fontWeight: 700 }}>{button.title || 'Button'}</Box>)}
        <Typography sx={{ px: 1, pb: 0.5, textAlign: 'right', fontSize: 9 }} color="text.secondary">12:34 ✓✓</Typography>
      </Paper>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 2 }}>{label}</Typography>
    </Box>
  );
}

export default function FlowNodeConfigDialog({ node, open, onClose, onSave, onDelete, departments = [], users = [], actionOptions = {}, flowId }) {
  const [label, setLabel] = useState('');
  const [config, setConfig] = useState({});
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const initialRef = useRef('');

  useEffect(() => {
    if (!node || !open) return;
    const nextConfig = clone(node.data.config);
    if (Array.isArray(nextConfig.buttons)) nextConfig.buttons = nextConfig.buttons.map(compatibleButton);
    if (Array.isArray(nextConfig.rows)) nextConfig.rows = nextConfig.rows.map(compatibleButton);
    setLabel(node.data.label || '');
    setConfig(nextConfig);
    setErrors({});
    initialRef.current = JSON.stringify({ label: node.data.label || '', config: nextConfig });
  }, [node, open]);

  const dirty = useMemo(() => open && JSON.stringify({ label, config }) !== initialRef.current, [config, label, open]);
  const set = (field, value) => setConfig((current) => ({ ...current, [field]: value }));
  const requestClose = () => {
    if (dirty && !window.confirm('Discard your unsaved block changes?')) return;
    onClose();
  };
  const save = async () => {
    const nextErrors = nodeConfigErrors(node.data.nodeType, config);
    if (!label.trim()) nextErrors.label = 'Enter a node title.';
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;
    setSaving(true);
    try {
      let nextConfig = { ...config };
      if (node.data.nodeType === 'start') {
        nextConfig = { ...nextConfig, keywords: normalizeKeywords(nextConfig.keywords), keywordMatchMode: nextConfig.matchType || nextConfig.keywordMatchMode || 'contains' };
      }
      if (node.data.nodeType === 'image_message' && nextConfig.sourceType === 'upload' && nextConfig.fileDataBase64 && !nextConfig.whatsappMediaId) {
        const response = await uploadFlowMedia(flowId, {
          fileName: nextConfig.fileName,
          mimeType: nextConfig.mimeType,
          dataBase64: nextConfig.fileDataBase64
        });
        nextConfig = {
          ...nextConfig,
          whatsappMediaId: response.data.data.whatsappMediaId,
          fileDataBase64: ''
        };
      }
      onSave({ label: label.trim(), config: nextConfig });
    } catch (error) {
      setErrors({ form: error.response?.data?.message || error.message || 'Unable to save node.' });
    } finally {
      setSaving(false);
    }
  };
  if (!node) return null;

  const type = node.data.nodeType;
  const field = (name, fieldLabel, props = {}) => (
    <TextField
      label={fieldLabel}
      value={config[name] ?? ''}
      onChange={(event) => set(name, event.target.value)}
      error={Boolean(errors[name])}
      helperText={errors[name]}
      fullWidth
      {...props}
    />
  );

  let form;
  if (type === 'start') {
    form = <><Section title="Flow trigger">
      {field('title', 'Trigger title')}
      {field('source', 'Start flow from', { select: true, children: ['inbound_message', 'any_message', 'first_message', 'button_reply', 'list_reply', 'template_button_reply', 'payment_event', 'label_added', 'contact_created', 'lead_status_changed', 'campaign_response', 'manual'].map((value) => <MenuItem key={value} value={value}>{value.replaceAll('_', ' ')}</MenuItem>) })}
      <TextField label="Trigger keywords" value={Array.isArray(config.keywords) ? config.keywords.join(', ') : config.keywords || ''} onChange={(event) => set('keywords', normalizeKeywords(event.target.value))} error={Boolean(errors.keywords)} helperText={errors.keywords || 'Separate keywords with commas; Unicode and Sinhala are supported.'} fullWidth />
      {field('matchType', 'Keyword matching', { select: true, children: [['exact', 'Exact match'], ['contains', 'Contains'], ['starts_with', 'Starts with'], ['ends_with', 'Ends with'], ['regex', 'Regular expression (privileged)']].map(([value, text]) => <MenuItem key={value} value={value}>{text}</MenuItem>) })}
      <Grid container spacing={1}><Grid item xs={6}>{field('priority', 'Priority', { type: 'number' })}</Grid><Grid item xs={6}>{field('contactSource', 'Optional source scope')}</Grid></Grid>
      <Autocomplete options={actionOptions.courses || []} value={(actionOptions.courses || []).find((item) => item.name === config.course) || null} getOptionLabel={(item) => item.name || ''} onChange={(_, item) => set('course', item?.name || '')} renderInput={(params) => <TextField {...params} label="Optional course scope" />} />
      <Autocomplete options={actionOptions.campaigns || []} value={(actionOptions.campaigns || []).find((item) => String(item.id) === String(config.campaignId)) || null} getOptionLabel={(item) => item.name || ''} onChange={(_, item) => set('campaignId', item?.id || '')} renderInput={(params) => <TextField {...params} label="Optional campaign scope" />} />
      <FormControlLabel control={<Checkbox checked={config.caseInsensitive !== false} onChange={(event) => set('caseInsensitive', event.target.checked)} />} label="Case insensitive" />
      <FormControlLabel control={<Checkbox checked={config.normalizeWhitespace !== false} onChange={(event) => set('normalizeWhitespace', event.target.checked)} />} label="Trim and normalize whitespace" />
      <FormControlLabel control={<Checkbox checked={config.stopAfterMatch !== false} onChange={(event) => set('stopAfterMatch', event.target.checked)} />} label="Stop after first matched trigger" />
    </Section><Section title="Automation actions" description="Actions can run before or after this flow starts."><AutomationActionsEditor value={config.automationActions || []} onChange={(automationActions) => set('automationActions', automationActions)} options={actionOptions} /></Section></>;
  } else if (type === 'interactive_message') {
    form = <>
      <Section title="Header" description="Optional content shown above the message body.">
        <Grid container spacing={1}>
          {[['none', 'None'], ['text', 'Text'], ['media', 'Media']].map(([value, text]) => <Grid item xs={4} key={value}><Card variant="outlined" sx={{ borderColor: (config.headerType || 'none') === value ? 'primary.main' : 'divider' }}><CardActionArea onClick={() => set('headerType', value)} sx={{ p: 1.5, textAlign: 'center' }}><Typography fontWeight={700}>{text}</Typography></CardActionArea></Card></Grid>)}
        </Grid>
        {config.headerType === 'text' && field('headerText', 'Header text', { inputProps: { maxLength: 60 }, helperText: errors.headerText || `${(config.headerText || '').length} / 60` })}
        {config.headerType === 'media' && <>
          {field('headerMediaType', 'Media type', { select: true, value: config.headerMediaType || 'image', children: [<MenuItem key="image" value="image">Image</MenuItem>, <MenuItem key="video" value="video">Video</MenuItem>, <MenuItem key="document" value="document">File</MenuItem>] })}
          <MediaPicker label="Header media" accept={config.headerMediaType === 'video' ? 'video/*' : config.headerMediaType === 'document' ? '*/*' : 'image/*'} value={config.headerMediaUrl} onChange={(value) => set('headerMediaUrl', value)} error={errors.headerMediaUrl} />
        </>}
      </Section>
      <Section title="Message body"><MessageField value={config.message || ''} onChange={(value) => set('message', value)} error={errors.message} /></Section>
      <Section title="Footer">{field('footer', 'Footer text', { inputProps: { maxLength: 60 }, helperText: `${(config.footer || '').length} / 60` })}</Section>
      <Section title="Buttons" description="Each button uses a stable payload ID and can run its own action."><ButtonEditor value={config.buttons} onChange={(value) => set('buttons', value)} errors={errors} options={actionOptions} /></Section>
    </>;
  } else if (type === 'text_message') {
    form = <Section title="Text message"><MessageField value={config.message || ''} onChange={(value) => set('message', value)} error={errors.message} emoji /></Section>;
  } else if (type === 'image_message') {
    form = <><Section title="Image"><ImageSourceEditor config={config} set={set} errors={errors} /></Section><Section title="Caption"><MessageField label="Caption" value={config.caption || ''} onChange={(value) => set('caption', value)} maxLength={1024} /></Section></>;
  } else if (type === 'video_message') {
    form = <><Section title="Video"><MediaPicker label="Video" accept="video/*" value={config.mediaUrl} onChange={(value) => set('mediaUrl', value)} error={errors.mediaUrl} /></Section><Section title="Caption"><MessageField label="Caption" value={config.caption || ''} onChange={(value) => set('caption', value)} maxLength={1024} /></Section></>;
  } else if (type === 'file_document') {
    form = <><Section title="Document"><MediaPicker label="File" accept="*/*" value={config.fileUrl} onChange={(value) => set('fileUrl', value)} error={errors.fileUrl} onFileName={(value) => set('fileName', value)} fileNameField={field('fileName', 'Filename')} /></Section><Section title="Caption"><MessageField label="Caption" value={config.caption || ''} onChange={(value) => set('caption', value)} maxLength={1024} /></Section></>;
  } else if (type === 'audio_message') {
    form = <Section title="Audio"><MediaPicker label="Audio" accept="audio/*" value={config.mediaUrl} onChange={(value) => set('mediaUrl', value)} error={errors.mediaUrl} /></Section>;
  } else if (type === 'ai_reply') {
    form = <><Section title="AI instructions"><MessageField label="Prompt" value={config.prompt || ''} onChange={(value) => set('prompt', value)} error={errors.prompt} maxLength={4000} /><Stack direction="row" flexWrap="wrap"><FormControlLabel control={<Checkbox checked={(config.contextSources || []).includes('conversation_history')} onChange={(event) => set('contextSources', event.target.checked ? [...new Set([...(config.contextSources || []), 'conversation_history'])] : (config.contextSources || []).filter((item) => item !== 'conversation_history'))} />} label="Conversation history" /><FormControlLabel control={<Checkbox checked={(config.contextSources || []).includes('lead_profile')} onChange={(event) => set('contextSources', event.target.checked ? [...new Set([...(config.contextSources || []), 'lead_profile'])] : (config.contextSources || []).filter((item) => item !== 'lead_profile'))} />} label="Lead profile" /></Stack></Section><Section title="Fallback"><MessageField label="Fallback response" value={config.fallbackMessage || ''} onChange={(value) => set('fallbackMessage', value)} error={errors.fallbackMessage} /></Section></>;
  } else if (type === 'assign') {
    form = <Section title="Assignment">{field('departmentId', 'Department', { select: true, children: [<MenuItem key="none" value="">No department</MenuItem>, ...departments.map((item) => <MenuItem key={item.id} value={item.id}>{item.name}</MenuItem>)] })}{field('assignedAgentId', 'User', { select: true, children: [<MenuItem key="none" value="">No specific user</MenuItem>, ...users.map((item) => <MenuItem key={item.id} value={item.id}>{item.name || [item.firstName, item.lastName].filter(Boolean).join(' ') || item.email}</MenuItem>)] })}{errors.assignment && <Alert severity="error">{errors.assignment}</Alert>}<FormControlLabel control={<Checkbox checked={Boolean(config.notifyAssignee)} onChange={(event) => set('notifyAssignee', event.target.checked)} />} label="Notify assigned user" /></Section>;
  } else if (type === 'delay_wait') {
    form = <Section title="Wait before continuing"><Grid container spacing={1.5}><Grid item xs={7}>{field('amount', 'Wait value', { type: 'number', inputProps: { min: 1 } })}</Grid><Grid item xs={5}>{field('unit', 'Unit', { select: true, children: ['minutes', 'hours', 'days'].map((value) => <MenuItem key={value} value={value}>{value}</MenuItem>) })}</Grid></Grid></Section>;
  } else if (type === 'user_input') {
    form = <><Section title="Question"><MessageField value={config.question || ''} onChange={(value) => set('question', value)} error={errors.question} /></Section><Section title="Store the answer">{field('saveAs', 'Save answer field', { placeholder: 'custom.answer' })}{field('timeoutMinutes', 'Timeout (minutes)', { type: 'number', inputProps: { min: 1 } })}</Section></>;
  } else if (['button_message', 'list_message'].includes(type)) {
    form = <><Section title="Message body"><MessageField value={config.message || ''} onChange={(value) => set('message', value)} error={errors.message} /></Section>{type === 'button_message' ? <Section title="Buttons"><ButtonEditor value={config.buttons} onChange={(value) => set('buttons', value)} errors={errors} options={actionOptions} /></Section> : <Section title="List options"><ButtonEditor value={config.rows} onChange={(value) => set('rows', value)} errors={{ ...errors, buttons: errors.rows }} options={actionOptions} />{field('sectionTitle', 'Section title')}{field('buttonText', 'Menu button text')}</Section>}</>;
  } else if (type === 'location') {
    form = <Section title="Location">{field('latitude', 'Latitude')}{field('longitude', 'Longitude')}{field('name', 'Location name')}{field('address', 'Address')}</Section>;
  } else if (type === 'whatsapp_flow') {
    form = <Section title="WhatsApp Flow">{field('message', 'Message', { multiline: true, minRows: 3 })}{field('flowId', 'Meta Flow ID')}{field('flowToken', 'Flow token')}{field('screen', 'Initial screen')}</Section>;
  } else if (type === 'appointment_booking') {
    form = <Section title="Appointment">{field('message', 'Prompt', { multiline: true })}<OptionEditor label="Available slots" value={config.slots} onChange={(value) => set('slots', value)} /></Section>;
  } else if (['add_label', 'remove_label'].includes(type)) {
    form = <Section title="Contact tag">{field('label', 'Tag')}</Section>;
  } else if (type === 'update_lead') {
    form = <Section title="Lead updates">{field('status', 'Lead status')}{field('source', 'Lead source')}{field('notes', 'Note', { multiline: true })}{field('courseInterested', 'Course')}{field('batchInterested', 'Batch')}</Section>;
  } else {
    form = <Alert severity="info">This block does not need additional configuration.</Alert>;
  }

  return (
    <Dialog
      open={open}
      onClose={(_, reason) => { if (reason !== 'backdropClick') requestClose(); }}
      fullWidth
      maxWidth="lg"
      PaperProps={{ sx: { height: 'min(88vh, 920px)', borderRadius: 3 } }}
    >
      <DialogTitle sx={{ borderBottom: '1px solid', borderColor: 'divider' }}>
        <Stack direction="row" alignItems="center" spacing={1}>
          <Box flex={1}><Typography variant="h6" fontWeight={900}>Configure {node.data.label}</Typography><Typography variant="body2" color="text.secondary">Changes apply to the canvas only after you save.</Typography></Box>
          {dirty && <Chip size="small" color="warning" label="Unsaved changes" />}
          <IconButton onClick={requestClose}><CloseIcon /></IconButton>
        </Stack>
      </DialogTitle>
      <DialogContent sx={{ p: 0, overflow: 'hidden' }}>
        <Grid container sx={{ height: '100%' }}>
          <Grid item xs={12} md={7} sx={{ height: '100%', overflowY: 'auto', p: { xs: 2, md: 3 } }}>
            <Stack spacing={2}>
              <TextField label="Node title" value={label} onChange={(event) => setLabel(event.target.value)} error={Boolean(errors.label)} helperText={errors.label} fullWidth />
              {errors.form && <Alert severity="error">{errors.form}</Alert>}
              <Divider />
              {form}
            </Stack>
          </Grid>
          <Grid item md={5} sx={{ display: { xs: 'none', md: 'block' }, height: '100%', overflowY: 'auto', bgcolor: '#f7f8f7', p: 3 }}>
            <WhatsAppPreview type={type} config={config} label={label} />
          </Grid>
        </Grid>
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 2, borderTop: '1px solid', borderColor: 'divider' }}>
        <Button color="error" startIcon={<DeleteOutlineIcon />} onClick={onDelete} sx={{ mr: 'auto' }}>Delete Node</Button>
        <Button color="inherit" onClick={requestClose}>Close</Button>
        <Button variant="contained" onClick={save} disabled={saving}>{saving ? 'Saving...' : 'Save Changes'}</Button>
      </DialogActions>
    </Dialog>
  );
}
