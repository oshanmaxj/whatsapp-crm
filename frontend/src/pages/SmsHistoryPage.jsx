import React from 'react';
import {
  Alert, Box, Chip, Dialog, DialogContent, DialogTitle, Grid, IconButton,
  MenuItem, Paper, Table, TableBody, TableCell, TableContainer, TableHead,
  TableRow, TablePagination, TextField, Typography
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import * as service from '../services/smsMessage.service';
import { getSmsGatewaySettings } from '../services/smsGateway.service';

const STATUS_OPTIONS = ['queued', 'sent', 'delivered', 'failed', 'rejected', 'unknown'];
const STATUS_COLOR = { queued: 'default', sent: 'info', delivered: 'success', failed: 'error', rejected: 'error', unknown: 'warning' };

function relatedLabel(row) {
  if (row.contact) return `${[row.contact.firstName, row.contact.lastName].filter(Boolean).join(' ') || 'Contact'} (#${row.contact.id})`;
  if (row.lead) {
    const contact = row.lead.contact;
    const name = contact ? [contact.firstName, contact.lastName].filter(Boolean).join(' ') : null;
    return `${name || 'Lead'} (#${row.lead.id})`;
  }
  if (row.student) return `${row.student.name} (#${row.student.id})`;
  return '—';
}

function truncate(text, max = 60) {
  if (!text) return '';
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function formatDate(value) {
  return value ? new Date(value).toLocaleString() : '—';
}

export default function SmsHistoryPage() {
  const [rows, setRows] = React.useState([]);
  const [total, setTotal] = React.useState(0);
  const [page, setPage] = React.useState(0); // MUI TablePagination is 0-indexed
  const [pageSize, setPageSize] = React.useState(25);
  const [filters, setFilters] = React.useState({ status: '', provider: '', phone: '', dateFrom: '', dateTo: '' });
  const [providers, setProviders] = React.useState([]);
  const [message, setMessage] = React.useState(null);
  const [loading, setLoading] = React.useState(false);
  const [selected, setSelected] = React.useState(null);
  const [selectedLoading, setSelectedLoading] = React.useState(false);

  React.useEffect(() => {
    getSmsGatewaySettings().then(({ data }) => setProviders(data.data.availableProviders || [])).catch(() => {});
  }, []);

  const load = React.useCallback(async () => {
    setLoading(true); setMessage(null);
    try {
      const params = { page: page + 1, pageSize };
      if (filters.status) params.status = filters.status;
      if (filters.provider) params.provider = filters.provider;
      if (filters.phone) params.phone = filters.phone;
      if (filters.dateFrom) params.dateFrom = filters.dateFrom;
      if (filters.dateTo) params.dateTo = filters.dateTo;
      const { data } = await service.listSmsMessages(params);
      setRows(data.data.rows);
      setTotal(data.data.total);
    } catch (error) {
      setMessage({ severity: 'error', text: error.response?.data?.message || error.message });
    } finally { setLoading(false); }
  }, [page, pageSize, filters]);

  React.useEffect(() => { load(); }, [load]);

  const updateFilter = (key, value) => { setPage(0); setFilters((prev) => ({ ...prev, [key]: value })); };

  const openDetail = async (id) => {
    setSelectedLoading(true);
    try {
      const { data } = await service.getSmsMessage(id);
      setSelected(data.data);
    } catch (error) {
      setMessage({ severity: 'error', text: error.response?.data?.message || error.message });
    } finally { setSelectedLoading(false); }
  };

  return <Box>
    <Typography variant="h4" sx={{ mb: 2 }}>SMS History</Typography>
    {message && <Alert severity={message.severity} sx={{ mb: 2 }}>{message.text}</Alert>}

    <Grid container spacing={2} sx={{ mb: 2 }}>
      <Grid item xs={12} sm={2}>
        <TextField select fullWidth label="Status" value={filters.status} onChange={(e) => updateFilter('status', e.target.value)}>
          <MenuItem value="">All</MenuItem>
          {STATUS_OPTIONS.map((s) => <MenuItem key={s} value={s}>{s}</MenuItem>)}
        </TextField>
      </Grid>
      <Grid item xs={12} sm={2}>
        <TextField select fullWidth label="Provider" value={filters.provider} onChange={(e) => updateFilter('provider', e.target.value)}>
          <MenuItem value="">All</MenuItem>
          {providers.map((p) => <MenuItem key={p.id} value={p.id}>{p.label}</MenuItem>)}
        </TextField>
      </Grid>
      <Grid item xs={12} sm={3}>
        <TextField fullWidth label="Phone search" placeholder="e.g. 0771234567" value={filters.phone} onChange={(e) => updateFilter('phone', e.target.value)} />
      </Grid>
      <Grid item xs={6} sm={2.5}>
        <TextField fullWidth type="date" label="From" InputLabelProps={{ shrink: true }} value={filters.dateFrom} onChange={(e) => updateFilter('dateFrom', e.target.value)} />
      </Grid>
      <Grid item xs={6} sm={2.5}>
        <TextField fullWidth type="date" label="To" InputLabelProps={{ shrink: true }} value={filters.dateTo} onChange={(e) => updateFilter('dateTo', e.target.value)} />
      </Grid>
    </Grid>

    <TableContainer component={Paper}>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>Recipient</TableCell>
            <TableCell>Contact / Lead / Student</TableCell>
            <TableCell>Message</TableCell>
            <TableCell>Provider</TableCell>
            <TableCell>Mask</TableCell>
            <TableCell>Campaign</TableCell>
            <TableCell>Status</TableCell>
            <TableCell>Provider Msg ID</TableCell>
            <TableCell>Sent</TableCell>
            <TableCell>Last update</TableCell>
            <TableCell>Error</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {!loading && rows.length === 0 && <TableRow><TableCell colSpan={11} align="center">No SMS messages found.</TableCell></TableRow>}
          {rows.map((row) => (
            <TableRow key={row.id} hover style={{ cursor: 'pointer' }} onClick={() => openDetail(row.id)}>
              <TableCell>{row.toNumber}</TableCell>
              <TableCell>{relatedLabel(row)}</TableCell>
              <TableCell>{truncate(row.message)}</TableCell>
              <TableCell>{row.provider || '—'}</TableCell>
              <TableCell>{row.mask || '—'}</TableCell>
              <TableCell>{row.campaignName || '—'}</TableCell>
              <TableCell><Chip size="small" label={row.status} color={STATUS_COLOR[row.status] || 'default'} /></TableCell>
              <TableCell>{row.providerMessageId || '—'}</TableCell>
              <TableCell>{formatDate(row.sentAt)}</TableCell>
              <TableCell>{formatDate(row.updatedAt)}</TableCell>
              <TableCell>{row.errorMessage || '—'}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <TablePagination
        component="div"
        count={total}
        page={page}
        onPageChange={(e, newPage) => setPage(newPage)}
        rowsPerPage={pageSize}
        onRowsPerPageChange={(e) => { setPageSize(Number(e.target.value)); setPage(0); }}
        rowsPerPageOptions={[10, 25, 50, 100]}
      />
    </TableContainer>

    <Dialog open={Boolean(selected) || selectedLoading} onClose={() => setSelected(null)} fullWidth maxWidth="sm">
      <DialogTitle sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        SMS Details
        <IconButton onClick={() => setSelected(null)}><CloseIcon /></IconButton>
      </DialogTitle>
      <DialogContent dividers>
        {selected && <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
          <Typography variant="body2"><strong>Recipient:</strong> {selected.toNumber}</Typography>
          <Typography variant="body2"><strong>Related:</strong> {relatedLabel(selected)}</Typography>
          <Typography variant="body2"><strong>Message:</strong> {selected.message}</Typography>
          <Typography variant="body2"><strong>Provider:</strong> {selected.provider || '—'}</Typography>
          <Typography variant="body2"><strong>Mask:</strong> {selected.mask || '—'}</Typography>
          <Typography variant="body2"><strong>Campaign:</strong> {selected.campaignName || '—'}</Typography>
          <Typography variant="body2"><strong>Status:</strong> <Chip size="small" label={selected.status} color={STATUS_COLOR[selected.status] || 'default'} /></Typography>
          <Typography variant="body2"><strong>Provider status:</strong> {selected.providerStatus || '—'}</Typography>
          <Typography variant="body2"><strong>Provider message ID:</strong> {selected.providerMessageId || '—'}</Typography>
          <Typography variant="body2"><strong>Segments / Cost:</strong> {selected.segments ?? '—'} / {selected.cost ?? '—'}</Typography>
          <Typography variant="body2"><strong>Source:</strong> {selected.source}</Typography>
          <Typography variant="body2"><strong>Sent at:</strong> {formatDate(selected.sentAt)}</Typography>
          <Typography variant="body2"><strong>Delivered at:</strong> {formatDate(selected.deliveredAt)}</Typography>
          <Typography variant="body2"><strong>Failed at:</strong> {formatDate(selected.failedAt)}</Typography>
          <Typography variant="body2"><strong>Error:</strong> {selected.errorMessage || '—'}</Typography>
          <Typography variant="body2"><strong>Created by:</strong> {selected.creator ? [selected.creator.firstName, selected.creator.lastName].filter(Boolean).join(' ') || selected.creator.email : '—'}</Typography>
          <Typography variant="caption" color="text.secondary">Provider metadata</Typography>
          <Box component="pre" sx={{ background: 'action.hover', p: 1, borderRadius: 1, fontSize: 12, overflow: 'auto', maxHeight: 200 }}>
            {JSON.stringify(selected.providerMetadata || {}, null, 2)}
          </Box>
        </Box>}
      </DialogContent>
    </Dialog>
  </Box>;
}
