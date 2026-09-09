# B1 — BEHAVIOR.md 포맷 채택 · 결과서

작업일: 2026-08-31 · 브랜치: `feat/eval-upgrade-v175` · 리스크 등급: **중대**(정본 → 전 생성 하네스 전파)
산출물: `skills/myharness/scripts/check-behaviors.sh`(258줄) · `references/behavior-specs.md`(135줄) ·
`tests/test-check-behaviors.sh`(368줄·픽스처 104) · `harness-ui/test/adr-axis-contract.test.ts`
외부 리뷰: **R1~R10** · 러너 claude 제외 · codex(`gpt-5.4-mini` high) + agy

## 1. 무엇을 만들었나

에이전트·스킬의 **판단 기준**을 정의 파일에서 분리해 `.agents/behaviors/<name>/BEHAVIOR.md` 로
두는 포맷을 채택하고, 자체 검증 스크립트를 붙였다. ADR-001 이 정한 소유 규칙(D1)의 **실행 장치**다.

| | 내용 |
|---|---|
| **포맷** | `.agents/behaviors/<name>/BEHAVIOR.md` · frontmatter `name`(디렉토리명 일치)·`description` · 6차원 |
| **참조** | 정의 frontmatter `behaviors:` 배열이 **단일 출처**. 본문 섹션 포인터는 B2(TS) 소관 |
| **검증** | `check-behaviors.sh` — 구조·참조 무결성·내용 충실도. `run-policy-audit.sh` 가 자동 호출 |
| **역인덱스** | 출력의 `REF <정의> -> <behavior>` 가 ADR D5 가 요구한 "영향받은 정의 찾기"를 겸한다 |
| **전파** | `harness-update.sh` `MANAGED_RELS` 에 스크립트 + reference 등록 |
| **코드 계약** | `Axis` 유니온 4개 고정 테스트(5번째 축이 조용히 추가되는 것을 막는다) |

`name` 정규식은 **스펙 문구대로** `^[a-z0-9]([a-z0-9-]*[a-z0-9])?$` — 연속 하이픈을 허용한다.
원본 agentbehavior CLI 는 `NAME_PATTERN` 이 `foo--bar` 를 거부해 스펙↔코드가 어긋나 있는데,
그 불일치를 베끼지 않았다.

**도그푸드:** `gate-escalation` BEHAVIOR 를 만들고 `stabilizer.md` 가 참조하게 했다.
D1 대로 행동 문장(에러 핸들링 3줄·월권 금지)을 BEHAVIOR 로 넘기고 정의에는 **보고 형식만** 남겼다.

## 2. 라운드 — HIGH 20건, 픽스처 25 → 104

이 단계의 지배적 실패 계열은 하나였다: **검사가 도는 것처럼 보이지만 0건을 검사하고 통과한다.**
20건 중 12건이 그것이다.

| R | 무엇이 뚫렸나 |
|---|---|
| R1 | `description` 누락이 **warn** 이라 빈 필수 필드가 정책감사를 통과 |
| R2 | `description` 을 raw non-empty 로만 봐 `""`·`\|`·`~`·`null`·`# 주석` 통과 |
| R1(agy) | ① 디렉토리 없는 파일(`behaviors/gate.md`)에서 `found=0` → **"미적용"으로 조용히 통과** ② 듀얼런타임 `.agents/skills/` 스캔 누락 ③ ADR D5 가 SKILL.md 에 미배선 |
| R3 | ① flow sequence `behaviors: [a, b]` 미파싱 ② 종료 조건이 **들여쓰기 없는 유효 항목 `- alpha`** 에도 매치 |
| (자체) | `behaviors:` 선언 + 참조 0개 — 선언만으로 줄 수 하한이 면제되는 우회 |
| R4 | ① **주석 줄이 목록을 닫음**(양 엔진 독립 발견) ② `description` 인라인 주석 |
| R5 | ① tab 줄이 목록을 닫음 ② 정의 frontmatter 오류 시 **조용한 skip** ③ CRLF 빈 줄이 목록을 닫음 ④ `behavior-specs.md` **MANAGED_RELS 누락** |
| R6 | ① `description` block scalar `\|2`·`>2-` ② **graceful skip 이 고장난 하네스를 정상으로 둔갑** ③ 스펙 쪽 CRLF 오탐 |
| R7 | **`\| grep -q` + pipefail → SIGPIPE(141)가 if 를 뒤집어 정상 스펙이 거짓 실패** |
| R8 | 양 엔진 HIGH 0 |
| R9 | 중복 frontmatter 키가 fail-closed 아님 |
| R10 | 비정규 키 표기(`name :` · `"name":`)가 정규식에 안 걸려 숨음 |

## 3. 배운 것

### (1) 배제 목록을 열거하는 접근은 끝나지 않는다 — 두 곳에서 4연속 누출

같은 검사가 네 번씩 뚫렸고, 그때마다 나는 **배제할 대상을 하나 더 추가**했다.

- **`behaviors:` 블록 종료 조건** — 들여쓰기 없는 항목 → 주석 → tab → CR.
  매번 `case` 글롭의 배제 문자를 늘렸다. 네 번째에 접근을 바꿨다:
  **블록에 속하는 줄을 열거**(빈 줄·주석·`-` 항목)하고 나머지에서 끊는 awk **허용 목록**으로.
- **`description` 빈 값 판정** — raw non-empty → 빈 스칼라 열거 → 인라인 주석 → block scalar 변형.
  역시 네 번째에 **"한 줄 평문 스칼라만 허용"** 으로 뒤집었다.

교훈은 "더 꼼꼼히 열거하라"가 아니다. **열거하는 쪽이 틀렸다** — 무엇이 유효한지는 유한하고
무엇이 무효한지는 무한하다. R9·R10(중복 키·비정규 표기)도 같은 뿌리라, 값을 골라 읽는 대신
**형태를 먼저 거부**하는 쪽으로 옮겼다.

### (2) 배려가 검사 무력화가 될 수 있다

R6 의 graceful skip 이 그랬다. "기존 하네스는 검증기만 받으니 죽으면 안 된다"는 옳은 요구였는데,
구현이 **조기 `exit 0`** 이라 정의에 `behaviors:` 참조가 남아 있어도 스캔 자체를 건너뛰었다.
스펙이 지워졌거나 마이그레이션이 덜 된 **고장난 하네스가 정상으로 둔갑**한다.

고친 형태: 조기 종료를 없애고 **정의를 먼저 스캔**한 뒤, "스펙 0 **그리고** 참조 0" 일 때만
미적용으로 판정한다. 미적용과 고장을 구분하는 데 필요한 정보는 **스캔을 해야만** 얻어진다.

### (3) 정본이 이미 금지한 것을 내가 어겼다

R7 의 `| grep -q` 는 `run-policy-audit.sh:41` 이 **"금지(req)"** 로 명시해 둔 규칙이다.
그런데 새 스크립트가 5곳에서 어겼다. 30,008줄 스펙에서 실측하니 정상 파일이
`'## Intent' 차원 누락` 으로 거짓 실패했다(구버전 rc=1 → 수정본 rc=0).

**입력이 작을 땐 재현되지 않는다.** 그래서 픽스처를 30,000줄로 만들었다.
규칙을 스크립트 머리말에도 적어 다음 사람이 같은 자리에서 걸리지 않게 했다.

### (4) 테스트 환경 실패를 산출물 결함으로 오인하게 두면 안 된다

R7 에서 codex 가 판정을 못 내고 타임아웃(rc=124)했다. 원인은 그 샌드박스의 `TMPDIR` 이 무효라
`mktemp -d` 가 실패했는데 **테스트가 그걸 감지하지 않고** 존재하지 않는 경로에서 전 케이스를
돌려 37통과/55실패를 낸 것이다. 리뷰어는 그 55건의 원인을 추적하다 시간을 다 썼다.
→ `mktemp` 실패 시 **rc 2 로 SKIP** 하고 `TMPDIR` 값을 알린다.

## 4. 운영 기록

- **agy 는 codex 와 동시 실행하면 타임아웃한다.** 300s·900s 모두 `Error: timeout waiting for
  response`, 단독 900s 는 통과. R5 부터 **순차 실행**으로 바꿨고 `run-review.sh` 의
  `--print-timeout` 을 `AGY_PRINT_TIMEOUT` 로 노출했다(기본 300s 불변).
- **리뷰어가 레포에 파일을 쓴다.** `--add-dir` + `--dangerously-skip-permissions` 조합 때문이다.
  R6 에서 리뷰어가 만든 `.agents/behaviors/{alpha,beta}` 가 **정책 감사에 실제 스펙으로 잡혀**
  `specs=3` 이 나온 것으로 발견했다. `.gitignore` 에 `test-*.sh` 계열을 추가하고, 프롬프트에
  "레포에 쓰지 말라"를 명시했다.
- **런처가 SIGKILL 되면 `status: running` 이 남는다**(이 세션에서 5회 관측). 기지 팩토리 결함.

## 5. 미해결 · 이월

| 항목 | 상태 |
|---|---|
| 기존 하네스 소급 마이그레이션 | **안 한다.** 검증기가 미적용 하네스에서 rc 0 skip 하므로 안전하다(그 기술적 대응이 된 뒤에만 유효한 선택이었다) |
| 본문 섹션 포인터 파싱 | **B2**(TypeScript `scoreStructure`) — bash 에 markdown AST 를 강제하면 B2 에서 다시 구현하게 된다 |
| `build-scorecard.sh` 빈 원장 무경고 통과 | 팩토리 정본 · stabilizer 게이트 대상(B0 결과서 §5) |

## 다음 단계 참조

- **B2 착수 가능** — B1 은 CLI 까지다(ADR D6). UI 연결은 B5.
- B2 선결 2건을 먼저 처리한다: ① 필수 섹션 목록 3종(`artifacteval.ts`) vs 5종(`SKILL.md`) 통일
  ② D7 채점 중립성 구현
- B2 는 `check-behaviors.sh` 와 **같은 규칙을 TS 로 따로 검사**한다 — 셸 결과를 런타임에
  소비하지 않는다(아키텍처상 불가능·ADR D5 주석)
- **이 단계에서 가장 값싼 방어는 픽스처였다.** 20건 중 상당수가 "고쳤더니 다른 데가 샜다"인데,
  픽스처 104건이 매번 즉시 잡아 줬다(예: R9 의 `sed -n` 인자 순서 실수)
