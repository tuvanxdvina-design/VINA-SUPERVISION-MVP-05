$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$backendRoot = Join-Path $projectRoot 'backend'
$webRoot = Join-Path $projectRoot 'web-public'
$logRoot = Join-Path $projectRoot 'runtime-logs'
$backendPort = 3004
$frontendPort = 8083
$backendBase = "http://127.0.0.1:$backendPort"
$frontendBase = "http://127.0.0.1:$frontendPort"
$backendPidFile = Join-Path $logRoot 'backend.pid'
New-Item -ItemType Directory -Path $logRoot -Force | Out-Null
New-Item -ItemType Directory -Path $webRoot -Force | Out-Null
foreach ($fileName in @('index.html', 'api.js', 'favicon.ico', 'sw.js', 'manifest.webmanifest', 'assets\vicoad-logo.png', 'assets\app-icon-180.png', 'assets\app-icon-192.png', 'assets\app-icon-512.png', 'assets\mau-bang-tien-do.xlsx')) {
    New-Item -ItemType Directory -Path (Split-Path (Join-Path $webRoot $fileName)) -Force | Out-Null
    Copy-Item -LiteralPath (Join-Path $projectRoot $fileName) -Destination (Join-Path $webRoot $fileName) -Force
}
# Cac tep JS cua giao dien nam trong js\ — chep ca thu muc de khong phai liet ke tung tep
$jsSrc = Join-Path $projectRoot 'js'
if (Test-Path $jsSrc) {
    $jsDst = Join-Path $webRoot 'js'
    New-Item -ItemType Directory -Path $jsDst -Force | Out-Null
    Copy-Item -Path (Join-Path $jsSrc '*') -Destination $jsDst -Recurse -Force
}

function Test-Http([string]$url) {
    try {
        return Invoke-RestMethod -Uri $url -TimeoutSec 2
    } catch {
        return $null
    }
}

function Wait-Http([string]$url, [int]$seconds) {
    for ($attempt = 0; $attempt -lt $seconds; $attempt++) {
        $result = Test-Http $url
        if ($result) { return $result }
        Start-Sleep -Seconds 1
    }
    return $null
}

Push-Location $projectRoot
try {
    docker compose up -d --wait postgres
    if ($LASTEXITCODE -ne 0) { throw 'Cannot start PostgreSQL with Docker Compose.' }

    # Tu dong ap dung migration CSDL moi (sao luu truoc neu co migration chua chay)
    & (Join-Path $projectRoot 'migrate-db.ps1') -AutoBackup
    if (-not $?) { throw 'Migration CSDL loi - xem thong bao phia tren. Backend chua duoc khoi dong.' }

    # Phien ban ma nguon hien tai (backend/src/build.js). Neu backend dang chay ban cu -> tu khoi dong lai.
    $buildFile = Get-Content (Join-Path $backendRoot 'src\build.js') -Raw
    $expectedBuild = if ($buildFile -match "BUILD:\s*'([^']+)'") { $Matches[1] } else { '' }
    $health = Test-Http "$backendBase/health"
    if ($health -and $expectedBuild -and $health.build -ne $expectedBuild) {
        Write-Host "Backend dang chay phien ban cu ($($health.build)) - khoi dong lai sang $expectedBuild ..."
        $knownPid = if (Test-Path $backendPidFile) { [int](Get-Content $backendPidFile -Raw) } else { 0 }
        $owners = Get-NetTCPConnection -LocalPort $backendPort -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique
        foreach ($procId in $owners) {
            $proc = Get-Process -Id $procId -ErrorAction SilentlyContinue
            if ($proc -and $proc.ProcessName -eq 'node' -and $procId -eq $knownPid) { Stop-Process -Id $procId -Force }
            elseif ($proc) { throw "Cong $backendPort dang bi chuong trinh khac chiem: $($proc.ProcessName). Khong tu dong dung tien trinh khong thuoc MVP-05." }
        }
        for ($i = 0; $i -lt 10 -and (Get-NetTCPConnection -LocalPort $backendPort -State Listen -ErrorAction SilentlyContinue); $i++) { Start-Sleep -Seconds 1 }
        $health = $null
    }
    if (-not $health) {
        if (Get-NetTCPConnection -LocalPort $backendPort -State Listen -ErrorAction SilentlyContinue) {
            throw "Port $backendPort is already in use."
        }
        $node = (Get-Command node -ErrorAction Stop).Source
        if (-not (Test-Path (Join-Path $backendRoot 'node_modules'))) {
            throw 'Missing backend/node_modules. Run npm ci in backend first.'
        }
        $backendProcess = Start-Process -FilePath $node -ArgumentList 'server.js' -WorkingDirectory $backendRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $logRoot 'backend.out.log') -RedirectStandardError (Join-Path $logRoot 'backend.err.log') -PassThru
        Set-Content -LiteralPath $backendPidFile -Value $backendProcess.Id -Encoding ASCII
        $health = Wait-Http "$backendBase/health" 20
    }
    if (-not $health -or $health.status -ne 'OK' -or $health.database -ne 'connected') {
        throw 'Backend is not ready or PostgreSQL is disconnected. See runtime-logs/backend.err.log.'
    }
    if ($expectedBuild -and $health.build -ne $expectedBuild) {
        throw "Backend van chay phien ban $($health.build), can $expectedBuild. Hay tat tien trinh node thu cong roi chay lai."
    }
    Write-Host "Backend phien ban $($health.build) - migration cho: $(@($health.migrations_pending).Count)" 

    $frontend = Test-Http "$frontendBase/"
    if (-not $frontend) {
        if (Get-NetTCPConnection -LocalPort $frontendPort -State Listen -ErrorAction SilentlyContinue) {
            throw "Port $frontendPort is already in use."
        }
        $python = (Get-Command python -ErrorAction Stop).Source
        Start-Process -FilePath $python -ArgumentList '-m','http.server',$frontendPort,'--bind','127.0.0.1','--directory',$webRoot -WorkingDirectory $projectRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $logRoot 'frontend.out.log') -RedirectStandardError (Join-Path $logRoot 'frontend.err.log') | Out-Null
        $frontend = Wait-Http "$frontendBase/" 10
    }
    if (-not $frontend) { throw 'Frontend is not ready. See runtime-logs/frontend.err.log.' }
    if ($frontend -notmatch '<meta name="application-name" content="VINA-SUPERVISION">') {
        throw "Port $frontendPort is serving a different application."
    }
    try {
        $privateResponse = Invoke-WebRequest "$frontendBase/backend/.env" -Method Head -TimeoutSec 2 -UseBasicParsing -ErrorAction Stop
        if ($privateResponse.StatusCode -eq 200) { throw "Port $frontendPort exposes private project files." }
    } catch [System.Net.WebException] {
        if ([int]$_.Exception.Response.StatusCode -ne 404) { throw }
    }

    Write-Host 'VINA-SUPERVISION is ready:'
    Write-Host "Frontend:  http://localhost:$frontendPort/"
    Write-Host "Backend:   http://localhost:$backendPort/health"
} finally {
    Pop-Location
}
