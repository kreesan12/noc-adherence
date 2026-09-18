import fs from 'node:fs/promises'
import path from 'node:path'

const outputDir = path.resolve(process.env.IRIS_AUDIT_OUTPUT_DIR || process.cwd())
const inputStem = process.env.IRIS_AUDIT_INPUT_STEM || 'iris_nld_initial_value_audit'
const inputJsonPath = path.join(outputDir, `${inputStem}.json`)
const outputStem = process.env.IRIS_AUDIT_OUTPUT_STEM || 'iris_nld_initial_value_audit'
const jsonPath = path.join(outputDir, `${outputStem}.json`)
const csvPath = path.join(outputDir, `${outputStem}.csv`)
const nldApiUrl = process.env.NLD_API_URL || 'https://154-65-108-106.sslip.io/api/engineering/circuits'
const report = JSON.parse(await fs.readFile(inputJsonPath, 'utf8'))
const n = value => String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '')

const liveCircuitsResponse = await fetch(nldApiUrl)
if (!liveCircuitsResponse.ok) throw new Error(`Could not load live NLD data: ${liveCircuitsResponse.status} ${liveCircuitsResponse.statusText}`)
const liveCircuits = await liveCircuitsResponse.json()
const liveCircuitById = new Map(liveCircuits.map(circuit => [circuit.circuitId, circuit]))
const rawDailyByCircuitId = new Map()

async function loadRawDailyTelemetry(circuit) {
  if (!circuit?.id) return []
  if (rawDailyByCircuitId.has(circuit.id)) return rawDailyByCircuitId.get(circuit.id)
  const detailUrl = nldApiUrl.replace(/\/circuits\/?$/, `/circuit/${circuit.id}`)
  const response = await fetch(detailUrl)
  if (!response.ok) throw new Error(`Could not load daily telemetry for ${circuit.circuitId}: ${response.status} ${response.statusText}`)
  const details = await response.json()
  const dailies = Array.isArray(details.dailyLevels) ? details.dailyLevels : []
  rawDailyByCircuitId.set(circuit.id, dailies)
  return dailies
}

function latestDaily(circuit, side) {
  return (circuit?.dailyLevels || [])
    .filter(level => String(level.side || '').toUpperCase() === side)
    .sort((left, right) => new Date(right.sampleTime) - new Date(left.sampleTime))[0] || null
}

function scoreEndpoint(node, graph) {
  const nodeText = n(node)
  const device = n(graph.device)
  if (!nodeText || !device) return 0
  if (device.includes(nodeText) || nodeText.includes(device)) return 100
  const shortNode = nodeText.replace(/station|farm|park|west|town/g, '')
  return shortNode.length >= 5 && device.includes(shortNode) ? 80 : 0
}

function scoreDailyTelemetry(graph, daily) {
  if (!daily) return 0
  const device = n(graph.device)
  const router = n(daily.routerName)
  const graphLabel = n(String(graph.mnemonic || graph.label || '').split('|')[0])
  const dailyLabel = n(String(daily.mnemonic || '').split('|')[0])
  const deviceMatch = device && router && (device === router || device.includes(router) || router.includes(device))
  const labelMatch = graphLabel && dailyLabel && (graphLabel === dailyLabel || graphLabel.includes(dailyLabel) || dailyLabel.includes(graphLabel))
  const graphBand = String(graph.mnemonic || graph.label || '').match(/\(([^)]+)\)/)?.[1]
  const dailyBand = String(daily.mnemonic || '').match(/\(([^)]+)\)/)?.[1]
  const bandMatch = graphBand && dailyBand && graphBand === dailyBand
  return (deviceMatch ? 100 : 0) + (labelMatch ? 150 : 0) + (bandMatch ? 20 : 0)
}

function mapGraphsFromDaily(graphs, latestA, latestB) {
  const ranked = (daily) => graphs
    .map(graph => ({ graph, score: scoreDailyTelemetry(graph, daily) }))
    .sort((left, right) => right.score - left.score)
  const aRanked = ranked(latestA)
  const bRanked = ranked(latestB)
  const minimumScore = 250 // matching IRIS device plus far-end mnemonic
  const a = aRanked[0]?.score >= minimumScore ? aRanked[0].graph : null
  const b = bRanked.find(entry => entry.graph.graphs_id !== a?.graphs_id && entry.score >= minimumScore)?.graph ?? null
  return {
    a,
    b,
    reason: a && b ? null : 'Daily ingestion could map only one OPR side; the other side needs data review'
  }
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

for (const row of report.rows) {
  const liveCircuit = liveCircuitById.get(row.circuitId)
  const latestA = latestDaily(liveCircuit, 'A')
  const latestB = latestDaily(liveCircuit, 'B')
  const currentInitialA = liveCircuit?.initRxSiteA ?? liveCircuit?.initial?.rxSiteA ?? row.currentInitialA
  const currentInitialB = liveCircuit?.initRxSiteB ?? liveCircuit?.initial?.rxSiteB ?? row.currentInitialB
  const candidates = row.candidates || []
  const graphCandidates = candidates.map(candidate => ({
    graphs_id: candidate.graphId,
    mnemonic: candidate.label,
    device: candidate.device
  }))
  let a = null
  let b = null
  let mappingReason = null
  if (graphCandidates.length === 2) {
    const [first, second] = graphCandidates
    const direct = scoreEndpoint(row.nodeA, first) + scoreEndpoint(row.nodeB, second)
    const reverse = scoreEndpoint(row.nodeA, second) + scoreEndpoint(row.nodeB, first)
    if (Math.max(direct, reverse) >= 160) [a, b] = direct >= reverse ? [first, second] : [second, first]
  } else {
    mappingReason = `${graphCandidates.length} OPR graph candidates require mapping review`
  }
  if (!a || !b) {
    // The grid endpoint intentionally only includes level/time/side. The circuit
    // detail endpoint retains the IRIS mnemonic and device name used by the daily
    // importer, which is the authoritative side mapping for ambiguous OPR graphs.
    const rawDailies = await loadRawDailyTelemetry(liveCircuit)
    const rawLatestA = latestDaily({ dailyLevels: rawDailies }, 'A')
    const rawLatestB = latestDaily({ dailyLevels: rawDailies }, 'B')
    const dailyMapping = mapGraphsFromDaily(graphCandidates, rawLatestA, rawLatestB)
    if (dailyMapping.a || dailyMapping.b) {
      a = dailyMapping.a
      b = dailyMapping.b
      mappingReason = dailyMapping.reason
    } else if (graphCandidates.length === 2) {
      mappingReason = 'Could not confidently associate both OPR graph devices to circuit endpoints or daily ingestion data'
    }
  }

  const aFirst = a ? candidates.find(candidate => candidate.graphId === a.graphs_id)?.first : null
  const bFirst = b ? candidates.find(candidate => candidate.graphId === b.graphs_id)?.first : null
  const deltaA = aFirst?.value != null && currentInitialA != null ? Number((aFirst.value - Number(currentInitialA)).toFixed(2)) : null
  const deltaB = bFirst?.value != null && currentInitialB != null ? Number((bFirst.value - Number(currentInitialB)).toFixed(2)) : null
  const comment = mappingReason && !a && !b
    ? `Needs mapping review: ${mappingReason}`
    : mappingReason
      ? `Needs data review: ${mappingReason}`
    : [deltaA, deltaB].some(delta => delta == null)
      ? 'Needs data review: one or both current initial values or first OPR samples were unavailable'
      : [classify(deltaA), classify(deltaB)].includes('Major difference')
        ? 'Major difference — review before changing initial values'
        : [classify(deltaA), classify(deltaB)].includes('Slight difference')
          ? 'Slight difference — review recommended'
          : 'Same — no change indicated'
  Object.assign(row, {
    currentInitialA,
    currentInitialB,
    currentLastDailyA: latestA?.rx ?? null,
    currentLastDailyAtA: latestA?.sampleTime ?? null,
    currentLastDailyB: latestB?.rx ?? null,
    currentLastDailyAtB: latestB?.sampleTime ?? null,
    graphAId: a?.graphs_id ?? null,
    graphALabel: a?.mnemonic ?? null,
    graphAFirstAt: aFirst?.at ?? null,
    graphAFirstValue: aFirst?.value ?? null,
    deltaA,
    classificationA: deltaA == null ? null : classify(deltaA),
    graphBId: b?.graphs_id ?? null,
    graphBLabel: b?.mnemonic ?? null,
    graphBFirstAt: bFirst?.at ?? null,
    graphBFirstValue: bFirst?.value ?? null,
    deltaB,
    classificationB: deltaB == null ? null : classify(deltaB),
    comment
  })
}

report.generatedAt = new Date().toISOString()
report.mapping = 'OPR graph device mapped to NLD endpoint; mnemonic represents the far end of the optical path.'
report.summary = {
  circuits: report.rows.length,
  mapped: report.rows.filter(row => row.graphAId && row.graphBId).length,
  review: report.rows.filter(row => row.comment.startsWith('Needs mapping review')).length,
  needsDataReview: report.rows.filter(row => row.comment.startsWith('Needs data review')).length
}
const columns = ['circuitId','nldGroup','nodeA','nodeB','currentInitialA','currentInitialB','currentLastDailyA','currentLastDailyAtA','currentLastDailyB','currentLastDailyAtB','graphAId','graphALabel','graphAFirstAt','graphAFirstValue','deltaA','classificationA','graphBId','graphBLabel','graphBFirstAt','graphBFirstValue','deltaB','classificationB','comment','candidates']
const csvText = [columns.join(','), ...report.rows.map(row => columns.map(column => csv(column === 'candidates' ? JSON.stringify(row.candidates) : row[column])).join(','))].join('\n')
await fs.writeFile(jsonPath, JSON.stringify(report, null, 2))
await fs.writeFile(csvPath, csvText)
console.log(`Remapped ${report.summary.mapped}/${report.summary.circuits} circuits using OPR source devices.`)
