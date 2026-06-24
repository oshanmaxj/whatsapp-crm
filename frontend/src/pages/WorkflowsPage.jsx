import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  Grid,
  IconButton,
  InputLabel,
  LinearProgress,
  MenuItem,
  Paper,
  Select,
  Stack,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import EditIcon from '@mui/icons-material/Edit';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import { createWorkflow, deleteWorkflow, getWorkflows, testWorkflow, updateWorkflow } from '../services/workflow.service';

const triggers = [
  ['new_whatsapp_message', 'New WhatsApp message'],
  ['new_contact_created', 'New contact created'],
  ['new_lead_created', 'New lead created'],
  ['lead_status_changed', 'Lead status changed'],
  ['campaign_replied', 'Campaign replied'],
  ['appointment_booked', 'Appointment booked'],
  ['follow_up_due', 'Follow-up due']
];

const actions = [
  ['send_whatsapp_message', 'Send WhatsApp message'],
  ['add_tag_label', 'Add tag/label'],
  ['assign_agent', 'Assign agent'],
  ['change_lead_status', 'Change lead status'],
  ['create_follow_up', 'Create follow-up'],
  ['add_internal_note', 'Add internal note'],
  ['send_campaign_template', 'Send campaign/template message']
];

const initialForm = {
  name: '',
  description: '',
  triggerType: 'new_whatsapp_message',
  enabled: true,
  conditions: '{}',
  steps: [
    { sortOrder: 1, actionType: 'send_whatsapp_message', config: { message: 'Hi {{name}}, thanks for contacting us.' }, enabled: true }
  ]
};

function label(list, value) {
  return list.find(([key]) => key === value)?.[1] || value;
}

function toJson(value, fallback) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch (error) {
    const err = new Error('JSON fields must be valid.');
    err.isValidation = true;
    throw err;
  }
}

function workflowToForm(workflow) {
  return {
    name: workflow.name || '',
    description: workflow.description || '',
    triggerType: workflow.triggerType || 'new_whatsapp_message',
    enabled: workflow.enabled !== false,
    conditions: JSON.stringify(workflow.conditions || {}, null, 2),
    steps: (workflow.steps || []).sort((a, b) => a.sortOrder - b.sortOrder).map((step) => ({
      sortOrder: step.sortOrder,
      actionType: step.actionType,
      config: step.config || {},
      enabled: step.enabled !== false
    }))
  };
}

function WorkflowsPage() {
  const [workflows, setWorkflows] = useState([]);
  const [form, setForm] = useState(initialForm);
  const [editing, setEditing] = useState(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [runResult, setRunResult] = useState(null);
  const [runOpen, setRunOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const totals = useMemo(() => ({
    total: workflows.length,
    enabled: workflows.filter((workflow) => workflow.enabled).length,
    disabled: workflows.filter((workflow) => !workflow.enabled).length
  }), [workflows]);

  const load = async () => {
    try {
      setLoading(true);
      const response = await getWorkflows();
      setWorkflows(response.data.data || []);
    } catch (err) {
      setError(err.response?.data?.message || 'Unable to load workflows.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const openCreate = () => {
    setEditing(null);
    setForm(initialForm);
    setDialogOpen(true);
  };

  const openEdit = (workflow) => {
    setEditing(workflow);
    setForm(workflowToForm(workflow));
    setDialogOpen(true);
  };

  const setStep = (index, patch) => {
    setForm((current) => ({
      ...current,
      steps: current.steps.map((step, stepIndex) => stepIndex === index ? { ...step, ...patch } : step)
    }));
  };

  const save = async () => {
    try {
      setError('');
      const payload = {
        name: form.name,
        description: form.description,
        triggerType: form.triggerType,
        enabled: form.enabled,
        conditions: toJson(form.conditions, {}),
        steps: form.steps.map((step, index) => ({
          sortOrder: index + 1,
          actionType: step.actionType,
          enabled: step.enabled !== false,
          config: typeof step.config === 'string' ? toJson(step.config, {}) : step.config
        }))
      };
      if (editing) {
        await updateWorkflow(editing.id, payload);
        setSuccess('Workflow updated.');
      } else {
        await createWorkflow(payload);
        setSuccess('Workflow created.');
      }
      setDialogOpen(false);
      await load();
    } catch (err) {
      setError(err.isValidation ? err.message : err.response?.data?.message || 'Unable to save workflow.');
    }
  };

  const toggleWorkflow = async (workflow) => {
    await updateWorkflow(workflow.id, { enabled: !workflow.enabled });
    await load();
  };

  const remove = async (workflow) => {
    if (!window.confirm(`Delete workflow "${workflow.name}"?`)) return;
    await deleteWorkflow(workflow.id);
    setSuccess('Workflow deleted.');
    await load();
  };

  const runTest = async (workflow) => {
    try {
      setLoading(true);
      const response = await testWorkflow(workflow.id, {
        name: 'Local Test Contact',
        phone: '+94770000000',
        contact: { phone: '+94770000000' },
        event: 'manual_test'
      });
      setRunResult(response.data.data);
      setRunOpen(true);
      await load();
    } catch (err) {
      setError(err.response?.data?.message || 'Unable to test workflow.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Stack spacing={2.5}>
      {error && <Alert severity="error" onClose={() => setError('')}>{error}</Alert>}
      {success && <Alert severity="success" onClose={() => setSuccess('')}>{success}</Alert>}

      <Grid container spacing={2}>
        {Object.entries(totals).map(([key, value]) => (
          <Grid item xs={12} md={4} key={key}>
            <Paper sx={{ p: 2.5, border: '1px solid #e8edf2' }} elevation={0}>
              <Typography variant="h4" fontWeight={850}>{value}</Typography>
              <Typography color="text.secondary">{key}</Typography>
            </Paper>
          </Grid>
        ))}
      </Grid>

      <Paper sx={{ p: 2.5, border: '1px solid #e8edf2' }} elevation={0}>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} alignItems={{ md: 'center' }}>
          <Box sx={{ flex: 1 }}>
            <Typography variant="h5" fontWeight={850}>Workflow Automation</Typography>
            <Typography color="text.secondary">Create trigger-based automations and test every workflow safely in local simulation mode.</Typography>
          </Box>
          <Button variant="contained" startIcon={<AddIcon />} onClick={openCreate} sx={{ bgcolor: '#128c7e' }}>Create Workflow</Button>
        </Stack>
      </Paper>

      <Paper sx={{ border: '1px solid #e8edf2', overflow: 'hidden' }} elevation={0}>
        {loading && <LinearProgress />}
        <TableContainer>
          <Table>
            <TableHead><TableRow><TableCell>Workflow</TableCell><TableCell>Trigger</TableCell><TableCell>Steps</TableCell><TableCell>Enabled</TableCell><TableCell>Last Run</TableCell><TableCell align="right">Actions</TableCell></TableRow></TableHead>
            <TableBody>
              {workflows.map((workflow) => (
                <TableRow key={workflow.id} hover>
                  <TableCell><Typography fontWeight={800}>{workflow.name}</Typography><Typography variant="body2" color="text.secondary">{workflow.description || 'No description'}</Typography></TableCell>
                  <TableCell><Chip size="small" label={label(triggers, workflow.triggerType)} /></TableCell>
                  <TableCell>{workflow.steps?.length || 0}</TableCell>
                  <TableCell><Switch checked={workflow.enabled} onChange={() => toggleWorkflow(workflow)} /></TableCell>
                  <TableCell>{workflow.lastRunAt ? new Date(workflow.lastRunAt).toLocaleString() : '-'}</TableCell>
                  <TableCell align="right">
                    <IconButton onClick={() => runTest(workflow)} title="Test workflow"><PlayArrowIcon /></IconButton>
                    <IconButton onClick={() => openEdit(workflow)} title="Edit"><EditIcon /></IconButton>
                    <IconButton color="error" onClick={() => remove(workflow)} title="Delete"><DeleteOutlineIcon /></IconButton>
                  </TableCell>
                </TableRow>
              ))}
              {!loading && workflows.length === 0 && <TableRow><TableCell colSpan={6}><Box sx={{ py: 5, textAlign: 'center' }}><Typography fontWeight={800}>No workflows yet</Typography><Typography color="text.secondary">Create an automation to get started.</Typography></Box></TableCell></TableRow>}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>

      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle>{editing ? 'Edit Workflow' : 'Create Workflow'}</DialogTitle>
        <DialogContent>
          <Grid container spacing={2} sx={{ mt: 0.5 }}>
            <Grid item xs={12} md={8}><TextField label="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} fullWidth /></Grid>
            <Grid item xs={12} md={4}>
              <FormControl fullWidth><InputLabel>Trigger</InputLabel><Select label="Trigger" value={form.triggerType} onChange={(e) => setForm({ ...form, triggerType: e.target.value })}>{triggers.map(([value, text]) => <MenuItem key={value} value={value}>{text}</MenuItem>)}</Select></FormControl>
            </Grid>
            <Grid item xs={12}><TextField label="Description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} fullWidth /></Grid>
            <Grid item xs={12}><TextField label="Conditions JSON" value={form.conditions} onChange={(e) => setForm({ ...form, conditions: e.target.value })} multiline minRows={2} fullWidth /></Grid>
            <Grid item xs={12}><Stack direction="row" spacing={1} alignItems="center"><Switch checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} /><Typography>Workflow enabled</Typography></Stack></Grid>
            <Grid item xs={12}>
              <Stack spacing={2}>
                <Stack direction="row" justifyContent="space-between" alignItems="center">
                  <Typography variant="h6" fontWeight={850}>Actions</Typography>
                  <Button onClick={() => setForm({ ...form, steps: [...form.steps, { sortOrder: form.steps.length + 1, actionType: 'add_internal_note', config: { note: 'Workflow note' }, enabled: true }] })}>Add Action</Button>
                </Stack>
                {form.steps.map((step, index) => (
                  <Paper key={index} elevation={0} sx={{ p: 2, border: '1px solid #e8edf2' }}>
                    <Grid container spacing={2}>
                      <Grid item xs={12} md={5}>
                        <FormControl fullWidth><InputLabel>Action</InputLabel><Select label="Action" value={step.actionType} onChange={(e) => setStep(index, { actionType: e.target.value })}>{actions.map(([value, text]) => <MenuItem key={value} value={value}>{text}</MenuItem>)}</Select></FormControl>
                      </Grid>
                      <Grid item xs={12} md={5}><TextField label="Config JSON" value={typeof step.config === 'string' ? step.config : JSON.stringify(step.config, null, 2)} onChange={(e) => setStep(index, { config: e.target.value })} multiline minRows={3} fullWidth /></Grid>
                      <Grid item xs={12} md={2}><Stack spacing={1}><Switch checked={step.enabled !== false} onChange={(e) => setStep(index, { enabled: e.target.checked })} /><Button color="error" onClick={() => setForm({ ...form, steps: form.steps.filter((_, stepIndex) => stepIndex !== index) })}>Remove</Button></Stack></Grid>
                    </Grid>
                  </Paper>
                ))}
              </Stack>
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions><Button onClick={() => setDialogOpen(false)}>Cancel</Button><Button variant="contained" disabled={!form.name.trim()} onClick={save}>Save</Button></DialogActions>
      </Dialog>

      <Dialog open={runOpen} onClose={() => setRunOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle>Workflow Test Result</DialogTitle>
        <DialogContent>
          {runResult && <Stack spacing={2}>
            <Chip label={`Status: ${runResult.status}`} color={runResult.status === 'failed' ? 'error' : 'success'} sx={{ alignSelf: 'flex-start' }} />
            <TextField value={JSON.stringify(runResult.results || [], null, 2)} multiline minRows={10} fullWidth InputProps={{ readOnly: true }} />
          </Stack>}
        </DialogContent>
        <DialogActions><Button onClick={() => setRunOpen(false)}>Close</Button></DialogActions>
      </Dialog>
    </Stack>
  );
}

export default WorkflowsPage;
