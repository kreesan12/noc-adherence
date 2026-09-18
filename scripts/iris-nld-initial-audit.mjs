import fs from 'node:fs/promises'
import path from 'node:path'

const irisBase = (process.env.IRIS_BASE_URL || 'https://iris.frogfoot.net/iris/api2/api').replace(/\/$/, '')
const nldApiUrl = process.env.NLD_API_URL || 'https://154-65-108-106.sslip.io/api/engineering/circuits'
const username = process.env.IRIS_USERNAME
const password = process.env.IRIS_PASSWORD
const outputDir = path.resolve(process.env.IRIS_AUDIT_OUTPUT_DIR || process.cwd())
const outputStem = process.env.IRIS_AUDIT_OUTPUT_STEM || 'iris_nld_initial_value_audit'
const groupPattern = new RegExp(process.env.IRIS_AUDIT_GROUP_PATTERN || '^NLD', 'i')
const concurrency = Math.max(1, Math.min(4, Number(process.env.IRIS_AUDIT_CONCURRENCY || 3)))
const earliestBound = Date.parse(process.env.IRIS_AUDIT_EARLIEST || '2010-01-01T00:00:00Z')
const fiveMinutes = 5 * 60 * 1000
const oneDay = 24 * 60 * 60 * 1000

if (!username || !password) throw new Error('Set IRIS_USERNAME and IRIS_PASSWORD before running this read-only audit.')

const authHeader = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const codePattern = /027[A-Z]{3,4}\d{12}/g
const codesIn = value => String(value || '').match(codePattern) || []
const n = value => String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '')

function valueFrom(response) {
  const raw = response?.data?.OPR?.value_unformat
  const value = Number.parseFloat(raw)
  return Number.isFinite(value) && value !== 0 ? value : null
}

async function fetchJson(url, headers = {}) {
  let lastError
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch(url, { headers })
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`)
      return await response.json()
    } catch (error) {
      lastError = error
      await sleep(500 * (attempt + 1))
    }
  }
  throw lastError
}

async function graphSummary(graphId, startMs, endMs) {
  const url = new URL(`${irisBase}/graphs/data`)
  url.searchParams.set('id', graphId)
  url.searchParams.set('starttime', Math.floor(startMs / 1000))
  url.searchParams.set('endtime', Math.floor(endMs / 1000))
  url.searchParams.set('step', '300')
  return fetchJson(url, { Accept: 'application/json', Authorization: authHeader })
}

async function hasNonZeroInRange(graphId, startMs, endMs) {
  const response = await graphSummary(graphId, startMs, endMs)
  return valueFrom(response) !== null
}

// The graph-data endpoint aggregates a requested period.  We use a binary search
// over the period and then a 5-minute interval search to find its first retained
// non-zero OPR sample interval without making any change in IRIS or the NLD DB.
async function firstNonZero(graphId, nowMs) {
  if (!(await hasNonZeroInRange(graphId, earliestBound, nowMs))) return null

  let low = earliestBound
  let high = nowMs
  while (high - low > oneDay) {
    const middle = Math.floor((low + high) / (2 * oneDay)) * oneDay
    if (await hasNonZeroInRange(graphId, earliestBound, middle + oneDay)) high = middle
    else low = middle + oneDay
  }

  const dayStart = Math.floor(high / oneDay) * oneDay
  low = dayStart
  high = dayStart + oneDay
  while (high - low > fiveMinutes) {
    const middle = Math.floor((low + high) / (2 * fiveMinutes)) * fiveMinutes
    if (await hasNonZeroInRange(graphId, dayStart, middle + fiveMinutes)) high = middle
    else low = middle + fiveMinutes
  }

  const sample = await graphSummary(graphId, high, high + fiveMinutes)
  const value = valueFrom(sample)
  return value === null ? null : { at: new Date(high).toISOString(), value }
}

function scoreEndpoint(node, graph) {
  const nodeText = n(node)
  // OPR mnemonic describes the far end of the optical path. Its device is the
  // monitored/source end and is therefore the correct circuit-side mapping key.
  const device = n(graph.device)
  if (!nodeText || !device) return 0
  if (device.includes(nodeText) || nodeText.includes(device)) return 100
  const shortNode = nodeText.replace(/station|farm|park|west|town/g, '')
  if (shortNode.length >= 5 && device.includes(shortNode)) return 80
  return 0
}

function mapCircuitEnds(circuit, candidates) {
  if (candidates.length !== 2) return { status: 'review', reason: `${candidates.length} OPR graph candidates require mapping review` }
  const [first, second] = candidates
  const direct = scoreEndpoint(circuit.nodeA, first) + scoreEndpoint(circuit.nodeB, second)
  const reverse = scoreEndpoint(circuit.nodeA, second) + scoreEndpoint(circuit.nodeB, first)
  if (Math.max(direct, reverse) < 160) return { status: 'review', reason: 'Could not confidently associate both OPR graph labels to circuit endpoints' }
  return direct >= reverse
    ? { status: 'mapped', a: first, b: second }
    : { status: 'mapped', a: second, b: first }
}

function classify(delta) {
  const absolute = Math.abs(delta)
  if (absolute <= 0.2) return 'Same'
  if (absolute <= 1.0) return 'Slight difference'
  return 'Major difference'
}

function csv(value) {
  const text = value == null ? '' : String(value)
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

async function getOprCatalog() {
  const first = await fetchJson(`${irisBase}/graphs?count=100&page=1&search.gdef=${encodeURIComponent('advaFspr7OscmpnOpr')}`, { Accept: 'application/json', Authorization: authHeader })
  const pages = await Promise.all([...Array(first.last_page - 1)].map((_, index) =>
    fetchJson(`${irisBase}/graphs?count=100&page=${index + 2}&search.gdef=${encodeURIComponent('advaFspr7OscmpnOpr')}`, { Accept: 'application/json', Authorization: authHeader })
  ))
  const unique = new Map()
  for (const graph of [first, ...pages].flatMap(page => page.data || [])) {
    if (!unique.has(graph.graphs_id)) unique.set(graph.graphs_id, graph)
  }
  return [...unique.values()]
}

const circuits = (await fetchJson(nldApiUrl)).filter(circuit => groupPattern.test(String(circuit.nldGroup || '')))
const catalog = await getOprCatalog()
const candidateByCircuit = circuits.map(circuit => {
  const codes = codesIn(circuit.circuitId)
  const candidates = catalog.filter(graph => codes.length && codes.every(code => codesIn(graph.mnemonic).includes(code)))
  return { circuit, candidates, mapping: mapCircuitEnds(circuit, candidates) }
})

const graphIds = [...new Set(candidateByCircuit.flatMap(item => item.candidates.map(graph => graph.graphs_id)))]
console.log(`Read-only IRIS scan: ${circuits.length} NLD circuits, ${graphIds.length} unique OPR graphs, concurrency ${concurrency}.`)
const firstByGraph = new Map()
let completed = 0
let cursor = 0
async function worker() {
  while (cursor < graphIds.length) {
    const graphId = graphIds[cursor]
    cursor += 1
    try {
      firstByGraph.set(graphId, await firstNonZero(graphId, Date.now()))
    } catch (error) {
      firstByGraph.set(graphId, { error: error.message })
    }
    completed += 1
    console.log(`Scanned ${completed}/${graphIds.length}: ${graphId}`)
    await sleep(150)
  }
}
await Promise.all([...Array(concurrency)].map(worker))

const rows = candidateByCircuit.map(({ circuit, candidates, mapping }) => {
  const candidateDetails = candidates.map(graph => ({
    graphId: graph.graphs_id,
    label: graph.mnemonic,
    device: graph.device,
    first: firstByGraph.get(graph.graphs_id) ?? null
  }))
  const currentA = circuit.initRxSiteA ?? circuit.initial?.rxSiteA ?? null
  const currentB = circuit.initRxSiteB ?? circuit.initial?.rxSiteB ?? null
  const aFirst = mapping.a ? firstByGraph.get(mapping.a.graphs_id) : null
  const bFirst = mapping.b ? firstByGraph.get(mapping.b.graphs_id) : null
  const deltaA = aFirst?.value != null && currentA != null ? Number((aFirst.value - Number(currentA)).toFixed(2)) : null
  const deltaB = bFirst?.value != null && currentB != null ? Number((bFirst.value - Number(currentB)).toFixed(2)) : null
  const comment = mapping.status !== 'mapped'
    ? `Needs mapping review: ${mapping.reason}`
    : [deltaA, deltaB].some(delta => delta == null)
      ? 'Needs data review: one or both first OPR samples were unavailable'
      : [classify(deltaA), classify(deltaB)].includes('Major difference')
        ? 'Major difference — review before changing initial values'
        : [classify(deltaA), classify(deltaB)].includes('Slight difference')
          ? 'Slight difference — review recommended'
          : 'Same — no change indicated'
  return {
    circuitId: circuit.circuitId,
    nldGroup: circuit.nldGroup,
    nodeA: circuit.nodeA,
    nodeB: circuit.nodeB,
    currentInitialA: currentA,
    currentInitialB: currentB,
    graphAId: mapping.a?.graphs_id ?? null,
    graphALabel: mapping.a?.mnemonic ?? null,
    graphAFirstAt: aFirst?.at ?? null,
    graphAFirstValue: aFirst?.value ?? null,
    deltaA,
    classificationA: deltaA == null ? null : classify(deltaA),
    graphBId: mapping.b?.graphs_id ?? null,
    graphBLabel: mapping.b?.mnemonic ?? null,
    graphBFirstAt: bFirst?.at ?? null,
    graphBFirstValue: bFirst?.value ?? null,
    deltaB,
    classificationB: deltaB == null ? null : classify(deltaB),
    comment,
    candidates: candidateDetails
  }
})

const generatedAt = new Date().toISOString()
const report = {
  generatedAt,
  source: { irisBase, nldApiUrl, earliestSearchBound: new Date(earliestBound).toISOString(), sampleInterval: '5 minutes' },
  classification: { same: 'absolute delta ≤ 0.2 dBm', slight: '0.2 < absolute delta ≤ 1.0 dBm', major: 'absolute delta > 1.0 dBm' },
  summary: {
    circuits: rows.length,
    mapped: rows.filter(row => row.graphAId && row.graphBId).length,
    review: rows.filter(row => row.comment.startsWith('Needs mapping review')).length
  },
  rows
}
const columns = ['circuitId','nldGroup','nodeA','nodeB','currentInitialA','currentInitialB','graphAId','graphALabel','graphAFirstAt','graphAFirstValue','deltaA','classificationA','graphBId','graphBLabel','graphBFirstAt','graphBFirstValue','deltaB','classificationB','comment','candidates']
const csvText = [columns.join(','), ...rows.map(row => columns.map(column => csv(column === 'candidates' ? JSON.stringify(row.candidates) : row[column])).join(','))].join('\n')
await fs.mkdir(outputDir, { recursive: true })
await fs.writeFile(path.join(outputDir, `${outputStem}.csv`), csvText)
await fs.writeFile(path.join(outputDir, `${outputStem}.json`), JSON.stringify(report, null, 2))
console.log(`Complete. Wrote ${path.join(outputDir, `${outputStem}.csv`)}`)
