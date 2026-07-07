import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert, Box, Button, Card, CardActionArea, Checkbox, Chip, Dialog, DialogActions,
  DialogContent, DialogTitle, Divider, FormControlLabel, Grid, IconButton, MenuItem,
  Paper, Stack, TextField, Typography
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import InsertEmoticonIcon from '@mui/icons-material/InsertEmoticon';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import { uploadFlowMedia } from '../../services/flowBuilder.service';
import { FLOW_VARIABLES, nodeConfigErrors, normalizeKeywords } from './flowBuilderConfig';

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

function ButtonEditor({ value, onChange, errors }) {
  const rows = Array.isArray(value) ? value : [];
  const add = (actionType) => {
    const number = rows.length + 1;
    onChange([...rows, {
      id: `option_${number}`,
      payload: `option_${number}`,
      title: actionType === 'reply' ? `Option ${number}` : actionType === 'url' ? 'Visit website' : 'Call us',
      actionType,
      url: '',
      phone: ''
    }]);
  };
  const update = (index, patch) => onChange(rows.map((row, itemIndex) => itemIndex === index ? { ...row, ...patch } : row));
  return (
    <Stack spacing={1.25}>
      {rows.map((row, index) => {
        const type = row.actionType || 'reply';
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
                onChange={(event) => update(index, { actionType: event.target.value })}
                sx={{ minWidth: 140 }}
              >
                <MenuItem value="reply">Quick reply</MenuItem>
                <MenuItem value="url">Open URL</MenuItem>
                <MenuItem value="phone">Call phone</MenuItem>
              </TextField>
              <TextField
                size="small"
                label={type === 'url' ? 'URL' : type === 'phone' ? 'Phone' : 'Payload'}
                value={type === 'url' ? row.url || '' : type === 'phone' ? row.phone || '' : row.payload || row.id || ''}
                onChange={(event) => {
                  const field = type === 'url' ? 'url' : type === 'phone' ? 'phone' : 'payload';
                  const patch = { [field]: event.target.value };
                  if (type === 'reply') patch.id = event.target.value;
                  update(index, patch);
                }}
                error={Boolean(errors[`button_${index}_value`])}
                helperText={errors[`button_${index}_value`]}
                fullWidth
              />
              <IconButton color="error" onClick={() => onChange(rows.filter((_, itemIndex) => itemIndex !== index))} aria-label="Delete button">
                <DeleteOutlineIcon />
              </IconButton>
            </Stack>
          </Paper>
        );
      })}
      {errors.buttons && <Alert severity="error">{errors.buttons}</Alert>}
      <Stack direction="row" gap={1} flexWrap="wrap">
        <Button size="small" variant="outlined" onClick={() => add('reply')}>Add Quick Reply</Button>
        <Button size="small" variant="outlined" onClick={() => add('url')}>Add URL Button</Button>
        <Button size="small" variant="outlined" onClick={() => add('phone')}>Add Phone Button</Button>
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

export default function FlowNodeConfigDialog({ node, open, onClose, onSave, onDelete, departments = [], users = [], flowId }) {
  const [label, setLabel] = useState('');
  const [config, setConfig] = useState({});
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const initialRef = useRef('');

  useEffect(() => {
    if (!node || !open) return;
    const nextConfig = clone(node.data.config);
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
    form = <Section title="Flow trigger">{field('source', 'Start flow from', { select: true, children: ['inbound_message', 'template_button_reply', 'interactive_button_reply', 'list_reply', 'campaign_response', 'manual'].map((value) => <MenuItem key={value} value={value}>{value.replaceAll('_', ' ')}</MenuItem>) })}<TextField label="Trigger keywords" value={Array.isArray(config.keywords) ? config.keywords.join(', ') : config.keywords || ''} onChange={(event) => set('keywords', normalizeKeywords(event.target.value))} error={Boolean(errors.keywords)} helperText={errors.keywords || 'Separate keywords with commas.'} fullWidth />{field('matchType', 'Keyword matching', { select: true, children: [['exact', 'Exact match'], ['contains', 'Contains'], ['starts_with', 'Starts with']].map(([value, text]) => <MenuItem key={value} value={value}>{text}</MenuItem>) })}</Section>;
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
      <Section title="Buttons" description="Each button creates an output handle on the node after you save."><ButtonEditor value={config.buttons} onChange={(value) => set('buttons', value)} errors={errors} /></Section>
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
    form = <><Section title="Message body"><MessageField value={config.message || ''} onChange={(value) => set('message', value)} error={errors.message} /></Section>{type === 'button_message' ? <Section title="Buttons"><ButtonEditor value={config.buttons} onChange={(value) => set('buttons', value)} errors={errors} /></Section> : <Section title="List options"><OptionEditor label="Rows" value={config.rows} onChange={(value) => set('rows', value)} error={errors.rows} />{field('sectionTitle', 'Section title')}{field('buttonText', 'Menu button text')}</Section>}</>;
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
