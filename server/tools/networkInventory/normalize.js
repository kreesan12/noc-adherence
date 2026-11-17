import XLSX from 'xlsx'
import { createHash } from 'node:crypto'
import { inventoryKinds, missing, text, nameKey, hostKey, ladderKey, ladderName, recordId, capacityMbps } from '../../../frontend/src/features/networkInventory/domain.js'

export function readInventoryWorkbook(bytes, filename = 'Network inventory.xlsx') {
  if (!Buffer.isBuffer(bytes) || bytes.length > 10 * 1024 * 1024) throw Error('Workbook must be at most 10 MB.')
  const book = XLSX.read(bytes, { type: 'buffer', cellDates: false, sheetRows: 10001 })
  if (book.SheetNames.length > 20) throw Error('Workbook has too many sheets; maximum is 20.')
  const sourceRows = [], sheets = {}
  for (const name of book.SheetNames) {
    const range = book.Sheets[name]['!fullref'] || book.Sheets[name]['!ref']
    if (range) { const bounds = XLSX.utils.decode_range(range); if (bounds.e.c > 199 || bounds.e.r > 10000) throw Error(`${name} exceeds the 10,000-row / 200-column limit.`) }
    const matrix = XLSX.utils.sheet_to_json(book.Sheets[name], { header: 1, defval: null, raw: true })
    if (matrix.length > 10000) throw Error(`Too many rows in ${name}; limit is 10,000 per sheet.`)
    const headers = matrix[0] || []
    sheets[name] = matrix.slice(1).map((cells, i) => ({ sheet: name, row: i + 2,
      values: Object.fromEntries(headers.map((key, j) => [text(key) || `unnamed_${j + 1}`, cells[j] ?? null])) }))
      .filter(row => Object.entries(row.values).some(([key, value]) => !key.startsWith('unnamed_') && text(value)))
    sourceRows.push(...sheets[name])
  }
  if (sheets['Inventory records']) {
    const records = Object.fromEntries(inventoryKinds.map(k => [k, []]))
    for (const r of sheets['Inventory records']) {
      const { kind, id, data, sourceRefs } = r.values
      if (!inventoryKinds.includes(kind) || typeof id !== 'string' || id.length > 500) throw Error('Invalid exported inventory identity.')
      if (records[kind].some(r => r.id === id)) throw Error(`Duplicate exported record ID: ${id}. Reconcile the rows before importing.`)
      const parsedData = JSON.parse(data)
      if (!parsedData || Array.isArray(parsedData) || typeof parsedData !== 'object') throw Error('Exported inventory data must be an object.')
      records[kind].push({ id, kind, data: parsedData, sourceRefs: [{ sheet: 'Inventory records', row: r.row, priorSources: JSON.parse(sourceRefs || '[]') }] })
    }
    return { filename, sha256: createHash('sha256').update(bytes).digest('hex'), records, sourceRows, sheetCounts: Object.fromEntries(Object.entries(sheets).map(([k, v]) => [k, v.length])), normalisations: [], format: 'inventory-export' }
  }
  for (const name of ['Node DB', 'Backhauls DB', 'Ladder DB', 'OLT DB']) if (!sheets[name]?.length) throw Error(`Required sheet missing or empty: ${name}`)
  const maps = Object.fromEntries(inventoryKinds.map(k => [k, new Map()])), normalisations = []
  const ref = row => ({ sheet: row.sheet, row: row.row })
  function put(kind, key, data, row) {
    const id = recordId(kind, key), previous = maps[kind].get(id)
    if (previous) { previous.sourceRefs.push(ref(row)); return previous }
    const r = { id, kind, data, sourceRefs: [ref(row)] }; maps[kind].set(id, r); return r
  }
  function ladder(raw, row) {
    if (missing(raw)) return null
    const key = ladderKey(raw), label = ladderName(raw)
    const r = put('ladders', key, { name: label, aliases: [text(raw)], auditScopes: /nld/i.test(label) ? ['ladder', 'nld'] : ['ladder'],
      transport: /vpls/i.test(label) ? 'VPLS' : 'EVPN', notes: 'Imported inventory; not verified against devices.' }, row)
    if (!r.data.aliases.includes(text(raw))) r.data.aliases.push(text(raw))
    if (text(raw) !== label) normalisations.push({ field: 'ladder', from: raw, to: label, ...ref(row) })
    return r.id
  }
  // Site and equipment identities come from the node/DC inventories. Raw source rows
  // remain immutable so a conflicting claim can always be inspected independently.
  for (const row of [...sheets['Node DB'], ...(sheets['DC DB'] || [])]) {
    const v = row.values, key = !missing(v.node_id) ? String(v.node_id) : nameKey(v.iris_node_name || v.solid_node_name)
    const site = put('sites', key, { sourceNodeId: v.node_id, name: text(v.solid_node_name || v.iris_node_name), irisName: text(v.iris_node_name),
      owner: text(v.node_owner), type: row.sheet === 'DC DB' ? 'Data centre' : text(v.node_type), region: text(v.network_region), province: text(v.province),
      coordinates: text(v.coordinates), aliases: [text(v.solid_node_name), text(v.iris_node_name)].filter(Boolean), declaredLadders: [] }, row)
    const claim = ladder(v.ladder, row)
    if (claim && !site.data.declaredLadders.includes(claim)) site.data.declaredLadders.push(claim)
    for (const [field, raw] of Object.entries(v)) if (/^(?:me_switch|pe_switch|olt|juniper)_\d+$|^adva_(?:fsp|alm)$/.test(field) && !missing(raw)) {
      const hostname = hostKey(raw), type = field.startsWith('olt_') ? 'olt' : field.startsWith('juniper_') ? 'router' : field.startsWith('adva_') ? 'adva' : 'switch'
      const d = put('devices', hostname, { hostname, type, siteId: site.id, siteClaims: [site.id], inventoryField: field }, row)
      if (!d.data.siteClaims.includes(site.id)) { d.data.siteClaims.push(site.id); d.data.siteId = null }
    }
  }
  const aliasMap = new Map()
  for (const r of maps.sites.values()) for (const a of r.data.aliases) {
    const k = nameKey(a), set = aliasMap.get(k) || new Set(); set.add(r.id); aliasMap.set(k, set)
  }
  const siteFor = raw => { const ids = aliasMap.get(nameKey(raw)); return ids?.size === 1 ? [...ids][0] : null }
  function device(raw, siteName, row, type = 'switch') {
    if (missing(raw)) return null
    const hostname = hostKey(raw)
    const previous = maps.devices.get(recordId('devices', hostname))
    if (previous) return previous.id
    // A hostname explicitly supplied by another source can be displayed as a claim,
    // but remains flagged as missing from Node/DC DB rather than silently verified.
    return put('devices', hostname, { hostname, type: /-olt-\d+$/.test(hostname) ? 'olt' : /mpls/.test(hostname) ? 'router' : type,
      siteId: siteFor(siteName), siteClaims: siteFor(siteName) ? [siteFor(siteName)] : [], sourceOnly: true }, row).id
  }
  const occurrence = new Map()
  for (const row of sheets['Backhauls DB']) {
    const v = row.values, code = text(v.circuit_code), key = nameKey(code) || `row-${row.row}`
    const n = (occurrence.get(key) || 0) + 1; occurrence.set(key, n)
    const a = device(v.network_device_a, v.side_a, row), b = device(v.network_device_b, v.side_b, row)
    const lid = ladder(v.ladder_1, row)
    const link = put('backhauls', n === 1 ? key : `${key}:duplicate:${n}`, { code, region: text(v.region), ladderIds: lid ? [lid] : [],
      siteA: text(v.side_a), siteB: text(v.side_b), deviceA: text(v.network_device_a).toLowerCase(), deviceB: text(v.network_device_b).toLowerCase(),
      deviceAId: a, deviceBId: b, linkType: text(v.link_type), capacity: text(v.capacity), capacityMbps: capacityMbps(v.capacity), auditScopes: /nld/i.test(v.ladder_1 || '') ? ['nld'] : [] }, row)
    for (let i = 1; i <= 5; i++) if ([v[`circuit_${i}_id`], v[`circuit_${i}_provider`], v[`circuit_${i}_side_a`], v[`circuit_${i}_side_b`]].some(x => !missing(x)))
      put('segments', `${link.id}:${i}`, { backhaulId: link.id, sequence: i, circuitId: text(v[`circuit_${i}_id`]),
        provider: text(v[`circuit_${i}_provider`]), sideA: text(v[`circuit_${i}_side_a`]), sideB: text(v[`circuit_${i}_side_b`]) }, row)
  }
  const membersSeen = new Map()
  for (const row of sheets['Ladder DB']) {
    const v = row.values, lid = ladder(v.ladder, row), siteId = siteFor(v.node)
    const base = `${ladderKey(v.ladder) || 'unassigned'}:${nameKey(v.node) || row.row}`, n = (membersSeen.get(base) || 0) + 1; membersSeen.set(base, n)
    let role = text(v.ring_role)
    if (/^ring[ -]?node$/i.test(role)) { normalisations.push({ field: 'ring_role', from: role, to: 'Transit', ...ref(row) }); role = 'Transit' }
    put('memberships', n === 1 ? base : `${base}:duplicate:${n}`, { ladderId: lid, siteId, node: text(v.node), protection: text(v.deployment).toUpperCase(),
      role, ringName: text(v.ring_name), ringVlan: v.ring_vlan == null ? null : Number(v.ring_vlan),
      primaryCode: text(v.primary_backhaul_circuit), primaryA: text(v.primary_backhaul_side_a), primaryB: text(v.primary_backhaul_side_b),
      secondaryCode: text(v.secondary_backhaul_circuit), secondaryA: text(v.secondary_backhaul_side_a), secondaryB: text(v.secondary_backhaul_side_b),
      ringBlock: missing(v.ring_block) ? null : /^(?:y|yes|true)$/i.test(text(v.ring_block)), corePri: hostKey(v.ladder_primary_router), coreSec: hostKey(v.ladder_secondary_router), master: hostKey(v.ring_master),
      origin: 'Ladder DB' }, row)
  }
  // Node-only memberships are claims with missing ring configuration, not discarded nodes.
  for (const site of maps.sites.values()) for (const lid of site.data.declaredLadders) if (![...maps.memberships.values()].some(m => m.data.siteId === site.id && m.data.ladderId === lid)) {
    maps.memberships.set(recordId('memberships', `claim:${site.id}:${lid}`), { id: recordId('memberships', `claim:${site.id}:${lid}`), kind: 'memberships',
      data: { ladderId: lid, siteId: site.id, node: site.data.irisName || site.data.name, role: '', protection: '', origin: 'Node DB claim', primaryCode: '', secondaryCode: '' }, sourceRefs: site.sourceRefs })
  }
  for (const name of ['OLT DB', 'OLT  Mapping']) for (const row of sheets[name] || []) {
    const v = row.values, hostname = hostKey(v.olt)
    if (missing(hostname)) continue
    device(hostname, v.node, row, 'olt')
    const lid = ladder(v.ladder, row), access = hostKey(v.access_switch)
    const r = put('olts', hostname, { hostname, accessDevice: access, lagCode: text(v.lag_code || v.olt_lag_code),
      uplink1: text(v.uplink_code_1), uplink2: text(v.uplink_code_2), linkType: text(v.link_type), siteId: maps.devices.get(recordId('devices', hostname))?.data.siteId || siteFor(v.node),
      ladderIds: lid ? [lid] : [], corePri: hostKey(v.ladder_primary_router), coreSec: hostKey(v.ladder_secondary_router),
      primaryCode: text(v.primary_backhaul_circuit), secondaryCode: text(v.secondary_backhaul_circuit), attachmentClaims: [] }, row)
    r.data.attachmentClaims.push({ accessDevice: access, lagCode: text(v.lag_code || v.olt_lag_code), ladderId: lid, ...ref(row) })
    if (access && r.data.accessDevice && access !== r.data.accessDevice) r.data.accessDevice = ''
    if (lid && !r.data.ladderIds.includes(lid)) r.data.ladderIds.push(lid)
    for (const [key, value] of Object.entries({ corePri: v.ladder_primary_router, coreSec: v.ladder_secondary_router, primaryCode: v.primary_backhaul_circuit, secondaryCode: v.secondary_backhaul_circuit }))
      if (!r.data[key] && !missing(value)) r.data[key] = text(value)
    for (const key of ['uplink1', 'uplink2']) if (!r.data[key]) r.data[key] = text(v[key === 'uplink1' ? 'uplink_code_1' : 'uplink_code_2'])
  }
  const records = Object.fromEntries(inventoryKinds.map(k => [k, [...maps[k].values()]]))
  return { filename, sha256: createHash('sha256').update(bytes).digest('hex'), records, sourceRows, normalisations,
    sheetCounts: Object.fromEntries(Object.entries(sheets).map(([k, v]) => [k, v.length])), format: 'network-links-workbook' }
}
