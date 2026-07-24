import React, { useEffect, useState } from 'react';
import { Box, Button, CircularProgress, Stack, Typography } from '@mui/material';
import InsertDriveFileOutlinedIcon from '@mui/icons-material/InsertDriveFileOutlined';
import api from '../../services/api';
import { resolveMediaUrl } from './chatUtils';

const CACHE_RELEASE_DELAY_MS = 30000;
const mediaCache = new Map();

function isBinaryContentType(value) {
  const type = String(value || '').toLowerCase().split(';')[0].trim();
  return Boolean(type) && !['application/json', 'text/html', 'text/plain'].includes(type);
}

function createEntry(source) {
  const entry = { promise: null, url: null, references: 0, releaseTimer: null };
  entry.promise = api.get(source.replace(/^\/api/, ''), { responseType: 'blob' })
    .then((response) => {
      if (response.status < 200 || response.status >= 300) throw new Error(`Media request failed with status ${response.status}.`);
      if (!isBinaryContentType(response.headers?.['content-type'] || response.data?.type)) {
        throw new Error('Media endpoint did not return binary content.');
      }
      entry.url = URL.createObjectURL(response.data);
      return entry.url;
    })
    .catch((error) => {
      if (mediaCache.get(source) === entry) mediaCache.delete(source);
      throw error;
    });
  mediaCache.set(source, entry);
  return entry;
}

export function acquireAuthenticatedMedia(source, { reload = false } = {}) {
  if (!source) return Promise.reject(new Error('Media source is required.'));
  let entry = mediaCache.get(source);
  if (reload && entry) {
    if (entry.releaseTimer) window.clearTimeout(entry.releaseTimer);
    if (entry.url) URL.revokeObjectURL(entry.url);
    mediaCache.delete(source);
    entry = null;
  }
  entry = entry || createEntry(source);
  if (entry.releaseTimer) window.clearTimeout(entry.releaseTimer);
  entry.releaseTimer = null;
  entry.references += 1;
  return entry.promise;
}

export function releaseAuthenticatedMedia(source) {
  const entry = mediaCache.get(source);
  if (!entry) return;
  entry.references = Math.max(0, entry.references - 1);
  if (entry.references || entry.releaseTimer) return;
  entry.releaseTimer = window.setTimeout(() => {
    if (entry.references || mediaCache.get(source) !== entry) return;
    if (entry.url) URL.revokeObjectURL(entry.url);
    mediaCache.delete(source);
  }, CACHE_RELEASE_DELAY_MS);
}

export function clearAuthenticatedMediaCache() {
  for (const entry of mediaCache.values()) {
    if (entry.releaseTimer) window.clearTimeout(entry.releaseTimer);
    if (entry.url) URL.revokeObjectURL(entry.url);
  }
  mediaCache.clear();
}

export default function AuthenticatedMedia({ source, mediaType, fileName = 'Open document', alt = 'Message attachment', onMediaLoad }) {
  const protectedSource = String(source || '').startsWith('/api/media/');
  const displaySource = protectedSource ? '' : resolveMediaUrl(source);
  const [retry, setRetry] = useState(0);
  const [state, setState] = useState({ src: displaySource, loading: protectedSource, error: null });

  useEffect(() => {
    let active = true;
    if (!source) {
      setState({ src: '', loading: false, error: null });
      return undefined;
    }
    if (!protectedSource) {
      setState({ src: displaySource, loading: false, error: null });
      return undefined;
    }
    setState({ src: '', loading: true, error: null });
    acquireAuthenticatedMedia(source, { reload: retry > 0 })
      .then((url) => active && setState({ src: url, loading: false, error: null }))
      .catch(() => active && setState({ src: '', loading: false, error: 'Media is temporarily unavailable.' }));
    return () => {
      active = false;
      releaseAuthenticatedMedia(source);
    };
  }, [source, protectedSource, displaySource, retry]);

  if (!source) return null;
  if (state.loading) return <Stack direction="row" spacing={1} alignItems="center" sx={{ py: 1 }}><CircularProgress size={18} /><Typography variant="caption">Loading media…</Typography></Stack>;
  if (state.error) return <Stack direction="row" spacing={1} alignItems="center" sx={{ py: 0.5 }}><Typography variant="caption" color="text.secondary">{state.error}</Typography><Button size="small" onClick={() => setRetry((value) => value + 1)}>Retry</Button></Stack>;
  const fail = () => setState({ src: '', loading: false, error: 'Media could not be displayed.' });
  if (mediaType === 'image' || mediaType === 'sticker') return <Box component="img" src={state.src} alt={alt} loading="lazy" onLoad={onMediaLoad} onError={fail} sx={{ display: 'block', width: '100%', maxHeight: 340, objectFit: 'cover', borderRadius: 1.5, mb: 0.75 }} />;
  if (mediaType === 'video') return <Box component="video" src={state.src} controls preload="metadata" onLoadedMetadata={onMediaLoad} onError={fail} sx={{ display: 'block', width: '100%', maxHeight: 340, borderRadius: 1.5, mb: 0.75 }} />;
  if (mediaType === 'audio' || mediaType === 'voice') return <Box component="audio" src={state.src} controls preload="metadata" onLoadedMetadata={onMediaLoad} onError={fail} sx={{ display: 'block', width: '100%', minWidth: { xs: 180, sm: 250 }, maxWidth: '100%', my: 0.5 }} />;
  return <Button href={state.src} target="_blank" rel="noreferrer" variant="outlined" size="small" startIcon={<InsertDriveFileOutlinedIcon />} sx={{ my: 0.5, bgcolor: 'rgba(255,255,255,.45)' }}>{fileName}</Button>;
}
