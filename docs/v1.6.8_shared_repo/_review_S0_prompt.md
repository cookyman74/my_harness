너는 보안·설계 외부 감사자다. 아래는 팀 공유 레지스트리(사설 git repo)의 **S0 단계** 구현 diff 다.
리스크 등급 = **중대**(원격 콘텐츠 읽기 개시·실행 지시문 공급망·비신뢰 캐시). 실코드 기준으로 **고위험(HIGH) 위주** 적대적 리뷰하라.

## 맥락(설계 전제 — 이건 의도된 것·지적 대상 아님)
- 서버 미신설·git 레지스트리(clone 캐시=비신뢰). 127.0.0.1 로컬 전용 불변.
- 스킬은 3런타임 SKILL.md 동일 포맷(이종 설치 가능·라이브 dogfood 실증). 에이전트 이종 번역은 S2(이번 아님).
- eval 등급 = 품질이지 안전 아님. 정적 스캔 = advisory 신호. **실 보안 경계 = 팀 신뢰 + 사람 본문 검토 + 런타임 샌드박스.**
- 대상 = 팀·상호신뢰. **머지 권한 있는 결탁 내부자는 범위 밖**(인사 문제). 심층방어·감사추적·부주의/외부위협 차단이 목표.
- `eval-registry.mjs`(14600줄)는 **esbuild 생성 번들** — 리뷰 대상 아님(소스는 regstore-cli.ts).

## 중점 감사 항목(S0)
1. **untrusted 파싱 방어(`regstore.ts`)** — 심링크/traversal/크기캡/바이너리/경로 allowlist 우회 가능?
   - `readRegFile`·`listRegDirs`(심링크 dir·TOCTOU)·openSafeFile 재사용 계약이 실제로 성립?
   - `safeParseYaml`: `!!js/function` 등 코드태그 차단 정규식이 우회 가능한가(공백/인용/블록스칼라/멀티라인 태그)? eemeli yaml 이 실제로 함수 실행 안 하나? alias 폭발(maxAliasCount) 실효?
   - `safeParseJson`/`rawJsonDepth`: 문자열-인지 스캐너가 깊이 우회 당하나(이스케이프·유니코드)? `objectDepthExceeds` 노드예산 우회?
   - `safeParseToml`: @iarna 파싱서 DoS/깊이 우회?
   - `readJsonlSafe`: 무-개행 폭주 실제 차단되나(청크 경계·pendingBytes 계산 오류)? OOM 가능?
2. **CI 채점(`regstore-eval.ts`)** — tmp 채널 materialize 가 경계 밖 쓰기/오염 유도 가능? evaluateArtifacts 재사용이 오염 콘텐츠를 실행/신뢰하나? skipped 은폐 없나? 결정성?
3. **스키마(`regstore-index.ts`)** — zod 검증 우회·프로토타입 오염(`__proto__`)·id 정규식 우회?
4. **CLI(`regstore-cli.ts`)** — `--write` 가 index.json 외 임의경로 쓰기 가능? exit code 게이트 정확?
5. **eval.yml** — pwn-request/토큰 exfil/비신뢰 실행 방어가 실제로 되나(고정 ref·read-only·secrets 없음)? diff 게이트 우회? (한계는 README/결과서에 명시됨 — 그래도 빠진 위험 지적하라.)
6. **negative fixture 충분성** — 차단 주장 대비 테스트가 실제로 그 경계를 증명하나? 빠진 공격 벡터?

## 출력 형식(엄수)
각 지적: **심각도(HIGH/MED/LOW)** + 파일:섹션 + 근거 + **구체적 실패 시나리오(입력→잘못된 결과)**.
마지막 줄에 반드시: `판정: no-high` 또는 `판정: HIGH n건`.
추측·일반론 금지. 실코드 근거만. 이미 결과서/README 에 "정직한 한계"로 명시된 것은 새 HIGH 아님(단, 명시 안 된 실제 구멍은 지적).
