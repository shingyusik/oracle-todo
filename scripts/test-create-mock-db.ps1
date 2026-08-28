Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$seedScript = Join-Path $PSScriptRoot 'create-mock-db.ps1'
$tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd(
    [IO.Path]::DirectorySeparatorChar,
    [IO.Path]::AltDirectorySeparatorChar
)
$smokeHome = Join-Path $tempRoot "raven-mock-$([guid]::NewGuid())"
$occupiedHome = Join-Path $tempRoot "raven-mock-$([guid]::NewGuid())"
$ravenHome = Join-Path $tempRoot "raven-mock-$([guid]::NewGuid())"
$hadConsoleLog = Test-Path Env:RAVEN_CONSOLE_LOG
$consoleLogBefore = $env:RAVEN_CONSOLE_LOG

function Assert-True {
    param([bool]$Condition, [string]$Message)

    if (-not $Condition) { throw $Message }
}

function Remove-TestHome {
    param([string]$Path)

    $resolvedPath = [IO.Path]::GetFullPath($Path)
    $tempPrefix = "$tempRoot$([IO.Path]::DirectorySeparatorChar)"
    Assert-True ($resolvedPath.StartsWith($tempPrefix, [StringComparison]::OrdinalIgnoreCase)) "refusing to remove path outside the test temp root: $resolvedPath"
    Assert-True ($resolvedPath -in @($smokeHome, $occupiedHome, $ravenHome)) "refusing to remove a path not owned by this test: $resolvedPath"
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

    New-Item -ItemType Directory -Path $ravenHome | Out-Null
    $ravenHomeBefore = @(Get-ChildSignature $ravenHome)
    $hadRavenHome = Test-Path Env:RAVEN_HOME
    $ravenHomeBeforeEnvironment = $env:RAVEN_HOME
    try {
        $env:RAVEN_HOME = $ravenHome
        $ravenHomeRefusal = $null
        try {
            & $seedScript -DataHome $ravenHome | Out-Null
        }
        catch {
            $ravenHomeRefusal = $_
        }
        Assert-True ($null -ne $ravenHomeRefusal) 'expected RAVEN_HOME to be rejected'
        Assert-True (([string]::Join("`n", $ravenHomeBefore)) -ceq ([string]::Join("`n", @(Get-ChildSignature $ravenHome)))) 'RAVEN_HOME refusal created data'
    }
    finally {
        if ($hadRavenHome) { $env:RAVEN_HOME = $ravenHomeBeforeEnvironment }
        else { Remove-Item Env:RAVEN_HOME -ErrorAction SilentlyContinue }
    }

    $beforeSeedDate = (Get-Date).Date
    & $seedScript -DataHome $smokeHome | Out-Null
    $afterSeedDate = (Get-Date).Date
    Assert-True ((Test-Path Env:RAVEN_CONSOLE_LOG) -eq $hadConsoleLog -and $env:RAVEN_CONSOLE_LOG -ceq $consoleLogBefore) 'seed changed caller RAVEN_CONSOLE_LOG'

    foreach ($file in @('todo.sqlite', 'ledger.sqlite', 'health.sqlite')) {
        Assert-True (Test-Path -LiteralPath (Join-Path $smokeHome $file) -PathType Leaf) "missing $file"
    }
    Assert-True (Test-Path -LiteralPath (Join-Path $smokeHome 'media/health') -PathType Container) 'missing media/health'

    $entryPage = Invoke-Raven $smokeHome ledger entry list --format json | ConvertFrom-Json
    Assert-True ($null -eq $entryPage.next -and @($entryPage.items).Count -eq 22) 'Ledger entry list did not return the exact fixture.'
    $entries = $entryPage.items
    $todayEntry = @($entries | Where-Object { $_.content -eq 'Today coffee and movie' })
    Assert-True ($todayEntry.Count -eq 1) 'today anchor entry is missing or duplicated'
    $todayDate = [datetime]::ParseExact($todayEntry[0].date, 'yyyy-MM-dd', [Globalization.CultureInfo]::InvariantCulture).Date
    Assert-True ($todayDate -eq $beforeSeedDate -or $todayDate -eq $afterSeedDate) 'today anchor is stale'
    $today = $todayDate.ToString('yyyy-MM-dd')
    $yesterday = $todayDate.AddDays(-1).ToString('yyyy-MM-dd')
    $tomorrow = $todayDate.AddDays(1).ToString('yyyy-MM-dd')
    $ledgerStart = $todayDate.AddDays(-89).ToString('yyyy-MM-dd')
    $weekStart = $todayDate.AddDays(-((([int]$todayDate.DayOfWeek + 6) % 7))).ToString('yyyy-MM-dd')
    $monthStart = (Get-Date -Year $todayDate.Year -Month $todayDate.Month -Day 1).ToString('yyyy-MM-dd')
    $yearStart = (Get-Date -Year $todayDate.Year -Month 1 -Day 1).ToString('yyyy-MM-dd')
    Assert-True (@($entries | Where-Object { $_.date -lt $ledgerStart -or $_.date -gt $today }).Count -eq 0) 'Ledger contains stale dates.'

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

    $summary = Invoke-Raven $smokeHome ledger reports --from $ledgerStart --to $today --format json | ConvertFrom-Json
    $krwSummary = @($summary.currencies | Where-Object { $_.currency_code -eq 'KRW' })
    Assert-True ($krwSummary.Count -eq 1 -and $krwSummary[0].income_minor -eq 10050000 -and $krwSummary[0].expense_minor -eq 3065000) 'Ledger report totals differ from the fixture.'

    $categories = Invoke-Raven $smokeHome ledger reports --from $ledgerStart --to $today --by category --format json | ConvertFrom-Json
    $expenseCategoryCount = @($categories | Where-Object { $_.expense_minor -gt 0 }).Count
    Assert-True ($expenseCategoryCount -ge 8) "Ledger needs at least eight expense categories (found $expenseCategoryCount)."

    $balances = (Invoke-Raven $smokeHome ledger balances --format json | ConvertFrom-Json).items
    $balanceSignatures = @($balances | ForEach-Object { "$($_.account_name)|$($_.current_balance_minor)" } | Sort-Object)
    $expectedBalances = @('Cash|276000', 'Checking|10509000', 'Credit card|-650000', 'Savings|6500000', 'USD wallet|125000')
    Assert-True (([string]::Join("`n", $balanceSignatures)) -ceq ([string]::Join("`n", $expectedBalances))) 'Ledger balances differ from the fixture.'

    $usdEntries = (Invoke-Raven $smokeHome ledger entry list --account 'USD wallet' --format json | ConvertFrom-Json).items
    Assert-True (@($usdEntries).Count -eq 0) 'USD wallet must be balance-only'

    $transferEntries = @($entries | Where-Object { $_.transfer_group_id })
    $transferOut = @($transferEntries | Where-Object { $_.entry_type -eq 'transfer_out' })
    $transferIn = @($transferEntries | Where-Object { $_.entry_type -eq 'transfer_in' })
    Assert-True ($transferEntries.Count -eq 2 -and $transferOut.Count -eq 1 -and $transferIn.Count -eq 1) 'transfer pair is missing or malformed'
    foreach ($transferEntry in $transferEntries) {
        Assert-True ($transferEntry.date -eq $todayDate.AddDays(-7).ToString('yyyy-MM-dd') -and $transferEntry.amount_minor -eq 500000 -and $transferEntry.content -eq 'Mock savings transfer' -and $transferEntry.source -eq 'mock-seed') 'transfer values differ from the fixture'
    }
    Assert-True ($transferOut[0].account_name -eq 'Checking' -and $transferIn[0].account_name -eq 'Savings') 'transfer accounts differ from the fixture'
    Assert-True (-not [string]::IsNullOrWhiteSpace($transferOut[0].transfer_group_id) -and $transferOut[0].transfer_group_id -eq $transferIn[0].transfer_group_id) 'transfer group id is missing or mismatched'

    $nonTransferEntries = @($entries | Where-Object { -not $_.transfer_group_id })
    $actualEntrySignatures = @($nonTransferEntries | ForEach-Object { "$($_.date)|$($_.entry_type)|$($_.amount_minor)|$($_.account_name)|$($_.category_name)|$($_.content)|$($_.source)" } | Sort-Object)
    $fixtureRows = @(
        @(-85, 'income', '3200000', 'Checking', 'Salary', 'Monthly salary 1'), @(-82, 'expense', '120000', 'Checking', 'Food', 'Groceries 1'), @(-75, 'expense', '800000', 'Checking', 'Housing', 'Monthly rent 1'), @(-70, 'expense', '45000', 'Checking', 'Transport', 'Transit pass'), @(-64, 'expense', '135000', 'Checking', 'Utilities', 'Utilities 1'), @(-58, 'expense', '72000', 'Checking', 'Health', 'Clinic'), @(-52, 'income', '3200000', 'Checking', 'Salary', 'Monthly salary 2'), @(-48, 'expense', '185000', 'Checking', 'Shopping', 'Household goods'), @(-43, 'expense', '95000', 'Checking', 'Leisure', 'Weekend outing'), @(-39, 'expense', '210000', 'Checking', 'Education', 'Course'), @(-34, 'expense', '19000', 'Checking', 'Subscriptions', 'Streaming'), @(-29, 'expense', '138000', 'Checking', 'Food', 'Groceries 2'), @(-23, 'income', '3200000', 'Checking', 'Salary', 'Monthly salary 3'), @(-20, 'expense', '800000', 'Checking', 'Housing', 'Monthly rent 2'), @(-16, 'expense', '62000', 'Checking', 'Transport', 'Taxi and transit'), @(-12, 'expense', '148000', 'Checking', 'Utilities', 'Utilities 2'), @(-9, 'income', '450000', 'Checking', 'Freelance', 'Side project'), @(-6, 'expense', '87000', 'Checking', 'Food', 'Groceries 3'), @(-3, 'expense', '125000', 'Checking', 'Shopping', 'Recent shopping'), @(0, 'expense', '24000', 'Cash', 'Leisure', 'Today coffee and movie')
    )
    $expectedEntrySignatures = @($fixtureRows | ForEach-Object { "$($todayDate.AddDays([int]$_[0]).ToString('yyyy-MM-dd'))|$($_[1])|$($_[2])|$($_[3])|$($_[4])|$($_[5])|mock-seed" } | Sort-Object)
    Assert-True ($nonTransferEntries.Count -eq 20 -and ([string]::Join("`n", $actualEntrySignatures)) -ceq ([string]::Join("`n", $expectedEntrySignatures))) 'non-transfer entries differ from the fixture'
}
finally {
    Remove-TestHome $smokeHome
    Remove-TestHome $occupiedHome
    Remove-TestHome $ravenHome
}
