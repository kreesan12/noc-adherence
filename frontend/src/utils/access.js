export function normalizeRole(roleRaw) {
  return String(roleRaw || '').trim().toLowerCase()
}

export function isAdmin(roleRaw) {
  return normalizeRole(roleRaw) === 'admin'
}

export function canAccessEngineering(roleRaw) {
  return ['engineering', 'admin', 'manager'].includes(normalizeRole(roleRaw))
}

export function canManageUsers(roleRaw) {
  return isAdmin(roleRaw)
}
