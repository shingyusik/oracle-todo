Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$seedScript = Join-Path $PSScriptRoot 'create-mock-db.ps1'
$tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd(
    [IO.Path]::DirectorySeparatorChar,
    [IO.Path]::AltDirectorySeparatorChar
)
$smokeHome = Join-Path $tempRoot "raven-mock-$([guid]::NewGuid())"
$occupiedHome = Join-Path $tempRoot "raven-mock-$([guid]::NewGuid())"

function Assert-True {
    param([bool]$Condition, [string]$Message)

    if (-not $Condition) { throw $Message }
}

function Remove-TestHome {
    param([string]$Path)

    $resolvedPath = [IO.Path]::GetFullPath($Path)
    $tempPrefix = "$tempRoot$([IO.Path]::DirectorySeparatorChar)"
    Assert-True ($resolvedPath.StartsWith($tempPrefix, [StringComparison]::OrdinalIgnoreCase)) "refusing to remove path outside the test temp root: $resolvedPath"
    Assert-True ($resolvedPath -in @($smokeHome, $occupiedHome)) "refusing to remove a path not owned by this test: $resolvedPath"
    if (Test-Path -LiteralPath $resolvedPath) {
        Remove-Item -LiteralPath $resolvedPath -Recurse -Force
    }
}

function Invoke-Raven {
    param([string]$DataHome, [Parameter(ValueFromRemainingArguments = $true)][string[]]$RavenArgs)

    $previousEncoding = [Console]::OutputEncoding
    [Console]::OutputEncoding = [Text.Encoding]::UTF8
    try {
        $output = & cargo run -q -p raven-cli -- --home $DataHome @RavenArgs
        if ($LASTEXITCODE -ne 0) {
            throw "raven failed ($LASTEXITCODE): $($RavenArgs -join ' ')"
        }
        return ($output -join "`n")
    }
    finally {
        [Console]::OutputEncoding = $previousEncoding
    }
}

function Assert-TitleOnce {
    param([object[]]$Items, [string]$Title, [string]$Message)

    Assert-True (@($Items | Where-Object { $_.title -eq $Title }).Count -eq 1) $Message
}

function Get-ChildSignature {
    param([string]$Path)

    Get-ChildItem -LiteralPath $Path -Force |
        ForEach-Object {
            $linkType = $_.PSObject.Properties['LinkType']
            $kind = if ($null -ne $linkType -and $linkType.Value) { "link:$($linkType.Value)" } elseif ($_.PSIsContainer) { 'directory' } else { 'file' }
            "$($_.Name)|$kind"
        } |
        Sort-Object
}

try {
    New-Item -ItemType Directory -Path $occupiedHome | Out-Null
    $sentinel = [Text.Encoding]::UTF8.GetBytes('sentinel ledger bytes')
    [IO.File]::WriteAllBytes((Join-Path $occupiedHome 'ledger.sqlite'), $sentinel)
    $beforeSignature = @(Get-ChildSignature $occupiedHome)
    Assert-True ($beforeSignature.Count -eq 1 -and $beforeSignature[0] -ceq 'ledger.sqlite|file') 'occupied home setup is not sentinel-only'
    $refusal = $null
    try {
        & $seedScript -DataHome $occupiedHome | Out-Null
    }
    catch {
        $refusal = $_
    }
    Assert-True ($null -ne $refusal) 'expected occupied custom home to be rejected'
    Assert-True ($refusal.Exception.Message -like "*refusing to overwrite existing database: $occupiedHome\ledger.sqlite*") 'custom-home refusal did not identify ledger.sqlite'
    $afterSignature = @(Get-ChildSignature $occupiedHome)
    Assert-True ([string]::Join("`n", $beforeSignature) -ceq [string]::Join("`n", $afterSignature)) 'custom-home refusal changed occupied-home contents'
    Assert-True ([Linq.Enumerable]::SequenceEqual([byte[]]$sentinel, [IO.File]::ReadAllBytes((Join-Path $occupiedHome 'ledger.sqlite'))) ) 'custom-home refusal changed sentinel ledger bytes'
    Assert-True (-not (Test-Path -LiteralPath (Join-Path $occupiedHome 'todo.sqlite'))) 'custom-home refusal initialized todo.sqlite'
    Assert-True (-not (Test-Path -LiteralPath (Join-Path $occupiedHome 'health.sqlite'))) 'custom-home refusal initialized health.sqlite'
    Assert-True (-not (Test-Path -LiteralPath (Join-Path $occupiedHome 'media'))) 'custom-home refusal initialized media'

    & $seedScript -DataHome $smokeHome | Out-Null

    $todayDate = (Get-Date).Date
    $today = $todayDate.ToString('yyyy-MM-dd')
    $yesterday = $todayDate.AddDays(-1).ToString('yyyy-MM-dd')
    $tomorrow = $todayDate.AddDays(1).ToString('yyyy-MM-dd')
    $ledgerStart = $todayDate.AddDays(-89).ToString('yyyy-MM-dd')
    $weekStart = $todayDate.AddDays(-((([int]$todayDate.DayOfWeek + 6) % 7))).ToString('yyyy-MM-dd')
    $monthStart = (Get-Date -Year $todayDate.Year -Month $todayDate.Month -Day 1).ToString('yyyy-MM-dd')
    $yearStart = (Get-Date -Year $todayDate.Year -Month 1 -Day 1).ToString('yyyy-MM-dd')

    foreach ($file in @('todo.sqlite', 'ledger.sqlite', 'health.sqlite')) {
        Assert-True (Test-Path -LiteralPath (Join-Path $smokeHome $file) -PathType Leaf) "missing $file"
    }
    Assert-True (Test-Path -LiteralPath (Join-Path $smokeHome 'media/health') -PathType Container) 'missing media/health'

    $yesterdayItems = Invoke-Raven $smokeHome todo date-range $yesterday $yesterday | ConvertFrom-Json
    $todayItems = Invoke-Raven $smokeHome todo date-range $today $today | ConvertFrom-Json
    $tomorrowItems = Invoke-Raven $smokeHome todo date-range $tomorrow $tomorrow | ConvertFrom-Json
    Assert-TitleOnce $yesterdayItems '어제 넘긴 데이터 정리' 'yesterday task is missing or duplicated'
    Assert-TitleOnce $todayItems 'Workbench 테이블 편집 플로우 점검' 'today task is missing or duplicated'
    Assert-TitleOnce $tomorrowItems '내일 오전 planner 필터 확인' 'tomorrow task is missing or duplicated'

    $weekPeriod = Invoke-Raven $smokeHome todo period --horizon week --period $weekStart | ConvertFrom-Json
    $monthPeriod = Invoke-Raven $smokeHome todo period --horizon month --period $monthStart | ConvertFrom-Json
    $yearPeriod = Invoke-Raven $smokeHome todo period --horizon year --period $yearStart | ConvertFrom-Json
    Assert-TitleOnce @($weekPeriod.roots | ForEach-Object { $_.goal }) '이번 주 Planner 실행력 만들기' 'week goal is missing or duplicated'
    Assert-TitleOnce @($monthPeriod.roots | ForEach-Object { $_.goal }) '이번 달 UI 데이터 흐름 검증' 'month goal is missing or duplicated'
    Assert-TitleOnce @($yearPeriod.roots | ForEach-Object { $_.goal }) '올해 Workbench 품질 기준 세우기' 'year goal is missing or duplicated'

    $entryPage = Invoke-Raven $smokeHome ledger entry list --format json | ConvertFrom-Json
    Assert-True ($null -eq $entryPage.next) 'Ledger entry list did not return every fixture entry.'
    $entries = $entryPage.items
    Assert-True (@($entries | Where-Object { $_.date -lt $ledgerStart -or $_.date -gt $today }).Count -eq 0) 'Ledger contains stale dates.'

    $summary = Invoke-Raven $smokeHome ledger reports --from $ledgerStart --to $today --format json | ConvertFrom-Json
    $krwSummary = @($summary.currencies | Where-Object { $_.currency_code -eq 'KRW' })
    Assert-True ($krwSummary.Count -eq 1 -and $krwSummary[0].income_minor -gt 0 -and $krwSummary[0].expense_minor -gt 0) 'Ledger report totals are empty.'

    $categories = Invoke-Raven $smokeHome ledger reports --from $ledgerStart --to $today --by category --format json | ConvertFrom-Json
    $expenseCategoryCount = @($categories | Where-Object { $_.expense_minor -gt 0 }).Count
    Assert-True ($expenseCategoryCount -ge 8) "Ledger needs at least eight expense categories (found $expenseCategoryCount)."

    $balances = (Invoke-Raven $smokeHome ledger balances --format json | ConvertFrom-Json).items
    Assert-True (@($balances | Where-Object { $_.current_balance_minor -gt 0 }).Count -ge 1) 'positive asset balance is missing'
    Assert-True (@($balances | Where-Object { $_.account_name -eq 'Credit card' -and $_.current_balance_minor -lt 0 }).Count -eq 1) 'negative Credit card balance is missing'
    Assert-True (@($balances | Where-Object { $_.account_name -eq 'USD wallet' -and $_.currency_code -eq 'USD' -and $_.current_balance_minor -gt 0 }).Count -eq 1) 'positive USD wallet is missing'

    $usdEntries = (Invoke-Raven $smokeHome ledger entry list --account 'USD wallet' --format json | ConvertFrom-Json).items
    Assert-True (@($usdEntries).Count -eq 0) 'USD wallet must be balance-only'

    $transferGroups = @($entries | Where-Object { $_.transfer_group_id } | Group-Object transfer_group_id)
    $validTransferGroups = @($transferGroups | Where-Object {
        $_.Count -eq 2 -and
        @($_.Group | Where-Object { $_.entry_type -eq 'transfer_out' }).Count -eq 1 -and
        @($_.Group | Where-Object { $_.entry_type -eq 'transfer_in' }).Count -eq 1
    })
    Assert-True ($transferGroups.Count -eq 1 -and $validTransferGroups.Count -eq 1) 'transfer pair is missing or malformed'
}
finally {
    Remove-TestHome $smokeHome
    Remove-TestHome $occupiedHome
}
