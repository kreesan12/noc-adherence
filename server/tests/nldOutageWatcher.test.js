import assert from 'node:assert/strict'
import test from 'node:test'
import dayjs from 'dayjs'
import { buildDigestMsg, getDigestWindow } from '../nldOutageWatcher.js'

test('NLD digest summarizes live aging and recent closures without individual ticket links', () => {
  const message = buildDigestMsg({
    now: dayjs('2026-09-08T10:00:00Z'),
    config: {
      breachThresholdsHours: [4, 8, 12],
      digestMaxItems: 2,
      templates: {
        digestTitle: 'NLD operations position',
        resolvedTitle: 'NLD closures'
      }
    },
    openOutages: [
      { id: 101, nld: 'NLD 1', subscriberImpact: 45, ageMinutes: 320, ageHours: 5.3 },
      { id: 102, nld: 'NLD 2', subscriberImpact: 9, ageMinutes: 45, ageHours: 0.75 },
      { id: 103, nld: 'NLD 3', subscriberImpact: 3, ageMinutes: 90, ageHours: 1.5 }
    ],
    resolvedOutages: [
      { id: 104, nld: 'NLD 4', subscriberImpact: 12, totalHours: 2.25, updated_at: '2026-09-08T09:42:00Z' }
    ],
    backhaulOpen: [
      { id: 105, subject: 'Backhaul A', ageHours: 5, totalHours: 5, updated_at: '2026-09-08T09:45:00Z' }
    ],
    majorOutageOpen: [
      { id: 106, region: 'JHB', subscriberImpact: 22, ageHours: 3, totalHours: 3, updated_at: '2026-09-08T09:43:00Z' }
    ],
    backhaulResolved: [{ id: 107, totalHours: 1, updated_at: '2026-09-08T09:41:00Z' }],
    majorOutageResolved: [{ id: 108, totalHours: 2, updated_at: '2026-09-08T09:40:00Z' }],
    clusters: [{ routeKey: 'NLD 1' }],
    notLogged: [{ ticketId: 105 }]
  })

  assert.match(message, /NLD: 3 open \| 57 subs \| 1 over 4h/)
  assert.match(message, /Backhaul: 1 open \| 1 over 4h \| Major outage: 1 open \| 22 subs \| 0 over 4h/)
  assert.match(message, /All live aging: <1h 1 \| 1-2h 1 \| 2-4h 1 \| 4h\+ 2/)
  assert.match(message, /Partial pressure: 1 cluster \| 1 not logged/)
  assert.match(message, /NLD #101 \| NLD 1 \| 45 subs \| 5\.3h/)
  assert.match(message, /NLD closures since last digest: NLD 1 \| Backhaul 1 \| Major outage 1/)
  assert.doesNotMatch(message, /https:\/\//)
})

test('NLD digest window targets the fully completed interval', () => {
  const window = getDigestWindow(dayjs('2026-09-08T10:03:00Z'), 60)

  assert.equal(new Date(window.startMs).toISOString(), '2026-09-08T09:00:00.000Z')
  assert.equal(new Date(window.endMs).toISOString(), '2026-09-08T10:00:00.000Z')
})
