# E5-a 작업결과서 — 지적 AI 자동 반영 + git-diff 프리뷰 (구현)

> 설계: [eval-remediation-design.md](../design/eval-remediation-design.md)(감사 R1~R4 수렴). 등급: 중대(쓰기경계·에이전트 exec). 완료 2026-07-16.
> 하네스: harness-ui-dev 방식(오케스트레이터 직접·러너 제외 외부감사). 외부감사 codex+agy **R1~R5 → R4·R5 no-high 2연속 수렴.**

## 1. 요청·산출
- 사용자: 설계서를 **하네스로 구현** + 완료 후 **고위험 0 외부리뷰**.
- 산출: P0 선검증 → M-x1(서버)·M-x2(웹)·M-x3(적용=재사용) 구현 + 외부감사 5R 수렴.

## 2. P0 선검증 (절대 선행 게이트·GO)
실측(claude -p plan·`_workspace/p0-remediation`): ① EDITED_CONTENT 회수 3/3·타겟 영역 정확 ② read-only 파일미수정(적대적 write도 차단) ③ injection 무시(name 변경·PWNED 거부) ④ 러너 가용. → **GO.** (하드닝 argv 재실측도 정상.)

## 3. 구현
| 파일 | 내용 |
|------|------|
| `src/server/adapters/remediate.ts` | 초안 러너(하드닝 argv `--safe-mode --tools "" --disallowedTools "*"`·도구 완전차단)·action-타겟 인지 검증·EDITED_CONTENT 추출·conflict 규칙·비동기 잡·캡드 nofollow+dev/ino TOCTOU 리더 |
| `src/server/api/index.ts` | POST /api/eval/remediate(edit-gate 403·stale 409·conflict 409)·GET /:runId(fail-closed·검증·stale) |
| `src/server/adapters/runs.ts` | resolveRunDir export |
| `src/web/{api.ts,screens.tsx,styles.css}` | RemediateButton·DefinitionEditor 폴링(초안→edited 주입→diff)·kind/name 가드·딥링크 |
| `test/remediate.test.ts` | 38 tests |
- **적용(M-x3) = 기존 defedit PUT 재사용**(putDefinition·사람 diff 승인). 새 쓰기경계 없음·자동커밋 없음.

## 4. 외부감사 (codex+agy · R1~R5)
- **R1:** codex HIGH×2(러너 도구 미차단→exfil·캡드리더 부재 OOM/심링크)·MED×2(request 신뢰·웹 가드)·LOW. agy no-high.
- **R2(no-high):** 도구차단 argv(P0 재실측)·캡드 nofollow 리더·웹 kind/name 가드. codex MED-1(O_NOFOLLOW 폴백)·LOW×2.
- **R3:** agy HIGH — lstat→open TOCTOU(fstat.isSymbolicLink 무의미). dev/ino 대조 확정방어.
- **R4(no-high):** TOCTOU 해소 확인. errReason 일관성·bytesRead.
- **R5(no-high·수렴):** short-read loop. **R4·R5 no-high 2연속.**
- confirmed 10·partial 1·rejected 1(HTTP 200 폴링계약=의도)·alignment 0.875·regression_catch 1.0.

## 5. 측정 꼬리
- `_workspace/evals/external-review/remediation-impl_scorecard/{verdicts,scorecard}.json` → `summary.jsonl`. stage `eval-remediation-impl`·rounds 5.

## 6. 커밋
`812263c`(M-x1)·`c48ee4a`(M-x2/3)·`5b30595`(R1 HIGH)·`c0d9e01`(R2)·`d3dd421`(R3 TOCTOU)·`ab8ed14`(R4)·(short-read).

## 다음 단계 참조
- **미해결·운영:** 실행 서버에 신규 라우트 반영하려면 **harness-ui build+서버 재시작** 필요(사용자 404 원인=미재시작·코드 정상). `definitionEditEnabled=true`(Settings) + ANTHROPIC 인증(러너)·러너 부재 시 기능 저하.
- **핵심 결정:** AI=초안만(read-only·도구 완전차단)·사람 diff 승인=유일 적용·적용=기존 defedit PUT. 삭제/자동커밋/holdout 제외(E4). 캡드리더 dev/ino 대조로 TOCTOU 봉쇄.
- **push 대기**(`.autonomous-push` 미설정). 릴리스 별도 요청 시.
