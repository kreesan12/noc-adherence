import { Router } from 'express'

import {
  PUBLIC_THANK_YOU_MESSAGE,
  applyPublicGatewaySecurityHeaders,
  buildAcknowledgementResponse,
  buildPendingSubmissionResponse,
  createPublicSubmissionRateLimiter,
  parseAcknowledgement,
  parsePublicSubmission,
  parseRatingToken,
  renderRatingFormPage,
  renderThankYouPage,
  renderUnavailablePage,
  safeCompareBearerToken
} from '../lib/publicRatingGateway.js'

const DEFAULT_PENDING_LIMIT = 25
const MAX_PENDING_LIMIT = 100
const INVALID_TOKEN_MESSAGE = 'This feedback page is not available.'
const RATE_LIMIT_MESSAGE = 'Please wait a moment before submitting feedback again.'
const INVALID_RATING_MESSAGE = 'Please select a rating between 1 and 5.'
const INVALID_SUBMISSION_MESSAGE = 'Unable to submit feedback. Please try again.'

function wantsJson(req) {
  const acceptHeader = String(req.get('accept') || '')
  return acceptHeader.includes('application/json') || req.is('application/json')
}

function clampPendingLimit(value) {
  const parsed = Number.parseInt(String(value ?? DEFAULT_PENDING_LIMIT), 10)
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_PENDING_LIMIT
  return Math.min(parsed, MAX_PENDING_LIMIT)
}

function renderPublicError(req, res, { statusCode, message, values = {} }) {
  if (wantsJson(req)) {
    res.status(statusCode).json({ error: message })
    return
  }

  if (statusCode === 404) {
    res.status(404).send(renderUnavailablePage(message))
    return
  }

  res.status(statusCode).send(renderRatingFormPage({ errorMessage: message, values }))
}

function getSubmissionValidationMessage(submissionResult) {
  const hasRatingIssue = submissionResult?.error?.issues?.some((issue) => issue?.path?.[0] === 'rating')
  return hasRatingIssue ? INVALID_RATING_MESSAGE : INVALID_SUBMISSION_MESSAGE
}

function validateIntegrationAuth(req, res, expectedToken) {
  if (!expectedToken) {
    res.status(503).json({ error: 'integration unavailable' })
    return false
  }

  if (!safeCompareBearerToken(req.headers.authorization, expectedToken)) {
    res.status(401).json({ error: 'unauthorized' })
    return false
  }

  return true
}

export default function publicRatingGatewayRoutes({
  repo,
  bearerToken,
  rateLimiter = createPublicSubmissionRateLimiter()
} = {}) {
  if (!repo) {
    throw new Error('public rating gateway repo is required')
  }

  const router = Router()
  router.use(applyPublicGatewaySecurityHeaders)

  router.get('/rating/:rating_token', (req, res) => {
    const tokenResult = parseRatingToken(req.params.rating_token)
    if (!tokenResult.success) {
      renderPublicError(req, res, {
        statusCode: 404,
        message: INVALID_TOKEN_MESSAGE
      })
      return
    }

    res.status(200).send(renderRatingFormPage())
  })

  router.post('/rating/:rating_token', async (req, res, next) => {
    const tokenResult = parseRatingToken(req.params.rating_token)
    if (!tokenResult.success) {
      renderPublicError(req, res, {
        statusCode: 404,
        message: INVALID_TOKEN_MESSAGE
      })
      return
    }

    const limiterOutcome = rateLimiter.consume({
      ip: req.ip || req.socket?.remoteAddress || 'unknown',
      ratingToken: tokenResult.data
    })

    if (!limiterOutcome.allowed) {
      res.setHeader('Retry-After', String(limiterOutcome.retryAfterSeconds))
      renderPublicError(req, res, {
        statusCode: 429,
        message: RATE_LIMIT_MESSAGE,
        values: {
          rating: req.body?.rating,
          comment: req.body?.comment,
          customerName: req.body?.customer_name
        }
      })
      return
    }

    const submissionResult = parsePublicSubmission(req.body)
    if (!submissionResult.success) {
      renderPublicError(req, res, {
        statusCode: 400,
        message: getSubmissionValidationMessage(submissionResult),
        values: {
          rating: req.body?.rating,
          comment: req.body?.comment,
          customerName: req.body?.customer_name
        }
      })
      return
    }

    try {
      await repo.enqueueSubmission({
        ratingToken: tokenResult.data,
        rating: submissionResult.data.rating,
        comment: submissionResult.data.comment,
        customerName: submissionResult.data.customerName
      })

      if (wantsJson(req)) {
        res.status(202).json({ message: PUBLIC_THANK_YOU_MESSAGE })
        return
      }

      res.status(200).send(renderThankYouPage())
    } catch (error) {
      next(error)
    }
  })

  router.get('/api/integration/pending-ratings', async (req, res, next) => {
    if (!validateIntegrationAuth(req, res, bearerToken)) return

    try {
      const limit = clampPendingLimit(req.query.limit)
      const rows = await repo.listPendingSubmissions(limit)
      res.status(200).json({
        submissions: rows.map(buildPendingSubmissionResponse)
      })
    } catch (error) {
      next(error)
    }
  })

  router.post('/api/integration/rating-submissions/:submissionId/ack', async (req, res, next) => {
    if (!validateIntegrationAuth(req, res, bearerToken)) return

    const ackResult = parseAcknowledgement(req.body)
    if (!ackResult.success) {
      res.status(400).json({ error: 'invalid request' })
      return
    }

    try {
      const row = await repo.acknowledgeSubmission(req.params.submissionId, ackResult.data)
      if (!row) {
        res.status(404).json({ error: 'not found' })
        return
      }

      res.status(200).json({
        submission: buildAcknowledgementResponse(row)
      })
    } catch (error) {
      next(error)
    }
  })

  return router
}
