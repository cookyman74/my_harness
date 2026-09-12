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
run(){ # $1=runner → 출력은 stdout(호출자가 $(cat "$GT/out") 로 읽음), 종료코드는 부모 셸 변수 RC.
  # ⚠ `o="$(run …)"` 안에서 RC=$? 를 대입하면 **서브셸에서 죽어 부모에 안 온다**(R4 codex HIGH — R2 의 "종료코드 검사"는 한 번도 동작하지 않았다).
  #   그래서 명령치환 밖에서 실행하고 출력은 파일로 받는다. 픽스처가 다른 단정에서 먼저 깨져 이 죽은 검사를 가렸다 — 결함 하나만 격리한 픽스처(exit 7 단독)를 tests 에 추가.
  PATH="$GT/bin:/usr/bin:/bin" HOME="$GT/home" PNPM_HOME= NPM_CONFIG_PREFIX= CLAUDECODE= CLAUDE_CODE= CODEX_HOME= CODEX_SANDBOX= CODEX_THREAD_ID= \
    bash "$CRT" "$1" >"$GT/out" 2>/dev/null; RC=$?; }
out(){ cat "$GT/out"; }
fail=0; f(){ echo "  ✗ $1"; fail=1; }; ok(){ echo "  ✓ $1"; }
# 계약 줄만 뽑아 본다 — 전체 출력에 와일드카드를 대면 뒤따르는 줄(SHADOWED: agy=…)이 AVAILABLE 단정에 섞인다(자기검증에서 실제로 오탐). CR 제거(R2 MED).
line(){ printf '%s\n' "$2" | tr -d '\r' | sed -n "s/^$1: //p" | tail -1; }
fake(){ printf '#!/bin/sh\nexit 0\n' > "$1" && chmod +x "$1"; }

# ① 도구 전무
run claude; o1="$(out)"; [ "$RC" -eq 0 ] && ok "① 종료코드 0" || f "① 종료코드 $RC (계약 위반)"
[ "$(line AVAILABLE "$o1")" = "none" ] && ok "① 도구 없음 → AVAILABLE: none" || f "① 도구 없음인데 AVAILABLE='$(line AVAILABLE "$o1")' (고정 출력 의심)"
[ "$(line REVIEWERS "$o1")" = "none" ] && ok "① 도구 없음 → REVIEWERS: none" || f "① 도구 없음인데 REVIEWERS='$(line REVIEWERS "$o1")' (고정 출력 의심)"

# ② 가짜 $T_PATH 가 PATH 에
fake "$GT/bin/$T_PATH"
run claude; o2="$(out)"; [ "$RC" -eq 0 ] || f "② 종료코드 $RC"
case " $(line AVAILABLE "$o2") " in *" $T_PATH "*) ok "② PATH 의 $T_PATH → AVAILABLE 에 반영";; *) f "② PATH 에 $T_PATH 를 넣었는데 AVAILABLE='$(line AVAILABLE "$o2")' (탐지 안 함)";; esac
case " $(line REVIEWERS "$o2") " in *" $T_PATH "*) ok "② 러너 claude → REVIEWERS 에 $T_PATH";; *) f "② REVIEWERS='$(line REVIEWERS "$o2")' — PATH 변화에 반응하지 않음";; esac

# ③ 가짜 $T_SHADOW 가 PATH 밖($SD)
mkdir -p "$GT/home/$SD"; fake "$GT/home/$SD/$T_SHADOW"
run claude; o3="$(out)"; [ "$RC" -eq 0 ] || f "③ 종료코드 $RC"
case " $(line SHADOWED "$o3") " in *" $T_SHADOW="*) ok "③ PATH 밖($SD) $T_SHADOW → SHADOWED 에 반영";; *) f "③ SHADOWED='$(line SHADOWED "$o3")' — PATH 밖 설치($SD)를 보고하지 않음";; esac
case " $(line AVAILABLE "$o3") " in *" $T_SHADOW "*) f "③ PATH 밖 $T_SHADOW 가 AVAILABLE 에 있음(가려진 것을 가용으로 오판)";; *) ok "③ PATH 밖 $T_SHADOW 는 AVAILABLE 에 없음";; esac

# ⑤ 세 번째 도구(T3 ∉ {T_PATH,T_SHADOW})를 PATH 밖 다른 경로에 `.cmd` 로만 → SHADOWED 에 반영(R3 codex MED: Git Bash npm shim)
#   ④ 보다 앞에 둔다 — ④ 가 가짜 codex·claude 를 PATH 에 넣으면 T3=codex 조합에서 codex 가 "가용"이 돼 probe 를 타지 않는다(1/3 확률 거짓 FAIL, 실측 4/10).
T3="${tools[$(( (i+2) % 3 ))]}"; SD2="${shadow_dirs[$(( ($(printf '%s' "$SD" | wc -c) + 1) % ${#shadow_dirs[@]} ))]}"; [ "$SD2" = "$SD" ] && SD2=".local/bin"
mkdir -p "$GT/home/$SD2"; printf '@echo off\r\n' > "$GT/home/$SD2/$T3.cmd"; chmod +x "$GT/home/$SD2/$T3.cmd"   # MSYS 는 .cmd 를 확장자로 실행 가능 판정 — 비Windows 시뮬레이션은 chmod
run claude; o5="$(out)"; [ "$RC" -eq 0 ] || f "⑤ 종료코드 $RC"
case " $(line SHADOWED "$o5") " in *" $T3="*) ok "⑤ PATH 밖($SD2) $T3.cmd → SHADOWED 에 반영";; *) f "⑤ SHADOWED='$(line SHADOWED "$o5")' — .cmd shim 을 보고하지 않음";; esac

# ⑥ 데이터 파일이 shim 이름·실행 비트만 갖춘 경우(MSYS 는 확장자만으로 -x 참) → SHADOWED 에 **없어야**(R5 codex MED). 대상은 아직 아무 데도 없는 `claude`.
printf 'not a shim\n' > "$GT/home/$SD/claude.cmd"; chmod +x "$GT/home/$SD/claude.cmd"; printf 'data' > "$GT/home/$SD/claude.exe"; chmod +x "$GT/home/$SD/claude.exe"
run claude; o6="$(out)"; [ "$RC" -eq 0 ] || f "⑥ 종료코드 $RC"
case " $(line SHADOWED "$o6") " in *" claude="*) f "⑥ 내용 없는 claude.cmd/.exe 가 SHADOWED 에 잡힘(데이터 파일 오탐) — SHADOWED='$(line SHADOWED "$o6")'";; *) ok "⑥ 내용 없는 .cmd/.exe 는 SHADOWED 에 없음";; esac
rm -f "$GT/home/$SD/claude.cmd" "$GT/home/$SD/claude.exe"

# ⑦ 실행 비트 없는 진짜 shim(`@` 로 시작하는 .cmd) → SHADOWED 에 **있어야**(MSYS 가 .cmd 에 -x 를 세우지 않는 환경 재현 · windows CI 2026-09-10)
printf '@ECHO off\r\n' > "$GT/home/$SD/claude.cmd"; chmod -x "$GT/home/$SD/claude.cmd" 2>/dev/null
run claude; o7="$(out)"; [ "$RC" -eq 0 ] || f "⑦ 종료코드 $RC"
case " $(line SHADOWED "$o7") " in *" claude="*) ok "⑦ 실행 비트 없는 .cmd shim 도 SHADOWED 에 반영";; *) f "⑦ 실행 비트 없는 claude.cmd shim 을 보고하지 않음 — SHADOWED='$(line SHADOWED "$o7")'";; esac
rm -f "$GT/home/$SD/claude.cmd"

# ⑧ 확장자 없는 이름이 .exe 와 같은 파일(하드링크 — MSYS 의 .exe 자동 보완 재현) + 내용이 가짜 → SHADOWED 에 **없어야**
printf 'data' > "$GT/home/$SD/claude.exe"
if ln "$GT/home/$SD/claude.exe" "$GT/home/$SD/claude" 2>/dev/null; then
  chmod +x "$GT/home/$SD/claude" 2>/dev/null
  run claude; o8="$(out)"; [ "$RC" -eq 0 ] || f "⑧ 종료코드 $RC"
  case " $(line SHADOWED "$o8") " in *" claude="*) f "⑧ .exe 와 같은 파일인 확장자 없는 가짜 claude 가 SHADOWED 에 잡힘 — SHADOWED='$(line SHADOWED "$o8")'";; *) ok "⑧ .exe 와 같은 파일인 확장자 없는 후보는 건너뛰고 MZ 검사";; esac
else
  ok "⑧ 하드링크 불가 환경 — 생략(MSYS 는 자동 보완이 같은 경로를 탄다)"
fi
rm -f "$GT/home/$SD/claude" "$GT/home/$SD/claude.exe"

# ④ 러너=codex: 가짜 claude·codex 둘 다 PATH 에 → REVIEWERS 에 claude 는 있고 codex 는 없어야(러너 제외 독립성)
fake "$GT/bin/claude"; fake "$GT/bin/codex"
run codex; o4="$(out)"; [ "$RC" -eq 0 ] || f "④ 종료코드 $RC"
[ "$(line RUNNER "$o4")" = "codex" ] && ok "④ RUNNER: codex 인자 반영" || f "④ RUNNER='$(line RUNNER "$o4")' — 인자를 무시"
case " $(line REVIEWERS "$o4") " in *" codex "*) f "④ 러너 codex 가 REVIEWERS 에 있음(독립성 위반)";; *" claude "*) ok "④ 러너 codex → REVIEWERS 에 claude, codex 제외";; *) f "④ REVIEWERS='$(line REVIEWERS "$o4")' — claude 가 없음";; esac

[ $fail -eq 0 ] && { echo "SELFTEST: PASS ($CRT · fake=$T_PATH shadow=$T_SHADOW@$SD)"; exit 0; } || { echo "SELFTEST: FAIL ($CRT · fake=$T_PATH shadow=$T_SHADOW@$SD)"; exit 1; }
