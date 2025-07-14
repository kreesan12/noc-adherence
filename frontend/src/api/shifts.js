// Re-usable helper
async function request (url, method, body) {
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined
  });
  if (!res.ok) throw new Error(`${method} ${url} failed`);
  return res.json();
}

/* ────────────────────────────
 *  existing helpers
 * ────────────────────────────*/
export function updateShift (id, payload) {
  return request(`/api/shifts/${id}`, 'PATCH', payload);
}

export function swapShifts (shiftIdA, shiftIdB) {
  return request('/api/shifts/swap', 'POST', { shiftIdA, shiftIdB });
}

/* ────────────────────────────
 *  NEW helpers (range ops)
 * ────────────────────────────*/
export function swapRange ({ agentIdA, agentIdB, from, to }) {
  return request('/api/shifts/swap-range', 'POST', {
    agentIdA,
    agentIdB,
    from,      // 'YYYY-MM-DD'
    to
  });
}

export function reassignRange ({
  fromAgentId,
  toAgentId,
  from,
  to,
  markLeave = true
}) {
  return request('/api/shifts/reassign-range', 'POST', {
    fromAgentId,
    toAgentId,
    from,
    to,
    markLeave
  });
}
