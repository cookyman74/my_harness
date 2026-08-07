# 외부 리뷰 루프 (External Review Loop) — 방법론 & 생성 템플릿

이 파일은 두 역할을 한다:
1. **방법론 정본** — 단계 산출물 마감 게이트(외부 독립 AI 리뷰)의 표준 절차.
2. **생성 템플릿** — 코드/설계 도메인 하네스를 만들 때, 이 내용을 타겟 프로젝트의 `.claude/skills/external-review-loop/SKILL.md`로 생성한다(아래 frontmatter 포함). **단, 생성 전 `check-review-tools.sh {러너}`로 러너 제외 `REVIEWERS:`를 확인**하고, 외부 리뷰어가 없으면(`REVIEWERS: none` — 러너 엔진만 설치된 경우 포함) 스킬을 만들지 않는다(Phase 4-6). 생성 시 `check-review-tools.sh`·`run-review.sh`·`build-scorecard.sh`·`emit-loop-scorecard.sh`를 스킬의 `scripts/`로 함께 번들한다(실행 파일 퍼미션 유지).

**왜 외부 리뷰인가**: 내부 생성-검증/QA는 같은 세션·같은 컨텍스트라 *동일한 맹점*을 공유한다. 외부 독립 AI는 다른 관점으로 결함을 잡는다. 단, **합의=정답이 아니다** — 두 AI가 같은 답을 내도 공유 학습데이터로 인한 상관 오류일 수 있다. 합의는 약한 증거이며, **판정 권위는 오케스트레이터에 있다 — 근거 수집(실코드 대조)은 보조 에이전트에 위임 가능하나, 최종 확정(confirm)은 비위임.**

**독립성 = 엔진 다양성(req)**: 리뷰어 모델 ≠ 러너 모델이어야 진짜 독립이다. subprocess 격리로 *컨텍스트*는 분리돼도, **러너와 같은 엔진은 같은 맹점을 공유**한다(codex가 codex를 검증 = 자기검증). 따라서 외부 리뷰어는 **현재 런타임의 러너 엔진을 제외**하고 고른다:
- **Claude Code 런타임**(러너=claude) → 일반/정합성 리뷰어 = **codex**, 성능/안정성 = **agy**(Gemini)
- **Codex 런타임**(러너=codex) → 일반/정합성 리뷰어 = **claude**, 성능/안정성 = **agy**(Gemini)
- agy(Gemini)는 양쪽 런타임 모두에서 러너와 다른 엔진이라 항상 유효. `check-review-tools.sh [runner]`가 러너 제외한 `REVIEWERS:` 줄을 산출한다.

## 생성 시 frontmatter
```yaml
---
name: external-review-loop
description: 작업 단계 산출물(설계서·코드·문서)마다 외부 독립 AI(러너 엔진 제외 — Claude면 codex+agy, Codex면 claude+agy)에 리뷰 요청 → 오케스트레이터가 실코드 대조 전건 판정(확인/부분/이월/기각) → 확인분만 TDD 수정·커밋하는 단계 마감 게이트. "외부 리뷰", "codex/claude/agy 리뷰", "리뷰 게이트", "설계서/코드 리뷰해서 검증·수정", "이슈 검증하고 수정" 요청 시 반드시 사용. 사용자 수동 이슈 제출에도 Step4~7 적용. 내부 QA와 별개의 독립 관점 게이트.
---
```

## 입력 (플레이스홀더)
- `{산출물}`: 리뷰 대상 — 설계서/코드 디렉토리/문서/**RED 테스트(계약·스키마·마이그레이션·보안·다도메인 인터페이스 테스트 한정)**. 내부 단위·mock·UI 테스트는 외부 교차리뷰 대신 에이전트 self-reflection+정적검사(테스트명/fixture/schema lint·boundary 체크리스트)로 1차 검증 — 구현 전 RED는 외부 리뷰어가 판단할 정보가 적어 탐지율이 낮다.
- `{단계ID}`: 임의 단계 식별자 (예: `design-auth`, `feat-login`)
- `{커밋id}`: 해당 시 `git rev-parse HEAD`, 아니면 생략
- `{게이트명령}`: 프로젝트 테스트/린트 게이트 (예: `npm test && tsc --noEmit` / 없으면 생략)

## 루프 제어 (수렴·종료 — 무한 루프/미검증 방지)
이 게이트는 **라운드 반복 루프**다. 단일 패스가 아니다.

```
# 축소 종결 판정 — **규칙은 한 곳에만 둔다(req).** else 블록 안에만 두면 `신규_확인 > 0` 경로가
# 이 규칙을 통째로 우회한다(중대 축소인데 다른 리뷰어가 결함을 1건이라도 찾으면 상한 종료가
# 'max-rounds 보고 후 통과'로 뚫린다).
# **루프 제어는 하지 않고 (라벨, 후속동작)만 돌려준다** — 함수 안의 break 는 호출자의 while 을
# 벗어나지 못하거나 문법 오류라, 그렇게 적으면 구현자가 "그냥 실행하고 다음 줄로" 번역해
# 차단하려던 우회가 그대로 재발한다. break/halt 는 **호출부에서** 한다.
축소종결판정(등급) -> (label, action):
    등급 in {경량, 표준}  -> (degraded-accepted, PROCEED)   # 사유 기록 후 다음 단계 진행 허용
    사용자 override 승인  -> (degraded-override, PROCEED)
    그 외(중대·미승인)    -> (degraded-blocked,  BLOCK)     # 다음 단계 **진행 금지**
                          # 재시도 루프가 아니라 사용자 승인/리뷰어 복구를 기다리는 정지 상태.

round = 1; dry_streak = 0; action = PROCEED   # action 초기화 — 축소 없이 끝나는 경로도 아래 소비를 탄다
while True:
  Step 1~4 (round==1: {산출물} 전체 / round>1: 직전 수정분 diff만 좁게 재리뷰)
  신규_확인 = 이번 라운드 '확인/부분' 중 verdicts 원장에 없던 것
  if 신규_확인 > 0: dry_streak = 0; Step 5~7 (신규_확인만 수정·게이트·기록)
  elif status.degraded == "": dry_streak += 1                    # 온전한 리뷰의 0건 = 수렴 근거
  else:                                                          # 축소 라운드의 0건 = 관측 부족
      # 수렴도 수정도 아님(dry_streak 불변). 그대로 두면 같은 축소 리뷰를 MAX_ROUNDS 까지
      # 반복한 뒤 'max-rounds 미수렴'으로 오표기되므로 여기서 등급별로 분기한다.
      # 복구 시도가 **맨 앞**이다 — 등급을 먼저 보면 경량/표준은 복구 가능한데도 시도 없이
      # 축소 통과해버린다(쉽게 온전한 교차검증으로 돌아갈 수 있는데 검증을 조기 포기).
      if 리뷰어 복구 성공 and round < MAX_ROUNDS:  # 재실행 — 상한을 우회하지 않는다
          round += 1; continue          # (bare continue 금지: 아래 round += 1·MAX_ROUNDS 검사를
                                        #  건너뛰어 무한 루프). 복구 리뷰어는 아래 "복구된
                                        #  리뷰어는 예외" 규칙 적용.
      # 복구 불가·또는 이미 마지막 라운드 → 반드시 라벨을 남기고 끝낸다
      label, action = 축소종결판정(리스크); 기록(label); break   # action==BLOCK 이면 다음 단계 진행 금지
  if dry_streak >= K(기본 1, 중대 2): break        # loop-until-dry (degraded 라운드는 K에 기여 못함)
  if round >= MAX_ROUNDS(기본 3):
      # 축소 우선(req) — 여기서 degraded 를 안 보면, 축소 상태인데 다른 리뷰어가 결함을 1건이라도
      # 찾아 위 `신규_확인 > 0` 분기를 탄 경우 degraded-blocked 를 건너뛰고 'max-rounds 보고 후
      # 통과'로 빠져나간다(중대 진행 금지가 뚫림).
      if status.degraded != "":
          label, action = 축소종결판정(리스크); 기록(label); break   # BLOCK 이면 진행 금지
      break + 잔여 미수렴 보고 (label=max-rounds)
  round += 1

# 루프 종료 후 — 어떤 경로로 나왔든 순서대로 수행한다.
Step 8(측정 꼬리) 수행          # **모든 종료 경로 공통 필수(req)** — 조건문 안에 넣지 말 것.
                                # 조건 종속시키면 정상 수렴 경로에서 통째로 생략된다(측정 공백).

# **action 을 반드시 소비한다(req).** 여기가 없으면 BLOCK 의 효과가 주석에만 남아,
# 구현자가 break 후 그대로 다음 단계로 진행한다(R7~R9 에서 두 번 재발한 계열).
if action == BLOCK:
    **후속 단계 진입 금지.** 재개 방법(req): 승인 또는 리뷰어 복구 후 **이 게이트를 다시 호출**해
    새 판정(`degraded-override` 등)을 받고 나서 후속 절차로 간다. 산출물은 그대로 두고
    게이트만 재실행한다 — 단계 전체 재시작(산출물 재생성)도, 게이트 건너뛰고 커밋으로
    직행하는 것도 아니다(후자면 원장에 `degraded-blocked` 가 영구히 남아 실제와 어긋난다).
    - **승인 전달 규약(req):** 게이트는 별도 호출이라 오케스트레이터가 받은 승인을 **모른다.**
      전달 수단이 없으면 재호출해도 같은 축소만 감지해 다시 BLOCKED → 승인 요구 → 재호출의
      **교착**에 빠진다. 승인은 **파일로 남긴다** — `_workspace/reviews/{단계ID}_override.json`
      (`{"approved_by":"user","reason":"…","at":<epoch>}`). 루프 진입 시 이 파일이 있으면
      `사용자 override 승인` 조건이 참이 된다. 승인은 **그 단계·그 사유 한정**이므로 다음 단계로
      들고 가지 않는다(파일명이 단계ID로 묶인 이유).
    - **라운드 이어받기(req):** 재호출은 **새 루프가 아니다.** `verdicts.json` 의 `rounds` 를
      읽어 이어서 센다 — 별도 인보케이션이라 메모리 카운터는 유실되므로 원장이 단일 출처다.
      이어받지 않으면 MAX_ROUNDS 가 매 재호출마다 초기화돼 상한이 무력화된다.
    return BLOCKED   # 호출한 오케스트레이터가 다음 단계를 시작하지 않도록 신호를 올린다
```
- **K회 연속 신규 확인 0건**이면 수렴 종료. **MAX_ROUNDS 도달 시 강제 종료 + 미수렴 이슈 보고**(무한 루프 차단). **축소 상태로 상한에 닿으면 `max-rounds` 가 아니라 등급 분기의 `degraded-*` 라벨이 우선**한다 — 중대 + 미승인이면 `degraded-blocked`(진행 금지)가 `max-rounds`(보고 후 통과)를 이긴다. 어느 경로로 끝나든 **라벨 없는 종료는 금지**. **품질 θ 미달이 명백하면 `failed-quality-gate`로 즉시 중단**(MAX_ROUNDS 헛돌지 않게). 종료 사유는 `converged-good`/`exhausted`/`max-rounds`/`failed-quality-gate`/`degraded-accepted`(경량·표준 축소 허용)/`degraded-override`(중대 축소 + 사용자 승인)/`degraded-blocked`(중대 축소 + 미승인 → 진행 금지) 라벨로 기록. (gate/assertion은 코드 단계 전용 — 설계·문서는 `verdicts.json` 완료+정본 대조로 종료. 상세: `loop-self-eval.md`)
- **수정본 재리뷰(req)**: round>1은 이전 라운드 수정 diff만 좁게 재리뷰 → 수정이 새 결함을 만들지 검증(같은 맹점 회피 전제가 수정에도 적용).
  - **복구된 리뷰어는 예외(req)**: 축소 라운드 뒤 새로 붙은 리뷰어는 **원 산출물을 한 번도 본 적이 없다**. 그 상태로 "직전 수정분 diff만" 주면 그 리뷰어의 관점으로는 산출물 전체가 영원히 미검토로 남는다(축소가 만든 맹점이 복구 후에도 존속). 복구 리뷰어에게는 **`round==1` 과 동일하게 산출물 전체를 준다** — 이미 검토한 리뷰어만 좁은 diff 재리뷰. 판별은 **이슈의 `source` 로 하지 않는다**(그 필드는 `re-review` 표식 용도이고, 0건 보고한 리뷰어는 이슈 자체가 없어 이력이 안 남는다). `verdicts.json` 에 **라운드별 커버리지 원장**을 따로 둔다: `"reviewer_coverage": [{"reviewer":"codex","round":1,"scope":"full","status":"ok"}, …]`. **판별이 불확실하면 "본 적 없음"으로 간주해 전체를 준다(보수적 기본값)** — 잘못 좁히면 맹점이 남고, 잘못 넓히면 토큰만 더 쓴다.
- **판정 원장(req)**: `_workspace/reviews/{단계ID}_verdicts.json` — 이슈지문(파일+결함요지 해시)→ 판정·라운드·근거. 매 라운드 **seen 대조로 신규만 판정**(기각 이슈 재부상 방지, dedup vs seen).

## Step 1 — 리뷰 요청 프롬프트
2종 분담: **일반/정합성 리뷰어**(러너가 claude면 `codex`, codex면 `claude`) + **성능·안정성 리뷰어 = agy(antigravity, Gemini 모델)**. (gemini CLI는 deprecated → agy로 이관. agy 없으면 gemini legacy 폴백.) 일반 리뷰어는 `check-review-tools.sh`의 `REVIEWERS:`에서 러너 제외분으로 자동 결정. 산출물 유형에 맞게 "소스코드"→"설계서/문서" 치환.
```text
리뷰 대상 : {산출물}
관련 commit id : {커밋id}   # 없으면 생략
위 산출물과 관련 자료를 리뷰·검토하여 발생 가능한 이슈를 모두 찾아 보고해줘.
<이슈 작성 방법>
1. [{이슈레벨}] {타이틀}
- 현황: {상황}  - 이슈: {상세}  - 권고: {대응방안}
</이슈 작성 방법>
```
agy(성능 리뷰어)는 동일 틀 + "성능/속도·안정성 중심으로" 추가.

## Step 2 — 백그라운드 launch → 완료 대기 → poll (가시성 모델)
**왜 이 구조인가(req):** 리뷰어 블록을 동기 Bash 1콜로 돌리면 `wait`가 끝날 때까지(최대 600s) tool result가 안 나와 **사용자에겐 "끊긴 것처럼" 보인다** — 블록 안의 진행 `echo`는 종료 시점에 한꺼번에 버퍼로 도착할 뿐 라이브로 안 보인다(이 하네스에서 사용자 가시성은 *오케스트레이터 assistant 텍스트*로만 전달됨). 더구나 블록 안에 `(while …; sleep 30) &` heartbeat를 넣고 bare `wait`하면 **그 무한 루프 때문에 `wait`가 영원히 안 풀려 데드락**난다. 따라서 가시성은 *오케스트레이션 계층*에서 해결한다:

1. **launch** — 아래 블록을 **`Bash(run_in_background: true)`로 실행**하고 즉시 반환. 오케스트레이터는 곧바로 **"외부 리뷰 시작: {리뷰어들} (최대 ~10분)"을 텍스트로 보고**(시작 가시성).
2. **await** — 하네스의 **완료 알림(task-notification)으로 재진입**한다. 30초 폴링 루프 금지 — 600s/30s=20턴 컨텍스트 팽창·비용 낭비. **단, launch 직후 반드시 단일 장주기 fallback 감시를 건다(req).** `timeout`/`gtimeout` 부재 + 리뷰어 hang이면 `wait`가 안 풀려 **완료 알림이 영영 안 와 오케스트레이터가 무한 대기(좀비)**한다 — fallback이 그 유일한 탈출구다.
   - **수단은 런타임 비의존이어야 한다(req).** 특정 런타임 전용 도구(`ScheduleWakeup` 등 `/loop` dynamic mode 전용)를 지정하면 **일반 스킬 실행 맥락에서 적용 불가라 "유일한 탈출구"가 실제로는 부재**하게 된다. 기본은 **백그라운드 감시 프로세스** — 어디서나 돈다. 런타임이 지연 재진입 수단(`schedule` 등)을 제공하고 그 맥락에서 유효하면 그걸 써도 된다.
     ```bash
     # launch 직후, 별도 백그라운드 호출로. {단계ID}·D 는 launch 와 동일.
     for i in $(seq 1 78); do            # 78 × 10s ≈ 13분
       # jq 비의존(req) — scorecard 는 jq 부재를 graceful degradation 으로 다루는데
       # fallback 만 jq 필수면 새 drift다. POSIX sed 로 status 만 뽑는다.
       st=$(sed -n 's/.*"status"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$D/${S}_review_status.json" 2>/dev/null | head -1)
       [ -n "$st" ] && [ "$st" != "running" ] && { echo "FALLBACK: 종료 status=$st"; exit 0; }
       sleep 10
     done
     echo "FALLBACK STALE: 13분 초과, 여전히 running"
     ```
   - fallback 발화 시 `_review_status.json`이 아직 `running`이고 `started` 이후 deadline 초과면 **stale로 간주**, rc/출력 유무로 `partial|failed` 확정하고 hang 프로세스는 사용자에게 보고 후 중단/계속 판정.
3. **poll** — 재진입 후 `_review_status.json` + 리뷰어별 `_{tool}.rc`를 읽어 `completed|partial|failed`를 도출, **결과를 텍스트로 보고**한 뒤 Step 3으로.

먼저 `bash "{스킬scripts}/check-review-tools.sh" "{러너}"`로 **러너 제외 리뷰어 재확인**(끝줄 `REVIEWERS:`·`SHADOWED:`). 두 플레이스홀더는 **스킬 생성 시 런타임별로 치환**한다(아래 "생성 시 치환"). `REVIEWERS:`에 든 도구만 실행. 프롬프트·출력 모두 `_workspace/reviews/`에 보존(감사 — /tmp 금지).

> **생성 시 치환(req):** 팩토리는 생성 런타임을 알므로 명시 주입한다 — Claude Code면 `{스킬scripts}`=`.claude/skills/external-review-loop/scripts`·`{러너}`=`claude`, Codex면 `{스킬scripts}`=`.agents/skills/external-review-loop/scripts`·`{러너}`=`codex`. (자동감지는 보조 폴백.)

> **REVIEWERS는 루프 진입 전 1회만 산출**해 재사용한다(라운드마다 재호출 불필요 — 리뷰어 집합은 라운드 간 불변).

> **launcher 는 스크립트 파일이다(req — 인라인 실행 금지).** `{스킬scripts}/run-review.sh` 를 호출한다. 인라인 bash 블록으로 두면 **실행 셸이 사용자 환경에 좌우된다** — macOS 기본 셸은 zsh 이고, zsh 는 비인용 파라미터 확장을 단어분리하지 않아 `${TOFLAG}` 류 관용구가 한 단어로 붙어 **리뷰어 전원 `rc=127`**(게이트가 아예 안 돎)이 된다. 셰뱅(`#!/usr/bin/env bash`)으로 셸을 고정하면 이 부류가 구조적으로 사라진다. 실측 재현: `zsh -c 'TO=/usr/bin/env; TOFLAG="$TO echo"; ${TOFLAG} X'` → `no such file or directory`.

```bash
# Step 1 에서 프롬프트 2종을 _workspace/reviews/ 에 먼저 써 둔 뒤:
#   {단계ID}_prompt_general.md (일반/정합성 리뷰어)  ·  {단계ID}_prompt_perf.md (성능 리뷰어)
# 이 한 줄을 Bash(run_in_background: true) 로 실행한다. {러너}=생성 시 claude|codex 치환.
bash "{스킬scripts}/run-review.sh" "{단계ID}" "{러너}"   # 경로에 공백이 있어도 안전하도록 인용
```

스크립트가 하는 일(요약 — 상세는 스크립트 주석이 단일 출처):

| 단계 | 내용 |
|------|------|
| 리뷰어 산출 | `check-review-tools.sh {러너}` 1회 호출 → `REVIEWERS:`·`SHADOWED:` |
| 축소 감지 | 리뷰어 1종 이하 / 일반축 부재 / PATH 밖 설치 → `degraded` 사유 기록 + stderr 경고 |
| 타임아웃 | `timeout`/`gtimeout` 탐지 후 **함수 래퍼**로 적용(비인용 확장 금지 — 셸 간 단어분리 차이) |
| 프롬프트 전달 | codex·claude = **stdin** / agy·gemini = **argv** (CLI 별 실측 규약 — 통일 금지) |
| 산출물 | 리뷰어별 `_{tool}.md` + `_{tool}.rc` (lock-free — 단일 JSON 동시 write 는 macOS 에 `flock` 이 없어 깨진다) |
| 취합 | rc 순차 취합 → `completed｜partial｜failed`, **런타임 실패도 `degraded` 에 합류** |
| 상태쓰기 | temp + `mv` 원자적 교체(poll 이 중간 상태를 읽지 않게) |

> **왜 rc/출력 파일을 리뷰어별로 나누는가:** 단일 status JSON에 여러 리뷰어가 동시 write하면 macOS엔 `flock`이 없어 **JSON 경합으로 깨진다**. 종료 시 스크립트가 rc들을 **순차 취합**(동시쓰기 없음)해 상태를 도출한다.
- **상태 스키마(통일):** `{"status": running|completed|partial|failed|no-reviewers, "reviewers": "...", "degraded": "" | "<축소 사유>", "results": {"codex":"ok|fail", "agy":"ok|fail"}}`. `partial`=일부 성공(예: codex ok·agy 타임아웃) — `completed`로 뭉뚱그려 부분실패를 숨기지 않는다. Step 3은 이 status + 리뷰어별 출력 *내용*으로 판단.
- **리스크 등급별 축소 정책(req):** 축소를 일률적으로 "기록만 하고 진행"으로 두면 **중대 변경에서 fail-open**이 된다(중대는 SKILL.md가 단계마다 외부리뷰+승인 사다리를 요구하는데, 리뷰어 1종 상태가 그 요구를 만족하지 못한 채 통과). 등급별로 분기한다 — **경량/표준**: `degraded` 기록 후 진행 가능. **중대**: 그대로 진행 금지. ① 리뷰어 복구(PATH/설치) 후 재실행, ② 복구 불가면 **사용자에게 축소 사유를 보고하고 명시적 승인(override)을 받아야** 다음 단계로 간다. 승인받았으면 그 사실도 `degraded`와 함께 결과서에 남긴다.
- **축소 리뷰 표기 의무(req):** `degraded`가 비어있지 않으면 그 라운드는 **교차검증이 성립하지 않은 리뷰**다. `degraded`에는 실행 전 사유(리뷰어 부재·PATH 밖 설치)뿐 아니라 **실행 중 실패**(타임아웃·인증·크래시 → `status: partial`)도 취합 단계에서 합류한다 — 붙었다가 죽은 것과 처음부터 없던 것은 결과가 같다. 결과서·커밋메시지·CHANGELOG에 **"양 엔진 수렴"·"codex+agy"류 표기를 쓰지 말 것** — 실제 실행된 리뷰어와 축소 사유를 그대로 적는다(예: "외부리뷰 agy 단독 — codex PATH 밖 설치로 제외"). `degraded`가 `PATH 밖 설치`를 포함하면 리뷰 재실행 전에 그 도구를 PATH에 올리거나 현재 런타임에 설치한다(자동 PATH 주입은 하지 않는다 — 임의 경로 실행은 공급망 리스크). **`no-high 2연속` 같은 수렴 판정은 degraded 라운드를 카운트에 넣지 않는다.**
- **상황별 모델 선택(req):** 오케스트레이터가 단계 리스크등급(경량/표준/중대)에 맞춰 `AGY_MODEL`·`CODEX_MODEL`을 설정한다. **경량/표준** → 경량·저비용(`AGY_MODEL="Gemini 3.5 Flash (High)"`, codex 기본) — 초대형 산출물·단순 검토·비용 절감. **중대** → 고성능(`AGY_MODEL="Gemini 3.1 Pro (High)"`, `CODEX_MODEL`=고추론 모델) — 정확도 우선. 미설정 시 기본(Gemini 3.1 Pro High / codex 기본). 가용 모델은 `agy models`·`codex --help`로 확인.
  - ⚠️ **엔진 다양성 가드:** `AGY_MODEL`은 **Gemini 계열만**. agy는 Claude/GPT-OSS 모델도 실행 가능하나, agy를 Claude로 돌리면 claude 러너와 같은 엔진 = 자기검증(엔진 다양성 붕괴). 모델은 *엔진 내* 선택일 뿐 — 엔진(codex≠claude≠agy_gemini)은 러너 제외 규칙(§독립성)이 고정.
- **agy 파일접근 배선(req — 지우지 말 것):** agy는 `--sandbox`라 리뷰 대상이 워크스페이스 밖이면 파일 read가 권한 프롬프트를 띄운다. `-p`(비대화)+`< /dev/null`(TTY 없음)이면 그 프롬프트에 응답 못 해 **무한 hang**(→ speculative fallback 또는 timeout kill, exit 124/144). 따라서 **`--add-dir "$REPO_ROOT"`(리뷰 대상 repo를 워크스페이스에 추가; `git rev-parse --show-toplevel`로 하위 디렉토리 실행서도 루트 보장) + `--dangerously-skip-permissions`(도구권한 자동승인)** 가 필수. 실증: 이 둘 없으면 repo 상대경로 파일(예 `_workspace/…`) 접근이 hang, 있으면 실제 file:line 근거로 정상 판정+종료(exit 0). codex는 `codex exec`가 자체 read-only 파일접근이라 무영향(대조군).
  - ⚠️ **보안 잔여위험(agy read-only 플래그 부재):** agy엔 도구제한/read-only 플래그가 없어 `--dangerously-skip-permissions`가 write/명령까지 자동승인한다(`--sandbox`는 터미널 제한만, 워크스페이스 write는 안 막음). 가드 = ① `--sandbox` ② 프롬프트가 "리뷰만"으로 스코프 ③ **외부 리뷰는 clean checkout/worktree에서 실행 권장**(오동작 write의 blast radius 최소화). agy에 `--allowed-tools` 류 생기면 read-only로 좁힐 것.
  - `--print-timeout 300s`(180s는 대형 리뷰+고추론 모델에 부족, 외곽 gtimeout 600s 안).
- **타임아웃 무방비 주의:** `timeout`/`gtimeout` 없으면 `run-review.sh` 의 `run_with_timeout` 이 그대로 실행(무타임아웃)이라 `codex`·`claude`는 상한이 없다(agy만 자체 `--print-timeout` 300s). hang 시 `wait` 무한 블로킹 → **GNU coreutils(`gtimeout`) 설치 권장**. 자체 `sleep…&kill` 워치독은 오탐 kill 위험이라 미채택 — 대신 launch 모드라 오케스트레이터가 과대 경과 시 중단/계속을 판정할 수 있다.
- 타임아웃·실패(`_{tool}.rc`≠0 또는 출력 빔) 시 **오케스트레이터가 1회 수동 재실행** → 재실패 시 도구 누락 명시 후 단일 출처로 진행(**루프 차단 금지**). Step 3은 파일 유무가 아니라 rc+내용으로 판단.
- 모델은 `agy models`로 확인(Gemini 3.1 Pro / 3.5 Flash 등). 가용 모델명으로 치환.
- **자원·비용:** 리뷰어 2종 병렬 = 토큰 2배·로컬 자원 경합. 초대형 산출물이면 순차 실행 또는 성능 리뷰어를 경량 모델(`Gemini 3.5 Flash`)로.
- **도구 부재 폴백:** `REVIEWERS: none`이면 통일 스키마 상태파일만 남기고 외부 리뷰 생략 — 결과서 명시·내부 QA만. 일반 리뷰어 1종만 살아도 단일 출처로 진행하되 **`degraded`에 사유가 실리므로 위 "축소 리뷰 표기 의무"를 따른다**(진행은 하되 교차검증으로 기록 금지).
- **`SHADOWED` 확인(req):** `check-review-tools.sh`는 도구가 *설치돼 있으나 현재 PATH 밖*이면 `SHADOWED:` 줄로 보고한다(예: nvm의 다른 node 버전 전역 설치). `command -v` 실패를 "미설치"로만 처리하면 리뷰어가 조용히 한 축 빠진 채 루프가 정상 완료된다 — 실측된 회귀다. 오케스트레이터는 `SHADOWED`가 `none`이 아니면 사용자에게 보고하고 복구(PATH 추가/재설치)를 먼저 제안한다.

## Step 3 — 이슈 통합 + 원장 대조
**먼저 산출물 유무 확인:** `_review_status.json`(no-reviewers)만 있고 `_codex.md`/`_claude.md`/`_agy.md`가 없으면 외부 리뷰 생략 상태 → 내부 QA로 진행(결과서 명시). 출력 파일은 있으나 비었거나 에러면 해당 도구 누락으로 간주. 두 출력에서 이슈 추출 → 중복 병합(동일 대상·동일 결함=1건, 출처 병기) → 번호 재부여. **`verdicts.json` 원장과 대조해 이미 판정된(기각/이월/기수정) 이슈는 제외하고 신규만 Step 4로** (dedup vs seen). 리뷰 보고 0건이면 "외부 리뷰 — 이슈 0건" 기록, dry_streak +1. **단 `_review_status.json`의 `degraded`가 비어있지 않으면 dry_streak을 올리지도 내리지도 않는다(req)** — 축소된 리뷰의 "0건"은 수렴 근거가 아니라 관측 부족이다. 그 다음 처리(복구 후 재실행할지, 기록만 하고 진행할지)는 **§Step 2 "리스크 등급별 축소 정책"이 단일 출처**다 — 경량/표준은 기록 후 진행, 중대는 복구 또는 사용자 명시 승인. 여기서 따로 정하지 않는다.

## Step 4 — 전건 판정 (근거수집 위임 가능 · 최종 확정 비위임)
신규 이슈마다 실코드/실문서 대조(grep/Read) 후 판정. **이슈 10+건이면 이슈별/배치로 판정 보조 에이전트에 위임** — 보조는 실코드 대조 근거 + 판정 *초안(draft)*만 반환(쓰기 금지). 오케스트레이터는 초안을 받아 **최종 확정(confirm)**만 직접 수행(권위 비위임). 판정 결과는 `verdicts.json`에 기록(이슈지문·판정·라운드·근거).

| 판정 | `verdicts.json` 의 `verdict` 값 | 기준 | 처리 |
|------|------------------------------|------|------|
| **확인** | `confirmed` | 결함 재현/실재 | Step 5 수정 |
| **부분 확인** | `partial` | 지적 실재하나 권고 과잉/계약 위배 | 비파괴 범위만 + 잔여 기각 근거 |
| **이월** | `deferred` | 타당하나 본 단계 범위 외 | 백로그 위치 명기 — 기각과 구분 |
| **기각** | `rejected` | 사유표 | 근거 명시(코드/정본 인용) — 삭제 금지 |
| (중복 병합) | `duplicate` | Step 3 에서 병합된 건 | 기록만 |

**원장에는 반드시 영문 enum 값을 쓴다(req).** `build-scorecard.sh` 는 이 enum 으로만 집계한다 — 한글을 그대로 적으면 예전엔 **집계 전부 0 + 경고 없음**이었다(측정 꼬리를 돌렸는데 "측정했다"는 거짓 신호만 남는, 스킵보다 나쁜 상태). 지금은 스크립트가 한글 동의어를 정규화하고 enum 밖 값이 남으면 `warnings` 에 발견된 값을 찍지만, **원장은 처음부터 enum 으로 적는 것이 정본**이다.

**최소 스키마** — 이대로 쓰면 Step 8 이 그냥 돈다:
```json
{ "loop":"external-review", "stage_id":"{단계ID}", "rounds":1,
  "risk_level":"중대", "diff_lines":120, "termination_reason":"converged",
  "issues":[ {"fingerprint":"파일+결함요지", "verdict":"confirmed", "round":1, "source":"codex"} ],
  "reviewer_coverage":[ {"reviewer":"codex","round":1,"scope":"full","status":"ok"} ] }
```
`source` 는 **무엇을 봐서 찾았나**다(누가 찾았나가 아니다) — 좁은 수정 diff 재리뷰의 회귀/누출은 `"re-review"`, 복구 리뷰어의 전체 리뷰 발견은 엔진명. 상세는 §Step 8.

**기각 사유표:** 동결 계약 위배 · 설계 정본 명시 결정 · 기구현 오판(호출 형태만 보고 오판) · YAGNI/과설계 · 리뷰어 자인 비병목 · 기존 설계와 상충(멱등·격리 등).

## Step 5 — 확인분 TDD 수정 (확인 0건이면 생략)
**'확인/부분 확인'이 0건이면 Step 5~7을 생략**하고 판정 기록만 남긴 뒤 루프 제어로 복귀(전부 기각/이월인데 수정·게이트 도는 낭비 방지). 이때 dry_streak 은 **`_review_status.json`의 `degraded`가 빈 경우에만 +1**, 축소 라운드면 **불변**(올리지도 내리지도 않는다 — §루프 제어 의사코드와 동일 규칙, 축소의 0건은 관측 부족이지 수렴이 아니다). 축소 라운드의 다음 처리는 §Step 2 "리스크 등급별 축소 정책"을 따른다(경량/표준=기록 후 진행, 중대=복구 또는 사용자 승인). 확인분이 있으면: `tdd-doctrine.md` 규율(Red→Green→Refactor, 구조/행위 분리). 다중 에이전트 병렬 시 파일권 명시 분리(병렬 충돌 = 1차 실패 주원인). 에이전트는 커밋·브랜치 금지, status는 `_workspace/status/`.

## Step 6 — 통합 게이트
`{게이트명령}` 실행 → PASS. 게이트 없으면(설계서) 정본 정합성 재확인으로 대체. 테스트 리소스 간섭 게이트는 동시 실행 금지.

## Step 7 — 기록·커밋 (커밋 순서·자율 노브)
1. 결과서에 `## 외부 리뷰 반영 ({일자} — {단계ID} {k}건)` § — 판정표·게이트 수치·출처(리뷰어: codex|claude + agy, 러너 제외분).
2. 순서: 게이트 PASS → **승인 관문** → 단일 커밋(`fix: 외부 리뷰 {k}건 — {요지}`, Co-Authored-By).
   - 승인 관문 기본: 사용자 대기. `_workspace/.autonomous` 마커(또는 "자율로" 발화) 시 자동 통과.
   - **push는 자율이어도 기본 대기** — `_workspace/.autonomous-push` 마커 시만 자동.
   - 권한모드(bypassPermissions)는 스킬이 못 읽으므로 마커/발화로 명시. 마커 ON이어도 리뷰·판정·게이트는 그대로(인간 승인 한 스텝만 생략).

## Step 8 — 자체 평가 (1단계: 측정 로깅만, 계산 도출)
루프 종료 시 **측정 꼬리 필수(건너뛰기 금지)** — verdicts 원장 남기고 scorecard 발행:
- **간편(권장):** **`bash {스킬scripts}/emit-loop-scorecard.sh _workspace/reviews/{단계ID}_verdicts.json [run_id]`** — 경로 조립·`build-scorecard.sh` 호출·summary append 를 한 명령으로. **raw codex/agy 로 감사해도 이 한 줄만 돌리면 #/eval 루프 통계가 채워진다**(측정 꼬리 스킵이 "루프 0"의 근본원인 — 자동감사 우회 시 반드시 실행).
- **수동(동등):** `bash {스킬scripts}/build-scorecard.sh _workspace/reviews/{단계ID}_verdicts.json _workspace/evals/external-review/{단계ID}/{run_id}/scorecard.json [timing.json]` — verdicts 는 **전체 경로 전달**(파일명만 주면 CWD 불일치 Not Found).
- 산출: verdict_counts·rounds·`alignment_score`(정밀도 아님)·`*_rate`·cost·**`regression_catch_rate`**(round>1 재리뷰가 잡은 회귀/누출 — 전체 recall 아님)를 **스크립트가 verdicts.json에서 기계 계산**(LLM 자기보고 아님). 라벨(`converged-good`/…)만 오케스트레이터 해석. **측정·기록만**, 자동 흐름 변경 없음. (`{스킬scripts}`는 Step 2와 동일·런타임별 치환.)
- `verdicts.json` 각 이슈에 `round`·`source` 기록. `source` 는 **무엇을 봐서 찾았나**를 뜻한다(누가 찾았나가 아니다) — `regression_catch_rate` 의 의미를 지키는 것이 이 필드의 목적이다.
  - **좁은 수정 diff 재리뷰에서 잡은 회귀/누출 → `source:"re-review"`(req).** 여기에 엔진명(`"codex"`·`"agy"`)을 넣으면 `build-scorecard.sh` 가 분자로 세지 않는데 **화이트리스트에 있어 경고도 안 뜬 채 과소측정**된다(실측: 재태깅 전 0 → 후 1.75).
  - **복구된 리뷰어가 전체 리뷰로 뒤늦게 찾은 기존 결함 → 엔진명(`"codex"` 등).** 이건 수정이 만든 회귀가 아니라 원래 있던 결함이므로 `"re-review"` 로 적으면 회귀율이 부풀려진다.
  - 발견 엔진을 항상 남기고 싶으면 **별도 `reviewer` 필드**를 쓴다(스크립트가 무시하는 추가 키).
  - **검토 이력(커버리지) 판별은 `source` 에 의존하지 않는다** — `reviewer_coverage` 배열이 단일 출처다(§수정본 재리뷰).
- 스크립트가 `summary.jsonl`에 집계 append → Phase 0/7 진입 시 **요약만** 읽음(읽기 경로, Lean). 스키마·졸업 기준·단계적 도입은 `loop-self-eval.md`. (jq 필요)

## 재진입 (루프 라운드 = 재진입)
재진입은 위 **루프 제어**의 라운드 반복으로 일원화한다. round>1은 직전 수정분 diff만 좁게 재리뷰하고, `verdicts.json` seen 대조로 기수정·기각 이슈는 다시 판정하지 않는다("기수정 확인"은 원장+게이트 재실행으로 갈음). 사용자가 동일 목록을 수동 재제출해도 원장 대조 → 신규만 판정.

## 응용 — 의사결정 적대 검토 (Adversarial Decision Review)
이 판정엔진(라운드·loop-until-dry·확인/부분/이월/기각·비위임 심판)은 **산출물 리뷰뿐 아니라 의사결정에도 응용**된다. 리뷰 대상을 "코드/문서" 대신 **대립 입장**으로 두면: 논객이 입장별 주장 → 상대 주장을 다음 라운드 입력으로 주입 → 반박 → 심판(오케스트레이터) 판정(채택/절충/보류/기각). **별도 빌더 패턴이 아니다** — 이 루프의 입력만 바꾼 것(`agent-design-patterns.md` 복합표 "적대적 의사결정 검토"). 핵심 전제는 동일: **독립성=엔진 다양성** — 같은 엔진 논객은 같은 맹점이라 "가짜 토론"(편한 중간값 수렴)이 되므로, 진짜 대립은 다엔진(codex·agy)이라야 성립. 같은 엔진 논객은 *논점 생성 보조*로만. 라운드 전 심판이 **토론 적합성**을 먼저 본다(증거 한쪽 명백=조기종료, false balance 금지). 교착(max-rounds)은 기본 **보류+인간 승인**(자동 강제판정은 저리스크 결정만).

## 테스트 시나리오
- **정상(수렴)**: round1 — codex 8+agy 3→중복 1 병합→10건 판정(확인6/부분2/이월1/기각1)→수정·게이트 PASS·기록. round2 — 수정 diff 재리뷰, 신규 확인 0 → dry_streak 1=K → 종료.
- **수정이 새 결함(재리뷰 효과)**: round2에서 수정분 재리뷰가 신규 확인 1건 발견 → 수정 → round3 신규 0 → 종료.
- **미수렴**: round3(MAX)까지 신규 확인 지속 → 강제 종료 + 잔여 미수렴 이슈를 결과서·백로그에 보고.
- **도구 에러**: agy 타임아웃 ×2 → "agy 미수집" 명시, codex 단독 진행 — 라운드 완료.
