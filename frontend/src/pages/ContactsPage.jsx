import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Drawer,
  FormControl,
  Grid,
  IconButton,
  InputLabel,
  LinearProgress,
  MenuItem,
  Paper,
  Select,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TablePagination,
  TableRow,
  TextField,
  Typography
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import DownloadIcon from '@mui/icons-material/Download';
import EditIcon from '@mui/icons-material/Edit';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import VisibilityIcon from '@mui/icons-material/Visibility';
import {
  createContact,
  deleteContact,
  exportContactsCsv,
  getContacts,
  importContactsCsv,
  updateContact
} from '../services/contact.service';
import WhatsAppAccountSelect from '../components/WhatsAppAccountSelect';

const statusOptions = ['new', 'active', 'inactive', 'archived'];
const initialForm = {
  firstName: '',
  lastName: '',
  phone: '',
  email: '',
  company: '',
  status: 'new',
  notes: '',
  tags: ''
};

function toForm(contact) {
  return {
    firstName: contact?.firstName || '',
    lastName: contact?.lastName || '',
    phone: contact?.phone || '',
    email: contact?.email || '',
    company: contact?.company || '',
    status: contact?.status || 'new',
    notes: contact?.notes || '',
    tags: Array.isArray(contact?.tags) ? contact.tags.join(', ') : ''
  };
}

function toPayload(form) {
  return {
    ...form,
    tags: form.tags
      .split(',')
      .map((tag) => tag.trim())
      .filter(Boolean)
  };
}

function fullName(contact) {
  return [contact.firstName, contact.lastName].filter(Boolean).join(' ') || 'Unnamed contact';
}

function ContactsPage() {
  const fileInputRef = useRef(null);
  const [contacts, setContacts] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, limit: 10, total: 0, pages: 0 });
  const [filters, setFilters] = useState({ search: '', status: '', tag: '', whatsappAccountId: '' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(initialForm);
  const [profile, setProfile] = useState(null);

  const query = useMemo(
    () => ({
      page: pagination.page,
      limit: pagination.limit,
      search: filters.search || undefined,
      status: filters.status || undefined,
      tag: filters.tag || undefined,
      whatsappAccountId: filters.whatsappAccountId || undefined
    }),
    [filters, pagination.page, pagination.limit]
  );

  const loadContacts = async () => {
    try {
      setError('');
      setLoading(true);
      const response = await getContacts(query);
      setContacts(response.data.data.contacts || []);
      setPagination(response.data.data.pagination || { page: 1, limit: 10, total: 0, pages: 0 });
    } catch (err) {
      setError(err.response?.data?.message || 'Unable to load contacts.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadContacts();
  }, [query]);

  const handleFilterChange = (field) => (event) => {
    setFilters((current) => ({ ...current, [field]: event.target.value }));
    setPagination((current) => ({ ...current, page: 1 }));
  };

  const openCreateDialog = () => {
    setEditing(null);
    setForm(initialForm);
    setDialogOpen(true);
  };

  const openEditDialog = (contact) => {
    setEditing(contact);
    setForm(toForm(contact));
    setDialogOpen(true);
  };

  const handleFormChange = (field) => (event) => {
    setForm((current) => ({ ...current, [field]: event.target.value }));
  };

  const saveContact = async () => {
    try {
      setError('');
      const payload = toPayload(form);
      if (editing) {
        await updateContact(editing.id, payload);
        setSuccess('Contact updated.');
      } else {
        await createContact(payload);
        setSuccess('Contact added.');
      }
      setDialogOpen(false);
      await loadContacts();
    } catch (err) {
      setError(err.response?.data?.message || 'Unable to save contact.');
    }
  };

  const removeContact = async (contact) => {
    if (!window.confirm(`Delete ${fullName(contact)}?`)) return;
    try {
      setError('');
      await deleteContact(contact.id);
      setSuccess('Contact deleted.');
      await loadContacts();
      if (profile?.id === contact.id) setProfile(null);
    } catch (err) {
      setError(err.response?.data?.message || 'Unable to delete contact.');
    }
  };

  const handleImport = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      setError('');
      const csv = await file.text();
      const response = await importContactsCsv(csv);
      const result = response.data.data;
      setSuccess(`Imported ${result.created} created, ${result.updated} updated, ${result.skipped} skipped.`);
      await loadContacts();
    } catch (err) {
      setError(err.response?.data?.message || 'Unable to import contacts.');
    } finally {
      event.target.value = '';
    }
  };

  const handleExport = async () => {
    try {
      setError('');
      const response = await exportContactsCsv({
        search: filters.search || undefined,
        status: filters.status || undefined,
        tag: filters.tag || undefined,
        whatsappAccountId: filters.whatsappAccountId || undefined
      });
      const blobUrl = window.URL.createObjectURL(response.data);
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = 'contacts.csv';
      link.click();
      window.URL.revokeObjectURL(blobUrl);
    } catch (err) {
      setError(err.response?.data?.message || 'Unable to export contacts.');
    }
  };

  return (
    <Stack spacing={2.5}>
      {error && <Alert severity="error" onClose={() => setError('')}>{error}</Alert>}
      {success && <Alert severity="success" onClose={() => setSuccess('')}>{success}</Alert>}

      <Paper sx={{ p: 2.5, border: '1px solid #e8edf2' }} elevation={0}>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} alignItems={{ xs: 'stretch', md: 'center' }}>
          <TextField label="Search name or phone" value={filters.search} onChange={handleFilterChange('search')} fullWidth />
          <FormControl sx={{ minWidth: 160 }}>
            <InputLabel>Status</InputLabel>
            <Select label="Status" value={filters.status} onChange={handleFilterChange('status')}>
              <MenuItem value="">All</MenuItem>
              {statusOptions.map((status) => (
                <MenuItem key={status} value={status}>
                  {status}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <TextField label="Tag" value={filters.tag} onChange={handleFilterChange('tag')} sx={{ minWidth: 160 }} />
          <WhatsAppAccountSelect value={filters.whatsappAccountId} onChange={(value) => { setFilters((current) => ({ ...current, whatsappAccountId: value })); setPagination((current) => ({ ...current, page: 1 })); }} allowAll sx={{ minWidth: 230 }} />
          <Button variant="outlined" startIcon={<UploadFileIcon />} onClick={() => fileInputRef.current?.click()}>
            Import
          </Button>
          <Button variant="outlined" startIcon={<DownloadIcon />} onClick={handleExport}>
            Export
          </Button>
          <Button variant="contained" startIcon={<AddIcon />} onClick={openCreateDialog} sx={{ bgcolor: '#128c7e' }}>
            Add
          </Button>
          <input ref={fileInputRef} type="file" accept=".csv,text/csv" hidden onChange={handleImport} />
        </Stack>
      </Paper>

      <Paper sx={{ border: '1px solid #e8edf2', overflow: 'hidden' }} elevation={0}>
        {loading && <LinearProgress />}
        <TableContainer>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>Name</TableCell>
                <TableCell>Phone</TableCell>
                <TableCell>Status</TableCell>
                <TableCell>Tags</TableCell>
                <TableCell>Company</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {contacts.map((contact) => (
                <TableRow key={contact.id} hover>
                  <TableCell>
                    <Typography fontWeight={800}>{fullName(contact)}</Typography>
                    <Typography variant="body2" color="text.secondary">{contact.email || '-'}</Typography>
                  </TableCell>
                  <TableCell>{contact.phone}</TableCell>
                  <TableCell><Chip size="small" label={contact.status} color={contact.status === 'active' ? 'success' : 'default'} /></TableCell>
                  <TableCell>
                    <Stack direction="row" gap={0.5} flexWrap="wrap">
                      {(contact.tags || []).map((tag) => <Chip key={tag} size="small" label={tag} variant="outlined" />)}
                    </Stack>
                  </TableCell>
                  <TableCell>{contact.company || '-'}</TableCell>
                  <TableCell align="right">
                    <IconButton onClick={() => setProfile(contact)}><VisibilityIcon /></IconButton>
                    <IconButton onClick={() => openEditDialog(contact)}><EditIcon /></IconButton>
                    <IconButton color="error" onClick={() => removeContact(contact)}><DeleteOutlineIcon /></IconButton>
                  </TableCell>
                </TableRow>
              ))}
              {!loading && contacts.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6}>
                    <Box sx={{ py: 5, textAlign: 'center' }}>
                      <Typography fontWeight={800}>No contacts found</Typography>
                      <Typography color="text.secondary">Add a contact or import a CSV to begin.</Typography>
                    </Box>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
        <TablePagination
          component="div"
          count={pagination.total}
          page={Math.max(pagination.page - 1, 0)}
          rowsPerPage={pagination.limit}
          onPageChange={(event, page) => setPagination((current) => ({ ...current, page: page + 1 }))}
          onRowsPerPageChange={(event) => setPagination({ page: 1, limit: Number(event.target.value), total: pagination.total, pages: pagination.pages })}
          rowsPerPageOptions={[10, 20, 50, 100]}
        />
      </Paper>

      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle>{editing ? 'Edit Contact' : 'Add Contact'}</DialogTitle>
        <DialogContent>
          <Grid container spacing={2} sx={{ mt: 0.5 }}>
            <Grid item xs={12} sm={6}><TextField label="First name" value={form.firstName} onChange={handleFormChange('firstName')} fullWidth /></Grid>
            <Grid item xs={12} sm={6}><TextField label="Last name" value={form.lastName} onChange={handleFormChange('lastName')} fullWidth /></Grid>
            <Grid item xs={12} sm={6}><TextField label="Phone" value={form.phone} onChange={handleFormChange('phone')} required fullWidth /></Grid>
            <Grid item xs={12} sm={6}><TextField label="Email" value={form.email} onChange={handleFormChange('email')} fullWidth /></Grid>
            <Grid item xs={12} sm={6}><TextField label="Company" value={form.company} onChange={handleFormChange('company')} fullWidth /></Grid>
            <Grid item xs={12} sm={6}>
              <FormControl fullWidth>
                <InputLabel>Status</InputLabel>
                <Select label="Status" value={form.status} onChange={handleFormChange('status')}>
                  {statusOptions.map((status) => <MenuItem key={status} value={status}>{status}</MenuItem>)}
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12}><TextField label="Tags" helperText="Comma separated labels" value={form.tags} onChange={handleFormChange('tags')} fullWidth /></Grid>
            <Grid item xs={12}><TextField label="Notes" value={form.notes} onChange={handleFormChange('notes')} multiline minRows={4} fullWidth /></Grid>
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialogOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={saveContact} disabled={!form.phone.trim()}>
            Save
          </Button>
        </DialogActions>
      </Dialog>

      <Drawer anchor="right" open={!!profile} onClose={() => setProfile(null)} PaperProps={{ sx: { width: { xs: '100%', sm: 420 }, p: 3 } }}>
        {profile && (
          <Stack spacing={2}>
            <Box>
              <Typography variant="h5" fontWeight={850}>{fullName(profile)}</Typography>
              <Typography color="text.secondary">{profile.phone}</Typography>
            </Box>
            <Divider />
            <Box>
              <Typography variant="subtitle2" color="text.secondary">Status</Typography>
              <Chip label={profile.status} color={profile.status === 'active' ? 'success' : 'default'} sx={{ mt: 0.75 }} />
            </Box>
            <Box>
              <Typography variant="subtitle2" color="text.secondary">Contact Details</Typography>
              <Typography>Email: {profile.email || '-'}</Typography>
              <Typography>Company: {profile.company || '-'}</Typography>
            </Box>
            <Box>
              <Typography variant="subtitle2" color="text.secondary">Tags</Typography>
              <Stack direction="row" gap={0.75} flexWrap="wrap" sx={{ mt: 0.75 }}>
                {(profile.tags || []).length ? profile.tags.map((tag) => <Chip key={tag} size="small" label={tag} />) : <Typography color="text.secondary">No tags</Typography>}
              </Stack>
            </Box>
            <Box>
              <Typography variant="subtitle2" color="text.secondary">Notes</Typography>
              <Typography sx={{ whiteSpace: 'pre-wrap' }}>{profile.notes || 'No notes yet.'}</Typography>
            </Box>
            <Stack direction="row" spacing={1}>
              <Button variant="outlined" startIcon={<EditIcon />} onClick={() => openEditDialog(profile)}>Edit</Button>
              <Button color="error" startIcon={<DeleteOutlineIcon />} onClick={() => removeContact(profile)}>Delete</Button>
            </Stack>
          </Stack>
        )}
      </Drawer>
    </Stack>
  );
}

export default ContactsPage;
