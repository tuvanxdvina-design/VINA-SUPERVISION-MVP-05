$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$backendRoot = Join-Path $projectRoot 'backend'
$health = Invoke-RestMethod 'http://127.0.0.1:3004/health' -TimeoutSec 5
if ($health.status -ne 'OK' -or $health.database -ne 'connected') { throw 'Application is not ready on port 3004.' }
Push-Location $backendRoot
try {
    & node 'scripts/check-remote-readiness.js'
    if ($LASTEXITCODE -ne 0) { throw 'Set individual passwords and NODE_ENV=production before remote access.' }
} finally { Pop-Location }
$tailscale = Get-Command tailscale -ErrorAction SilentlyContinue
if ($tailscale) {
    $tailscaleExe = $tailscale.Source
} else {
    $tailscaleExe = 'C:\Program Files\Tailscale\tailscale.exe'
}
if (-not (Test-Path -LiteralPath $tailscaleExe)) { throw 'Tailscale is not installed. Install it from the official source and sign in first.' }
& $tailscaleExe serve --bg 3004
if ($LASTEXITCODE -ne 0) { throw 'Could not enable Tailscale Serve.' }
& $tailscaleExe serve status
