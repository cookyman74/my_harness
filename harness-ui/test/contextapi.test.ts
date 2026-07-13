// M15 F10 컨텍스트 API — A121·A122·A124·A125·A126·A127·A129·A130 통과/거부 + I8 쓰기 경계 회귀.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildServer } from "../src/server/index.js";
import type { ExecFn } from "../src/server/lib/builddraft.js";

let root: string, stateDir: string;
const origState = process.env.HARNESS_STATE_HOME;

const VALID_AGENT = "---\nname: fresh\ndescription: a fresh agent\n---\n# body\nhello\n";

async function setGate(enabled: boolean) {
  await writeFile(join(stateDir, "config.json"),
    JSON.stringify({ schemaVersion: "1", definitionEditEnabled: enabled }), "utf8");
}
// 항상 유효 초안을 반환하는 mock exec(실 LLM 미호출).
const okExec: ExecFn = async () => ({ ok: true, stdout: VALID_AGENT, stderr: "", path: "/bin/claude" });
function app(exec: ExecFn = okExec) { return buildServer({ projectRoot: root, buildExec: exec }); }

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "hui-ctxapi-"));
  stateDir = await mkdtemp(join(tmpdir(), "hui-ctxapi-state-"));
  process.env.HARNESS_STATE_HOME = stateDir;
  await mkdir(join(root, ".claude", "agents"), { recursive: true });
  await mkdir(join(root, ".claude", "skills", "alpha"), { recursive: true });
  await mkdir(join(root, ".codex", "agents"), { recursive: true });
  await mkdir(join(root, ".agents", "skills", "beta"), { recursive: true });
  await writeFile(join(root, "CLAUDE.md"), "# claude ctx\n");
  await writeFile(join(root, "GEMINI.md"), "# gemini ctx\n");
  await writeFile(join(root, ".claude", "agents", "a1.md"), "---\nname: a1\ndescription: d\n---\n");
  await writeFile(join(root, ".claude", "skills", "alpha", "SKILL.md"), "---\nname: alpha\ndescription: d\n---\n");
  await writeFile(join(root, ".codex", "agents", "cx.toml"), 'name = "cx"\ntools = ["Read"]\n');
  await writeFile(join(root, ".agents", "skills", "beta", "SKILL.md"), "---\nname: beta\ndescription: d\n---\n");
  await writeFile(join(root, ".claude", "skills", "alpha", "cert.key"), "SECRET");
  await mkdir(join(root, ".git"), { recursive: true });
  await writeFile(join(root, ".env"), "SECRET=1");
});
afterEach(async () => {
  if (origState === undefined) delete process.env.HARNESS_STATE_HOME; else process.env.HARNESS_STATE_HOME = origState;
  await rm(root, { recursive: true, force: true });
  await rm(stateDir, { recursive: true, force: true });
});

describe("A121/A129 — GET /api/context/tree", () => {
  it("멀티런타임 트리 200·runtime 라벨·서브루트 파일 노출", async () => {
    const r = await app().inject({ url: "/api/context/tree" });
    expect(r.statusCode).toBe(200);
    const b = r.json();
    expect(b.topFiles.find((f: any) => f.name === "GEMINI.md").runtime).toBe("agy");
    const s = JSON.stringify(b.roots);
    expect(s).toContain(".codex/agents/cx.toml");
    expect(s).toContain(".agents/skills/beta/SKILL.md");
    expect(s).not.toContain("cert.key"); // 시크릿 미노출
  });
});

describe("A122 — GET /api/context/file (HR5=DV8·md/TOML 렌더·실행 안 함)", () => {
  it("md·TOML 텍스트 렌더 200(content 존재·renderable)", async () => {
    const md = await app().inject({ url: "/api/context/file?path=CLAUDE.md" });
    expect(md.statusCode).toBe(200);
    expect(md.json().content).toContain("claude ctx");
    const toml = await app().inject({ url: "/api/context/file?path=.codex/agents/cx.toml" });
    expect(toml.statusCode).toBe(200);
    expect(toml.json().renderable).toBe(true);
    expect(toml.json().content).toContain('name = "cx"');
    // CSP 적용
    expect(md.headers["content-security-policy"]).toContain("script-src 'none'");
  });
  it("거부: 시크릿·.env·.git·화이트리스트 밖 dot·서브루트 dir·탈출·홈 전역", async () => {
    for (const p of [
      ".claude/skills/alpha/cert.key", ".env", ".git/config", ".gemini/x",
      ".claude/settings.json", ".codex/config", ".claude/agents", // dir 자체
      "../../etc/passwd", "%2e%2e/x", "docs/x.md", "/etc/passwd",
    ]) {
      const r = await app().inject({ url: `/api/context/file?path=${encodeURIComponent(p)}` });
      expect(r.statusCode, `must reject: ${p}`).toBeGreaterThanOrEqual(400);
    }
  });
});

describe("A130/HR6 — 편집=Claude 스코프만(PUT /api/context/edit·아무것도 안 씀)", () => {
  it("편집 가능 정의(codex toml·shared skill·claude md) → edit-via-f7·top rules 파일 → readonly(M-e drift 해소)", async () => {
    // F15(M-e): codex toml 에이전트·공유 스킬도 F7 편집 가능 → edit-via-f7. GEMINI.md/CLAUDE.md(top rules) 는 정의 아님 → 읽기전용.
    const f7cases = [".codex/agents/cx.toml", ".agents/skills/beta/SKILL.md", ".claude/agents/a1.md"];
    for (const path of f7cases) {
      const r = await app().inject({ method: "PUT", url: "/api/context/edit", payload: { path } });
      expect(r.statusCode).toBe(409);
      expect(r.json().error).toBe("edit-via-f7");
    }
    const gem = await app().inject({ method: "PUT", url: "/api/context/edit", payload: { path: "GEMINI.md" } });
    expect(gem.statusCode).toBe(409);
    expect(gem.json().error).toBe("agy-edit-v0.7"); // top rules 파일(정의 아님) — v0.7 비대상
    const cmd = await app().inject({ method: "PUT", url: "/api/context/edit", payload: { path: "CLAUDE.md" } });
    expect(cmd.json().error).toBe("context-file-readonly");
    // R5(codex MED): .gemini 는 컨텍스트 트리 밖 → 서버/웹 동형(edit-via-f7 아님·트리 미노출). classify 400 invalid-path.
    const gemDef = await app().inject({ method: "PUT", url: "/api/context/edit", payload: { path: ".gemini/agents/g1.md" } });
    expect(gemDef.statusCode).toBe(400);
    // R5(codex LOW): dotfile 명(첫 글자 점)은 edit-via-f7 false-positive 금지(웹 정규식과 동일 엄격도).
    const dot = await app().inject({ method: "PUT", url: "/api/context/edit", payload: { path: ".codex/agents/.hidden.toml" } });
    expect(dot.json().error).not.toBe("edit-via-f7");
  });
  it("LOW-2: claude 서브루트의 비-정의 파일(references/*)은 edit-via-f7 아닌 context-file-readonly", async () => {
    await mkdir(join(root, ".claude", "skills", "alpha", "references"), { recursive: true });
    await writeFile(join(root, ".claude", "skills", "alpha", "references", "foo.md"), "# ref\n");
    const ref = await app().inject({ method: "PUT", url: "/api/context/edit", payload: { path: ".claude/skills/alpha/references/foo.md" } });
    expect(ref.statusCode).toBe(409);
    expect(ref.json().error).toBe("context-file-readonly");
    // 정의 파일(SKILL.md)은 여전히 edit-via-f7
    const skill = await app().inject({ method: "PUT", url: "/api/context/edit", payload: { path: ".claude/skills/alpha/SKILL.md" } });
    expect(skill.json().error).toBe("edit-via-f7");
  });
});

describe("A124/HB7·HB8 — POST /api/context/build/draft", () => {
  it("게이트 off → 403·on → 초안 반환(디스크 미기록·applied:false)", async () => {
    await setGate(false);
    const off = await app().inject({ method: "POST", url: "/api/context/build/draft", payload: { kind: "agent", domain: "d", role: "r" } });
    expect(off.statusCode).toBe(403);
    await setGate(true);
    const on = await app().inject({ method: "POST", url: "/api/context/build/draft", payload: { kind: "agent", domain: "d", role: "r" } });
    expect(on.statusCode).toBe(200);
    expect(on.json().applied).toBe(false);
    expect(on.json().draft).toContain("name: fresh");
  });
  it("HB1 bounded: 과대 domain·미지 필드 → 400", async () => {
    await setGate(true);
    const big = await app().inject({ method: "POST", url: "/api/context/build/draft", payload: { kind: "agent", domain: "x".repeat(5000), role: "r" } });
    expect(big.statusCode).toBe(400);
    const extra = await app().inject({ method: "POST", url: "/api/context/build/draft", payload: { kind: "agent", domain: "d", role: "r", evil: 1 } });
    expect(extra.statusCode).toBe(400);
  });
  it("MED(R4): 실패 요청(403/400)은 쿨다운·in-flight 미소비 — 직후 정상 draft 통과", async () => {
    const a = app(); // 단일 인스턴스(buildGate 공유)
    // 게이트 off → 403(쿨다운 미소비)
    await setGate(false);
    const off = await a.inject({ method: "POST", url: "/api/context/build/draft", payload: { kind: "agent", domain: "d", role: "r" } });
    expect(off.statusCode).toBe(403);
    // 게이트 on·bad-input → 400(쿨다운 미소비)
    await setGate(true);
    const bad = await a.inject({ method: "POST", url: "/api/context/build/draft", payload: { kind: "agent" } });
    expect(bad.statusCode).toBe(400);
    // 정상 draft → 200(직전 실패들이 쿨다운을 소비하지 않아 안 막힘)
    const ok1 = await a.inject({ method: "POST", url: "/api/context/build/draft", payload: { kind: "agent", domain: "d", role: "r" } });
    expect(ok1.statusCode).toBe(200);
    // 실제 draft 는 쿨다운 소비 확인 — 즉시 반복 → 429 build-cooldown
    const ok2 = await a.inject({ method: "POST", url: "/api/context/build/draft", payload: { kind: "agent", domain: "d", role: "r" } });
    expect(ok2.statusCode).toBe(429);
    expect(ok2.json().error).toBe("build-cooldown");
  });
  it("HB8 동시 2요청 → 1개 429 build-in-progress·쿨다운 내 반복 → 429 build-cooldown", async () => {
    await setGate(true);
    let release!: () => void;
    const gate = new Promise<void>((res) => { release = res; });
    const slow: ExecFn = async () => { await gate; return { ok: true, stdout: VALID_AGENT, stderr: "", path: "/bin/claude" }; };
    const a = app(slow);
    const p1 = a.inject({ method: "POST", url: "/api/context/build/draft", payload: { kind: "agent", domain: "d", role: "r" } });
    await new Promise((r) => setTimeout(r, 30)); // p1 이 gate 획득(in-flight)하도록
    const p2 = await a.inject({ method: "POST", url: "/api/context/build/draft", payload: { kind: "agent", domain: "d", role: "r" } });
    expect(p2.statusCode).toBe(429);
    expect(p2.json().error).toBe("build-in-progress");
    release();
    expect((await p1).statusCode).toBe(200);
    // 쿨다운(방금 draft 완료) 내 반복 → 429 build-cooldown
    const p3 = await a.inject({ method: "POST", url: "/api/context/build/draft", payload: { kind: "agent", domain: "d", role: "r" } });
    expect(p3.statusCode).toBe(429);
    expect(p3.json().error).toBe("build-cooldown");
  });
});

describe("A125/A126/A127 — POST /api/context/build/create (신규 구축·F7 저장)", () => {
  it("게이트 on·승인 초안 → 신규 agent 생성(canonicalize+원자쓰기)·디스크 확인", async () => {
    await setGate(true);
    const r = await app().inject({ method: "POST", url: "/api/context/build/create", payload: { kind: "agent", name: "fresh", content: VALID_AGENT } });
    expect(r.statusCode).toBe(200);
    expect(r.json().created).toBe(true);
    expect(r.json().sourcePath).toBe(".claude/agents/fresh.md");
    const st = await stat(join(root, ".claude", "agents", "fresh.md"));
    expect(st.isFile()).toBe(true);
  });
  it("MED-1: kind:skill → .claude/skills/{name}/SKILL.md 신규 mkdir(0700)+생성·디스크 확인", async () => {
    await setGate(true);
    const content = "---\nname: freshskill\ndescription: a fresh skill\n---\n# skill body\n";
    const r = await app().inject({ method: "POST", url: "/api/context/build/create", payload: { kind: "skill", name: "freshskill", content } });
    expect(r.statusCode).toBe(200);
    expect(r.json().created).toBe(true);
    expect(r.json().sourcePath).toBe(".claude/skills/freshskill/SKILL.md");
    expect(typeof r.json().pathId).toBe("string");
    const st = await stat(join(root, ".claude", "skills", "freshskill", "SKILL.md"));
    expect(st.isFile()).toBe(true);
    const dir = await stat(join(root, ".claude", "skills", "freshskill"));
    expect(dir.isDirectory()).toBe(true);
  });
  it("MED-1: skill 이름충돌(기존 SKILL.md) → 409·경로탈출 skill 이름 → 400", async () => {
    await setGate(true);
    const dup = await app().inject({ method: "POST", url: "/api/context/build/create", payload: { kind: "skill", name: "alpha", content: "---\nname: alpha\ndescription: d\n---\n#\n" } });
    expect(dup.statusCode).toBe(409);
    expect(dup.json().error).toBe("name-collision");
    const esc = await app().inject({ method: "POST", url: "/api/context/build/create", payload: { kind: "skill", name: "../evil", content: "---\nname: x\ndescription: d\n---\n#\n" } });
    expect(esc.statusCode).toBe(400);
  });
  it("게이트 off → 403(자동 적용 0·no-auto-apply)", async () => {
    await setGate(false);
    const r = await app().inject({ method: "POST", url: "/api/context/build/create", payload: { kind: "agent", name: "fresh", content: VALID_AGENT } });
    expect(r.statusCode).toBe(403);
  });
  it("이름 충돌(기존 정의) → 409·초안 무결성 위반(폴리글롯/필수누락) → 400", async () => {
    await setGate(true);
    const dup = await app().inject({ method: "POST", url: "/api/context/build/create", payload: { kind: "agent", name: "a1", content: "---\nname: a1\ndescription: d\n---\n#\n" } });
    expect(dup.statusCode).toBe(409);
    expect(dup.json().error).toBe("name-collision");
    const bad = await app().inject({ method: "POST", url: "/api/context/build/create", payload: { kind: "agent", name: "fresh", content: "no frontmatter body" } });
    expect(bad.statusCode).toBe(400);
    // name 불변: content name ≠ 요청 name → 무결성 400
    const rename = await app().inject({ method: "POST", url: "/api/context/build/create", payload: { kind: "agent", name: "fresh", content: "---\nname: other\ndescription: d\n---\n#\n" } });
    expect(rename.statusCode).toBe(400);
  });
  it("A127 쓰기 경계: 경로탈출 이름 → 400·스코프 밖 write 0", async () => {
    await setGate(true);
    for (const name of ["../evil", "a/b", ".hidden"]) {
      const r = await app().inject({ method: "POST", url: "/api/context/build/create", payload: { kind: "agent", name, content: VALID_AGENT } });
      expect(r.statusCode).toBe(400);
    }
    // CLAUDE.md 는 create 대상 아님(kind enum agent/skill) + 파일 무변경
    expect((await stat(join(root, "CLAUDE.md"))).size).toBe("# claude ctx\n".length);
  });
});
