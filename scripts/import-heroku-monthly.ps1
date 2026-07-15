[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$MonthFolder,

  [string]$DataRoot = 'C:\temp',
  [string]$HerokuApp = 'noc-adherence-api',
  [string]$HerokuCliPath = 'C:\Program Files\Heroku\bin\heroku.cmd',
  [string]$PsqlBinPath = 'C:\Program Files\PostgreSQL\17\bin',

  [ValidateSet('WIN1251', 'UTF8')]
  [string]$CsvEncoding = 'WIN1251',

  [switch]$DryRun
)

$ErrorActionPreference = 'Stop'

$script:MonthFolder = $MonthFolder
$script:DataRoot = $DataRoot
$script:HerokuApp = $HerokuApp
$script:HerokuCliPath = $HerokuCliPath
$script:CsvEncoding = $CsvEncoding
$script:DryRun = $DryRun
$script:DatabaseUrl = $null

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

function Get-CsvDelimiter {
  param([string]$Path)

  $header = Get-Content -LiteralPath $Path -TotalCount 1
  $commaCount = ([regex]::Matches($header, ',')).Count
  $semiCount = ([regex]::Matches($header, ';')).Count
  if ($semiCount -gt $commaCount) { return ';' }
  return ','
}

function Invoke-HerokuPsql {
  param(
    [string]$Sql,
    [switch]$Quiet
  )

  if (-not $Quiet) {
    Write-Host "SQL: $Sql"
  }

  if ($script:DryRun) {
    return
  }

  & psql "$script:DatabaseUrl" -v ON_ERROR_STOP=1 -c $Sql
  if ($LASTEXITCODE -ne 0) {
    throw "psql failed for SQL: $Sql"
  }
}

function Invoke-PsqlBatch {
  param(
    [string]$ScriptText,
    [switch]$Quiet
  )

  if (-not $Quiet) {
    Write-Host 'SQL batch:'
    Write-Host $ScriptText
  }

  if ($script:DryRun) {
    return
  }

  $ScriptText | & psql "$script:DatabaseUrl" -v ON_ERROR_STOP=1
  if ($LASTEXITCODE -ne 0) {
    throw 'psql failed for SQL batch.'
  }
}

function Import-CsvToTable {
  param(
    [string]$Table,
    [string[]]$Columns,
    [string]$CsvFileName,
    [bool]$TruncateFirst
  )

  $csvPath = Join-Path (Join-Path $script:DataRoot $script:MonthFolder) $CsvFileName
  if (-not (Test-Path -LiteralPath $csvPath)) {
    throw "CSV file not found: $csvPath"
  }

  $delimiter = Get-CsvDelimiter -Path $csvPath
  $csvPathForPsql = $csvPath.Replace('\', '/')
  $columnList = $Columns -join ', '

  Write-Step "Importing $Table from $csvPath (delimiter '$delimiter')"

  if ($TruncateFirst) {
    Invoke-HerokuPsql -Sql "TRUNCATE TABLE $Table;"
  }

  $copySql = "\copy $Table ($columnList) FROM '$csvPathForPsql' WITH (FORMAT csv, HEADER true, DELIMITER '$delimiter', ENCODING '$($script:CsvEncoding)');"
  Invoke-HerokuPsql -Sql $copySql -Quiet
  Invoke-HerokuPsql -Sql "SELECT '$Table' AS table_name, count(*) AS rows FROM $Table;"
}

function Import-ZendeskTickets {
  param(
    [string]$CsvFileName,
    [bool]$TruncateFirst
  )

  $csvPath = Join-Path (Join-Path $script:DataRoot $script:MonthFolder) $CsvFileName
  if (-not (Test-Path -LiteralPath $csvPath)) {
    throw "CSV file not found: $csvPath"
  }

  $delimiter = Get-CsvDelimiter -Path $csvPath
  $csvPathForPsql = $csvPath.Replace('\', '/')
  $header = Get-Content -LiteralPath $csvPath -TotalCount 1
  $hasSiteAccessColumns = $header -match 'Product Type' -and $header -match 'Site Access Times'

  Write-Step "Importing zendesktickets from $csvPath (delimiter '$delimiter', safe mode)"
  if ($hasSiteAccessColumns) {
    Write-Step 'Detected extended ticket format with product type and site access columns'
  } else {
    Write-Step 'Detected legacy ticket format without site access columns'
  }

  if ($TruncateFirst) {
    Invoke-HerokuPsql -Sql 'TRUNCATE TABLE zendesktickets;'
  }

  if ($hasSiteAccessColumns) {
    $batch = @"
BEGIN;
ALTER TABLE public.zendesktickets
  ADD COLUMN IF NOT EXISTS producttype character varying(255),
  ADD COLUMN IF NOT EXISTS siteaccesstimes character varying(255);
CREATE TEMP TABLE tmp_zendesktickets_raw (
  ticketid text,
  frglinklabel text,
  producttype text,
  siteaccesstimes text,
  ticketgroup text,
  ticketcreated text,
  confirmedimpact text,
  classification text,
  ticketproblemid text,
  duplicateticket text,
  rootcause text,
  partyatfault text,
  stoptime text,
  severity text,
  solvedtickets text
);
\copy tmp_zendesktickets_raw(ticketid,frglinklabel,producttype,siteaccesstimes,ticketgroup,ticketcreated,confirmedimpact,classification,ticketproblemid,duplicateticket,rootcause,partyatfault,stoptime,severity,solvedtickets) FROM '$csvPathForPsql' WITH (FORMAT csv, HEADER true, DELIMITER '$delimiter', ENCODING '$($script:CsvEncoding)');
INSERT INTO public.zendesktickets(
  ticketid, frglinklabel, producttype, siteaccesstimes, ticketcreated, confirmedimpact, classification,
  ticketproblemid, duplicateticket, rootcause, partyatfault, stoptime, severity
)
SELECT
  NULLIF(LEFT(ticketid,255), ''),
  NULLIF(LEFT(frglinklabel,255), ''),
  NULLIF(LEFT(REPLACE(producttype, CHR(160), ' '),255), ''),
  NULLIF(LEFT(REPLACE(siteaccesstimes, CHR(160), ' '),255), ''),
  CASE WHEN NULLIF(BTRIM(ticketcreated), '') IS NULL THEN NULL ELSE NULLIF(BTRIM(ticketcreated), '')::timestamp END,
  NULLIF(LEFT(confirmedimpact,255), ''),
  NULLIF(LEFT(classification,255), ''),
  NULLIF(LEFT(ticketproblemid,255), ''),
  NULLIF(LEFT(duplicateticket,255), ''),
  NULLIF(LEFT(rootcause,255), ''),
  NULLIF(LEFT(partyatfault,255), ''),
  CASE WHEN NULLIF(BTRIM(stoptime), '') IS NULL THEN NULL ELSE NULLIF(BTRIM(stoptime), '')::timestamp END,
  NULLIF(LEFT(severity,255), '')
FROM tmp_zendesktickets_raw;
COMMIT;
"@
  } else {
    $batch = @"
BEGIN;
ALTER TABLE public.zendesktickets
  ADD COLUMN IF NOT EXISTS producttype character varying(255),
  ADD COLUMN IF NOT EXISTS siteaccesstimes character varying(255);
CREATE TEMP TABLE tmp_zendesktickets_raw (
  ticketid text,
  frglinklabel text,
  ticketcreated text,
  confirmedimpact text,
  classification text,
  ticketproblemid text,
  duplicateticket text,
  rootcause text,
  partyatfault text,
  stoptime text,
  severity text
);
\copy tmp_zendesktickets_raw(ticketid,frglinklabel,ticketcreated,confirmedimpact,classification,ticketproblemid,duplicateticket,rootcause,partyatfault,stoptime,severity) FROM '$csvPathForPsql' WITH (FORMAT csv, HEADER true, DELIMITER '$delimiter', ENCODING '$($script:CsvEncoding)');
INSERT INTO public.zendesktickets(
  ticketid, frglinklabel, producttype, siteaccesstimes, ticketcreated, confirmedimpact, classification,
  ticketproblemid, duplicateticket, rootcause, partyatfault, stoptime, severity
)
SELECT
  NULLIF(LEFT(ticketid,255), ''),
  NULLIF(LEFT(frglinklabel,255), ''),
  NULL,
  NULL,
  CASE WHEN NULLIF(BTRIM(ticketcreated), '') IS NULL THEN NULL ELSE NULLIF(BTRIM(ticketcreated), '')::timestamp END,
  NULLIF(LEFT(confirmedimpact,255), ''),
  NULLIF(LEFT(classification,255), ''),
  NULLIF(LEFT(ticketproblemid,255), ''),
  NULLIF(LEFT(duplicateticket,255), ''),
  NULLIF(LEFT(rootcause,255), ''),
  NULLIF(LEFT(partyatfault,255), ''),
  CASE WHEN NULLIF(BTRIM(stoptime), '') IS NULL THEN NULL ELSE NULLIF(BTRIM(stoptime), '')::timestamp END,
  NULLIF(LEFT(severity,255), '')
FROM tmp_zendesktickets_raw;
COMMIT;
"@
  }

  Invoke-PsqlBatch -ScriptText $batch -Quiet
  Invoke-HerokuPsql -Sql "SELECT 'zendesktickets' AS table_name, count(*) AS rows FROM zendesktickets;"
}

if (-not (Test-Path -LiteralPath $HerokuCliPath)) {
  throw "Heroku CLI not found at $HerokuCliPath"
}

if (Test-Path -LiteralPath (Join-Path $PsqlBinPath 'psql.exe')) {
  $env:PATH = "$PsqlBinPath;$env:PATH"
}
Ensure-Command -CommandName 'psql' -Hint 'Install PostgreSQL client tools so psql is available.'

$repoRoot = Split-Path -Parent $PSScriptRoot
$env:HEROKU_DATA_DIR = Join-Path $repoRoot '.heroku'
$env:HEROKU_CACHE_DIR = Join-Path $env:HEROKU_DATA_DIR 'cache'
New-Item -ItemType Directory -Force $env:HEROKU_CACHE_DIR | Out-Null

Remove-Item Env:HTTP_PROXY -ErrorAction SilentlyContinue
Remove-Item Env:HTTPS_PROXY -ErrorAction SilentlyContinue

if (-not $DryRun) {
  Write-Step "Checking Heroku auth for app '$HerokuApp'"
  & $HerokuCliPath auth:whoami | Out-Null
  if ($LASTEXITCODE -ne 0) {
    throw 'Heroku auth failed. Run: heroku login'
  }

  $dbUrl = (& $HerokuCliPath config:get DATABASE_URL -a $HerokuApp | Out-String).Trim()
  if (-not $dbUrl) {
    throw "DATABASE_URL not found in Heroku config for app '$HerokuApp'"
  }
  $script:DatabaseUrl = $dbUrl
}

$imports = @(
  @{
    Table = 'outagezendeskrefs2'
    CsvFileName = 'outage_zen_refs.csv'
    TruncateFirst = $true
    Columns = @(
      'outage_ref',
      'ffticket',
      'outagetitle',
      'supplier_ref',
      'trigger_type',
      'product',
      'impact_start',
      'impact_stop',
      'force_majeure',
      'impact_type',
      'cause_class',
      'cause_class_sub',
      'region',
      'node',
      'summary',
      'party_at_fault',
      'infrastructure_owner',
      'sub_count',
      'isp_count',
      'network_segment'
    )
  },
  @{
    Table = 'zendesktickets'
    CsvFileName = 'Ticketsloggedfttb.csv'
    TruncateFirst = $true
    Columns = @(
      'ticketid',
      'frglinklabel',
      'ticketcreated',
      'confirmedimpact',
      'classification',
      'ticketproblemid',
      'duplicateticket',
      'rootcause',
      'partyatfault',
      'stoptime',
      'severity'
    )
  },
  @{
    Table = 'outage_resolvers'
    CsvFileName = 'resolvers.csv'
    TruncateFirst = $false
    Columns = @(
      'frogfootlinklabel',
      'outageref',
      'changestarted',
      'resolveddate',
      'year_month'
    )
  },
  @{
    Table = 'solidbase'
    CsvFileName = 'solidbase.csv'
    TruncateFirst = $true
    Columns = @(
      'frogfootlinklabel',
      'producttype',
      'isp',
      'status',
      'livedate',
      'canceldate',
      'precinctid',
      'precinctname',
      'suppliername',
      'suppliercircuitnumber',
      'aggregationnodeid',
      'node',
      'olt',
      'region'
    )
  }
)

foreach ($import in $imports) {
  if ($import.Table -eq 'zendesktickets') {
    Import-ZendeskTickets -CsvFileName $import.CsvFileName -TruncateFirst $import.TruncateFirst
  } else {
    Import-CsvToTable -Table $import.Table -Columns $import.Columns -CsvFileName $import.CsvFileName -TruncateFirst $import.TruncateFirst
  }
}

Write-Step 'Import workflow completed'
