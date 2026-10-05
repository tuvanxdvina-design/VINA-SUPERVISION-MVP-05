# Chay migration CSDL bang tai khoan postgres ben trong container Docker.
# Ly do: cac bang goc thuoc so huu cua "postgres"; tai khoan ung dung (vina_user)
# chi co quyen doc/ghi du lieu nen khong ALTER TABLE duoc.
# Tep chi dung ky tu ASCII de chay tren Windows PowerShell 5.1.
# Cach dung (tai thu muc du an):  powershell -ExecutionPolicy Bypass -File .\migrate-db.ps1
#                                  powershell -ExecutionPolicy Bypass -File .\migrate-db.ps1 -Status
param([switch]$Status, [switch]$AutoBackup)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$db = 'vina_supervision_mvp05'

Push-Location $root
try {
  $container = (& docker compose ps -q postgres).Trim()
} finally { Pop-Location }
if (-not $container) { throw 'Khong tim thay container PostgreSQL cua du an hien tai.' }

# Doc ten tai khoan ung dung trong backend\.env de cap quyen sau migration
$appUser = 'vina_user'
$appPassword = ''
$envFile = Join-Path $root 'backend\.env'
if (Test-Path $envFile) {
  $envLines = Get-Content $envFile
  $line = $envLines | Where-Object { $_ -match '^\s*DB_USER\s*=' } | Select-Object -First 1
  if ($line) { $appUser = ($line -split '=', 2)[1].Trim() }
  $line = $envLines | Where-Object { $_ -match '^\s*DB_PASSWORD\s*=' } | Select-Object -First 1
  if ($line) { $appPassword = ($line -split '=', 2)[1].Trim() }
}
if ($appUser -notmatch '^[a-z_][a-z0-9_]*$') { throw 'DB_USER khong hop le.' }
if (-not $appPassword) { throw 'DB_PASSWORD dang trong trong backend\.env.' }

function Invoke-Psql([string]$sql) {
  $out = docker exec $container psql -U postgres -d $db -v ON_ERROR_STOP=1 -tA -c $sql
  if ($LASTEXITCODE -ne 0) { throw "psql loi khi chay: $sql" }
  return $out
}

# Dam bao container moi co tai khoan ung dung rieng, dung mat khau trong backend\.env.
$safePassword = $appPassword.Replace("'", "''")
$roleExists = Invoke-Psql "SELECT 1 FROM pg_roles WHERE rolname = '$appUser'"
if ($roleExists) {
  Invoke-Psql "ALTER ROLE $appUser WITH LOGIN PASSWORD '$safePassword'" | Out-Null
} else {
  Invoke-Psql "CREATE ROLE $appUser WITH LOGIN PASSWORD '$safePassword'" | Out-Null
}
Invoke-Psql "GRANT CONNECT ON DATABASE $db TO $appUser" | Out-Null
Invoke-Psql "GRANT USAGE ON SCHEMA public TO $appUser" | Out-Null

Invoke-Psql "CREATE TABLE IF NOT EXISTS schema_migrations (file_name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT NOW())" | Out-Null
Invoke-Psql "ALTER TABLE schema_migrations OWNER TO postgres" | Out-Null
$done = @(Invoke-Psql "SELECT file_name FROM schema_migrations")
$files = Get-ChildItem (Join-Path $root 'migrations') -Filter '*.sql' | Where-Object { $_.Name -match '^\d{8}_.+\.sql$' } | Sort-Object Name

if ($Status) {
  foreach ($f in $files) { if ($done -contains $f.Name) { "[x] $($f.Name)" } else { "[ ] $($f.Name)" } }
  exit 0
}

$pending = @($files | Where-Object { $done -notcontains $_.Name })
if ($pending.Count -eq 0) { Write-Host 'CSDL da o phien ban moi nhat.' }
elseif ($AutoBackup) {
  Write-Host "Co $($pending.Count) migration moi - sao luu truoc khi ap dung..."
  & (Join-Path $root 'backup-db.ps1') -Label 'truoc-migration'
}
foreach ($f in $files) {
  if ($done -contains $f.Name) { continue }
  Write-Host "Ap dung $($f.Name) ..."
  docker cp $f.FullName "${container}:/tmp/$($f.Name)"
  if ($LASTEXITCODE -ne 0) { throw "Khong chep duoc $($f.Name) vao container" }
  docker exec $container psql -U postgres -d $db -v ON_ERROR_STOP=1 -f "/tmp/$($f.Name)"
  if ($LASTEXITCODE -ne 0) { throw "Migration $($f.Name) LOI - da dung lai, CSDL giu nguyen trang thai truoc tep nay" }
  Invoke-Psql "INSERT INTO schema_migrations (file_name) VALUES ('$($f.Name)') ON CONFLICT DO NOTHING" | Out-Null
  docker exec $container rm -f "/tmp/$($f.Name)" | Out-Null
}

# Cap lai quyen doc/ghi cho tai khoan ung dung tren moi bang/sequence
Invoke-Psql "GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO $appUser" | Out-Null
Invoke-Psql "GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO $appUser" | Out-Null
Write-Host "Hoan tat migration. Da cap quyen cho $appUser."
