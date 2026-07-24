import React, { useEffect, useRef, useState } from 'react';
import { Box, Button, CircularProgress, Stack, Typography } from '@mui/material';
import InsertDriveFileOutlinedIcon from '@mui/icons-material/InsertDriveFileOutlined';
import api from '../../services/api';
import { resolveMediaUrl } from './chatUtils';

const CACHE_RELEASE_DELAY_MS = 30000;
const MAX_DOWNLOADS = 4;
const MAX_RETRIES = 2;
const mediaCache = new Map();
const downloadQueue = [];
let activeDownloads = 0;

function drainQueue() {
  while (activeDownloads < MAX_DOWNLOADS && downloadQueue.length) {
    downloadQueue.sort((a, b) => Number(b.priority) - Number(a.priority));
    const job = downloadQueue.shift();
    activeDownloads += 1;
    job.run().finally(() => {
      activeDownloads -= 1;
      drainQueue();
    });
  }
}

function schedule(run, priority = 0) {
  return new Promise((resolve, reject) => {
    downloadQueue.push({ priority, run: () => run().then(resolve, reject) });
    drainQueue();
  });
}

function isBinaryContentType(value) {
  const type = String(value || '').toLowerCase().split(';')[0].trim();
  return Boolean(type) && !['application/json', 'text/html', 'text/plain'].includes(type);
}

function mediaIdFromSource(source) {
  return String(source || '').match(/\/media\/([^/]+)\/download/)?.[1] || String(source || '');
}

function diagnostic(source, response, error) {
  const headers = response?.headers || error?.response?.headers || {};
  return {
    mediaId: mediaIdFromSource(source),
    status: response?.status || error?.response?.status || 'NETWORK_ERROR',
    contentType: headers['content-type'] || null,
    contentLength: headers['content-length'] || response?.data?.size || null,
    requestId: headers['x-request-id'] || headers['request-id'] || null
  };
}

async function requestBlob(source) {
  let lastError;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    if (attempt) await new Promise((resolve) => window.setTimeout(resolve, 250 * (2 ** (attempt - 1))));
    try {
      const response = await api.get(source.replace(/^\/api/, ''), { responseType: 'blob' });
      const contentType = response.headers?.['content-type'] || response.data?.type;
      const declaredLength = response.headers?.['content-length'];
      if (response.status < 200 || response.status >= 300) throw new Error(`Media request failed with status ${response.status}.`);
      if (!isBinaryContentType(contentType)) {
        const error = new Error('Media endpoint did not return binary content.');
        error.nonRetryable = true;
        error.mediaResponse = response;
        throw error;
      }
      if (!response.data?.size || (declaredLength && Number(declaredLength) !== response.data.size)) {
        const error = new Error('Media endpoint returned an empty or incomplete body.');
        error.nonRetryable = true;
        error.mediaResponse = response;
        throw error;
      }
      return response.data;
    } catch (error) {
      lastError = error;
      if (error.nonRetryable || attempt === MAX_RETRIES || (error.response?.status >= 400 && error.response?.status < 500 && error.response?.status !== 401)) break;
    }
  }
  // One concise diagnostic after the bounded retry sequence; never log the URL or token.
  console.warn('authenticated_media_failed', diagnostic(source, lastError?.mediaResponse, lastError));
  throw lastError;
}

function createEntry(source, priority) {
  const entry = { promise: null, url: null, references: 0, releaseTimer: null, failed: false };
  entry.promise = schedule(() => requestBlob(source), priority)
    .then((blob) => {
      entry.url = URL.createObjectURL(blob);
      return entry.url;
    })
    .catch((error) => {
      entry.failed = true;
      if (mediaCache.get(source) === entry) mediaCache.delete(source);
      throw error;
    });
  mediaCache.set(source, entry);
  return entry;
}

export function acquireAuthenticatedMedia(source, { reload = false, priority = 0 } = {}) {
  if (!source) return Promise.reject(new Error('Media source is required.'));
  let entry = mediaCache.get(source);
  // Never replace/revoke an entry which another mounted component owns.
  if (reload && entry && entry.references === 0) {
    if (entry.releaseTimer) window.clearTimeout(entry.releaseTimer);
    if (entry.url) URL.revokeObjectURL(entry.url);
    mediaCache.delete(source);
    entry = null;
  }
  entry = entry || createEntry(source, priority);
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
  downloadQueue.splice(0);
  activeDownloads = 0;
}

export default function AuthenticatedMedia({ source, mediaType, fileName = 'Open document', alt = 'Message attachment', onMediaLoad }) {
  const protectedSource = String(source || '').startsWith('/api/media/');
  const displaySource = protectedSource ? '' : resolveMediaUrl(source);
  const [retry, setRetry] = useState(0);
  const [visible, setVisible] = useState(!protectedSource);
  const [state, setState] = useState({ src: displaySource, loading: protectedSource, error: null });
  const rootRef = useRef(null);

  useEffect(() => {
    if (!protectedSource || visible) return undefined;
    const node = rootRef.current;
    if (!node || !window.IntersectionObserver) { setVisible(true); return undefined; }
    const observer = new window.IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) { setVisible(true); observer.disconnect(); }
    }, { rootMargin: '240px 0px' });
    observer.observe(node);
    return () => observer.disconnect();
  }, [protectedSource, visible]);

  useEffect(() => {
    let active = true;
    if (!source) { setState({ src: '', loading: false, error: null }); return undefined; }
    if (!protectedSource) { setState({ src: displaySource, loading: false, error: null }); return undefined; }
    if (!visible) return undefined;
    setState({ src: '', loading: true, error: null });
    acquireAuthenticatedMedia(source, { reload: retry > 0, priority: 1 })
      .then((url) => active && setState({ src: url, loading: false, error: null }))
      .catch(() => active && setState({ src: '', loading: false, error: 'Media is temporarily unavailable.' }));
    return () => { active = false; releaseAuthenticatedMedia(source); };
  }, [source, protectedSource, displaySource, retry, visible]);

  if (!source) return null;
  if (!visible || state.loading) return <Stack ref={rootRef} direction="row" spacing={1} alignItems="center" sx={{ py: 1, minHeight: 48 }}><CircularProgress size={18} /><Typography variant="caption">Loading media…</Typography></Stack>;
  if (state.error) return <Stack ref={rootRef} direction="row" spacing={1} alignItems="center" sx={{ py: 0.5 }}><Typography variant="caption" color="text.secondary">{state.error}</Typography>{retry < 2 && <Button size="small" onClick={() => setRetry((value) => value + 1)}>Retry</Button>}</Stack>;
  const fail = () => setState({ src: '', loading: false, error: 'Media could not be displayed.' });
  if (mediaType === 'image' || mediaType === 'sticker') return <Box ref={rootRef} component="img" src={state.src} alt={alt} loading="lazy" onLoad={onMediaLoad} onError={fail} sx={{ display: 'block', width: '100%', maxHeight: 340, objectFit: 'cover', borderRadius: 1.5, mb: 0.75 }} />;
  if (mediaType === 'video') return <Box ref={rootRef} component="video" src={state.src} controls preload="metadata" onLoadedMetadata={onMediaLoad} onError={fail} sx={{ display: 'block', width: '100%', maxHeight: 340, borderRadius: 1.5, mb: 0.75 }} />;
  if (mediaType === 'audio' || mediaType === 'voice') return <Box ref={rootRef} component="audio" src={state.src} controls preload="metadata" onLoadedMetadata={onMediaLoad} onError={fail} sx={{ display: 'block', width: '100%', minWidth: { xs: 180, sm: 250 }, maxWidth: '100%', my: 0.5 }} />;
  return <Button ref={rootRef} href={state.src} target="_blank" rel="noreferrer" variant="outlined" size="small" startIcon={<InsertDriveFileOutlinedIcon />} sx={{ my: 0.5, bgcolor: 'rgba(255,255,255,.45)' }}>{fileName}</Button>;
}
