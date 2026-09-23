# 모델 프로파일 — 규범 문서

`model-profiles.json` 이 **정본**이다. 이 문서는 그 파일의 **필드 이름·규칙**만 설명한다.
**값은 적지 않는다** — 모델 이름·별칭·모델 ID·세대명은 이 문서에 한 글자도 쓰지 않는다. 값이 궁금하면 JSON 을 연다.

> 왜 나누는가: 모델은 몇 달마다 바뀌고 문서는 같이 안 바뀐다. 값을 두 곳에 적으면 둘째 곳은 반드시 썩는다.
> 정본을 JSON 하나로 두면 프로바이더 추가가 **파일 1개 편집**으로 끝난다.

## 1. 경로와 전파

- 정본: `skills/myharness/references/model-profiles.json`
- 이 문서: `skills/myharness/references/model-profiles.md`(설명 전용 · 파서가 읽지 않는다)
- **번들 대상은 `.json` 하나다**(설계서 §1-1) — 이 `.md` 는 **팩토리에서만 읽는 설명서**라 생성 하네스로 가지 않고 `MANAGED_RELS` 에도 없다.
  생성 하네스가 실제로 읽는 최상위 키는 `tools` · `runtime_provider` · `review_tiers` 셋뿐이고, 나머지는 팩토리 실행에서만 읽힌다.

## 2. 필드 이름 — 아래 블록이 문서 쪽 단일 출처다

계약 테스트가 이 블록을 파싱해 JSON 과 대조한다. **이름만** 담는다(값 대조 아님).

```json model-profiles-fields
{
  "local": ["base_url", "start_cmd"],
  "placement": ["boundary", "keywords", "priority"],
  "provider": ["confirmed_at", "drop", "effort_field", "effort_forbidden", "effort_vocab", "local", "params", "soft_switch", "source_url", "tiers"],
  "tier": ["effort", "family_alias"],
  "top_level": ["behavior", "placement", "providers", "review_tiers", "runtime_provider", "schema", "session_fallback", "stale_after_days", "tools"],
  "traits": ["judge", "design", "build", "orchestrate", "docs", "collect"]
}
```

`traits` 는 **우선순위 순서**다(앞이 이긴다 — 티어를 낮추지 않는 쪽이 앞). `placement.priority` 와 순서까지 같아야 한다.

## 3. 최상위 키

| 키 | 규칙 |
|---|---|
| `schema` | `model-profiles/1` 고정. 형식이 바뀌면 번호를 올린다 |
| `stale_after_days` | 정수 ≥1. 확인일이 이보다 오래되면 정책 감사가 **WARN**(차단하지 않는다) |
| `session_fallback` | 세션 대체 순서. **배열 순서에 의미가 있다** |
| `runtime_provider` | 러너 이름 → 프로바이더 ID. 값은 `providers` 에 실재해야 한다 |
| `tools` | 리뷰 도구 이름 → 프로바이더 ID. `check-review-tools.sh` 후보 **4종을 하나도 빠짐없이** 담는다(빠지면 감사 FAIL) |
| `providers` | 프로바이더 ID → 아래 §4 항목 |
| `review_tiers` | 등급(`light`/`standard`/`critical`) → 리뷰어별 모델 값. `runtime-default` 는 "env 를 설정하지 않는다"는 뜻이다 |
| `placement` | 성격 키워드·우선순위·경계 행 승강. **팩토리만 읽는다** |
| `behavior` | **빈 객체 고정**(뒤 릴리스용 자리). 비어 있지 않으면 `place` 가 rc=2 |

## 4. 프로바이더 항목

| 필드 | 규칙 |
|---|---|
| `effort_field` | 이 프로바이더가 노력 단계를 받는 필드 이름. 점 표기면 중첩 경로다 |
| `effort_vocab` | 그 필드가 받는 값의 목록. 비어 있을 수 없다 |
| `effort_forbidden` | 쓰면 안 되는 값. `tiers.*.effort` 가 여기 들어가면 감사 FAIL |
| `params` | 이 프로바이더에 붙일 기본 파라미터(기본 `{}`) |
| `drop` | 조립 마지막에 제거할 파라미터 이름. **`params` 에 실재하는 키만** 적는다(오타가 조용히 무효가 되지 않도록). `effort_field` 를 제거할 수 없다 |
| `soft_switch` | `null` 또는 `{off, on}` 두 키. 프롬프트로 사고를 켜고 끄는 프로바이더용 |
| `tiers` | `deep`/`standard`/`light` 세 등급 → `{effort, family_alias}`. `effort` 는 **그 프로바이더 어휘의 값**으로 적는다(등급 3단과 어휘 단계 수는 1:1 이 아니다). 특정 판을 고정하려면 `pinned_id` 를 더하고 **반드시** `pinned_confirmed_at`(ISO 날짜)을 같이 적는다 |
| `confirmed_at` | `YYYY-MM-DD`. 사람이 공식 문서를 눈으로 확인한 날 |
| `source_url` | 확인한 문서 주소. 빈 문자열 불가 |
| `local` | `{base_url, start_cmd}` — 이 릴리스는 **둘 다 `null`**(자체 호스팅 자리만 예약) |

## 5. 배치(`placement`)

- `keywords` — 성격 6종 → 부분일치 문자열 배열. 대조 전에 **소문자로 정규화**하므로 영어 항목은 소문자로 적는다.
- `priority` — 여러 성격이 걸리면 앞의 것이 이긴다.
- `boundary` — 경계에 놓인 두 행(`build_oneshot`·`ambiguous`)을 비용 답(`error-worse`/`balanced`/`delay-worse`)에 따라 어느 등급으로 보낼지.

## 6. 저장 규약 — 지키지 않으면 감사 FAIL

1. **모든 객체 키는 코드포인트 오름차순**으로 저장한다(진단 diff 가 튀지 않도록).
2. **배열은 정렬하지 않는다** — `session_fallback`·`priority`·`drop` 은 순서가 곧 의미다.
3. **비밀값·API 키·엔드포인트 토큰 금지.** 이 파일은 생성되는 모든 하네스로 전파된다.
4. 값을 고쳤으면 그 프로바이더의 `confirmed_at` 을 **같이** 고친다.
