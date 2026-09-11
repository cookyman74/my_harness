# S2 결과서 — 문항 생성 · 답 검증 · 프로파일

> 단계 문서: [`docs/v1.7.6/todo/S2-questions-answer.md`](../todo/S2-questions-answer.md) · 설계서 §2-3·§2-4·§3·§4·§5·§6·§7 · 등급 중대
> BASE `69d9f509d4b29c74622dc731d7fd098dd1c6fd9a` · 작업 브랜치 `fix/v1.7.6-stub-restore-prd`
> 하네스: `repo-maintainer` — 오케스트레이터(참조 문서·명세·판정) · **repo-qa(테스트)** · **skill-maintainer(구현)** — S1 과 같이 **서로의 파일을 보지 않고** 같은 계약(`references/harness-interview.md`)만 보고 썼다.
> 상태: **작성 중**

---

## 1. 선검증

| 항목 | 실측 | 영향 |
|---|---|---|
| S1 `SIGNALS:` | 이 레포 `changelog ci plugin-manifest tests` — 설계서 §4 표와 같다 · `publishable` 은 루트·1단계 하위만(`node_modules` 제외) | ② 에 `release-publish`(`changelog`∧`plugin-manifest`) 노출 · `package-publish` 비노출 |
| `AskUserQuestion` | 메인 세션 도구 스키마: 문항 1~4 · 선택지 2~4 · `header` 최대 12자 · `multiSelect` · "그 외" 자동 | 참조 문서 §5-1 매핑 |
| PRD HI4② | 이미 안정 키로 정정(`:220`) | T6 "숫자만 rc=2" 와 충돌 없음 |
| `risk_level` 원장 | `critical` 6 · `standard` 3 | 설계서 §8-1 유지 |
| S1 스캔 회귀 기준 | 이 머신의 `agy` 가 S2 도중 1.2.0 → **1.2.1** 로 올라 `RUNTIME:` 1행이 S1 기준 파일(`v176-S1/06_real_scan.txt`)과 달라졌다(skill-maintainer 발견 · 오케스트레이터 `agy --version` 재확인) — 2~15행은 바이트 동일 | S1 스캔 회귀 판정을 **2~15행 비교**로 바꿨다(1행은 설치 도구 버전을 그대로 기록하는 줄이라 환경에 따라 바뀐다) · 전문 기준 `_workspace/repo-maintainer/v176-S2/10_real_scan_baseline.txt` |
| **`SKILL.md` 행 번호** | **S0 축소로 밀려 있었다** — 설계서 §4·§7-2 가 인용한 `:321`(승인 사다리)·`:327`(자율 노브)은 현재 **빈 줄**이다. S0 BASE `805ff208` 의 원문 줄을 현재 파일에서 **내용으로** 찾아 대응: `:204`→`:185` · `:267-288`→`:248-269` · `:288`→`:269` · `:315-321`→`:278-284` · `:321`→`:284` · `:327`→`:290` · `:332-394`→`:295-357` · `:459`→`:422` · `:468`→`:431` · `:487`→`:450` · `:180` 은 이관 | 설계서(§0-1 as-is 표는 주석만 — 기록이라 고치지 않음)·PRD·S3·S4 의 인용을 정정. **S0 의 외부리뷰·repo-qa 는 이것을 잡지 못했다** — S0 은 `SKILL.md` 를 줄였지만 다른 문서의 행 번호 인용을 대조 대상에 넣지 않았다 |

## 2. 설계 보완(S2 결정)

설계서 「S2 구현 결정」 표(§2-4 뒤)와 참조 문서가 단일 출처다. 요지: `--orchestrator` 인자 · `new` 시점 디렉토리 생성 · 내부 재스캔 · `other:<문장>` 토큰 · **④ 기본의 `ladder` 무조건**(설계서 §3·§4 충돌 해소) · `extend` 무프로파일 → `new` 문항 · `carried` 원소 · 미노출 키 rc=2 · 중복 rc=2 · `factory_version` 을 plugin.json 에서 · 심링크 쓰기 거부.

## 3. TDD

| 시점 | 명령 | 결과 |
|---|---|---|
| 구현 전(정본 = S1 · S2 구현은 스테이징) | `node --test tests/harness-intake/*.test.mjs` | rc=1 · `tests 311 · pass 196 · fail 115` — 사유 `not implemented (rc=2)` 114 · `CATALOG` export 없음 1 · 그 밖 0 (통과 196 = S1 191 + 문서 전용 불변식 5) |
| 구현 합류 | 같은 명령(node 24 · 20.17) | `311/311` · `311/311` — **서로 보지 않고 쓴 테스트·구현이 첫 합류에서 불일치 0** |
| 명세 모호점 실측 → 계약화 | 오케스트레이터가 두 에이전트의 질문(28건)을 구현에 직접 돌려 확인(`before:none`·빈 `other:`·끝 `;`·빈 env·NBSP·끝 개행 2개·실패 후 불변·깨진 프로파일 등) | 전부 rc=2/불변으로 거절 — 참조 문서 4·6·7절에 **실제 동작**을 계약으로 기록. 실측 중 **디렉토리 심링크 결함 1건** 발견: `.claude/skills/<orch>` 가 대상 밖을 가리키면 `answer` 가 rc=0 으로 밖에 프로파일을 썼다 |
| 심링크 수정 전(새 테스트 14건) | 같은 명령 | rc=1 · `tests 325 · pass 322 · fail 3` — 실패 3 = `.claude`·`.claude/skills`·`.claude/skills/<orch>` 심링크 각각 "기대 rc=2 — rc=0" |
| 심링크 수정 후 | 같은 명령(node 24 · 20.17) | `325/325` · `325/325` · 감사 PASS · S1 실스캔 바이트 불변 |
| 계약 고정(회귀) | 느슨했던 기존 테스트 3건을 참조 문서대로 조임(`recommended`=`[]`·`why`=`null` · extend 원소 순서 · 무프로파일 extend `mode: "new"`) + 새 규칙 13건(extend 이어받는 항목의 `--recommended`/`--why` rc=2 · ①③④ 누락 rc=2 · `factory_version` 9.9.9/`unknown`) | `338/338`(node 24 · 20.17) — 회귀 고정이라 적색 단계 없음(구현이 이미 계약대로) · 참조 문서 6절에 `answer --mode extend` 의 ①③④ 누락 rc=2 를 규칙으로 명시(repo-qa 제안) |
| 잠금·CAS 수정 전(R1 codex MED · 새 테스트 4건) | 같은 명령 | rc=1 · `tests 342 · pass 340 · fail 2` — 실패 2 = 잠금 선존재 rc=0(무시하고 씀) · 동시 수정 rc=0(lost update — 느린 가짜 claude 로 5초 창을 만들고 1초 뒤 덮어써 결정적 재현) · 통과 2 = 성공·실패 뒤 잠금 없음(잠금을 안 만드니 통과 — 수정 뒤 정리 회귀로 의미) |
| 잠금·CAS 수정 후 | 같은 명령(node 24 · 20.17) | `342/342` · `342/342` · 감사 PASS · 회귀 3종 PASS · 스캔 2~15행 불변 |

- 결함 테스트마다 **결함만 뺀 대조군 rc=0** 을 먼저 확인하고, `not implemented` rc=2 를 통과로 세지 않는 가드(`rcIs()`)를 둔다 — 미구현이 rc=2 를 기대하는 결함 테스트를 거짓 통과시키지 않게(repo-qa 설계).
- 수정 전 사본: `_workspace/repo-maintainer/v176-S2/prefix/`(S1 판 · 심링크 수정 전 판).

## 4. 외부리뷰

리뷰어 codex(일반축) + agy(이식성·성능축) · 러너 claude 제외 · stage `v176-S2-r{k}` · BASE `69d9f509` · 수렴 기준 R-3(R1~R9: MED 이상 대응 · 양 엔진 HIGH 0·MED 0 2연속).
리뷰어 계약: `AVAILABLE: codex claude agy` · `RUNNER: claude` · `REVIEWERS: codex agy` · `SHADOWED: gemini=~/.nvm/versions/node/v22.11.0/bin/gemini`.
라운드 전 게이트(R1): node 24·20 `338/338` · 감사 PASS · 회귀 3종 PASS.

| 라운드 | codex | agy | 트리 hash | 판정 |
|---|---|---|---|---|
| R1 | HIGH 1 · MED 2 | 새 결함 없음 | 747303d | 부분 1 · 확인 2 — 미수렴 |
| R2 | 새 결함 없음 | r2: 런타임 실패(`There was a network issue connecting to the server`) → **r2b 재실행: 새 결함 없음(ok)** | 9789845(r2·r2b 동일) | HIGH 0·MED 0 (1/2) |
| R3 | (진행 중) | (진행 중) | 9789845 | |

- **R1 판정:** [HIGH → 부분] 심링크 검사와 `rename` 사이 TOCTOU — 실재하나 창을 쓰려면 대상 `.claude` 에 동시 쓰기 권한이 필요하고(그 권한이면 프로파일을 직접 쓸 수 있다) 바뀌는 것은 고정 이름 파일이 생기는 디렉토리뿐 · node 내장으로 `openat`+`O_NOFOLLOW` 를 이식성 있게 쓸 수 없어 **문서화**(참조 문서 7절 「남는 경합」) · [MED 확인] 동시 `answer` 의 lost update·`prev` 불일치 → 잠금 + 잠근 뒤 재독 비교(CAS) · [MED 확인] 설계서 §4 ④ 본문이 옛 규칙("② 가 `none` 이 아니면 `ladder`")으로 남아 있었다 — 결정 표만 추가하고 본문을 고치지 않은 **내 누락** → 본문 정정.

## 다음 단계 참조

- **S3 의 입력 계약은 참조 문서 7·8·9절이다** — 프로파일 필드·항목별 해시 필드(`value`·`other`·`source` + `assets` 의 `scanned`)·정규 JSON(키 코드포인트 정렬·공백 없음·비ASCII 원문)·`catalog_version`(스크립트 `CATALOG.catalog_version` = 1)·premise 구성·블록 id 5종과 삽입 위치. S3 는 이것을 **바꾸지 않고 구현**한다 — 바꿀 필요가 생기면 참조 문서를 먼저 고치고 S2 테스트(`s2-doc-catalog`)가 드리프트를 잡게 한다.
- **`render` 는 프로파일만 읽는다** — `answers.assets.scanned` 가 이름 목록이므로 실시간 재스캔을 하지 않는다(블록 내용이 스캔 시점에 따라 흔들리지 않게).
- **항목별 `at`·`factory_version` 규칙은 S2 가 구현했다** — premise 날짜는 premise 항목들의 항목별 `at` 최신값, 최상위 `at` 은 렌더에 쓰지 않는다(참조 문서 7절 · 설계서 §7-1).
- **`cli.test.mjs` 의 미구현 단정은 이제 `render`** 다 — S3 가 `render`·`verify` 를 넣으면 미구현 단정을 남은 서브커맨드가 없으면 삭제한다.
- **S2 가 남긴 한계(S3·S4 에서 볼 것):** 잠금은 이 스크립트끼리의 협조형(비정상 종료 잠금은 사람이 지운다) · 심링크 검사와 rename 사이 창(권한 모델상 영향 제한 — 참조 문서 7절) · selftest 는 여전히 `scan` 만 본다(`questions`·`answer` 가 스텁으로 덮이는 회귀는 S2 테스트만 잡는다 — S4 정본 배선 때 selftest 확장 여부 결정).
- **스캔 회귀 기준은 2~15행 비교**다(`RUNTIME:` 1행은 설치 도구 버전을 따른다 — agy 1.2.1 실측).
- **S0 류 행 번호 인용은 줄 수가 바뀌는 단계마다 다시 대조한다** — S4 가 `SKILL.md` 를 463 → 485 로 늘리면 설계서·PRD·S3·S4·참조 문서의 `SKILL.md:<n>` 인용이 다시 밀린다(이번 S2 선검증에서 S0 이 남긴 밀림을 찾았다).
