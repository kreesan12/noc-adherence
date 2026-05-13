[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$MonthKey, # YYYY-MM

  [string]$HerokuApp = 'noc-adherence-api',
  [string]$HerokuCliPath = 'C:\Program Files\Heroku\bin\heroku.cmd',
  [string]$PsqlBinPath = 'C:\Program Files\PostgreSQL\17\bin',
  [switch]$DryRun
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

if ($MonthKey -notmatch '^\d{4}-(0[1-9]|1[0-2])$') {
  throw "MonthKey must be YYYY-MM, e.g. 2026-05"
}

if (-not (Test-Path -LiteralPath $HerokuCliPath)) {
  throw "Heroku CLI not found at $HerokuCliPath"
}

if (Test-Path -LiteralPath (Join-Path $PsqlBinPath 'psql.exe')) {
  $env:PATH = "$PsqlBinPath;$env:PATH"
}
Ensure-Command -CommandName 'psql' -Hint 'Install PostgreSQL client tools so psql is available.'

$repoRoot = Split-Path -Parent $PSScriptRoot
$sqlPath = Join-Path $repoRoot 'scripts\sql\run-sla-postload.sql'
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

$monthStart = [datetime]::ParseExact("$MonthKey-01", 'yyyy-MM-dd', $null)
$monthEnd = $monthStart.AddMonths(1)
$monthStartText = $monthStart.ToString('yyyy-MM-dd')
$monthEndText = $monthEnd.ToString('yyyy-MM-dd')

Write-Step "Target month: $MonthKey"
Write-Step "Month window (exclusive end): $monthStartText -> $monthEndText"

if ($DryRun) {
  Write-Step 'Dry run enabled - no SQL executed'
  Write-Host "Would run: psql <DATABASE_URL> -v month_key=$MonthKey -v month_start=$monthStartText -v month_end=$monthEndText -f $sqlPath"
  exit 0
}

Write-Step "Checking Heroku auth for app '$HerokuApp'"
& $HerokuCliPath auth:whoami | Out-Null
if ($LASTEXITCODE -ne 0) {
  throw 'Heroku auth failed. Run: heroku login'
}

$dbUrl = (& $HerokuCliPath config:get DATABASE_URL -a $HerokuApp | Out-String).Trim()
if (-not $dbUrl) {
  throw "DATABASE_URL not found in Heroku config for app '$HerokuApp'"
}

Write-Step "Executing SQL pipeline from $sqlPath"
& psql "$dbUrl" `
  -v ON_ERROR_STOP=1 `
  -v month_key="$MonthKey" `
  -v month_start="$monthStartText" `
  -v month_end="$monthEndText" `
  -f "$sqlPath"

if ($LASTEXITCODE -ne 0) {
  throw 'Post-load SLA pipeline failed'
}

Write-Step 'Post-load SLA pipeline completed successfully'

