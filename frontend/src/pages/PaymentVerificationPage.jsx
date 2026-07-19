import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Alert, Box, Button, Chip, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle,
  MenuItem, Paper, Stack, Tab, Tabs, TextField, Typography
} from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';
import {
  approvePaymentSlip, createStudentFeePlan, fetchPaymentSlipFile, generateFeeInstallments,
  getOutstandingInstallments, getPaymentSlip, getStudentFeeOptions, listPaymentSlips,
  markPaymentSlipDuplicate, rejectPaymentSlip, rerunPaymentSlip
} from '../services/paymentSlip.service';
import { getAccessPayload } from '../utils/access';
import { feeOptionLabel, installmentOptionLabel, installmentSelection, singleOptionId } from '../utils/paymentSlipReview';

const statuses = ['PENDING', 'NEEDS_REVIEW', 'APPROVED', 'REJECTED', 'DUPLICATE', 'ALL'];
const colors = { PENDING: 'warning', NEEDS_REVIEW: 'info', APPROVED: 'success', REJECTED: 'error', DUPLICATE: 'default' };
const displayStatus = (value) => String(value || '').replace(/_/g, ' ');
const emptyForm = { confirmedAmount: '', studentId: '', studentFeeId: '', installmentId: '', note: '', reason: '', duplicateOfSlipId: '' };

function PaymentVerificationPage() {
  const [searchParams] = useSearchParams();
  const access = useMemo(() => getAccessPayload(), []);
  const can = (permission) => access.isSystemAdmin || access.permissions?.includes(permission);
  const canApprove = can('payment-slips.approve');
  const [status, setStatus] = useState('PENDING');
  const [rows, setRows] = useState([]);
  const [selected, setSelected] = useState(null);
  const [preview, setPreview] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadingOptions, setLoadingOptions] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState(emptyForm);
  const [feeData, setFeeData] = useState({ options: [], enrollments: [] });
  const [installmentOptions, setInstallmentOptions] = useState([]);
  const [enrollmentId, setEnrollmentId] = useState('');

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

  const hydrateReview = async (detail, preserveNotes = false) => {
    setSelected(detail);
    setLoadingOptions(true);
    const base = {
      ...emptyForm,
      confirmedAmount: detail.detectedAmount || '',
      studentId: detail.studentId ? String(detail.studentId) : '',
      duplicateOfSlipId: detail.duplicateOfSlipId || '',
      ...(preserveNotes ? { note: form.note, reason: form.reason } : {})
    };
    setFeeData({ options: [], enrollments: [] });
    setInstallmentOptions([]);
    setEnrollmentId('');
    try {
      if (!base.studentId) { setForm(base); return; }
      const fees = (await getStudentFeeOptions(base.studentId)).data?.data || { options: [], enrollments: [] };
      const preferredFee = fees.options.some((item) => String(item.id) === String(detail.studentFeeId))
        ? String(detail.studentFeeId) : singleOptionId(fees.options);
      setFeeData(fees);
      setEnrollmentId(fees.enrollments?.length === 1 ? String(fees.enrollments[0].id) : '');
      if (!preferredFee) { setForm({ ...base, studentFeeId: '', installmentId: '' }); return; }
      const installments = (await getOutstandingInstallments(preferredFee)).data?.data?.options || [];
      const choice = installmentSelection(installments, detail.feeInstallmentId);
      setInstallmentOptions(installments);
      setForm({ ...base, studentFeeId: preferredFee, ...choice, confirmedAmount: choice.confirmedAmount || base.confirmedAmount });
    } catch (err) {
      setForm(base);
      setError(err.response?.data?.message || 'Unable to load fee and installment options.');
    } finally { setLoadingOptions(false); }
  };

  const open = async (row) => {
    setError('');
    try {
      const detail = (await getPaymentSlip(row.id)).data?.data;
      const blob = (await fetchPaymentSlipFile(row.id)).data;
      if (preview) URL.revokeObjectURL(preview);
      setPreview(URL.createObjectURL(blob));
      await hydrateReview(detail);
    } catch (err) { setError(err.response?.data?.message || 'Unable to open this payment slip.'); }
  };

  const changeStudent = async (studentId) => {
    setLoadingOptions(true); setError('');
    setForm((current) => ({ ...current, studentId, studentFeeId: '', installmentId: '', confirmedAmount: selected?.detectedAmount || '' }));
    setFeeData({ options: [], enrollments: [] }); setInstallmentOptions([]); setEnrollmentId('');
    try {
      if (!studentId) return;
      const fees = (await getStudentFeeOptions(studentId)).data?.data || { options: [], enrollments: [] };
      const feeId = singleOptionId(fees.options);
      setFeeData(fees); setEnrollmentId(fees.enrollments?.length === 1 ? String(fees.enrollments[0].id) : '');
      if (!feeId) return;
      const installments = (await getOutstandingInstallments(feeId)).data?.data?.options || [];
      const choice = installmentSelection(installments);
      setInstallmentOptions(installments);
      setForm((current) => ({ ...current, studentFeeId: feeId, ...choice, confirmedAmount: choice.confirmedAmount || selected?.detectedAmount || '' }));
    } catch (err) { setError(err.response?.data?.message || 'Unable to load fee options.'); }
    finally { setLoadingOptions(false); }
  };

  const changeFee = async (studentFeeId) => {
    setLoadingOptions(true); setError(''); setInstallmentOptions([]);
    setForm((current) => ({ ...current, studentFeeId, installmentId: '', confirmedAmount: selected?.detectedAmount || '' }));
    try {
      if (!studentFeeId) return;
      const installments = (await getOutstandingInstallments(studentFeeId)).data?.data?.options || [];
      const choice = installmentSelection(installments);
      setInstallmentOptions(installments);
      setForm((current) => ({ ...current, ...choice, confirmedAmount: choice.confirmedAmount || selected?.detectedAmount || '' }));
    } catch (err) { setError(err.response?.data?.message || 'Unable to load outstanding installments.'); }
    finally { setLoadingOptions(false); }
  };

  const changeInstallment = (installmentId) => {
    const choice = installmentSelection(installmentOptions, installmentId);
    setForm((current) => ({ ...current, ...choice }));
  };

  const rerunAndRefresh = async () => {
    const detail = (await rerunPaymentSlip(selected.id)).data?.data;
    await hydrateReview(detail, true);
  };

  const createPlan = async () => {
    setSaving(true); setError('');
    try { await createStudentFeePlan(form.studentId, { enrollmentId }); await rerunAndRefresh(); }
    catch (err) { setError(err.response?.data?.message || 'Unable to create the fee plan.'); }
    finally { setSaving(false); }
  };

  const generateInstallments = async () => {
    setSaving(true); setError('');
    try { await generateFeeInstallments(form.studentFeeId); await rerunAndRefresh(); }
    catch (err) { setError(err.response?.data?.message || 'Unable to generate installments.'); }
    finally { setSaving(false); }
  };

  const run = async (action) => {
    setSaving(true); setError('');
    try {
      if (action === 'approve') await approvePaymentSlip(selected.id, { confirmedAmount: form.confirmedAmount, studentId: form.studentId, studentFeeId: form.studentFeeId, installmentAllocation: { installmentId: form.installmentId }, note: form.note });
      if (action === 'reject') await rejectPaymentSlip(selected.id, { reason: form.reason, note: form.note });
      if (action === 'duplicate') await markPaymentSlipDuplicate(selected.id, { duplicateOfSlipId: form.duplicateOfSlipId, note: form.note });
      if (action === 'rerun') { await rerunAndRefresh(); return; }
      setSelected(null); await load();
    } catch (err) { setError(err.response?.data?.message || 'Payment-slip action failed.'); }
    finally { setSaving(false); }
  };

  const studentOptions = selected ? [...new Map([
    ...(selected.student ? [[String(selected.student.id), selected.student]] : []),
    ...(selected.matchCandidates?.students || []).map((item) => [String(item.id), item])
  ]).values()] : [];
  const reviewable = selected && ['PENDING', 'NEEDS_REVIEW'].includes(selected.verificationStatus);

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
        {rows.map((row) => <Paper key={row.id} variant="outlined" sx={{ p: 2, cursor: 'pointer' }} onClick={() => open(row)}><Stack direction={{ xs: 'column', md: 'row' }} alignItems={{ md: 'center' }} gap={2}><Box sx={{ flex: 1 }}><Typography fontWeight={900}>Slip #{row.id} · {row.contact ? `${row.contact.firstName || ''} ${row.contact.lastName || ''}`.trim() || row.contact.phone : 'Unknown contact'}</Typography><Typography variant="body2" color="text.secondary">{row.student ? `${row.student.studentNo} · ${row.student.name}` : 'Student match required'} · Received {new Date(row.createdAt).toLocaleString()}</Typography></Box><Typography>Rs. {row.detectedAmount || '—'}</Typography><Typography>Ref: {row.referenceNumber || '—'}</Typography><Chip label={`${Math.round(Number(row.detectionConfidence || 0) * 100)}% detected`} variant="outlined" /><Chip label={displayStatus(row.verificationStatus)} color={colors[row.verificationStatus]} /></Stack></Paper>)}
      </Stack>
      <Dialog open={Boolean(selected)} onClose={() => !saving && setSelected(null)} maxWidth="lg" fullWidth>
        {selected && <><DialogTitle>Review WhatsApp Payment Slip #{selected.id}</DialogTitle><DialogContent dividers><Stack direction={{ xs: 'column', md: 'row' }} spacing={3}>
          <Box sx={{ flex: 1, minWidth: 0 }}>{selected.mimeType === 'application/pdf' ? <Box component="iframe" title="Payment slip PDF" src={preview} sx={{ width: '100%', height: 540, border: 0 }} /> : <Box component="img" src={preview} alt="Payment slip" sx={{ width: '100%', maxHeight: 600, objectFit: 'contain', bgcolor: 'grey.100' }} />}</Box>
          <Stack spacing={1.5} sx={{ flex: 1 }}>
            <Alert severity="warning">Finance approval is required. OCR and detection never approve a payment.</Alert>
            <Typography><b>Caption:</b> {selected.messageCaption || 'None'}</Typography><Typography><b>Detected:</b> Rs. {selected.detectedAmount || '—'} · {selected.detectedBank || 'Bank unknown'} · Ref {selected.referenceNumber || '—'}</Typography><Typography><b>Signals:</b> {(selected.detectionSignals || []).map((item) => item.code).join(', ') || 'None'}</Typography>
            {(selected.detectionWarnings || []).length > 0 && <Alert severity="info">{selected.detectionWarnings.join(', ')}</Alert>}
            <TextField label="Student" value={form.studentId} onChange={(event) => changeStudent(event.target.value)} select disabled={!canApprove || loadingOptions}>{studentOptions.map((item) => <MenuItem key={item.id} value={String(item.id)}>{item.studentNo} · {item.name}</MenuItem>)}</TextField>
            <TextField label="Student Fee" value={form.studentFeeId} onChange={(event) => changeFee(event.target.value)} select disabled={!canApprove || loadingOptions || !form.studentId}><MenuItem value=""><em>Select a fee record</em></MenuItem>{feeData.options.map((item) => <MenuItem key={item.id} value={String(item.id)}>{feeOptionLabel(item)}</MenuItem>)}</TextField>
            {form.studentId && !loadingOptions && feeData.options.length === 0 && <Alert severity="warning" action={can('fees.create') ? <Button color="inherit" size="small" disabled={saving || !feeData.enrollments.length || (feeData.enrollments.length > 1 && !enrollmentId)} onClick={createPlan}>Create fee plan</Button> : null}>No fee record exists for this student.</Alert>}
            {form.studentId && feeData.options.length === 0 && feeData.enrollments.length > 1 && can('fees.create') && <TextField select label="Enrollment / Course" value={enrollmentId} onChange={(event) => setEnrollmentId(event.target.value)}>{feeData.enrollments.map((item) => <MenuItem key={item.id} value={String(item.id)}>{item.courseName} – Rs. {Number(item.courseFee || 0).toLocaleString()} – {item.defaultInstallmentCount} installment(s)</MenuItem>)}</TextField>}
            <TextField label="Installment" value={form.installmentId} onChange={(event) => changeInstallment(event.target.value)} select disabled={!canApprove || loadingOptions || !form.studentFeeId}><MenuItem value=""><em>Select an outstanding installment</em></MenuItem>{installmentOptions.map((item) => <MenuItem key={item.id} value={String(item.id)}>{installmentOptionLabel(item)}</MenuItem>)}</TextField>
            {form.studentFeeId && !loadingOptions && installmentOptions.length === 0 && <Alert severity="warning" action={can('fees.edit') ? <Button color="inherit" size="small" disabled={saving} onClick={generateInstallments}>Generate installments</Button> : null}>No installment plan exists.</Alert>}
            <TextField label="Confirmed amount" type="number" value={form.confirmedAmount} onChange={(event) => setForm({ ...form, confirmedAmount: event.target.value })} disabled={!canApprove} helperText={form.installmentId ? 'Defaults to the selected installment remaining balance; finance may override it.' : 'Select an installment to calculate its remaining balance.'} />
            <TextField label="Reviewer note" multiline minRows={2} value={form.note} onChange={(event) => setForm({ ...form, note: event.target.value })} disabled={!canApprove} />
            <TextField label="Rejection reason" value={form.reason} onChange={(event) => setForm({ ...form, reason: event.target.value })} disabled={!canApprove} /><TextField label="Duplicate of slip ID" value={form.duplicateOfSlipId} onChange={(event) => setForm({ ...form, duplicateOfSlipId: event.target.value })} disabled={!canApprove} />
            <Typography variant="subtitle2">Recent chat context</Typography><Paper variant="outlined" sx={{ p: 1, maxHeight: 150, overflow: 'auto' }}>{(selected.recentContext || []).map((message) => <Typography key={message.id} variant="caption" display="block"><b>{message.direction}:</b> {message.text || message.type}</Typography>)}</Paper>
          </Stack>
        </Stack></DialogContent><DialogActions sx={{ flexWrap: 'wrap' }}><Button disabled={saving || !reviewable || !can('payment-slips.review')} onClick={() => run('rerun')}>Re-run detection</Button><Button disabled={saving || !reviewable || !canApprove} onClick={() => run('duplicate')}>Mark duplicate</Button><Button color="error" disabled={saving || !form.reason || !reviewable || !canApprove} onClick={() => run('reject')}>Reject</Button><Button variant="contained" color="success" disabled={saving || !form.confirmedAmount || !form.studentId || !form.studentFeeId || !form.installmentId || !reviewable || !canApprove} onClick={() => run('approve')}>{saving ? 'Saving…' : 'Approve payment'}</Button></DialogActions></>}
      </Dialog>
    </Box>
  );
}
export default PaymentVerificationPage;
