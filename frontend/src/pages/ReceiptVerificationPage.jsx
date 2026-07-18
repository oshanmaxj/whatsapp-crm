import React, { useEffect, useState } from 'react';
import { Alert, Box, CircularProgress, Paper, Stack, Typography } from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorIcon from '@mui/icons-material/Error';
import { useParams } from 'react-router-dom';
import { verifyReceipt } from '../services/paymentReceipt.service';

export default function ReceiptVerificationPage() {
  const { token } = useParams();
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => { verifyReceipt(token).then((response) => setResult(response.data?.data)).catch(() => setError('Unable to verify this receipt.')); }, [token]);
  if (!result && !error) return <Box display="grid" minHeight="100vh" sx={{ placeItems: 'center' }}><CircularProgress /></Box>;
  const valid = result?.valid;
  return <Box minHeight="100vh" bgcolor="background.default" display="grid" sx={{ placeItems: 'center', p: 2 }}><Paper sx={{ maxWidth: 560, width: '100%', p: 4 }}><Stack spacing={2} alignItems="center">
    {valid ? <CheckCircleIcon color={result.status === 'ACTIVE' ? 'success' : 'warning'} sx={{ fontSize: 64 }} /> : <ErrorIcon color="error" sx={{ fontSize: 64 }} />}
    <Typography variant="h4">Receipt Verification</Typography>
    {error && <Alert severity="error">{error}</Alert>}
    {!valid && !error && <Alert severity="error">This receipt token is invalid.</Alert>}
    {valid && <><Alert severity={result.status === 'ACTIVE' ? 'success' : 'warning'} sx={{ width: '100%' }}>Receipt is authentic. Status: {result.status}</Alert>{[
      ['Receipt No', result.receiptNumber], ['Receipt Date', new Date(result.receiptDate).toLocaleDateString()], ['Student', result.studentName], ['Course', result.course || '-'], ['Amount', `${result.currency} ${Number(result.amount).toLocaleString('en-LK', { minimumFractionDigits: 2 })}`]
    ].map(([label, value]) => <Box key={label} width="100%" display="flex" justifyContent="space-between"><Typography color="text.secondary">{label}</Typography><Typography fontWeight={600}>{value}</Typography></Box>)}</>}
  </Stack></Paper></Box>;
}
