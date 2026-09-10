#!/usr/bin/env bash
# check-review-tools.sh 행동 자기검증 — "탐지 스크립트가 실제로 환경에 반응하는가".
# 배경: v1.7.5 에 5줄 스텁(REVIEWERS 고정 출력)이 릴리스됐다(d33d304). 텍스트 가드(command -v 존재 등)는
#   부분 스텁(탐지 루프 일부 + 고정 출력)을 통과시키고(R1 codex HIGH), 정상 리팩터를 FAIL 시킨다(R1 codex LOW).
#   그래서 텍스트를 보지 않고 **격리된 PATH/HOME 에서 실행해 출력이 바뀌는지**만 본다.
# R2 반영: mktemp 실패 시 GT="" 로 절대경로를 건드리던 결함(HIGH) → rc 검사 후 exit 2 · 종료코드 미검사(HIGH) → 비0이면 FAIL ·
#   고정 관측값(codex·v0.0.0)만 흉내내는 모방 스텁 → 가짜 도구명·PATH 밖 경로를 실행마다 무작위화 + 러너=codex 케이스 추가 ·
#   CRLF 출력이 `none\r` 로 비교 실패(MED) → CR 제거.
# 규칙: `… | grep -q` 를 쓰지 않는다(pipefail + SIGPIPE 거짓 실패 — run-policy-audit.sh:41 · PR #6 rc=141 실측). case 패턴으로 본다.
# 한계: 우발적 스텁 차단이 목적이다. 검사 로직을 읽고 맞춤 제작한 위장은 대상이 아니다(무작위화는 비용을 올릴 뿐 막지 못한다).
# 사용: bash selftest-review-tools.sh [path/to/check-review-tools.sh]   → 0=PASS 1=FAIL 2=사용·환경 오류
set -u
CRT="${1:-$(dirname "$0")/check-review-tools.sh}"
[ -f "$CRT" ] || { echo "SELFTEST: ERROR — 파일 없음: $CRT"; exit 2; }
GT="$(mktemp -d 2>/dev/null)" || GT=""
[ -n "$GT" ] && [ -d "$GT" ] || { echo "SELFTEST: ERROR — mktemp -d 실패(TMPDIR='${TMPDIR:-}') — 격리 디렉터리 없이는 실행하지 않는다"; exit 2; }
trap 'rm -rf "$GT"' EXIT
mkdir -p "$GT/bin" "$GT/home" || { echo "SELFTEST: ERROR — 격리 디렉터리 생성 실패"; exit 2; }

# 무작위화: 가짜 도구와 PATH 밖 경로를 실행마다 바꾼다. 관측값을 상수로 박은 모방 스텁은 어느 한 조합에서 깨진다.
tools=(codex agy gemini); i=$((RANDOM % 3)); T_PATH="${tools[$i]}"; T_SHADOW="${tools[$(( (i+1) % 3 ))]}"
shadow_dirs=(".nvm/versions/node/v$((RANDOM%20)).$((RANDOM%20)).$((RANDOM%20))/bin" ".npm-global/bin" ".bun/bin" ".yarn/bin" ".config/yarn/global/node_modules/.bin")
SD="${shadow_dirs[$((RANDOM % ${#shadow_dirs[@]}))]}"

# 격리: HOME 을 비우고 PATH 는 가짜 bin + 시스템 유틸(bash·grep·sed)만. probe_shadow 의 시스템 경로(/opt/homebrew/bin·/usr/local/bin)에
# 진짜 도구가 있는 머신에선 SHADOWED 에 잡힐 수 있으므로 케이스 ①은 SHADOWED 를 단정하지 않는다.
RC=0
run(){ # $1=runner
  PATH="$GT/bin:/usr/bin:/bin" HOME="$GT/home" PNPM_HOME= NPM_CONFIG_PREFIX= CLAUDECODE= CLAUDE_CODE= CODEX_HOME= CODEX_SANDBOX= CODEX_THREAD_ID= \
    bash "$CRT" "$1" 2>/dev/null; RC=$?; }
fail=0; f(){ echo "  ✗ $1"; fail=1; }; ok(){ echo "  ✓ $1"; }
# 계약 줄만 뽑아 본다 — 전체 출력에 와일드카드를 대면 뒤따르는 줄(SHADOWED: agy=…)이 AVAILABLE 단정에 섞인다(자기검증에서 실제로 오탐). CR 제거(R2 MED).
line(){ printf '%s\n' "$2" | tr -d '\r' | sed -n "s/^$1: //p" | tail -1; }
fake(){ printf '#!/bin/sh\nexit 0\n' > "$1" && chmod +x "$1"; }

# ① 도구 전무
o1="$(run claude)"; [ "$RC" -eq 0 ] && ok "① 종료코드 0" || f "① 종료코드 $RC (계약 위반)"
[ "$(line AVAILABLE "$o1")" = "none" ] && ok "① 도구 없음 → AVAILABLE: none" || f "① 도구 없음인데 AVAILABLE='$(line AVAILABLE "$o1")' (고정 출력 의심)"
[ "$(line REVIEWERS "$o1")" = "none" ] && ok "① 도구 없음 → REVIEWERS: none" || f "① 도구 없음인데 REVIEWERS='$(line REVIEWERS "$o1")' (고정 출력 의심)"

# ② 가짜 $T_PATH 가 PATH 에
fake "$GT/bin/$T_PATH"
o2="$(run claude)"; [ "$RC" -eq 0 ] || f "② 종료코드 $RC"
case " $(line AVAILABLE "$o2") " in *" $T_PATH "*) ok "② PATH 의 $T_PATH → AVAILABLE 에 반영";; *) f "② PATH 에 $T_PATH 를 넣었는데 AVAILABLE='$(line AVAILABLE "$o2")' (탐지 안 함)";; esac
case " $(line REVIEWERS "$o2") " in *" $T_PATH "*) ok "② 러너 claude → REVIEWERS 에 $T_PATH";; *) f "② REVIEWERS='$(line REVIEWERS "$o2")' — PATH 변화에 반응하지 않음";; esac

# ③ 가짜 $T_SHADOW 가 PATH 밖($SD)
mkdir -p "$GT/home/$SD"; fake "$GT/home/$SD/$T_SHADOW"
o3="$(run claude)"; [ "$RC" -eq 0 ] || f "③ 종료코드 $RC"
case " $(line SHADOWED "$o3") " in *" $T_SHADOW="*) ok "③ PATH 밖($SD) $T_SHADOW → SHADOWED 에 반영";; *) f "③ SHADOWED='$(line SHADOWED "$o3")' — PATH 밖 설치($SD)를 보고하지 않음";; esac
case " $(line AVAILABLE "$o3") " in *" $T_SHADOW "*) f "③ PATH 밖 $T_SHADOW 가 AVAILABLE 에 있음(가려진 것을 가용으로 오판)";; *) ok "③ PATH 밖 $T_SHADOW 는 AVAILABLE 에 없음";; esac

# ④ 러너=codex: 가짜 claude·codex 둘 다 PATH 에 → REVIEWERS 에 claude 는 있고 codex 는 없어야(러너 제외 독립성)
fake "$GT/bin/claude"; fake "$GT/bin/codex"
o4="$(run codex)"; [ "$RC" -eq 0 ] || f "④ 종료코드 $RC"
[ "$(line RUNNER "$o4")" = "codex" ] && ok "④ RUNNER: codex 인자 반영" || f "④ RUNNER='$(line RUNNER "$o4")' — 인자를 무시"
case " $(line REVIEWERS "$o4") " in *" codex "*) f "④ 러너 codex 가 REVIEWERS 에 있음(독립성 위반)";; *" claude "*) ok "④ 러너 codex → REVIEWERS 에 claude, codex 제외";; *) f "④ REVIEWERS='$(line REVIEWERS "$o4")' — claude 가 없음";; esac

[ $fail -eq 0 ] && { echo "SELFTEST: PASS ($CRT · fake=$T_PATH shadow=$T_SHADOW@$SD)"; exit 0; } || { echo "SELFTEST: FAIL ($CRT · fake=$T_PATH shadow=$T_SHADOW@$SD)"; exit 1; }
