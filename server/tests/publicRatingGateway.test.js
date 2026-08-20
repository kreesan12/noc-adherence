import test from 'node:test'
import assert from 'node:assert/strict'
import request from 'supertest'

import { createApp } from '../app.js'
import { createMemoryPublicRatingGatewayRepo } from '../lib/publicRatingGateway.js'

const GATEWAY_TOKEN = 'test-gateway-token'

function buildApp(repo) {
  return createApp({
    includeBusinessRoutes: false,
    publicRatingGatewayRepo: repo,
    publicRatingGatewayToken: GATEWAY_TOKEN
  })
}

test('valid public submission enters the queue', async () => {
  const repo = createMemoryPublicRatingGatewayRepo()
  const app = buildApp(repo)

  const response = await request(app)
    .post('/rating/rt_valid_token_01')
    .type('form')
    .send({
      rating: '5',
      comment: 'Helpful technician.',
      customer_name: 'Customer name'
    })

  assert.equal(response.status, 200)
  assert.match(response.text, /Thank you\. Your feedback has been received\./)

  const rows = await repo.listPendingSubmissions(10)
  assert.equal(rows.length, 1)
  assert.equal(rows[0].ratingToken, 'rt_valid_token_01')
  assert.equal(rows[0].rating, 5)
  assert.equal(rows[0].comment, 'Helpful technician.')
  assert.equal(rows[0].customerName, 'Customer name')
  assert.equal(rows[0].status, 'PENDING')
})

test('invalid rating is rejected', async () => {
  const repo = createMemoryPublicRatingGatewayRepo()
  const app = buildApp(repo)

  const response = await request(app)
    .post('/rating/rt_valid_token_02')
    .type('form')
    .send({
      rating: '6',
      comment: 'Too high',
      customer_name: 'Customer name'
    })

  assert.equal(response.status, 400)
  assert.match(response.text, /Please select a rating between 1 and 5/i)

  const rows = await repo.listPendingSubmissions(10)
  assert.equal(rows.length, 0)
})

test('unauthenticated pending endpoint is rejected', async () => {
  const repo = createMemoryPublicRatingGatewayRepo()
  const app = buildApp(repo)

  const response = await request(app)
    .get('/api/integration/pending-ratings')

  assert.equal(response.status, 401)
  assert.deepEqual(response.body, { error: 'unauthorized' })
})

test('authenticated pending endpoint returns only pending records', async () => {
  const repo = createMemoryPublicRatingGatewayRepo([
    {
      submissionId: '11111111-1111-1111-1111-111111111111',
      ratingToken: 'rt_pending',
      rating: 4,
      comment: 'Pending row',
      customerName: 'Pending Customer',
      status: 'PENDING',
      submittedAt: new Date('2026-08-20T10:00:00Z'),
      acknowledgedAt: null,
      acknowledgementReason: null
    },
    {
      submissionId: '22222222-2222-2222-2222-222222222222',
      ratingToken: 'rt_done',
      rating: 2,
      comment: 'Handled row',
      customerName: 'Done Customer',
      status: 'ACCEPTED',
      submittedAt: new Date('2026-08-20T09:00:00Z'),
      acknowledgedAt: new Date('2026-08-20T09:15:00Z'),
      acknowledgementReason: null
    }
  ])
  const app = buildApp(repo)

  const response = await request(app)
    .get('/api/integration/pending-ratings?limit=25')
    .set('Authorization', `Bearer ${GATEWAY_TOKEN}`)

  assert.equal(response.status, 200)
  assert.equal(response.body.submissions.length, 1)
  assert.deepEqual(response.body.submissions[0], {
    submission_id: '11111111-1111-1111-1111-111111111111',
    rating_token: 'rt_pending',
    rating: 4,
    comment: 'Pending row',
    customer_name: 'Pending Customer',
    submitted_at: '2026-08-20T10:00:00.000Z'
  })
})

test('ack prevents a record being returned again and remains idempotent', async () => {
  const repo = createMemoryPublicRatingGatewayRepo([
    {
      submissionId: '33333333-3333-3333-3333-333333333333',
      ratingToken: 'rt_ack_me',
      rating: 5,
      comment: 'Great visit',
      customerName: 'Ack Customer',
      status: 'PENDING',
      submittedAt: new Date('2026-08-20T08:00:00Z'),
      acknowledgedAt: null,
      acknowledgementReason: null
    }
  ])
  const app = buildApp(repo)

  const ackResponse = await request(app)
    .post('/api/integration/rating-submissions/33333333-3333-3333-3333-333333333333/ack')
    .set('Authorization', `Bearer ${GATEWAY_TOKEN}`)
    .send({ status: 'ACCEPTED', reason: null })

  assert.equal(ackResponse.status, 200)
  assert.equal(ackResponse.body.submission.status, 'ACCEPTED')
  assert.ok(ackResponse.body.submission.acknowledged_at)

  const pendingResponse = await request(app)
    .get('/api/integration/pending-ratings?limit=25')
    .set('Authorization', `Bearer ${GATEWAY_TOKEN}`)

  assert.equal(pendingResponse.status, 200)
  assert.deepEqual(pendingResponse.body.submissions, [])

  const secondAckResponse = await request(app)
    .post('/api/integration/rating-submissions/33333333-3333-3333-3333-333333333333/ack')
    .set('Authorization', `Bearer ${GATEWAY_TOKEN}`)
    .send({ status: 'REJECTED', reason: 'Should not replace accepted state' })

  assert.equal(secondAckResponse.status, 200)
  assert.equal(secondAckResponse.body.submission.status, 'ACCEPTED')
})
