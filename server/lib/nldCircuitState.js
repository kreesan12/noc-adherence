export const INITIAL_IMPORT_REASON = 'initial import'
export const INITIAL_OVERRIDE_SOURCE = 'initial-values-ui'

function toDateOrNull(value) {
  return value ? new Date(value) : null
}

function sortDatesDesc(values) {
  return values
    .filter(Boolean)
    .sort((a, b) => b.getTime() - a.getTime())
}

function deriveCircuitDisplayRow(circuit) {
  const baselineHistory = Array.isArray(circuit.levelHistory) ? circuit.levelHistory : []
  const initialImport = baselineHistory.find((h) => h.reason === INITIAL_IMPORT_REASON) ?? null
  const initialOverride = [...baselineHistory]
    .reverse()
    .find((h) => h.source === INITIAL_OVERRIDE_SOURCE) ?? null

  const effectiveInitial = (initialImport || initialOverride)
    ? {
        rxSiteA: initialOverride?.rxSiteA ?? initialImport?.rxSiteA ?? null,
        rxSiteB: initialOverride?.rxSiteB ?? initialImport?.rxSiteB ?? null,
        changedAt: initialOverride?.changedAt ?? initialImport?.changedAt ?? null,
        reason: initialOverride?.reason ?? initialImport?.reason ?? null,
        source: initialOverride?.source ?? initialImport?.source ?? null,
      }
    : null

  const latestEventAt = circuit.lightEvents?.[0]?.eventDate ?? null
  let lastEventAt = latestEventAt

  if (initialImport?.changedAt && latestEventAt) {
    const initTs = new Date(initialImport.changedAt).getTime()
    const eventTs = new Date(latestEventAt).getTime()
    if (!(eventTs > initTs)) lastEventAt = null
  }

  const dailies = Array.isArray(circuit.dailyLevels) ? circuit.dailyLevels : []
  const latestDailyAt = dailies.length
    ? sortDatesDesc(dailies.map((d) => toDateOrNull(d.sampleTime)))[0]
    : null

  const latestA = dailies
    .filter((d) => String(d.side || '').toUpperCase() === 'A')
    .sort((a, b) => new Date(b.sampleTime).getTime() - new Date(a.sampleTime).getTime())[0] ?? null
  const latestB = dailies
    .filter((d) => String(d.side || '').toUpperCase() === 'B')
    .sort((a, b) => new Date(b.sampleTime).getTime() - new Date(a.sampleTime).getTime())[0] ?? null

  const lastEventDate = toDateOrNull(lastEventAt)
  const initialDate = toDateOrNull(effectiveInitial?.changedAt)
  const sideNewerThanEvent = (sideDaily) =>
    sideDaily && (!lastEventDate || new Date(sideDaily.sampleTime).getTime() > lastEventDate.getTime())

  const useDailyA = sideNewerThanEvent(latestA)
  const useDailyB = sideNewerThanEvent(latestB)

  const displayRxA = useDailyA ? (latestA?.rx ?? circuit.currentRxSiteA ?? null) : (circuit.currentRxSiteA ?? null)
  const displayRxB = useDailyB ? (latestB?.rx ?? circuit.currentRxSiteB ?? null) : (circuit.currentRxSiteB ?? null)
  const displaySourceA = useDailyA ? 'daily' : (lastEventDate ? 'event' : 'initial')
  const displaySourceB = useDailyB ? 'daily' : (lastEventDate ? 'event' : 'initial')

  const sideATime = useDailyA ? toDateOrNull(latestA?.sampleTime) : (lastEventDate ?? initialDate ?? null)
  const sideBTime = useDailyB ? toDateOrNull(latestB?.sampleTime) : (lastEventDate ?? initialDate ?? null)
  const displayAsOf = sortDatesDesc([
    sideATime,
    sideBTime,
    latestDailyAt,
    lastEventDate,
    initialDate
  ])[0]?.toISOString() ?? null

  const { levelHistory, lightEvents, ...rest } = circuit

  return {
    ...rest,
    initRxSiteA: effectiveInitial?.rxSiteA ?? null,
    initRxSiteB: effectiveInitial?.rxSiteB ?? null,
    initial: effectiveInitial,
    initialImport,
    initialOverride,
    lastEventAt,
    displayRxA,
    displayRxB,
    displayAsOf,
    displaySourceA,
    displaySourceB
  }
}

export async function loadCircuitMonitoringRows(prisma) {
  const circuits = await prisma.circuit.findMany({
    select: {
      id: true,
      circuitId: true,
      nodeA: true,
      nodeB: true,
      techType: true,
      currentRxSiteA: true,
      currentRxSiteB: true,
      updatedAt: true,
      nldGroup: true,
      nodeALat: true,
      nodeALon: true,
      nodeBLat: true,
      nodeBLon: true,
      _count: {
        select: {
          levelHistory: {
            where: { reason: { not: INITIAL_IMPORT_REASON } }
          }
        }
      },
      levelHistory: {
        where: {
          OR: [
            { reason: INITIAL_IMPORT_REASON },
            { source: INITIAL_OVERRIDE_SOURCE }
          ]
        },
        orderBy: { changedAt: 'asc' },
        select: {
          rxSiteA: true,
          rxSiteB: true,
          changedAt: true,
          reason: true,
          source: true,
        }
      },
      lightEvents: {
        select: { eventDate: true },
        orderBy: { eventDate: 'desc' },
        take: 1
      },
      dailyLevels: {
        select: { sampleTime: true, side: true, rx: true },
        orderBy: { sampleTime: 'desc' },
        take: 20
      }
    },
    orderBy: [{ nldGroup: 'asc' }, { circuitId: 'asc' }]
  })

  return circuits.map(deriveCircuitDisplayRow)
}
