import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert, Box, Button, Checkbox, Chip, CircularProgress, Dialog, DialogActions, DialogContent,
  DialogTitle, Divider, FormControl, FormControlLabel, IconButton, InputAdornment, InputLabel, LinearProgress,
  MenuItem, Paper, Select, Stack, Tab, Table, TableBody, TableCell, TableContainer, TableHead,
  TableRow, Tabs, TextField, Tooltip, Typography, Switch
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import RemoveCircleOutlineIcon from '@mui/icons-material/RemoveCircleOutline';
import SearchIcon from '@mui/icons-material/Search';
import {
  createRole, deactivateRole, getPermissions, getRoles, getUserPermissions, getUsers, setRolePermissions,
  setUserPermissions, updateRole
} from '../services/userManagement.service';

const ACTIONS = ['view', 'create', 'edit', 'delete', 'send', 'export', 'special'];
const ACTION_LABELS = {
  view: 'View', create: 'Create', edit: 'Edit', delete: 'Delete',
  send: 'Send', export: 'Export', special: 'Special'
};
const MODULE_ORDER = [
  'Inbox', 'Contacts', 'Leads', 'Agents', 'Campaigns', 'Appointments', 'Students', 'Fees',
  'Attendance', 'Reports', 'Settings', 'Courses', 'Batches', 'Certificates', 'Workflows',
  'Flow Builder', 'Connect WhatsApp', 'User Manager', 'Dashboard'
];
const MODULE_LABELS = { Inbox: 'Chat' };
const TEMPLATES = [
  { key: 'admin', label: 'Admin', description: 'Every available permission' },
  { key: 'manager', label: 'Manager', description: 'All except delete and settings' },
  { key: 'sales', label: 'Sales Agent', description: 'Chat, contacts, leads and appointments' },
  { key: 'support', label: 'Support Agent', description: 'Chat and contact support tools' },
  { key: 'education', label: 'Education Staff', description: 'Student and education operations' },
  { key: 'accountant', label: 'Accountant', description: 'Fees and reporting access' },
  { key: 'viewer', label: 'Viewer', description: 'View-only access' }
];
const TEMPLATE_CHAT_SCOPES = {
  admin: 'all',
  manager: 'all',
  sales: 'all',
  support: 'assigned_only',
  education: 'assigned_only',
  accountant: 'assigned_only',
  viewer: 'assigned_only'
};

function roleLabel(role) {
  const value = String(role || '');
  return value ? value.charAt(0).toUpperCase() + value.slice(1).replace(/-/g, ' ') : 'Role';
}

function requestErrorMessage(error, fallback) {
  const details = error.response?.data?.details;
  if (Array.isArray(details) && details.length) {
    return details.map((detail) => detail?.message || String(detail)).filter(Boolean).join('. ');
  }
  return error.response?.data?.message || fallback;
}

function permissionMeta(permission) {
  const name = String(permission.name || '');
  const match = name.match(/^(.*)\s+(View|Create|Edit|Delete|Export|Send|Publish|Test)$/i);
  const codeParts = String(permission.code || '').split('.');
  const rawAction = String(codeParts.pop() || match?.[2] || '').toLowerCase();
  const group = match?.[1] || String(codeParts.join('-'))
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
  return {
    group,
    action: ['publish', 'test'].includes(rawAction) ? 'special' : rawAction,
    rawAction
  };
}

function buildGroups(rows) {
  const map = new Map();
  rows.forEach((permission) => {
    const meta = permissionMeta(permission);
    if (!map.has(meta.group)) map.set(meta.group, { name: meta.group, permissions: [] });
    map.get(meta.group).permissions.push({ ...permission, ...meta });
  });
  return Array.from(map.values()).sort((a, b) => {
    const left = MODULE_ORDER.indexOf(a.name);
    const right = MODULE_ORDER.indexOf(b.name);
    if (left === -1 && right === -1) return a.name.localeCompare(b.name);
    if (left === -1) return 1;
    if (right === -1) return -1;
    return left - right;
  });
}

function templatePermissionIds(template, permissions) {
  return permissions.filter((permission) => {
    const { group, action } = permissionMeta(permission);
    if (template === 'admin') return true;
    if (template === 'manager') return action !== 'delete' && group !== 'Settings';
    if (template === 'sales') {
      return ['Inbox', 'Contacts', 'Leads', 'Appointments'].includes(group)
        && ['view', 'create', 'edit', 'send'].includes(action);
    }
    if (template === 'support') {
      return ['Inbox', 'Contacts'].includes(group) && ['view', 'edit', 'send'].includes(action);
    }
    if (template === 'education') {
      return ['Students', 'Fees', 'Attendance', 'Batches', 'Courses'].includes(group);
    }
    if (template === 'accountant') {
      return ['Fees', 'Reports'].includes(group) && ['view', 'edit', 'export'].includes(action);
    }
    return template === 'viewer' && action === 'view';
  }).map((permission) => permission.id);
}

function moduleAccessLabel(group, selected) {
  const ids = group.permissions.map((permission) => permission.id);
  const selectedCount = ids.filter((id) => selected.has(id)).length;
  const viewIds = group.permissions.filter((permission) => permission.action === 'view').map((permission) => permission.id);
  if (selectedCount === ids.length && ids.length) return 'Full Access';
  if (selectedCount === 0) return 'No Access';
  if (viewIds.length && selectedCount === viewIds.length && viewIds.every((id) => selected.has(id))) return 'View Only';
  return 'Custom';
}

function PermissionCheckbox({ permissions, selected, onChange }) {
  if (!permissions.length) return <Typography color="text.disabled">-</Typography>;
  const checkedCount = permissions.filter((permission) => selected.has(permission.id)).length;
  return (
    <Tooltip title={permissions.map((permission) => permission.name).join(', ')}>
      <Checkbox
        size="small"
        checked={checkedCount === permissions.length}
        indeterminate={checkedCount > 0 && checkedCount < permissions.length}
        onChange={(event) => onChange(permissions, event.target.checked)}
        inputProps={{ 'aria-label': permissions.map((permission) => permission.name).join(', ') }}
      />
    </Tooltip>
  );
}

function SummaryPanel({ selectedRole, selected, permissions, dirty }) {
  const allowed = selected.size;
  const denied = Math.max(permissions.length - allowed, 0);
  const percent = permissions.length ? Math.round((allowed / permissions.length) * 100) : 0;
  return (
    <Box sx={{ position: { xl: 'sticky' }, top: { xl: 16 } }}>
      <Typography variant="subtitle1" fontWeight={800}>Access Summary</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
        {selectedRole ? roleLabel(selectedRole.name) : 'Select a department'}
      </Typography>
      <Stack spacing={1.25} sx={{ mt: 2 }}>
        <Stack direction="row" justifyContent="space-between">
          <Typography variant="body2">Allowed</Typography>
          <Chip size="small" color="success" label={allowed} icon={<CheckCircleOutlineIcon />} />
        </Stack>
        <Stack direction="row" justifyContent="space-between">
          <Typography variant="body2">Not granted</Typography>
          <Chip size="small" label={denied} icon={<RemoveCircleOutlineIcon />} />
        </Stack>
        <Stack direction="row" justifyContent="space-between">
          <Typography variant="body2">Coverage</Typography>
          <Typography variant="body2" fontWeight={800}>{percent}%</Typography>
        </Stack>
        <LinearProgress variant="determinate" value={percent} color="success" sx={{ height: 7, borderRadius: 1 }} />
        {dirty && <Alert severity="warning" icon={false}>Unsaved role changes</Alert>}
      </Stack>
    </Box>
  );
}

function PermissionManagementPage() {
  const [roles, setRoles] = useState([]);
  const [users, setUsers] = useState([]);
  const [permissions, setPermissions] = useState([]);
  const [selectedRoleId, setSelectedRoleId] = useState('');
  const [roleDraft, setRoleDraft] = useState(new Set());
  const [roleChatScope, setRoleChatScope] = useState('assigned_only');
  const [roleDepartmentNotifications, setRoleDepartmentNotifications] = useState(false);
  const [roleDirty, setRoleDirty] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState('');
  const [userPermissionRows, setUserPermissionRows] = useState([]);
  const [userLoading, setUserLoading] = useState(false);
  const [activeView, setActiveView] = useState('roles');
  const [search, setSearch] = useState('');
  const [moduleFilter, setModuleFilter] = useState('');
  const [expanded, setExpanded] = useState(new Set());
  const [editingRole, setEditingRole] = useState(null);
  const [roleDialogOpen, setRoleDialogOpen] = useState(false);
  const [roleName, setRoleName] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const load = async () => {
    try {
      setLoading(true);
      setError('');
      const [rolesRes, permissionsRes, usersRes] = await Promise.all([getRoles(showInactive), getPermissions(), getUsers()]);
      const nextRoles = rolesRes.data.data || [];
      setRoles(nextRoles);
      setPermissions(permissionsRes.data.data || []);
      setUsers(usersRes.data.data || []);
      setSelectedRoleId((current) => nextRoles.some((role) => String(role.id) === String(current))
        ? current
        : String(nextRoles[0]?.id || ''));
    } catch (err) {
      setError(requestErrorMessage(err, 'Unable to load permissions.'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [showInactive]);

  const selectedRole = roles.find((role) => String(role.id) === String(selectedRoleId));
  useEffect(() => {
    if (!selectedRole) return;
    setRoleDraft(new Set((selectedRole.permissions || []).map((permission) => permission.id)));
    setRoleChatScope(selectedRole.chatVisibilityScope || 'assigned_only');
    setRoleDepartmentNotifications(Boolean(selectedRole.receiveDepartmentAssignmentNotifications));
    setRoleDirty(false);
  }, [selectedRole]);

  const roleGroups = useMemo(() => buildGroups(permissions), [permissions]);
  const userGroups = useMemo(() => buildGroups(userPermissionRows), [userPermissionRows]);
  const visibleGroups = useMemo(() => {
    const source = activeView === 'roles' ? roleGroups : userGroups;
    const term = search.trim().toLowerCase();
    return source.filter((group) => {
      if (moduleFilter && group.name !== moduleFilter) return false;
      if (!term) return true;
      return (MODULE_LABELS[group.name] || group.name).toLowerCase().includes(term)
        || group.permissions.some((permission) =>
          String(permission.name).toLowerCase().includes(term)
          || String(permission.code).toLowerCase().includes(term));
    });
  }, [activeView, moduleFilter, roleGroups, search, userGroups]);

  const updateRolePermissions = (items, checked) => {
    setRoleDraft((current) => {
      const next = new Set(current);
      items.forEach((permission) => checked ? next.add(permission.id) : next.delete(permission.id));
      return next;
    });
    setRoleDirty(true);
  };

  const applyModulePreset = (group, preset) => {
    setRoleDraft((current) => {
      const next = new Set(current);
      group.permissions.forEach((permission) => next.delete(permission.id));
      if (preset === 'full') group.permissions.forEach((permission) => next.add(permission.id));
      if (preset === 'view') {
        group.permissions.filter((permission) => permission.action === 'view')
          .forEach((permission) => next.add(permission.id));
      }
      return next;
    });
    setRoleDirty(true);
  };

  const applyTemplate = (template) => {
    setRoleDraft(new Set(templatePermissionIds(template, permissions)));
    setRoleChatScope(TEMPLATE_CHAT_SCOPES[template] || 'assigned_only');
    setRoleDirty(true);
  };

  const saveRolePermissions = async () => {
    if (!selectedRole) return;
    try {
      setSaving(true);
      setError('');
      await updateRole(selectedRole.id, {
        chatVisibilityScope: roleChatScope,
        receiveDepartmentAssignmentNotifications: roleDepartmentNotifications
      });
      await setRolePermissions(selectedRole.id, Array.from(roleDraft));
      setNotice('Permissions saved successfully');
      await load();
    } catch (err) {
      setError(requestErrorMessage(err, 'Unable to save role permissions.'));
    } finally {
      setSaving(false);
    }
  };

  const toggleRoleActive = async () => {
    if (!selectedRole) return;
    const userCount = users.filter((user) => (user.roles || []).some((role) => String(role.id) === String(selectedRole.id))).length;
    const warning = userCount
      ? `This department has ${userCount} user(s). It will be deactivated, not deleted, and retained for history. Continue?`
      : 'Deactivate this department and retain it for history?';
    if (selectedRole.isActive !== false && !window.confirm(warning)) return;
    try {
      setSaving(true);
      setError('');
      if (selectedRole.isActive === false) {
        await updateRole(selectedRole.id, { isActive: true });
        setNotice('Department activated.');
      } else {
        const response = await deactivateRole(selectedRole.id);
        setNotice(response.data.message || 'Department deactivated.');
      }
      await load();
    } catch (err) {
      setError(requestErrorMessage(err, 'Unable to update department status.'));
    } finally {
      setSaving(false);
    }
  };

  const saveRole = async () => {
    try {
      setSaving(true);
      setError('');
      if (editingRole) await updateRole(editingRole.id, { name: roleName });
      else await createRole({ name: roleName });
      setNotice(editingRole ? 'Department updated successfully' : 'Department created successfully');
      setEditingRole(null);
      setRoleDialogOpen(false);
      setRoleName('');
      await load();
    } catch (err) {
      setError(requestErrorMessage(err, 'Unable to save role.'));
    } finally {
      setSaving(false);
    }
  };

  const loadUserPermissions = async (userId) => {
    setSelectedUserId(userId);
    setUserPermissionRows([]);
    if (!userId) return;
    try {
      setUserLoading(true);
      setError('');
      const response = await getUserPermissions(userId);
      const rows = response.data.data.permissions || [];
      setUserPermissionRows(rows);
      setExpanded(new Set(buildGroups(rows).map((group) => group.name)));
    } catch (err) {
      setError(requestErrorMessage(err, 'Unable to load user permissions.'));
    } finally {
      setUserLoading(false);
    }
  };

  const setOverride = (code, override) => {
    setUserPermissionRows((rows) => rows.map((row) => row.code === code
      ? { ...row, override, final: override === 'allow' || (override === 'inherit' && row.inherited) }
      : row));
  };

  const saveUserOverrides = async () => {
    if (!selectedUserId) return;
    try {
      setSaving(true);
      setError('');
      await setUserPermissions(selectedUserId, userPermissionRows.map((row) => ({
        permissionId: row.id,
        effect: row.override || 'inherit'
      })));
      setNotice('Permissions saved successfully');
      await loadUserPermissions(selectedUserId);
    } catch (err) {
      setError(requestErrorMessage(err, 'Unable to save user permission overrides.'));
    } finally {
      setSaving(false);
    }
  };

  const toggleExpanded = (group) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(group)) next.delete(group);
      else next.add(group);
      return next;
    });
  };

  const userCounts = userPermissionRows.reduce((counts, permission) => {
    counts[permission.override || 'inherit'] += 1;
    if (permission.final) counts.finalAllowed += 1;
    return counts;
  }, { allow: 0, deny: 0, inherit: 0, finalAllowed: 0 });

  return (
    <Stack spacing={2}>
      {notice && <Alert severity="success" onClose={() => setNotice('')}>{notice}</Alert>}
      {error && <Alert severity="error" onClose={() => setError('')}>{error}</Alert>}

      <Box>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} alignItems={{ md: 'center' }}>
          <Box sx={{ flex: 1 }}>
            <Typography variant="h5" fontWeight={850}>Departments & Permissions</Typography>
            <Typography color="text.secondary">Use departments (roles) to manage team access and user-level exceptions.</Typography>
          </Box>
          <Button variant="outlined" startIcon={<AddIcon />} onClick={() => {
            setEditingRole(null);
            setRoleName('');
            setRoleDialogOpen(true);
          }}>Create Department</Button>
          <FormControlLabel
            control={<Switch checked={showInactive} onChange={(event) => setShowInactive(event.target.checked)} />}
            label="Show inactive departments"
          />
        </Stack>
        <Tabs value={activeView} onChange={(_, value) => {
          setActiveView(value);
          setSearch('');
          setModuleFilter('');
          setExpanded(value === 'roles' ? new Set() : new Set(userGroups.map((group) => group.name)));
        }} sx={{ mt: 1 }}>
          <Tab value="roles" label="Department Permissions" />
          <Tab value="users" label="User Overrides" />
        </Tabs>
      </Box>

      {loading && <LinearProgress />}

      {activeView === 'roles' && (
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: '220px minmax(0, 1fr)', xl: '220px minmax(0, 1fr) 220px' }, gap: 2, alignItems: 'start' }}>
          <Paper variant="outlined" sx={{ overflow: 'hidden' }}>
            <Box sx={{ px: 2, py: 1.5 }}>
              <Typography fontWeight={800}>Departments</Typography>
              <Typography variant="caption" color="text.secondary">{roles.length} shown</Typography>
            </Box>
            <Divider />
            <Stack sx={{ p: 1 }}>
              {roles.map((role) => (
                <Button
                  key={role.id}
                  onClick={() => setSelectedRoleId(String(role.id))}
                  variant={String(role.id) === String(selectedRoleId) ? 'contained' : 'text'}
                  color={String(role.id) === String(selectedRoleId) ? 'primary' : 'inherit'}
                  sx={{ justifyContent: 'space-between', px: 1.25 }}
                  endIcon={<Chip size="small" label={(role.permissions || []).length} />}
                >
                  <Stack direction="row" alignItems="center" spacing={0.5}>
                    <span>{roleLabel(role.name)}</span>
                    {role.isActive === false && <Chip size="small" label="Inactive" />}
                  </Stack>
                </Button>
              ))}
            </Stack>
            {selectedRole && (
              <>
                <Divider />
                <Button fullWidth startIcon={<EditOutlinedIcon />} onClick={() => {
                  setEditingRole(selectedRole);
                  setRoleName(selectedRole.name);
                  setRoleDialogOpen(true);
                }} sx={{ borderRadius: 0 }}>Edit Department</Button>
                <Button
                  fullWidth
                  color={selectedRole.isActive === false ? 'success' : 'error'}
                  startIcon={<DeleteOutlineIcon />}
                  onClick={toggleRoleActive}
                  disabled={saving || String(selectedRole.name).toLowerCase() === 'admin'}
                  sx={{ borderRadius: 0 }}
                >
                  {selectedRole.isActive === false ? 'Activate Department' : 'Deactivate Department'}
                </Button>
              </>
            )}
          </Paper>

          <Stack spacing={2} sx={{ minWidth: 0 }}>
            <Paper variant="outlined" sx={{ p: 2 }}>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems={{ sm: 'center' }}>
                <Box sx={{ flex: 1 }}>
                  <Typography fontWeight={800}>Chat Access Scope</Typography>
                  <Typography variant="body2" color="text.secondary">
                    Controls which inbox conversations users in this department can see.
                  </Typography>
                </Box>
                <FormControl size="small" sx={{ minWidth: 220 }}>
                  <InputLabel>Chat visibility</InputLabel>
                  <Select
                    label="Chat visibility"
                    value={roleChatScope}
                    onChange={(event) => {
                      setRoleChatScope(event.target.value);
                      setRoleDirty(true);
                    }}
                    disabled={!selectedRole}
                  >
                    <MenuItem value="all">All chats</MenuItem>
                    <MenuItem value="assigned_only">Assigned chats only</MenuItem>
                    <MenuItem value="role_only">Department chats only</MenuItem>
                    <MenuItem value="role_and_assigned">Department and directly assigned chats</MenuItem>
                  </Select>
                </FormControl>
                <FormControlLabel
                  control={<Switch checked={roleDepartmentNotifications} onChange={(event) => {
                    setRoleDepartmentNotifications(event.target.checked);
                    setRoleDirty(true);
                  }} />}
                  label="Notify active department users"
                />
              </Stack>
            </Paper>

            <Paper variant="outlined" sx={{ p: 2 }}>
              <Typography fontWeight={800}>Department Templates</Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
                Apply a starting point to {selectedRole ? roleLabel(selectedRole.name) : 'the selected department'}.
              </Typography>
              <Stack direction="row" gap={1} flexWrap="wrap">
                {TEMPLATES.map((template) => (
                  <Tooltip key={template.key} title={template.description}>
                    <Button size="small" variant="outlined" onClick={() => applyTemplate(template.key)} disabled={!selectedRole}>
                      {template.label}
                    </Button>
                  </Tooltip>
                ))}
              </Stack>
            </Paper>

            <Paper variant="outlined" sx={{ overflow: 'hidden' }}>
              <Stack direction={{ xs: 'column', md: 'row' }} gap={1.25} sx={{ p: 1.5 }} alignItems={{ md: 'center' }}>
                <TextField
                  size="small"
                  placeholder="Search permissions"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> }}
                  sx={{ flex: 1, minWidth: 180 }}
                />
                <Button size="small" onClick={() => { setRoleDraft(new Set(permissions.map((permission) => permission.id))); setRoleDirty(true); }}>Grant Full Access</Button>
                <Button size="small" onClick={() => { setRoleDraft(new Set(templatePermissionIds('viewer', permissions))); setRoleDirty(true); }}>View Only</Button>
                <Button size="small" color="error" onClick={() => { setRoleDraft(new Set()); setRoleDirty(true); }}>Clear All</Button>
              </Stack>
              <Divider />
              <TableContainer sx={{ maxHeight: 'calc(100vh - 250px)' }}>
                <Table stickyHeader size="small" sx={{ minWidth: 920 }}>
                  <TableHead>
                    <TableRow>
                      <TableCell sx={{ minWidth: 190 }}>Module</TableCell>
                      {ACTIONS.map((action) => <TableCell key={action} align="center">{ACTION_LABELS[action]}</TableCell>)}
                      <TableCell sx={{ minWidth: 145 }}>Quick Access</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {visibleGroups.map((group) => (
                      <React.Fragment key={group.name}>
                        <TableRow hover>
                          <TableCell>
                            <Stack direction="row" alignItems="center" spacing={0.5}>
                              <IconButton size="small" onClick={() => toggleExpanded(group.name)}>
                                {expanded.has(group.name) ? <ExpandLessIcon /> : <ExpandMoreIcon />}
                              </IconButton>
                              <Box>
                                <Typography variant="body2" fontWeight={800}>{MODULE_LABELS[group.name] || group.name}</Typography>
                                <Typography variant="caption" color="text.secondary">{group.permissions.length} permissions</Typography>
                              </Box>
                            </Stack>
                          </TableCell>
                          {ACTIONS.map((action) => (
                            <TableCell key={action} align="center">
                              <PermissionCheckbox
                                permissions={group.permissions.filter((permission) => permission.action === action)}
                                selected={roleDraft}
                                onChange={updateRolePermissions}
                              />
                            </TableCell>
                          ))}
                          <TableCell>
                            <Select
                              size="small"
                              fullWidth
                              value={moduleAccessLabel(group, roleDraft)}
                              onChange={(event) => {
                                if (event.target.value === 'Full Access') applyModulePreset(group, 'full');
                                if (event.target.value === 'View Only') applyModulePreset(group, 'view');
                                if (event.target.value === 'No Access') applyModulePreset(group, 'none');
                              }}
                            >
                              <MenuItem value="Full Access">Full Access</MenuItem>
                              <MenuItem value="View Only">View Only</MenuItem>
                              <MenuItem value="No Access">No Access</MenuItem>
                              <MenuItem value="Custom" disabled>Custom</MenuItem>
                            </Select>
                          </TableCell>
                        </TableRow>
                        {expanded.has(group.name) && (
                          <TableRow>
                            <TableCell colSpan={9} sx={{ bgcolor: '#f8fafb', py: 1 }}>
                              <Stack direction="row" gap={0.75} flexWrap="wrap" sx={{ pl: 5 }}>
                                {group.permissions.map((permission) => (
                                  <Chip
                                    key={permission.id}
                                    size="small"
                                    variant={roleDraft.has(permission.id) ? 'filled' : 'outlined'}
                                    color={roleDraft.has(permission.id) ? 'success' : 'default'}
                                    label={permission.name}
                                  />
                                ))}
                              </Stack>
                            </TableCell>
                          </TableRow>
                        )}
                      </React.Fragment>
                    ))}
                    {!loading && visibleGroups.length === 0 && (
                      <TableRow><TableCell colSpan={9} align="center" sx={{ py: 5 }}>No matching permissions.</TableCell></TableRow>
                    )}
                  </TableBody>
                </Table>
              </TableContainer>
              <Stack
                direction="row"
                justifyContent="space-between"
                alignItems="center"
                sx={{ position: 'sticky', bottom: 0, zIndex: 3, px: 2, py: 1.25, bgcolor: '#fff', borderTop: '1px solid #e5e9ed' }}
              >
                <Typography variant="body2" color="text.secondary">{roleDraft.size} of {permissions.length} granted</Typography>
                <Button variant="contained" onClick={saveRolePermissions} disabled={!selectedRole || !roleDirty || saving}>
                  {saving ? 'Saving...' : 'Save Changes'}
                </Button>
              </Stack>
            </Paper>
          </Stack>

          <Paper variant="outlined" sx={{ p: 2, display: { xs: 'none', xl: 'block' } }}>
            <SummaryPanel selectedRole={selectedRole} selected={roleDraft} permissions={permissions} dirty={roleDirty} />
          </Paper>
        </Box>
      )}

      {activeView === 'users' && (
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', xl: 'minmax(0, 1fr) 230px' }, gap: 2, alignItems: 'start' }}>
          <Paper variant="outlined" sx={{ overflow: 'hidden', minWidth: 0 }}>
            <Stack direction={{ xs: 'column', md: 'row' }} gap={1.5} sx={{ p: 2 }}>
              <TextField
                select
                size="small"
                label="Select User"
                value={selectedUserId}
                onChange={(event) => loadUserPermissions(event.target.value)}
                sx={{ minWidth: { md: 320 } }}
              >
                <MenuItem value="">Select a user</MenuItem>
                {users.map((user) => (
                  <MenuItem key={user.id} value={user.id}>
                    {[user.firstName, user.lastName].filter(Boolean).join(' ') || user.email} - {user.email}
                  </MenuItem>
                ))}
              </TextField>
              <TextField
                size="small"
                placeholder="Search permissions"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                disabled={!selectedUserId}
                InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> }}
                sx={{ flex: 1 }}
              />
              <FormControl size="small" sx={{ minWidth: 180 }} disabled={!selectedUserId}>
                <InputLabel>Module</InputLabel>
                <Select label="Module" value={moduleFilter} onChange={(event) => setModuleFilter(event.target.value)}>
                  <MenuItem value="">All modules</MenuItem>
                  {userGroups.map((group) => <MenuItem key={group.name} value={group.name}>{MODULE_LABELS[group.name] || group.name}</MenuItem>)}
                </Select>
              </FormControl>
            </Stack>
            <Divider />
            {userLoading && <LinearProgress />}
            {!selectedUserId && (
              <Box sx={{ py: 8, px: 2, textAlign: 'center' }}>
                <Typography fontWeight={800}>Select a user to manage overrides</Typography>
                <Typography color="text.secondary">Role permissions remain inherited until explicitly allowed or denied.</Typography>
              </Box>
            )}
            {selectedUserId && !userLoading && (
              <>
                <TableContainer sx={{ maxHeight: 'calc(100vh - 260px)' }}>
                  <Table stickyHeader size="small" sx={{ minWidth: 760 }}>
                    <TableHead>
                      <TableRow>
                        <TableCell sx={{ width: 220 }}>Module / Permission</TableCell>
                        <TableCell>Action</TableCell>
                        <TableCell align="center">Inherited</TableCell>
                        <TableCell align="center">Final Result</TableCell>
                        <TableCell sx={{ width: 170 }}>Override</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {visibleGroups.map((group) => (
                        <React.Fragment key={group.name}>
                          <TableRow sx={{ bgcolor: '#f8fafb' }}>
                            <TableCell colSpan={5}>
                              <Stack direction="row" alignItems="center" spacing={1}>
                                <IconButton size="small" onClick={() => toggleExpanded(group.name)}>
                                  {expanded.has(group.name) ? <ExpandLessIcon /> : <ExpandMoreIcon />}
                                </IconButton>
                                <Typography fontWeight={850}>{MODULE_LABELS[group.name] || group.name}</Typography>
                                <Chip size="small" label={`${group.permissions.filter((permission) => permission.final).length}/${group.permissions.length} allowed`} />
                              </Stack>
                            </TableCell>
                          </TableRow>
                          {(expanded.has(group.name) || Boolean(search) || Boolean(moduleFilter)) && group.permissions.map((permission) => (
                            <TableRow key={permission.code} hover>
                              <TableCell sx={{ pl: 6 }}>{permission.name}</TableCell>
                              <TableCell>{ACTION_LABELS[permission.action] || roleLabel(permission.rawAction)}</TableCell>
                              <TableCell align="center">
                                <Chip size="small" variant="outlined" color={permission.inherited ? 'success' : 'default'} label={permission.inherited ? 'Allowed' : 'Not granted'} />
                              </TableCell>
                              <TableCell align="center">
                                <Chip size="small" color={permission.final ? 'success' : 'error'} label={permission.final ? 'Allowed' : 'Denied'} />
                              </TableCell>
                              <TableCell>
                                <Select size="small" fullWidth value={permission.override || 'inherit'} onChange={(event) => setOverride(permission.code, event.target.value)}>
                                  <MenuItem value="inherit">Inherit</MenuItem>
                                  <MenuItem value="allow">Allow</MenuItem>
                                  <MenuItem value="deny">Deny</MenuItem>
                                </Select>
                              </TableCell>
                            </TableRow>
                          ))}
                        </React.Fragment>
                      ))}
                      {visibleGroups.length === 0 && (
                        <TableRow><TableCell colSpan={5} align="center" sx={{ py: 5 }}>No matching permissions.</TableCell></TableRow>
                      )}
                    </TableBody>
                  </Table>
                </TableContainer>
                <Stack
                  direction="row"
                  justifyContent="space-between"
                  alignItems="center"
                  sx={{ position: 'sticky', bottom: 0, zIndex: 3, px: 2, py: 1.25, bgcolor: '#fff', borderTop: '1px solid #e5e9ed' }}
                >
                  <Typography variant="body2" color="text.secondary">{userCounts.allow + userCounts.deny} explicit overrides</Typography>
                  <Button variant="contained" onClick={saveUserOverrides} disabled={saving}>
                    {saving ? 'Saving...' : 'Save Overrides'}
                  </Button>
                </Stack>
              </>
            )}
          </Paper>

          <Paper variant="outlined" sx={{ p: 2 }}>
            <Typography fontWeight={800}>Override Summary</Typography>
            <Stack spacing={1.25} sx={{ mt: 2 }}>
              <Stack direction="row" justifyContent="space-between"><Typography variant="body2">Allow</Typography><Chip size="small" color="success" label={userCounts.allow} /></Stack>
              <Stack direction="row" justifyContent="space-between"><Typography variant="body2">Deny</Typography><Chip size="small" color="error" label={userCounts.deny} /></Stack>
              <Stack direction="row" justifyContent="space-between"><Typography variant="body2">Inherit</Typography><Chip size="small" label={userCounts.inherit} /></Stack>
              <Divider />
              <Stack direction="row" justifyContent="space-between"><Typography variant="body2" fontWeight={800}>Final allowed</Typography><Typography fontWeight={850}>{userCounts.finalAllowed}</Typography></Stack>
            </Stack>
          </Paper>
        </Box>
      )}

      <Dialog open={roleDialogOpen} onClose={() => {
        setEditingRole(null);
        setRoleName('');
        setRoleDialogOpen(false);
      }} maxWidth="xs" fullWidth>
        <DialogTitle>{editingRole ? 'Edit Department' : 'Create Department'}</DialogTitle>
        <DialogContent>
          {error && <Alert severity="error" sx={{ mt: 1 }}>{error}</Alert>}
          <TextField sx={{ mt: 2 }} label="Department Name" value={roleName} onChange={(event) => setRoleName(event.target.value)} fullWidth />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => { setEditingRole(null); setRoleName(''); setRoleDialogOpen(false); }}>Cancel</Button>
          <Button variant="contained" onClick={saveRole} disabled={!roleName.trim() || saving}>
            {saving ? <CircularProgress size={20} /> : 'Save'}
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}

export default PermissionManagementPage;
