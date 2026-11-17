import fs from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { inventoryKinds, auditScopes, hostKey, ladderKey, capacityMbps } from '../../../frontend/src/features/networkInventory/domain.js'
import { enrichInventorySnapshot, reviewFingerprint, reviewDependencies } from './quality.js'

export const fail = (statusCode, message) => Object.assign(new Error(message), { statusCode })
const stable = v => Array.isArray(v) ? v.map(stable) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, stable(v[k])])) : v
const equal = (a, b) => JSON.stringify(stable(a)) === JSON.stringify(stable(b))
const actorName = user => `${user.email || user.name || user.id || 'unknown'} (${user.role || 'user'})`
export function validateInventoryData(kind, data) {
  if (!inventoryKinds.includes(kind) || !data || typeof data !== 'object' || Array.isArray(data)) throw fail(400, 'Invalid inventory record.')
  if (JSON.stringify(data).length > 50000) throw fail(400, 'Record is too large.')
  if (Object.keys(data).some(k => ['__proto__', 'constructor', 'prototype'].includes(k))) throw fail(400, 'Invalid record field.')
  const required = { sites: 'name', devices: 'hostname', ladders: 'name', memberships: 'node', backhauls: 'code', segments: 'circuitId', olts: 'hostname' }[kind]
  if (typeof data[required] !== 'string' || !data[required].trim()) throw fail(400, `${required} is required.`)
  for (const field of ['auditScopes', 'ladderIds', 'aliases']) if (data[field] !== undefined && (!Array.isArray(data[field]) || data[field].some(v => typeof v !== 'string'))) throw fail(400, `${field} must be a list of names/IDs.`)
  if (data.auditScopes?.some(s => !auditScopes.includes(s))) throw fail(400, 'Unknown audit scope.')
  if (data.ringVlan != null && (!Number.isInteger(data.ringVlan) || data.ringVlan < 1 || data.ringVlan > 4094)) throw fail(400, 'Control VLAN must be 1–4094 or blank.')
  if (data.sequence != null && (!Number.isInteger(data.sequence) || data.sequence < 1)) throw fail(400, 'Segment sequence must be a positive integer.')
  for (const field of ['ringBlock', 'archived']) if (data[field] != null && typeof data[field] !== 'boolean') throw fail(400, `${field} must be yes, no or unspecified.`)
  return data
}
export function createInventoryRepository({ pool = new pg.Pool({ connectionString: process.env.NETWORK_INVENTORY_DATABASE_URL || process.env.DATABASE_URL, max: 3 }) } = {}) {
  let ready
  const initialise = () => ready ||= (async () => {
    const sql = await fs.readFile(new URL('../../migrations/network-inventory/001_inventory.sql', import.meta.url), 'utf8')
    const c = await pool.connect()
    try { await c.query('BEGIN'); await c.query("SELECT pg_advisory_xact_lock(hashtext('network_inventory_schema'))"); await c.query(sql); await c.query('COMMIT') }
    catch (e) { await c.query('ROLLBACK'); throw e } finally { c.release() }
  })().catch(e => { ready = null; throw e })
  async function transaction(work, readOnly = false) {
    await initialise(); const c = await pool.connect()
    try {
      await c.query(readOnly ? 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY' : 'BEGIN')
      if (!readOnly) await c.query("SELECT pg_advisory_xact_lock(hashtext('network_inventory_write'))")
      const result = await work(c); await c.query('COMMIT'); return result
    } catch (e) { await c.query('ROLLBACK'); throw e } finally { c.release() }
  }
  async function snapshot(c) {
    const records = Object.fromEntries(inventoryKinds.map(k => [k, []]))
    const rows = await c.query(inventoryKinds.map(k => `SELECT '${k}' AS kind,id,data,imported_data,source_refs,version,updated_at FROM network_inventory.${k}`).join(' UNION ALL '))
    for (const row of rows.rows) records[row.kind].push({ id: row.id, kind: row.kind, data: row.data, originalData: row.imported_data, sourceRefs: row.source_refs, version: row.version, updatedAt: row.updated_at })
    const imports = (await c.query("SELECT id,filename,sha256,actor,created_at,applied_at, payload->'sheetCounts' AS counts, payload->'normalisations' AS normalisations FROM network_inventory.imports WHERE status='applied' ORDER BY applied_at DESC")).rows
    const reviews = (await c.query('SELECT kind,record_id AS "recordId",fingerprint,actor,note,reviewed_at AS "reviewedAt" FROM network_inventory.reviews')).rows
    const issueReviews = (await c.query('SELECT id,evidence_hash AS "evidenceHash",actor,note,reviewed_at AS "reviewedAt" FROM network_inventory.issue_reviews')).rows
    const { revision } = (await c.query('SELECT revision FROM network_inventory.state WHERE id=1')).rows[0]
    return { records, imports, reviews, issueReviews, revision }
  }
  const bump = c => c.query('UPDATE network_inventory.state SET revision=revision+1 WHERE id=1')
  const change = (c, kind, id, action, user, note, before, after) => c.query('INSERT INTO network_inventory.changes(id,kind,record_id,action,actor,note,before_data,after_data) VALUES($1,$2,$3,$4,$5,$6,$7,$8)', [randomUUID(), kind, id, action, actorName(user), note, before, after])
  function previewDiff(current, payload) {
    const changes = [], conflicts = []
    const reviewed = reviewedIds(current)
    for (const kind of inventoryKinds) for (const proposed of payload.records[kind]) {
      const old = current.records[kind].find(r => r.id === proposed.id)
      if (!old) changes.push({ kind, id: proposed.id, action: 'add', label: proposed.data.name || proposed.data.hostname || proposed.data.node || proposed.data.code })
      else if (!equal(old.data, proposed.data)) {
        const edited = !equal(old.data, old.originalData) || reviewed.has(old.id)
        const item = { kind, id: old.id, action: edited ? 'preserve-reviewed-or-edited-value' : 'update', before: old.data, after: proposed.data, label: proposed.data.name || proposed.data.hostname || proposed.data.node || proposed.data.code }
        changes.push(item); if (edited) conflicts.push(item)
      }
    }
    const omitted = inventoryKinds.flatMap(kind => current.records[kind].filter(r => !payload.records[kind].some(p => p.id === r.id)).map(r => ({ kind, id: r.id })))
    return { changes, conflicts, omitted, counts: Object.fromEntries(inventoryKinds.map(k => [k, payload.records[k].length])) }
  }
  function reviewedIds(current) {
    return new Set((current.reviews || []).filter(r => r.fingerprint === reviewFingerprint(current, r.kind, r.recordId))
      .flatMap(r => (reviewDependencies(current, r.kind, r.recordId) || []).map(x => x.id)))
  }
  return {
    initialise, close: () => pool.end(),
    getSnapshot: () => transaction(async c => enrichInventorySnapshot(await snapshot(c)), true),
    async stageImport(payload, user) {
      return transaction(async c => {
        const current = await snapshot(c), id = randomUUID(), diff = previewDiff(current, payload)
        await c.query('INSERT INTO network_inventory.imports(id,filename,sha256,status,payload,baseline_revision,actor) VALUES($1,$2,$3,\'preview\',$4,$5,$6)', [id, payload.filename, payload.sha256, payload, current.revision, actorName(user)])
        return { id, filename: payload.filename, revision: current.revision, ...diff, normalisations: payload.normalisations,
          issues: enrichInventorySnapshot({ records: payload.records }).issues, sheetCounts: payload.sheetCounts }
      })
    },
    async applyImport(id, user, { overwriteIds = [], note = '' } = {}) {
      return transaction(async c => {
        const staged = (await c.query('SELECT * FROM network_inventory.imports WHERE id=$1 FOR UPDATE', [id])).rows[0]
        if (!staged || staged.status !== 'preview') throw fail(409, 'Import preview is missing or already applied.')
        const current = await snapshot(c)
        if (current.revision !== staged.baseline_revision) throw fail(409, 'Inventory changed after this preview. Preview the workbook again.')
        if (overwriteIds.length && !note.trim()) throw fail(400, 'Explain why reviewed edits should be replaced.')
        const payload = staged.payload
        const reviewed = reviewedIds(current)
        for (const kind of inventoryKinds) for (const r of payload.records[kind]) {
          // Imported incomplete rows are intentionally allowed; validators apply to user edits.
          if (!r.id || r.kind !== kind || !r.data || typeof r.data !== 'object') throw fail(400, 'Invalid imported record.')
          const old = current.records[kind].find(x => x.id === r.id)
          const manuallyEdited = old && (!equal(old.data, old.originalData) || reviewed.has(old.id))
          const data = manuallyEdited && !overwriteIds.includes(r.id) ? old.data : r.data
          const refs = [...(old?.sourceRefs || []), ...r.sourceRefs.map(ref => ({ ...ref, importId: id }))]
          await c.query(`INSERT INTO network_inventory.${kind}(id,data,imported_data,source_refs) VALUES($1,$2,$3,$4)
            ON CONFLICT(id) DO UPDATE SET data=$2,imported_data=$3,source_refs=$4,
            version=network_inventory.${kind}.version+CASE WHEN network_inventory.${kind}.data IS DISTINCT FROM $2::jsonb THEN 1 ELSE 0 END,updated_at=now()`, [r.id, data, r.data, JSON.stringify(refs)])
          if (!old || !equal(old.data, data)) await change(c, kind, r.id, 'import', user, note || `Imported ${staged.filename}`, old?.data || null, data)
        }
        for (const row of payload.sourceRows) await c.query('INSERT INTO network_inventory.source_rows(import_id,sheet,row_number,raw_data) VALUES($1,$2,$3,$4)', [id, row.sheet, row.row, row.values])
        await c.query("UPDATE network_inventory.imports SET status='applied',applied_at=now() WHERE id=$1", [id]); await bump(c)
        return { applied: true, id }
      })
    },
    async saveRecord(kind, id, data, expectedVersion, user, note, create = false) {
      validateInventoryData(kind, data)
      if (!note?.trim()) throw fail(400, 'A change note is required.')
      return transaction(async c => {
        const previous = (await c.query(`SELECT * FROM network_inventory.${kind} WHERE id=$1 FOR UPDATE`, [id])).rows[0]
        if (create && previous) throw fail(409, 'Record already exists.')
        if (!create && !previous) throw fail(404, 'Record not found.')
        if (previous && previous.version !== expectedVersion) throw fail(409, 'This record changed. Refresh before saving.')
        if (['devices', 'olts', 'ladders'].includes(kind)) {
          const peers = (await c.query(`SELECT id,data FROM network_inventory.${kind} WHERE id<>$1 AND COALESCE((data->>'archived')::boolean,false)=false`, [id])).rows
          const key = kind === 'ladders' ? ladderKey(data.name) : hostKey(data.hostname)
          if (peers.some(p => (kind === 'ladders' ? ladderKey(p.data.name) : hostKey(p.data.hostname)) === key)) throw fail(409, 'This hostname/ladder already exists. Edit the existing record or change its relationships instead.')
        }
        if (kind === 'devices' && data.siteId !== previous?.data.siteId) {
          data = { ...data, siteClaims: data.siteId ? [data.siteId] : [], sourceOnly: false }
        }
        if (kind === 'backhauls') {
          const devices = (await c.query('SELECT id,data FROM network_inventory.devices')).rows
          data = { ...data, deviceAId: devices.find(d => d.data.hostname === data.deviceA)?.id || null,
            deviceBId: devices.find(d => d.data.hostname === data.deviceB)?.id || null, capacityMbps: capacityMbps(data.capacity) }
        }
        if (create) await c.query(`INSERT INTO network_inventory.${kind}(id,data,imported_data) VALUES($1,$2,'{}')`, [id, data])
        else await c.query(`UPDATE network_inventory.${kind} SET data=$2,version=version+1,updated_at=now() WHERE id=$1`, [id, data])
        await change(c, kind, id, create ? 'create' : data.archived ? 'archive' : 'edit', user, note, previous?.data || null, data); await bump(c)
        return { saved: true, id }
      })
    },
    async signOff(kind, recordId, user, note, expectedFingerprint) {
      if (!['ladders', 'olts', 'backhauls'].includes(kind) || !note?.trim()) throw fail(400, 'A sign-off subject and evidence/review note are required.')
      return transaction(async c => {
        const s = enrichInventorySnapshot(await snapshot(c)), fingerprint = reviewFingerprint(s, kind, recordId)
        if (!fingerprint) throw fail(404, 'Subject not found.')
        if (fingerprint !== expectedFingerprint) throw fail(409, 'Related inventory changed. Refresh before signing off.')
        const dependencies = new Set(reviewDependencies(s, kind, recordId).map(r => r.id))
        const open = s.issues.filter(i => i.status === 'open' && i.severity !== 'info' && (dependencies.has(i.recordId) || kind === 'ladders' && i.ladderIds.includes(recordId)))
        if (open.length) throw fail(409, 'Resolve or explicitly acknowledge the outstanding findings before signing off.')
        await c.query(`INSERT INTO network_inventory.reviews(kind,record_id,fingerprint,actor,note) VALUES($1,$2,$3,$4,$5)
          ON CONFLICT(kind,record_id) DO UPDATE SET fingerprint=$3,actor=$4,note=$5,reviewed_at=now()`, [kind, recordId, fingerprint, actorName(user), note])
        await change(c, kind, recordId, 'manual-sign-off', user, note, null, { fingerprint, deviceVerified: false }); await bump(c)
        return { signedOff: true }
      })
    },
    async acknowledgeIssue(id, evidenceHash, user, note) {
      if (!note?.trim()) throw fail(400, 'Explain the accepted discrepancy.')
      return transaction(async c => {
        const s = enrichInventorySnapshot(await snapshot(c)), issue = s.issues.find(i => i.id === id)
        if (!issue || issue.evidenceHash !== evidenceHash) throw fail(409, 'Finding changed. Refresh before acknowledging it.')
        await c.query(`INSERT INTO network_inventory.issue_reviews(id,evidence_hash,actor,note) VALUES($1,$2,$3,$4)
          ON CONFLICT(id) DO UPDATE SET evidence_hash=$2,actor=$3,note=$4,reviewed_at=now()`, [id, evidenceHash, actorName(user), note])
        await change(c, issue.kind, issue.recordId, 'acknowledge-finding', user, note, null, { issueId: id, evidenceHash }); await bump(c)
        return { acknowledged: true }
      })
    },
    async acknowledgeIssues(issues, user, note) {
      if (!Array.isArray(issues) || !issues.length || issues.length > 100 || typeof note !== 'string' || !note.trim()) throw fail(400, 'Choose 1–100 findings and provide a review note.')
      return transaction(async c => {
        const s = enrichInventorySnapshot(await snapshot(c)), selected = issues.map(item => s.issues.find(i => i.id === item.id && i.evidenceHash === item.evidenceHash))
        if (selected.some(i => !i) || new Set(selected.map(i => i.id)).size !== selected.length) throw fail(409, 'Findings changed or were duplicated. Refresh before acknowledging.')
        for (const issue of selected) {
          await c.query(`INSERT INTO network_inventory.issue_reviews(id,evidence_hash,actor,note) VALUES($1,$2,$3,$4)
            ON CONFLICT(id) DO UPDATE SET evidence_hash=$2,actor=$3,note=$4,reviewed_at=now()`, [issue.id, issue.evidenceHash, actorName(user), note])
          await change(c, issue.kind, issue.recordId, 'acknowledge-finding', user, note, null, { issueId: issue.id, evidenceHash: issue.evidenceHash })
        }
        await bump(c); return { acknowledged: selected.length }
      })
    },
    history: (kind, id) => transaction(async c => (await c.query('SELECT * FROM network_inventory.changes WHERE kind=$1 AND record_id=$2 ORDER BY created_at DESC LIMIT 200', [kind, id])).rows, true),
    sources: (kind, id) => transaction(async c => {
      if (!inventoryKinds.includes(kind)) throw fail(400, 'Unknown table.')
      const r = (await c.query(`SELECT source_refs FROM network_inventory.${kind} WHERE id=$1`, [id])).rows[0]
      if (!r) throw fail(404, 'Record missing.')
      const rows = []
      for (const ref of r.source_refs) rows.push(...(await c.query('SELECT s.*,i.filename FROM network_inventory.source_rows s JOIN network_inventory.imports i ON i.id=s.import_id WHERE import_id=$1 AND sheet=$2 AND row_number=$3', [ref.importId, ref.sheet, ref.row])).rows)
      return rows
    }, true)
  }
}
