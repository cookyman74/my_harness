// M12 F7 외부감사 R2(agy#1) — 크기상한 write≤read cap 불변식.
//   현황 결함: MAX_DEF_BYTES 가 read(readCappedDef)에만 적용 → canonical 출력이 cap 초과로 디스크에 써지면
//   이후 inventory readCappedDef 가 크기초과 skip → 해당 에이전트/스킬이 앱에서 영구 은폐(사라짐).
//   수정 검증: (a) 입력 조기 검사(파싱 前 DoS 차단) (b) canonical 출력 검사(write 前) (c) writeDefSafe 하드가드.
//   불변식: 디스크에 써지는 canonical 은 항상 ≤ MAX_DEF_BYTES = read cap → 은폐 불가.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, rm, readFile, readdir, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { buildServer } from "../src/server/index.js";
import {
  canonicalizeDefinition, writeDefSafe, safeDefPath, readDefSafe, backupPathFor, MAX_DEF_BYTES,
} from "../src/server/adapters/defedit.js";
import { readAgents } from "../src/server/adapters/harness.js";

const sha = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

let root: string;
let stateDir: string;
const origState = process.env.HARNESS_STATE_HOME;

const AGENT_MD = "---\nname: alpha\ndescription: alpha agent\ntools: Read, Grep\n---\n# body\nhello\n";
const SKILL_MD = "---\nname: beta\ndescription: beta skill\n---\n# skill body\n";
const SRC = ".claude/agents/alpha.md";

// 입력은 cap 이하지만 canonical 재직렬화가 cap 초과가 되는 content 생성.
//   passthrough 필드(name/description 는 Zod max 로 길이제한)에 리터럴 TAB 다수 → double-quoted 재직렬화가
//   `\t`(2byte) 로 이스케이프되어 ~2x 팽창. 입력 ~180KB(≤256KB) → canonical ~360KB(>256KB).
function inflatingContent(): string {
  const tabs = "\t".repeat(180000);
  return `---\nname: alpha\ndescription: d\nnotes: "${tabs}"\n---\nbody\n`;
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "hui-cap-"));
  stateDir = await mkdtemp(join(tmpdir(), "hui-capstate-"));
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
async function exists(p: string): Promise<boolean> { try { await access(p); return true; } catch { return false; } }

// ── (a) 입력 조기 검사 — canonicalizeDefinition 파싱 前 거부 ─────────────────────
describe("agy#1(a) — 입력 조기 크기검사(파싱 前 DoS 차단)", () => {
  it("입력 > MAX_DEF_BYTES → ok:false·too-large(파싱 안 함)", () => {
    const content = "---\nname: alpha\ndescription: d\n---\n" + "x".repeat(MAX_DEF_BYTES);
    expect(Buffer.byteLength(content, "utf8")).toBeGreaterThan(MAX_DEF_BYTES);
    const r = canonicalizeDefinition(content, "agent", "alpha");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("too-large");
  });
});

// ── (b) canonical 출력 검사(핵심) — 입력 ≤ cap · 재직렬화 > cap → write 前 거부 ────
describe("agy#1(b) — canonical 출력 크기검사(은폐 유발 write 차단)", () => {
  it("입력 ≤ cap 이나 canonical 재직렬화 > cap → ok:false·too-large", () => {
    const content = inflatingContent();
    expect(Buffer.byteLength(content, "utf8")).toBeLessThanOrEqual(MAX_DEF_BYTES); // 입력은 통과 크기
    const r = canonicalizeDefinition(content, "agent", "alpha");
    expect(r.ok).toBe(false); // 재직렬화가 cap 초과 → 거부(디스크 미기록)
    if (!r.ok) expect(r.error).toBe("too-large");
  });
});

// ── (c) writeDefSafe 하드가드 — 최하위 계층 write≤cap 물리 보증 ──────────────────
describe("agy#1(c) — writeDefSafe 하드가드(caller 우회 무관 불변식)", () => {
  it("content > cap → throw·디스크 무변경(원본 보존)", async () => {
    const big = "---\nname: alpha\ndescription: d\n---\n" + "x".repeat(MAX_DEF_BYTES);
    await expect(writeDefSafe(root, SRC, "agent", big)).rejects.toThrow();
    expect(await readFile(join(root, ".claude", "agents", "alpha.md"), "utf8")).toBe(AGENT_MD);
    // temp 잔재도 없음
    const files = await readdir(join(root, ".claude", "agents"));
    expect(files.some((f) => f.startsWith(".alpha.md.tmp"))).toBe(false);
  });
});

// ── 통합 PUT — 입력 too-large 조기 거부(경로검증 前 순서) ────────────────────────
describe.skipIf(process.platform === "win32")("agy#1 통합 — PUT 입력 > cap → 400 too-large(경로/해시 검증 前)", () => {
  beforeEach(() => setGate(true));
  it("bogus pathId 여도 too-large 먼저(조기 exit 순서 증명)·디스크 무변경", async () => {
    const content = "x".repeat(MAX_DEF_BYTES + 10);
    const res = await app().inject({
      method: "PUT", url: "/api/agents/alpha/definition",
      payload: { content, baseHash: "0".repeat(64), pathId: "0".repeat(64) },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("too-large"); // path-id-mismatch 아님 = 조기 검사
    expect(await readFile(join(root, ".claude", "agents", "alpha.md"), "utf8")).toBe(AGENT_MD);
  });
});

// ── 통합 PUT — canonical > cap → write 前 400·디스크/백업 미기록 ─────────────────
describe.skipIf(process.platform === "win32")("agy#1 통합 — PUT canonical > cap → 400 too-large(write 前·은폐 0)", () => {
  beforeEach(() => setGate(true));
  it("입력 ≤ cap·canonical > cap → 400·디스크 원본 유지·백업 미생성", async () => {
    const content = inflatingContent();
    expect(Buffer.byteLength(content, "utf8")).toBeLessThanOrEqual(MAX_DEF_BYTES);
    const res = await app().inject({
      method: "PUT", url: "/api/agents/alpha/definition",
      payload: { content, baseHash: sha(AGENT_MD), pathId: sha(SRC) },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("too-large");
    // 디스크 원본 그대로(canonical 미기록) — 은폐 유발 파일 생성 안 됨.
    expect(await readFile(join(root, ".claude", "agents", "alpha.md"), "utf8")).toBe(AGENT_MD);
    // 백업도 안 만들어짐(writeBackup 은 canonicalize 성공 後라 도달 안 함).
    expect(await exists(backupPathFor(SRC))).toBe(false);
  });
});

// ── 통합 PUT — 정상 크기 → write 후 read cap 재조회 성공(은폐 0) ─────────────────
describe.skipIf(process.platform === "win32")("agy#1 통합 — 정상 PUT 후 read cap 재조회(은폐 0)", () => {
  beforeEach(() => setGate(true));
  it("정상 편집 → 200·디스크 ≤ cap·readDefSafe/readAgents 재조회 성공", async () => {
    const next = "---\nname: alpha\ndescription: edited-ok\n---\n# body\nbye\n";
    const res = await app().inject({
      method: "PUT", url: "/api/agents/alpha/definition",
      payload: { content: next, baseHash: sha(AGENT_MD), pathId: sha(SRC) },
    });
    expect(res.statusCode).toBe(200);
    const abs = join(root, ".claude", "agents", "alpha.md");
    const disk = await readFile(abs, "utf8");
    expect(Buffer.byteLength(disk, "utf8")).toBeLessThanOrEqual(MAX_DEF_BYTES); // write ≤ read cap 불변식
    // read cap 리더로 재조회 — 크기초과 skip(null) 아님(은폐 0).
    const safeAbs = await safeDefPath(root, SRC, "agent");
    expect(safeAbs).not.toBeNull();
    expect(await readDefSafe(safeAbs!)).not.toBeNull();
    // inventory readCappedDef 경유 재조회 — alpha 가 여전히 목록에 존재(사라지지 않음).
    const agents = await readAgents(root);
    expect(agents.some((a) => a.name === "alpha")).toBe(true);
  });
});
