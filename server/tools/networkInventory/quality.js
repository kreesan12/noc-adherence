import { createHash } from 'node:crypto'
import { values, byId, missing, nameKey, ladderKey, buildTopology, membershipLadders, capacityMbps } from '../../../frontend/src/features/networkInventory/domain.js'

const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')
export function inventoryFindings(snapshot) {
  const findings = [], records = byId(snapshot), ladders = values(snapshot, 'ladders'), members = values(snapshot, 'memberships')
  const add = (code, severity, subject, message, details = {}, ladderIds = []) => {
    const identity = `${code}:${subject.id}:${details.direction || details.code || details.field || ''}`
    const evidenceHash = hash({ code, details, data: subject.data })
    findings.push({ id: hash(identity).slice(0, 24), code, severity, kind: subject.kind, recordId: subject.id,
      label: subject.data.name || subject.data.hostname || subject.data.node || subject.data.code || subject.data.circuitId || subject.id,
      message, details, ladderIds: [...new Set(ladderIds.filter(Boolean))], sourceRefs: subject.sourceRefs, evidenceHash })
  }
  const associated = siteId => membershipLadders(snapshot, siteId)
  for (const kind of ['devices', 'memberships', 'segments', 'olts']) for (const r of values(snapshot, kind)) {
    const refs = kind === 'segments' ? [r.data.backhaulId] : kind === 'memberships' ? [r.data.siteId, r.data.ladderId] : [r.data.siteId, ...(r.data.ladderIds || [])]
    for (const id of refs.filter(Boolean)) if (!records.has(id)) add('REFERENCE_MISSING', 'error', r, 'A linked inventory record is missing or archived.', { field: id }, r.data.ladderIds || [r.data.ladderId])
  }
  for (const site of values(snapshot, 'sites')) {
    const ids = associated(site.id)
    if (!ids.length) add('NODE_NOT_ASSIGNED', 'review', site, 'Site has no ladder assignment.', {}, [])
    if (ids.length > 1) add('SHARED_LADDER_NODE', 'info', site, 'Site is assigned to more than one ladder; shared membership is allowed.', { ladders: ids.map(id => records.get(id)?.data.name) }, ids)
  }
  for (const device of values(snapshot, 'devices')) {
    if (device.data.siteClaims?.length > 1) add('DEVICE_LOCATION_CONFLICT', 'error', device, 'The same device is listed at multiple sites.', { sites: device.data.siteClaims }, device.data.siteClaims.flatMap(associated))
    if (device.data.sourceOnly) add('DEVICE_MISSING_FROM_NODE_DB', 'review', device, 'Device is referenced by a link or OLT but absent from the Node/DC equipment inventory.', {}, associated(device.data.siteId))
  }
  const links = values(snapshot, 'backhauls'), byCode = new Map()
  for (const b of links) {
    const key = nameKey(b.data.code), list = byCode.get(key) || []; list.push(b); byCode.set(key, list)
    if (!key) add('BACKHAUL_CODE_MISSING', 'error', b, 'Backhaul has no circuit code.', {}, b.data.ladderIds)
    if (!b.data.deviceA || !b.data.deviceB) add('BACKHAUL_ENDPOINT_MISSING', 'error', b, 'Backhaul is missing an endpoint device.', { a: b.data.deviceA, b: b.data.deviceB }, b.data.ladderIds)
    const speed = capacityMbps(b.data.capacity)
    if (speed === null) add('CAPACITY_MISSING', 'review', b, 'Backhaul capacity is missing or cannot be interpreted.', { capacity: b.data.capacity }, b.data.ladderIds)
    else if (speed < 1000) add('CAPACITY_REVIEW', 'review', b, 'Sub-gigabit backhaul capacity: confirm the units/value; it has not been corrected automatically.', { capacity: b.data.capacity, mbps: speed }, b.data.ladderIds)
    const segments = values(snapshot, 'segments').filter(s => s.data.backhaulId === b.id).sort((a, z) => a.data.sequence - z.data.sequence)
    if (!segments.length) add('CIRCUIT_CHAIN_MISSING', 'review', b, 'No physical circuit segment is recorded for this backhaul.', {}, b.data.ladderIds)
    for (let i = 0; i < segments.length; i++) {
      const s = segments[i]
      if (!s.data.circuitId || !s.data.provider || !s.data.sideA || !s.data.sideB) add('CIRCUIT_SEGMENT_INCOMPLETE', 'review', s, 'Physical circuit segment is missing an ID, provider or endpoint.', { backhaul: b.data.code, sequence: s.data.sequence }, b.data.ladderIds)
      if (i && nameKey(segments[i - 1].data.sideB) !== nameKey(s.data.sideA)) add('CIRCUIT_CHAIN_GAP', 'review', s, 'Consecutive circuit endpoints do not line up in the recorded order.', { previousEnd: segments[i - 1].data.sideB, nextStart: s.data.sideA, backhaul: b.data.code }, b.data.ladderIds)
    }
  }
  for (const [code, rows] of byCode) if (code && rows.length > 1) for (const b of rows)
    add('DUPLICATE_BACKHAUL_CODE', 'error', b, 'Multiple backhaul records use this circuit code; endpoint/capacity claims need reconciliation.', { code: b.data.code, records: rows.map(r => r.id) }, rows.flatMap(r => r.data.ladderIds || []))
  for (const m of members) {
    const d = m.data, lid = d.ladderId ? [d.ladderId] : []
    if (!d.ladderId) add('LADDER_UNASSIGNED', 'review', m, 'Membership has no identified ladder (blank/TBC).', {}, [])
    if (!d.siteId) add('MEMBERSHIP_SITE_UNKNOWN', 'review', m, 'Ladder node does not match one unique Node/DC site alias.', { node: d.node }, lid)
    if (d.origin === 'Node DB claim') add('LADDER_CONFIGURATION_MISSING', 'review', m, 'Node DB assigns this site to the ladder but Ladder DB has no corresponding configuration row. This may be a missing/shared membership.', {}, lid)
    const vpls = records.get(d.ladderId)?.data.transport === 'VPLS'
    if (vpls) { add('VPLS_WORKFLOW_PENDING', 'info', m, 'Legacy VPLS inventory retained. Protection modelling is deferred.', {}, lid); continue }
    if (!['EAPS', 'ERPS'].includes(d.protection)) add('PROTECTION_UNSPECIFIED', 'review', m, 'EAPS/ERPS protection has not been specified.', { protection: d.protection }, lid)
    if (['EAPS', 'ERPS'].includes(d.protection) && (!Number.isInteger(d.ringVlan) || d.ringVlan < 1 || d.ringVlan > 4094)) add('CONTROL_VLAN_MISSING', 'review', m, 'Control VLAN is missing or invalid.', { vlan: d.ringVlan }, lid)
    if (!['Master', 'Transit', 'Stub', 'RPL Owner', 'Core'].includes(d.role)) add('RING_ROLE_MISSING', 'review', m, 'Ring role is missing or not recognised.', { role: d.role }, lid)
    if (d.protection === 'EAPS' && d.role === 'RPL Owner' || d.protection === 'ERPS' && d.role === 'Master')
      add('RING_ROLE_PROTOCOL_CONFLICT', 'error', m, 'Role does not match the recorded protection protocol.', { protection: d.protection, role: d.role }, lid)
    if (d.ringBlock && !['Master', 'RPL Owner'].includes(d.role)) add('BLOCK_OWNER_ROLE_REVIEW', 'review', m, 'A secondary block is marked on a non-owner role.', { role: d.role }, lid)
    if (['Master', 'RPL Owner'].includes(d.role) && d.ringBlock !== true) add('OWNER_BLOCK_UNSPECIFIED', 'review', m, 'Master/RPL Owner does not have an explicit secondary block; confirm the normal ring state.', { ringBlock: d.ringBlock }, lid)
    if (d.ringBlock && !d.secondaryCode) add('BLOCK_LINK_MISSING', 'error', m, 'Blocked secondary backhaul is not specified.', {}, lid)
    if (!d.corePri || !d.coreSec) add('CORE_ASSIGNMENT_MISSING', 'review', m, 'Primary or secondary core router is missing.', { primary: d.corePri, secondary: d.coreSec }, lid)
    for (const direction of ['primary', 'secondary']) {
      const code = d[`${direction}Code`]
      if (!code) { if (direction === 'primary' || !['Stub', 'Core'].includes(d.role)) add('BACKHAUL_ASSIGNMENT_MISSING', 'review', m, `${direction} backhaul is missing.`, { direction }, lid); continue }
      const rows = byCode.get(nameKey(code)) || []
      if (!rows.length) add('BACKHAUL_NOT_IN_DB', 'review', m, `${direction} backhaul ${code} is declared in Ladder DB but absent from Backhauls DB.`, { direction, code }, lid)
    }
    if (d.role === 'Stub' && d.primaryCode && d.secondaryCode && nameKey(d.primaryCode) !== nameKey(d.secondaryCode))
      add('STUB_HAS_TWO_BACKHAULS', 'review', m, 'Stub is configured with two different backhauls; confirm the role or attachments.', {}, lid)
  }
  for (const l of ladders) {
    const graph = buildTopology(snapshot, l.id)
    for (const n of graph.nodes.filter(n => n.unresolved)) add('TOPOLOGY_ENDPOINT_UNRESOLVED', 'review', l, 'Diagram contains an endpoint that cannot be matched safely.', { field: n.id, label: n.label, reason: n.reason }, [l.id])
    for (const e of graph.edges.filter(e => e.conflict)) add('BACKHAUL_ENDPOINT_CONFLICT', 'error', l, 'Ladder and Backhauls DB disagree on the device endpoints for a circuit code.', { code: e.code, from: e.from, to: e.to }, [l.id])
    const duplicate = new Map()
    for (const m of graph.members) { const key = m.data.siteId || nameKey(m.data.node); const list = duplicate.get(key) || []; list.push(m); duplicate.set(key, list) }
    for (const [node, rows] of duplicate) if (rows.length > 1) add('REPEATED_LADDER_MEMBERSHIP', 'review', l, 'Site has more than one membership row within this ladder; may represent distinct ring contexts.', { field: node, records: rows.map(m => m.id) }, [l.id])
  }
  const pairGroups = new Map()
  for (const b of links) {
    const key = [nameKey(b.data.deviceA), nameKey(b.data.deviceB)].sort().join('|')
    if (!key || key === '|') continue
    const rows = pairGroups.get(key) || []; rows.push(b); pairGroups.set(key, rows)
  }
  for (const group of pairGroups.values()) if (group.length > 1 && new Set(group.map(b => nameKey(b.data.code))).size > 1)
    for (const b of group) add('PARALLEL_BACKHAUL_RECORDS', 'review', b, 'Different circuit codes connect the same device pair. Confirm parallel links versus duplicate/misaligned records.', { codes: group.map(x => x.data.code) }, group.flatMap(x => x.data.ladderIds || []))
  for (const olt of values(snapshot, 'olts')) {
    const d = olt.data
    if (!d.accessDevice) add('OLT_ATTACHMENT_UNRESOLVED', 'error', olt, 'OLT has no single agreed access device.', { claims: d.attachmentClaims }, d.ladderIds)
    if (!d.siteId) add('OLT_SITE_MISSING', 'review', olt, 'OLT is not assigned to a unique site.', {}, d.ladderIds)
    if (!d.ladderIds?.length) add('OLT_LADDER_MISSING', 'review', olt, 'OLT has no ladder assignment.', {}, [])
    if (d.accessDevice && !values(snapshot, 'devices').some(r => r.data.hostname === d.accessDevice))
      add('OLT_ACCESS_DEVICE_UNKNOWN', 'review', olt, 'OLT attachment names a device missing from the equipment inventory.', { accessDevice: d.accessDevice }, d.ladderIds)
    if (d.siteId && d.ladderIds?.some(id => !associated(d.siteId).includes(id))) add('OLT_LADDER_CLAIM_DIFFERS', 'review', olt, 'OLT mapping names a ladder not present in this site’s recorded memberships; confirm whether the site is shared.', { mappingLadders: d.ladderIds, siteLadders: associated(d.siteId) }, d.ladderIds)
  }
  const saved = new Map((snapshot.issueReviews || []).map(r => [r.id, r]))
  return [...new Map(findings.map(f => [f.id, f])).values()].map(f => ({ ...f, review: saved.get(f.id)?.evidenceHash === f.evidenceHash ? saved.get(f.id) : null,
    status: saved.get(f.id)?.evidenceHash === f.evidenceHash ? 'acknowledged' : 'open' }))
}

export function reviewDependencies(snapshot, kind, id) {
  const r = byId(snapshot).get(id)
  if (!r) return null
  let related = [r]
  if (kind === 'ladders') {
    const graph = buildTopology(snapshot, id), ids = new Set([...graph.nodes.map(n => n.id), ...graph.edges.map(e => e.recordId), ...graph.members.map(m => m.id)])
    related.push(...['sites', 'devices', 'backhauls', 'segments', 'memberships', 'olts'].flatMap(k => values(snapshot, k))
      .filter(x => ids.has(x.id) || x.kind === 'sites' && (graph.members.some(m => m.data.siteId === x.id) || graph.nodes.some(n => n.record?.data.siteId === x.id))
        || x.kind === 'segments' && ids.has(x.data.backhaulId) || x.kind === 'olts' && x.data.ladderIds?.includes(id)))
  } else if (kind === 'olts') {
    const access = values(snapshot, 'devices').find(d => d.data.hostname === r.data.accessDevice)
    if (access) related.push(access)
    const site = values(snapshot, 'sites').find(s => s.id === r.data.siteId)
    if (site) related.push(site)
  } else if (kind === 'backhauls') related.push(...values(snapshot, 'segments').filter(s => s.data.backhaulId === id))
  return [...new Map(related.map(x => [x.id, x])).values()].sort((a, b) => a.id.localeCompare(b.id))
}
export function reviewFingerprint(snapshot, kind, id) {
  const related = reviewDependencies(snapshot, kind, id)
  return related ? hash({ rules: 'network-inventory-v1', records: related.map(x => ({ id: x.id, data: x.data, version: x.version })) }) : null
}
export function enrichInventorySnapshot(snapshot) {
  const issues = inventoryFindings(snapshot)
  const reviews = (snapshot.reviews || []).map(r => ({ ...r, current: r.fingerprint === reviewFingerprint(snapshot, r.kind, r.recordId) }))
  return { ...snapshot, issues, reviews, summary: {
    ladders: values(snapshot, 'ladders').length,
    upToDate: values(snapshot, 'ladders').filter(l => reviews.some(r => r.kind === 'ladders' && r.recordId === l.id && r.current)).length,
    sharedSites: values(snapshot, 'sites').filter(s => membershipLadders(snapshot, s.id).length > 1).length,
    unassignedSites: values(snapshot, 'sites').filter(s => !membershipLadders(snapshot, s.id).length).length,
    openIssues: issues.filter(i => i.status === 'open' && i.severity !== 'info').length,
    nodes: values(snapshot, 'sites').length, devices: values(snapshot, 'devices').length,
    backhauls: values(snapshot, 'backhauls').length, olts: values(snapshot, 'olts').length
  } }
}
