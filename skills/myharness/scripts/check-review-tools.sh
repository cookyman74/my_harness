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
  local t="$1" p
  for p in "$HOME"/.nvm/versions/node/*/bin/"$t" \
           "$HOME"/.fnm/node-versions/*/installation/bin/"$t" \
           "$HOME"/.asdf/installs/nodejs/*/bin/"$t" \
           "$HOME"/.volta/tools/image/packages/*/bin/"$t" \
           "$HOME"/.local/share/mise/installs/node/*/bin/"$t" \
           ${PNPM_HOME:+"$PNPM_HOME/$t"} ${NPM_CONFIG_PREFIX:+"$NPM_CONFIG_PREFIX/bin/$t"} \
           "$HOME"/Library/pnpm/"$t" "$HOME"/.local/share/pnpm/"$t" \
           "$HOME"/.npm-global/bin/"$t" "$HOME"/.yarn/bin/"$t" \
           "$HOME"/.bun/bin/"$t" "$HOME"/.local/bin/"$t" \
           /opt/homebrew/bin/"$t" /usr/local/bin/"$t"; do
    # -f 필수: 디렉토리도 search bit 로 -x 가 true 라, `-x` 단독이면 `~/.local/bin/codex/` 같은
    # 디렉토리를 "설치됨"으로 오탐한다. -f 는 심링크를 따라가므로 정상 실행파일은 그대로 통과.
    # 글롭 미매치는 리터럴로 남아 -f 가 false.
    [ -f "$p" ] && [ -x "$p" ] && { printf '%s' "$p"; return 0; }
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
if [ "${#shadow[@]}" -eq 0 ]; then echo "SHADOWED: none"; else echo "SHADOWED: ${shadow[*]}"; fi
exit 0
