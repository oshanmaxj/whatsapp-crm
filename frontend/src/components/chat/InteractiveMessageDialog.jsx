import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, Grid,
  IconButton, LinearProgress, MenuItem, Stack, TextField, Typography
} from '@mui/material';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import { INTERACTIVE_MEDIA_RULES, validateInteractiveDraft } from './interactiveMessageConfig';

const initialDraft = () => ({ body: '', footer: '', headerType: 'none', headerText: '', file: null, preview: '', buttons: [{ id: 'button_1', title: 'Option 1' }] });
const readBase64 = (file) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onerror = () => reject(new Error('Unable to read the selected file.'));
  reader.onload = () => resolve(String(reader.result || '').split(',')[1] || '');
  reader.readAsDataURL(file);
});

export default function InteractiveMessageDialog({ open, onClose, onSend, sending = false }) {
  const [draft, setDraft] = useState(initialDraft);
  const [error, setError] = useState('');
  const [progress, setProgress] = useState(0);
  const [clientRequestId, setClientRequestId] = useState('');
  useEffect(() => {
    if (open) {
      setDraft(initialDraft()); setError(''); setProgress(0);
      setClientRequestId(globalThis.crypto?.randomUUID?.() || `interactive-${Date.now()}`);
    }
  }, [open]);
  useEffect(() => () => { if (draft.preview?.startsWith('blob:')) URL.revokeObjectURL(draft.preview); }, [draft.preview]);
  const errors = useMemo(() => validateInteractiveDraft(draft), [draft]);
  const set = (field, value) => setDraft((current) => ({ ...current, [field]: value }));
  const selectFile = (event) => {
    const file = event.target.files?.[0] || null;
    event.target.value = '';
    if (!file) return;
    setDraft((current) => ({ ...current, file, preview: ['image', 'video'].includes(current.headerType) ? URL.createObjectURL(file) : '' }));
  };
  const submit = async () => {
    if (Object.keys(errors).length) return;
    setError(''); setProgress(1);
    try {
      const header = draft.headerType === 'none' ? null : draft.headerType === 'text'
        ? { type: 'text', text: draft.headerText.trim() }
        : { type: draft.headerType, fileName: draft.file.name, mimeType: draft.file.type, size: draft.file.size, dataBase64: await readBase64(draft.file) };
      await onSend({
        body: draft.body.trim(), footer: draft.footer.trim() || null, header,
        buttons: draft.buttons.map((button, index) => ({ id: button.id || `button_${index + 1}`, title: button.title.trim() })),
        clientRequestId
      }, setProgress);
      onClose();
    } catch (requestError) {
      setError(requestError.response?.data?.message || requestError.message || 'Interactive message failed.');
    } finally { setProgress(0); }
  };
  const rule = INTERACTIVE_MEDIA_RULES[draft.headerType];
  return <Dialog open={open} onClose={sending ? undefined : onClose} maxWidth="sm" fullWidth>
    <DialogTitle>Send interactive WhatsApp message</DialogTitle>
    <DialogContent><Stack spacing={2} sx={{ pt: 1 }}>
      {error && <Alert severity="error">{error}</Alert>}
      <TextField label="Message body" value={draft.body} onChange={(event) => set('body', event.target.value)} error={Boolean(errors.body)} helperText={errors.body} multiline minRows={3} />
      <TextField select label="Header type" value={draft.headerType} onChange={(event) => setDraft((current) => ({ ...current, headerType: event.target.value, headerText: '', file: null, preview: '' }))}>
        <MenuItem value="none">None</MenuItem><MenuItem value="text">Text</MenuItem><MenuItem value="image">Image</MenuItem><MenuItem value="video">Video</MenuItem><MenuItem value="document">Document</MenuItem>
      </TextField>
      {draft.headerType === 'text' && <TextField label="Header text" value={draft.headerText} onChange={(event) => set('headerText', event.target.value.slice(0, 60))} error={Boolean(errors.header)} helperText={errors.header || `${draft.headerText.length} / 60`} />}
      {rule && <Stack spacing={1}>
        <Button component="label" variant="outlined" startIcon={<UploadFileIcon />}>{draft.file ? 'Replace file' : 'Select file'}<input hidden type="file" accept={rule.accept} onChange={selectFile} /></Button>
        <Typography variant="caption" color="text.secondary">Maximum {rule.maxBytes / 1024 / 1024} MB. Media is uploaded using this conversation’s WhatsApp account.</Typography>
        {errors.header && <Alert severity="error">{errors.header}</Alert>}
        {draft.preview && draft.headerType === 'image' && <Box component="img" src={draft.preview} alt="Header preview" sx={{ maxHeight: 180, objectFit: 'contain' }} />}
        {draft.preview && draft.headerType === 'video' && <Box component="video" src={draft.preview} controls sx={{ maxHeight: 220 }} />}
        {draft.file && <Typography variant="body2">{draft.file.name} ({Math.ceil(draft.file.size / 1024)} KB)</Typography>}
      </Stack>}
      <TextField label="Footer (optional)" value={draft.footer} onChange={(event) => set('footer', event.target.value.slice(0, 60))} helperText={`${draft.footer.length} / 60`} />
      <Typography fontWeight={800}>Reply buttons</Typography>
      {draft.buttons.map((button, index) => <Grid container spacing={1} alignItems="center" key={button.id}>
        <Grid item xs><TextField fullWidth label={`Button ${index + 1}`} value={button.title} onChange={(event) => set('buttons', draft.buttons.map((item, itemIndex) => itemIndex === index ? { ...item, title: event.target.value.slice(0, 20) } : item))} /></Grid>
        <Grid item><IconButton color="error" disabled={draft.buttons.length === 1} onClick={() => set('buttons', draft.buttons.filter((_, itemIndex) => itemIndex !== index))}><DeleteOutlineIcon /></IconButton></Grid>
      </Grid>)}
      {errors.buttons && <Alert severity="error">{errors.buttons}</Alert>}
      <Button disabled={draft.buttons.length >= 3} onClick={() => set('buttons', [...draft.buttons, { id: `button_${draft.buttons.length + 1}`, title: `Option ${draft.buttons.length + 1}` }])}>Add button</Button>
      {progress > 0 && <Stack spacing={0.5}><LinearProgress variant="determinate" value={progress} /><Typography variant="caption">Uploading and sending: {progress}%</Typography></Stack>}
    </Stack></DialogContent>
    <DialogActions><Button onClick={onClose} disabled={sending}>Cancel</Button><Button variant="contained" onClick={submit} disabled={sending || Object.keys(errors).length > 0}>{sending ? 'Sending…' : 'Send'}</Button></DialogActions>
  </Dialog>;
}
