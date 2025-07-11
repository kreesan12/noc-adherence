// frontend/src/api/shifts.js
export async function updateShift(id, payload) {
  const res = await fetch(`/api/shifts/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!res.ok) throw new Error('Shift update failed');
  return res.json();
}

export async function swapShifts(shiftIdA, shiftIdB) {
  const res = await fetch('/api/shifts/swap', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ shiftIdA, shiftIdB })
  });
  if (!res.ok) throw new Error('Shift swap failed');
  return res.json();
}
