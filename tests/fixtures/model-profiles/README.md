# `tests/fixtures/model-profiles/` — 모델 프로파일 픽스처

설계서 §9-1 각주와 `docs/v1.8.3/todo/S1-assemble.md` A절이 지정한 픽스처 자리다.
**정적 JSON 파일을 두지 않는다.** 픽스처는 실행 시각에 `tests/harness-intake/s4-helpers.mjs` 가 만든다:

1. 정본 `skills/myharness/references/model-profiles.json` 을 읽고(`readCanonProfiles`),
2. `mutate` 콜백으로 **필요한 부분만** 고친 뒤(`writeProfiles`),
3. 객체 키를 코드포인트 정렬해(`sortDeep` — 감사 #13 · T-D2 규약) 임시 트리에 쓴다.

## 왜 런타임 생성인가

정적 사본을 커밋하면 정본 스키마가 바뀔 때 픽스처가 **조용히 낡는다**(v1.7.6 이 겪은 계열).
정본을 읽어 변형하면 스키마 드리프트가 곧바로 단정 실패로 드러난다
(`s4-assemble.test.mjs` 의 「픽스처 규약」 테스트가 기준선 동일성을 기계로 확인한다).
명세 `_workspace/repo-maintainer/v183-S1/00_orchestrator_spec.md` §1·§4 의 "정본을 읽어 변형" 지시다.

## 임시 트리 레이아웃 (명세 §1)

```
<tmp>/scripts/harness-intake.mjs                        ← 정본을 fs.copyFileSync (수정 0)
<tmp>/references/model-profiles.json                    ← 픽스처 데이터 파일 (SELF 상대 ../references/)
<tmp>/root/.claude/skills/<orch>/harness-profile.json   ← --root 대상 (정본 `answer` 로 생성)
```

데이터 파일 경로를 바꾸는 **env 노브는 없다**(정본 결정 R1 HIGH-2 — env 를 정책 입력으로 두면 fail-closed 를 우회한다).
그래서 픽스처를 먹이는 유일한 길이 임시 트리다.

## S2·S3 재사용

`s4-helpers.mjs` 가 export 하는 것: `makeTree` · `setData` · `writeProfiles` · `acme`/`withAcme`(가짜 프로바이더)
· `canon`/`sortDeep`/`cmpCp`(정규 JSON) · `assemble`/`parse4`/`expectRc2`(실행·단정).
`place`(S2) · `egress`(S3) 테스트는 같은 트리 위에서 서브커맨드만 바꿔 쓴다.
