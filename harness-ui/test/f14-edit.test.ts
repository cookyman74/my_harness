// F14(M-c): Claude+Gemini md 정의 편집 개방 — resolveEditable·safeDefPath·writeDefSafe·쓰기경계(A184).
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, writeFile, symlink, readFile, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveEditableAgent, resolveEditableSkill } from "../src/server/adapters/harness.js";
import { safeDefPath, writeDefSafe } from "../src/server/adapters/defedit.js";

let root: string;
beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), "hui-f14-")));
  await mkdir(join(root, ".claude", "agents"), { recursive: true });
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

const gAgent = async (name: string) => {
  await mkdir(join(root, ".gemini", "agents"), { recursive: true });
  await writeFile(join(root, ".gemini", "agents", `${name}.md`), `---\nname: ${name}\ndescription: d\n---\n본문`);
};
const gSkill = async (name: string) => {
  await mkdir(join(root, ".gemini", "skills", name), { recursive: true });
  await writeFile(join(root, ".gemini", "skills", name, "SKILL.md"), `---\nname: ${name}\ndescription: d\n---\n본문`);
};

describe("F14 resolveEditable — Gemini md 편집 개방", () => {
  it("Gemini 에이전트 → editable sourcePath", async () => {
    await gAgent("g1");
    const r = await resolveEditableAgent(root, "g1");
    expect(r).toEqual({ ok: true, sourcePath: ".gemini/agents/g1.md" });
  });
  it("Gemini 스킬 → editable sourcePath", async () => {
    await gSkill("gs1");
    const r = await resolveEditableSkill(root, "gs1");
    expect(r).toEqual({ ok: true, sourcePath: ".gemini/skills/gs1/SKILL.md" });
  });
  it("동일 name Claude+Gemini → ambiguous(비결정 해소 금지·다중 런타임)", async () => {
    await writeFile(join(root, ".claude", "agents", "dup.md"), "---\nname: dup\ndescription: c\n---\n본문");
    await gAgent("dup");
    const r = await resolveEditableAgent(root, "dup");
    expect(r).toEqual({ ok: false, error: "ambiguous-definition" });
  });
});

describe("F14 safeDefPath — 쓰기경계(A184)", () => {
  it("Gemini 에이전트 경로 → resolve", async () => {
    await gAgent("g2");
    expect(await safeDefPath(root, ".gemini/agents/g2.md", "agent")).toBe(join(root, ".gemini", "agents", "g2.md"));
  });
  it("화이트리스트 밖(.env·.git·임의) → null", async () => {
    await writeFile(join(root, ".env"), "SECRET=1");
    expect(await safeDefPath(root, ".env", "agent")).toBeNull();
    expect(await safeDefPath(root, ".git/config", "agent")).toBeNull();
    expect(await safeDefPath(root, "../etc/passwd", "agent")).toBeNull();
    expect(await safeDefPath(root, ".gemini/agents/x/../../../etc", "agent")).toBeNull();
  });
  it("심링크 leaf 정의 → null(심링크 편집 거부)", async () => {
    await mkdir(join(root, ".gemini", "agents"), { recursive: true });
    const target = join(root, ".claude", "agents", "real.md");
    await writeFile(target, "---\nname: real\n---\nx");
    await symlink(target, join(root, ".gemini", "agents", "link.md")).catch(() => {});
    expect(await safeDefPath(root, ".gemini/agents/link.md", "agent")).toBeNull();
  });
});

describe("F14 writeDefSafe — Gemini 쓰기 + 플랫폼", () => {
  it("Gemini 에이전트 원자 쓰기(비-Windows)", async () => {
    if (process.platform === "win32") return; // Windows 는 아래 별도 테스트
    await gAgent("gw");
    await writeDefSafe(root, ".gemini/agents/gw.md", "agent", "---\nname: gw\ndescription: updated\n---\n새 본문");
    expect(await readFile(join(root, ".gemini", "agents", "gw.md"), "utf8")).toContain("새 본문");
  });
  it("Windows → mutation 차단(unsupported-platform-write)", async () => {
    if (process.platform !== "win32") return; // POSIX 러너에선 skip(계약 문서화)
    await gAgent("gw2");
    await expect(writeDefSafe(root, ".gemini/agents/gw2.md", "agent", "x")).rejects.toThrow("unsupported-platform-write");
  });
});
