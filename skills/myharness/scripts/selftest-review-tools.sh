#!/usr/bin/env bash
# check-review-tools.sh 행동 자기검증 — "탐지 스크립트가 실제로 환경에 반응하는가".
# 배경: v1.7.5 에 5줄 스텁(REVIEWERS 고정 출력)이 릴리스됐다(d33d304). 텍스트 가드(command -v 존재 등)는
#   부분 스텁(탐지 루프 일부 + 고정 출력)을 통과시키고(R1 codex HIGH), 정상 리팩터를 FAIL 시킨다(R1 codex LOW).
#   그래서 텍스트를 보지 않고 **격리된 PATH/HOME 에서 실행해 출력이 바뀌는지**만 본다.
# 규칙: `… | grep -q` 를 쓰지 않는다(pipefail + SIGPIPE 거짓 실패 — run-policy-audit.sh:41 · PR #6 rc=141 실측). case 패턴으로 본다.
# 사용: bash selftest-review-tools.sh [path/to/check-review-tools.sh]   → 0=PASS 1=FAIL 2=사용오류
set -u
CRT="${1:-$(dirname "$0")/check-review-tools.sh}"
[ -f "$CRT" ] || { echo "SELFTEST: FAIL — 파일 없음: $CRT"; exit 2; }
GT="$(mktemp -d)"; trap 'rm -rf "$GT"' EXIT
mkdir -p "$GT/bin" "$GT/home"
# 격리: 실제 도구가 보이지 않게 HOME 을 비우고 PATH 는 가짜 bin + 시스템 유틸(bash·grep·mktemp)만.
# probe_shadow 의 시스템 경로(/opt/homebrew/bin·/usr/local/bin)에 진짜 도구가 있으면 SHADOWED 에 잡힐 수 있으므로 케이스 1 은 SHADOWED 를 단정하지 않는다.
run(){ PATH="$GT/bin:/usr/bin:/bin" HOME="$GT/home" PNPM_HOME= NPM_CONFIG_PREFIX= CLAUDECODE= CODEX_HOME= bash "$CRT" claude 2>/dev/null; }
fail=0; f(){ echo "  ✗ $1"; fail=1; }; ok(){ echo "  ✓ $1"; }
# 계약 줄만 뽑아 본다 — 전체 출력에 와일드카드를 대면 뒤따르는 줄(예: SHADOWED: agy=…)이 AVAILABLE 단정에 섞인다(자기검증에서 실제로 오탐).
line(){ printf '%s\n' "$2" | sed -n "s/^$1: //p" | tail -1; }

o1="$(run)"                                   # 케이스 1: 도구 전무
[ "$(line AVAILABLE "$o1")" = "none" ] && ok "도구 없음 → AVAILABLE: none" || f "도구 없음인데 AVAILABLE='$(line AVAILABLE "$o1")' (고정 출력 의심)"
[ "$(line REVIEWERS "$o1")" = "none" ] && ok "도구 없음 → REVIEWERS: none" || f "도구 없음인데 REVIEWERS='$(line REVIEWERS "$o1")' (고정 출력 의심)"

printf '#!/bin/sh\nexit 0\n' > "$GT/bin/codex"; chmod +x "$GT/bin/codex"
o2="$(run)"                                   # 케이스 2: 가짜 codex 가 PATH 에
case " $(line AVAILABLE "$o2") " in *" codex "*) ok "PATH 의 codex → AVAILABLE 에 반영";; *) f "PATH 에 codex 를 넣었는데 AVAILABLE='$(line AVAILABLE "$o2")' (탐지 안 함)";; esac
case " $(line REVIEWERS "$o2") " in *" codex "*) ok "러너 claude → REVIEWERS 에 codex";; *) f "REVIEWERS='$(line REVIEWERS "$o2")' — PATH 변화에 반응하지 않음";; esac

mkdir -p "$GT/home/.nvm/versions/node/v0.0.0/bin"; printf '#!/bin/sh\nexit 0\n' > "$GT/home/.nvm/versions/node/v0.0.0/bin/agy"; chmod +x "$GT/home/.nvm/versions/node/v0.0.0/bin/agy"
o3="$(run)"                                   # 케이스 3: 가짜 agy 가 PATH 밖(nvm)
case " $(line SHADOWED "$o3") " in *" agy="*) ok "PATH 밖 agy → SHADOWED 에 반영";; *) f "SHADOWED='$(line SHADOWED "$o3")' — PATH 밖 설치를 보고하지 않음(고정 의심)";; esac
case " $(line AVAILABLE "$o3") " in *" agy "*) f "PATH 밖 agy 가 AVAILABLE 에 있음(가려진 것을 가용으로 오판)";; *) ok "PATH 밖 agy 는 AVAILABLE 에 없음";; esac

[ $fail -eq 0 ] && { echo "SELFTEST: PASS ($CRT)"; exit 0; } || { echo "SELFTEST: FAIL ($CRT)"; exit 1; }
