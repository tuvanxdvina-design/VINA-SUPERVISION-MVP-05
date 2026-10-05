# Restore a custom-format backup into an isolated database and compare every table.
# This script only accepts a dedicated test database name and never changes vina_supervision_mvp05.
param(
  [Parameter(Mandatory = $true)][string]$BackupPath,
  [string]$TestDatabase = 'vina_restore_verify_manual'
)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$sourceDatabase = 'vina_supervision_mvp05'

if ($TestDatabase -notmatch '^vina_restore_verify_[a-z0-9_]+$') {
  throw 'TestDatabase must start with vina_restore_verify_ and contain only lowercase letters, numbers, or underscores.'
}
$resolvedBackup = (Resolve-Path -LiteralPath $BackupPath -ErrorAction Stop).Path

Push-Location $root
try {
  $container = (& docker compose ps -q postgres).Trim()
} finally { Pop-Location }
if (-not $container) { throw 'PostgreSQL container for this project is not running.' }

$remote = '/tmp/vina-restore-verify.dump'
function Invoke-Psql([string]$database, [string]$sql) {
  $output = docker exec $container psql -U postgres -d $database -v ON_ERROR_STOP=1 -At -c $sql
  if ($LASTEXITCODE -ne 0) { throw "psql failed in database $database" }
  return @($output)
}

try {
  docker cp $resolvedBackup "${container}:$remote"
  if ($LASTEXITCODE -ne 0) { throw 'Cannot copy backup into PostgreSQL container.' }

  Invoke-Psql 'postgres' "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '$TestDatabase' AND pid <> pg_backend_pid()" | Out-Null
  Invoke-Psql 'postgres' "DROP DATABASE IF EXISTS $TestDatabase" | Out-Null
  Invoke-Psql 'postgres' "CREATE DATABASE $TestDatabase" | Out-Null

  docker exec $container pg_restore -U postgres -d $TestDatabase --exit-on-error --no-owner $remote
  if ($LASTEXITCODE -ne 0) { throw 'Backup cannot be restored.' }

  $tableSql = "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename"
  $sourceTables = @(Invoke-Psql $sourceDatabase $tableSql)
  $restoredTables = @(Invoke-Psql $TestDatabase $tableSql)
  if (($sourceTables -join "`n") -ne ($restoredTables -join "`n")) {
    throw 'Restored table list does not match the source database.'
  }

  $failures = @()
  foreach ($table in $sourceTables) {
    $quoted = '"' + $table.Replace('"', '""') + '"'
    $countSql = "SELECT count(*) FROM public.$quoted"
    $sourceCount = [int](Invoke-Psql $sourceDatabase $countSql)[0]
    $restoredCount = [int](Invoke-Psql $TestDatabase $countSql)[0]
    $hashSql = "SELECT md5(COALESCE(string_agg(md5(row_to_json(t)::text), '' ORDER BY md5(row_to_json(t)::text)), '')) FROM public.$quoted t"
    $sourceHash = (Invoke-Psql $sourceDatabase $hashSql)[0]
    $restoredHash = (Invoke-Psql $TestDatabase $hashSql)[0]
    if ($sourceCount -ne $restoredCount -or $sourceHash -ne $restoredHash) {
      $failures += "$table (source=$sourceCount, restored=$restoredCount)"
    }
  }
  if ($failures.Count) { throw ('Restore mismatch: ' + ($failures -join '; ')) }
  Write-Host "Restore verified: $($sourceTables.Count) tables match row counts and content hashes."
} finally {
  try { Invoke-Psql 'postgres' "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '$TestDatabase' AND pid <> pg_backend_pid()" | Out-Null } catch {}
  try { Invoke-Psql 'postgres' "DROP DATABASE IF EXISTS $TestDatabase" | Out-Null } catch {}
  docker exec $container rm -f $remote 2>$null | Out-Null
}
