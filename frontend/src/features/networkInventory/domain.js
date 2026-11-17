export const inventoryKinds = ['sites', 'devices', 'ladders', 'memberships', 'backhauls', 'segments', 'olts']
export const auditScopes = ['ladder', 'olt', 'nld', 'rise']
export const text = value => String(value ?? '').trim()
export const missing = value => !text(value) || /^(?:#?n\/?a|tbc|none|null|-)$/i.test(text(value))
export const nameKey = value => text(value).toLowerCase().replace(/[^a-z0-9]/g, '')
export const hostKey = value => text(value).toLowerCase().replace(/\.frogfoot\.net$/i, '')
export const ladderKey = value => missing(value) ? '' : text(value).toLowerCase().replace(/[\s_-]+/g, '')
export function ladderName(value) {
  const m = text(value).match(/^([a-z]+)[\s_-]*ladder[\s_-]*(\d+(?:\.\d+)?(?:\/\d+)?)$/i)
  return m ? `${m[1].toUpperCase()} Ladder ${m[2]}` : text(value)
}
export const recordId = (kind, key) => `${kind}:${key}`
export const values = (snapshot, kind) => (snapshot.records?.[kind] || []).filter(r => !r.data.archived)
export const byId = snapshot => new Map(inventoryKinds.flatMap(k => values(snapshot, k)).map(r => [r.id, r]))
export function capacityMbps(value) {
  const m = text(value).match(/^(\d+(?:\.\d+)?)\s*([MGT])(?:BPS|B\/S)?$/i)
  return m ? Number(m[1]) * ({ M: 1, G: 1000, T: 1000000 }[m[2].toUpperCase()]) : null
}
export function membershipLadders(snapshot, siteId) {
  const siteHosts = new Set(values(snapshot, 'devices').filter(d => d.data.siteId === siteId).map(d => hostKey(d.data.hostname)))
  return [...new Set(values(snapshot, 'memberships').filter(r => r.data.ladderId && (r.data.siteId === siteId
    || siteHosts.has(hostKey(r.data.corePri)) || siteHosts.has(hostKey(r.data.coreSec)))).map(r => r.data.ladderId))]
}
function aliases(snapshot) {
  const map = new Map()
  for (const site of values(snapshot, 'sites')) for (const label of [site.data.name, site.data.irisName, ...(site.data.aliases || [])]) {
    if (missing(label)) continue
    const key = nameKey(label), list = map.get(key) || new Set(); list.add(site.id); map.set(key, list)
  }
  return map
}
// Only exact hostname or unique site alias/attachment evidence can resolve an endpoint.
export function resolveEndpoint(snapshot, raw, preferredDeviceIds = []) {
  if (missing(raw)) return { id: null, label: 'Missing endpoint', unresolved: true, reason: 'missing-endpoint' }
  const devices = values(snapshot, 'devices'), host = hostKey(raw)
  const exact = devices.filter(r => hostKey(r.data.hostname) === host)
  if (exact.length === 1) return { id: exact[0].id, label: exact[0].data.hostname, record: exact[0] }
  const sites = aliases(snapshot).get(nameKey(raw))
  if (sites?.size === 1) {
    const siteId = [...sites][0]
    const candidates = devices.filter(d => d.data.siteId === siteId && !['olt', 'adva'].includes(d.data.type))
    const preferred = candidates.filter(d => preferredDeviceIds.includes(d.id))
    const selected = preferred.length === 1 ? preferred[0] : candidates.length === 1 ? candidates[0] : null
    if (selected) return { id: selected.id, label: selected.data.hostname, record: selected, source: 'unique-site-device-alias' }
    return { id: `gap:site:${siteId}`, label: raw, siteId, unresolved: true, reason: 'site-has-multiple-or-no-forwarding-devices', candidates: candidates.map(d => d.id) }
  }
  return { id: `gap:${nameKey(raw)}`, label: raw, unresolved: true, reason: sites?.size > 1 ? 'ambiguous-site-alias' : 'endpoint-not-in-inventory' }
}
export function buildTopology(snapshot, ladderId, { oltId } = {}) {
  const records = byId(snapshot), ladder = records.get(ladderId)
  const members = ladderId ? values(snapshot, 'memberships').filter(r => r.data.ladderId === ladderId) : []
  const selected = ladderId ? values(snapshot, 'backhauls').filter(b => b.data.ladderIds?.includes(ladderId) || members.some(m => [m.data.primaryCode, m.data.secondaryCode].includes(b.data.code))) : []
  const nodes = new Map(), edges = []
  function addNode(endpoint) {
    if (!endpoint.id) endpoint = { ...endpoint, id: `gap:missing:${nodes.size}` }
    const existing = nodes.get(endpoint.id)
    const site = records.get(endpoint.record?.data.siteId || endpoint.siteId)
    nodes.set(endpoint.id, { ...existing, ...endpoint, siteName: site?.data.name || existing?.siteName,
      roles: existing?.roles || [], membershipIds: existing?.membershipIds || [] })
    return endpoint.id
  }
  for (const b of selected) {
    const a = resolveEndpoint(snapshot, b.data.deviceA), z = resolveEndpoint(snapshot, b.data.deviceB)
    const from = addNode(a), to = addNode(z)
    edges.push({ id: b.id, recordId: b.id, from, to, code: b.data.code, capacity: b.data.capacity,
      source: 'Backhauls DB', claim: false, unresolved: !!a.unresolved || !!z.unresolved,
      segments: values(snapshot, 'segments').filter(s => s.data.backhaulId === b.id).sort((x, y) => x.data.sequence - y.data.sequence) })
  }
  for (const m of members) {
    const d = m.data
    for (const direction of ['primary', 'secondary']) {
      const code = d[`${direction}Code`]
      if (missing(code)) continue
      const existing = edges.filter(e => nameKey(e.code) === nameKey(code))
      const preferred = existing.flatMap(e => [e.from, e.to])
      const a = resolveEndpoint(snapshot, d[`${direction}A`], preferred), z = resolveEndpoint(snapshot, d[`${direction}B`], preferred)
      const from = addNode(a), to = addNode(z)
      const equivalent = existing.find(e => [e.from, e.to].includes(from) && [e.from, e.to].includes(to) && from !== to)
      const edge = equivalent || { id: `claim:${m.id}:${direction}`, from, to, code, claim: true, source: 'Ladder DB claim',
        unresolved: !!a.unresolved || !!z.unresolved, conflict: existing.length > 0, membershipId: m.id }
      if (!equivalent) edges.push(edge)
      edge.memberClaims ||= []; edge.memberClaims.push({ membershipId: m.id, direction })
      const ownerId = [from, to].find(id => nodes.get(id)?.record?.data.siteId === d.siteId)
      if (ownerId) {
        const node = nodes.get(ownerId)
        if (!node.roles.includes(d.role)) node.roles.push(d.role)
        if (!node.membershipIds.includes(m.id)) node.membershipIds.push(m.id)
      }
      if (ladder?.data.transport !== 'VPLS' && d.ringBlock === true && direction === 'secondary' && ['Master', 'RPL Owner'].includes(d.role) && ['EAPS', 'ERPS'].includes(d.protection)) {
        edge.blocked = true; edge.blockOwner = ownerId || null; edge.blockMembershipId = m.id
      }
    }
    for (const [role, raw] of [['Core_Pri', d.corePri], ['Core_Sec', d.coreSec]]) if (!missing(raw)) {
      const id = addNode(resolveEndpoint(snapshot, raw)); const node = nodes.get(id)
      if (!node.roles.includes(role)) node.roles.push(role)
    }
  }
  if (oltId) {
    const olt = records.get(oltId)
    if (olt) {
      const source = values(snapshot, 'devices').find(d => d.data.hostname === olt.data.hostname)
      const from = addNode(source ? { id: source.id, label: source.data.hostname, record: source } : { id: olt.id, label: olt.data.hostname })
      const target = resolveEndpoint(snapshot, olt.data.accessDevice)
      const to = addNode(target)
      edges.push({ id: `olt-uplink:${olt.id}`, recordId: olt.id, from, to, code: olt.data.lagCode || 'OLT uplink', source: 'OLT attachment', unresolved: target.unresolved, oltUplink: true })
    }
  }
  const uniqueEdges = edges.filter(e => e.from !== e.to)
  const totalDegree = id => uniqueEdges.filter(e => e.from === id || e.to === id).length
  return { ladder, members, nodes: [...nodes.values()].map(n => ({ ...n, degree: totalDegree(n.id) })), edges: uniqueEdges }
}
function pathBetween(topology, start, end, { releaseBlocks = false, excluded = new Set(), followPrimary = false } = {}) {
  if (!start || !end) return null
  const queue = [{ nodes: [start], edges: [] }], visited = new Set([start])
  while (queue.length) {
    const path = queue.shift(), current = path.nodes.at(-1)
    if (current === end) return path
    let available = topology.edges.filter(e => !excluded.has(e.id) && !e.unresolved && !e.conflict && (!e.blocked || releaseBlocks) && [e.from, e.to].includes(current))
    if (followPrimary) {
      const node = topology.nodes.find(n => n.id === current)
      const codes = [...new Set(topology.members.filter(m => node?.membershipIds.includes(m.id)).map(m => nameKey(m.data.primaryCode)).filter(Boolean))]
      if (codes.length === 1) {
        const declared = available.filter(e => nameKey(e.code) === codes[0] && !visited.has(e.from === current ? e.to : e.from))
        if (declared.length === 1) available = declared
        else if (declared.length > 1) available = []
      }
    }
    for (const e of available) {
      if (excluded.has(e.id) || e.unresolved || e.conflict || e.blocked && !releaseBlocks || ![e.from, e.to].includes(current)) continue
      const next = e.from === current ? e.to : e.from
      if (visited.has(next)) continue
      visited.add(next); queue.push({ nodes: [...path.nodes, next], edges: [...path.edges, e.id] })
    }
  }
  return null
}
export function intendedPaths(topology, membershipId) {
  const m = topology.members.find(m => m.id === membershipId)
  if (!m) return { status: 'select-source', primary: null, backup: null }
  if (topology.ladder?.data.transport === 'VPLS') return { status: 'vpls-protection-workflow-pending', primary: null, backup: null, corePri: m.data.corePri, coreSec: m.data.coreSec }
  const source = topology.nodes.filter(n => n.membershipIds.includes(m.id))
  if (source.length !== 1) return { status: 'source-device-unresolved', primary: null, backup: null }
  const core = raw => topology.nodes.find(n => hostKey(n.label) === hostKey(raw))?.id
  const sourceId = source[0].id, pri = core(m.data.corePri), sec = core(m.data.coreSec)
  // Follow the selected node's explicitly declared primary link first; do not substitute
  // an arbitrary shortest path that happens to lead to Core_Pri.
  const first = topology.edges.filter(e => nameKey(e.code) === nameKey(m.data.primaryCode) && [e.from, e.to].includes(sourceId) && !e.blocked && !e.unresolved && !e.conflict)
  let primary = sourceId === pri ? { nodes: [sourceId], edges: [] } : null
  if (first.length === 1 && !primary) {
    const e = first[0], next = e.from === sourceId ? e.to : e.from
    const tail = pathBetween(topology, next, pri, { excluded: new Set(topology.edges.filter(x => [x.from, x.to].includes(sourceId)).map(x => x.id)), followPrimary: true })
    if (tail) primary = { nodes: [sourceId, ...tail.nodes], edges: [e.id, ...tail.edges] }
  }
  const backup = pathBetween(topology, sourceId, sec, { releaseBlocks: true, excluded: new Set(first.map(e => e.id)) })
  const warnings = []
  if ([primary, backup].filter(Boolean).some(p => p.edges.some(id => topology.edges.find(e => e.id === id)?.claim))) warnings.push('This route includes ladder-only link claims without matching backhaul records.')
  const ringMembers = topology.members.filter(r => r.data.ringName === m.data.ringName && r.data.ringVlan === m.data.ringVlan)
  if (ringMembers.some(r => r.data.ringBlock && !['Master', 'RPL Owner'].includes(r.data.role))) warnings.push('This ring marks secondary blocks on non-owner roles; the protection state needs review.')
  if (['EAPS', 'ERPS'].includes(m.data.protection) && !ringMembers.some(r => r.data.ringBlock === true && ['Master', 'RPL Owner'].includes(r.data.role))) warnings.push('The ring has no explicit Master/RPL Owner secondary-block record; paths are provisional.')
  return { status: !primary ? 'primary-path-unresolved' : warnings.length ? 'provisional-inventory-path' : 'configured-path-derived', warnings,
    primary, backup, sourceId, corePri: m.data.corePri, coreSec: m.data.coreSec,
    backupAssumption: 'Primary outgoing link unavailable; ring protection releases the secondary block. Intended scenario only, not measured traffic.' }
}
export function moduleLadders(snapshot, scope) {
  return values(snapshot, 'ladders').filter(l => scope === 'ladder' || l.data.auditScopes?.includes(scope))
}
