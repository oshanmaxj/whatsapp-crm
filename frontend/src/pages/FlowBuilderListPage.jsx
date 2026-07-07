import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Alert, Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, Grid, Paper,
  Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TextField, Typography
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import AnalyticsIcon from '@mui/icons-material/Analytics';
import DeleteIcon from '@mui/icons-material/Delete';
import EditIcon from '@mui/icons-material/Edit';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import RocketLaunchIcon from '@mui/icons-material/RocketLaunch';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import {
  createFlow, deleteFlow, duplicateFlow, getFlowAnalytics, getFlowRuns, getFlows,
  publishFlow, unpublishFlow
} from '../services/flowBuilder.service';
import { normalizeKeywords } from '../components/flow-builder/flowBuilderConfig';

function FlowAnalyticsDialog({ flow, onClose }) {
  const [analytics, setAnalytics] = useState(null);
  const [runs, setRuns] = useState([]);
  const [errorRun, setErrorRun] = useState(null);

  useEffect(() => {
    if (!flow) return;
    Promise.all([getFlowAnalytics(flow.id), getFlowRuns(flow.id)]).then(([analyticsRes, runsRes]) => {
      setAnalytics(analyticsRes.data.data);
      setRuns(runsRes.data.data || []);
    });
  }, [flow]);

  return (
    <Dialog open={!!flow} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>Flow Analytics: {flow?.name}</DialogTitle>
      <DialogContent>
        {analytics && (
          <Grid container spacing={2} sx={{ mb: 2 }}>
            {[
              ['Total Executions', analytics.totalExecutions],
              ['Completed', analytics.completed],
              ['Failed', analytics.failed],
              ['Running', analytics.running]
            ].map(([label, value]) => (
              <Grid item xs={6} md={3} key={label}>
                <Paper variant="outlined" sx={{ p: 2 }}>
                  <Typography variant="h5" fontWeight={850}>{value}</Typography>
                  <Typography color="text.secondary">{label}</Typography>
                </Paper>
              </Grid>
            ))}
          </Grid>
        )}
        <Typography variant="h6" fontWeight={850} sx={{ mb: 1 }}>Recent Runs</Typography>
        <TableContainer>
          <Table size="small">
            <TableHead><TableRow><TableCell>ID</TableCell><TableCell>Status</TableCell><TableCell>Current Node</TableCell><TableCell>Started</TableCell><TableCell align="right">Error</TableCell></TableRow></TableHead>
            <TableBody>{runs.map((run) => <TableRow key={run.id}><TableCell>{run.id}</TableCell><TableCell>{run.status}</TableCell><TableCell>{run.currentNodeKey || '-'}</TableCell><TableCell>{run.startedAt ? new Date(run.startedAt).toLocaleString() : '-'}</TableCell><TableCell align="right">{run.status === 'failed' && <Button size="small" onClick={() => setErrorRun(run)}>View Error</Button>}</TableCell></TableRow>)}</TableBody>
          </Table>
        </TableContainer>
      </DialogContent>
      <DialogActions><Button onClick={onClose}>Close</Button></DialogActions>
      <Dialog open={!!errorRun} onClose={() => setErrorRun(null)} maxWidth="md" fullWidth>
        <DialogTitle>Flow Run Error</DialogTitle>
        <DialogContent>
          {errorRun && <Stack spacing={1.5}>
            <Typography><strong>Run ID:</strong> {errorRun.id}</Typography>
            <Typography><strong>Status:</strong> {errorRun.status}</Typography>
            <Typography><strong>Failed Node:</strong> {errorRun.failedNodeId || errorRun.currentNodeKey || '-'}</Typography>
            <Typography><strong>Node Type:</strong> {errorRun.failedNodeType || '-'}</Typography>
            <Typography><strong>Error Message:</strong> {errorRun.errorMessage || '-'}</Typography>
            <Typography fontWeight={800}>WhatsApp API Response</Typography>
            <Paper variant="outlined" sx={{ p: 1.5, maxHeight: 220, overflow: 'auto', bgcolor: '#fafafa' }}><pre style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{JSON.stringify(errorRun.whatsappApiResponse || {}, null, 2)}</pre></Paper>
            <Typography fontWeight={800}>Payload Sent</Typography>
            <Paper variant="outlined" sx={{ p: 1.5, maxHeight: 220, overflow: 'auto', bgcolor: '#fafafa' }}><pre style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{JSON.stringify(errorRun.payloadSent || {}, null, 2)}</pre></Paper>
          </Stack>}
        </DialogContent>
        <DialogActions><Button onClick={() => setErrorRun(null)}>Close</Button></DialogActions>
      </Dialog>
    </Dialog>
  );
}

function FlowBuilderListPage() {
  const navigate = useNavigate();
  const [flows, setFlows] = useState([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({ name: 'New WhatsApp Flow', description: '', triggerKeywords: 'start' });
  const [analyticsFlow, setAnalyticsFlow] = useState(null);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const load = async () => {
    const res = await getFlows();
    setFlows(res.data.data || []);
  };

  useEffect(() => { load().catch((err) => setError(err.response?.data?.message || 'Unable to load flows.')); }, []);

  const create = async () => {
    const keywords = normalizeKeywords(form.triggerKeywords);
    const res = await createFlow({
      ...form,
      triggerType: 'inbound_message',
      triggerKeywords: keywords,
      triggerConfig: { source: 'inbound_message', keywords, matchType: 'contains', keywordMatchMode: 'contains' }
    });
    setCreateOpen(false);
    navigate(`/flow-builder/${res.data.data.id}`);
  };

  const publish = async (flow) => {
    if (flow.status === 'published') await unpublishFlow(flow.id);
    else await publishFlow(flow.id);
    setNotice(flow.status === 'published' ? 'Flow unpublished.' : 'Flow published.');
    await load();
  };

  const duplicate = async (flow) => {
    await duplicateFlow(flow.id);
    setNotice('Flow duplicated.');
    await load();
  };

  const remove = async (flow) => {
    await deleteFlow(flow.id);
    setNotice('Flow deleted.');
    await load();
  };

  return (
    <Stack spacing={2.5}>
      {notice && <Alert severity="success" onClose={() => setNotice('')}>{notice}</Alert>}
      {error && <Alert severity="error" onClose={() => setError('')}>{error}</Alert>}
      <Paper sx={{ p: 2.5, border: '1px solid', borderColor: 'divider' }} elevation={0}>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} alignItems={{ md: 'center' }}>
          <Box sx={{ flex: 1 }}>
            <Typography variant="h5" fontWeight={850}>WhatsApp Flow Builder</Typography>
            <Typography color="text.secondary">Build ManyChat-style visual automations for WhatsApp conversations.</Typography>
          </Box>
          <Button variant="contained" startIcon={<AddIcon />} onClick={() => setCreateOpen(true)}>Create Flow</Button>
        </Stack>
      </Paper>

      <Paper sx={{ border: '1px solid', borderColor: 'divider', overflow: 'hidden' }} elevation={0}>
        <TableContainer sx={{ overflowX: 'auto' }}>
          <Table>
            <TableHead><TableRow><TableCell>Name</TableCell><TableCell>Trigger</TableCell><TableCell>WhatsApp number</TableCell><TableCell>Status</TableCell><TableCell>Updated</TableCell><TableCell>Runs</TableCell><TableCell align="right">Actions</TableCell></TableRow></TableHead>
            <TableBody>
              {flows.map((flow) => (
                <TableRow key={flow.id} hover>
                  <TableCell><Typography fontWeight={850}>{flow.name}</Typography><Typography variant="body2" color="text.secondary">{flow.description || '-'}</Typography></TableCell>
                  <TableCell>{(flow.triggerKeywords || []).join(', ') || '-'}</TableCell>
                  <TableCell>{flow.whatsappPhoneNumberId || 'Default'}</TableCell>
                  <TableCell><Chip size="small" label={flow.status} color={flow.status === 'published' ? 'success' : 'default'} /></TableCell>
                  <TableCell>{flow.updatedAt ? new Date(flow.updatedAt).toLocaleString() : '-'}</TableCell>
                  <TableCell>{flow.executions || 0}</TableCell>
                  <TableCell align="right">
                    <Button size="small" startIcon={<EditIcon />} component={Link} to={`/flow-builder/${flow.id}`}>Edit</Button>
                    <Button size="small" startIcon={<ContentCopyIcon />} onClick={() => duplicate(flow)}>Duplicate</Button>
                    <Button size="small" startIcon={<RocketLaunchIcon />} onClick={() => publish(flow)}>{flow.status === 'published' ? 'Unpublish' : 'Publish'}</Button>
                    <Button size="small" startIcon={<AnalyticsIcon />} onClick={() => setAnalyticsFlow(flow)}>Analytics</Button>
                    <Button size="small" color="error" startIcon={<DeleteIcon />} onClick={() => remove(flow)}>Delete</Button>
                  </TableCell>
                </TableRow>
              ))}
              {flows.length === 0 && <TableRow><TableCell colSpan={7}><Typography sx={{ py: 4, textAlign: 'center' }} color="text.secondary">No flows yet. Create your first WhatsApp automation.</Typography></TableCell></TableRow>}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>

      <Dialog open={createOpen} onClose={() => setCreateOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Create Flow</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField label="Flow Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} fullWidth />
            <TextField label="Description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} fullWidth />
            <TextField label="Trigger Keywords" value={form.triggerKeywords} onChange={(e) => setForm({ ...form, triggerKeywords: e.target.value })} helperText="Comma-separated keywords, for example: start, forex, course" fullWidth />
          </Stack>
        </DialogContent>
        <DialogActions><Button onClick={() => setCreateOpen(false)}>Cancel</Button><Button variant="contained" startIcon={<PlayArrowIcon />} onClick={create}>Create & Open</Button></DialogActions>
      </Dialog>
      <FlowAnalyticsDialog flow={analyticsFlow} onClose={() => setAnalyticsFlow(null)} />
    </Stack>
  );
}

export default FlowBuilderListPage;
