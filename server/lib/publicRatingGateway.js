import crypto from 'crypto'
import { randomUUID } from 'crypto'
import { z } from 'zod'

const MAX_COMMENT_LENGTH = 1000
const MAX_CUSTOMER_NAME_LENGTH = 120
const MAX_REASON_LENGTH = 1000
const MAX_RATING_TOKEN_LENGTH = 255
const PUBLIC_THANK_YOU_MESSAGE = 'Thank you. Your feedback has been received.'
const PUBLIC_FORM_TITLE = 'Rate Your Technician Visit'
const PENDING_STATUSES = new Set(['PENDING'])
const PUBLIC_SUBMISSION_WINDOW_MS = 15 * 60 * 1000
const MAX_PER_IP_WINDOW = 20
const MAX_PER_TOKEN_IP_WINDOW = 3

const ratingTokenSchema = z
  .string()
  .trim()
  .min(1)
  .max(MAX_RATING_TOKEN_LENGTH)
  .regex(/^[A-Za-z0-9._~-]+$/)

const publicSubmissionSchema = z.object({
  rating: z.coerce.number().int().min(1).max(5),
  comment: z.preprocess((value) => normalizeOptionalText(value, MAX_COMMENT_LENGTH), z.string().max(MAX_COMMENT_LENGTH).nullable()),
  customer_name: z.preprocess((value) => normalizeOptionalText(value, MAX_CUSTOMER_NAME_LENGTH), z.string().max(MAX_CUSTOMER_NAME_LENGTH).nullable())
})

const publicSubmissionAliasSchema = z.object({
  rating: z.coerce.number().int().min(1).max(5),
  comment: z.preprocess((value) => normalizeOptionalText(value, MAX_COMMENT_LENGTH), z.string().max(MAX_COMMENT_LENGTH).nullable()),
  customerName: z.preprocess((value) => normalizeOptionalText(value, MAX_CUSTOMER_NAME_LENGTH), z.string().max(MAX_CUSTOMER_NAME_LENGTH).nullable())
})

const acknowledgementSchema = z
  .object({
    status: z.enum(['ACCEPTED', 'REJECTED']),
    reason: z.preprocess((value) => normalizeOptionalText(value, MAX_REASON_LENGTH), z.string().max(MAX_REASON_LENGTH).nullable())
  })
  .superRefine((value, ctx) => {
    if (value.status === 'REJECTED' && !value.reason) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['reason'],
        message: 'reason is required when rejecting a submission'
      })
    }
  })

function normalizeOptionalText(value, maxLength) {
  if (value === null || value === undefined) return null
  const trimmed = String(value).trim()
  if (!trimmed) return null
  return trimmed
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function buildStarControls(selectedRating) {
  return [5, 4, 3, 2, 1]
    .map((value) => {
      const checked = Number(selectedRating) === value ? 'checked' : ''
      return `
        <input type="radio" id="rating-${value}" name="rating" value="${value}" ${checked} required />
        <label for="rating-${value}" aria-label="${value} star${value === 1 ? '' : 's'}">&#9733;</label>
      `
    })
    .join('')
}

function basePageShell({ body, title = PUBLIC_FORM_TITLE, cacheControl = 'no-store' }) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta http-equiv="Cache-Control" content="${cacheControl}" />
  <title>${escapeHtml(title)}</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f4f7fb;
      --card: #ffffff;
      --text: #163045;
      --muted: #5f7385;
      --line: #d6e1eb;
      --accent: #0f766e;
      --accent-dark: #0b5f59;
      --accent-soft: #d9f2ef;
      --danger-soft: #fff1f2;
      --danger-line: #fda4af;
      --shadow: 0 18px 45px rgba(15, 23, 42, 0.12);
      font-family: "Segoe UI", Tahoma, Geneva, Verdana, sans-serif;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      background:
        radial-gradient(circle at top left, rgba(15,118,110,0.16), transparent 30%),
        radial-gradient(circle at top right, rgba(59,130,246,0.12), transparent 28%),
        linear-gradient(180deg, #f8fbff 0%, var(--bg) 100%);
      color: var(--text);
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px 16px;
    }
    .card {
      width: min(100%, 420px);
      background: var(--card);
      border: 1px solid rgba(214,225,235,0.9);
      border-radius: 14px;
      box-shadow: var(--shadow);
      overflow: hidden;
    }
    .card__header {
      padding: 22px 22px 14px;
      border-bottom: 1px solid rgba(214,225,235,0.75);
      background: linear-gradient(180deg, rgba(15,118,110,0.06), rgba(15,118,110,0));
    }
    .eyebrow {
      margin: 0 0 8px;
      color: var(--accent);
      font-size: 0.76rem;
      font-weight: 700;
      letter-spacing: 0.06em;
      text-transform: uppercase;
    }
    h1 {
      margin: 0;
      font-size: clamp(1.55rem, 4vw, 1.95rem);
      line-height: 1.08;
    }
    .intro {
      margin: 10px 0 0;
      font-size: 0.96rem;
      line-height: 1.45;
      color: var(--muted);
    }
    .card__body {
      padding: 22px;
    }
    .field {
      margin-bottom: 18px;
    }
    .field:last-child {
      margin-bottom: 0;
    }
    .label {
      display: block;
      margin-bottom: 8px;
      font-size: 0.93rem;
      font-weight: 600;
    }
    .hint {
      margin-top: 7px;
      color: var(--muted);
      font-size: 0.8rem;
    }
    textarea,
    input[type="text"] {
      width: 100%;
      border: 1px solid var(--line);
      border-radius: 10px;
      padding: 12px 13px;
      font: inherit;
      color: inherit;
      background: #fbfdff;
      transition: border-color 0.15s ease, box-shadow 0.15s ease;
    }
    textarea:focus,
    input[type="text"]:focus {
      outline: none;
      border-color: rgba(15,118,110,0.6);
      box-shadow: 0 0 0 4px rgba(15,118,110,0.12);
      background: #ffffff;
    }
    textarea {
      min-height: 118px;
      resize: vertical;
    }
    .stars {
      display: flex;
      flex-direction: row-reverse;
      justify-content: flex-end;
      gap: 8px;
    }
    .stars input {
      position: absolute;
      opacity: 0;
      pointer-events: none;
    }
    .stars label {
      font-size: 2.2rem;
      line-height: 1;
      color: #cbd5e1;
      cursor: pointer;
      transition: transform 0.12s ease, color 0.12s ease;
      user-select: none;
    }
    .stars label:hover,
    .stars label:hover ~ label,
    .stars input:checked ~ label {
      color: #f59e0b;
    }
    .stars label:hover { transform: scale(1.05); }
    .actions {
      margin-top: 24px;
    }
    .submit {
      width: 100%;
      border: 0;
      border-radius: 10px;
      padding: 13px 16px;
      font: inherit;
      font-weight: 700;
      color: #ffffff;
      background: linear-gradient(135deg, var(--accent), #155e75);
      cursor: pointer;
      transition: transform 0.12s ease, box-shadow 0.12s ease, opacity 0.12s ease;
      box-shadow: 0 12px 25px rgba(15,118,110,0.22);
    }
    .submit:hover { transform: translateY(-1px); }
    .submit:disabled {
      opacity: 0.65;
      cursor: wait;
      transform: none;
      box-shadow: none;
    }
    .alert {
      margin-bottom: 18px;
      padding: 12px 14px;
      border-radius: 10px;
      border: 1px solid var(--danger-line);
      background: var(--danger-soft);
      color: #991b1b;
      font-size: 0.92rem;
      line-height: 1.4;
    }
    .thank-you {
      padding: 28px 22px 26px;
    }
    .thank-you__icon {
      width: 52px;
      height: 52px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border-radius: 999px;
      background: var(--accent-soft);
      color: var(--accent);
      font-size: 1.5rem;
      font-weight: 700;
      margin-bottom: 14px;
    }
    .thank-you p {
      margin: 0;
      line-height: 1.55;
      color: var(--muted);
    }
    @media (max-width: 480px) {
      body { padding: 14px; }
      .card__header,
      .card__body,
      .thank-you { padding-left: 18px; padding-right: 18px; }
      .stars label { font-size: 2rem; }
    }
  </style>
</head>
<body>
  ${body}
</body>
</html>`
}

export function renderRatingFormPage({ errorMessage = '', values = {} } = {}) {
  const ratingValue = Number(values.rating) || null
  const commentValue = values.comment ? escapeHtml(values.comment) : ''
  const customerNameValue = values.customerName ? escapeHtml(values.customerName) : ''
  const errorBlock = errorMessage ? `<div class="alert" role="alert">${escapeHtml(errorMessage)}</div>` : ''

  return basePageShell({
    body: `
      <main class="card" aria-labelledby="rating-title">
        <section class="card__header">
          <p class="eyebrow">Customer feedback</p>
          <h1 id="rating-title">${PUBLIC_FORM_TITLE}</h1>
          <p class="intro">Please rate your technician visit. Your feedback helps us improve our service.</p>
        </section>
        <section class="card__body">
          ${errorBlock}
          <form method="post" novalidate>
            <div class="field">
              <span class="label">Rating</span>
              <div class="stars" role="radiogroup" aria-label="Technician visit rating">
                ${buildStarControls(ratingValue)}
              </div>
            </div>
            <div class="field">
              <label class="label" for="comment">Comment (optional)</label>
              <textarea id="comment" name="comment" maxlength="${MAX_COMMENT_LENGTH}" placeholder="Share anything you would like us to know.">${commentValue}</textarea>
              <div class="hint">Maximum ${MAX_COMMENT_LENGTH} characters.</div>
            </div>
            <div class="field">
              <label class="label" for="customer_name">Customer name (optional)</label>
              <input id="customer_name" name="customer_name" type="text" maxlength="${MAX_CUSTOMER_NAME_LENGTH}" autocomplete="name" value="${customerNameValue}" placeholder="Your name" />
              <div class="hint">Maximum ${MAX_CUSTOMER_NAME_LENGTH} characters.</div>
            </div>
            <div class="actions">
              <button class="submit" type="submit" data-submit-button>Submit</button>
            </div>
          </form>
        </section>
      </main>
      <script>
        (() => {
          const form = document.querySelector('form')
          const submitButton = document.querySelector('[data-submit-button]')
          if (!form || !submitButton) return
          form.addEventListener('submit', () => {
            submitButton.disabled = true
            submitButton.textContent = 'Submitting...'
            submitButton.setAttribute('aria-busy', 'true')
          }, { once: true })
        })()
      </script>
    `
  })
}

export function renderThankYouPage() {
  return basePageShell({
    body: `
      <main class="card" aria-labelledby="rating-title">
        <section class="card__header">
          <p class="eyebrow">Customer feedback</p>
          <h1 id="rating-title">${PUBLIC_FORM_TITLE}</h1>
        </section>
        <section class="thank-you">
          <div class="thank-you__icon" aria-hidden="true">&#10003;</div>
          <p>${PUBLIC_THANK_YOU_MESSAGE}</p>
        </section>
      </main>
    `
  })
}

export function renderUnavailablePage(message = 'This feedback page is not available.') {
  return basePageShell({
    title: 'Feedback unavailable',
    body: `
      <main class="card" aria-labelledby="feedback-unavailable-title">
        <section class="card__header">
          <p class="eyebrow">Customer feedback</p>
          <h1 id="feedback-unavailable-title">Feedback unavailable</h1>
          <p class="intro">${escapeHtml(message)}</p>
        </section>
      </main>
    `
  })
}

export function parseRatingToken(value) {
  return ratingTokenSchema.safeParse(value)
}

export function parsePublicSubmission(input) {
  const candidate = typeof input?.customer_name !== 'undefined'
    ? publicSubmissionSchema.safeParse(input)
    : publicSubmissionAliasSchema.safeParse(input)

  if (!candidate.success) return candidate

  const data = candidate.data
  return {
    success: true,
    data: {
      rating: data.rating,
      comment: data.comment ?? null,
      customerName: data.customer_name ?? data.customerName ?? null
    }
  }
}

export function parseAcknowledgement(input) {
  return acknowledgementSchema.safeParse(input)
}

export function safeCompareBearerToken(headerValue, expectedToken) {
  if (!expectedToken) return false
  const actual = extractBearerToken(headerValue)
  if (!actual) return false

  const actualBuffer = Buffer.from(actual, 'utf8')
  const expectedBuffer = Buffer.from(expectedToken, 'utf8')
  const maxLength = Math.max(actualBuffer.length, expectedBuffer.length, 1)
  const paddedActual = Buffer.alloc(maxLength)
  const paddedExpected = Buffer.alloc(maxLength)
  actualBuffer.copy(paddedActual)
  expectedBuffer.copy(paddedExpected)
  const matches = crypto.timingSafeEqual(paddedActual, paddedExpected)
  return matches && actualBuffer.length === expectedBuffer.length
}

function extractBearerToken(headerValue) {
  if (!headerValue) return null
  const match = String(headerValue).match(/^Bearer\s+(.+)$/i)
  return match?.[1]?.trim() || null
}

export function sanitizePathForLogs(value) {
  const [pathOnly] = String(value || '').split('?')
  if (pathOnly.startsWith('/rating/')) return '/rating/:rating_token'
  return pathOnly || '/'
}

export function applyPublicGatewaySecurityHeaders(req, res, next) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate')
  res.setHeader('Pragma', 'no-cache')
  res.setHeader('Expires', '0')
  res.setHeader('Referrer-Policy', 'no-referrer')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('X-Frame-Options', 'DENY')
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin')
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin')
  res.setHeader('Content-Security-Policy', "default-src 'none'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; connect-src 'self'; img-src 'self' data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'")

  const forwardedProto = String(req.headers['x-forwarded-proto'] || '')
  if (req.secure || forwardedProto.includes('https')) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
  }

  next()
}

export function createPublicSubmissionRateLimiter({
  windowMs = PUBLIC_SUBMISSION_WINDOW_MS,
  maxPerIpWindow = MAX_PER_IP_WINDOW,
  maxPerTokenIpWindow = MAX_PER_TOKEN_IP_WINDOW
} = {}) {
  const counters = new Map()

  function keyFor(kind, parts) {
    const digest = crypto.createHash('sha256')
    digest.update(kind)
    for (const part of parts) {
      digest.update(':')
      digest.update(String(part || ''))
    }
    return `${kind}:${digest.digest('hex')}`
  }

  function cleanup(now) {
    for (const [key, bucket] of counters.entries()) {
      bucket.timestamps = bucket.timestamps.filter((stamp) => now - stamp < windowMs)
      if (bucket.timestamps.length === 0) counters.delete(key)
    }
  }

  return {
    consume({ ip, ratingToken, now = Date.now() }) {
      cleanup(now)

      const ipKey = keyFor('ip', [ip])
      const tokenIpKey = keyFor('token-ip', [ip, ratingToken])
      const keys = [
        { key: ipKey, limit: maxPerIpWindow },
        { key: tokenIpKey, limit: maxPerTokenIpWindow }
      ]

      for (const entry of keys) {
        const bucket = counters.get(entry.key) || { timestamps: [] }
        if (bucket.timestamps.length >= entry.limit) {
          const retryAt = bucket.timestamps[0] + windowMs
          return {
            allowed: false,
            retryAfterSeconds: Math.max(1, Math.ceil((retryAt - now) / 1000))
          }
        }
      }

      for (const entry of keys) {
        const bucket = counters.get(entry.key) || { timestamps: [] }
        bucket.timestamps.push(now)
        counters.set(entry.key, bucket)
      }

      return { allowed: true, retryAfterSeconds: 0 }
    }
  }
}

export function buildPendingSubmissionResponse(row) {
  return {
    submission_id: row.submissionId,
    rating_token: row.ratingToken,
    rating: row.rating,
    comment: row.comment,
    customer_name: row.customerName,
    submitted_at: row.submittedAt instanceof Date ? row.submittedAt.toISOString() : new Date(row.submittedAt).toISOString()
  }
}

export function buildAcknowledgementResponse(row) {
  return {
    submission_id: row.submissionId,
    status: row.status,
    acknowledged_at: row.acknowledgedAt ? new Date(row.acknowledgedAt).toISOString() : null,
    acknowledgement_reason: row.acknowledgementReason ?? null
  }
}

export function createPrismaPublicRatingGatewayRepo(prisma) {
  return {
    async enqueueSubmission({ ratingToken, rating, comment, customerName }) {
      return prisma.publicRatingSubmission.create({
        data: {
          ratingToken,
          rating,
          comment,
          customerName,
          status: 'PENDING'
        }
      })
    },

    async listPendingSubmissions(limit) {
      return prisma.publicRatingSubmission.findMany({
        where: { status: 'PENDING' },
        orderBy: { submittedAt: 'asc' },
        take: limit
      })
    },

    async acknowledgeSubmission(submissionId, { status, reason }) {
      const update = await prisma.publicRatingSubmission.updateMany({
        where: {
          submissionId,
          status: 'PENDING'
        },
        data: {
          status,
          acknowledgedAt: new Date(),
          acknowledgementReason: reason ?? null
        }
      })

      if (update.count === 0) {
        return prisma.publicRatingSubmission.findUnique({ where: { submissionId } })
      }

      return prisma.publicRatingSubmission.findUnique({ where: { submissionId } })
    }
  }
}

export function createMemoryPublicRatingGatewayRepo(seedRows = []) {
  const rows = [...seedRows].map((row) => ({ ...row }))

  return {
    async enqueueSubmission({ ratingToken, rating, comment, customerName }) {
      const row = {
        submissionId: randomUUID(),
        ratingToken,
        rating,
        comment: comment ?? null,
        customerName: customerName ?? null,
        status: 'PENDING',
        submittedAt: new Date(),
        acknowledgedAt: null,
        acknowledgementReason: null
      }
      rows.push(row)
      return { ...row }
    },

    async listPendingSubmissions(limit) {
      return rows
        .filter((row) => PENDING_STATUSES.has(row.status))
        .sort((a, b) => new Date(a.submittedAt).getTime() - new Date(b.submittedAt).getTime())
        .slice(0, limit)
        .map((row) => ({ ...row }))
    },

    async acknowledgeSubmission(submissionId, { status, reason }) {
      const row = rows.find((entry) => entry.submissionId === submissionId)
      if (!row) return null
      if (row.status !== 'PENDING') return { ...row }
      row.status = status
      row.acknowledgedAt = new Date()
      row.acknowledgementReason = reason ?? null
      return { ...row }
    },

    dump() {
      return rows.map((row) => ({ ...row }))
    }
  }
}

export { PUBLIC_FORM_TITLE, PUBLIC_THANK_YOU_MESSAGE, MAX_COMMENT_LENGTH, MAX_CUSTOMER_NAME_LENGTH }
