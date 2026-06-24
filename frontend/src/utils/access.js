export function getAccessPayload() {
  const token = localStorage.getItem('accessToken');
  if (!token) return { isSystemAdmin: false, permissions: [], roles: [] };

  try {
    return JSON.parse(atob(token.split('.')[1]));
  } catch (error) {
    return { isSystemAdmin: false, permissions: [], roles: [] };
  }
}

export function hasPermission(permission) {
  const access = getAccessPayload();
  if (access.isSystemAdmin) return true;
  return Boolean(permission && access.permissions?.includes(permission));
}

export function hasAnyPermission(permissions = []) {
  const access = getAccessPayload();
  if (access.isSystemAdmin) return true;
  return permissions.some((permission) => access.permissions?.includes(permission));
}
