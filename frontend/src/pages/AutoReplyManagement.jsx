import React, { useEffect, useState } from 'react';
import {
  Typography,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Button,
  TextField,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  Switch,
  FormControlLabel,
  Stack,
  Box
} from '@mui/material';
import {
  getAutoReplies,
  createAutoReply,
  updateAutoReply,
  deleteAutoReply
} from '../services/autoReply.service';

const initialForm = {
  trigger: '',
  matchType: 'contains',
  response: '',
  active: true
};

function AutoReplyManagement() {
  const [replies, setReplies] = useState([]);
  const [form, setForm] = useState(initialForm);
  const [selectedId, setSelectedId] = useState(null);
  const [loading, setLoading] = useState(false);

  const loadReplies = async () => {
    setLoading(true);
    const response = await getAutoReplies();
    setReplies(response.data.data);
    setLoading(false);
  };

  useEffect(() => {
    loadReplies();
  }, []);

  const handleChange = (field) => (event) => {
    const value = field === 'active' ? event.target.checked : event.target.value;
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleEdit = (reply) => {
    setSelectedId(reply.id);
    setForm({
      trigger: reply.trigger,
      matchType: reply.matchType,
      response: reply.response,
      active: reply.active
    });
  };

  const handleReset = () => {
    setSelectedId(null);
    setForm(initialForm);
  };

  const handleSave = async () => {
    setLoading(true);
    if (selectedId) {
      await updateAutoReply(selectedId, form);
    } else {
      await createAutoReply(form);
    }
    await loadReplies();
    handleReset();
  };

  const handleDelete = async (id) => {
    setLoading(true);
    await deleteAutoReply(id);
    await loadReplies();
    handleReset();
  };

  return (
    <>
      <Typography variant="h4" gutterBottom>
        Auto Reply Management
      </Typography>

      <Paper sx={{ p: 3, mb: 4 }}>
        <Typography variant="h6" gutterBottom>
          {selectedId ? 'Edit Reply' : 'Create Reply'}
        </Typography>
        <Stack spacing={2}>
          <TextField
            label="Trigger"
            value={form.trigger}
            onChange={handleChange('trigger')}
            fullWidth
          />
          <FormControl fullWidth>
            <InputLabel id="match-type-label">Match Type</InputLabel>
            <Select
              labelId="match-type-label"
              label="Match Type"
              value={form.matchType}
              onChange={handleChange('matchType')}
            >
              <MenuItem value="exact">Exact</MenuItem>
              <MenuItem value="contains">Contains</MenuItem>
              <MenuItem value="regex">Regex</MenuItem>
            </Select>
          </FormControl>
          <TextField
            label="Response"
            value={form.response}
            onChange={handleChange('response')}
            fullWidth
            multiline
            minRows={3}
          />
          <FormControlLabel
            control={<Switch checked={form.active} onChange={handleChange('active')} />}
            label="Active"
          />
          <Stack direction="row" spacing={2}>
            <Button variant="contained" onClick={handleSave} disabled={loading}>
              Save
            </Button>
            <Button variant="outlined" onClick={handleReset} disabled={loading}>
              Reset
            </Button>
          </Stack>
        </Stack>
      </Paper>

      <Paper>
        <TableContainer>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>Trigger</TableCell>
                <TableCell>Match Type</TableCell>
                <TableCell>Response</TableCell>
                <TableCell>Active</TableCell>
                <TableCell>Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {replies.map((reply) => (
                <TableRow key={reply.id}>
                  <TableCell>{reply.trigger}</TableCell>
                  <TableCell>{reply.matchType}</TableCell>
                  <TableCell>{reply.response}</TableCell>
                  <TableCell>{reply.active ? 'Yes' : 'No'}</TableCell>
                  <TableCell>
                    <Button size="small" onClick={() => handleEdit(reply)}>
                      Edit
                    </Button>
                    <Button size="small" color="error" onClick={() => handleDelete(reply.id)}>
                      Delete
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>
    </>
  );
}

export default AutoReplyManagement;
