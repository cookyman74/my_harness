// F15(M-e·A185): Codex TOML limited-edit canonicalizer — injection fail-closed·semantic diff·주석 보존 verbatim.
import { describe, it, expect } from "vitest";
import { canonicalizeTomlAgent, validateTomlRestore } from "../src/server/adapters/toml.js";

const base = 'name = "planner"  # 에이전트 이름\ndescription = "plans"\nmodel = "opus"\n\n[settings]\nverbose = true\n';

describe("canonicalizeTomlAgent — injection fail-closed", () => {
  it("중복키 → duplicate-key(재정의 거부)", () => {
    const r = validateTomlRestore('name = "x"\nname = "y"\ndescription = "d"', "x");
    expect(r).toMatchObject({ ok: false, error: "duplicate-key" });
  });
  it("table 재정의 → duplicate-key", () => {
    const r = validateTomlRestore('name="x"\ndescription="d"\n[a]\nx=1\n[a]\ny=2', "x");
    expect(r).toMatchObject({ ok: false, error: "duplicate-key" });
  });
  it("잘못된 이스케이프 → toml-parse", () => {
    const r = validateTomlRestore('name="x"\ndescription="\\xNN"', "x");
    expect(r).toMatchObject({ ok: false, error: "toml-parse" });
  });
  it("미종결 문자열 → toml-parse", () => {
    const r = validateTomlRestore('name="x"\ndescription="abc', "x");
    expect(r).toMatchObject({ ok: false, error: "toml-parse" });
  });
  it("top-level 배열(맵 아님) → not-a-map 또는 parse 실패", () => {
    const r = validateTomlRestore('[[x]]\na=1', "x");
    expect(r.ok).toBe(false);
  });
});

describe("canonicalizeTomlAgent — 필수/리네임", () => {
  it("name 누락 → field:name", () => {
    expect(validateTomlRestore('description="d"', "x")).toMatchObject({ ok: false, error: "field:name" });
  });
  it("description 누락 → field:description", () => {
    expect(validateTomlRestore('name="x"', "x")).toMatchObject({ ok: false, error: "field:description" });
  });
  it("name 변경(리네임) → name-changed", () => {
    expect(validateTomlRestore('name="y"\ndescription="d"', "x")).toMatchObject({ ok: false, error: "name-changed" });
  });
});

describe("canonicalizeTomlAgent — semantic diff(limited-edit)", () => {
  it("화이트리스트 scalar 변경(description) → ok·주석 verbatim 보존", () => {
    const next = base.replace('"plans"', '"plans better"');
    const r = canonicalizeTomlAgent(next, "planner", base);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.canonical).toContain("# 에이전트 이름");   // 주석 보존
      expect(r.canonical).toContain("[settings]");         // 구조 보존
      expect(r.canonical).toBe(next);                       // verbatim(개행만 정규화·동일)
    }
  });
  it("비화이트 필드([settings].verbose) 변경 → limited-edit:field-locked", () => {
    const next = base.replace("verbose = true", "verbose = false");
    const r = canonicalizeTomlAgent(next, "planner", base);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/^limited-edit:field-locked/);
  });
  it("top-level 키 추가(preserve-only 위반) → limited-edit:struct-change", () => {
    // [settings] 뒤에 붙이면 TOML 상 settings 하위로 들어가므로, top-level 영역(model 뒤)에 삽입.
    const next = base.replace('model = "opus"\n', 'model = "opus"\nextra = "z"\n');
    const r = canonicalizeTomlAgent(next, "planner", base);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/^limited-edit:struct-change/);
  });
  it("키 삭제(preserve-only 위반) → limited-edit:struct-change", () => {
    const next = base.replace('model = "opus"\n', "");
    const r = canonicalizeTomlAgent(next, "planner", base);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/^limited-edit:struct-change/);
  });
  it("scalar→table 구조 변조(model) → limited-edit:non-scalar", () => {
    const next = base.replace('model = "opus"', "[model]\nname = \"opus\"");
    const r = canonicalizeTomlAgent(next, "planner", base);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/^limited-edit:(non-string|struct-change|field-locked)/);
  });
  it("손상된 현재본(cur) → current-corrupt(편집 차단)", () => {
    const r = canonicalizeTomlAgent(base, "planner", 'name="planner"\nname="dup"');
    expect(r).toMatchObject({ ok: false, error: "current-corrupt" });
  });
  it("무변경 재저장 → ok(멱등)", () => {
    const r = canonicalizeTomlAgent(base, "planner", base);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.canonical).toBe(base);
  });
});

describe("canonicalizeTomlAgent — R1 type-confusion(stableEq 우회 차단)", () => {
  // 잠긴 숫자 필드 inf→nan: JSON.stringify 는 둘 다 "null" 로 → 옛 버그는 통과. 태그 인코딩은 구분·거부.
  it("잠긴 숫자 inf→nan 변조 → field-locked(우회 불가)", () => {
    const cur = 'name="x"\ndescription="d"\nlimit = inf\n';
    const next = 'name="x"\ndescription="d"\nlimit = nan\n';
    const r = canonicalizeTomlAgent(next, "x", cur);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/^limited-edit:field-locked/);
  });
  it("잠긴 Date→동일문자열 변조 → field-locked(태그 구분)", () => {
    const cur = 'name="x"\ndescription="d"\nts = 2023-01-01T00:00:00Z\n';
    const next = 'name="x"\ndescription="d"\nts = "2023-01-01T00:00:00.000Z"\n';
    const r = canonicalizeTomlAgent(next, "x", cur);
    expect(r.ok).toBe(false);
  });
  it("화이트 필드 문자열→비문자열(model=true) → non-string 거부", () => {
    const cur = 'name="x"\ndescription="d"\nmodel = "opus"\n';
    const next = 'name="x"\ndescription="d"\nmodel = true\n';
    const r = canonicalizeTomlAgent(next, "x", cur);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/^limited-edit:non-string/);
  });
});

describe("validateTomlRestore — 복원(semantic diff 없음)", () => {
  it("유효 백업 복원 → ok(직전본 재검증만)", () => {
    const r = validateTomlRestore(base, "planner");
    expect(r.ok).toBe(true);
  });
  it("손상 백업 복원 → 거부(parse 실패)", () => {
    expect(validateTomlRestore('name="planner"\ndescription="d', "planner").ok).toBe(false);
  });
});
