// F15(M-e): Codex `.codex/agents/*.toml` 편집 = **limited-edit fail-soft**(design §5-2).
//   근거: Node 생태계에 "주석 보존 라운드트립 + AST 변형" TOML 라이브러리 부재(선검증 실측 — @iarna/toml 은
//   parse 시 주석 유실). 재직렬화하면 사용자 주석/포맷이 소멸 → design §5-1 주석 보존 위반.
//   ⇒ **재직렬화 안 함.** 제출 텍스트를 **verbatim**(개행 정규화만) 채택하되, 쓰기 전 STRICT 검증:
//     1) @iarna/toml strict parse — 중복키/재정의·잘못된 이스케이프·미종결 문자열 = throw = fail-closed(injection·R8-c).
//     2) name 불변(리네임 금지)·name/description 필수.
//     3) **semantic diff**(직전 디스크본 대비): 화이트리스트 top-level **scalar** 키만 변경/무변경 허용.
//        구조(table/array) 변경·비화이트 키 변경·키 추가/삭제 = fail-closed(특권 필드 preserve-only).
//   주석 보존은 verbatim 이라 **구성상 자명**(우리가 그 바이트를 건드리지 않음). 경로안전/원자쓰기는 defedit 재사용.
import TOML from "@iarna/toml";
import { MAX_DEF_BYTES } from "./defedit.js";

// 편집 허용 top-level scalar 키(화이트리스트). 그 외 필드(tools 배열·[table] 등 구조·미지 특권필드)는
//   preserve-only(v0.7 limited-edit — 주석 무손실 보장 범위). name 은 리네임 금지라 별도 불변 검증.
const EDITABLE_TOML_KEYS = new Set(["name", "description", "model", "instructions", "prompt"]);

export type TomlCanonResult =
  | { ok: true; canonical: string; normalized: Record<string, unknown> }
  | { ok: false; error: string };

type ParseResult = { ok: true; data: Record<string, unknown> } | { ok: false; error: string };

// @iarna strict parse. 중복키/재정의·이스케이프 탈출·미종결 = throw → injection/손상 매핑(fail-closed).
function parseStrict(text: string): ParseResult {
  let data: unknown;
  try { data = TOML.parse(text); }
  catch (e) {
    const msg = String((e as Error).message ?? "");
    if (/redefine|redefinition|duplicate|already/i.test(msg)) return { ok: false, error: "duplicate-key" };
    return { ok: false, error: "toml-parse" };
  }
  if (data === null || typeof data !== "object" || Array.isArray(data)) return { ok: false, error: "not-a-map" };
  return { ok: true, data: data as Record<string, unknown> };
}

// 안정 비교(키 순서 무관·중첩 구조 포함). @iarna 는 datetime 을 Date 로 반환.
//   R1(codex/agy MED·type-confusion): JSON.stringify 는 NaN/±Infinity 를 모두 "null" 로, -0/0 을 동일하게,
//   Date 를 문자열과 구분 없이 직렬화 → 잠긴 필드 변조 우회. **타입 태그**로 원시값을 주입식(injective) 인코딩:
//   문자열 s:·불리언 b:·숫자 n:(nan/inf/-inf/-0 구분)·Date dt:·bigint bi:·null null. 문자열 "@dt:.." 이 Date 와
//   충돌하던 문제도 태그 접두(s: vs dt:)로 해소.
function tag(x: unknown): unknown {
  if (x === null || x === undefined) return "null";
  if (x instanceof Date) return "dt:" + x.toISOString();
  if (Array.isArray(x)) return x.map(tag);
  if (typeof x === "object") {
    const o: Record<string, unknown> = { __obj: 1 };
    for (const k of Object.keys(x as Record<string, unknown>).sort()) o["k:" + k] = tag((x as Record<string, unknown>)[k]);
    return o;
  }
  if (typeof x === "string") return "s:" + x;
  if (typeof x === "boolean") return "b:" + (x ? "1" : "0");
  if (typeof x === "bigint") return "bi:" + x.toString();
  if (typeof x === "number") {
    if (Number.isNaN(x)) return "n:nan";
    if (x === Infinity) return "n:inf";
    if (x === -Infinity) return "n:-inf";
    if (Object.is(x, -0)) return "n:-0";
    return "n:" + String(x);
  }
  return "u:" + String(x);
}
function stableEq(a: unknown, b: unknown): boolean {
  return JSON.stringify(tag(a)) === JSON.stringify(tag(b));
}

// 직전(디스크)·신규(제출) 파싱본 비교 → 화이트리스트 top-level **문자열** 키만 변경/무변경 허용.
//   키 추가·삭제·비화이트 변경·비-문자열(type-confusion·구조) 변경 = 거부(사유 문자열 반환·null=OK).
//   R1(codex LOW): 화이트 필드도 scalar→다른타입(예: model="opus"→model=true) 을 막기 위해 **문자열 전용**.
//   Codex 에이전트의 name·description·model·instructions·prompt 는 모두 문자열이라 limited-edit 범위로 충분.
function semanticDiff(oldD: Record<string, unknown>, newD: Record<string, unknown>): string | null {
  const keys = new Set([...Object.keys(oldD), ...Object.keys(newD)]);
  for (const k of keys) {
    const a = oldD[k], b = newD[k];
    if (stableEq(a, b)) continue;                                   // 무변경(구조 포함 동일) — 허용
    if (!(k in oldD) || !(k in newD)) return `struct-change:${k}`;  // 추가/삭제 = preserve-only 위반
    if (!EDITABLE_TOML_KEYS.has(k)) return `field-locked:${k}`;     // 비화이트 필드 변경 거부
    if (typeof a !== "string" || typeof b !== "string") return `non-string:${k}`; // 문자열↔타입변경 거부(type-confusion)
  }
  return null;
}

// 개행 정규화(주석/구조는 보존 — 재직렬화 안 함). BOM 제거·CRLF/lone-CR → LF.
function normalizeNewlines(content: string): string {
  return content.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
}

// 공통 기저 검증: 크기·strict parse·name(불변)·description 필수. semantic diff 는 caller 별로 분리.
//   R3(codex LOW·API 표면 축소): null-overload 제거 — 편집/복원 함수가 각자 명시적 계약을 갖게 해 우회 실수 차단.
type BaseOk = { ok: true; text: string; data: Record<string, unknown> };
function validateTomlBase(content: string, expectedName: string): BaseOk | { ok: false; error: string } {
  if (Buffer.byteLength(content, "utf8") > MAX_DEF_BYTES) return { ok: false, error: "too-large" };
  const text = normalizeNewlines(content);
  const np = parseStrict(text);
  if (!np.ok) return np;
  const name = np.data.name;
  if (typeof name !== "string" || name.length === 0) return { ok: false, error: "field:name" };
  if (typeof np.data.description !== "string" || np.data.description.length === 0) return { ok: false, error: "field:description" };
  if (name !== expectedName) return { ok: false, error: "name-changed" }; // 리네임 금지(DW5 준용)
  return { ok: true, text, data: np.data };
}

// 편집(PUT): 제출 신규본 + **필수** 직전 디스크본(curContent) 대비 semantic diff(limited-edit). null 불허 — 편집은
//   항상 현재본이 존재하므로 curContent 는 string 강제(R3: null 경로 제거로 신규 생성 우회 표면 축소).
//   성공 시 canonical = verbatim(개행 정규화만) — 주석/포맷 완전 보존.
export function canonicalizeTomlAgent(content: string, expectedName: string, curContent: string): TomlCanonResult {
  const base = validateTomlBase(content, expectedName);
  if (!base.ok) return base;
  const op = parseStrict(normalizeNewlines(curContent));
  if (!op.ok) return { ok: false, error: "current-corrupt" }; // 손상된 현재본 → 편집 차단(fail-closed·비교 불가)
  const diff = semanticDiff(op.data, base.data);
  if (diff) return { ok: false, error: `limited-edit:${diff}` };
  return { ok: true, canonical: base.text, normalized: base.data };
}

// rollback 복원(신뢰 백업): semantic diff 없음(백업은 게이트 통과분/원본이라 전체 구조 허용). parse+name+description 만.
//   이 함수만 curContent 없이 통과 — api 는 rollback 경로에서만 호출(canonicalizeByPath opts.restore).
export function validateTomlRestore(content: string, expectedName: string): TomlCanonResult {
  const base = validateTomlBase(content, expectedName);
  if (!base.ok) return base;
  return { ok: true, canonical: base.text, normalized: base.data };
}
