import React, { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Alert, Box, Button, Chip, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle,
  MenuItem, Paper, Stack, Tab, Tabs, TextField, Typography
} from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';
import {
  approvePaymentSlip, fetchPaymentSlipFile, getPaymentSlip, listPaymentSlips,
  markPaymentSlipDuplicate, rejectPaymentSlip, rerunPaymentSlip
} from '../services/paymentSlip.service';

const statuses = ['PENDING', 'NEEDS_REVIEW', 'APPROVED', 'REJECTED', 'DUPLICATE', 'ALL'];
const colors = { PENDING: 'warning', NEEDS_REVIEW: 'info', APPROVED: 'success', REJECTED: 'error', DUPLICATE: 'default' };
const displayStatus = (value) => String(value || '').replace(/_/g, ' ');

function PaymentVerificationPage() {
  const [searchParams] = useSearchParams();
  const [status, setStatus] = useState('PENDING');
  const [rows, setRows] = useState([]);
  const [selected, setSelected] = useState(null);
  const [preview, setPreview] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({ confirmedAmount: '', studentId: '', studentFeeId: '', installmentId: '', note: '', reason: '', duplicateOfSlipId: '' });

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try { setRows((await listPaymentSlips({ status })).data?.data || []); }
    catch (err) { setError(err.response?.data?.message || 'Unable to load payment slips.'); }
    finally { setLoading(false); }
  }, [status]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const slipId = searchParams.get('slipId');
    if (slipId) open({ id: slipId });
  }, [searchParams]);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  const open = async (row) => {
    setError('');
    try {
      const detail = (await getPaymentSlip(row.id)).data?.data;
      const blob = (await fetchPaymentSlipFile(row.id)).data;
      if (preview) URL.revokeObjectURL(preview);
      setPreview(URL.createObjectURL(blob));
      setSelected(detail);
      setForm({ confirmedAmount: detail.detectedAmount || '', studentId: detail.studentId || '', studentFeeId: detail.studentFeeId || '', installmentId: detail.feeInstallmentId || '', note: '', reason: '', duplicateOfSlipId: detail.duplicateOfSlipId || '' });
    } catch (err) { setError(err.response?.data?.message || 'Unable to open this payment slip.'); }
  };
  const run = async (action) => {
    setSaving(true); setError('');
    try {
      if (action === 'approve') await approvePaymentSlip(selected.id, { confirmedAmount: form.confirmedAmount, studentId: form.studentId, studentFeeId: form.studentFeeId, installmentAllocation: { installmentId: form.installmentId }, note: form.note });
      if (action === 'reject') await rejectPaymentSlip(selected.id, { reason: form.reason, note: form.note });
      if (action === 'duplicate') await markPaymentSlipDuplicate(selected.id, { duplicateOfSlipId: form.duplicateOfSlipId, note: form.note });
      if (action === 'rerun') await rerunPaymentSlip(selected.id);
      setSelected(null); await load();
    } catch (err) { setError(err.response?.data?.message || 'Payment-slip action failed.'); }
    finally { setSaving(false); }
  };

  return (
    <Box>
      <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" mb={2} gap={1}>
        <Box><Typography variant="h4" fontWeight={900}>Payment Verification</Typography><Typography color="text.secondary">Manually verify payment slips received through WhatsApp. Detection never approves payments.</Typography></Box>
        <Button startIcon={<RefreshIcon />} onClick={load}>Refresh</Button>
      </Stack>
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      <Paper><Tabs value={status} onChange={(_, value) => setStatus(value)} variant="scrollable">{statuses.map((item) => <Tab key={item} value={item} label={displayStatus(item)} />)}</Tabs></Paper>
      <Stack spacing={1.25} mt={2}>
        {loading && <Box textAlign="center" p={5}><CircularProgress /></Box>}
        {!loading && rows.length === 0 && <Paper sx={{ p: 4, textAlign: 'center' }}><Typography color="text.secondary">No slips in this queue.</Typography></Paper>}
        {rows.map((row) => (
          <Paper key={row.id} variant="outlined" sx={{ p: 2, cursor: 'pointer' }} onClick={() => open(row)}>
            <Stack direction={{ xs: 'column', md: 'row' }} alignItems={{ md: 'center' }} gap={2}>
              <Box sx={{ flex: 1 }}><Typography fontWeight={900}>Slip #{row.id} · {row.contact ? `${row.contact.firstName || ''} ${row.contact.lastName || ''}`.trim() || row.contact.phone : 'Unknown contact'}</Typography><Typography variant="body2" color="text.secondary">{row.student ? `${row.student.studentNo} · ${row.student.name}` : 'Student match required'} · Received {new Date(row.createdAt).toLocaleString()}</Typography></Box>
              <Typography>Rs. {row.detectedAmount || '—'}</Typography><Typography>Ref: {row.referenceNumber || '—'}</Typography>
              <Chip label={`${Math.round(Number(row.detectionConfidence || 0) * 100)}% detected`} variant="outlined" />
              <Chip label={displayStatus(row.verificationStatus)} color={colors[row.verificationStatus]} />
            </Stack>
          </Paper>
        ))}
      </Stack>
      <Dialog open={Boolean(selected)} onClose={() => !saving && setSelected(null)} maxWidth="lg" fullWidth>
        {selected && <>
          <DialogTitle>Review WhatsApp Payment Slip #{selected.id}</DialogTitle>
          <DialogContent dividers>
            <Stack direction={{ xs: 'column', md: 'row' }} spacing={3}>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                {selected.mimeType === 'application/pdf' ? <Box component="iframe" title="Payment slip PDF" src={preview} sx={{ width: '100%', height: 540, border: 0 }} /> : <Box component="img" src={preview} alt="Payment slip" sx={{ width: '100%', maxHeight: 600, objectFit: 'contain', bgcolor: 'grey.100' }} />}
              </Box>
              <Stack spacing={1.5} sx={{ flex: 1 }}>
                <Alert severity="warning">Finance approval is required. OCR and detection never approve a payment.</Alert>
                <Typography><b>Caption:</b> {selected.messageCaption || 'None'}</Typography>
                <Typography><b>Detected:</b> Rs. {selected.detectedAmount || '—'} · {selected.detectedBank || 'Bank unknown'} · Ref {selected.referenceNumber || '—'}</Typography>
                <Typography><b>Signals:</b> {(selected.detectionSignals || []).map((item) => item.code).join(', ') || 'None'}</Typography>
                {(selected.detectionWarnings || []).length > 0 && <Alert severity="info">{selected.detectionWarnings.join(', ')}</Alert>}
                <TextField label="Student ID" value={form.studentId} onChange={(e) => setForm({ ...form, studentId: e.target.value })} select={Boolean(selected.matchCandidates?.students?.length)}>{(selected.matchCandidates?.students || []).map((item) => <MenuItem key={item.id} value={item.id}>{item.studentNo} · {item.name}</MenuItem>)}</TextField>
                <TextField label="Student Fee ID" value={form.studentFeeId} onChange={(e) => setForm({ ...form, studentFeeId: e.target.value })} />
                <TextField label="Installment ID" value={form.installmentId} onChange={(e) => setForm({ ...form, installmentId: e.target.value })} select={Boolean(selected.matchCandidates?.installments?.length)}>{(selected.matchCandidates?.installments || []).map((item) => <MenuItem key={item.id} value={item.id}>#{item.installmentNo} · Rs. {item.amount} · {item.dueDate}</MenuItem>)}</TextField>
                <TextField label="Confirmed amount" type="number" value={form.confirmedAmount} onChange={(e) => setForm({ ...form, confirmedAmount: e.target.value })} />
                <TextField label="Reviewer note" multiline minRows={2} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
                <TextField label="Rejection reason" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} />
                <TextField label="Duplicate of slip ID" value={form.duplicateOfSlipId} onChange={(e) => setForm({ ...form, duplicateOfSlipId: e.target.value })} />
                <Typography variant="subtitle2">Recent chat context</Typography>
                <Paper variant="outlined" sx={{ p: 1, maxHeight: 150, overflow: 'auto' }}>{(selected.recentContext || []).map((message) => <Typography key={message.id} variant="caption" display="block"><b>{message.direction}:</b> {message.text || message.type}</Typography>)}</Paper>
              </Stack>
            </Stack>
          </DialogContent>
          <DialogActions sx={{ flexWrap: 'wrap' }}>
            <Button disabled={saving || !['PENDING', 'NEEDS_REVIEW'].includes(selected.verificationStatus)} onClick={() => run('rerun')}>Re-run detection</Button>
            <Button disabled={saving || !['PENDING', 'NEEDS_REVIEW'].includes(selected.verificationStatus)} onClick={() => run('duplicate')}>Mark duplicate</Button>
            <Button color="error" disabled={saving || !form.reason || !['PENDING', 'NEEDS_REVIEW'].includes(selected.verificationStatus)} onClick={() => run('reject')}>Reject</Button>
            <Button variant="contained" color="success" disabled={saving || !form.confirmedAmount || !form.studentId || !form.studentFeeId || !form.installmentId || !['PENDING', 'NEEDS_REVIEW'].includes(selected.verificationStatus)} onClick={() => run('approve')}>{saving ? 'Saving…' : 'Approve payment'}</Button>
          </DialogActions>
        </>}
      </Dialog>
    </Box>
  );
}
export default PaymentVerificationPage;
