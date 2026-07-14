// F15(M-e): Codex `.codex/agents/*.toml` 편집 서버 통합 — resolve·limited-edit PUT·injection 거부·rollback.
//   경로안전·게이트·원자쓰기는 defedit(F14) 재사용 — 여기선 TOML 라우팅·주석 보존·semantic diff 통합만.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { buildServer } from "../src/server/index.js";

const sha = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");
const TOML_SRC = 'name = "planner"  # 오케스트레이터\ndescription = "plans work"\nmodel = "opus"\n\n[tools]\nallow = ["Read"]\n';
const SRCPATH = ".codex/agents/planner.toml";

let root: string, stateDir: string;
const origState = process.env.HARNESS_STATE_HOME;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "hui-toml-"));
  stateDir = await mkdtemp(join(tmpdir(), "hui-tomlstate-"));
  process.env.HARNESS_STATE_HOME = stateDir;
  await mkdir(join(root, ".codex", "agents"), { recursive: true });
  await writeFile(join(root, ".codex", "agents", "planner.toml"), TOML_SRC);
});
afterEach(async () => {
  if (origState === undefined) delete process.env.HARNESS_STATE_HOME; else process.env.HARNESS_STATE_HOME = origState;
  await rm(root, { recursive: true, force: true });
  await rm(stateDir, { recursive: true, force: true });
});
function app() { return buildServer({ projectRoot: root }); }
async function setGate(on: boolean) {
  await writeFile(join(stateDir, "config.json"), JSON.stringify({ schemaVersion: "1", definitionEditEnabled: on }), "utf8");
}
const pathId = sha(SRCPATH);
function put(content: string, baseHash: string) {
  return app().inject({ method: "PUT", url: "/api/agents/planner/definition", payload: { content, baseHash, pathId } });
}

describe("Codex TOML 편집 — resolve + GET", () => {
  it("codex 에이전트 resolve → sourcePath=.codex/agents/*.toml·content 반환", async () => {
    const r = await app().inject({ url: "/api/agents/planner/definition" });
    expect(r.statusCode).toBe(200);
    expect(r.json().sourcePath).toBe(SRCPATH);
    expect(r.json().content).toBe(TOML_SRC);
  });
  it("R1(agy HIGH): multiline 문자열 내부 `name=` 오탐 없이 top-level name 으로 resolve", async () => {
    // prompt 다중행 문자열에 name="fake" 가 있어도 정규식 오탐 없이 정확히 planner 로 resolve(self-DoS 방지).
    const tricky = 'name = "planner"\ndescription = "d"\nprompt = """\nexample:\nname = "fake-agent"\n"""\n';
    await writeFile(join(root, ".codex", "agents", "planner.toml"), tricky);
    const r = await app().inject({ url: "/api/agents/planner/definition" });
    expect(r.statusCode).toBe(200);
    expect(r.json().sourcePath).toBe(SRCPATH);
    // 잘못된 이름으로는 resolve 안 됨(오탐 부재)
    const bad = await app().inject({ url: "/api/agents/fake-agent/definition" });
    expect(bad.statusCode).toBe(404);
  });
});

describe.skipIf(process.platform === "win32")("Codex TOML 편집 — limited-edit PUT", () => {
  beforeEach(() => setGate(true));
  it("화이트 필드(description) 변경 → 200·디스크 주석/구조 보존", async () => {
    const next = TOML_SRC.replace('"plans work"', '"plans work well"');
    const r = await put(next, sha(TOML_SRC));
    expect(r.statusCode).toBe(200);
    const disk = await readFile(join(root, ".codex", "agents", "planner.toml"), "utf8");
    expect(disk).toBe(next);
    expect(disk).toContain("# 오케스트레이터"); // 주석 보존
    expect(disk).toContain("[tools]");           // 구조 보존
  });
  it("잠긴 필드([tools]) 변경 → 400 integrity(limited-edit)·디스크 무변경", async () => {
    const next = TOML_SRC.replace('allow = ["Read"]', 'allow = ["Read", "Write"]');
    const r = await put(next, sha(TOML_SRC));
    expect(r.statusCode).toBe(400);
    expect(r.json().error).toBe("integrity");
    expect(await readFile(join(root, ".codex", "agents", "planner.toml"), "utf8")).toBe(TOML_SRC);
  });
  it("중복키 injection → 400 integrity·디스크 무변경", async () => {
    const next = 'name = "planner"\nname = "evil"\ndescription = "x"';
    const r = await put(next, sha(TOML_SRC));
    expect(r.statusCode).toBe(400);
    expect(r.json().error).toBe("integrity");
    expect(await readFile(join(root, ".codex", "agents", "planner.toml"), "utf8")).toBe(TOML_SRC);
  });
  it("리네임 시도 → 400 integrity", async () => {
    const next = TOML_SRC.replace('name = "planner"', 'name = "other"');
    const r = await put(next, sha(TOML_SRC));
    expect(r.statusCode).toBe(400);
    expect(r.json().error).toBe("integrity");
  });
  it("게이트 off → 403 edit-disabled", async () => {
    await setGate(false);
    const r = await put(TOML_SRC, sha(TOML_SRC));
    expect(r.statusCode).toBe(403);
  });
  it("편집 후 rollback → 원본([tools] 구조 포함) 복원(restore 경로)", async () => {
    const next = TOML_SRC.replace('"plans work"', '"edited"');
    const put1 = await put(next, sha(TOML_SRC));
    expect(put1.statusCode).toBe(200);
    // rollback: 현재=수정본(next), 백업=원본(TOML_SRC).
    const rb = await app().inject({
      method: "POST", url: "/api/agents/planner/definition/rollback",
      payload: { expectedCurrentHash: sha(next), backupHash: sha(TOML_SRC) },
    });
    expect(rb.statusCode).toBe(200);
    const disk = await readFile(join(root, ".codex", "agents", "planner.toml"), "utf8");
    expect(disk).toBe(TOML_SRC);          // 원본 완전 복원(구조 [tools] 포함)
    expect(disk).toContain("[tools]");
  });
});
