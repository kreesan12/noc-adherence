export const flatVacancy = v => ({
  id      : v.id,
  team    : v.team?.name ?? '',
  open    : v.openFrom?.slice(0, 10) ?? '',
  status  : v.status
});

export const flatEngagement = e => ({
  id   : e.id,
  agent: e.agent.fullName,
  team : e.team.name,
  start: e.startDate ? e.startDate.slice(0,10) : '',
  end  : e.endDate   ? e.endDate.slice(0,10)   : '—',
  note : e.note ?? ''
});
