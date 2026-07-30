param(
    [Parameter(Mandatory = $true, Position = 0)]
    [string]$SmokeHome
)

$ErrorActionPreference = "Stop"
$RepoRoot = Split-Path -Parent $PSScriptRoot
$Binary = Join-Path $RepoRoot "target/release/raven.exe"
$Marker = Join-Path $SmokeHome ".raven-smoke-home"
$ApiProcess = $null

function Assert-True([bool]$Condition, [string]$Message) {
    if (-not $Condition) { throw "smoke-raven: $Message" }
}

$FullHome = [System.IO.Path]::GetFullPath($SmokeHome)
$DefaultHome = [System.IO.Path]::GetFullPath((Join-Path $HOME ".raven"))
$TempRoot = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath()).TrimEnd(
    [System.IO.Path]::DirectorySeparatorChar,
    [System.IO.Path]::AltDirectorySeparatorChar
)
Assert-True ([System.IO.Path]::IsPathFullyQualified($SmokeHome)) "smoke home must be absolute"
Assert-True (Test-Path -LiteralPath $FullHome -PathType Container) "smoke home must exist"
$HomeItem = Get-Item -Force -LiteralPath $FullHome
Assert-True (($HomeItem.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -eq 0) "smoke home must not be a link or junction"
Assert-True ($FullHome.StartsWith(
    "$TempRoot$([System.IO.Path]::DirectorySeparatorChar)",
    [System.StringComparison]::OrdinalIgnoreCase
)) "smoke home must be inside the system temp directory"
Assert-True ($FullHome -ne [System.IO.Path]::GetPathRoot($FullHome)) "refusing a broad path"
Assert-True ($FullHome -ne [System.IO.Path]::GetFullPath($HOME)) "refusing the user home"
Assert-True ($FullHome -ne $DefaultHome) "refusing the live default home"
Assert-True (Test-Path -LiteralPath $Marker -PathType Leaf) "smoke home marker is missing"
$MarkerItem = Get-Item -Force -LiteralPath $Marker
Assert-True (($MarkerItem.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -eq 0) "smoke home marker must not be a link"
Assert-True ((Get-Content -Raw -LiteralPath $Marker).Trim() -eq "raven-smoke-v1") "smoke home marker is invalid"
$Unexpected = @(Get-ChildItem -Force -LiteralPath $FullHome | Where-Object Name -ne ".raven-smoke-home")
Assert-True ($Unexpected.Count -eq 0) "smoke home must be empty except for its marker"
Assert-True (Test-Path -LiteralPath $Binary -PathType Leaf) "release binary is missing"

$env:RAVEN_CONSOLE_LOG = "off"

try {
    & $Binary --home $FullHome init | Out-Null
    $TodoCreate = (& $Binary --home $FullHome todo area create "Smoke Area") -join "`n"
    $TodoList = (& $Binary --home $FullHome todo list) -join "`n"
    Assert-True ($TodoCreate.Contains("Smoke Area") -and $TodoList.Contains("Smoke Area")) "ToDo create/list failed"

    & $Binary --home $FullHome ledger currency create --code KRW --name Won --symbol W --decimal-places 0 | Out-Null
    & $Binary --home $FullHome ledger account-category create --name Cash | Out-Null
    & $Binary --home $FullHome ledger account create --name Wallet --category Cash --currency KRW --opening-balance 0 | Out-Null
    & $Binary --home $FullHome ledger category create --name Food --kind expense | Out-Null
    & $Binary --home $FullHome ledger entry add --date 2026-07-31 --type expense --amount 314159 --currency KRW --account Wallet --category Food --content SmokeLedgerSecret | Out-Null
    $Ledger = ((& $Binary --home $FullHome ledger entry list --format json) -join "`n") | ConvertFrom-Json
    $Doctor = ((& $Binary --home $FullHome ledger doctor --format json) -join "`n") | ConvertFrom-Json
    Assert-True ($Ledger.items.Count -eq 1 -and $Ledger.items[0].amount_minor -eq 314159) "Ledger entry smoke failed"
    Assert-True ($Doctor.healthy -eq $true) "Ledger doctor failed"

    & $Binary --home $FullHome health diet add --at "2026-07-31T12:00:00+09:00" --meal lunch --food SmokeFoodSecret | Out-Null
    & $Binary --home $FullHome health metric add --at "2026-07-31T08:00:00+09:00" --category weight --key weight --name Weight --value 67.89 --unit kg | Out-Null
    $Timeline = ((& $Binary --home $FullHome health timeline --format json) -join "`n") | ConvertFrom-Json
    $Trends = ((& $Binary --home $FullHome health trends --days 30 --format json) -join "`n") | ConvertFrom-Json
    Assert-True ($Timeline.Count -eq 2) "Health timeline failed"
    Assert-True ($Trends.days -eq 30) "Health trends failed"

    $HealthCheck = (& $Binary --home $FullHome health-check) -join "`n"
    foreach ($Status in @("todo=ok", "ledger=ok", "health=ok", "media=ok")) {
        Assert-True ($HealthCheck.Contains($Status)) "health-check did not report all stores ready"
    }
    foreach ($Path in @("todo.sqlite", "ledger.sqlite", "health.sqlite", "media/health", "logs/raven.log.jsonl")) {
        Assert-True (Test-Path -LiteralPath (Join-Path $FullHome $Path)) "required data-home path is missing"
    }

    $Listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 0)
    $Listener.Start()
    $Port = ([System.Net.IPEndPoint]$Listener.LocalEndpoint).Port
    $Listener.Stop()
    $Token = "raven-smoke-token-0123456789"
    $env:RAVEN_API_TOKEN = $Token
    $env:RAVEN_API_BIND_HOST = "127.0.0.1"
    $env:RAVEN_API_BIND_PORT = "$Port"
    $ApiOut = Join-Path $FullHome "api.stdout"
    $ApiErr = Join-Path $FullHome "api.stderr"
    $ApiProcess = Start-Process -FilePath $Binary -ArgumentList @("--home", $FullHome, "api") -PassThru -RedirectStandardOutput $ApiOut -RedirectStandardError $ApiErr
    $BaseUrl = "http://127.0.0.1:$Port"

    $Ready = $false
    for ($Attempt = 0; $Attempt -lt 100; $Attempt++) {
        try {
            $Healthz = Invoke-RestMethod -Uri "$BaseUrl/healthz"
            if ($Healthz.status -eq "ok") { $Ready = $true; break }
        } catch {
            if ($ApiProcess.HasExited) { throw "API process exited before becoming ready" }
            Start-Sleep -Milliseconds 50
        }
    }
    Assert-True $Ready "API did not become ready"

    try {
        Invoke-WebRequest -Uri "$BaseUrl/api/v1/dashboard" | Out-Null
        throw "API accepted an unauthenticated request"
    } catch {
        Assert-True ($_.Exception.Response.StatusCode.value__ -eq 401) "unexpected unauthenticated status"
    }

    $Headers = @{ Authorization = "Bearer $Token" }
    $Dashboard = Invoke-RestMethod -Uri "$BaseUrl/api/v1/dashboard" -Headers $Headers
    Assert-True ($Dashboard.todo.status -eq "ok" -and $Dashboard.ledger.status -eq "ok" -and $Dashboard.health.status -eq "ok") "Dashboard domain status failed"
    $TodoApi = Invoke-RestMethod -Uri "$BaseUrl/api/v1/todo/health" -Headers $Headers
    $LedgerApi = Invoke-RestMethod -Uri "$BaseUrl/api/v1/ledger/entries?limit=1" -Headers $Headers
    $HealthApi = Invoke-RestMethod -Uri "$BaseUrl/api/v1/health/timeline?limit=1" -Headers $Headers
    Assert-True ($TodoApi.ok -eq $true -and $LedgerApi.items.Count -eq 1 -and $HealthApi.items.Count -eq 1) "domain API smoke failed"
} finally {
    if ($null -ne $ApiProcess) {
        if (-not $ApiProcess.HasExited) {
            Stop-Process -Id $ApiProcess.Id
        }
        $ApiProcess.WaitForExit()
    }
}

$Logs = Get-ChildItem -File -LiteralPath (Join-Path $FullHome "logs")
foreach ($Secret in @("SmokeLedgerSecret", "314159", "SmokeFoodSecret", "67.89")) {
    $Match = Select-String -Path $Logs.FullName -SimpleMatch $Secret -Quiet
    Assert-True (-not $Match) "sensitive seeded value appeared in logs"
}
foreach ($Log in $Logs) {
    Get-Content -LiteralPath $Log.FullName | ForEach-Object { $_ | ConvertFrom-Json | Out-Null }
}

Write-Output "Raven smoke passed: $FullHome"
