[CmdletBinding()]
param(
  [string]$CutoffDate = '2025-01-01',
  [string]$HerokuApp = 'noc-adherence-api',
  [string]$HerokuCliPath = 'C:\Program Files\Heroku\bin\heroku.cmd',
  [string]$PsqlBinPath = 'C:\Program Files\PostgreSQL\17\bin',
  [switch]$Apply
)

$ErrorActionPreference = 'Stop'

function Write-Step {
  param([string]$Message)
  Write-Host "==> $Message"
}

function Ensure-Command {
  param(
    [string]$CommandName,
    [string]$Hint
  )
  if (-not (Get-Command $CommandName -ErrorAction SilentlyContinue)) {
    throw "$CommandName is not available. $Hint"
  }
}

try {
  $cutoff = [datetime]::ParseExact($CutoffDate, 'yyyy-MM-dd', $null)
} catch {
  throw "CutoffDate must be YYYY-MM-DD, e.g. 2025-01-01"
}

if (-not (Test-Path -LiteralPath $HerokuCliPath)) {
  throw "Heroku CLI not found at $HerokuCliPath"
}

if (Test-Path -LiteralPath (Join-Path $PsqlBinPath 'psql.exe')) {
  $env:PATH = "$PsqlBinPath;$env:PATH"
}
Ensure-Command -CommandName 'psql' -Hint 'Install PostgreSQL client tools so psql is available.'

$repoRoot = Split-Path -Parent $PSScriptRoot
$sqlPath = Join-Path $repoRoot 'scripts\sql\run-data-retention.sql'
if (-not (Test-Path -LiteralPath $sqlPath)) {
  throw "SQL file not found: $sqlPath"
}

$env:HEROKU_DATA_DIR = Join-Path $repoRoot '.heroku'
$env:HEROKU_CACHE_DIR = Join-Path $env:HEROKU_DATA_DIR 'cache'
New-Item -ItemType Directory -Force $env:HEROKU_CACHE_DIR | Out-Null

Remove-Item Env:HTTP_PROXY -ErrorAction SilentlyContinue
Remove-Item Env:HTTPS_PROXY -ErrorAction SilentlyContinue
Remove-Item Env:ALL_PROXY -ErrorAction SilentlyContinue
Remove-Item Env:GIT_HTTP_PROXY -ErrorAction SilentlyContinue
Remove-Item Env:GIT_HTTPS_PROXY -ErrorAction SilentlyContinue

$cutoffMonth = $cutoff.ToString('yyyy-MM')

Write-Step "Retention cutoff date: $CutoffDate"
Write-Step "Retention cutoff month key: $cutoffMonth"
Write-Step 'solidbase is excluded from this cleanup'

Write-Step "Checking Heroku auth for app '$HerokuApp'"
& $HerokuCliPath auth:whoami | Out-Null
if ($LASTEXITCODE -ne 0) {
  throw 'Heroku auth failed. Run: heroku login'
}

$dbUrl = (& $HerokuCliPath config:get DATABASE_URL -a $HerokuApp | Out-String).Trim()
if (-not $dbUrl) {
  throw "DATABASE_URL not found in Heroku config for app '$HerokuApp'"
}

$previewSql = @"
WITH row_counts AS (
  SELECT 'servicelevels' AS table_name, COUNT(*)::bigint AS row_count
  FROM servicelevels
  WHERE year_month < '$cutoffMonth'

  UNION ALL

  SELECT 'reporting' AS table_name, COUNT(*)::bigint AS row_count
  FROM reporting
  WHERE year_month < '$cutoffMonth'

  UNION ALL

  SELECT 'isp_table' AS table_name, COUNT(*)::bigint AS row_count
  FROM isp_table
  WHERE year_month < '$cutoffMonth'

  UNION ALL

  SELECT 'sip_table' AS table_name, COUNT(*)::bigint AS row_count
  FROM sip_table
  WHERE sip_month < '$cutoffMonth'

  UNION ALL

  SELECT 'tickets_output' AS table_name, COUNT(*)::bigint AS row_count
  FROM tickets_output
  WHERE COALESCE(impact_stop_time, created_date) < '$CutoffDate'::timestamp

  UNION ALL

  SELECT 'zendesktickets' AS table_name, COUNT(*)::bigint AS row_count
  FROM zendesktickets
  WHERE COALESCE(stoptime, ticketcreated) < '$CutoffDate'::timestamp

  UNION ALL

  SELECT 'outage_resolvers' AS table_name, COUNT(*)::bigint AS row_count
  FROM outage_resolvers
  WHERE year_month < '$cutoffMonth'

  UNION ALL

  SELECT 'outages_outage' AS table_name, COUNT(*)::bigint AS row_count
  FROM outages_outage
  WHERE COALESCE(impact_stop, impact_start) < '$CutoffDate'::timestamp

  UNION ALL

  SELECT 'outagezendeskrefs2' AS table_name, COUNT(*)::bigint AS row_count
  FROM outagezendeskrefs2
  WHERE COALESCE(impact_stop, impact_start) < '$CutoffDate'::timestamp
)
SELECT table_name, row_count
FROM row_counts
ORDER BY table_name;
"@

Write-Step 'Previewing rows eligible for cleanup'
& psql "$dbUrl" `
  -v ON_ERROR_STOP=1 `
  -v cutoff_date="$CutoffDate" `
  -v cutoff_month="$cutoffMonth" `
  -P pager=off `
  -c "$previewSql"

if ($LASTEXITCODE -ne 0) {
  throw 'Retention preview failed'
}

if (-not $Apply) {
  Write-Step 'Preview only. Re-run with -Apply to delete eligible rows.'
  exit 0
}

Write-Step "Deleting rows older than $CutoffDate"
& psql "$dbUrl" `
  -v ON_ERROR_STOP=1 `
  -v cutoff_date="$CutoffDate" `
  -v cutoff_month="$cutoffMonth" `
  -f "$sqlPath"

if ($LASTEXITCODE -ne 0) {
  throw 'Retention delete failed'
}

Write-Step 'Post-delete preview'
& psql "$dbUrl" `
  -v ON_ERROR_STOP=1 `
  -v cutoff_date="$CutoffDate" `
  -v cutoff_month="$cutoffMonth" `
  -P pager=off `
  -c "$previewSql"

if ($LASTEXITCODE -ne 0) {
  throw 'Post-delete preview failed'
}

Write-Step 'Retention cleanup completed successfully'
