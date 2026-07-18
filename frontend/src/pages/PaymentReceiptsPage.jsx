import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert, Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, Grid, IconButton,
  LinearProgress, MenuItem, Paper, Stack, Table, TableBody, TableCell, TableContainer, TableHead,
  TableRow, TextField, Typography, Switch
} from '@mui/material';
import DownloadIcon from '@mui/icons-material/Download';
import RefreshIcon from '@mui/icons-material/Refresh';
import VisibilityIcon from '@mui/icons-material/Visibility';
import WhatsAppIcon from '@mui/icons-material/WhatsApp';
import BlockIcon from '@mui/icons-material/Block';
import FileDownloadIcon from '@mui/icons-material/FileDownload';
import SettingsIcon from '@mui/icons-material/Settings';
import {
  downloadReceipt, exportReceipts, getReceipt, getReceiptSettings, listReceipts, regenerateReceipt, saveBlob,
  sendReceiptWhatsapp, updateReceiptSettings, voidReceipt
} from '../services/paymentReceipt.service';
import { hasPermission } from '../utils/access';

const money = (value, currency = 'LKR') => `${currency} ${Number(value || 0).toLocaleString('en-LK', { minimumFractionDigits: 2 })}`;
const date = (value) => value ? new Date(value).toLocaleDateString() : '-';

export default function PaymentReceiptsPage() {
  const [rows, setRows] = useState([]);
  const [filters, setFilters] = useState({ receiptNumber: '', student: '', registrationNumber: '', course: '', batch: '', status: '', whatsapp: '', dateFrom: '', dateTo: '' });
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState(null);
  const [selected, setSelected] = useState(null);
  const [settings, setSettings] = useState(null);

  const load = async () => {
    setLoading(true);
    try {
      const response = await listReceipts(Object.fromEntries(Object.entries(filters).filter(([, value]) => value)));
      setRows(response.data?.data || []);
    } catch (error) { setMessage({ severity: 'error', text: error.response?.data?.message || 'Unable to load receipts.' }); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const total = useMemo(() => rows.filter((row) => row.status === 'ACTIVE').reduce((sum, row) => sum + Number(row.paidAmount || 0), 0), [rows]);
  const act = async (action, success) => {
    try { await action(); setMessage({ severity: 'success', text: success }); await load(); }
    catch (error) { setMessage({ severity: 'error', text: error.response?.data?.message || error.message }); }
  };
  const view = async (id) => {
    try { const response = await getReceipt(id); setSelected(response.data?.data); }
    catch (error) { setMessage({ severity: 'error', text: error.response?.data?.message || 'Unable to load receipt.' }); }
  };
  const download = async (row) => {
    try { const response = await downloadReceipt(row.id); saveBlob(response.data, `${row.receiptNumber}.pdf`); }
    catch (error) { setMessage({ severity: 'error', text: error.response?.data?.message || 'Receipt PDF is not ready.' }); }
  };
  const exportCsv = async () => {
    const response = await exportReceipts(filters);
    saveBlob(response.data, 'payment-receipts.csv');
  };
  const voidRow = async (row) => {
    const reason = window.prompt(`Reason for voiding ${row.receiptNumber}:`);
    if (!reason) return;
    await act(() => voidReceipt(row.id, reason), 'Receipt voided and retained in history.');
  };
  const openSettings = async () => {
    try { const response = await getReceiptSettings(); setSettings(response.data?.data || {}); }
    catch (error) { setMessage({ severity: 'error', text: error.response?.data?.message || 'Unable to load receipt settings.' }); }
  };
  const saveSettings = async () => {
    await act(() => updateReceiptSettings(settings), 'Receipt settings updated.');
    setSettings(null);
  };

  return <Box>
    <Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" spacing={2} mb={2}>
      <Box><Typography variant="h4">Payment Receipts</Typography><Typography color="text.secondary">Canonical, verifiable payment receipt history</Typography></Box>
      <Stack direction="row" spacing={1}><Chip label={`${rows.length} receipts`} /><Chip color="success" label={`Active total ${money(total)}`} />{hasPermission('receipts.export') && <Button startIcon={<FileDownloadIcon />} onClick={exportCsv}>Export CSV</Button>}{hasPermission('receipts.manage_settings') && <Button startIcon={<SettingsIcon />} onClick={openSettings}>Settings</Button>}</Stack>
    </Stack>
    {message && <Alert severity={message.severity} onClose={() => setMessage(null)} sx={{ mb: 2 }}>{message.text}</Alert>}
    <Paper sx={{ p: 2, mb: 2 }}><Grid container spacing={1.5}>
      <Grid item xs={12} sm={6} md={2}><TextField fullWidth label="Receipt No" value={filters.receiptNumber} onChange={(e) => setFilters({ ...filters, receiptNumber: e.target.value })} /></Grid>
      <Grid item xs={12} sm={6} md={2}><TextField fullWidth label="Registration No" value={filters.registrationNumber} onChange={(e) => setFilters({ ...filters, registrationNumber: e.target.value })} /></Grid>
      <Grid item xs={12} sm={6} md={2}><TextField fullWidth label="Student" value={filters.student} onChange={(e) => setFilters({ ...filters, student: e.target.value })} /></Grid>
      <Grid item xs={12} sm={6} md={2}><TextField fullWidth label="Course" value={filters.course} onChange={(e) => setFilters({ ...filters, course: e.target.value })} /></Grid>
      <Grid item xs={12} sm={6} md={2}><TextField fullWidth label="Batch" value={filters.batch} onChange={(e) => setFilters({ ...filters, batch: e.target.value })} /></Grid>
      <Grid item xs={12} sm={6} md={2}><TextField select fullWidth label="Status" value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })}><MenuItem value="">All</MenuItem>{['ACTIVE', 'VOID', 'REVERSED'].map((value) => <MenuItem key={value} value={value}>{value}</MenuItem>)}</TextField></Grid>
      <Grid item xs={12} sm={6} md={2}><TextField select fullWidth label="WhatsApp" value={filters.whatsapp} onChange={(e) => setFilters({ ...filters, whatsapp: e.target.value })}><MenuItem value="">All</MenuItem><MenuItem value="sent">Sent</MenuItem><MenuItem value="not_sent">Not sent</MenuItem></TextField></Grid>
      <Grid item xs={12} sm={6} md={1.5}><TextField fullWidth type="date" label="From" InputLabelProps={{ shrink: true }} value={filters.dateFrom} onChange={(e) => setFilters({ ...filters, dateFrom: e.target.value })} /></Grid>
      <Grid item xs={12} sm={6} md={1.5}><TextField fullWidth type="date" label="To" InputLabelProps={{ shrink: true }} value={filters.dateTo} onChange={(e) => setFilters({ ...filters, dateTo: e.target.value })} /></Grid>
      <Grid item xs={12} md={1}><Button fullWidth variant="contained" sx={{ height: '100%' }} onClick={load}>Apply</Button></Grid>
    </Grid></Paper>
    {loading && <LinearProgress />}
    <TableContainer component={Paper}><Table size="small"><TableHead><TableRow>{['Receipt', 'Student', 'Registration', 'Course / Batch', 'Amount', 'Date', 'Method', 'WhatsApp', 'Status', 'Actions'].map((label) => <TableCell key={label}>{label}</TableCell>)}</TableRow></TableHead><TableBody>
      {rows.map((row) => <TableRow key={row.id} hover><TableCell>{row.receiptNumber}</TableCell><TableCell>{row.studentNameSnapshot}</TableCell><TableCell>{row.studentNumberSnapshot || '-'}</TableCell><TableCell>{[row.courseNameSnapshot, row.batchNameSnapshot].filter(Boolean).join(' / ') || '-'}</TableCell><TableCell>{money(row.paidAmount, row.currency)}</TableCell><TableCell>{date(row.receiptDate)}</TableCell><TableCell>{row.paymentMethod || '-'}</TableCell><TableCell><Chip size="small" color={row.whatsappSentAt ? 'success' : 'default'} label={row.whatsappSentAt ? 'Sent' : 'Not sent'} /></TableCell><TableCell><Chip size="small" color={row.status === 'ACTIVE' ? 'success' : 'error'} label={row.status} /></TableCell><TableCell><Stack direction="row">
        <IconButton title="View" onClick={() => view(row.id)}><VisibilityIcon /></IconButton>
        {hasPermission('receipts.download') && <IconButton title="Download PDF" onClick={() => download(row)}><DownloadIcon /></IconButton>}
        {hasPermission('receipts.send_whatsapp') && row.status === 'ACTIVE' && <IconButton title="Send via WhatsApp" onClick={() => act(() => sendReceiptWhatsapp(row.id), 'WhatsApp delivery queued.')}><WhatsAppIcon /></IconButton>}
        {hasPermission('receipts.regenerate') && <IconButton title="Regenerate PDF" onClick={() => act(() => regenerateReceipt(row.id), 'PDF regeneration queued.')}><RefreshIcon /></IconButton>}
        {hasPermission('receipts.void') && row.status === 'ACTIVE' && <IconButton color="error" title="Void receipt" onClick={() => voidRow(row)}><BlockIcon /></IconButton>}
      </Stack></TableCell></TableRow>)}
      {!loading && rows.length === 0 && <TableRow><TableCell colSpan={10}>No receipts match the selected filters.</TableCell></TableRow>}
    </TableBody></Table></TableContainer>
    <Dialog open={!!selected} onClose={() => setSelected(null)} maxWidth="sm" fullWidth><DialogTitle>{selected?.receiptNumber}</DialogTitle><DialogContent dividers><Grid container spacing={2}>{[
      ['Student', selected?.studentNameSnapshot], ['Registration', selected?.studentNumberSnapshot], ['Course', selected?.courseNameSnapshot], ['Batch', selected?.batchNameSnapshot], ['Amount', selected && money(selected.paidAmount, selected.currency)], ['Total Paid', selected && money(selected.totalPaidAfterPayment, selected.currency)], ['Balance', selected && money(selected.remainingBalance, selected.currency)], ['Status', selected?.status]
    ].map(([label, value]) => <Grid item xs={6} key={label}><Typography variant="caption" color="text.secondary">{label}</Typography><Typography>{value || '-'}</Typography></Grid>)}</Grid></DialogContent><DialogActions><Button onClick={() => setSelected(null)}>Close</Button>{selected && hasPermission('receipts.download') && <Button onClick={() => download(selected)}>Download</Button>}</DialogActions></Dialog>
    <Dialog open={!!settings} onClose={() => setSettings(null)} maxWidth="md" fullWidth><DialogTitle>Receipt branding and automation</DialogTitle><DialogContent dividers><Grid container spacing={2}>{settings && <>
      {['companyName', 'registrationNumber', 'address', 'phone', 'email', 'logoUrl', 'signatureUrl', 'footerText', 'verificationBaseUrl'].map((field) => <Grid item xs={12} md={field === 'address' || field === 'footerText' ? 12 : 6} key={field}><TextField fullWidth label={field.replace(/([A-Z])/g, ' $1')} value={settings[field] || ''} multiline={field === 'address' || field === 'footerText'} onChange={(e) => setSettings({ ...settings, [field]: e.target.value })} /></Grid>)}
      <Grid item xs={6}><TextField fullWidth label="Receipt prefix" value={settings.prefix || 'RCPT'} onChange={(e) => setSettings({ ...settings, prefix: e.target.value })} /></Grid><Grid item xs={6}><TextField fullWidth label="Currency" value={settings.currency || 'LKR'} onChange={(e) => setSettings({ ...settings, currency: e.target.value })} /></Grid>
      <Grid item xs={12}><FormControlLabel control={<Switch checked={!!settings.autoGenerate} onChange={(e) => setSettings({ ...settings, autoGenerate: e.target.checked })} />} label="Automatically generate receipts after approved payments" /></Grid>
      <Grid item xs={12}><FormControlLabel control={<Switch checked={!!settings.autoSendWhatsapp} onChange={(e) => setSettings({ ...settings, autoSendWhatsapp: e.target.checked })} />} label="Automatically send PDF through WhatsApp when allowed" /></Grid>
    </>}</Grid></DialogContent><DialogActions><Button onClick={() => setSettings(null)}>Cancel</Button><Button variant="contained" onClick={saveSettings}>Save</Button></DialogActions></Dialog>
  </Box>;
}
