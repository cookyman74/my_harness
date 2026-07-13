// F16(M-f·A186): 스킬 사본 (dev,ino) 분류 + 안전 다타깃 동기. 3분류·drift·낙관적 동시성·hardlink confirm.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, rm, symlink, link, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { skillSyncGroups } from "../src/server/adapters/driftsync.js";
import { buildServer } from "../src/server/index.js";

const sha = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");
const SKILL = (name: string, body: string) => `---\nname: ${name}\ndescription: d\n---\n# ${body}\n`;

let root: string, stateDir: string;
const origState = process.env.HARNESS_STATE_HOME;

async function putSkill(dir: string, name: string, content: string) {
  await mkdir(join(root, ...dir.split("/"), name), { recursive: true });
  await writeFile(join(root, ...dir.split("/"), name, "SKILL.md"), content);
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "hui-drift-"));
  stateDir = await mkdtemp(join(tmpdir(), "hui-drift-state-"));
  process.env.HARNESS_STATE_HOME = stateDir;
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

describe("skillSyncGroups — (dev,ino) 분류", () => {
  it("단일 dir 스킬 → 그룹 아님(사본 없음)", async () => {
    await putSkill(".claude/skills", "solo", SKILL("solo", "a"));
    expect(await skillSyncGroups(root)).toHaveLength(0);
  });
  it("copy-drift: 내용 상이 → hasDrift·copy-drift", async () => {
    await putSkill(".claude/skills", "s", SKILL("s", "canon"));
    await putSkill(".agents/skills", "s", SKILL("s", "different"));
    const g = (await skillSyncGroups(root)).find((x) => x.skill === "s")!;
    expect(g.hasDrift).toBe(true);
    expect(g.copies.find((c) => c.dir === ".claude/skills")!.cls).toBe("canonical");
    expect(g.copies.find((c) => c.dir === ".agents/skills")!.cls).toBe("copy-drift");
  });
  it("copy-insync: 내용 동일·다른 inode → copy-insync·drift 아님", async () => {
    await putSkill(".claude/skills", "s", SKILL("s", "same"));
    await putSkill(".agents/skills", "s", SKILL("s", "same"));
    const g = (await skillSyncGroups(root)).find((x) => x.skill === "s")!;
    expect(g.hasDrift).toBe(false);
    expect(g.copies.find((c) => c.dir === ".agents/skills")!.cls).toBe("copy-insync");
  });
  it("symlink-to-canonical: 심링크가 정본 가리킴 → 물리동일·drift 아님", async () => {
    await putSkill(".claude/skills", "s", SKILL("s", "canon"));
    await mkdir(join(root, ".agents", "skills", "s"), { recursive: true });
    await symlink(join(root, ".claude", "skills", "s", "SKILL.md"), join(root, ".agents", "skills", "s", "SKILL.md"));
    const g = (await skillSyncGroups(root)).find((x) => x.skill === "s")!;
    expect(g.hasDrift).toBe(false);
    expect(g.copies.find((c) => c.dir === ".agents/skills")!.cls).toBe("symlink-to-canonical");
  });
  it("hardlink-same-inode: 같은 (dev,ino)·심링크 아님 → hardlink·drift 아님", async () => {
    await putSkill(".claude/skills", "s", SKILL("s", "canon"));
    await mkdir(join(root, ".agents", "skills", "s"), { recursive: true });
    await link(join(root, ".claude", "skills", "s", "SKILL.md"), join(root, ".agents", "skills", "s", "SKILL.md"));
    const g = (await skillSyncGroups(root)).find((x) => x.skill === "s")!;
    const peer = g.copies.find((c) => c.dir === ".agents/skills")!;
    expect(peer.cls).toBe("hardlink-same-inode");
    expect(peer.nlink).toBeGreaterThanOrEqual(2);
    expect(g.hasDrift).toBe(false); // 물리 동일 → drift 아님
  });
  it("foreign hardlink(nlink>1·정본 아닌 다중링크) → broken(과동기 차단·R2 codex MED)", async () => {
    await putSkill(".claude/skills", "s", SKILL("s", "canon"));
    await mkdir(join(root, ".agents", "skills", "s"), { recursive: true });
    // .agents 사본을 외부 파일과 hardlink(정본과는 다른 inode·nlink>1).
    await writeFile(join(root, "external.md"), SKILL("s", "external"));
    await link(join(root, "external.md"), join(root, ".agents", "skills", "s", "SKILL.md"));
    const g = (await skillSyncGroups(root)).find((x) => x.skill === "s")!;
    expect(g.copies.find((c) => c.dir === ".agents/skills")!.cls).toBe("broken");
    expect(g.hasBroken).toBe(true);
  });
  it("정본 자체 broken(심링크) → 전 사본 broken·drift 계산 중단(R2 codex MED)", async () => {
    await mkdir(join(root, ".claude", "skills", "s"), { recursive: true });
    await symlink(join(root, "nope.md"), join(root, ".claude", "skills", "s", "SKILL.md")); // 정본이 dangling 심링크
    await putSkill(".agents/skills", "s", SKILL("s", "real"));
    const g = (await skillSyncGroups(root)).find((x) => x.skill === "s")!;
    expect(g.hasBroken).toBe(true);
    expect(g.hasDrift).toBe(false);
    expect(g.copies.every((c) => c.cls === "broken")).toBe(true);
  });
  it("dangling/foreign 심링크 → broken(copy-drift 오분류 아님·R1 LOW)·hasBroken", async () => {
    await putSkill(".claude/skills", "s", SKILL("s", "canon"));
    await mkdir(join(root, ".agents", "skills", "s"), { recursive: true });
    await symlink(join(root, "nonexistent-target.md"), join(root, ".agents", "skills", "s", "SKILL.md")); // dangling
    const g = (await skillSyncGroups(root)).find((x) => x.skill === "s")!;
    expect(g.copies.find((c) => c.dir === ".agents/skills")!.cls).toBe("broken");
    expect(g.hasBroken).toBe(true);
    expect(g.hasDrift).toBe(false);
  });
});

describe("POST /api/drift/sync-skill — 안전 다타깃 동기", () => {
  beforeEach(() => setGate(true));
  const canon = SKILL("s", "canon");
  const drifted = SKILL("s", "old");
  async function setupDrift() {
    await putSkill(".claude/skills", "s", canon);
    await putSkill(".agents/skills", "s", drifted);
  }
  it("copy-drift 동기 → applied·디스크에 정본 전파", async () => {
    await setupDrift();
    const r = await app().inject({ method: "POST", url: "/api/drift/sync-skill", payload: {
      skill: "s", targets: [{ path: ".agents/skills/s/SKILL.md", baseHash: sha(drifted) }],
    } });
    expect(r.statusCode).toBe(200);
    expect(r.json().results[0].status).toBe("applied");
    const disk = await readFile(join(root, ".agents", "skills", "s", "SKILL.md"), "utf8");
    expect(disk).toContain("# canon");
  });
  it("stale baseHash → stale(디스크 무변경·낙관적 동시성)", async () => {
    await setupDrift();
    const r = await app().inject({ method: "POST", url: "/api/drift/sync-skill", payload: {
      skill: "s", targets: [{ path: ".agents/skills/s/SKILL.md", baseHash: sha("wrong") }],
    } });
    expect(r.json().results[0].status).toBe("stale");
    expect(await readFile(join(root, ".agents", "skills", "s", "SKILL.md"), "utf8")).toBe(drifted);
  });
  it("hardlink 대상 → not-syncable(정본과 물리동일·동기 무의미·무변경)", async () => {
    await putSkill(".claude/skills", "s", canon);
    await mkdir(join(root, ".agents", "skills", "s"), { recursive: true });
    await link(join(root, ".claude", "skills", "s", "SKILL.md"), join(root, ".agents", "skills", "s", "SKILL.md"));
    const r = await app().inject({ method: "POST", url: "/api/drift/sync-skill", payload: {
      skill: "s", targets: [{ path: ".agents/skills/s/SKILL.md", baseHash: sha(canon) }],
    } });
    expect(r.json().results[0].status).toBe("not-syncable:hardlink-same-inode");
  });
  it("동기 후 정본과 바이트 동일 → 재조회 시 drift 사라짐(agy MED: 무한 루프 없음)", async () => {
    await setupDrift();
    await app().inject({ method: "POST", url: "/api/drift/sync-skill", payload: {
      skill: "s", targets: [{ path: ".agents/skills/s/SKILL.md", baseHash: sha(drifted) }],
    } });
    const g = (await skillSyncGroups(root)).find((x) => x.skill === "s")!;
    expect(g.hasDrift).toBe(false); // 재분류 시 copy-insync
    expect(g.copies.find((c) => c.dir === ".agents/skills")!.cls).toBe("copy-insync");
  });
  it("게이트 off → 403", async () => {
    await setGate(false); await setupDrift();
    const r = await app().inject({ method: "POST", url: "/api/drift/sync-skill", payload: {
      skill: "s", targets: [{ path: ".agents/skills/s/SKILL.md", baseHash: sha(drifted) }],
    } });
    expect(r.statusCode).toBe(403);
  });
  it("정본 자체를 대상으로 → skip-canonical(자기덮어쓰기 방지)", async () => {
    await setupDrift();
    const r = await app().inject({ method: "POST", url: "/api/drift/sync-skill", payload: {
      skill: "s", targets: [{ path: ".claude/skills/s/SKILL.md", baseHash: sha(canon) }],
    } });
    expect(r.json().results[0].status).toBe("skip-canonical");
  });
});
