import test from 'node:test'
import assert from 'node:assert/strict'
import XLSX from 'xlsx'
import { readInventoryWorkbook } from '../tools/networkInventory/normalize.js'
import { enrichInventorySnapshot, reviewFingerprint } from '../tools/networkInventory/quality.js'
import { buildTopology, intendedPaths, ladderKey, membershipLadders } from '../../frontend/src/features/networkInventory/domain.js'

export function fixtureBytes() {
  const b = XLSX.utils.book_new()
  const add = (name, rows) => XLSX.utils.book_append_sheet(b, XLSX.utils.json_to_sheet(rows), name)
  add('Node DB', [
    { node_id: 1, solid_node_name: 'Garden', iris_node_name: 'garden', ladder: 'BFN Ladder 1', me_switch_1: 'bfn-garden-me-sw1' },
    { node_id: 2, solid_node_name: 'Transit', iris_node_name: 'transit', ladder: 'BFN-Ladder1', me_switch_1: 'bfn-transit-me-sw1' },
    { node_id: 3, solid_node_name: 'Core site', iris_node_name: 'core', juniper_1: 'bfn-pri-mpls-r1', juniper_2: 'bfn-sec-mpls-r1' }
  ])
  add('Ladder DB', [
    { ladder: 'BFN Ladder 1', node: 'garden', deployment: 'EAPS', ring_role: 'Master', ring_name: 'ring1', ring_vlan: 23,
      primary_backhaul_circuit: 'A', primary_backhaul_side_a: 'bfn-garden-me-sw1', primary_backhaul_side_b: 'bfn-transit-me-sw1',
      secondary_backhaul_circuit: 'C', secondary_backhaul_side_a: 'bfn-garden-me-sw1', secondary_backhaul_side_b: 'bfn-sec-mpls-r1', ring_block: 'Y', ladder_primary_router: 'bfn-pri-mpls-r1', ladder_secondary_router: 'bfn-sec-mpls-r1' },
    { ladder: 'BFN-Ladder1', node: 'transit', deployment: 'EAPS', ring_role: 'Transit', ring_name: 'ring1', ring_vlan: 23,
      primary_backhaul_circuit: 'B', primary_backhaul_side_a: 'bfn-transit-me-sw1', primary_backhaul_side_b: 'bfn-pri-mpls-r1',
      secondary_backhaul_circuit: 'A', secondary_backhaul_side_a: 'bfn-garden-me-sw1', secondary_backhaul_side_b: 'bfn-transit-me-sw1', ring_block: 'N', ladder_primary_router: 'bfn-pri-mpls-r1', ladder_secondary_router: 'bfn-sec-mpls-r1' }
  ])
  add('Backhauls DB', [['A', 'garden', 'bfn-garden-me-sw1', 'transit', 'bfn-transit-me-sw1'], ['B', 'transit', 'bfn-transit-me-sw1', 'core', 'bfn-pri-mpls-r1'], ['C', 'garden', 'bfn-garden-me-sw1', 'core', 'bfn-sec-mpls-r1']].map(([code, a, da, z, dz]) =>
    ({ circuit_code: code, ladder_1: 'BFN Ladder 1', side_a: a, network_device_a: da, side_b: z, network_device_b: dz, capacity: '40G', link_type: 'Single-circuit', circuit_1_id: `DFA-${code}`, circuit_1_provider: 'DFA', circuit_1_side_a: a, circuit_1_side_b: z })))
  add('OLT DB', [{ olt: 'bfn-garden-olt-1', access_switch: 'bfn-garden-me-sw1', lag_code: 'LAG1' }])
  return XLSX.write(b, { type: 'buffer', bookType: 'xlsx' })
}
test('harmless ladder formatting merges; real distinct names and slash labels remain distinct', () => {
  assert.equal(ladderKey('BFN-Ladder1'), ladderKey('BFN Ladder 1'))
  assert.notEqual(ladderKey('JHB Ladder 7/14'), ladderKey('JHB Ladder 7'))
  const p = readInventoryWorkbook(fixtureBytes())
  assert.equal(p.records.ladders.length, 1)
  assert.ok(p.sourceRows.some(r => r.sheet === 'Ladder DB' && r.values.ladder === 'BFN-Ladder1'))
})
test('referenced cores are included without a separate Core membership row; master blocks only its secondary edge', () => {
  const p = readInventoryWorkbook(fixtureBytes()), g = buildTopology(p, 'ladders:bfnladder1'), owner = g.members.find(m => m.data.role === 'Master')
  assert.ok(g.nodes.find(n => n.label === 'bfn-pri-mpls-r1').roles.includes('Core_Pri'))
  assert.ok(g.nodes.find(n => n.label === 'bfn-sec-mpls-r1').roles.includes('Core_Sec'))
  assert.deepEqual(membershipLadders(p, 'sites:3'), ['ladders:bfnladder1'], 'A site referenced as a core is assigned even without a separate membership row.')
  assert.deepEqual(g.edges.filter(e => e.blocked).map(e => e.code), ['C'])
  const route = intendedPaths(g, owner.id)
  assert.deepEqual(route.primary.edges.map(id => g.edges.find(e => e.id === id).code), ['A', 'B'])
  assert.deepEqual(route.backup.edges.map(id => g.edges.find(e => e.id === id).code), ['C'])
})
test('shared site memberships are informational rather than a uniqueness failure', () => {
  const p = readInventoryWorkbook(fixtureBytes())
  p.records.ladders.push({ id: 'ladders:other', kind: 'ladders', data: { name: 'Other', auditScopes: ['ladder'] }, sourceRefs: [] })
  p.records.memberships.push({ ...structuredClone(p.records.memberships[0]), id: 'memberships:shared', data: { ...p.records.memberships[0].data, ladderId: 'ladders:other' } })
  const s = enrichInventorySnapshot(p)
  assert.ok(s.summary.sharedSites >= 1)
  assert.ok(s.issues.some(i => i.code === 'SHARED_LADDER_NODE' && i.severity === 'info'))
})
test('changing a dependent backhaul invalidates an existing manual sign-off', () => {
  const p = readInventoryWorkbook(fixtureBytes()), id = p.records.ladders[0].id
  const before = reviewFingerprint(p, 'ladders', id)
  p.reviews = [{ kind: 'ladders', recordId: id, fingerprint: before }]
  assert.equal(enrichInventorySnapshot(p).summary.upToDate, 1)
  p.records.backhauls[0].data.capacity = '100G'
  assert.equal(enrichInventorySnapshot(p).summary.upToDate, 0)
})
test('VPLS records do not acquire an inferred EAPS ring block or routing outcome', () => {
  const p = readInventoryWorkbook(fixtureBytes()); p.records.ladders[0].data.transport = 'VPLS'
  const g = buildTopology(p, p.records.ladders[0].id)
  assert.equal(g.edges.filter(e => e.blocked).length, 0)
  assert.equal(intendedPaths(g, g.members[0].id).status, 'vpls-protection-workflow-pending')
})
test('10M capacity is retained and flagged; duplicate physical circuit IDs are not globally collapsed', () => {
  const p = readInventoryWorkbook(fixtureBytes()); p.records.backhauls[0].data.capacity = '10M'
  p.records.segments[1].data.circuitId = p.records.segments[0].data.circuitId
  const s = enrichInventorySnapshot(p)
  assert.equal(p.records.segments.length, 3); assert.ok(s.issues.some(i => i.code === 'CAPACITY_REVIEW'))
  assert.equal(new Set(s.issues.map(i => i.id)).size, s.issues.length)
})
