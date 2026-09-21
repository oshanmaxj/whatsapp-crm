import React, { useEffect, useState } from 'react';
import {
  Alert, Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle,
  MenuItem, Paper, Select, Stack, Table, TableBody, TableCell, TableContainer,
  TableHead, TableRow, TextField, Typography
} from '@mui/material';
import ReplyIcon from '@mui/icons-material/Reply';
import { getFacebookPages } from '../services/facebookPage.service';
import { getFacebookComments, replyToFacebookComment } from '../services/facebookComment.service';

export default function FacebookCommentsPage() {
  const [pages, setPages] = useState([]);
  const [pageFilter, setPageFilter] = useState('');
  const [comments, setComments] = useState([]);
  const [message, setMessage] = useState(null);
  const [replying, setReplying] = useState(null);
  const [replyText, setReplyText] = useState('');
  const [busy, setBusy] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);

  const load = () => getFacebookComments(pageFilter || null).then((response) => setComments(response.data.data || []))
    .catch((error) => setMessage({ severity: 'error', text: error.response?.data?.message || 'Unable to load Facebook comments.' }))
    .finally(() => setHasLoaded(true));

  useEffect(() => { getFacebookPages().then((response) => setPages(response.data.data || [])).catch(() => null); }, []);
  useEffect(() => { load(); }, [pageFilter]);

  const beginReply = (comment) => { setReplying(comment); setReplyText(''); };

  const sendReply = async () => {
    if (!replying || !replyText.trim()) return;
    try {
      setBusy(true);
      await replyToFacebookComment(replying.id, replyText.trim());
      await load();
      setReplying(null);
      setMessage({ severity: 'success', text: 'Reply sent.' });
    } catch (error) {
      setMessage({ severity: 'error', text: error.response?.data?.message || error.message });
    } finally { setBusy(false); }
  };

  const pageName = (id) => pages.find((page) => String(page.id) === String(id))?.name || '—';

  return (
    <Stack spacing={2.5}>
      {message && <Alert severity={message.severity} onClose={() => setMessage(null)}>{message.text}</Alert>}
      <Stack direction={{ xs: 'column', sm: 'row' }} alignItems={{ sm: 'center' }} spacing={2}>
        <Box flex={1}>
          <Typography variant="h4" fontWeight={900}>Facebook Comments</Typography>
          <Typography color="text.secondary">Review and reply to comments on connected Facebook Pages.</Typography>
        </Box>
        <Select size="small" displayEmpty value={pageFilter} onChange={(event) => setPageFilter(event.target.value)} sx={{ minWidth: 220 }}>
          <MenuItem value="">All Pages</MenuItem>
          {pages.map((page) => <MenuItem key={page.id} value={page.id}>{page.name}</MenuItem>)}
        </Select>
      </Stack>
      <TableContainer component={Paper} variant="outlined">
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>Page</TableCell><TableCell>Post</TableCell><TableCell>Commenter</TableCell>
              <TableCell>Comment</TableCell><TableCell>Time</TableCell><TableCell>Assigned</TableCell>
              <TableCell>Reply status</TableCell><TableCell align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {comments.map((comment) => (
              <TableRow key={comment.id}>
                <TableCell>{pageName(comment.facebookPageId)}</TableCell>
                <TableCell><Typography variant="caption" color="text.secondary">{comment.metaPostId}</Typography>{comment.parentCommentId && <Chip size="small" sx={{ ml: 0.5 }} label="Reply" />}</TableCell>
                <TableCell>{comment.contact ? `${comment.contact.firstName || ''} ${comment.contact.lastName || ''}`.trim() : 'Facebook user'}</TableCell>
                <TableCell sx={{ maxWidth: 320 }}><Typography noWrap>{comment.message || '—'}</Typography></TableCell>
                <TableCell><Typography variant="caption">{comment.createdTime ? new Date(comment.createdTime).toLocaleString() : '—'}</Typography></TableCell>
                <TableCell>{comment.assignedUser ? `${comment.assignedUser.firstName || ''} ${comment.assignedUser.lastName || ''}`.trim() : 'Unassigned'}</TableCell>
                <TableCell><Chip size="small" color={comment.replied ? 'success' : 'default'} label={comment.replied ? 'Replied' : comment.deleted ? 'Deleted' : 'Awaiting reply'} /></TableCell>
                <TableCell align="right">
                  {!comment.deleted && <Button size="small" startIcon={<ReplyIcon />} onClick={() => beginReply(comment)}>Reply</Button>}
                </TableCell>
              </TableRow>
            ))}
            {hasLoaded && !comments.length && <TableRow><TableCell colSpan={8} align="center">No Facebook comments yet.</TableCell></TableRow>}
          </TableBody>
        </Table>
      </TableContainer>
      <Dialog open={Boolean(replying)} onClose={() => setReplying(null)} fullWidth maxWidth="sm">
        <DialogTitle>Reply to comment</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <Alert severity="info">"{replying?.message}"</Alert>
            <TextField label="Your reply" multiline minRows={3} value={replyText} onChange={(event) => setReplyText(event.target.value)} autoFocus />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setReplying(null)}>Cancel</Button>
          <Button variant="contained" disabled={busy || !replyText.trim()} onClick={sendReply}>Send reply</Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}
