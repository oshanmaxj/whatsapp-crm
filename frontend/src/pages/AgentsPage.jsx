import React, { useEffect, useState } from 'react';
import { Alert, Grid, LinearProgress, Paper, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Typography } from '@mui/material';
import GroupsIcon from '@mui/icons-material/Groups';
import { getAgentPerformance } from '../services/agent.service';

function AgentsPage() {
  const [agents, setAgents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    getAgentPerformance()
      .then((response) => setAgents(response.data.data || []))
      .catch((err) => setError(err.response?.data?.message || 'Unable to load agents.'))
      .finally(() => setLoading(false));
  }, []);

  const totalAssigned = agents.reduce((sum, agent) => sum + Number(agent.assignedLeadCount || 0), 0);

  return (
    <Stack spacing={2.5}>
      {error && <Alert severity="error">{error}</Alert>}
      {loading && <LinearProgress />}
      <Grid container spacing={2}>
        <Grid item xs={12} md={4}>
          <Paper sx={{ p: 2.5, border: '1px solid #e8edf2' }} elevation={0}>
            <GroupsIcon color="success" />
            <Typography variant="h4" fontWeight={850}>{agents.length}</Typography>
            <Typography color="text.secondary">Active Agents</Typography>
          </Paper>
        </Grid>
        <Grid item xs={12} md={4}>
          <Paper sx={{ p: 2.5, border: '1px solid #e8edf2' }} elevation={0}>
            <Typography variant="h4" fontWeight={850}>{totalAssigned}</Typography>
            <Typography color="text.secondary">Assigned Leads</Typography>
          </Paper>
        </Grid>
      </Grid>

      <Paper sx={{ border: '1px solid #e8edf2', overflow: 'hidden' }} elevation={0}>
        <TableContainer>
          <Table>
            <TableHead><TableRow><TableCell>Agent</TableCell><TableCell>Email</TableCell><TableCell>Status</TableCell><TableCell>Assigned Leads</TableCell><TableCell>Assignment History</TableCell></TableRow></TableHead>
            <TableBody>
              {agents.map((agent) => (
                <TableRow key={agent.id} hover>
                  <TableCell><Typography fontWeight={800}>{agent.name}</Typography></TableCell>
                  <TableCell>{agent.email}</TableCell>
                  <TableCell>{agent.status}</TableCell>
                  <TableCell>{agent.assignedLeadCount}</TableCell>
                  <TableCell>{agent.assignmentCount}</TableCell>
                </TableRow>
              ))}
              {!loading && agents.length === 0 && <TableRow><TableCell colSpan={5}><Typography color="text.secondary" sx={{ py: 4, textAlign: 'center' }}>No active agents found.</Typography></TableCell></TableRow>}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>
    </Stack>
  );
}

export default AgentsPage;
