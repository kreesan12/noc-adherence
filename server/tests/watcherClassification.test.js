import assert from 'node:assert/strict'
import test from 'node:test'
import { isStandaloneBackhaulTicket } from '../backhaulWatcher.js'
import { isMajorOutageTicket } from '../majorOutageWatcher.js'

test('formal outage with a backhaul correlation tag stays in the major-outage lane', () => {
  const ticket = {
    subject: 'Outage | JHB | Vereeniging Node | DOWN',
    tags: ['iris_backhaul_down', 'outage_new_internal', 'outage_update']
  }

  assert.equal(isMajorOutageTicket(ticket), true)
  assert.equal(isStandaloneBackhaulTicket(ticket), false)
})

test('ordinary NLD and standalone backhaul tickets remain separated', () => {
  assert.equal(isMajorOutageTicket({ subject: 'NLD | CPT | Route Down', tags: [] }), false)
  assert.equal(isStandaloneBackhaulTicket({ subject: 'Backhaul down', tags: ['iris_backhaul_down'] }), true)
})

test('backhaul watcher excludes flap and intermittent ticket subjects', () => {
  assert.equal(isStandaloneBackhaulTicket({ subject: 'Backhaul FLAP at JHB', tags: ['iris_backhaul_down'] }), false)
  assert.equal(isStandaloneBackhaulTicket({ subject: 'CPT backhaul intermittent loss', tags: ['iris_backhaul_down'] }), false)
  assert.equal(isStandaloneBackhaulTicket({ subject: 'Backhaul down', tags: ['iris_backhaul_down'] }), true)
})
