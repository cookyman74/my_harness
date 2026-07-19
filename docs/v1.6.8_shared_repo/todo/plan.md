# 작업계획서 — 팀 공유 레지스트리 + 이종 런타임 교환 (S0~S3)

> 상태: **미착수(설계 확정·외부감사 R1~R3 수렴).** 근거 = [`../design.md`](../design.md)·[`../prd.md`](../prd.md)(외부감사 R1~R3 no-high·판정 원장 `../_review_20260719_215656/`).
> **리스크 등급 = 중대**(원격 배포·실행 지시문 공급망·다수 쓰기·이종 번역). → **단계마다 외부감사 ≥2회 + 승인 사다리**.
> 경로: 코드/테스트는 레포 루트 `harness-ui/` 하위. 문서는 `docs/v1.6.8_shared_repo/`.
> 코드 정박(재사용·실재 확인): `runtimes.ts`(F12)·`driftsync.ts`/`drift.ts`(F16)·`defedit.ts`(F7 safeDefPath/writeBackup/writeDefSafe)·`toml.ts`(F15)·`artifacteval.ts`(#/eval)·`config.ts`(docsSources 패턴)·`web/defedit.ts`(diffLines)·F17 설치 매트릭스.
> 체크리스트: `[ ]` 미완 · `[x]` 완료(증적: 커밋/테스트/결과서). 각 항목 완료 즉시 체크.

---

## 0. 공통 작업규칙 (전 단계 의무 · 하네스 작업규칙 §0 준수)

### 0-1. 외부감사 ≥2회 (중대·비협상)
- [ ] 각 마일스톤 구현 완료 후 `external-review-loop` — 리뷰어 = 러너 제외분(`bash skills/myharness/scripts/check-review-tools.sh claude` 끝줄 `REVIEWERS:`). 러너=claude → **codex + agy**.
- [ ] **no-high 2연속** 수렴까지 반복(loop-until-dry). 판정 = 오케스트레이터 실코드 대조 전건(확인/부분/이월/기각). 위임 금지·확인분만 TDD 수정→재리뷰.
- [ ] 측정 꼬리: 수렴 후 `verdicts.json` → `build-scorecard.sh` → `summary.jsonl`(단계 스킵 금지).

### 0-2. working_history 결과서 (매 마일스톤·물리 게이트)
- [ ] 게이트 PASS 직후 `docs/v1.6.8_shared_repo/working_history/{S}_{slug}_{YYYYMMDD_HHMMSS}.md`(덮어쓰기 금지). 골격 = `skills/myharness/references/templates/working-history-skeleton.md`.
- [ ] 필수: ①작업요약 ②변경파일(경로+사유) ③검증(테스트 통과/전체·회귀·RED→GREEN·**AR 통과 현황**·게이트 수치) ④미해결/후속 ⑤외부리뷰 반영(codex+agy digest) ⑥`## 다음 단계 참조`(heading 문자열 유지·자기완결).

### 0-3. 커밋·병합 게이트 (마일스톤 단위 · **CI 물리 강제** · R1·R2 HIGH)
> 체크리스트 `[x]`·"승인 관문"은 프롬프트 자율이고, **로컬 `pre-commit` hook 은 `--no-verify`·force push 로 우회 가능**하다(R2). → **진짜 물리 게이트 = 서버측 CI required status checks(branch protection)**. 로컬 hook 은 조기 피드백용 편의(우회 가능·게이트 아님).
- [ ] **CI 필수 상태 체크(harness 레포 + 레지스트리 레포·branch protection·main 직접 push/force push 차단·PR 필수·머지 전 required checks 통과 강제):**
  - [ ] 전체 vitest 그린·typecheck·build.
  - [ ] **보안 negative 스위트 PASS**(캐시 샌드박스·IR 무결성·위험 스캔·A184) — 쓰기/원격읽기 단계 필수·미실행/실패=red.
  - [ ] **no-high 게이트 = 위조 불가 입력에서(R3 HIGH):** `summary.jsonl` 최신 2엔트리 `no-high` **수기 신뢰 금지** — CI 가 **`verdicts.json` 에서 `build-scorecard.sh` 재생성 → summary 대조**(불일치=red)·**raw 리뷰 산출물(codex/agy `*_r*.txt`) 존재**·**reviewer identity = 러너(claude) 제외분(codex+agy)** 검증. 자기검증(같은 러너)·수기 no-high 차단.
  - [ ] `check-artifacts.sh docs/v1.6.8_shared_repo t1` = `ARTIFACTS: ok`(결과서 docs/·`## 다음 단계 참조`).
- [ ] **게이트 자기 무결성(R3·R4 HIGH·who-guards-the-guard):** `.github/workflows/`·게이트 스크립트·`CODEOWNERS`·branch protection 설정은 **CODEOWNERS 강제**·**branch protection 실활성 검증**("Include administrators" ON·bypass actor 없음·required check 이름 고정·out-of-band 1회·결과서 기록).
- [ ] **CI pwn-request 방어(R4 HIGH·GitHub Actions):** `pull_request` 는 PR 브랜치의 워크플로를 즉시 실행한다 → CODEOWNERS 는 *머지*만 막지 *실행*을 못 막음. → **required check 워크플로는 default 브랜치 정의만 사용**(org **required workflows** 또는 PR 워크플로 결과 불신)·**`GITHUB_TOKEN` read-only·평가 워크플로에 시크릿 미주입**(token exfil 차단)·untrusted PR 콘텐츠는 격리 실행(`pull_request_target` 금지).
- [ ] **no-high 위조의 정직한 종착(R4 HIGH·무한회귀 차단):** `verdicts.json`·raw 리뷰 파일은 **로컬 작성물**이라 CI 재생성 대조로도 "실제 리뷰가 돌았음"을 **암호학적으로 증명 못 한다**(가짜 verdicts+더미 raw 위조 가능). 이 한계를 인정한다.
  - [ ] **강한 형태(권장·anti-insider):** 외부감사를 **CI 신뢰 러너가 실행**(CI 크레덴셜로 codex+agy 호출·verdicts=CI 산출) → 작성자가 사전 조작 불가. 비용 크므로 최소 중대 게이트에 적용.
  - [ ] **신뢰 경계 명시(정본):** 게이트는 **부주의·외부 위협에 대한 심층방어 + 우회의 가시성(감사 추적)**이지, **머지 권한 있는 결탁 내부자를 막는 증명이 아니다**(대상=**팀·상호신뢰** 전제·§설계 §3-0). CODEOWNERS 로 위조엔 **2인 결탁**이 필요해 비용을 올린다. 전지적 악성 내부자는 **범위 밖**(인사·신뢰 문제).
- [ ] **로컬 `pre-commit` hook(편의·조기 차단):** 위 검사 로컬 실행(결과서 staged 조건 없이 **관련 코드 변경이면 항상**). 단 우회 가능하므로 **CI 가 최종 강제**(hook 통과가 커밋 허가 아님).
- [ ] 위 CI green → **승인 관문(중대: 사용자 승인 대기·자율 마커 시만 생략)** → 병합. push 별도(`.autonomous-push` 미설정).

### 0-4. TDD (코드 실경로)
- [ ] 신규 로직 RED→GREEN→리팩터. 보안 게이트(위험 스캔·캐시 샌드박스·IR 무결성)는 **negative 테스트 필수**(공격 fixture로 차단 실증).

### 0-4b. 공통 mutation·읽기 보안 게이트 (설계 §3·§4-2 · 전 쓰기/원격읽기 단계 물리 배선 · 비협상)
- [ ] **A184 쓰기경계 회귀 세트 재사용**(F17/F7): per-seg lstat·root containment·심링크(O_NOFOLLOW)·(dev,ino) 재검증·nlink>1 거부·Windows write 차단·게이트 default off.
- [ ] **untrusted 캐시/콘텐츠 읽기 샌드박스(§4-2·신설·S0 부터·R1 HIGH):** 원격 콘텐츠를 읽는 **모든** 경로(S0 CI 평가기·S1+ diff·스캔·index/meta 파서·설치 소스)에 심링크 전면거부·경로 allowlist·바이너리 거부·submodule/LFS off. **크기 상한은 파일 종류별(R4 MED):** 개별 아티팩트(SKILL.md·meta.json) 작은 상한 vs **`index.json` 카탈로그는 큰 상한·스트리밍 파싱**(누적 성장으로 정당 DoS 방지·일괄 1MB 금지). **negative fixture**(`SKILL.md -> ~/.ssh/id_rsa`·거대 아티팩트·조작 index.json)로 차단 실증. **CI 평가기(S0)에도 동일 적용**.
- [ ] 각 결과서에 A184·캐시 샌드박스 통과 현황 수치 기록.

### 0-5. 선검증 게이트 (설계 §8 · 착수 전 실증 · 가정 위 구현 금지 · 비협상)
> **P-1·P-2 는 전체 타당성 관문 — 실패 시 범위 재설계.**
- [ ] **P-1 스킬 이종 로드:** 코덱스/제미나이 채널(`.agents/skills/{name}/SKILL.md`)에 클로드 SKILL.md 심어 **로드·활성 확인**(더미 dogfood).
- [ ] **P-2 tool-capability 매핑:** claude/codex/gemini 런타임별 tool 어휘·의미 실측 매트릭스. **성립 여부에 따라 S2 착수 분기(완료판정 가능·R1 MED):**
  - **성립** → IR `tools[]` 정규화 매핑 구현.
  - **불성립** → **정규화 폐기**·`tools[]`=선언 그대로 보존(비신뢰 참고)·매핑 코드 미구현·**충실도 보고만**("본문 도구 참조→대상 실패 가능·사람 적응"). S2 4-1 IR 어댑터 범위를 이 결정에 맞춰 축소. **P-2 미완이면 S2 착수 차단.**
- [ ] **P-3 git/gh exec·인증:** `gh pr create`·`git clone --no-hardlinks -c protocol.file.allow=never --no-recurse-submodules` 로컬 동작·**사용자 기존 자격 재사용**(하네스웹 토큰 미보관) 실증.
- [ ] **P-4 캐시 샌드박스 실효:** 심링크·거대파일 fixture 로 읽기 거부 실증(0-4b 와 연동).
- [ ] **P-5 IR 왕복:** claude .md → IR → codex.toml → IR 왕복에서 **extras 보존·canonical 무손실**(역추출 금지·base merge) 실증.
- [ ] 선검증 결과서(`working_history/preflight_*`) 작성 → S0 착수 조건.

---

## 1. 단계 순서 · 의존 (design §7)

| 단계 | 내용 | 이종 교환 | 등급 | 외부감사 |
|------|------|-----------|------|----------|
| **선검증** | P-1~P-5 (§0-5) | — | — | 결과서 |
| **S0** | git 레지스트리 규약 + CI 자동채점(+파싱 방어) + 수동 pull/설치 | 스킬만(동일 포맷) | **중대**(원격 콘텐츠 읽기 개시·R1) | ≥2회 |
| **S1** | `#/registry`·검토관문 import·PR publish **+ 위험/시크릿 스캐너 완결·negative** | 스킬 + 에이전트(md 복사) | **중대** | ≥2회·단계마다 |
| **S2** | 에이전트 IR+어댑터·충실도·**마이그레이션**·스캐너 런타임결합 확대·댓글 노출 | 에이전트 전체(↔코덱스) | **중대** | ≥2회·단계마다 |
| **S3(후속)** | 서명·출처·사용카운트·앱내 댓글창·(필요시)서버 | — | — | — |

> **스킬-먼저(R1 정정):** 스킬은 **포맷 무번역**(3런타임 SKILL.md 동일)이라 S0/S1 즉시 가치. 단 **"무위험" 아님** — 본문 실행 의미는 런타임 결합 가능(§설계 §2-1)·원격 콘텐츠는 S0부터 위협면이 열린다. 그래서 **S0 부터 중대·파싱 방어·위험 스캔은 Import/Publish 가 열리는 S1 에 완결**(S2 이월 금지·R1 HIGH). 에이전트 *번역* 리스크만 S2 격리.

---

## 2. S0 — 레지스트리 규약 + 평가 (**중대** · 원격 콘텐츠 읽기 개시 · R1)

**목표:** 사설 git repo 를 팀 레지스트리로. 스킬 수동 교환 + CI 자동채점. 신규 코드 최소(규약·CI). PRD AR1~AR3.

### 구현
- [ ] **레지스트리 repo 표준 구조(AR1):** `skills/{name}/SKILL.md`·`agents/{name}/{agent.ir.json,claude.md,codex.toml,meta.json}`·`index.json`(카탈로그)·`.github/workflows/eval.yml`. 예시 스킬 1개 커밋·README 규약 문서.
- [ ] **`index.json` 스키마(design §1-2):** entries[{id,kind,name,runtimeOrigin,owner,version,description,requires{tools,model},eval{grade,mode,confidence},endorse,discussionUrl}]. **CI 생성·검증**(수기 편집 금지).
- [ ] **CI 자동채점(AR2):** PR 마다 `evaluateArtifacts` 상당 실행 → 등급/지적을 체크로 게시·index.json.eval 갱신. **D등급 머지 차단(옵션 플래그).**
- [ ] **CI 파싱 방어(§0-4b·R1·R2·R3·S0 선행):** CI 평가기가 PR 콘텐츠를 읽기 전 심링크 거부·파일 크기 상한·경로 allowlist(`skills/*/`·`agents/*/`·`index.json`·`meta.json` 정규 텍스트만)·바이너리 거부. **+ safe-parse: YAML frontmatter=safe-load(`!!js/function` 등 코드 실행 태그 금지)·alias/anchor·중첩 깊이 상한(billion-laughs)·JSON/TOML 깊이·크기 상한.** **+ 게이트 파서 자체 DoS-safe(R3 MED): `summary.jsonl` 등 파싱은 스트리밍·max line length·정규식 타임아웃**(2GB single-line JSONL OOM·fail-open 차단).
  - [ ] **negative fixture(R3 확대):** 심링크·거대파일·YAML alias 폭발·**`!!js/function` 태그**·**깊은 JSON/TOML 중첩**·**거대 single-line JSONL** 전건 차단 실증.
- [ ] **meta.json 규약:** owner(git author 파생)·runtimeOrigin·tags·endorse(★)·discussionUrl.

### 선검증 실증(AR3·§0-5 P-1)
- [ ] 클로드가 만든 `SKILL.md` → 코덱스 채널(`.agents/skills`)·제미나이 채널에 수동 설치 → **로드·활성 확인**. 실패 시 규약 재설계.

### 게이트
- [ ] 외부감사 ≥2회 no-high 2연속 → 결과서(0-2) → check-artifacts → 승인 → 커밋.

---

## 3. S1 — `#/registry` 화면 · 검토 관문 · PR publish (중대)

**목표:** 레지스트리 브라우징·검토관문 import·PR publish. 스킬 + 에이전트(claude↔gemini md 복사). PRD AR4~AR9·AR16.

### 3-1. RegistryClient (git 로컬 클라이언트·서버 아님)
- [ ] **config 확장(AR4):** `registries:{label,url}[]`(다중·기본 [])·형제 필드 보존 RMW. `#/settings` "레지스트리 URL" 칸(1회 등록)·URL 검증 fail-closed.
- [ ] **다중 레지스트리 — 네임스페이스 스코핑·폴백 금지(R1 MED·R3 HIGH dependency confusion):** source precedence 만으로는 **의존성 혼동 공격**을 못 막는다(내부 이름을 못 찾아 외부 악성으로 폴백). → **각 레지스트리에 네임스페이스 스코프**(예: `@corp/*` = 내부 전용)·**스코프별 source 고정·자동 폴백 절대 금지**(내부 스코프를 외부 레지스트리서 절대 안 찾음). 동일 `id` 충돌 = 병합 아님·source 배지 명시·설치 시 어느 source 인지 확인. **오타/미존재 시 폴백 아니라 실패**(외부 악성 다운로드 차단). **동일 스코프를 여러 레지스트리에 중복 등록 = 설정 에러(등록 거부 or 명시 우선순위 강제)·폴백 금지**(R4 MED·비결정적 다운로드·잔여 confusion 차단). negative(스코프 외부 폴백·동일 스코프 중복 등록 거부).
- [ ] **clone/pull:** `_workspace/registries/{hash}/`·`--no-hardlinks -c protocol.file.allow=never --no-recurse-submodules`·**`-c core.symlinks=false`(R4·악성 심링크 워크트리 물리 생성 자체 차단·심층방어)**·LFS off. git/gh = F17 안전 exec(execFile+argv·no-shell·타임아웃)·토큰 미보관.
- [ ] **git/gh 실패·부분성공 분기(R1 LOW):** clone lock 경합·인증 만료·PR 생성 실패(브랜치는 생김) 등 완료판정·재시도/롤백 기준. PR 생성 실패 시 "게시 미완" 명시(완료 오해·중복 브랜치 방지).
- [ ] **untrusted 캐시 리더(§4-2·AR16·0-4b):** 캐시 읽기 전 경로에 심링크 거부·크기 상한·경로 allowlist·JSON.parse 크기상한. **negative 테스트**(심링크·거대파일).

### 3-2. 브라우징 (AR5)
- [ ] 목록 = index.json + 캐시. 카드 = 이름·kind·runtimeOrigin·소유자·**eval 등급("품질·비안전" 라벨)**·요구 tools/model("비신뢰 참고" 라벨)·★/💬·[가져오기]. 읽기전용. XSS(renderMarkdown DOMPurify).

### 3-3. Import 검토 관문 (AR6·비협상·설계 §3 재정의)
- [ ] **정적 위험/시크릿 스캐너 완결(S1·R1 HIGH — S2 이월 금지):** Import/Publish 가 열리는 S1 에 스캐너 **완성 + negative fixture PASS**(`curl|sh`·env/`.ssh`/`.aws` 읽기·네트워크·base64·prompt-injection·시크릿 토큰). S2 4-3 은 "런타임 결합 확대"만·핵심 방어는 S1. **스캐너 미완/미실증이면 Import/Publish 개방 금지.**
- [ ] **본문 전문 강제 검토**(짧으면 전문/길면 스크롤·"검토함" 체크).
- [ ] **정적 위험 스캔 배지**(§3-1·advisory·warn): 본문의 RCE/exfil·네트워크·env/secret 읽기·prompt-injection·런타임 결합 신호 표시.
- [ ] diff(F7 DiffView 재사용)·선언 tools/model "비신뢰 참고"·eval "품질·비안전"·이종 충실도 경고.
- [ ] 위험 배지 있으면 **명시 확인 전 설치 버튼 비활성**. 승인 후 설치(스킬=폴더 선택 F17·claude↔gemini 에이전트 md 복사). **원격 자동 설치 금지.**
- [ ] 설치 = F17 재사용(백업·drift 감지 F16·쓰기경계 A184).

### 3-4. Publish (AR7)
- [ ] 로컬 정의 선택 → **정적 위험/시크릿 스캔(§3-1·시크릿 발견 시 차단)** → 로컬 브랜치 커밋 → **PR 생성**(직접 push 금지)·eval 등급·요구권한 자동 첨부.
- [ ] **시크릿 오탐 override(R1 MED·R2 HIGH 강화):** override 는 **오탐 구제용이지 우회 통로가 아니다.**
  - [ ] **실 시크릿은 override 불가(hard block):** `ghp_`·`AKIA`·`sk-live`·고엔트로피 실토큰 프리픽스는 **override 자체 금지**(bypass 원천 차단).
  - [ ] **플레이스홀더만 override 대상:** `sk-dummy`·`<TOKEN>`·`example`·`xxxx` 등 명백한 예제 패턴만.
  - [ ] override 시 **사유 기록 + PR 에 표기 + 리뷰어 승인 게이트(사유 기록만으로 자동 통과 금지)**. 자율 에이전트 단독 override 금지.
  - [ ] **negative fixture:** 진짜 `ghp_…`/`AKIA…` override 시도 → 차단 실증. 위험(warn)은 애초 차단 아님(§설계 §3-1).
  - [ ] **난독화 잔여 인정 + 보완(R3 MED):** 정적 스캔은 base64·문자열 분할(`"ghp_"+"…"`) 난독화를 완벽히 못 잡는다(스캔=벨트지 경계 아님·설계 §3-1). → **보완 계층**: GitHub **push protection / secret scanning**·`gitleaks` CI 병행(공급자측 탐지)·실 경계는 팀 신뢰 + 런타임 샌드박스. 스캔 단독 신뢰 금지.

### 게이트
- [ ] **단계마다** 외부감사 ≥2회 no-high 2연속(중대) → 전체 vitest 그린 → 결과서(AR 통과 현황) → check-artifacts → 승인 → 커밋.

---

## 4. S2 — 에이전트 이종 번역 · 신뢰 · 댓글 (중대)

**목표:** 에이전트 md↔TOML 이종 교환 + 충실도 보고 + 위험 스캔 완성 + 댓글 노출. PRD AR10~AR15·AR17.

### 4-1. 중립 IR + 어댑터 (AR10·AR11·설계 §2-2)
- [ ] **IR 스키마(AR10):** `{name,description,instructions,tools[],modelHint,runtimeOrigin,rulesRef,extras{claude,codex,gemini}}`. 게시 시 원본→IR 추출·런타임 고유 필드 `extras` 원문 보존. **P-2 결과 반영(tools 정규화 or 선언 보존).**
- [ ] **S1→S2 마이그레이션(R1 HIGH·R2 무결성 보강):** S1 에서 IR 없이 등록된 에이전트(md 원본만)를 **S2 시점에 IR backfill**(원본→IR 추출·CI or 일괄 도구).
  - [ ] **무결성 검증(R2 HIGH·R3 기준 정정):** 추출 IR → 재렌더 를 원본과 **정규화(canonical) 후 의미 동등 비교** — raw byte/해시 비교 **금지**(공백·개행 CRLF/LF·들여쓰기·키 순서 차이로 **100% 오탐·무한 롤백 루프**·R3 HIGH). 비교 = frontmatter 키-값 정규화(키 정렬·값 deep-equal)·본문 trimEnd 정규화(F7 validateProposal 선례)·TOML 은 파싱 트리 비교. 의미 불일치만 **보류·수기 검토**.
  - [ ] **롤백(R2 HIGH):** 마이그레이션은 PR(원자·리뷰)·실패/오염 시 되돌리기(git revert). 부분 실패 시 완료분·보류분 명시(부분 오염 은닉 금지).
  - [ ] **IR 부재 시 Import 폴백(크래시 아님):** 원본 포맷=대상이면 복사·다르면 "IR 없음·이종 설치 불가" 명시 차단. negative(IR 없는 엔트리·오염 IR import).
- [ ] **렌더러 = 실행 없는 직렬화기(AR11·설계 §2-2·인젝션 방어):** IR→md(frontmatter+본문)·IR→toml(**F15 @iarna/toml**). 템플릿 실행 금지·IR=JSON.parse 메모리안전+스키마+크기상한. **negative 테스트**(악성 IR 인젝션 무해).
- [ ] **설치 = IR 재렌더(AR17):** 저장 렌더물(codex.toml) 비신뢰·IR→재렌더→설치. **negative**(렌더물 변조 우회 차단).
- [ ] **게시 = IR base merge(AR17):** 로컬 산출물→통째 새 IR 금지·기존 IR base 3-way merge·**extras 보존**·충돌=사람 PR. **negative**(extras 증발 차단).

### 4-2. 충실도 보고 (AR12·설계 §2-3)
- [ ] tools 미매핑·modelHint 재매핑·extras 손실·**본문↔도구 결합**(원본 런타임 도구명 참조→대상 실패 가능·사람 수정 권장)을 Import 관문에 100% 명시. (P-2 결과 반영: 매핑 미성립 시 "선언 참고+사람 적응"으로 축소.)

### 4-3. 위험 스캔 — 런타임 결합 확대 (AR13·설계 §3-1 · **핵심 방어는 S1 완결**)
> 시크릿·RCE/exfil·injection 스캔 **완결·negative 는 S1(3-3)** 에 있음(R1). S2 는 **에이전트 이종 결합 확대**만:
- [ ] 에이전트 본문↔도구 결합 감지(원본 런타임 도구명 참조)·modelHint 재매핑 경고를 스캔에 추가·충실도 보고와 연동. negative(런타임 도구명 참조 fixture).

### 4-4. 평가·댓글 3축 (AR14·AR15)
- [ ] eval 등급 배지 "품질·비안전" 병기·위험 스캔과 분리 표시(AR15·평가 세탁 방지).
- [ ] 스킬당 GitHub Discussions 스레드 링크(meta.json.discussionUrl)·카드에 💬수·★(endorse 집계) 노출. **앱내 게시는 S3.**

### 게이트
- [ ] **단계마다** 외부감사 ≥2회 no-high 2연속 → 전체 vitest 그린(보안 negative 포함) → 결과서 → check-artifacts → 승인 → 커밋.

---

## 5. S3 — 후속 (범위 밖·미착수)
- [ ] 앱내 댓글 게시(Discussions API)·서명/출처 증명·사용 카운트·(비기술/실시간 시)서버·공개 배포(불신·서명·샌드박스). **별도 PRD.**

---

## 6. 전체 완료 게이트 (릴리스 전)
- [ ] 선검증 P-1~P-5 실증·결과서.
- [ ] S0·S1·S2 전 단계 결과서 + 각 외부감사 ≥2회 no-high 2연속 수렴.
- [ ] AR1~AR17 전건 통과·보안 negative(캐시 샌드박스·IR 무결성·위험 스캔·쓰기경계) 전건 PASS.
- [ ] 전체 vitest 그린·3-OS CI(Windows write 차단)·정책 감사 PASS.
- [ ] 버전 정합·CHANGELOG·릴리스(별도 요청 시).

---

## 다음 단계 참조
- **R1 외부감사 반영(2026-07-19·codex+agy):** HIGH — ①위험/시크릿 스캐너+negative 를 S2→**S1 로 당김**(Import/Publish 개방 단계에 방어 완결) ②커밋 게이트 **물리 강제**(§0-3·summary.jsonl no-high 2연속·보안 negative·테스트 파싱 exit1·프롬프트 자율 금지) ③**S0 표준→중대**·CI 파싱 방어 선행. MED — 다중 레지스트리 충돌 정책·시크릿 오탐 override·P-2 실패 분기·"무번역·무위험" 문구 정정·git/gh 실패 분기·**S1→S2 IR 마이그레이션**(누락 보강). **재감사(R2) 필요.**
- **선결(비협상):** §0-5 **P-1(스킬 이종 로드)·P-2(tool 매핑 성립)** 가 전체 타당성 관문. 실패 시 S0 규약·S2 에이전트 범위 재설계. 가정 위 구현 금지.
- **핵심 결정·이유:** ① git=원격(서버 미신설·127.0.0.1 경계 불변). ② 스킬-먼저(**포맷** 무번역·단 본문 실행의미 결합·"무위험" 아님)→에이전트 번역(S2·손실 정직 보고). ③ 보안 실경계=팀신뢰+사람 본문검토+런타임 샌드박스(스캔은 advisory 신호·경계 아님·공급자측 secret scanning 보완). ④ 게이트 자기 무결성=CODEOWNERS+CI required check(설정 실활성 검증)·no-high 는 verdicts 재생성 대조(수기 위조 차단). ⑤ 설치=IR 재렌더·게시=base merge·마이그레이션=canonical 동등 비교. ⑥ 다중 레지스트리=네임스페이스 스코핑·폴백 금지(dependency confusion 차단). ⑦ 댓글=Discussions 재사용.
- **다음:** 선검증 착수 → S0 규약 repo·CI → S1 `#/registry`. 각 단계 종료 = 결과서(0-2)+외부감사(0-1)+커밋 게이트(0-3).
