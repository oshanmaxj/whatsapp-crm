import React, { useEffect, useState } from 'react';
import {
  Alert, Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle,
  FormControlLabel, IconButton, MenuItem, Paper, Select, Stack, Switch, Tab, Table, TableBody,
  TableCell, TableContainer, TableHead, TableRow, Tabs, TextField, Tooltip, Typography
} from '@mui/material';
import ReplyIcon from '@mui/icons-material/Reply';
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff';
import VisibilityIcon from '@mui/icons-material/Visibility';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import AddIcon from '@mui/icons-material/Add';
import { getFacebookPages } from '../services/facebookPage.service';
import {
  getFacebookComments, replyToFacebookComment, hideFacebookComment, unhideFacebookComment,
  retryFacebookCommentAutoHide
} from '../services/facebookComment.service';
import {
  listAutoHideRules, createAutoHideRule, updateAutoHideRule, deleteAutoHideRule,
  getAutoHideSettings, updateAutoHideSettings
} from '../services/facebookCommentAutoHideRule.service';
import { hasPermission } from '../utils/access';

const MATCH_TYPE_LABELS = { contains: 'Contains', exact: 'Exact', starts_with: 'Starts with', ends_with: 'Ends with' };
const emptyRuleForm = { keyword: '', matchType: 'contains', caseSensitive: false, enabled: true, facebookPageId: '' };

function AutoHideStatusIndicator({ comment, canHide, onRetry, busy }) {
  if (!comment.autoHideMatched) return null;
  if (comment.autoHideStatus === 'hidden') {
    return (
      <Tooltip title={`Matched keyword: "${comment.autoHideKeyword}"`}>
        <Chip size="small" color="warning" icon={<VisibilityOffIcon />} label="Auto Hidden" sx={{ mt: 0.5 }} />
      </Tooltip>
    );
  }
  if (comment.autoHideStatus === 'failed') {
    return (
      <Stack direction="row" spacing={0.5} alignItems="center" sx={{ mt: 0.5 }}>
        <Tooltip title={`Matched keyword: "${comment.autoHideKeyword}"`}><Chip size="small" color="error" label="Auto Hide Failed" /></Tooltip>
        {canHide && <Button size="small" disabled={busy} onClick={onRetry}>Retry</Button>}
      </Stack>
    );
  }
  if (comment.autoHideStatus === 'pending') {
    return <Chip size="small" color="info" label="Auto Hide Pending" sx={{ mt: 0.5 }} />;
  }
  return null;
}

function AutoHideRulesPanel({ pages, message, setMessage }) {
  const canManage = hasPermission('facebook-comment-auto-hide.manage');
  const [rules, setRules] = useState([]);
  const [globalEnabled, setGlobalEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingRule, setEditingRule] = useState(null);
  const [form, setForm] = useState(emptyRuleForm);

  const load = () => Promise.all([listAutoHideRules(), getAutoHideSettings()])
    .then(([rulesRes, settingsRes]) => {
      setRules(rulesRes.data.data || []);
      setGlobalEnabled(Boolean(settingsRes.data.data?.enabled));
    })
    .catch((error) => setMessage({ severity: 'error', text: error.response?.data?.message || 'Unable to load Auto Hide rules.' }));

  useEffect(() => { load(); }, []);

  const toggleGlobal = async (event) => {
    const next = event.target.checked;
    setBusy(true);
    try {
      await updateAutoHideSettings(next);
      setGlobalEnabled(next);
      setMessage({ severity: 'success', text: `Global Auto Hide turned ${next ? 'ON' : 'OFF'}.` });
    } catch (error) {
      setMessage({ severity: 'error', text: error.response?.data?.message || 'Unable to update the global Auto Hide setting.' });
    } finally { setBusy(false); }
  };

  const beginCreate = () => { setEditingRule(null); setForm(emptyRuleForm); setDialogOpen(true); };
  const beginEdit = (rule) => {
    setEditingRule(rule);
    setForm({
      keyword: rule.keyword, matchType: rule.matchType, caseSensitive: rule.caseSensitive,
      enabled: rule.enabled, facebookPageId: rule.facebookPageId || ''
    });
    setDialogOpen(true);
  };

  const saveRule = async () => {
    setBusy(true);
    try {
      const payload = { ...form, facebookPageId: form.facebookPageId || null };
      if (editingRule) await updateAutoHideRule(editingRule.id, payload);
      else await createAutoHideRule(payload);
      await load();
      setDialogOpen(false);
      setMessage({ severity: 'success', text: editingRule ? 'Rule updated.' : 'Rule created.' });
    } catch (error) {
      setMessage({ severity: 'error', text: error.response?.data?.message || error.message });
    } finally { setBusy(false); }
  };

  const toggleRuleEnabled = async (rule) => {
    setBusy(true);
    try { await updateAutoHideRule(rule.id, { enabled: !rule.enabled }); await load(); }
    catch (error) { setMessage({ severity: 'error', text: error.response?.data?.message || error.message }); }
    finally { setBusy(false); }
  };

  const removeRule = async (rule) => {
    if (!window.confirm(`Delete the "${rule.keyword}" rule?`)) return;
    setBusy(true);
    try { await deleteAutoHideRule(rule.id); await load(); setMessage({ severity: 'success', text: 'Rule deleted.' }); }
    catch (error) { setMessage({ severity: 'error', text: error.response?.data?.message || error.message }); }
    finally { setBusy(false); }
  };

  const pageName = (id) => (id ? pages.find((page) => String(page.id) === String(id))?.name || '—' : 'All Pages');

  return (
    <Stack spacing={2.5}>
      <Paper variant="outlined" sx={{ p: 2 }}>
        <FormControlLabel
          control={<Switch checked={globalEnabled} disabled={busy || !canManage} onChange={toggleGlobal} />}
          label={<Typography fontWeight={700}>Global Auto Hide: {globalEnabled ? 'ON' : 'OFF'}</Typography>}
        />
        <Typography variant="body2" color="text.secondary">
          When off, no new comment is ever automatically hidden, even if it matches an enabled rule below.
        </Typography>
      </Paper>

      {canManage && (
        <Box><Button variant="contained" startIcon={<AddIcon />} onClick={beginCreate}>Add Rule</Button></Box>
      )}

      <TableContainer component={Paper} variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Keyword</TableCell><TableCell>Match Type</TableCell><TableCell>Page</TableCell>
              <TableCell>Case Sensitive</TableCell><TableCell>Enabled</TableCell>
              {canManage && <TableCell align="right">Actions</TableCell>}
            </TableRow>
          </TableHead>
          <TableBody>
            {rules.map((rule) => (
              <TableRow key={rule.id}>
                <TableCell>{rule.keyword}</TableCell>
                <TableCell>{MATCH_TYPE_LABELS[rule.matchType] || rule.matchType}</TableCell>
                <TableCell>{pageName(rule.facebookPageId)}</TableCell>
                <TableCell>{rule.caseSensitive ? 'Yes' : 'No'}</TableCell>
                <TableCell><Chip size="small" color={rule.enabled ? 'success' : 'default'} label={rule.enabled ? 'Enabled' : 'Disabled'} /></TableCell>
                {canManage && (
                  <TableCell align="right">
                    <Button size="small" disabled={busy} onClick={() => toggleRuleEnabled(rule)}>{rule.enabled ? 'Disable' : 'Enable'}</Button>
                    <IconButton size="small" disabled={busy} onClick={() => beginEdit(rule)}><EditOutlinedIcon fontSize="small" /></IconButton>
                    <IconButton size="small" disabled={busy} onClick={() => removeRule(rule)}><DeleteOutlineIcon fontSize="small" /></IconButton>
                  </TableCell>
                )}
              </TableRow>
            ))}
            {!rules.length && <TableRow><TableCell colSpan={canManage ? 6 : 5} align="center">No Auto Hide rules configured.</TableCell></TableRow>}
          </TableBody>
        </Table>
      </TableContainer>

      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>{editingRule ? 'Edit Auto Hide Rule' : 'Add Auto Hide Rule'}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <TextField label="Keyword" required value={form.keyword} onChange={(event) => setForm({ ...form, keyword: event.target.value })} autoFocus />
            <TextField select label="Match Type" value={form.matchType} onChange={(event) => setForm({ ...form, matchType: event.target.value })}>
              {Object.entries(MATCH_TYPE_LABELS).map(([value, label]) => <MenuItem key={value} value={value}>{label}</MenuItem>)}
            </TextField>
            <TextField select label="Facebook Page" value={form.facebookPageId} onChange={(event) => setForm({ ...form, facebookPageId: event.target.value })} helperText="Leave as 'All Pages' to apply this rule everywhere.">
              <MenuItem value="">All Pages</MenuItem>
              {pages.map((page) => <MenuItem key={page.id} value={page.id}>{page.name}</MenuItem>)}
            </TextField>
            <FormControlLabel control={<Switch checked={form.caseSensitive} onChange={(event) => setForm({ ...form, caseSensitive: event.target.checked })} />} label="Case sensitive" />
            <FormControlLabel control={<Switch checked={form.enabled} onChange={(event) => setForm({ ...form, enabled: event.target.checked })} />} label="Enabled" />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialogOpen(false)}>Cancel</Button>
          <Button variant="contained" disabled={busy || !form.keyword.trim()} onClick={saveRule}>Save</Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}

export default function FacebookCommentsPage() {
  const canViewAutoHide = hasPermission('facebook-comment-auto-hide.view');
  const canHide = hasPermission('facebook-comments.hide');
  const [tab, setTab] = useState(0);
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

  const runHideAction = async (task, successText) => {
    setBusy(true);
    try { await task(); await load(); setMessage({ severity: 'success', text: successText }); }
    catch (error) { setMessage({ severity: 'error', text: error.response?.data?.message || error.message }); }
    finally { setBusy(false); }
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
        {tab === 0 && (
          <Select size="small" displayEmpty value={pageFilter} onChange={(event) => setPageFilter(event.target.value)} sx={{ minWidth: 220 }}>
            <MenuItem value="">All Pages</MenuItem>
            {pages.map((page) => <MenuItem key={page.id} value={page.id}>{page.name}</MenuItem>)}
          </Select>
        )}
      </Stack>

      {canViewAutoHide && (
        <Tabs value={tab} onChange={(_, value) => setTab(value)}>
          <Tab label="Comments" />
          <Tab label="Auto Hide Rules" />
        </Tabs>
      )}

      {tab === 0 && (
        <>
          <TableContainer component={Paper} variant="outlined">
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell>Page</TableCell><TableCell>Post</TableCell><TableCell>Commenter</TableCell>
                  <TableCell>Comment</TableCell><TableCell>Time</TableCell><TableCell>Assigned</TableCell>
                  <TableCell>Status</TableCell><TableCell align="right">Actions</TableCell>
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
                    <TableCell>
                      <Chip size="small" color={comment.replied ? 'success' : 'default'} label={comment.replied ? 'Replied' : comment.deleted ? 'Deleted' : 'Awaiting reply'} />
                      {comment.hidden && <Chip size="small" sx={{ ml: 0.5, mt: 0.5 }} color="default" icon={<VisibilityOffIcon />} label="Hidden on Facebook" />}
                      <AutoHideStatusIndicator
                        comment={comment} canHide={canHide} busy={busy}
                        onRetry={() => runHideAction(() => retryFacebookCommentAutoHide(comment.id), 'Comment hidden.')}
                      />
                    </TableCell>
                    <TableCell align="right">
                      {!comment.deleted && <Button size="small" startIcon={<ReplyIcon />} onClick={() => beginReply(comment)}>Reply</Button>}
                      {canHide && !comment.deleted && (
                        comment.hidden
                          ? <Button size="small" startIcon={<VisibilityIcon />} disabled={busy} onClick={() => runHideAction(() => unhideFacebookComment(comment.id), 'Comment unhidden.')}>Unhide</Button>
                          : <Button size="small" startIcon={<VisibilityOffIcon />} disabled={busy} onClick={() => runHideAction(() => hideFacebookComment(comment.id), 'Comment hidden.')}>Hide</Button>
                      )}
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
        </>
      )}

      {tab === 1 && canViewAutoHide && <AutoHideRulesPanel pages={pages} message={message} setMessage={setMessage} />}
    </Stack>
  );
}
