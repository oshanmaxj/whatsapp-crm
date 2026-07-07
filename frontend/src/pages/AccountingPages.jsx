import React, { useEffect, useState } from 'react';
import {
  Alert, Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, Grid,
  IconButton, MenuItem, Paper, Stack, Table, TableBody, TableCell, TableContainer,
  TableHead, TableRow, TextField, Typography
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import DownloadIcon from '@mui/icons-material/Download';
import {
  createAccountingCategory, createAccountingTransaction, deleteAccountingCategory,
  deleteAccountingTransaction, getAccountingCategories, getAccountingReports,
  getAccountingSummary, getAccountingTransactions, updateAccountingCategory,
  updateAccountingTransaction
} from '../services/accounting.service';

const methods = ['cash', 'bank', 'card', 'online', 'other'];
const money = (value) => Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const today = () => new Date().toISOString().slice(0, 10);
const errorText = (error, fallback) => error.response?.data?.message || fallback;

function PageTitle({ title, subtitle, action }) {
  return <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems={{ sm: 'center' }}><Box flex={1}><Typography variant="h4" fontWeight={900}>{title}</Typography><Typography color="text.secondary">{subtitle}</Typography></Box>{action}</Stack>;
}

function Metric({ label, value, color = 'text.primary' }) {
  return <Paper variant="outlined" sx={{ p: 2.25 }}><Typography color="text.secondary">{label}</Typography><Typography variant="h5" fontWeight={900} color={color}>{money(value)}</Typography></Paper>;
}

function TransactionTable({ rows, actions = false, onEdit, onDelete }) {
  return <TableContainer component={Paper} variant="outlined"><Table size="small">
    <TableHead><TableRow><TableCell>Date</TableCell><TableCell>Category</TableCell><TableCell>Payment</TableCell><TableCell>Reference</TableCell><TableCell>Description</TableCell><TableCell align="right">Amount</TableCell>{actions && <TableCell align="right">Actions</TableCell>}</TableRow></TableHead>
    <TableBody>
      {rows.map((row) => <TableRow key={row.id}><TableCell>{row.date}</TableCell><TableCell>{row.category?.name || '-'}</TableCell><TableCell sx={{ textTransform: 'capitalize' }}>{row.paymentMethod}</TableCell><TableCell>{row.referenceNo || '-'}</TableCell><TableCell>{row.description || '-'}</TableCell><TableCell align="right"><Typography fontWeight={800} color={row.type === 'income' ? 'success.main' : 'error.main'}>{row.type === 'income' ? '+' : '-'} {money(row.amount)}</Typography></TableCell>{actions && <TableCell align="right"><IconButton onClick={() => onEdit(row)}><EditOutlinedIcon /></IconButton><IconButton color="error" onClick={() => onDelete(row)}><DeleteOutlineIcon /></IconButton></TableCell>}</TableRow>)}
      {!rows.length && <TableRow><TableCell colSpan={actions ? 7 : 6} align="center" sx={{ py: 5 }}>No transactions found.</TableCell></TableRow>}
    </TableBody>
  </Table></TableContainer>;
}

export function AccountingDashboardPage() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => { getAccountingSummary().then((response) => setData(response.data.data)).catch((e) => setError(errorText(e, 'Unable to load accounting summary.'))); }, []);
  return <Stack spacing={2.5}>
    <PageTitle title="Accounting Dashboard" subtitle="Income, expenses, and current profitability at a glance." />
    {error && <Alert severity="error">{error}</Alert>}
    <Grid container spacing={2}>
      <Grid item xs={12} sm={6} md={4}><Metric label="Total Income" value={data?.totalIncome} color="success.main" /></Grid>
      <Grid item xs={12} sm={6} md={4}><Metric label="Total Expenses" value={data?.totalExpenses} color="error.main" /></Grid>
      <Grid item xs={12} sm={6} md={4}><Metric label="Net Profit" value={data?.netProfit} color={(data?.netProfit || 0) >= 0 ? 'success.main' : 'error.main'} /></Grid>
      <Grid item xs={12} sm={6}><Metric label="Income This Month" value={data?.incomeThisMonth} color="success.main" /></Grid>
      <Grid item xs={12} sm={6}><Metric label="Expenses This Month" value={data?.expensesThisMonth} color="error.main" /></Grid>
    </Grid>
    <Box><Typography variant="h6" fontWeight={850} sx={{ mb: 1 }}>Recent Transactions</Typography><TransactionTable rows={data?.recentTransactions || []} /></Box>
  </Stack>;
}

const blankTransaction = (type) => ({
  type, date: today(), amount: '', categoryId: '', paymentMethod: 'cash', referenceNo: '',
  description: '', relatedStudentId: '', relatedCourseId: '', relatedCampaignId: ''
});

export function AccountingTransactionsPage({ type }) {
  const title = type === 'income' ? 'Income' : 'Expenses';
  const [rows, setRows] = useState([]);
  const [categories, setCategories] = useState([]);
  const [filters, setFilters] = useState({ fromDate: '', toDate: '', categoryId: '', paymentMethod: '' });
  const [form, setForm] = useState(blankTransaction(type));
  const [editing, setEditing] = useState(null);
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState(null);
  const load = async () => {
    const [transactions, categoryRows] = await Promise.all([
      getAccountingTransactions({ ...filters, type }),
      getAccountingCategories({ type })
    ]);
    setRows(transactions.data.data || []);
    setCategories(categoryRows.data.data || []);
  };
  useEffect(() => { load().catch((e) => setMessage({ severity: 'error', text: errorText(e, `Unable to load ${title.toLowerCase()}.`) })); }, [type, filters.fromDate, filters.toDate, filters.categoryId, filters.paymentMethod]);
  const beginCreate = () => { setEditing(null); setForm(blankTransaction(type)); setOpen(true); };
  const beginEdit = (row) => { setEditing(row); setForm({ ...blankTransaction(type), ...row, categoryId: row.categoryId || row.category?.id || '' }); setOpen(true); };
  const save = async () => {
    try {
      if (editing) await updateAccountingTransaction(editing.id, form);
      else await createAccountingTransaction(form);
      setOpen(false); await load(); setMessage({ severity: 'success', text: `${type === 'income' ? 'Income' : 'Expense'} saved.` });
    } catch (e) { setMessage({ severity: 'error', text: errorText(e, 'Unable to save transaction.') }); }
  };
  const remove = async (row) => {
    if (!window.confirm('Delete this transaction?')) return;
    try { await deleteAccountingTransaction(row.id); await load(); } catch (e) { setMessage({ severity: 'error', text: errorText(e, 'Unable to delete transaction.') }); }
  };
  return <Stack spacing={2.5}>
    <PageTitle title={title} subtitle={`Manage and filter ${title.toLowerCase()} transactions.`} action={<Button variant="contained" startIcon={<AddIcon />} onClick={beginCreate}>Add {type}</Button>} />
    {message && <Alert severity={message.severity} onClose={() => setMessage(null)}>{message.text}</Alert>}
    <Paper variant="outlined" sx={{ p: 2 }}><Grid container spacing={1.5}>
      <Grid item xs={12} sm={6} md={3}><TextField type="date" label="From" value={filters.fromDate} onChange={(e) => setFilters({ ...filters, fromDate: e.target.value })} InputLabelProps={{ shrink: true }} fullWidth /></Grid>
      <Grid item xs={12} sm={6} md={3}><TextField type="date" label="To" value={filters.toDate} onChange={(e) => setFilters({ ...filters, toDate: e.target.value })} InputLabelProps={{ shrink: true }} fullWidth /></Grid>
      <Grid item xs={12} sm={6} md={3}><TextField select label="Category" value={filters.categoryId} onChange={(e) => setFilters({ ...filters, categoryId: e.target.value })} fullWidth><MenuItem value="">All categories</MenuItem>{categories.map((item) => <MenuItem key={item.id} value={item.id}>{item.name}</MenuItem>)}</TextField></Grid>
      <Grid item xs={12} sm={6} md={3}><TextField select label="Payment method" value={filters.paymentMethod} onChange={(e) => setFilters({ ...filters, paymentMethod: e.target.value })} fullWidth><MenuItem value="">All methods</MenuItem>{methods.map((item) => <MenuItem key={item} value={item}>{item}</MenuItem>)}</TextField></Grid>
    </Grid></Paper>
    <TransactionTable rows={rows} actions onEdit={beginEdit} onDelete={remove} />
    <Dialog open={open} onClose={() => setOpen(false)} fullWidth maxWidth="sm"><DialogTitle>{editing ? 'Edit' : 'Add'} {type}</DialogTitle><DialogContent><Grid container spacing={2} sx={{ pt: 1 }}>
      <Grid item xs={12} sm={6}><TextField type="date" label="Date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} InputLabelProps={{ shrink: true }} fullWidth required /></Grid>
      <Grid item xs={12} sm={6}><TextField type="number" label="Amount" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} inputProps={{ min: 0.01, step: 0.01 }} fullWidth required /></Grid>
      <Grid item xs={12} sm={6}><TextField select label="Category" value={form.categoryId} onChange={(e) => setForm({ ...form, categoryId: e.target.value })} fullWidth required>{categories.filter((item) => item.isActive || String(item.id) === String(form.categoryId)).map((item) => <MenuItem key={item.id} value={item.id}>{item.name}</MenuItem>)}</TextField></Grid>
      <Grid item xs={12} sm={6}><TextField select label="Payment method" value={form.paymentMethod} onChange={(e) => setForm({ ...form, paymentMethod: e.target.value })} fullWidth>{methods.map((item) => <MenuItem key={item} value={item}>{item}</MenuItem>)}</TextField></Grid>
      <Grid item xs={12}><TextField label="Reference number" value={form.referenceNo || ''} onChange={(e) => setForm({ ...form, referenceNo: e.target.value })} fullWidth /></Grid>
      <Grid item xs={12}><TextField label="Description" value={form.description || ''} onChange={(e) => setForm({ ...form, description: e.target.value })} multiline minRows={2} fullWidth /></Grid>
      <Grid item xs={12} sm={4}><TextField label="Student ID" value={form.relatedStudentId || ''} onChange={(e) => setForm({ ...form, relatedStudentId: e.target.value })} fullWidth /></Grid>
      <Grid item xs={12} sm={4}><TextField label="Course ID" value={form.relatedCourseId || ''} onChange={(e) => setForm({ ...form, relatedCourseId: e.target.value })} fullWidth /></Grid>
      <Grid item xs={12} sm={4}><TextField label="Campaign ID" value={form.relatedCampaignId || ''} onChange={(e) => setForm({ ...form, relatedCampaignId: e.target.value })} fullWidth /></Grid>
    </Grid></DialogContent><DialogActions><Button onClick={() => setOpen(false)}>Cancel</Button><Button variant="contained" disabled={!form.date || !form.amount || !form.categoryId} onClick={save}>Save</Button></DialogActions></Dialog>
  </Stack>;
}

export function AccountingCategoriesPage() {
  const [rows, setRows] = useState([]);
  const [form, setForm] = useState({ name: '', type: 'income', description: '', isActive: true });
  const [editing, setEditing] = useState(null);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');
  const load = () => getAccountingCategories().then((response) => setRows(response.data.data || []));
  useEffect(() => { load().catch((e) => setError(errorText(e, 'Unable to load categories.'))); }, []);
  const save = async () => {
    try { if (editing) await updateAccountingCategory(editing.id, form); else await createAccountingCategory(form); setOpen(false); await load(); }
    catch (e) { setError(errorText(e, 'Unable to save category.')); }
  };
  const edit = (row) => { setEditing(row); setForm({ name: row.name, type: row.type, description: row.description || '', isActive: row.isActive }); setOpen(true); };
  const deactivate = async (row) => {
    if (!window.confirm(row.isActive ? 'Deactivate this category?' : 'Delete this inactive category?')) return;
    try { await deleteAccountingCategory(row.id); await load(); } catch (e) { setError(errorText(e, 'Unable to update category.')); }
  };
  return <Stack spacing={2.5}>
    <PageTitle title="Accounting Categories" subtitle="Organize income and expenses into reusable categories." action={<Button variant="contained" startIcon={<AddIcon />} onClick={() => { setEditing(null); setForm({ name: '', type: 'income', description: '', isActive: true }); setOpen(true); }}>Add category</Button>} />
    {error && <Alert severity="error" onClose={() => setError('')}>{error}</Alert>}
    <TableContainer component={Paper} variant="outlined"><Table><TableHead><TableRow><TableCell>Name</TableCell><TableCell>Type</TableCell><TableCell>Description</TableCell><TableCell>Status</TableCell><TableCell align="right">Actions</TableCell></TableRow></TableHead><TableBody>
      {rows.map((row) => <TableRow key={row.id}><TableCell>{row.name}</TableCell><TableCell><Chip size="small" color={row.type === 'income' ? 'success' : 'error'} label={row.type} /></TableCell><TableCell>{row.description || '-'}</TableCell><TableCell><Chip size="small" label={row.isActive ? 'Active' : 'Inactive'} /></TableCell><TableCell align="right"><IconButton onClick={() => edit(row)}><EditOutlinedIcon /></IconButton><IconButton color="error" onClick={() => deactivate(row)}><DeleteOutlineIcon /></IconButton></TableCell></TableRow>)}
    </TableBody></Table></TableContainer>
    <Dialog open={open} onClose={() => setOpen(false)} fullWidth maxWidth="sm"><DialogTitle>{editing ? 'Edit' : 'Add'} category</DialogTitle><DialogContent><Stack spacing={2} sx={{ pt: 1 }}><TextField label="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /><TextField select label="Type" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}><MenuItem value="income">Income</MenuItem><MenuItem value="expense">Expense</MenuItem></TextField><TextField label="Description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} multiline minRows={2} />{editing && <TextField select label="Status" value={form.isActive ? 'active' : 'inactive'} onChange={(e) => setForm({ ...form, isActive: e.target.value === 'active' })}><MenuItem value="active">Active</MenuItem><MenuItem value="inactive">Inactive</MenuItem></TextField>}</Stack></DialogContent><DialogActions><Button onClick={() => setOpen(false)}>Cancel</Button><Button variant="contained" disabled={!form.name.trim()} onClick={save}>Save</Button></DialogActions></Dialog>
  </Stack>;
}

function csvCell(value) {
  return `"${String(value ?? '').replaceAll('"', '""')}"`;
}

export function AccountingReportsPage() {
  const [filters, setFilters] = useState({ fromDate: '', toDate: '' });
  const [report, setReport] = useState({ totalIncome: 0, totalExpenses: 0, netProfit: 0, categoryBreakdown: [], transactions: [] });
  const [error, setError] = useState('');
  const load = () => getAccountingReports(filters).then((response) => setReport(response.data.data));
  useEffect(() => { load().catch((e) => setError(errorText(e, 'Unable to load accounting report.'))); }, []);
  const exportCsv = () => {
    const lines = [
      ['Date', 'Type', 'Category', 'Payment Method', 'Reference', 'Description', 'Amount'].map(csvCell).join(','),
      ...report.transactions.map((row) => [row.date, row.type, row.category?.name, row.paymentMethod, row.referenceNo, row.description, row.amount].map(csvCell).join(','))
    ];
    const url = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = `accounting-report-${today()}.csv`; link.click(); URL.revokeObjectURL(url);
  };
  return <Stack spacing={2.5}>
    <PageTitle title="Accounting Reports" subtitle="Compare income and expenses and inspect category performance." action={<Button startIcon={<DownloadIcon />} variant="outlined" onClick={exportCsv}>Export CSV</Button>} />
    {error && <Alert severity="error">{error}</Alert>}
    <Paper variant="outlined" sx={{ p: 2 }}><Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}><TextField type="date" label="From" value={filters.fromDate} onChange={(e) => setFilters({ ...filters, fromDate: e.target.value })} InputLabelProps={{ shrink: true }} /><TextField type="date" label="To" value={filters.toDate} onChange={(e) => setFilters({ ...filters, toDate: e.target.value })} InputLabelProps={{ shrink: true }} /><Button variant="contained" onClick={() => load().catch((e) => setError(errorText(e, 'Unable to load report.')))}>Apply</Button></Stack></Paper>
    <Grid container spacing={2}><Grid item xs={12} md={4}><Metric label="Income" value={report.totalIncome} color="success.main" /></Grid><Grid item xs={12} md={4}><Metric label="Expenses" value={report.totalExpenses} color="error.main" /></Grid><Grid item xs={12} md={4}><Metric label="Net Profit" value={report.netProfit} /></Grid></Grid>
    <TableContainer component={Paper} variant="outlined"><Table><TableHead><TableRow><TableCell>Type</TableCell><TableCell>Category</TableCell><TableCell align="right">Transactions</TableCell><TableCell align="right">Total</TableCell></TableRow></TableHead><TableBody>{report.categoryBreakdown.map((row) => <TableRow key={`${row.type}-${row.categoryId}`}><TableCell><Chip size="small" color={row.type === 'income' ? 'success' : 'error'} label={row.type} /></TableCell><TableCell>{row.category}</TableCell><TableCell align="right">{row.count}</TableCell><TableCell align="right">{money(row.total)}</TableCell></TableRow>)}</TableBody></Table></TableContainer>
  </Stack>;
}
