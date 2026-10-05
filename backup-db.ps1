# Sao luu PostgreSQL dung dinh dang custom (.dump) - KHONG dung dau ">" cua PowerShell
# vi PowerShell doi luong nhi phan sang UTF-16 va lam hong tep.
# Tep nay chi dung ky tu ASCII de chay duoc tren Windows PowerShell 5.1.
# Cach dung:  powershell -ExecutionPolicy Bypass -File .\backup-db.ps1 -Label truoc-migration
param([string]$Label = 'manual')
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$dir = Join-Path $root 'backups'
New-Item -ItemType Directory -Path $dir -Force | Out-Null
$stamp = Get-Date -Format 'yyyy-MM-dd-HHmm'
$name = "vina-supervision-$stamp-$Label.dump"
Push-Location $root
try {
  $container = (& docker compose ps -q postgres).Trim()
} finally { Pop-Location }
if (-not $container) { throw 'Khong tim thay container PostgreSQL cua du an hien tai.' }

docker exec $container pg_dump -U postgres -d vina_supervision_mvp05 -Fc -f "/tmp/$name"
if ($LASTEXITCODE -ne 0) { throw 'pg_dump that bai (kiem tra PostgreSQL cua du an dang chay)' }
docker cp "${container}:/tmp/$name" (Join-Path $dir $name)
if ($LASTEXITCODE -ne 0) { throw 'Khong chep duoc tep sao luu ra khoi container' }
docker exec $container rm -f "/tmp/$name" | Out-Null

# Kiem tra tep doc duoc
docker cp (Join-Path $dir $name) "${container}:/tmp/check.dump"
docker exec $container pg_restore -l /tmp/check.dump | Out-Null
if ($LASTEXITCODE -ne 0) { throw "Tep sao luu $name KHONG hop le" }
docker exec $container rm -f /tmp/check.dump | Out-Null
$size = [math]::Round((Get-Item (Join-Path $dir $name)).Length / 1KB, 1)
Write-Host "Da sao luu va kiem tra OK: backups\$name ($size KB)"
# Anh hien truong cua nhat ky luu tren dia (backend\uploads) -> nen kem theo cung ten
$uploads = Join-Path $root 'backend\uploads'
if ((Test-Path $uploads) -and (Get-ChildItem $uploads -File -ErrorAction SilentlyContinue | Select-Object -First 1)) {
  $zip = Join-Path $dir ($name -replace '\.dump$', '-uploads.zip')
  Compress-Archive -Path (Join-Path $uploads '*') -DestinationPath $zip -Force
  Write-Host "Da sao luu anh hien truong: backups\$(Split-Path $zip -Leaf)"
}
