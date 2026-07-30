param(
    [Parameter(Mandatory = $true, Position = 0)]
    [string]$SmokeHome
)

$ErrorActionPreference = "Stop"
$RepoRoot = Split-Path -Parent $PSScriptRoot
$Binary = Join-Path $RepoRoot "target/release/raven.exe"
$UiPath = Join-Path $RepoRoot "frontend/out"
$ApiProcess = $null
$UiProcess = $null

function Assert-True([bool]$Condition, [string]$Message) {
    if (-not $Condition) { throw "smoke-raven: $Message" }
}

function Invoke-Raven([string[]]$Arguments) {
    $Output = (& $Binary @Arguments) -join "`n"
    Assert-True ($LASTEXITCODE -eq 0) "Raven command failed"
    return $Output
}

function Start-Raven([string[]]$Arguments, [hashtable]$Environment = @{}) {
    $Info = [System.Diagnostics.ProcessStartInfo]::new()
    $Info.FileName = $Binary
    $Info.UseShellExecute = $false
    $Info.CreateNoWindow = $true
    $Info.RedirectStandardOutput = $true
    $Info.RedirectStandardError = $true
    foreach ($Argument in $Arguments) { [void]$Info.ArgumentList.Add($Argument) }
    $Info.Environment["RAVEN_CONSOLE_LOG"] = "off"
    foreach ($Name in $Environment.Keys) { $Info.Environment[$Name] = [string]$Environment[$Name] }
    $Process = [System.Diagnostics.Process]::new()
    $Process.StartInfo = $Info
    Assert-True ($Process.Start()) "Raven process did not start"
    return $Process
}

function Stop-Bounded([System.Diagnostics.Process]$Process) {
    if ($null -eq $Process) { return }
    if (-not $Process.HasExited) {
        try { [void]$Process.CloseMainWindow() } catch {}
        if (-not $Process.WaitForExit(500)) {
            $Process.Kill($true)
            Assert-True ($Process.WaitForExit(2000)) "Raven process did not terminate"
        }
    } else {
        $Process.WaitForExit()
    }
}

$FullHome = [System.IO.Path]::GetFullPath($SmokeHome).TrimEnd(
    [System.IO.Path]::DirectorySeparatorChar,
    [System.IO.Path]::AltDirectorySeparatorChar
)
$TempRoot = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath()).TrimEnd(
    [System.IO.Path]::DirectorySeparatorChar,
    [System.IO.Path]::AltDirectorySeparatorChar
)
$TempPrefix = "$TempRoot$([System.IO.Path]::DirectorySeparatorChar)"
$DefaultHome = [System.IO.Path]::GetFullPath((Join-Path $HOME ".raven"))
Assert-True ([System.IO.Path]::IsPathFullyQualified($SmokeHome)) "smoke home must be absolute"
Assert-True (Test-Path -LiteralPath $FullHome -PathType Container) "smoke home must exist"
Assert-True ($FullHome.StartsWith($TempPrefix, [System.StringComparison]::OrdinalIgnoreCase)) "smoke home must be inside the system temp directory"
Assert-True ($FullHome -ne [System.IO.Path]::GetPathRoot($FullHome)) "refusing a broad path"
Assert-True ($FullHome -ne [System.IO.Path]::GetFullPath($HOME)) "refusing the user home"
Assert-True ($FullHome -ne $DefaultHome) "refusing the live default home"

$RelativeHome = $FullHome.Substring($TempPrefix.Length)
$CurrentPath = $TempRoot
foreach ($Component in $RelativeHome.Split(
    @([System.IO.Path]::DirectorySeparatorChar, [System.IO.Path]::AltDirectorySeparatorChar),
    [System.StringSplitOptions]::RemoveEmptyEntries
)) {
    $CurrentPath = Join-Path $CurrentPath $Component
    $Item = Get-Item -Force -LiteralPath $CurrentPath
    Assert-True (($Item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -eq 0) "smoke home path must not contain a link or junction"
}

$Marker = Join-Path $FullHome ".raven-smoke-home"
Assert-True (Test-Path -LiteralPath $Marker -PathType Leaf) "smoke home marker is missing"
$MarkerItem = Get-Item -Force -LiteralPath $Marker
Assert-True (($MarkerItem.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -eq 0) "smoke home marker must not be a link"
Assert-True ((Get-Content -Raw -LiteralPath $Marker).Trim() -eq "raven-smoke-v1") "smoke home marker is invalid"
$Unexpected = @(Get-ChildItem -Force -LiteralPath $FullHome | Where-Object Name -ne ".raven-smoke-home")
Assert-True ($Unexpected.Count -eq 0) "smoke home must be empty except for its marker"
Assert-True (Test-Path -LiteralPath $Binary -PathType Leaf) "release binary is missing"
Assert-True (Test-Path -LiteralPath (Join-Path $UiPath "index.html") -PathType Leaf) "frontend artifact is missing"

$env:RAVEN_CONSOLE_LOG = "off"
$Now = [DateTimeOffset]::UtcNow.ToOffset([TimeSpan]::FromHours(9))
$CurrentDate = $Now.ToString("yyyy-MM-dd")
$CurrentTime = $Now.ToString("yyyy-MM-ddTHH:mm:sszzz")

try {
    Invoke-Raven @("--home", $FullHome, "init") | Out-Null
    $Area = Invoke-Raven @("--home", $FullHome, "todo", "area", "create", "Smoke Area") | ConvertFrom-Json
    $Task = Invoke-Raven @("--home", $FullHome, "todo", "task", "propose", "Smoke Today Task", "--area", "Smoke Area", "--scheduled", $CurrentDate) | ConvertFrom-Json
    $TodoList = Invoke-Raven @("--home", $FullHome, "todo", "list")
    Assert-True ($Area.title -eq "Smoke Area" -and $TodoList.Contains("Smoke Today Task")) "ToDo create/list failed"
    Assert-True ($Task.scheduled -eq $CurrentDate) "ToDo current-date seed failed"

    Invoke-Raven @("--home", $FullHome, "ledger", "currency", "create", "--code", "KRW", "--name", "Won", "--symbol", "W", "--decimal-places", "0") | Out-Null
    Invoke-Raven @("--home", $FullHome, "ledger", "account-category", "create", "--name", "Cash") | Out-Null
    Invoke-Raven @("--home", $FullHome, "ledger", "account", "create", "--name", "Wallet", "--category", "Cash", "--currency", "KRW", "--opening-balance", "0") | Out-Null
    Invoke-Raven @("--home", $FullHome, "ledger", "category", "create", "--name", "Food", "--kind", "expense") | Out-Null
    $LedgerCreated = Invoke-Raven @("--home", $FullHome, "ledger", "entry", "add", "--date", $CurrentDate, "--type", "expense", "--amount", "314159", "--currency", "KRW", "--account", "Wallet", "--category", "Food", "--content", "SmokeLedgerSecret") | ConvertFrom-Json
    $Ledger = Invoke-Raven @("--home", $FullHome, "ledger", "entry", "list", "--format", "json") | ConvertFrom-Json
    $Doctor = Invoke-Raven @("--home", $FullHome, "ledger", "doctor", "--format", "json") | ConvertFrom-Json
    Assert-True ($Ledger.items.Count -eq 1 -and $Ledger.items[0].id -eq $LedgerCreated.id -and $Ledger.items[0].amount_minor -eq 314159) "Ledger exact entry smoke failed"
    Assert-True ($Doctor.healthy -eq $true) "Ledger doctor failed"

    $Diet = Invoke-Raven @("--home", $FullHome, "health", "diet", "add", "--at", $CurrentTime, "--meal", "lunch", "--food", "SmokeFoodSecret", "--tags", "smoke-diet-tag") | ConvertFrom-Json
    $Weight = Invoke-Raven @("--home", $FullHome, "health", "metric", "add", "--at", $CurrentTime, "--category", "weight", "--key", "weight", "--name", "SmokeWeight", "--value", "67.89", "--unit", "kg") | ConvertFrom-Json
    $Condition = Invoke-Raven @("--home", $FullHome, "health", "metric", "add", "--at", $CurrentTime, "--category", "overall_condition", "--name", "SmokeCondition", "--value", "7") | ConvertFrom-Json
    $Timeline = @(Invoke-Raven @("--home", $FullHome, "health", "timeline", "--format", "json") | ConvertFrom-Json)
    $Trends = Invoke-Raven @("--home", $FullHome, "health", "trends", "--days", "30", "--format", "json") | ConvertFrom-Json
    Assert-True (($Timeline | Where-Object { $_.record.id -eq $Diet.id -and $_.record.food_name -eq "SmokeFoodSecret" }).Count -eq 1) "Health diet smoke failed"
    Assert-True (($Timeline | Where-Object { $_.record.id -eq $Weight.id -and $_.record.value_num -eq 67.89 }).Count -eq 1) "Health weight smoke failed"
    Assert-True (($Trends.top_diet_tags | Where-Object { $_.name -eq "smoke-diet-tag" -and $_.count -eq 1 }).Count -eq 1) "Health trends tag projection failed"
    Assert-True (($Trends.numeric_series | Where-Object { $_.metric_key -eq "weight" -and $_.points.value -contains 67.89 }).Count -eq 1) "Health trends value projection failed"

    $HealthCheck = Invoke-Raven @("--home", $FullHome, "health-check")
    foreach ($Status in @("todo=ok", "ledger=ok", "health=ok", "media=ok")) {
        Assert-True ($HealthCheck.Contains($Status)) "health-check did not report all stores ready"
    }
    foreach ($Path in @("todo.sqlite", "ledger.sqlite", "health.sqlite", "media/health", "logs/raven.log.jsonl")) {
        Assert-True (Test-Path -LiteralPath (Join-Path $FullHome $Path)) "required data-home path is missing"
    }

    $Token = "raven-smoke-$([Guid]::NewGuid().ToString('N'))"
    $ApiReady = $false
    for ($Launch = 0; $Launch -lt 5 -and -not $ApiReady; $Launch++) {
        $Listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 0)
        $Listener.Start()
        $Port = ([System.Net.IPEndPoint]$Listener.LocalEndpoint).Port
        $Listener.Stop()
        $ApiProcess = Start-Raven @("--home", $FullHome, "api") @{
            RAVEN_API_TOKEN = $Token
            RAVEN_API_BIND_HOST = "127.0.0.1"
            RAVEN_API_BIND_PORT = "$Port"
        }
        $BaseUrl = "http://127.0.0.1:$Port"
        for ($Attempt = 0; $Attempt -lt 20; $Attempt++) {
            try {
                $Dashboard = Invoke-RestMethod -TimeoutSec 1 -Uri "$BaseUrl/api/v1/dashboard" -Headers @{ Authorization = "Bearer $Token" }
                if ($Dashboard.todo.status -eq "ok") { $ApiReady = $true; break }
            } catch {
                if ($ApiProcess.HasExited) { break }
                Start-Sleep -Milliseconds 50
            }
        }
        if (-not $ApiReady) { Stop-Bounded $ApiProcess; $ApiProcess = $null }
    }
    Assert-True $ApiReady "API did not bind an owned loopback port after bounded retries"
    Assert-True ((Invoke-RestMethod -TimeoutSec 5 -Uri "$BaseUrl/healthz").status -eq "ok") "API healthz failed"
    try {
        Invoke-WebRequest -TimeoutSec 5 -Uri "$BaseUrl/api/v1/dashboard" | Out-Null
        throw "API accepted an unauthenticated request"
    } catch {
        Assert-True ($null -ne $_.Exception.Response -and [int]$_.Exception.Response.StatusCode -eq 401) "unexpected unauthenticated status"
    }

    $Headers = @{ Authorization = "Bearer $Token" }
    $Dashboard = Invoke-RestMethod -TimeoutSec 5 -Uri "$BaseUrl/api/v1/dashboard" -Headers $Headers
    $TodoApi = @(Invoke-RestMethod -TimeoutSec 5 -Uri "$BaseUrl/api/v1/todo/items?type=task" -Headers $Headers)
    $LedgerApi = Invoke-RestMethod -TimeoutSec 5 -Uri "$BaseUrl/api/v1/ledger/entries?limit=10" -Headers $Headers
    $HealthApi = Invoke-RestMethod -TimeoutSec 5 -Uri "$BaseUrl/api/v1/health/timeline?limit=10" -Headers $Headers
    $HealthTrends = Invoke-RestMethod -TimeoutSec 5 -Uri "$BaseUrl/api/v1/health/trends?days=30" -Headers $Headers
    Assert-True ($Dashboard.todo.data.today_total -eq 1 -and $Dashboard.todo.data.today_incomplete -eq 1) "Dashboard ToDo projection failed"
    $Krw = @($Dashboard.ledger.data.currencies | Where-Object currency_code -eq "KRW")
    Assert-True ($Krw.Count -eq 1 -and $Krw[0].expense_minor -eq 314159 -and $Krw[0].net_change_minor -eq -314159) "Dashboard Ledger projection failed"
    Assert-True ($Dashboard.health.data.latest_condition.name -eq "SmokeCondition" -and $Dashboard.health.data.latest_condition.value -eq 7) "Dashboard Health projection failed"
    Assert-True (($TodoApi | Where-Object { $_.id -eq $Task.id -and $_.title -eq "Smoke Today Task" }).Count -eq 1) "ToDo API exact record failed"
    Assert-True (($LedgerApi.items | Where-Object { $_.entry.id -eq $LedgerCreated.id -and $_.entry.content -eq "SmokeLedgerSecret" -and $_.entry.amount -eq 314159 }).Count -eq 1) "Ledger API exact record failed"
    Assert-True (($HealthApi.items | Where-Object { $_.record.id -eq $Diet.id -and $_.record.food_name -eq "SmokeFoodSecret" }).Count -eq 1) "Health API diet failed"
    Assert-True (($HealthApi.items | Where-Object { $_.record.id -eq $Weight.id -and $_.record.value_num -eq 67.89 }).Count -eq 1) "Health API metric failed"
    Assert-True (($HealthTrends.numeric_series | Where-Object { $_.metric_key -eq "weight" -and $_.points.value -contains 67.89 }).Count -eq 1) "Health API trends failed"
    Stop-Bounded $ApiProcess
    $ApiProcess = $null

    $UiProcess = Start-Raven @("--home", $FullHome, "ui", "--ui-path", $UiPath, "--port", "0", "--no-open")
    $UiLineTask = $UiProcess.StandardOutput.ReadLineAsync()
    Assert-True ($UiLineTask.Wait(5000)) "UI did not report its port within the readiness bound"
    $UiLine = $UiLineTask.Result
    Assert-True ($UiLine -match "^Raven UI listening on (http://127\.0\.0\.1:\d+)$") "UI reported an invalid authority"
    $UiUrl = $Matches[1]

    $Handler = [System.Net.Http.HttpClientHandler]::new()
    $Handler.AllowAutoRedirect = $false
    $Handler.UseCookies = $false
    $Client = [System.Net.Http.HttpClient]::new($Handler)
    $Client.Timeout = [TimeSpan]::FromSeconds(5)
    $Bootstrap = $Client.GetAsync("$UiUrl/__raven/session").GetAwaiter().GetResult()
    Assert-True ([int]$Bootstrap.StatusCode -eq 303) "UI session bootstrap did not redirect"
    $SetCookie = ($Bootstrap.Headers.GetValues("Set-Cookie") -join "; ")
    Assert-True ($SetCookie -match "HttpOnly" -and $SetCookie -match "SameSite=Strict" -and $SetCookie -match "Path=/") "UI cookie flags are incomplete"
    Assert-True ($SetCookie -match "raven_session=([^;]+)") "UI session cookie is missing"
    $UiSession = $Matches[1]

    $RootRequest = [System.Net.Http.HttpRequestMessage]::new([System.Net.Http.HttpMethod]::Get, "$UiUrl/")
    $RootRequest.Headers.Add("Cookie", "raven_session=$UiSession")
    $RootResponse = $Client.SendAsync($RootRequest).GetAwaiter().GetResult()
    Assert-True ($RootResponse.IsSuccessStatusCode) "UI root fetch failed"
    $ActualUi = $RootResponse.Content.ReadAsByteArrayAsync().GetAwaiter().GetResult()
    $ExpectedUi = [System.IO.File]::ReadAllBytes((Join-Path $UiPath "index.html"))
    Assert-True ($ActualUi.Length -eq $ExpectedUi.Length) "served UI length differs from frontend artifact"
    for ($Index = 0; $Index -lt $ExpectedUi.Length; $Index++) {
        if ($ActualUi[$Index] -ne $ExpectedUi[$Index]) { throw "smoke-raven: served UI differs from frontend artifact" }
    }

    $UnauthRequest = [System.Net.Http.HttpRequestMessage]::new([System.Net.Http.HttpMethod]::Get, "$UiUrl/api/v1/dashboard")
    $UnauthResponse = $Client.SendAsync($UnauthRequest).GetAwaiter().GetResult()
    Assert-True ([int]$UnauthResponse.StatusCode -eq 401) "UI API accepted a request without its session cookie"
    $DashboardRequest = [System.Net.Http.HttpRequestMessage]::new([System.Net.Http.HttpMethod]::Get, "$UiUrl/api/v1/dashboard")
    $DashboardRequest.Headers.Add("Cookie", "raven_session=$UiSession")
    $UiDashboardResponse = $Client.SendAsync($DashboardRequest).GetAwaiter().GetResult()
    Assert-True ($UiDashboardResponse.IsSuccessStatusCode) "cookie-authenticated UI Dashboard failed"
    $UiDashboard = $UiDashboardResponse.Content.ReadAsStringAsync().GetAwaiter().GetResult() | ConvertFrom-Json
    Assert-True ($UiDashboard.todo.data.today_total -eq 1 -and $UiDashboard.ledger.data.currencies[0].expense_minor -eq 314159 -and $UiDashboard.health.data.latest_condition.value -eq 7) "UI Dashboard projections failed"
    Stop-Bounded $UiProcess
    $UiProcess = $null

    $Logs = Get-ChildItem -File -LiteralPath (Join-Path $FullHome "logs")
    foreach ($Secret in @("SmokeLedgerSecret", "314159", "SmokeFoodSecret", "67.89", $Token, $UiSession)) {
        $Match = Select-String -Path $Logs.FullName -SimpleMatch $Secret -Quiet
        Assert-True (-not $Match) "sensitive seeded value or credential appeared in logs"
    }
    foreach ($Log in $Logs) {
        Get-Content -LiteralPath $Log.FullName | ForEach-Object { $_ | ConvertFrom-Json | Out-Null }
    }
} finally {
    Stop-Bounded $UiProcess
    Stop-Bounded $ApiProcess
}

Write-Output "Raven smoke passed: $FullHome"
