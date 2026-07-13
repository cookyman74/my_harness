# Harness UI v0.8 — 설계서 (멀티런타임 통합 하네스 관리 · Claude·Codex·Gemini(agy))

> 상태: **설계 초안 · 미검증(외부감사 대기).** 짝 PRD = `../prd/v0.8-prd.md`(왜/누구를/무엇을·A180+·위협 R8-a~j).
> 이 문서 = **어떻게 안전하게**(아키텍처·API·쓰기경계 위협모델·측정법). 정본 근거 = `../../v0.6/design/design-v0.6.md`(F7 편집기·I1-I8·경화 바운드-리더)·`../../v0.5/design/design-v0.5-final.md`(코어·로컬 위협모델)·v1.5.1(F11 팩토리)·[Gemini CLI 공식 문서](https://geminicli.com/docs/core/subagents/)·[skills](https://geminicli.com/docs/cli/skills/).
> **선결 게이트(비협상):** F14/F17 착수 전 **경로 사실성 dogfood 선검증**(§10) — 유저-레벨 `.agents/skills` 공유·각 런타임 실제 로딩 경로를 실환경에서 확인. 문서만 믿지 않음(R8-j).

---

## 1. 아키텍처 개관 — 런타임 레지스트리 중심

v0.8의 축은 **런타임 어댑터 레지스트리(F12)** 하나다. 읽기·분류·편집 라우팅·팩토리 설치·인증 감지가 전부 이 레지스트리를 순회한다. 새 런타임 = 항목 1개(로직 수정 0).

```
[ RUNTIMES 레지스트리 (SSOT) ]
        │  순회
   ┌────┼─────────────┬──────────────┬───────────────┐
 읽기(F13)   편집(F14/15)     동기(F16)      설치(F17)      인증(F17)
 harness.ts  defedit.ts      sync         factory.ts     runtime.ts
 harnesslist  safeDefPath    (drift)      installMatrix  (authProbe)
```

**불변식(v0.6 I1-I8 유지 + 확장):**
- I9(신규): 모든 런타임 경로는 **레지스트리 경유**(하드코딩 0). 런타임 오분류 방지(R8-b).
- I10(신규): 쓰기(mutation)는 **화이트리스트 리터럴 dot-dir + 경로안전 풀스택**(§8) + `definitionEditEnabled` 게이트 + 세션 인증. 읽기 확장(홈 dir)은 존재·메타만.
- I11(신규): **파서 공유 ≠ 스키마 공유.** md/TOML 파서는 재사용, **필드 validator는 런타임별**(fail-open 방지).

---

## 2. F12 — 런타임 어댑터 레지스트리

### 2-1. 스키마
> **R1 감사(agent/skill 포맷 분리·HIGH):** Codex는 **에이전트=TOML·스킬=SKILL.md(md)** 혼재 → 단일 `agentFormat`으로 스킬을 파싱하면 크래시. **agent·skill을 독립 서브객체**로 분리(각 format·validator·editable).
```ts
interface RuntimeAdapter {
  id: "claude" | "codex" | "gemini";     // 확장 시 union 추가
  label: string;
  agent: {                                // 에이전트 정의
    dir: string;                          // ".claude/agents" | ".codex/agents" | ".gemini/agents"
    ext: ".md" | ".toml";
    format: "md-frontmatter" | "toml";    // 파서 선택
    validate: (fm: unknown) => ValidationResult; // 런타임별 스키마(I11)
    editable: boolean;                    // F14(md)/F15(toml) 개방
  };
  skills: Array<{                         // 스킬 디렉토리(우선순위 순·별칭 포함)
    dir: string;                          // ".agents/skills" | ".gemini/skills" | ".claude/skills"
    scope: "workspace" | "user";
    format: "skill-md";                   // 전 런타임 SKILL.md 공통
    priority: number;                     // 동일 name 시 상위 채택(별칭 우선순위)
    validate: (fm: unknown) => ValidationResult;
    editable: boolean;
  }>;
  rulesFile: string;                      // 읽기 표시용·install 대상 아님
  install: { channel: "claude" | "shared"; wsDest: string; userDest: string };
  authProbe: () => Promise<AuthState>;    // 파일 근거(§7-4)
}
```
- **파서 라우팅:** 읽기(F13)·편집(F14/15)은 **대상 종류(agent vs skill)**로 format을 골라 파서/validator 매핑. Codex 스킬(md)을 TOML 파서로 읽는 혼동 원천 차단.

### 2-2. 확정 항목 (공식문서·§10 선검증 대상)
| id | agentsDir | agentExt | skillsDirs | rulesFile | install.channel | wsDest / userDest |
|----|-----------|----------|-----------|-----------|-----------------|-------------------|
| claude | `.claude/agents` | `.md` | [`.claude/skills`] | CLAUDE.md | claude | `~/.claude/skills/myharness` (또는 marketplace) |
| gemini | `.gemini/agents` | `.md` | [`.agents/skills`, `.gemini/skills`] | GEMINI.md | shared | `.agents/skills/myharness` / `$HOME/.agents/skills/myharness` |
| codex | `.codex/agents` | `.toml` | [`.agents/skills`] | AGENTS.md | shared | `.agents/skills/myharness` / `$HOME/.agents/skills/myharness` |

- **채널 접힘:** codex·gemini는 install.channel="shared" → **`.agents/skills` 한 링크로 둘 다** 커버(§7-2). claude만 별도.
- **폴백(R8-j):** §10 선검증서 유저-레벨 `.agents/skills` 공유 미작동 판명 시 codex/gemini `userDest`를 `~/.codex/skills`·`~/.gemini/skills`로 분리(레지스트리 데이터 교체만·로직 무변).

### 2-3. 리팩터 범위 (순수·기능 불변)
`harness.ts`(readAgents/readSkills 경로)·`harnesslist.ts`·`factory.ts`(F11 dest)·`runtime.ts`(detect)의 하드코딩 경로를 레지스트리 순회로 치환. **기존 테스트 전건 그린 = 리팩터 성공 기준**(A180).

---

## 3. F13 — 멀티런타임 읽기 + 공용·서브 스킬 뷰 (읽기전용)

### 3-1. Gemini 읽기 편입
- `readAgents`: 레지스트리 순회 → `.gemini/agents/*.md`(md-frontmatter 파서 재사용) 추가. runtime="gemini" 태깅.
- `readSkills`: `skillsDirs` 순회 → `.gemini/skills` 추가(`.agents/skills`는 기존). **별칭 우선순위**(`.agents/skills` > `.gemini/skills`) 반영 — 동일 name 중복 시 상위 채택(공식 규약).
- **broken symlink fail-soft(R8-g):** 스캔 중 `ENOENT`/dangling → 해당 항목 `broken` 태깅·**전체 스캔 중단 금지**(graceful·배지 노출).

### 3-2. 공용·서브 스킬 역인덱스·분류
- 서버 `listHarnesses` 확장 → **skill→harness 역맵** 산출:
  - 각 오케스트레이터(orchestrates: 선언)의 배정 에이전트 → 그 에이전트 `skills:` → 스킬. 역방향 집계.
  - 분류: `orchestrator`(orchestrates: 보유) / `shared-sub`(≥1 하네스가 씀) / `orphan`(아무도 안 씀).
- **API** `GET /api/skills/usage` → `{ skill, runtime, classification, usedBy: harness[] }[]`. 읽기·side-effect 0.
- UI(`#/build` 섹션): 분류·런타임 배지·사용 하네스 역인덱스·orphan 경고. **편집 버튼 = `#/skills`(F7) 딥링크**(중복 편집기 금지).

### 3-3. 측정 (A181·A182)
`.gemini` fixture(에이전트·스킬)로 인벤토리·하네스 목록에 gemini 배지 표시 e2e. 역맵 단위 테스트(orphan·shared-sub 분류·usedBy 정확).

---

## 4. F14 — md-frontmatter 편집 확장 (Claude + Gemini)

### 4-1. 파서 재사용 + 런타임별 validator (I11·R1 감사)
- **재사용:** md+YAML frontmatter **컨테이너 파서·canonicalizer·differential**(F7 기존)은 Claude·Gemini 공통.
- **분리:** `schemaValidator`(레지스트리) — Claude/Gemini 각 **required/optional 필드·미지 필드 보존** 규칙. 검증 실패 → 저장 거부(fail-closed). 미지 필드 = 보존(런타임 미래 필드 파괴 금지).

### 4-2. 심링크-편집 정책 (F17 심링크 설치와 공존·R1 HIGH 재수정)
편집 대상이 심링크일 수 있음(F17 설치). **⚠ R1 감사(양엔진 HIGH): "projectRoot 내면 신뢰"는 과넓다** — 공격자가 `.agents/skills/evil.md` 심링크를 `projectRoot/.env`·`.git/config`·`package.json`으로 걸면 통과 → 민감 파일 덮어쓰기(권한 상승). 정본 `skills/` 자체가 심링크면 의미도 붕괴. **→ projectRoot 전체가 아니라 정본 화이트리스트로 엄격 축소:**
```
편집 요청(name, runtime)
  → resolveEditable(레지스트리 경로)  → 대상 lstat:
      실파일  → 그대로 편집(경로안전 §8)
      심링크  → realpath(타깃):
          타깃이 TRUSTED_EDIT_ROOTS 중 하나의 하위  → 그 실파일로 리다이렉트(딥링크)
          아니면                                     → 거부 "edit-symlink-untrusted-target"(409)
```
- **TRUSTED_EDIT_ROOTS** = 명시 화이트리스트(정본만·**registry/manifest 기반**): 레지스트리에 **등록된 정본 skill root**(예: `realpath(projectRoot/skills/myharness)`) + 각 런타임 editable dot-dir 실디렉토리. **`skills/*` 전체 동적 신뢰 금지**(느슨함) — 등록된 root만. projectRoot 전체·`.env`·`.git`·`package.json` 절대 불포함.
- **정본 root 자체 심링크 금지:** 각 root `lstat` — 심링크면 무효(또는 설치 시 pin). 정본이 심링크면 편집 거부.
- **hardlink 정책(직접 편집):** 최종 실파일 `nlink > 1`이면 **저장 거부**(다중 경로 동시 변경 위험). F16 drift 화면에서만 hardlink는 위험 배지 + 명시 확인 후 허용.
- **리다이렉트 후 재검증:** 최종 실파일 `(dev, ino)`·owner·mode·nlink 확인 + TRUSTED_EDIT_ROOTS containment(`realpath` 접두) 재확인·swap 방지.
- **최종 쓰기 파일은 항상 실파일**(심링크 최종파일 쓰기 금지 유지). F16과 정합(심링크 사본=정본 1회 편집 반영).

### 4-3. 쓰기 경로 확장 배선
`resolveEditableAgent/Skill`·`safeDefPath` 화이트리스트에 레지스트리의 editable 런타임 dot-dir 추가. config-change 원장 `runtime` 태깅. `definitionEditEnabled` 게이트 공유.

---

## 5. F15 — Codex TOML 편집

### 5-1. TOML canonicalizer (AST·주석 보존)
- **AST 파싱**(정규식 금지) → 편집 → **주석·구조 보존 직렬화**. differential = **semantic diff**(effective 구조 변화, 텍스트 변화 아님).
- 검증(injection·R8-c): **duplicate key fail-closed**·dotted-table shadowing 거부·이스케이프 엄격·**미지 특권 필드 preserve-only 또는 명시 확인**·멀티라인 프롬프트 주입 무해화.

### 5-2. 라이브러리 선검증 게이트 + fail-soft (R1 감사·MED)
- **현실성 리스크:** Node 생태계에 **주석 보존 라운드트립 + AST 변형** 지원 TOML 라이브러리가 흔치 않음(대부분 주석 유실). M-e 병목.
- **선검증(F15 착수 전 게이트):** 후보 리서치 — Taplo(Wasm/`@taplo`)·`@iarna/toml`(주석 유실) 등 실측. **주석 보존 라운드트립 가능**한 라이브러리 확보되면 full-edit.
- **fail-soft 차선:** 주석 보존 불가로 판명 시 Codex TOML 편집은 **read-only 또는 limited-edit**(특정 필드만·주석 무손실 보장 범위)로 축소(설계서 명시·전면 개방 강행 금지).
- **semantic diff 정의:** `정규화 파싱 객체(order-insensitive table 비교) + 보존된 미지 필드` 기준(텍스트 diff 아님). 주석 위치는 **full-edit(주석 보존 가능)일 때만** diff에 포함 — limited/read-only fail-soft에선 제외(모순 방지).

### 5-3. 측정 (A185)
TOML differential·injection fixture(중복키·shadowing·이스케이프 탈출·구조변조)·손상 fail-closed·라운드트립 주석 보존(또는 fail-soft 축소 증명). 외부감사.

---

## 6. F16 — 트리런타임 동기 (drift)

### 6-1. 동일군 분류 (R1 감사·(dev,ino)·hardlink 분리)
> **⚠ inode만 비교하면 오판**(inode는 device 내에서만 고유·cross-fs 우연 일치). **`(dev, ino)` 튜플**로 판정. hardlink는 같은 (dev,ino)지만 "정본-링크"가 아니라 다중 실경로.
- **분류 3종:**
  - `symlink-to-canonical`: 심링크가 정본을 가리킴(readlink→realpath=정본) → **drift 제외·자동 동기 대상**(물리 동일).
  - `hardlink-same-inode`: 같은 `(dev,ino)`인데 심링크 아님(다중 hardlink) → **직접 편집은 §4-2로 `nlink>1` 거부**. F16 drift 화면에서만 위험 배지 + 명시 확인 후 apply(같이 바뀜 인지).
  - `copy`: 다른 `(dev,ino)`·내용 해시 비교 → **drift 대상**.
- **기본 = drift 경고 + 명시 다타깃 apply.** 사용자가 대상 체크 → 실사본들에 순차 apply(대상별 pathId·baseHash·낙관적 동시성·한 사본 stale이면 그것만 409).
- **자동 동기 = `symlink-to-canonical`만.** `copy`·`hardlink`는 자동 동기 금지.

### 6-2. 측정 (A186)
`(dev,ino)` 튜플 판정·심링크/hardlink/copy 3분류·심링크 drift 제외·hardlink 위험배지·copy 명시 다타깃·무단 자동/부분 동기 없음. cross-fs fixture(우연 inode 일치) 오판 없음.

---

## 7. F17 — 설치 매트릭스 (정본1-링크N)

### 7-1. 운영 모델
- 정본 = `skills/myharness/` 1곳. 런타임 설치 = 정본 심링크를 런타임 스킬 dir에.
- **감지:** 레지스트리 순회 → 각 런타임 CLI(`--version`)/config dir 존재. 미감지 → 매트릭스 행 비활성(설치 권유 안 함).

### 7-2. 채널 2개 (§2-2 확정)
- **A. Claude:** `~/.claude/skills/myharness`(심링크) 또는 marketplace(감지·`/plugin update` 안내·택1·중복 감지).
- **B. 공유:** `.agents/skills/myharness`(워크스페이스)·`$HOME/.agents/skills/myharness`(유저) → **Codex+Gemini 동시**. 한 링크 = 두 런타임.
- 매트릭스 UI: 채널 B는 "Codex+Gemini(공유·링크1)" 한 행으로 명시.

### 7-3. 벌크·drift·부분성공 (R1 감사·트랜잭션 경계)
- `POST /api/factory/apply` 확장: `{ target: runtimeId|"channel-shared"|"all-detected", action, confirm? }`.
- **트랜잭션 경계 명시:** 원자 단위 = **채널**(Claude 채널·shared 채널). `all-detected`는 **트랜잭션 아니라 batch**(채널들의 묶음 실행) — API에 명시.
- **operation id + 채널별 결과 로그:** 각 apply에 opId 부여·**채널별 transaction log**(설치/백업/원복). 부분성공 시 `{ opId, channels: [{ channel, runtimes, result, backup? }] }` 반환(F11 낙관 패치·백업·원복 재사용). 한 채널 실패가 다른 채널 안 막음·채널 단위 best-effort 원복.
- **drift:** 정본 vs 각 링크(broken-link 포함·fail-soft) → `동기 필요` 배지·[전체 동기] 재수렴.

### 7-4. agy 인증 감지 (runtime.ts authProbe·R1 감사·4-state)
> **과신 금지:** oauth 파일 존재+mode로는 stale/expired/revoked 구분 불가. **"인증됨" 단정 금지.**
- 상태 4종: `authenticated`(claude/codex CLI 실조회) / **`configured`**(agy: 자격 파일 존재·현재 유저 owner·**내용 미판독**) / `unauthenticated` / `unknown`.
- agy = **`configured`("설정 감지")** 표시 — "인증됨" 아님. 판정 = `~/.gemini/oauth_creds.json` 존재 + **owner==현재 유저**(mode 600은 POSIX 전용이라 Windows ACL서 오작동 → **owner 검사**로·존재+owner). 부재 → `unauthenticated`.
- Ops 통합: 등록 런타임 전부 설치·버전·인증 상태(4종·근거) 일관 표시. (Windows owner 확인은 별도 플랫폼 API 필요·§8-2로 mutation 차단이라 인증 **표시 전용** LOW.)

### 7-5. 스코프
factory install = **스킬 링크만.** 규칙파일(CLAUDE/AGENTS/GEMINI.md) untouched(A188 negative 검증).

---

## 8. 쓰기경계 위협모델 (경로별·상세)

새 쓰기 경로(`.gemini`·`.agents`·`.codex`)마다 Claude 편집이 받은 풀스택 + 추가:

| 위협 | 방어 (구현 수준) |
|------|-----------------|
| **경로 탈출(traversal)** | 화이트리스트 **리터럴 dot-dir만**·name은 세그먼트 검증(`isSafeSegment`)·`..`/절대경로/드라이브/UNC 거부 |
| **중간 dir 심링크 리다이렉트** | **per-segment `lstat`**(각 세그먼트 심링크 아님)·root `realpath` containment. (openat 대체 = §8-1 app-level open+fstat) |
| **최종파일 심링크·TOCTOU** | O_NOFOLLOW(POSIX)·**open 후 `fstat` 핸들의 `(dev,ino)`를 pre-open `lstat`과 대조**(swap 탐지·§8-1)·rename 전후 inode/root 재검증·temp 파일 **동일 dir**·hardlink 카운트 정책 |
| **CSRF·DNS rebinding·Origin 우회(R8-i)** | 기존 `security.ts`(Host allowlist·Origin·세션 토큰·127.0.0.1 bind)를 **새 쓰기 라우트 전부 적용**·no-CORS·preflight 실패 거부·mutation 게이트 |
| **동시 쓰기 lost-update** | pathId(GET↔PUT 동일 정의 강제)·baseHash 낙관적 동시성·뮤텍스(F7 기존) |
| **런타임 오분류(Claude 정의를 Codex로 쓰기)** | 레지스트리 단일출처·runtime 태깅·pathId 대조·원장 runtime 기록 |
| **TOML injection** | §5-1(AST·중복키 fail-closed·shadowing·이스케이프·특권필드) |
| **홈 dir 읽기 확장 프라이버시** | 존재·메타만·비밀 미판독·UI 밖 송출 0·프로젝트 스코프 우선 |

### 8-1. openat 대체 — app-level open+fstat 재검증 (R1 감사·HIGH)
> Node 기본 `fs`엔 POSIX `openat`/dirfd 체인이 없음. "dirfd/openat 스타일"만 쓰면 구현자가 `path.join+lstat+open`으로 후퇴 → TOCTOU 방어 붕괴.
- **확정 기법(Node-only·네이티브 애드온 없이):** ① 경로 세그먼트 per-`lstat`(심링크 아님) + root `realpath` containment → ② `open(O_NOFOLLOW where available)` → ③ **핸들 `fstat`의 `(dev,ino)`를 ②직전 `lstat` 값과 대조**(불일치=swap → 거부·nlink>1 거부) → ④ temp 동일 dir 쓰기 → **rename 직전 parent dir `realpath`+`lstat(dev,ino)` 재확인**(validation 후 부모 dir swap 방지) → `rename` → ⑤ rename 후 최종 파일 재-`lstat`(dev,ino,nlink,root containment). **잔여 TOCTOU 창은 극소**(로컬 단일사용자 위협모델·프로세스 단일 유저). 참 openat이 필요하면 네이티브 애드온은 **비목표**(범위 축소).
- **A184에 "open-after-swap race harness"** 로 실증(open과 fstat 사이 파일 교체 시 거부).

### 8-2. Windows 쓰기경계 (R1 감사·HIGH)
> `O_NOFOLLOW`·mode 600·POSIX 심링크는 Windows서 무의미/오작동. reparse point/junction·ACL·case-insensitive·drive/UNC.
- **v0.8 기본 정책: Windows는 mutation(F14/F15/F17 설치) 기본 차단**(`unsupported-platform-write`) — 읽기(F13)·Ops는 지원. 안전 경로 정본화 전 쓰기 강행 금지.
- **선택 지원 시 `safePathWindows` 별도 설계:** `fs.realpath.native`·reparse tag 검사(junction/symlink 거부)·final-open 후 handle 기반 `(dev,ino)` 검증·**case-fold containment**·drive/UNC canonicalize·atomic replace 한계 명시. A184 platform matrix로 증명 전엔 차단 유지.
- **agy 인증:** mode 600 대신 **존재+owner** 검사(§7-4·Windows ACL 정합).

---

## 9. API 계약 (요약)

| 메서드·경로 | 용도 | mutation | 게이트 |
|------------|------|----------|--------|
| `GET /api/skills/usage` | 스킬 분류·역인덱스(F13) | — | — |
| `GET /api/factory/matrix` | 설치 매트릭스 상태(런타임×상태·drift) | — | — |
| `POST /api/factory/apply` | 설치/동기/제거(런타임별·벌크·F17) | ✅ | 세션·factoryMaintenanceEnabled·경로안전 |
| `GET /api/definitions/:runtime/:kind/:name` | 정의 조회(F14/15·런타임 파라미터화) | — | — |
| `PUT /api/definitions/:runtime/:kind/:name` | 정의 편집(F14/15) | ✅ | 세션·definitionEditEnabled·경로안전·validator |
| `GET /api/ops/status` | 런타임 상태·인증(F17·기존 확장) | — | — |

> 기존 F7 라우트(`/api/context/build/*`·정의 편집)를 런타임 파라미터화로 일반화 — 신규 병렬 라우트 최소화(레지스트리 순회).
> **하위 호환(R1 감사):** 기존 고정 라우트를 **제거하지 않음** — `runtime="claude"` 기본으로 신규 핸들러에 포워딩하는 **compatibility shim** 유지. pathId 형식·응답 shape **불변 보장 테스트** 추가(기존 클라이언트 404 방지).

---

## 10. 선검증 게이트 (경로 사실성 dogfood · 비협상 · F14/F17 전)

**문서만 믿지 않는다(R8-j).** F14/F17 구현 착수 **전** 실환경 확인:
1. **각 런타임 실제 로딩 경로:** Codex가 `~/.agents/skills` 유저-레벨을 실제 읽는가? Gemini가 `.gemini/agents/*.md`를 실제 활성화하는가? — 더미 에이전트/스킬 심어 각 CLI로 활성 확인.
2. **공유 별칭:** `.agents/skills` 링크 1개가 Codex·Gemini 둘 다에서 활성되는가(워크스페이스·유저).
3. **frontmatter 스키마 차이:** Claude·Gemini 에이전트 필수/허용 필드 실제 차이 목록화(validator 근거).
4. **TOML 라이브러리(F15 전):** 주석 보존 라운드트립 지원 라이브러리 실측(§5-2) — 불가 시 Codex 편집 read-only/limited로 축소.
5. **플랫폼(쓰기 전):** POSIX(mac/linux) 쓰기경계 실증 + Windows는 mutation 차단 기본(§8-2) — safePathWindows 증명 전 열지 않음.
- **실패 시:** 레지스트리 폴백(채널 3분리)·해당 런타임 editable=false·플랫폼 write 차단 유지. **가정 위 구현 금지.**

---

## 11. 수용기준 측정법 (A180+ · PRD §9 대응)

| A | 측정 |
|---|------|
| A180 | 런타임 경로 grep=레지스트리 경유만(하드코딩 0)·기존 전체 테스트 그린(리팩터 회귀) |
| A181 | `.gemini` fixture → 인벤토리·하네스목록 gemini 배지 e2e |
| A182 | 역맵 단위테스트(orphan/shared-sub 분류·usedBy)·섹션 읽기전용·F7 딥링크 |
| A183 | Claude/Gemini 편집·롤백 e2e·**런타임별 validator**(미지/필수 필드 fixture)·심링크 **TRUSTED_EDIT_ROOTS** 리다이렉트/untrusted-target 거부·정본 root 심링크 거부 |
| A184 | **platform matrix**(mac/linux 지원·Windows write 차단)·per-seg 심링크·traversal·**trusted-root symlink negative**·**projectRoot-inside-untrusted(.env/.git) negative**·hardlink negative·**open-after-swap race harness**·CSRF/Origin 거부·외부감사 no-high |
| A185 | TOML differential·injection fixture(중복키·shadowing·이스케이프)·주석보존(또는 fail-soft 축소 증명)·fail-closed |
| A186 | `(dev,ino)` 판정·심링크/hardlink/copy 3분류·심링크 drift 제외·hardlink 위험배지·copy 명시 다타깃·cross-fs 오판 0 |
| A187 | oauth_creds 유무 fixture → `configured`("설정 감지")/`unauthenticated`·owner 검사(mode 아님)·내용 미판독·4-state 분리 |
| A188 | 매트릭스 벌크(전체 설치/동기/제거)·부분성공 보고·미감지 비활성·규칙파일 untouched(negative) |
| A188b | `.agents/skills` 링크 1개=Codex+Gemini 커버(선검증)·폴백 3채널 |
| A188c | drift 감지·[전체 동기]·**broken-symlink fail-soft**(읽기 크래시 0·broken 배지) |
| A189 | 전 mutation: 세션·게이트·선검증(R8-j)·외부감사 수렴 후 배포 |

---

## 12. 마일스톤·의존

| M | 기능 | 의존 | 게이트 |
|---|------|------|--------|
| M-a | F12 레지스트리(리팩터) | — | 회귀 그린 |
| **선검증** | §10 경로 사실성 dogfood | M-a | **F14/F17 전 필수** |
| M-b | F13 읽기·공용스킬 섹션 | M-a | 읽기전용(경량) |
| M-c | F14 Claude+Gemini md 편집 | M-a·선검증 | 쓰기경계 외부감사 |
| M-d | F17 설치 매트릭스·agy 인증 | M-a·선검증 | 설치 외부감사 |
| M-e | F15 Codex TOML 편집 | M-c | TOML injection 외부감사 |
| M-f | F16 트리런타임 동기 | M-c·M-e | 동기 정책 외부감사 |

> 순서: M-a → 선검증 → (M-b·M-c·M-d 병행 가능) → M-e → M-f. Gemini(md)가 Codex(TOML)보다 선행.

---

## 다음 단계 참조

- **미해결·선결:** ① §10 선검증(경로 사실성)이 최우선 — 실패 시 채널/편집 범위 축소. ② F15 TOML AST canonicalizer는 라이브러리 선정(주석 보존 라운드트립 지원 여부)이 관건. ③ v0.7 A113-A122 재번호(A131-A150) vs v0.8 A180+ 분리 유지. ④ 기타 런타임 편입은 규약 확인 후 레지스트리 append(가정 금지).
- **핵심 결정·이유:** **레지스트리(F12) 단일축** = 이후 전부 additive·런타임 오분류 방지. **파서 공유·validator 분리**(I11) = 과대주장 회피·fail-open 방지. **심링크-편집 리다이렉트**(신뢰 타깃만) = F14 보안 ↔ F17 심링크 설치 모순 해소. **심링크 사본 drift 제외** = F16 과설계 방지. **선검증 게이트** = 문서 위 가정 구현 금지.
- **다음 작업 사전:** M-a(레지스트리) 구현 착수 시 이 설계서 §2·§8 + PRD `## 다음 단계 참조`를 먼저 읽고 시작. 선검증(§10)은 M-a 직후·M-c/M-d 전.
