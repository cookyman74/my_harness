# 하네스 업데이트 (팩토리 정본 → 빌드된 산출물 재전파)

`/myharness update`(Codex: `$myharness update`)의 방법론. 팩토리 정본을 고친 뒤 **이미 빌드된 하네스**(생성 산출물)에 반영한다. 핵심 제약: **사용자가 산출물을 수정했을 수 있으므로 그 수정분을 보존**한다(덮어쓰기 금지).

## 왜 자동 전파가 안 되나
팩토리 주입은 **복사 + 실경로 참조**(F1) — 서브에이전트가 플러그인 내부 경로를 해소 못 해 정본을 타겟에 복사한다. 정본을 고쳐도 빌드된 복사본엔 자동 반영 안 됨(의도된 DRY 트레이드오프). → `update`로 재동기.

## 선행 (정본 = 설치본 보장)
1. **플러그인 최신화** — Claude: `/plugin marketplace update myharness-marketplace` → `/plugin update myharness` → `/reload-plugins`. Codex: 심링크면 `git pull`로 끝(레포 직결).
2. 그 후 `/myharness update` 실행.

## 관리 정책 (파일별 소유)
| 종류 | 소유 | update 처리 |
|------|------|-------------|
| 생성 하네스에 번들되는 references·scripts (목록 = `harness-update.sh` 의 `MANAGED_RELS`) | 팩토리 | 해시 비교 후 갱신/승인 |
| 에이전트 역할·스킬 도메인 본문 | **사용자** | 정본은 "주입 1줄"만 관리 → 본문 보존(아래) |
| `*.local.*`(사용자 추가 정책) | **사용자** | 관리 대상 제외 — **절대 안 건드림** |
| `external-review-loop` 스킬(SKILL+scripts) | 팩토리 | 재생성 경로(Phase 4-6 재실행) |

> **사용자 정책 추가는 `.local` 분리 권장:** 관리 교리 파일을 인라인 수정하면 매 update마다 승인 충돌이 난다. 대신 `references/dev-rules.local.md`에 추가하고 에이전트 `## 작업 원칙`에 정본+local 두 줄을 참조 → update가 local을 안 건드려 무충돌.

## 해시 기반 분류 (사용자 수정 보존)
생성 시 `manifest`가 관리 파일 sha를 `.harness-manifest.json`에 기록(= 생성 당시 기준선). update는 파일별로:

| 분류 | 조건 | 처리 |
|------|------|------|
| **SAME** | 현재 == 정본 | 갱신 불필요 |
| **UPDATABLE** | 현재 == manifest ≠ 정본 | 사용자 미수정 + 정본 변경 → **자동 적용** |
| **USER-MODIFIED** | 현재 ≠ manifest | 사용자 수정함 → diff 제시 → **승인 필요**(자동 X) |
| **UNKNOWN** | manifest 없음 | 기준선 없음(구 산출물) → diff 제시 → 승인 필요(보수) |
| **NEW** | 정본엔 있고 타겟엔 없음 | 신규 교리(예: 새 reference) → 자동 추가 |

## 절차 (스크립트가 결정적 작업, 오케스트레이터가 판정·승인)
1. **선행** 플러그인 최신화 확인(위).
2. **타겟 식별** — 빌드된 하네스의 스킬 루트(`<타겟>/.claude/skills/<harness>`). 듀얼이면 `.agents/skills/<harness>`도.
3. **plan** — `bash <이 스킬의 디렉토리>/scripts/harness-update.sh plan <skill_dir> <factory_dir>` → 파일별 분류 + diff(변경 없음, propose-only).
4. **승인 관문** — USER-MODIFIED/UNKNOWN diff를 사용자에게 제시. 자율 마커(`_workspace/.autonomous`) 시 자동 통과(단 사용자 수정 파일은 기본 보류 — 명시 승인만 적용).
5. **apply** — `bash <이 스킬의 디렉토리>/scripts/harness-update.sh apply <skill_dir> <factory_dir> [--approve rel1,rel2]`. UPDATABLE/NEW=자동, USER-MODIFIED=`--approve` 든 것만. 적용 후 manifest 자동 갱신(새 기준선).
6. **결선 재렌더** — `apply` 로 `scripts/harness-intake.mjs` 가 갱신됐으면 `node <skill_dir>/scripts/harness-intake.mjs verify --orchestrator <오케스트레이터>` 를 돌린다. 팩토리가 문항 라벨을 고치면 `catalog_version` 이 올라 **답이 그대로여도 전 블록이 `stale`** 이 된다(라벨 변경을 `drift` 로 오분류하지 않으려는 설계). 처리:
   - `stale` 만 있으면 → **교체 전에 기존 블록 내용을 보관**(`<파일>.bak-<압축시각>` 또는 보고에 diff)하고 `render --orchestrator <오케스트레이터> --block <id>` 로 교체한 뒤 **교체 전후 diff 를 사용자에게 보인다**. 재 `verify` 가 `ok` 인지 확인. 답은 건드리지 않는다.
     - **왜 보관하는가:** 같은 손수정 블록이 `catalog_version` 2 에서는 `drift`(보호됨 · 아래 항)였다가 3 에서는 **`stale`** 로 분류된다 — "stale 만 있으면 교체" 를 그대로 돌리면 **손수정이 diff 없이 사라진다**.
   - `missing`·`drift`(·`malformed`·`duplicate`·`misplaced`)가 있으면 → **자동으로 고치지 않고 사용자에게 보고**한다. `drift` 는 사람이 블록을 손으로 고친 흔적이라 덮어쓰면 그 의도가 조용히 사라진다.
   - 이 단계를 빼면 라벨 한 줄을 바꾸는 팩토리 릴리스가 **모든 생성 하네스를 Phase 0 결선 확인에서 멈추게** 한다.
6-1. **`apply` 후 1회 수동 작업 2종**(자동 전파 대상이 아니다)
   - **⑥ 반출 정책 답하기** — `answer --mode extend --only egress`. 미답이어도 일상 실행은 무마찰이지만 **중대 등급 게이트를 쓰면 사실상 필수**다(`degraded` 에 `egress assumed` 가 실려 수렴 카운트를 막는다).
   - **런처 줄 갱신** — `plan` 이 `LAUNCHER: needs-update` 를 내면 `<root>/.claude/skills/external-review-loop/SKILL.md` 의 호출 줄에 `REVIEW_GRADE=`·`HARNESS_ORCHESTRATOR=` 를 붙인다. **고치기 전까지 그 하네스의 외부리뷰는 전부 `failed`** 다(사용자 소유 파일이라 도구가 자동 편집하지 않는다).
   - 되돌리기: `apply` 는 직전 기준선을 `.harness-manifest.prev.json` **1세대**만 남긴다 — 그보다 앞으로는 못 돌아간다(정본 복구 경로는 git 이다).
7. **에이전트 본문 주입 라인 갱신** — 정본 주입 형식이 바뀐 경우만, 에이전트 `## 작업 원칙`의 `> ... dev-rules.md 준수` 한 줄을 새 형식으로 교체(본문 나머지 보존). 형식 불변이면 생략.
8. **external-review-loop 스킬** — **스크립트 4종은 이제 `harness-update.sh` 가 담당한다**(v1.8.3 S5 · 관리 대상이 디렉토리 종류로 갈렸다).
   그 스킬 디렉토리를 대상으로 `plan|apply` 를 **따로 한 번 더** 돌린다 — 오케스트레이터 스킬에 돌린 실행은 런처를 건드리지 않는다.
   **SKILL 본문**(런처 호출 줄 포함)은 여전히 사용자 소유라 자동 갱신 대상이 아니다 — `LAUNCHER: needs-update` 가 뜨면 그 줄만 손으로 1회 고치고, 본문 전체를 바꿔야 할 때만 Phase 4-6 재생성.
   - **듀얼 런타임이면 실행이 4회다:** `.claude/skills/{오케스트레이터}` · `.claude/skills/external-review-loop` · `.agents/skills/{오케스트레이터}` · `.agents/skills/external-review-loop`.
     한 곳이라도 빠뜨리면 그 런타임에 **죽은 사본**(옛 스크립트)이 남고, 새 런처가 부르는 `egress` 를 구 해석기가 몰라 그 하네스의 외부리뷰가 전부 `failed` 가 된다.
9. **듀얼 런타임 동기** — `.claude/`↔`.agents/` 양쪽에 동일 적용(Phase 7-6). `premise` 블록은 `CLAUDE.md`·`AGENTS.md` 양쪽에 같이 있어야 한다.
10. **검증** — 갱신된 references 실경로 참조 무결성·`bash -n` 스크립트·트리거 재확인(Phase 6).

## 생성 시 매니페스트 기록 (req — Phase 5-4)
하네스 생성 직후 **반드시** `bash <이 스킬의 디렉토리>/scripts/harness-update.sh manifest <skill_dir> <factory_dir>` 실행 → `.harness-manifest.json` 남김. 이게 있어야 후속 update가 사용자 수정을 해시로 구분한다. 없으면 모든 변경이 UNKNOWN(보수)로 떨어져 매번 수동 승인.

## 하위호환 (구 산출물 = manifest 없음)
manifest·jq 부재 시 보수 모드 — 변경 파일을 전부 USER-MODIFIED/UNKNOWN로 보고 자동 적용 안 함(diff 제시 → 수동 승인). 첫 update 후 manifest가 생겨 다음부터 정상 동작.

## 한계
- **관리 대상 목록의 단일 출처는 `harness-update.sh` 의 `MANAGED_RELS`** 다(신규 배포 제외분은 같은 파일 `NEW_EXCLUDE_RELS`). 여기에 다시 나열하면 화이트리스트가 늘 때마다 이 문서가 조용히 틀려진다 — 실제 값은 스크립트에서 확인한다. 관리 밖으로 남는 것: **에이전트·스킬 본문**(사용자 소유 — 자동 병합 비대상, 주입 라인만 절차로 갱신) · **`*.local.*`**(사용자 추가 정책 — 절대 안 건드림) · **팩토리 전용 스크립트**(`run-policy-audit.sh`·`harness-update.sh` 등 — 생성 하네스에 번들되지 않아 관리 제외).
- 3-way 자동병합 아님(중간 전략) — 충돌은 사용자가 해결(USER-MODIFIED는 정본으로 통째 교체 or 보류, 부분 병합은 수동).
- `jq` 권장(manifest 읽기/쓰기). 없으면 보수 모드.
