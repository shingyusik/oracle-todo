# Windows port of create-mock-db.sh. The bash version cannot run here: python3 is
# a Store stub, and WSL bash sees neither the repo drive nor a usable $HOME.
# Keep the two seeds in step -- scripts/test-create-mock-db.ps1 pins the shape.
[CmdletBinding()]
param(
    # `$HOME` is a PowerShell automatic variable, so the seed target is named DataHome.
    [string]$DataHome
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$defaultHome = Join-Path $repoRoot '.mock-data\todo-engine'
if (-not $DataHome) { $DataHome = $defaultHome }

$DataHome = [System.IO.Path]::GetFullPath($DataHome)
$dbPath = Join-Path $DataHome 'todo.sqlite'

function Test-SamePath {
    param([string]$Left, [string]$Right)
    return [System.IO.Path]::GetFullPath($Left).TrimEnd('\') -ieq
           [System.IO.Path]::GetFullPath($Right).TrimEnd('\')
}

# The live home is canonical. Resolve it the way the engine does (HOME), and cover
# USERPROFILE too so a Windows shell that never sets HOME is still protected.
foreach ($base in @($env:HOME, $env:USERPROFILE)) {
    if ($base -and (Test-SamePath $DataHome (Join-Path $base '.todo-engine'))) {
        throw "refusing to write mock data to live home: $DataHome"
    }
}

$isDefaultHome = Test-SamePath $DataHome $defaultHome
if ((Test-Path -LiteralPath $dbPath) -and -not $isDefaultHome) {
    throw "refusing to overwrite existing database: $dbPath"
}

if ($isDefaultHome -and (Test-Path -LiteralPath $DataHome)) {
    Remove-Item -Recurse -Force -LiteralPath $DataHome
}
New-Item -ItemType Directory -Force -Path $DataHome | Out-Null

$env:TODO_ENGINE_CONSOLE_LOG = 'error'

function Invoke-Todo {
    param([Parameter(ValueFromRemainingArguments = $true)][string[]]$CliArgs)

    # PowerShell decodes a native command's stdout with [Console]::OutputEncoding.
    # The engine emits UTF-8, so on a default Korean console (CP949) a Korean
    # title's bytes misdecode and the lead byte swallows the closing quote --
    # ConvertFrom-Json then chokes on JSON the engine wrote correctly. Pin the
    # decode to UTF-8 for the call and hand the console back as it was.
    $previousEncoding = [Console]::OutputEncoding
    [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
    try {
        $output = & cargo run -q -p todo-engine -- --home $DataHome @CliArgs
        if ($LASTEXITCODE -ne 0) {
            throw "todo-engine failed ($LASTEXITCODE): $($CliArgs -join ' ')"
        }
        return ($output -join "`n")
    }
    finally {
        [Console]::OutputEncoding = $previousEncoding
    }
}

function Get-ItemId {
    param([string]$Json)
    return ($Json | ConvertFrom-Json).id
}

function Set-ItemTags {
    param([string]$ItemId, [string[]]$Tags)

    $tagArgs = @()
    foreach ($tag in $Tags) { $tagArgs += @('--tag', $tag) }
    Invoke-Todo update $ItemId @tagArgs --reason 'mock seed tags' | Out-Null
}

function Format-Day {
    param([datetime]$Date)
    return $Date.ToString('yyyy-MM-dd')
}

$todayDate = (Get-Date).Date
# Python's weekday() is Monday-based; PowerShell's DayOfWeek is Sunday-based.
$weekStart = $todayDate.AddDays(-((([int]$todayDate.DayOfWeek) + 6) % 7))

$today = Format-Day $todayDate
$yesterday = Format-Day $todayDate.AddDays(-1)
$tomorrow = Format-Day $todayDate.AddDays(1)
$yearStart = Format-Day (Get-Date -Year $todayDate.Year -Month 1 -Day 1).Date
$monthStart = Format-Day (Get-Date -Year $todayDate.Year -Month $todayDate.Month -Day 1).Date

$weekDays = @{}
$dayNames = @('mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun')
for ($i = 0; $i -lt $dayNames.Count; $i++) {
    $weekDays[$dayNames[$i]] = Format-Day $weekStart.AddDays($i)
}

Invoke-Todo init | Out-Null

$devArea = Get-ItemId (Invoke-Todo area create '개발' `
        --review-cycle weekly `
        --standard 'UI와 API smoke를 매주 확인' `
        --note 'mock DB 기본 area')

$opsArea = Get-ItemId (Invoke-Todo area create '운영' `
        --review-cycle daily `
        --standard '오늘 보기와 pending 목록이 비어 있지 않을 것')
Set-ItemTags $devArea @('planner', 'dev')
Set-ItemTags $opsArea @('planner', 'ops')

$project = Get-ItemId (Invoke-Todo project propose 'Workbench mock 데이터 점검' `
        --actor user `
        --area $devArea `
        --outcome '현재 UI와 백엔드 API를 실제 SQLite로 점검한다' `
        --definition-of-done 'pending, today, archive 화면에 대표 데이터가 보인다' `
        --due $today)
Invoke-Todo activate $project --reason 'mock seed' | Out-Null
Set-ItemTags $project @('planner', 'workbench')

$dailyProject = Get-ItemId (Invoke-Todo project propose 'Planner daily flow 리허설' `
        --actor user `
        --area $devArea `
        --outcome 'Daily planner의 섹션, 필터, 정렬 상태를 한 번에 확인한다' `
        --definition-of-done '오늘, 어제, 내일, 미지정 할 일이 모두 보인다' `
        --due $tomorrow)
Invoke-Todo activate $dailyProject --reason 'mock seed' | Out-Null
Set-ItemTags $dailyProject @('planner', 'daily', 'focus')

$yearGoal = Get-ItemId (Invoke-Todo goal propose '올해 Workbench 품질 기준 세우기' `
        --actor user `
        --horizon year `
        --scheduled $yearStart `
        --note 'goal 테이블용 year 샘플')
Invoke-Todo activate $yearGoal --reason 'mock seed' | Out-Null
Set-ItemTags $yearGoal @('planner', 'yearly', 'strategy')

$monthGoal = Get-ItemId (Invoke-Todo goal propose '이번 달 UI 데이터 흐름 검증' `
        --actor user `
        --horizon month `
        --scheduled $monthStart `
        --parent $yearGoal `
        --note 'goal 테이블용 month 샘플')
Invoke-Todo activate $monthGoal --reason 'mock seed' | Out-Null
Set-ItemTags $monthGoal @('planner', 'monthly', 'focus')

$weekGoal = Get-ItemId (Invoke-Todo goal propose '이번 주 Planner 실행력 만들기' `
        --actor user `
        --horizon week `
        --scheduled $weekDays['mon'] `
        --parent $monthGoal `
        --note 'weekly planner goal 카드용 샘플')
Invoke-Todo activate $weekGoal --reason 'mock seed' | Out-Null
Set-ItemTags $weekGoal @('planner', 'weekly', 'focus')

$activeTask = Get-ItemId (Invoke-Todo task propose 'Workbench 테이블 편집 플로우 점검' `
        --actor user `
        --area $devArea `
        --scheduled $today `
        --priority 1 `
        --description '행 선택, 상태 전환, 상세 패널 표시를 확인')
Invoke-Todo update $activeTask --project-id $project --reason 'mock seed link' | Out-Null
Invoke-Todo update $activeTask --parent-id $weekGoal --reason 'mock seed goal link' | Out-Null
Invoke-Todo activate $activeTask --reason 'mock seed' | Out-Null
Set-ItemTags $activeTask @('planner', 'daily', 'focus')

$proposedTask = Get-ItemId (Invoke-Todo task propose 'Mock API 응답 확인' `
        --area $devArea `
        --scheduled $today `
        --priority 2 `
        --note 'agent proposed 상태 샘플')
Invoke-Todo update $proposedTask --project-id $project --parent-id $weekGoal --reason 'mock seed link' | Out-Null
Set-ItemTags $proposedTask @('planner', 'api', 'pending')

$overdueTask = Get-ItemId (Invoke-Todo task propose '어제 넘긴 데이터 정리' `
        --actor user `
        --area $opsArea `
        --scheduled $yesterday `
        --priority 1 `
        --description 'Daily planner의 어제 했어야 하는 일 섹션 확인')
Invoke-Todo update $overdueTask --project-id $dailyProject --parent-id $weekGoal --reason 'mock seed link' | Out-Null
Invoke-Todo activate $overdueTask --reason 'mock seed' | Out-Null
Set-ItemTags $overdueTask @('planner', 'overdue', 'ops')

$tomorrowTask = Get-ItemId (Invoke-Todo task propose '내일 오전 planner 필터 확인' `
        --actor user `
        --area $devArea `
        --scheduled $tomorrow `
        --priority 2 `
        --description 'Upcoming 섹션과 날짜 범위 필터 확인')
Invoke-Todo update $tomorrowTask --project-id $dailyProject --parent-id $weekGoal --reason 'mock seed link' | Out-Null
Invoke-Todo activate $tomorrowTask --reason 'mock seed' | Out-Null
Set-ItemTags $tomorrowTask @('planner', 'upcoming', 'focus')

$unscheduledTask = Get-ItemId (Invoke-Todo task propose '날짜 없는 inbox triage' `
        --actor user `
        --area $opsArea `
        --priority 3 `
        --description 'Daily planner의 미지정 섹션 확인')
Invoke-Todo update $unscheduledTask --project-id $dailyProject --reason 'mock seed link' | Out-Null
Invoke-Todo activate $unscheduledTask --reason 'mock seed' | Out-Null
Set-ItemTags $unscheduledTask @('planner', 'inbox', 'ops')

$weeklyDays = @(
    @{ Day = 'mon'; Title = '주간 planner 카드 월요일 점검'; Priority = '1' }
    @{ Day = 'tue'; Title = '주간 planner 카드 화요일 점검'; Priority = '2' }
    @{ Day = 'wed'; Title = '주간 planner 카드 수요일 점검'; Priority = '3' }
    @{ Day = 'thu'; Title = '주간 planner 카드 목요일 점검'; Priority = '2' }
    @{ Day = 'fri'; Title = '주간 planner 카드 금요일 점검'; Priority = '1' }
    @{ Day = 'sat'; Title = '주간 planner 카드 토요일 회고'; Priority = '4' }
    @{ Day = 'sun'; Title = '주간 planner 카드 일요일 준비'; Priority = '4' }
)

foreach ($entry in $weeklyDays) {
    $taskId = Get-ItemId (Invoke-Todo task propose $entry.Title `
            --actor user `
            --area $devArea `
            --scheduled $weekDays[$entry.Day] `
            --priority $entry.Priority `
            --description 'Weekly planner day card fixture')
    Invoke-Todo update $taskId --project-id $dailyProject --parent-id $weekGoal --reason 'mock seed link' | Out-Null
    Invoke-Todo activate $taskId --reason 'mock seed' | Out-Null
    Set-ItemTags $taskId @('planner', 'weekly', 'focus')
}

$doneTask = Get-ItemId (Invoke-Todo task propose '완료 상태 렌더링 확인' `
        --actor user `
        --area $opsArea `
        --scheduled $today `
        --priority 3)
Set-ItemTags $doneTask @('planner', 'completed', 'hidden')
Invoke-Todo complete $doneTask --reason 'mock completed sample' | Out-Null

$archivedTask = Get-ItemId (Invoke-Todo task propose 'archive-list 샘플' `
        --actor user `
        --area $opsArea `
        --scheduled $today)
Set-ItemTags $archivedTask @('planner', 'archive', 'ops')
Invoke-Todo archive $archivedTask --reason 'mock archived sample' | Out-Null

$routine = Get-ItemId (Invoke-Todo routine propose 'Workbench mock DB 스모크' `
        --actor user `
        --area $opsArea `
        --recurrence-rule daily `
        --materialization-policy single_open `
        --note 'today view에 생성 태스크가 보여야 함')
Invoke-Todo activate $routine --reason 'mock seed' | Out-Null
Set-ItemTags $routine @('planner', 'routine', 'ops')
$routineTask = Get-ItemId (Invoke-Todo routine materialize --now $today --lookahead-days 0 --catchup-days 0)
Set-ItemTags $routineTask @('planner', 'routine', 'today')

$todayEvent = Get-ItemId (Invoke-Todo event propose 'Mock API 데모 미팅' "${today}T15:00" `
        --actor user `
        --area $opsArea `
        --project-id $dailyProject `
        --location '온라인' `
        --with 'UI' `
        --with 'backend' `
        --commitment-type meeting `
        --note 'event 카드 표시 확인')
Set-ItemTags $todayEvent @('planner', 'event', 'ops')

$reviewEvent = Get-ItemId (Invoke-Todo event propose '목표 리뷰 캘린더 샘플' "${today}T17:00" `
        --actor user `
        --area $devArea `
        --project-id $project `
        --location '회의실 A' `
        --with 'planning' `
        --commitment-type review `
        --description 'goal/event 테이블 표시 확인용' `
        --note 'event 테이블용 추가 샘플')
Set-ItemTags $reviewEvent @('planner', 'event', 'review')

$tomorrowEvent = Get-ItemId (Invoke-Todo event propose '내일 planner 리뷰' "${tomorrow}T10:30" `
        --actor user `
        --area $devArea `
        --project-id $dailyProject `
        --location '온라인' `
        --with 'planning' `
        --commitment-type review `
        --description 'Daily upcoming 및 weekly event 표시 확인')
Set-ItemTags $tomorrowEvent @('planner', 'event', 'upcoming')

Invoke-Todo health
Write-Output "TODO_ENGINE_HOME=$DataHome"
