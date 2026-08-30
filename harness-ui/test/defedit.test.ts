// M12 F7 정의 편집기 — 서버 방어층 DW1~DW11 · A72~A80 통과/거부 스위트 · I8 예외 경계.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, rm, readFile, symlink, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { buildServer } from "../src/server/index.js";
import { makeSecurity } from "../src/server/security.js";
import { safeDefPath, canonicalizeDefinition, backupPathFor } from "../src/server/adapters/defedit.js";
import { loadConfigFromDisk } from "../src/server/lib/config.js";

const PORT = 5174;
const HOST = `127.0.0.1:${PORT}`;
const ORIGIN = `http://127.0.0.1:${PORT}`;
const sha = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

let root: string;      // projectRoot
let stateDir: string;  // <state_home>
const origState = process.env.HARNESS_STATE_HOME;

const AGENT_MD = "---\nname: alpha\ndescription: alpha agent\ntools: Read, Grep\n---\n# body\nhello\n";
const SKILL_MD = "---\nname: beta\ndescription: beta skill\n---\n# skill body\n";

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "hui-def-"));
  stateDir = await mkdtemp(join(tmpdir(), "hui-defstate-"));
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
async function getDef(seg: string, name: string) {
  return (await app().inject({ url: `/api/${seg}/${name}/definition` }));
}

// ── A72 · DW2 이름→정규 sourcePath 서버 재조회 ──────────────────────────────
describe("A72/DW2 — GET 정의 조회·이름→정규경로 재조회", () => {
  it("정상 agent → content+baseHash+pathId(sha256 sourcePath)+mtime+sourcePath", async () => {
    const r = await getDef("agents", "alpha");
    expect(r.statusCode).toBe(200);
    const b = r.json();
    expect(b.sourcePath).toBe(".claude/agents/alpha.md");
    expect(b.pathId).toBe(sha(".claude/agents/alpha.md"));
    expect(b.content).toBe(AGENT_MD);
    expect(b.baseHash).toBe(sha(AGENT_MD));
    expect(typeof b.mtimeMs).toBe("number");
    expect(b.editable).toBe(false); // 게이트 기본 off
  });
  it("정상 skill → 정규 sourcePath=.claude/skills/beta/SKILL.md", async () => {
    const b = (await getDef("skills", "beta")).json();
    expect(b.sourcePath).toBe(".claude/skills/beta/SKILL.md");
    expect(b.content).toBe(SKILL_MD);
  });
  it("editable 은 게이트 판독값 반영(on → true)", async () => {
    await setGate(true);
    expect((await getDef("agents", "alpha")).json().editable).toBe(true);
  });
  it("미존재 → 404", async () => {
    expect((await getDef("agents", "nope")).statusCode).toBe(404);
    expect((await getDef("skills", "nope")).statusCode).toBe(404);
  });
  it("중복 name 스킬 2개 → 409 ambiguous(dedupe 은폐 금지)", async () => {
    await mkdir(join(root, ".claude", "skills", "dup1"), { recursive: true });
    await mkdir(join(root, ".claude", "skills", "dup2"), { recursive: true });
    await writeFile(join(root, ".claude", "skills", "dup1", "SKILL.md"), "---\nname: dup\ndescription: a\n---\nx\n");
    await writeFile(join(root, ".claude", "skills", "dup2", "SKILL.md"), "---\nname: dup\ndescription: b\n---\ny\n");
    const r = await getDef("skills", "dup");
    expect(r.statusCode).toBe(409);
    expect(r.json().error).toBe("ambiguous-definition");
  });
  it(".agents 전용 스킬(SKILL.md·md) → M-c(F14): 편집 가능(200·codex-only-v0.7 아님)", async () => {
    await mkdir(join(root, ".agents", "skills", "cx"), { recursive: true });
    await writeFile(join(root, ".agents", "skills", "cx", "SKILL.md"), "---\nname: cxonly\ndescription: c\n---\nz\n");
    const r = await getDef("skills", "cxonly");
    expect(r.statusCode).toBe(200); // .agents/skills 는 SKILL.md(md) → M-c서 편집 개방
    expect(r.json().sourcePath).toBe(".agents/skills/cx/SKILL.md");
  });
  it("codex agent(.codex/*.toml) → M-e(F15) 편집 가능·200 resolve", async () => {
    await mkdir(join(root, ".codex", "agents"), { recursive: true });
    await writeFile(join(root, ".codex", "agents", "cxa.toml"), 'name = "cxagent"\ndescription = "d"\n');
    const r = await getDef("agents", "cxagent");
    expect(r.statusCode).toBe(200);
    expect(r.json().sourcePath).toBe(".codex/agents/cxa.toml");
  });
});

// ── A78 · DW1/DW8 게이트 노브 + 매 요청 판독 ────────────────────────────────
describe("A78/DW1 — 게이트 노브(fail-closed)", () => {
  async function put(name: string, body: unknown) {
    return app().inject({ method: "PUT", url: `/api/agents/${name}/definition`, payload: body as object });
  }
  it("게이트 off → PUT 403 edit-disabled", async () => {
    const r = await put("alpha", { content: AGENT_MD, baseHash: sha(AGENT_MD), pathId: sha(".claude/agents/alpha.md") });
    expect(r.statusCode).toBe(403);
    expect(r.json().error).toBe("edit-disabled");
  });
  it("손상 config → fail-closed 403", async () => {
    await writeFile(join(stateDir, "config.json"), "{ not json", "utf8");
    const r = await put("alpha", { content: AGENT_MD, baseHash: sha(AGENT_MD), pathId: sha(".claude/agents/alpha.md") });
    expect(r.statusCode).toBe(403);
  });
  it("POST definition-edit {enabled:true} → 게이트 on·이후 PUT 허용", async () => {
    const t = await app().inject({ method: "POST", url: "/api/settings/definition-edit", payload: { enabled: true } });
    expect(t.statusCode).toBe(200);
    expect(t.json().definitionEditEnabled).toBe(true);
    expect((await loadConfigFromDisk()).definitionEditEnabled).toBe(true); // 재시작 지속
  });
  it("definition-edit non-boolean → 400", async () => {
    const r = await app().inject({ method: "POST", url: "/api/settings/definition-edit", payload: { enabled: "yes" } });
    expect(r.statusCode).toBe(400);
  });
  it("definition-edit 미지 필드 → 400(strict)", async () => {
    const r = await app().inject({ method: "POST", url: "/api/settings/definition-edit", payload: { enabled: true, evil: 1 } });
    expect(r.statusCode).toBe(400);
  });
  it("토글이 타 필드 clobber 안 함(projectRoot/evals 보존·RMW)", async () => {
    await writeFile(join(stateDir, "config.json"),
      JSON.stringify({ schemaVersion: "1", projectRoot: "/x/y", evals: { threshold: 3, custom: "keep" }, definitionEditEnabled: false }), "utf8");
    await app().inject({ method: "POST", url: "/api/settings/definition-edit", payload: { enabled: true } });
    const disk = await loadConfigFromDisk();
    expect(disk.definitionEditEnabled).toBe(true);
    expect(disk.projectRoot).toBe("/x/y");
    expect(disk.evals).toEqual({ threshold: 3, custom: "keep" });
  });
  it("Origin 위조 → 403(security 게이트)", async () => {
    const sec = makeSecurity(PORT);
    const gated = buildServer({ security: sec, projectRoot: root });
    const r = await gated.inject({
      method: "POST", url: "/api/settings/definition-edit",
      headers: { host: HOST, origin: "http://evil.com", authorization: `Bearer ${sec.session}` },
      payload: { enabled: true },
    });
    expect(r.statusCode).toBe(403);
    const ok = await gated.inject({
      method: "PUT", url: "/api/agents/alpha/definition",
      headers: { host: HOST, origin: ORIGIN, authorization: `Bearer ${sec.session}` },
      payload: { content: AGENT_MD, baseHash: sha(AGENT_MD), pathId: sha(".claude/agents/alpha.md") },
    });
    expect(ok.statusCode).toBe(403); // 게이트 off 이므로 edit-disabled(Origin 통과했으나 DW1)
    expect(ok.json().error).toBe("edit-disabled");
  });
});

// ── A76 · DW6 낙관적 동시성 + A74 원자 쓰기 + A79 편집≠실행 ───────────────────
describe.skipIf(process.platform === "win32")("A76/DW6 — 낙관적 동시성·저장", () => {
  beforeEach(() => setGate(true));
  const pathId = () => sha(".claude/agents/alpha.md");
  async function put(body: unknown) {
    return app().inject({ method: "PUT", url: "/api/agents/alpha/definition", payload: body as object });
  }
  it("정상 baseHash+pathId → 저장 성공·prevHash·디스크 반영", async () => {
    const edited = "---\nname: alpha\ndescription: edited desc\ntools: Read\n---\n# body\nhello\n";
    const r = await put({ content: edited, baseHash: sha(AGENT_MD), pathId: pathId() });
    expect(r.statusCode).toBe(200);
    const b = r.json();
    expect(b.ok).toBe(true);
    expect(b.prevHash).toBe(sha(AGENT_MD));
    expect(b.codexDriftWarning).toBe(true);
    const disk = await readFile(join(root, ".claude", "agents", "alpha.md"), "utf8");
    expect(disk).toContain("description: edited desc");
    expect(sha(disk)).toBe(b.newHash);
  });
  it("stale baseHash → 409 stale-write·디스크 무변경", async () => {
    const r = await put({ content: AGENT_MD, baseHash: sha("stale"), pathId: pathId() });
    expect(r.statusCode).toBe(409);
    expect(r.json().error).toBe("stale-write");
    expect(await readFile(join(root, ".claude", "agents", "alpha.md"), "utf8")).toBe(AGENT_MD);
  });
  it("pathId 불일치 → 409 path-id-mismatch", async () => {
    const r = await put({ content: AGENT_MD, baseHash: sha(AGENT_MD), pathId: sha("wrong") });
    expect(r.statusCode).toBe(409);
    expect(r.json().error).toBe("path-id-mismatch");
  });
  it("저장이 run 트리거 안 함(_workspace/runs 미생성·DW9)", async () => {
    await put({ content: AGENT_MD, baseHash: sha(AGENT_MD), pathId: pathId() });
    let created = false;
    try { await stat(join(root, "_workspace", "runs")); created = true; } catch { /* 없음 */ }
    expect(created).toBe(false);
  });
});

// ── A75 · DW5 무결성 + 정규화 (ACCEPT / REJECT) ─────────────────────────────
describe("A75/DW5 — 무결성 (canonicalizeDefinition 단위)", () => {
  const c = (content: string, name = "alpha") => canonicalizeDefinition(content, "agent", name);
  it("ACCEPT: 옵션필드·본문 `---`·passthrough 미지필드·CRLF·유니코드 보존", async () => {
    const src = "---\r\nname: alpha\r\ndescription: 유니코드 설명 ★\r\nrole: worker\r\ncustomX: keepme\r\n---\r\n# 본문\r\n---\r\n수평선 위 무해\r\n```yaml\nkey: val\n```\n";
    const r = c(src);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.normalized.customX).toBe("keepme"); // passthrough 보존
      expect(r.normalized.role).toBe("worker");
      expect(r.canonical).toContain("수평선 위 무해"); // 본문 `---` 보존
      expect(r.canonical).toContain("customX: keepme");
    }
  });
  it("REJECT: name 누락", () => { expect(c("---\ndescription: x\n---\nb\n").ok).toBe(false); });
  it("REJECT: description 누락", () => { expect(c("---\nname: alpha\n---\nb\n").ok).toBe(false); });
  it("REJECT: name 리네임(:name 불일치)", () => {
    const r = c("---\nname: renamed\ndescription: x\n---\nb\n", "alpha");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("name-changed");
  });
  it("ACCEPT: 본문 `---`·후행 frontmatter 유사 블록은 본문(첫 쌍만 추출·무해)", () => {
    // frontmatter 는 첫 `---`~다음 `---` 쌍만. 이후 `---` 는 전부 본문 → 폴리글롯/멀티도큐 오염 벡터 차단.
    const r = c("---\nname: alpha\ndescription: x\n---\nbody line\n---\nname: two\n---\nmore\n");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.canonical).toContain("name: two"); // 본문에 그대로 보존(frontmatter 아님)
  });
  it("REJECT: YAML 앵커/alias", () => {
    const r = c("---\nname: &a alpha\ndescription: *a\n---\nb\n");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("anchor-alias");
  });
  it("REJECT: 중복 키", () => {
    const r = c("---\nname: alpha\nname: alpha2\ndescription: x\n---\nb\n");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("duplicate-key");
  });
  it("REJECT: 명시 태그 `!!str`", () => {
    const r = c("---\nname: !!str alpha\ndescription: x\n---\nb\n");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("explicit-tag");
  });
  it("REJECT: 커스텀 태그 `!secret`", () => {
    expect(c("---\nname: alpha\ndescription: !secret x\n---\nb\n").ok).toBe(false);
  });
  it("REJECT: frontmatter 없음", () => { expect(c("no frontmatter here\n").ok).toBe(false); });
  it("REJECT: 빈 본문", () => { expect(c("---\nname: alpha\ndescription: x\n---\n").ok).toBe(false); });
  it("canonical 재직렬화 idempotent(A75 게이트)", () => {
    const r1 = c(AGENT_MD);
    expect(r1.ok).toBe(true);
    if (r1.ok) {
      const r2 = canonicalizeDefinition(r1.canonical, "agent", "alpha");
      expect(r2.ok).toBe(true);
      if (r2.ok) expect(r2.canonical).toBe(r1.canonical); // 재직렬화본 재파싱 = 동일 canonical
    }
  });
});

describe.skipIf(process.platform === "win32")("A75/DW5 — PUT 통합 REJECT(무결성 400·디스크 무변경)", () => {
  beforeEach(() => setGate(true));
  async function put(content: string) {
    // baseHash 정확히 맞춰 stale-write 아닌 integrity 400 도달 보장
    return app().inject({
      method: "PUT", url: "/api/agents/alpha/definition",
      payload: { content, baseHash: sha(AGENT_MD), pathId: sha(".claude/agents/alpha.md") },
    });
  }
  it("앵커 정의 저장 → 400 integrity·디스크 무변경", async () => {
    const r = await put("---\nname: &a alpha\ndescription: *a\n---\nb\n");
    expect(r.statusCode).toBe(400);
    expect(r.json().error).toBe("integrity");
    expect(await readFile(join(root, ".claude", "agents", "alpha.md"), "utf8")).toBe(AGENT_MD);
  });
  it("초과 크기 → 400 too-large", async () => {
    const huge = "---\nname: alpha\ndescription: x\n---\n" + "y".repeat(300 * 1024);
    const r = await put(huge);
    expect(r.statusCode).toBe(400);
    expect(r.json().error).toBe("too-large");
  });
});

// ── DW11 evalProposal fail-closed ──────────────────────────────────────────
describe.skipIf(process.platform === "win32")("DW11 — evalProposal", () => {
  beforeEach(() => setGate(true));
  it("evalProposal 존재 → 409 proposal-not-available(무음 일반편집 금지)", async () => {
    const r = await app().inject({
      method: "PUT", url: "/api/agents/alpha/definition",
      payload: { content: AGENT_MD, baseHash: sha(AGENT_MD), pathId: sha(".claude/agents/alpha.md"), evalProposal: { nonce: "n1", envelope: { x: 1 } } },
    });
    expect(r.statusCode).toBe(409);
    expect(r.json().error).toBe("proposal-not-available");
  });
  it("evalProposal 부재 → 일반 편집 정상", async () => {
    const r = await app().inject({
      method: "PUT", url: "/api/agents/alpha/definition",
      payload: { content: AGENT_MD, baseHash: sha(AGENT_MD), pathId: sha(".claude/agents/alpha.md") },
    });
    expect(r.statusCode).toBe(200);
  });
});

// ── A77 · DW7 되돌리기·백업 ─────────────────────────────────────────────────
describe.skipIf(process.platform === "win32")("A77/DW7 — rollback·백업", () => {
  beforeEach(() => setGate(true));
  const pathId = sha(".claude/agents/alpha.md");
  async function put(content: string, baseHash: string) {
    return app().inject({ method: "PUT", url: "/api/agents/alpha/definition", payload: { content, baseHash, pathId } });
  }
  async function rollback(body: unknown) {
    return app().inject({ method: "POST", url: "/api/agents/alpha/definition/rollback", payload: body as object });
  }
  it("정상 rollback → 직전 내용 복원·백업 opaque 파일명", async () => {
    const edited = "---\nname: alpha\ndescription: v2\n---\n# body\nhello\n";
    const putR = (await put(edited, sha(AGENT_MD))).json();
    // 백업 파일명 = opaque sha256(sourcePath).bak(논리 name 미포함)
    const bp = backupPathFor(".claude/agents/alpha.md");
    expect(bp.endsWith(sha(".claude/agents/alpha.md") + ".bak")).toBe(true);
    expect(await stat(bp)).toBeTruthy();
    // 현재 디스크 해시 = putR.newHash, 백업 해시 = 원본 canonical(AGENT_MD canonical)
    const backupCanon = canonicalizeDefinition(AGENT_MD, "agent", "alpha");
    expect(backupCanon.ok).toBe(true);
    const r = await rollback({ expectedCurrentHash: putR.newHash, backupHash: sha(AGENT_MD) });
    expect(r.statusCode).toBe(200);
    const disk = await readFile(join(root, ".claude", "agents", "alpha.md"), "utf8");
    expect(disk).toContain("description: alpha agent"); // 원복
  });
  it("stale rollback(expectedCurrentHash 불일치) → 409 stale-rollback", async () => {
    await put("---\nname: alpha\ndescription: v2\n---\nb\n", sha(AGENT_MD));
    const r = await rollback({ expectedCurrentHash: sha("bogus"), backupHash: sha(AGENT_MD) });
    expect(r.statusCode).toBe(409);
    expect(r.json().error).toBe("stale-rollback");
  });
  it("backupHash 변조/불일치 → 409 backup-hash-mismatch", async () => {
    const putR = (await put("---\nname: alpha\ndescription: v2\n---\nb\n", sha(AGENT_MD))).json();
    const r = await rollback({ expectedCurrentHash: putR.newHash, backupHash: sha("tampered") });
    expect(r.statusCode).toBe(409);
    expect(r.json().error).toBe("backup-hash-mismatch");
  });
  it("백업 없음 → 404 no-backup", async () => {
    const cur = (await getDef("agents", "alpha")).json();
    const r = await rollback({ expectedCurrentHash: cur.baseHash, backupHash: sha(AGENT_MD) });
    expect(r.statusCode).toBe(404);
    expect(r.json().error).toBe("no-backup");
  });
  it("rollback 게이트 off → 403", async () => {
    await setGate(false);
    const r = await rollback({ expectedCurrentHash: sha(AGENT_MD), backupHash: sha(AGENT_MD) });
    expect(r.statusCode).toBe(403);
  });
});

// ── A73 · DW3 쓰기 경로탈출 (safeDefPath 단위) ──────────────────────────────
describe("A73/DW3 — safeDefPath 경로탈출 방어", () => {
  it("정상 agent 경로 → abs 반환", async () => {
    const p = await safeDefPath(root, ".claude/agents/alpha.md", "agent");
    expect(p).not.toBeNull();
  });
  it("정상 skill 경로 → abs 반환", async () => {
    const p = await safeDefPath(root, ".claude/skills/beta/SKILL.md", "skill");
    expect(p).not.toBeNull();
  });
  it("`..` 세그먼트 → null", async () => {
    expect(await safeDefPath(root, ".claude/../etc/passwd", "agent")).toBeNull();
  });
  it("화이트리스트 밖 확장자(.txt) → null", async () => {
    await writeFile(join(root, ".claude", "agents", "x.txt"), "x");
    expect(await safeDefPath(root, ".claude/agents/x.txt", "agent")).toBeNull();
  });
  it(".claude 밖 위치 → null", async () => {
    await mkdir(join(root, "docs"), { recursive: true });
    await writeFile(join(root, "docs", "a.md"), "x");
    expect(await safeDefPath(root, "docs/a.md", "agent")).toBeNull();
  });
  it("skill 위치를 agents 로 위장 → null(구조 화이트리스트)", async () => {
    expect(await safeDefPath(root, ".claude/agents/beta/SKILL.md", "agent")).toBeNull();
  });
  it("심링크 leaf → null(write-through-symlink 불가)", async () => {
    const target = join(stateDir, "outside.md");
    await writeFile(target, "---\nname: evil\ndescription: e\n---\nx\n");
    await symlink(target, join(root, ".claude", "agents", "link.md"));
    expect(await safeDefPath(root, ".claude/agents/link.md", "agent")).toBeNull();
  });
  it("심링크 중간 디렉토리 → null", async () => {
    const outside = await mkdtemp(join(tmpdir(), "hui-out-"));
    await symlink(outside, join(root, ".claude", "skills", "linkdir"));
    expect(await safeDefPath(root, ".claude/skills/linkdir/SKILL.md", "skill")).toBeNull();
    await rm(outside, { recursive: true, force: true });
  });
});

// ── DoD · I8 예외 경계 회귀 ─────────────────────────────────────────────────
describe("DoD/I8 — 예외 경계 회귀", () => {
  it("docs API 는 여전히 읽기전용(PUT/POST 라우트 없음 → 404)", async () => {
    const r = await app().inject({ method: "PUT", url: "/api/docs/x.md", payload: { content: "hack" } });
    expect(r.statusCode).toBe(404); // 편집 라우트 부재(F5 read-only 불변)
  });
  it("편집 대상은 .claude/agents·.claude/skills 밖으로 새지 않음(safeDefPath 거부)", async () => {
    expect(await safeDefPath(root, "CLAUDE.md", "agent")).toBeNull();
    expect(await safeDefPath(root, ".codex/agents/x.toml", "agent")).toBeNull();
  });
});
