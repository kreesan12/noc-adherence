import { spawnSync } from 'node:child_process'

const args = parseArgs(process.argv.slice(2))

const pem = requireArg(args, 'pem')
const host = String(args.host || '154.65.108.106').trim()
const user = String(args.user || 'ubuntu').trim()
const baseUrl = String(args.baseUrl || 'https://154-65-108-106.sslip.io').replace(/\/+$/, '')
const route = String(args.route || '/noc-monitoring').trim()
const expectText = String(args.expectText || 'NOC Monitoring Hub').trim()
const role = String(args.role || 'admin').trim()
const name = String(args.name || 'Release Smoke').trim()
const waitMs = String(args.waitMs || '4000').trim()
const historyHours = String(args.historyHours || '72').trim()
const remoteAppPath = String(args.remoteAppPath || '/home/ubuntu/apps/noc-adherence/server').trim()
const skipRefresh = Boolean(args.skipRefresh)

const tokenCommand = [
  'cd',
  shellQuote(remoteAppPath),
  '&&',
  'node',
  'scripts/issueSmokeToken.js',
  '--role',
  shellQuote(role),
  '--name',
  shellQuote(name)
].join(' ')

const sshBaseArgs = ['-i', pem, `${user}@${host}`]

logStep(`Issuing short-lived smoke token on ${host}`)
const tokenResult = run('ssh', [...sshBaseArgs, tokenCommand], { captureOutput: true })
const authToken = tokenResult.stdout.trim()

if (!authToken) {
  fail('Token helper returned no token.')
}

if (!skipRefresh) {
  logStep(`Refreshing ${route} snapshot via ${baseUrl}`)
  const refreshUrl = `${baseUrl}/api/noc-monitoring/refresh?historyHours=${encodeURIComponent(historyHours)}`
  const response = await fetch(refreshUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${authToken}`
    }
  })

  if (!response.ok) {
    const body = await response.text()
    fail(`Snapshot refresh failed with ${response.status}: ${body}`)
  }
}

logStep(`Running authenticated browser smoke for ${route}`)
run('node', [
  'frontend/scripts/browser-smoke-check.mjs',
  '--url',
  `${baseUrl}/`,
  '--route',
  route,
  '--authToken',
  authToken,
  '--expectText',
  expectText,
  '--waitMs',
  waitMs
])

process.stdout.write('\nRelease refresh + smoke completed successfully.\n')

function parseArgs(argv) {
  const parsed = {}

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (!token.startsWith('--')) continue

    const key = token.slice(2)
    const next = argv[index + 1]
    if (!next || next.startsWith('--')) {
      parsed[key] = true
      continue
    }

    parsed[key] = next
    index += 1
  }

  return parsed
}

function requireArg(parsed, key) {
  const value = parsed[key]
  if (!value) {
    fail(`Missing required --${key} argument.`)
  }
  return String(value).trim()
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`
}

function logStep(message) {
  process.stdout.write(`\n[ops-hub] ${message}\n`)
}

function run(command, commandArgs, { captureOutput = false, shell = false } = {}) {
  const result = spawnSync(command, commandArgs, {
    cwd: process.cwd(),
    encoding: 'utf8',
    stdio: captureOutput ? ['inherit', 'pipe', 'pipe'] : 'inherit',
    shell
  })

  if (result.status !== 0) {
    if (captureOutput) {
      if (result.stdout) process.stdout.write(result.stdout)
      if (result.stderr) process.stderr.write(result.stderr)
    }
    fail(`${command} exited with code ${result.status ?? 'unknown'}.`)
  }

  return result
}

function fail(message) {
  process.stderr.write(`${message}\n`)
  process.exit(1)
}
