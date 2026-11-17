import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import pg from 'pg'
import express from 'express'
import jwt from 'jsonwebtoken'
import { createInventoryRepository } from '../tools/networkInventory/repository.js'
import routes from '../routes/networkInventory.js'
import { reviewFingerprint } from '../tools/networkInventory/quality.js'

test('PostgreSQL/API: provenance, permissions, optimistic edits, import preservation and scoped sign-off invalidation', { skip: !process.env.NETWORK_INVENTORY_TEST_ADMIN_URL }, async () => {
  const adminUrl = new URL(process.env.NETWORK_INVENTORY_TEST_ADMIN_URL)
  assert.ok(['127.0.0.1', 'localhost'].includes(adminUrl.hostname), 'Integration test must use an isolated loopback PostgreSQL server.')
  const name = `ni_test_${randomUUID().replaceAll('-', '')}`, admin = new pg.Pool({ connectionString: adminUrl.href })
  await admin.query(`CREATE DATABASE ${name}`)
  const dbUrl = new URL(adminUrl); dbUrl.pathname = '/' + name
  const pool = new pg.Pool({ connectionString: dbUrl.href }), repo = createInventoryRepository({ pool })
  const user = { id: 1, name: 'Test editor', role: 'admin' }
  const record = (kind, id, data) => ({ kind, id, data, sourceRefs: [{ sheet: 'Node DB', row: 2 }] })
  const payload = { filename: 'Test.xlsx', sha256: 'test', records: { sites: [record('sites', 'sites:a', { name: 'Site A', aliases: ['a'] })],
    devices: [], ladders: [record('ladders', 'ladders:a', { name: 'A', transport: 'EVPN', auditScopes: ['ladder'] })],
    memberships: [], backhauls: [], segments: [], olts: [] }, sourceRows: [{ sheet: 'Node DB', row: 2, values: { solid_node_name: 'Site A' } }], normalisations: [], sheetCounts: { 'Node DB': 1 } }
  let server
  try {
    await repo.initialise()
    const staged = await repo.stageImport(payload, user); await repo.applyImport(staged.id, user)
    let snapshot = await repo.getSnapshot()
    assert.equal(snapshot.summary.upToDate, 0)
    const raw = await repo.sources('sites', 'sites:a'); assert.equal(raw[0].raw_data.solid_node_name, 'Site A')
    const app = express(); app.use(express.json()); app.use('/api/network-inventory', routes({ repo }))
    app.use((e, _q, s, _n) => s.status(e.statusCode || 400).json({ error: e.message }))
    server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)) })
    const root = `http://127.0.0.1:${server.address().port}/api/network-inventory`
    const secret = process.env.JWT_SECRET = 'isolated-inventory-api-test-secret'
    const token = role => jwt.sign({ id: 1, name: 'Test user', role }, secret)
    const request = (url, role, method = 'GET', body) => fetch(root + url, { method, headers: { ...(role ? { Authorization: `Bearer ${token(role)}` } : {}), 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) })
    assert.equal((await request('', null)).status, 401)
    assert.equal((await request('', 'supervisor')).status, 200)
    assert.equal((await request('/records/sites/sites%3Aa', 'supervisor', 'PATCH', { data: { name: 'Wrong' }, note: 'Denied', expectedVersion: 1 })).status, 403)
    const edited = { name: 'Site A corrected', aliases: ['a'] }
    assert.equal((await request('/records/sites/sites%3Aa', 'engineering', 'PATCH', { data: edited, note: 'Confirmed site label', expectedVersion: 1 })).status, 200)
    assert.equal((await request('/records/sites/sites%3Aa', 'admin', 'PATCH', { data: edited, note: 'Stale write', expectedVersion: 1 })).status, 409)
    const again = await repo.stageImport(payload, user)
    assert.equal(again.conflicts.length, 1)
    await repo.applyImport(again.id, user)
    snapshot = await repo.getSnapshot()
    assert.equal(snapshot.records.sites[0].data.name, 'Site A corrected')
    assert.equal((await repo.sources('sites', 'sites:a')).length, 2, 'Both import source rows must survive.')
    const ladder = snapshot.records.ladders[0], fingerprint = reviewFingerprint(snapshot, 'ladders', ladder.id)
    await repo.signOff('ladders', ladder.id, user, 'Reviewed in the inventory', fingerprint)
    assert.equal((await repo.getSnapshot()).summary.upToDate, 1)
    const changedPayload = structuredClone(payload); changedPayload.records.ladders[0].data.notes = 'Changed by an incoming workbook'
    const reviewedPreview = await repo.stageImport(changedPayload, user)
    assert.ok(reviewedPreview.conflicts.some(c => c.id === ladder.id), 'Signed-off values must require an explicit overwrite choice, even without prior edits.')
    await repo.applyImport(reviewedPreview.id, user)
    assert.equal((await repo.getSnapshot()).records.ladders[0].data.notes, undefined)
    await repo.saveRecord('ladders', ladder.id, { ...ladder.data, notes: 'Changed topology notes' }, ladder.version, user, 'New information')
    assert.equal((await repo.getSnapshot()).summary.upToDate, 0)
    assert.ok((await repo.history('sites', 'sites:a')).some(c => c.action === 'edit'))
    const stalePreview = await repo.stageImport(payload, user)
    const current = (await repo.getSnapshot()).records.sites[0]
    await repo.saveRecord('sites', current.id, { ...current.data, owner: 'Frogfoot' }, current.version, user, 'Concurrent edit')
    await assert.rejects(repo.applyImport(stalePreview.id, user), /changed after this preview/)
    const finding = (await repo.getSnapshot()).issues.find(i => i.recordId === current.id)
    assert.equal((await request('/issues/acknowledge-batch', 'admin', 'POST', { issues: [{ id: finding.id, evidenceHash: finding.evidenceHash }], note: 'Known unassigned site for this test' })).status, 200)
    assert.equal((await repo.getSnapshot()).issues.find(i => i.id === finding.id).status, 'acknowledged')
    const changedSite = (await repo.getSnapshot()).records.sites[0]
    await repo.saveRecord('sites', changedSite.id, { ...changedSite.data, name: 'Site changed again' }, changedSite.version, user, 'Evidence changed')
    assert.equal((await repo.getSnapshot()).issues.find(i => i.id === finding.id).status, 'open')
  } finally {
    if (server) await new Promise(resolve => server.close(resolve))
    await repo.close()
    assert.match(name, /^ni_test_[0-9a-f]{32}$/)
    await admin.query(`DROP DATABASE ${name}`); await admin.end()
  }
})
