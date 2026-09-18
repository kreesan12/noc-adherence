#!/usr/bin/env node
// Store the latest mapped IRIS OPR value per circuit side once each SAST day.
// Circuit-to-IRIS graph mappings are deliberately stored in the database rather
// than inferred from an emailed report at run time.

import 'dotenv/config'
import pg from 'pg'
import { google } from 'googleapis'
import prisma from '../lib/prisma.js'
import { syncZendeskDriftTickets } from '../lib/nldZendeskDriftTickets.js'

const {
  DATABASE_URL,
  IRIS_USERNAME,
  IRIS_PASSWORD,
  IRIS_BASE_URL = 'https://iris.frogfoot.net/iris/api2/api',
  IRIS_DAILY_CONCURRENCY = '3',
  NLD_IRIS_ALERT_EMAIL = 'kreesan.govender@frogfoot.com',
  CLIENT_ID,
  CLIENT_SECRET,
  REFRESH_TOKEN
} = process.env

if (!DATABASE_URL || !IRIS_USERNAME || !IRIS_PASSWORD) {
  throw new Error('DATABASE_URL, IRIS_USERNAME, and IRIS_PASSWORD are required')
}

const irisBase = IRIS_BASE_URL.replace(/\/$/, '')
const authHeader = `Basic ${Buffer.from(`${IRIS_USERNAME}:${IRIS_PASSWORD}`).toString('base64')}`
const concurrency = Math.max(1, Math.min(6, Number(IRIS_DAILY_CONCURRENCY) || 3))
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

async function sendIrisAlertEmail({ unmappedSides, failures }) {
  if (!unmappedSides.length && !failures.length) return
  if (!CLIENT_ID || !CLIENT_SECRET || !REFRESH_TOKEN) {
    console.warn('IRIS mapping alert email was not sent: Gmail OAuth environment is not configured')
    return
  }
  const body = [
    'NLD IRIS daily-ingest exception alert.',
    '',
    'These sides were not stored in the daily light-level feed. They may be unavailable at the time of polling, or need an IRIS graph mapping review.',
    '',
    ...(unmappedSides.length ? ['NO IRIS GRAPH MAPPING:', ...unmappedSides.map(item => `- ${item.circuitId} | Side ${item.side} - ${item.node}`), ''] : []),
    ...(failures.length ? ['IRIS GRAPH RETURNED NO USABLE OPR:', ...failures.map(item => `- ${item.circuitId} | Side ${item.side} | Graph ${item.graphId}: ${item.error}`), ''] : []),
    'This alert does not create a Zendesk ticket.'
  ].join('\r\n')
  const oauth = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET)
  oauth.setCredentials({ refresh_token: REFRESH_TOKEN })
  const raw = Buffer.from(`To: ${NLD_IRIS_ALERT_EMAIL}\r\nSubject: NLD IRIS graph or OPR exception\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n${body}`).toString('base64url')
  await google.gmail({ version: 'v1', auth: oauth }).users.messages.send({ userId: 'me', requestBody: { raw } })
  console.log(`Sent IRIS mapping/blank OPR alert email to ${NLD_IRIS_ALERT_EMAIL}`)
}

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
    SELECT id, circuit_id, node_a, node_b, iris_graph_a_id, iris_graph_b_id,
           iris_graph_a_label, iris_graph_b_label,
           iris_graph_a_device, iris_graph_b_device
    FROM "Circuit"
    ORDER BY circuit_id
  `)

  const mappedSides = circuits.flatMap(circuit => [
    circuit.iris_graph_a_id && { circuit, side: 'A', graphId: circuit.iris_graph_a_id, label: circuit.iris_graph_a_label, device: circuit.iris_graph_a_device },
    circuit.iris_graph_b_id && { circuit, side: 'B', graphId: circuit.iris_graph_b_id, label: circuit.iris_graph_b_label, device: circuit.iris_graph_b_device }
  ].filter(Boolean))
  const unmappedSides = circuits.flatMap(circuit => [
    !circuit.iris_graph_a_id && { circuitId: circuit.circuit_id, side: 'A', node: circuit.node_a },
    !circuit.iris_graph_b_id && { circuitId: circuit.circuit_id, side: 'B', node: circuit.node_b }
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
      failures.push({ circuitId: mapped.circuit.circuit_id, side: mapped.side, graphId: mapped.graphId, error: result.error })
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
  if (!stored) {
    await sendIrisAlertEmail({ unmappedSides, failures }).catch(error => console.warn(`IRIS alert email failed: ${error?.message || error}`))
    throw new Error(`IRIS returned no usable OPR values: ${failures.map(item => `${item.circuitId} ${item.side}: ${item.error}`).join('; ')}`)
  }
  await client.query('COMMIT')

  console.log(`Stored ${stored}/${mappedSides.length} IRIS OPR side levels for ${sampleTime.toISOString()}.`)
  if (failures.length) console.warn(`IRIS failures (${failures.length}): ${failures.map(item => `${item.circuitId} ${item.side}: ${item.error}`).join('; ')}`)
  await sendIrisAlertEmail({ unmappedSides, failures }).catch(error => console.warn(`IRIS alert email failed: ${error?.message || error}`))

  try {
    const ticketSummary = await syncZendeskDriftTickets(prisma)
    console.log(`Zendesk NLD drift sync: paused=${ticketSummary.paused}, created=${ticketSummary.created}, replacements=${ticketSummary.replacementCreated}, updated=${ticketSummary.updated}, skipped=${ticketSummary.skipped}`)
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
