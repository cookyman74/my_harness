[CmdletBinding()]
param(
    [string]$CodexHome = (Join-Path $HOME '.codex'),
    [string]$ProjectRoot = $PSScriptRoot,
    [string]$SourceRoot = (Join-Path $PSScriptRoot 'skills\myharness'),
    [switch]$SkipReviewCheck
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function New-HarnessLink {
    param(
        [Parameter(Mandatory)][string]$LinkPath,
        [Parameter(Mandatory)][string]$TargetPath,
        [string]$GitPlaceholder
    )

    $target = (Resolve-Path -LiteralPath $TargetPath).Path
    $parent = Split-Path -Parent $LinkPath
    New-Item -ItemType Directory -Force -Path $parent | Out-Null

    if (Test-Path -LiteralPath $LinkPath) {
        $item = Get-Item -LiteralPath $LinkPath -Force
        $isLink = [bool]($item.Attributes -band [IO.FileAttributes]::ReparsePoint)
        $isPlaceholder = $false
        if (-not $isLink -and -not $item.PSIsContainer -and $GitPlaceholder) {
            $isPlaceholder = ((Get-Content -Raw -LiteralPath $LinkPath).Trim() -eq $GitPlaceholder)
        }

        if ($isLink -or $isPlaceholder) {
            Remove-Item -LiteralPath $LinkPath -Force
        }
        else {
            $backup = "$LinkPath.bak.$(Get-Date -Format 'yyyyMMddHHmmss')"
            Move-Item -LiteralPath $LinkPath -Destination $backup
            Write-Host "기존 경로 백업: $backup"
        }
    }

    try {
        New-Item -ItemType Junction -Path $LinkPath -Target $target -ErrorAction Stop | Out-Null
        Write-Host "연결: $LinkPath -> $target (junction)"
    }
    catch {
        try {
            New-Item -ItemType SymbolicLink -Path $LinkPath -Target $target -ErrorAction Stop | Out-Null
            Write-Host "연결: $LinkPath -> $target (symlink)"
        }
        catch {
            Copy-Item -LiteralPath $target -Destination $LinkPath -Recurse
            Write-Warning "링크 생성 권한/파일시스템 제약으로 복사 설치했습니다: $LinkPath"
        }
    }
}

if (-not (Test-Path -LiteralPath (Join-Path $SourceRoot 'SKILL.md'))) {
    throw "정본 스킬을 찾을 수 없습니다: $SourceRoot"
}

Write-Host '== 하네스 팩토리 Windows/Codex 설치 =='
New-HarnessLink `
    -LinkPath (Join-Path $CodexHome 'skills\myharness') `
    -TargetPath $SourceRoot
New-HarnessLink `
    -LinkPath (Join-Path $ProjectRoot '.agents\skills\myharness') `
    -TargetPath $SourceRoot `
    -GitPlaceholder '../../skills/myharness'

$agentsFile = Join-Path $ProjectRoot 'AGENTS.md'
if (Test-Path -LiteralPath $agentsFile) {
    Write-Host 'Codex: AGENTS.md 존재'
}
else {
    Write-Warning "AGENTS.md 없음: $agentsFile"
}

if (-not $SkipReviewCheck) {
    $checkScript = Join-Path $SourceRoot 'scripts\check-review-tools.sh'
    if (Get-Command bash -ErrorAction SilentlyContinue) {
        & bash $checkScript codex
    }
    else {
        Write-Warning 'bash 없음: 외부 리뷰 도구 점검을 생략합니다.'
    }
}

Write-Host '설치 완료. Codex를 재시작한 뒤 `$myharness` 또는 `/skills`로 확인하세요.'
