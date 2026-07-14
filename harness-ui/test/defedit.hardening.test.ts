// M12 F7 외부감사 R1 경화 — 쓰기 TOCTOU · 스캔 상한 · CRLF/NFC 정규화 · 동시 lost-update · 백업 dir 심링크.
// server-builder 범위(defedit.ts·harness.ts). 기존 M12 스위트와 상보(중복 아님).
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, rm, readFile, symlink, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { buildServer } from "../src/server/index.js";
import {
  canonicalizeDefinition, writeDefSafe, writeBackup, backupPathFor,
} from "../src/server/adapters/defedit.js";
import { readSkills } from "../src/server/adapters/harness.js";

const sha = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

let root: string;
let stateDir: string;
const origState = process.env.HARNESS_STATE_HOME;

const AGENT_MD = "---\nname: alpha\ndescription: alpha agent\ntools: Read, Grep\n---\n# body\nhello\n";
const SKILL_MD = "---\nname: beta\ndescription: beta skill\n---\n# skill body\n";

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "hui-hard-"));
  stateDir = await mkdtemp(join(tmpdir(), "hui-hardstate-"));
  process.env.HARNESS_STATE_HOME = stateDir;
  await mkdir(join(root, ".claude", "agents"), { recursive: true });
  await mkdir(join(root, ".claude", "skills", "beta"), { recursive: true });
  await writeFile(join(root, ".claude", "agents", "alpha.md"), AGENT_MD);
  await writeFile(join(root, ".claude", "skills", "beta", "SKILL.md"), SKILL_MD);
});
afterEach(async () => {
  if (origState === undefined) delete process.env.HARNESS_STATE_HOME; else process.env.HARNESS_STATE_HOME = origState;
  await rm(root, { recursive: true, force: true });
  await rm(stateDir, { recursive: true, force: true });
});
function app() { return buildServer({ projectRoot: root }); }
async function setGate(enabled: boolean) {
  await writeFile(join(stateDir, "config.json"), JSON.stringify({ schemaVersion: "1", definitionEditEnabled: enabled }), "utf8");
}

// ── HIGH(codex) · 쓰기 TOCTOU — writeDefSafe 부모 체인 재검증 ──────────────────
describe.skipIf(process.platform === "win32")("HIGH/codex — writeDefSafe 경화 원자쓰기(중간 dir 스왑 fail-closed)", () => {
  it("정상 write → 정의 갱신·디스크 반영(회귀)", async () => {
    const next = "---\nname: alpha\ndescription: edited\n---\n# body\nbye\n";
    await writeDefSafe(root, ".claude/agents/alpha.md", "agent", next);
    expect(await readFile(join(root, ".claude", "agents", "alpha.md"), "utf8")).toBe(next);
  });
  it("중간 dir(.claude/agents)가 심링크 → 밖으로 write 안 됨·throw·정상 파일 무변경", async () => {
    // 검증 후 스왑을 모사: agents 를 외부 실디렉토리로 향하는 심링크로 교체(post-swap 상태).
    const outside = await mkdtemp(join(tmpdir(), "hui-swap-"));
    const agentsDir = join(root, ".claude", "agents");
    await rm(agentsDir, { recursive: true, force: true });
    await symlink(outside, agentsDir); // .claude/agents → outside(심링크)
    await expect(writeDefSafe(root, ".claude/agents/alpha.md", "agent", "---\nname: alpha\ndescription: evil\n---\nx\n"))
      .rejects.toThrow();
    // 밖(outside)으로 파일이 새지 않음 — temp/leaf 모두 미생성.
    expect(await readdir(outside)).toEqual([]);
    await rm(outside, { recursive: true, force: true });
  });
  it("skill 중간 dir(.claude/skills/beta)가 심링크 → fail-closed·밖 무변경", async () => {
    const outside = await mkdtemp(join(tmpdir(), "hui-swap2-"));
    const skillDir = join(root, ".claude", "skills", "beta");
    await rm(skillDir, { recursive: true, force: true });
    await symlink(outside, skillDir);
    await expect(writeDefSafe(root, ".claude/skills/beta/SKILL.md", "skill", "---\nname: beta\ndescription: evil\n---\nx\n"))
      .rejects.toThrow();
    expect(await readdir(outside)).toEqual([]);
    await rm(outside, { recursive: true, force: true });
  });
  it("화이트리스트 밖 sourcePath → throw(이중방어)", async () => {
    await expect(writeDefSafe(root, ".claude/../etc/passwd", "agent", "x")).rejects.toThrow();
    await expect(writeDefSafe(root, "CLAUDE.md", "agent", "x")).rejects.toThrow();
  });
  it("write 후 temp 잔재 없음(정상 경로)", async () => {
    await writeDefSafe(root, ".claude/agents/alpha.md", "agent", "---\nname: alpha\ndescription: d\n---\nb\n");
    const files = await readdir(join(root, ".claude", "agents"));
    expect(files.some((f) => f.startsWith(".alpha.md.tmp"))).toBe(false);
  });
});

// ── HIGH(agy#1) · 스캔 상한 — listDirs MAX_AGENT_FILES ─────────────────────────
describe("HIGH/agy#1 — 스킬 스캔 개수 상한(DoS)", () => {
  it("대량 스킬 dir(650개) → listDirs 상한(500)으로 스캔 개수 제한", async () => {
    const sbase = join(root, ".claude", "skills");
    // beforeEach 의 beta 포함 651개. listDirs slice(500) → readSkills 는 ≤500 dir 만 스캔.
    for (let i = 0; i < 650; i++) {
      const d = "sk" + String(i).padStart(4, "0");
      await mkdir(join(sbase, d), { recursive: true });
      await writeFile(join(sbase, d, "SKILL.md"), `---\nname: ${d}\ndescription: d\n---\nb\n`);
    }
    const skills = await readSkills(root);
    // 상한 미적용이면 651 전건 스캔. 상한(500)으로 잘려 무제한 스캔(CPU/IO/OOM) 차단.
    expect(skills.length).toBeLessThanOrEqual(500);
    expect(skills.length).toBeGreaterThan(0); // 완전 무력화 아님(정상 스캔 유지)
  });
});

// ── HIGH(agy#2) · CRLF 혼재 + MED(agy) NFC — canonicalizeDefinition ───────────
describe("HIGH/agy#2 · MED/agy — 개행/유니코드 정규화", () => {
  const c = (s: string, name = "alpha") => canonicalizeDefinition(s, "agent", name);
  it("CRLF 입력 → canonical 출력에 CR 없음(전체 LF 일관)", () => {
    const r = c("---\r\nname: alpha\r\ndescription: d\r\n---\r\n# body\r\nline2\r\n");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.canonical.includes("\r")).toBe(false);
      expect(r.canonical).toContain("# body\nline2");
    }
  });
  it("CRLF 입력 idempotent(재직렬화 안정)", () => {
    const r1 = c("---\r\nname: alpha\r\ndescription: d\r\n---\r\n# b\r\nx\r\n");
    expect(r1.ok).toBe(true);
    if (r1.ok) {
      const r2 = c(r1.canonical);
      expect(r2.ok).toBe(true);
      if (r2.ok) expect(r2.canonical).toBe(r1.canonical);
    }
  });
  it("NFD name(파일) vs NFC(:name) → name-changed 오거부 0", () => {
    // 'é' NFC(U+00E9) vs NFD(e + U+0301 결합). 파일=NFD, expectedName=NFC → 동일 취급.
    const nfd = "caf\u0065\u0301"; // e + combining acute
    const nfc = "caf\u00e9";        // precomposed é
    expect(nfd).not.toBe(nfc);      // 정규화 전 바이트상 다름
    const r = c(`---\nname: ${nfd}\ndescription: d\n---\nb\n`, nfc);
    expect(r.ok).toBe(true);        // NFC 정규화로 동일 → name-changed 아님
    if (r.ok) expect(r.normalized.name).toBe(nfc);
  });
  it("NFC name(파일) vs NFD(:name) 대칭 통과", () => {
    const nfd = "caf\u0065\u0301";
    const nfc = "caf\u00e9";
    const r = c(`---\nname: ${nfc}\ndescription: d\n---\nb\n`, nfd);
    expect(r.ok).toBe(true);
  });
  it("실제 리네임(다른 이름)은 여전히 400 name-changed", () => {
    const r = c("---\nname: renamed\ndescription: d\n---\nb\n", "alpha");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("name-changed");
  });
});

// ── MED(codex) · 동시 lost-update — 정의별 뮤텍스 ─────────────────────────────
describe.skipIf(process.platform === "win32")("MED/codex — 동시 두 PUT lost-update 0(하나만 성공·다른 하나 409)", () => {
  beforeEach(() => setGate(true));
  it("같은 baseHash 두 PUT 동시 → 정확히 하나 200, 다른 하나 409 stale-write", async () => {
    const pathId = sha(".claude/agents/alpha.md");
    const base = sha(AGENT_MD);
    const bodyA = { content: "---\nname: alpha\ndescription: A\n---\nb\n", baseHash: base, pathId };
    const bodyB = { content: "---\nname: alpha\ndescription: B\n---\nb\n", baseHash: base, pathId };
    const a = app();
    const [rA, rB] = await Promise.all([
      a.inject({ method: "PUT", url: "/api/agents/alpha/definition", payload: bodyA }),
      a.inject({ method: "PUT", url: "/api/agents/alpha/definition", payload: bodyB }),
    ]);
    const codes = [rA.statusCode, rB.statusCode].sort();
    expect(codes).toEqual([200, 409]);
    const loser = rA.statusCode === 409 ? rA : rB;
    expect(loser.json().error).toBe("stale-write");
    // 디스크는 승자 내용만(A 또는 B) — 혼재/유실 없음.
    const disk = await readFile(join(root, ".claude", "agents", "alpha.md"), "utf8");
    expect(disk.includes("description: A") || disk.includes("description: B")).toBe(true);
  });
});

// ── MED(codex) · 백업 dir 상위 세그먼트 심링크 → 거부 ─────────────────────────
describe("MED/codex — 백업 dir 경화(stateHome 심링크 거부)", () => {
  it("stateHome 이 심링크 → writeBackup throw(추종 차단)", async () => {
    const realTarget = await mkdtemp(join(tmpdir(), "hui-bkreal-"));
    const linkBase = await mkdtemp(join(tmpdir(), "hui-bklink-"));
    const linkHome = join(linkBase, "statelink");
    await symlink(realTarget, linkHome); // stateHome 자체가 심링크
    const prev = process.env.HARNESS_STATE_HOME;
    process.env.HARNESS_STATE_HOME = linkHome;
    try {
      await expect(writeBackup(".claude/agents/alpha.md", "content")).rejects.toThrow();
    } finally {
      process.env.HARNESS_STATE_HOME = prev;
      await rm(realTarget, { recursive: true, force: true });
      await rm(linkBase, { recursive: true, force: true });
    }
  });
  it("edit-backups 가 심링크 → writeBackup throw·밖 무변경", async () => {
    const outside = await mkdtemp(join(tmpdir(), "hui-bkout-"));
    await symlink(outside, join(stateDir, "edit-backups"));
    await expect(writeBackup(".claude/agents/alpha.md", "content")).rejects.toThrow();
    expect(await readdir(outside)).toEqual([]); // 밖으로 안 샘
    await rm(outside, { recursive: true, force: true });
  });
  it("정상 stateHome → 백업 정상 기록(회귀)", async () => {
    await writeBackup(".claude/agents/alpha.md", "backup-content");
    const bp = backupPathFor(".claude/agents/alpha.md");
    expect(await readFile(bp, "utf8")).toBe("backup-content");
  });
});
