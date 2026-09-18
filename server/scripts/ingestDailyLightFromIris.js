#!/usr/bin/env node
// Store the latest mapped IRIS OPR value per circuit side once each SAST day.
// Circuit-to-IRIS graph mappings are deliberately stored in the database rather
// than inferred from an emailed report at run time.

import 'dotenv/config'
import pg from 'pg'
import prisma from '../lib/prisma.js'
import { syncStagedZendeskTickets } from '../lib/nldTicketStaging.js'

const {
  DATABASE_URL,
  IRIS_USERNAME,
  IRIS_PASSWORD,
  IRIS_BASE_URL = 'https://iris.frogfoot.net/iris/api2/api',
  IRIS_DAILY_CONCURRENCY = '3'
} = process.env

if (!DATABASE_URL || !IRIS_USERNAME || !IRIS_PASSWORD) {
  throw new Error('DATABASE_URL, IRIS_USERNAME, and IRIS_PASSWORD are required')
}

const irisBase = IRIS_BASE_URL.replace(/\/$/, '')
const authHeader = `Basic ${Buffer.from(`${IRIS_USERNAME}:${IRIS_PASSWORD}`).toString('base64')}`
const concurrency = Math.max(1, Math.min(6, Number(IRIS_DAILY_CONCURRENCY) || 3))
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

function sampleTimeForSastDay(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Johannesburg', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(now)
  const value = type => Number(parts.find(part => part.type === type)?.value)
  // SAST is UTC+02:00 year-round, so 05:00 SAST is 03:00 UTC.
  return new Date(Date.UTC(value('year'), value('month') - 1, value('day'), 3, 0, 0))
}

function parseOpr(response) {
  const value = Number.parseFloat(response?.data?.OPR?.value_unformat)
  return Number.isFinite(value) && value !== 0 ? value : null
}

async function fetchLatestOpr(graphId) {
  const end = Date.now()
  const url = new URL(`${irisBase}/graphs/data`)
  url.searchParams.set('id', graphId)
  url.searchParams.set('starttime', Math.floor((end - 10 * 60 * 1000) / 1000))
  url.searchParams.set('endtime', Math.floor(end / 1000))
  url.searchParams.set('step', '300')

  let lastError
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(url, { headers: { Accept: 'application/json', Authorization: authHeader } })
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`)
      const value = parseOpr(await response.json())
      if (value == null) throw new Error('IRIS returned no non-zero OPR value')
      return value
    } catch (error) {
      lastError = error
      await sleep(attempt * 750)
    }
  }
  throw lastError
}

async function mapWithConcurrency(items, worker) {
  const results = new Array(items.length)
  let cursor = 0
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++
      try {
        results[index] = { item: items[index], value: await worker(items[index]) }
      } catch (error) {
        results[index] = { item: items[index], error: error.message }
      }
      await sleep(150)
    }
  }))
  return results
}

const pool = new pg.Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } })
const client = await pool.connect()

try {
  const { rows: circuits } = await client.query(`
    SELECT id, circuit_id, iris_graph_a_id, iris_graph_b_id,
           iris_graph_a_label, iris_graph_b_label,
           iris_graph_a_device, iris_graph_b_device
    FROM "Circuit"
    WHERE iris_graph_a_id IS NOT NULL OR iris_graph_b_id IS NOT NULL
    ORDER BY circuit_id
  `)

  const mappedSides = circuits.flatMap(circuit => [
    circuit.iris_graph_a_id && { circuit, side: 'A', graphId: circuit.iris_graph_a_id, label: circuit.iris_graph_a_label, device: circuit.iris_graph_a_device },
    circuit.iris_graph_b_id && { circuit, side: 'B', graphId: circuit.iris_graph_b_id, label: circuit.iris_graph_b_label, device: circuit.iris_graph_b_device }
  ].filter(Boolean))
  if (!mappedSides.length) throw new Error('No IRIS circuit mappings are configured')

  const valuesByGraph = new Map()
  const graphIds = [...new Set(mappedSides.map(item => item.graphId))]
  const graphResults = await mapWithConcurrency(graphIds, async graphId => fetchLatestOpr(graphId))
  for (const result of graphResults) valuesByGraph.set(result.item, result)

  const sampleTime = sampleTimeForSastDay()
  const upsertSql = `
    INSERT INTO daily_light_level
      (circuit_id, side, rx, mnemonic, router_name, parsed_code, source_email_id, sample_time)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
    ON CONFLICT (circuit_id, side, sample_time)
    DO UPDATE SET
      rx = EXCLUDED.rx,
      mnemonic = EXCLUDED.mnemonic,
      router_name = EXCLUDED.router_name,
      parsed_code = EXCLUDED.parsed_code,
      source_email_id = EXCLUDED.source_email_id
  `

  await client.query('BEGIN')
  let stored = 0
  const failures = []
  for (const mapped of mappedSides) {
    const result = valuesByGraph.get(mapped.graphId)
    if (result?.error) {
      failures.push(`${mapped.circuit.circuit_id} ${mapped.side}: ${result.error}`)
      continue
    }
    await client.query(upsertSql, [
      mapped.circuit.id,
      mapped.side,
      result.value,
      mapped.label,
      mapped.device,
      mapped.circuit.circuit_id,
      `iris-api:${mapped.graphId}`,
      sampleTime
    ])
    stored += 1
  }
  if (!stored) throw new Error(`IRIS returned no usable OPR values: ${failures.join('; ')}`)
  await client.query('COMMIT')

  console.log(`Stored ${stored}/${mappedSides.length} IRIS OPR side levels for ${sampleTime.toISOString()}.`)
  if (failures.length) console.warn(`IRIS failures (${failures.length}): ${failures.join('; ')}`)

  try {
    const ticketSummary = await syncStagedZendeskTickets(prisma)
    console.log(`Ticket staging synced: created=${ticketSummary.created}, escalated=${ticketSummary.escalated}, updated=${ticketSummary.updated}, skipped=${ticketSummary.skipped}`)
  } catch (error) {
    console.warn(`Ticket staging sync failed after IRIS daily ingest: ${error?.message || error}`)
  }
} catch (error) {
  await client.query('ROLLBACK').catch(() => {})
  throw error
} finally {
  client.release()
  await pool.end()
}
