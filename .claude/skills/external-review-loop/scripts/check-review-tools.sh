#!/usr/bin/env bash
# 외부 리뷰 도구(codex · claude · agy[antigravity] · gemini CLI) 연동 점검 + 런타임별 리뷰어 산출.
# 독립성 원칙: 리뷰어 엔진 ≠ 러너 엔진(같은 모델=같은 맹점). 러너는 외부 리뷰어에서 제외한다.
#   - Claude Code 런타임(러너=claude) → 외부 리뷰어 = codex(일반) + agy/gemini(성능)
#   - Codex 런타임(러너=codex)        → 외부 리뷰어 = claude(일반) + agy/gemini(성능)
# agy는 Gemini 모델을 제공한다(gemini CLI 후속 — gemini는 legacy 폴백).
# 용도: 하네스 생성 시 external-review-loop 스킬을 만들지 결정 + 생성 스킬의 런타임 폴백.
# 사용: bash check-review-tools.sh [runner]    # runner ∈ claude|codex (생략 시 자동 감지)
# 출력 끝 4줄:
#   AVAILABLE: <설치된 도구 공백구분 | none>
#   RUNNER:    <claude|codex>
#   REVIEWERS: <러너 제외한 사용가능 리뷰어 공백구분 | none>
#   SHADOWED:  <설치돼 있으나 PATH 밖인 도구 "이름=경로" 공백구분 | none>
# 종료코드: 항상 0 (none도 정상 신호). 상태는 끝줄들로만 신뢰할 것
#   — set -e/자동화 파이프라인이 파싱 전 중단되는 것을 막기 위함.
set -uo pipefail

# PATH 밖 설치 탐지(req). `command -v` 는 '지금 이 셸에서 실행 가능한가'만 본다 — 도구가
# 설치돼 있어도 다른 버전 관리자 프리픽스에 있으면 '미설치'로 떨어진다.
# 실측 사례: codex 가 nvm node v22.11.0 전역에만 설치돼 있고 세션 node 가 v24.18.0 이라
# `command -v codex` 실패 → REVIEWERS 가 agy 단독이 됐는데도 게이트는 무경고 통과했다
# (기존 게이트는 REVIEWERS 가 완전히 빌 때만 경고). 결과서엔 "codex+agy 양 엔진 수렴"으로
# 기록되어 교차검증이 실제로는 반쪽이었다는 사실이 남지 않았다.
# → '없는 것'과 '가려진 것'을 구분해 SHADOWED 로 별도 보고한다. 자동 PATH 주입은 하지 않는다
#   (임의 경로 실행은 공급망 리스크 — 사용자가 명시적으로 PATH/설치를 고치게 한다).
probe_shadow() {  # $1=도구명 → 첫 히트 경로를 출력하고 0, 없으면 1
  # 디렉터리를 먼저 glob 하고 그 안에서 이름 후보(`t`·`t.cmd`·`t.exe`)를 본다.
  # 파일 경로를 glob 하면(`*/bin/$t`) `.cmd` 만 있는 디렉터리에서 패턴이 리터럴 `*` 로 남아 확장자 후보가 영영 안 잡힌다
  # (R3 반영 뒤 selftest 무작위 조합 7/30 이 잡음). `"$HOME"` 은 인용해 공백 경로(Windows `C:/Users/Jung Ho`)를 지킨다.
  local t="$1" d c
  for d in "$HOME"/.nvm/versions/node/*/bin \
           "$HOME"/.fnm/node-versions/*/installation/bin \
           "$HOME"/.asdf/installs/nodejs/*/bin \
           "$HOME"/.volta/tools/image/packages/*/bin \
           "$HOME"/.local/share/mise/installs/node/*/bin \
           ${PNPM_HOME:+"$PNPM_HOME"} ${NPM_CONFIG_PREFIX:+"$NPM_CONFIG_PREFIX/bin"} \
           "$HOME"/Library/pnpm "$HOME"/.local/share/pnpm \
           "$HOME"/.npm-global/bin "$HOME"/.yarn/bin \
           "$HOME"/.config/yarn/global/node_modules/.bin "$HOME"/.npm/bin "$HOME"/.npm-packages/bin \
           "$HOME"/.bun/bin "$HOME"/.local/bin \
           /opt/homebrew/bin /usr/local/bin; do
    [ -d "$d" ] || continue
    # Windows Git Bash 의 npm shim 은 `<t>.cmd`·`<t>.exe` 로도 놓인다(R3 codex MED).
    # 확장자 변형은 **내용만으로** 판정한다 — .cmd → 첫 바이트 `@`(npm cmd-shim 은 `@ECHO off`/`@IF EXIST` 로 시작) · .exe → `MZ` 매직.
    #   `-x` 는 보지 않는다: MSYS 의 실행 비트 판정은 확장자·내용에 좌우돼 환경마다 다르다(2026-09-10 windows CI: `.cmd` shim 미탐지).
    #   데이터 파일 오탐(R4 MED)은 내용 검사가 막는다. 커스텀 shim 은 놓칠 수 있다(거짓 음성 = 경고 부재, R3 이전 상태).
    # 확장자 없는 후보는 `-x` 를 요구하되, `<t>.exe` 와 **같은 파일**이면 건너뛴다 — MSYS 는 `<t>` 를 `<t>.exe` 로 자동 보완해
    #   내용 검사 없이 통과시킨다(2026-09-10 windows CI: 가짜 claude.exe 가 SHADOWED 로 오탐). 건너뛰면 .exe 후보가 MZ 검사를 받는다.
    for c in "$d/$t" "$d/$t.cmd" "$d/$t.exe"; do
      [ -f "$c" ] || continue
      case "$c" in
        *.cmd) [ "$(head -c 1 "$c" 2>/dev/null)" = "@" ] || continue ;;
        *.exe) [ "$(head -c 2 "$c" 2>/dev/null)" = "MZ" ] || continue ;;
        *)     [ -x "$c" ] || continue
               [ -e "$c.exe" ] && [ "$c" -ef "$c.exe" ] && continue ;;
      esac
      printf '%s' "$c"; return 0
    done
  done
  return 1
}
avail=()
shadow=()
# codex/claude = 일반/정합성 리뷰어(대형 모델). agy = 성능/안정성(Gemini). gemini = agy 없을 때 legacy.
# 주의: command -v는 '존재'만 확인 — 버전/인증/모델명 유효까지 보장 못 함(Step 2 실행 실패→폴백에 의존).
for t in codex claude agy gemini; do
  if command -v "$t" >/dev/null 2>&1; then
    echo "$t: ✓ 연동됨 ($(command -v "$t"))"
    avail+=("$t")
  elif p="$(probe_shadow "$t")"; then
    echo "$t: ⚠ PATH 밖 설치 ($p) — 이 셸에서 실행 불가, 리뷰어에서 제외됨"
    shadow+=("$t=$p")
  else
    echo "$t: ✗ 미설치"
  fi
done

# 런타임(러너) 감지: 인자 > REVIEW_RUNNER > 휴리스틱. 러너는 외부 리뷰어에서 제외해야 독립성 성립.
# ※ 자동감지는 '보조'다 — 생성된 스킬은 런타임을 알므로 인자/REVIEW_RUNNER로 명시 주입할 것(자기검증 방지).
runner="${1:-${REVIEW_RUNNER:-}}"
# 명시값 검증: claude|codex만 허용. 오타·잘못된 값이 러너 제외를 무력화(REVIEWERS에 러너 잔존)하지 못하게.
if [ -n "$runner" ] && [ "$runner" != "claude" ] && [ "$runner" != "codex" ]; then
  echo "note: runner='$runner' 비허용(claude|codex만) → 무시하고 자동감지로 폴백." >&2
  runner=""
fi
if [ -z "$runner" ]; then
  has_claude=""; has_codex=""
  { [ -n "${CLAUDECODE:-}" ] || [ -n "${CLAUDE_CODE:-}" ]; } && has_claude=1
  { [ -n "${CODEX_SANDBOX:-}" ] || [ -n "${CODEX_HOME:-}" ] || [ -n "${CODEX_THREAD_ID:-}" ]; } && has_codex=1
  if [ -n "$has_claude" ] && [ -n "$has_codex" ]; then
    # 모호: 둘 다 감지(예: Claude Code가 codex exec 자식 spawn → CLAUDECODE 상속). 안전기본 claude + 명시 요구.
    runner="claude"
    echo "note: 런타임 모호(claude·codex env 공존) → claude 가정. 정확히 하려면 인자/REVIEW_RUNNER로 명시할 것." >&2
  elif [ -n "$has_claude" ]; then runner="claude"
  elif [ -n "$has_codex" ]; then runner="codex"
  else
    runner="claude"   # 기본값(가장 흔한 런타임). 명시하려면 인자/REVIEW_RUNNER 사용.
    echo "note: 런타임 자동감지 실패 → claude 가정. 명시하려면 'bash check-review-tools.sh codex'." >&2
  fi
fi

# 권고: agy가 있으면 Gemini 리뷰는 agy로(gemini는 deprecated). 둘 다 있으면 agy 우선.
printf '%s\n' ${avail[@]+"${avail[@]}"} | grep -q '^agy$' && printf '%s\n' ${avail[@]+"${avail[@]}"} | grep -q '^gemini$' && echo "note: agy·gemini 공존 → agy 우선(gemini legacy)"

# 리뷰어 = 사용가능 도구 중 러너 엔진 제외. (codex↔claude는 일반 리뷰어, agy/gemini는 성능 리뷰어)
reviewers=()
for t in ${avail[@]+"${avail[@]}"}; do
  [ -z "$t" ] && continue
  [ "$t" = "$runner" ] && continue   # 러너 엔진 = 외부 리뷰어 자격 없음(독립성)
  reviewers+=("$t")
done
# agy·gemini 공존 시 gemini는 legacy → 리뷰어에서 제외(agy 우선).
if printf '%s\n' ${reviewers[@]+"${reviewers[@]}"} | grep -q '^agy$'; then
  filtered=(); for t in ${reviewers[@]+"${reviewers[@]}"}; do [ "$t" = "gemini" ] || filtered+=("$t"); done; reviewers=(${filtered[@]+"${filtered[@]}"})
fi

# 상태는 끝줄들로만 전달한다. 항상 exit 0.
if [ "${#avail[@]}" -eq 0 ]; then echo "AVAILABLE: none"; else echo "AVAILABLE: ${avail[*]}"; fi
echo "RUNNER: $runner"
if [ "${#reviewers[@]}" -eq 0 ] || [ -z "${reviewers[*]:-}" ]; then echo "REVIEWERS: none"; else echo "REVIEWERS: ${reviewers[*]}"; fi
# 출력 계약이 줄 기반이라 경로에 개행이 있으면 소비자(sed 추출) 쪽에서 잘린다. 경로 구성요소는
# 고정 템플릿 + 고정 도구명이라 실제 발생 가능성은 $HOME/PNPM_HOME/버전 디렉토리명 뿐이고,
# 잘려도 "가려짐" 경고 자체는 그대로 발화하므로 감지 목적은 보전된다(정확한 경로만 손실).
if [ "${#shadow[@]}" -eq 0 ]; then echo "SHADOWED: none"; else echo "SHADOWED: ${shadow[*]}"; fi
exit 0
