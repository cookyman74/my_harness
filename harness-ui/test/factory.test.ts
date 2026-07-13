// F11: 팩토리(myharness) 유지관리 — 감지(읽기)·적용(설치/업데이트/제거)·게이트·경로안전.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, writeFile, symlink, lstat, readlink, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { factoryStatus, applyFactoryAction } from "../src/server/adapters/factory.js";
import { buildServer } from "../src/server/index.js";

// 팩토리 정본 레포 루트 = harness-ui 의 부모(skills/myharness + .claude-plugin/plugin.json 보유).
const repoRoot = resolve(process.cwd(), "..");
const srcSkill = join(repoRoot, "skills", "myharness");

let home: string;
beforeEach(async () => { home = await mkdtemp(join(tmpdir(), "hui-fac-")); });
afterEach(async () => { await rm(home, { recursive: true, force: true }); });

const claudeDest = () => join(home, ".claude", "skills", "myharness");

describe("factoryStatus — 감지(읽기)", () => {
  it("팩토리 레포 인식 + 소스 버전 + 미설치", async () => {
    const s = await factoryStatus({ projectRoot: repoRoot, home, maintenanceEnabled: false });
    expect(s.isFactoryRepo).toBe(true);
    expect(s.sourceVersion).toMatch(/^\d+\.\d+\.\d+$/); // plugin.json version
    expect(s.targets.claudeSkill).toEqual({ kind: "absent" });
    expect(s.targets.sharedSkill).toEqual({ kind: "absent" });
    expect(s.maintenanceEnabled).toBe(false);
  });
  it("비팩토리 projectRoot → isFactoryRepo false", async () => {
    const nonFactory = await mkdtemp(join(tmpdir(), "hui-nf-"));
    const s = await factoryStatus({ projectRoot: nonFactory, home, maintenanceEnabled: false });
    expect(s.isFactoryRepo).toBe(false);
    await rm(nonFactory, { recursive: true, force: true });
  });
  it("정본 심링크 → synced true", async () => {
    await mkdir(join(home, ".claude", "skills"), { recursive: true });
    await symlink(srcSkill, claudeDest(), "dir");
    const s = await factoryStatus({ projectRoot: repoRoot, home, maintenanceEnabled: true });
    expect(s.targets.claudeSkill).toMatchObject({ kind: "symlink", synced: true });
  });
  it("marketplace 감지 + updateAvailable(버전 상이)", async () => {
    await mkdir(join(home, ".claude", "plugins"), { recursive: true });
    await writeFile(join(home, ".claude", "plugins", "installed_plugins.json"),
      JSON.stringify({ plugins: { "myharness@myharness-marketplace": [{ version: "0.0.1" }] } }));
    const s = await factoryStatus({ projectRoot: repoRoot, home, maintenanceEnabled: false });
    expect(s.targets.marketplace.installed).toBe(true);
    expect(s.targets.marketplace.version).toBe("0.0.1");
    expect(s.targets.marketplace.updateAvailable).toBe(true); // 0.0.1 ≠ 소스
  });
});

describe("applyFactoryAction — 적용(쓰기)", () => {
  it("install → 심링크 또는 copy(크로스플랫폼)", async () => {
    const r = await applyFactoryAction({ projectRoot: repoRoot, home, target: "claude-skill", action: "install", nowMs: 1 });
    expect(r.ok).toBe(true);
    expect(["symlink", "copy"]).toContain(r.method);
    const st = await lstat(claudeDest());
    if (r.method === "symlink") { expect(st.isSymbolicLink()).toBe(true); expect(resolve(await readlink(claudeDest()))).toBe(resolve(srcSkill)); }
    else expect(st.isDirectory()).toBe(true);
  });
  it("shared-skill install → ~/.agents/skills/myharness 로 씀(Codex+Gemini 공유 채널)", async () => {
    const r = await applyFactoryAction({ projectRoot: repoRoot, home, target: "shared-skill", action: "install", nowMs: 11 });
    expect(r.ok).toBe(true);
    expect(["symlink", "copy"]).toContain(r.method);
    const dest = join(home, ".agents", "skills", "myharness");
    const st = await lstat(dest);
    if (r.method === "symlink") expect(resolve(await readlink(dest))).toBe(resolve(srcSkill));
    else expect(st.isDirectory()).toBe(true);
    // 상태 조회도 공유 타깃을 인식
    const s = await factoryStatus({ projectRoot: repoRoot, home, maintenanceEnabled: true });
    expect(s.targets.sharedSkill.kind).not.toBe("absent");
  });
  it("update 재실행(이미 정본 심링크) → noop", async () => {
    await mkdir(join(home, ".claude", "skills"), { recursive: true });
    await symlink(srcSkill, claudeDest(), "dir");
    const r = await applyFactoryAction({ projectRoot: repoRoot, home, target: "claude-skill", action: "update", nowMs: 2 });
    expect(r.method).toBe("noop");
  });
  it("실물 디렉토리 존재 → 백업 후 교체", async () => {
    await mkdir(claudeDest(), { recursive: true });
    await writeFile(join(claudeDest(), "SKILL.md"), "old");
    const r = await applyFactoryAction({ projectRoot: repoRoot, home, target: "claude-skill", action: "install", nowMs: 12345 });
    expect(r.backup).toBe(`${claudeDest()}.bak.12345`);
    expect((await readFile(join(r.backup!, "SKILL.md"), "utf8"))).toBe("old"); // 백업 보존
  });
  it("remove 심링크 → removed", async () => {
    await mkdir(join(home, ".claude", "skills"), { recursive: true });
    await symlink(srcSkill, claudeDest(), "dir");
    const r = await applyFactoryAction({ projectRoot: repoRoot, home, target: "claude-skill", action: "remove", confirm: true, nowMs: 3 });
    expect(r.method).toBe("removed");
    await expect(lstat(claudeDest())).rejects.toThrow(); // 삭제됨
  });
  it("remove 실물 디렉토리 → 하드삭제 아닌 백업", async () => {
    await mkdir(claudeDest(), { recursive: true });
    await writeFile(join(claudeDest(), "x"), "keep");
    const r = await applyFactoryAction({ projectRoot: repoRoot, home, target: "claude-skill", action: "remove", confirm: true, nowMs: 999 });
    expect(r.backup).toBe(`${claudeDest()}.bak.999`);
    expect(await readFile(join(r.backup!, "x"), "utf8")).toBe("keep");
  });
  it("remove without confirm → throw", async () => {
    await mkdir(join(home, ".claude", "skills"), { recursive: true });
    await symlink(srcSkill, claudeDest(), "dir");
    await expect(applyFactoryAction({ projectRoot: repoRoot, home, target: "claude-skill", action: "remove", nowMs: 4 }))
      .rejects.toThrow("confirm-required");
  });
  it("source-not-factory → install throw", async () => {
    const nonFactory = await mkdtemp(join(tmpdir(), "hui-nf2-"));
    await expect(applyFactoryAction({ projectRoot: nonFactory, home, target: "claude-skill", action: "install", nowMs: 5 }))
      .rejects.toThrow("source-not-factory");
    await rm(nonFactory, { recursive: true, force: true });
  });
  it("SKILL.md 존재하나 plugin.json 정체성 없음 → 소스 아님(정체성 고정)", async () => {
    const fake = await mkdtemp(join(tmpdir(), "hui-fake-"));
    await mkdir(join(fake, "skills", "myharness"), { recursive: true });
    await writeFile(join(fake, "skills", "myharness", "SKILL.md"), "위장");
    // plugin.json 없음 → identity 미확인
    await expect(applyFactoryAction({ projectRoot: fake, home, target: "claude-skill", action: "install", nowMs: 6 }))
      .rejects.toThrow("source-not-factory");
    const s = await factoryStatus({ projectRoot: fake, home, maintenanceEnabled: true });
    expect(s.isFactoryRepo).toBe(false);
    await rm(fake, { recursive: true, force: true });
  });
  it("부모 경로가 심링크 → parent-unsafe 거부(리다이렉트 차단)", async () => {
    const elsewhere = await mkdtemp(join(tmpdir(), "hui-else-"));
    await mkdir(join(home, ".claude"), { recursive: false }).catch(() => {});
    await rm(join(home, ".claude"), { recursive: true, force: true });
    await symlink(elsewhere, join(home, ".claude"), "dir"); // ~/.claude 를 심링크로
    await expect(applyFactoryAction({ projectRoot: repoRoot, home, target: "claude-skill", action: "install", nowMs: 7 }))
      .rejects.toThrow("parent-unsafe");
    await rm(elsewhere, { recursive: true, force: true });
  });
  it("shared 채널: 부모 ~/.agents 가 심링크 → parent-unsafe 거부(F17 안전경계)", async () => {
    const elsewhere = await mkdtemp(join(tmpdir(), "hui-else2-"));
    await symlink(elsewhere, join(home, ".agents"), "dir"); // ~/.agents 를 심링크로
    await expect(applyFactoryAction({ projectRoot: repoRoot, home, target: "shared-skill", action: "install", nowMs: 8 }))
      .rejects.toThrow("parent-unsafe");
    await rm(elsewhere, { recursive: true, force: true });
  });
});

describe("API — /api/factory (게이트·주입 HOME)", () => {
  it("GET status → 200 · isFactoryRepo", async () => {
    const app = buildServer({ projectRoot: repoRoot, home });
    const r = await app.inject({ url: "/api/factory/status" });
    expect(r.statusCode).toBe(200);
    expect(r.json().isFactoryRepo).toBe(true);
  });
  it("POST apply — 게이트 off → 403 maintenance-disabled", async () => {
    const app = buildServer({ projectRoot: repoRoot, home });
    const r = await app.inject({ method: "POST", url: "/api/factory/apply", payload: { target: "claude-skill", action: "install" } });
    expect([403]).toContain(r.statusCode); // 기본 게이트 off(fail-closed)
    expect(r.json().error).toBe("maintenance-disabled");
  });
  it("POST apply — 잘못된 target → 400", async () => {
    const app = buildServer({ projectRoot: repoRoot, home });
    const r = await app.inject({ method: "POST", url: "/api/factory/apply", payload: { target: "../etc", action: "install" } });
    expect(r.statusCode).toBe(400); // enum 밖 = 경로 주입 시도 차단
  });
});
