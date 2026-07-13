// F7(M12) 정의 편집기 — 서버 방어층 DW1~DW11. I8 읽기전용 원칙의 유일 예외(`.claude` 정의 편집만).
// 최대 공격면·중대. 모든 실패는 fail-closed(400/403/409)·디스크 무변경. 기존 프리미티브 재사용:
//   writeAtomic(atomic.ts)·isSafeSegment/isWithinRoot/stateHome(paths.ts)·parseFrontmatter/resolve*(harness.ts).
import { constants } from "node:fs";
import { open, lstat, realpath, rename, rm, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { createHash } from "node:crypto";
import { parseAllDocuments, visit, stringify } from "yaml";
import { z } from "zod";
import { isSafeSegment, isWithinRoot, stateHome } from "../lib/paths.js";
import { writeAtomic } from "../lib/atomic.js";
import { parseFrontmatter } from "./harness.js";
import { editableMdAgentDirs, editableSkillDirs } from "./runtimes.js";

// F14(M-c·I11 validator 결정): Gemini 에이전트/스킬은 Claude와 **동일 md+YAML frontmatter 컨테이너·동일 canonicalizer/validator**를
//   의도적으로 재사용한다(선검증: 코어 필드 name·description 공통·미지 필드 보존). 런타임 전용 스키마 분리는 미지 필드
//   보존이라 보안 fail-open 아님(런타임 로드 시 fail-closed) — 실 필드 차이가 드러나면 후속서 validator registry 분리.
// F14(M-c): 구조 화이트리스트 = 레지스트리의 편집 가능 md 정의 경로. 리터럴 dot-dir 만(traversal 불가).
//   agent: <editable-md-agent-dir>/*.md · skill: <editable-skill-dir>/*/SKILL.md. (Codex toml=M-e·제외)
function structOk(segs: string[], kind: DefKind): boolean {
  if (kind === "agent") {
    return segs.length === 3 && editableMdAgentDirs().includes(segs[0] + "/" + segs[1]) && segs[2]!.endsWith(".md");
  }
  return segs.length === 4 && editableSkillDirs().includes(segs[0] + "/" + segs[1]) && segs[3] === "SKILL.md";
}

// 정의 파일당 크기 상한(256KB·OOM 방어·harness.readCappedDef 정합).
export const MAX_DEF_BYTES = 262144;

export type DefKind = "agent" | "skill";

export function sha256(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

// --- DW5 무결성 + 정규화 (strict YAML → Zod → canonical 재직렬화 + reader-parse 게이트) --------
// 완전 frontmatter 스키마: name·description 필수 strict + 옵션필드 + .passthrough()(미지필드 보존).
// name 은 caller 가 :name 과 === 로 불변 검증(리네임 금지). role/tools/skills/model/triggers/references 는
// 문자열·리스트 등 형태가 정의마다 달라 z.unknown() 으로 관용 수용(passthrough 로 어차피 보존·오차단 금지).
const AgentFm = z.object({
  name: z.string().min(1).max(120),
  description: z.string().min(1).max(2000),
  role: z.unknown().optional(),
  tools: z.unknown().optional(),
  skills: z.unknown().optional(),
  model: z.unknown().optional(),
}).passthrough();
const SkillFm = z.object({
  name: z.string().min(1).max(120),
  description: z.string().min(1).max(2000),
  triggers: z.unknown().optional(),
  references: z.unknown().optional(),
}).passthrough();

// frontmatter 고정 추출: 첫 `---`~다음 `---` 쌍(harness.ts 리더와 동일 non-greedy 첫쌍). 본문(닫는 `---` 이후)
// 의 `---`(수평선·코드펜스) 은 무해(캡처 대상 아님). BOM 제거.
const FM_RE = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;

export type CanonResult =
  | { ok: true; canonical: string; normalized: Record<string, unknown> }
  | { ok: false; error: string };

// content → (추출·strict YAML·Zod·name 불변·canonical 재직렬화·reader-parse 등가). 실패 = 400 매핑 error.
// polyglot/멀티도큐/앵커/alias/중복키/`!!tag` 는 strict 파서·visit 로 거부. passthrough 필드는 canonical
// 에 그대로 보존(유실 0). 재직렬화본을 앱 실제 리더(parseFrontmatter)로 파싱해 name/description 이 동일한지
// 검증(A75 idempotence+리더 파싱 게이트 — 외부 런타임 파서 등가는 검증 불가·residual risk 문서화).
export function canonicalizeDefinition(content: string, kind: DefKind, expectedName: string): CanonResult {
  // agy#1(HIGH\u00B7\uD06C\uAE30\uC0C1\uD55C): \uC785\uB825 \uC870\uAE30 \uAC80\uC0AC \u2014 \uD30C\uC2F1 \u524D byte \uC0C1\uD55C \uCD08\uACFC \uAC70\uBD80(\uAC70\uB300 \uC785\uB825 YAML \uD30C\uC2F1 CPU/\uBA54\uBAA8\uB9AC DoS \uCC28\uB2E8).
  //   handler \uC9C4\uC785\uBD80 \uAC80\uC0AC\uC640 \uC774\uC911\uBC29\uC5B4(\uB77C\uC774\uBE0C\uB7EC\uB9AC \uB808\uBCA8 \uBCF4\uC99D \u2014 rollback \uB4F1 \uBAA8\uB4E0 caller \uCEE4\uBC84).
  if (Buffer.byteLength(content, "utf8") > MAX_DEF_BYTES) return { ok: false, error: "too-large" };
  // BOM \uC81C\uAC70 \u2192 \uAC1C\uD589 \uC77C\uAD00 \uC815\uADDC\uD654(CRLF/lone-CR \u2192 LF) \u2192 \uC720\uB2C8\uCF54\uB4DC NFC.
  //   agy#2(R1 HIGH\u00B7CRLF \uD63C\uC7AC): \uC798\uB77C\uB0B8 body \uC758 \uC6D0\uBCF8 `\r\n` \uC774 yaml.stringify(`\n`) frontmatter \uC640 \uC11E\uC5EC
  //     non-canonical \uD30C\uC77C\uC774 \uB418\uB358 \uBB38\uC81C \u2192 \uC804\uCCB4 \uAC1C\uD589\uC744 `\n` \uC73C\uB85C \uD1B5\uC77C(body \uD3EC\uD568). \uC7AC\uD30C\uC2F1 \uC548\uC815(idempotent).
  //   agy(R1 MED\u00B7NFC): macOS NFD \uD30C\uC77C\uBA85\uC774 NFC name \uACFC \uC5B5\uC6B8\uD55C `name-changed` 400 \uC744 \uB0B4\uC9C0 \uC54A\uB3C4\uB85D \uC804\uCCB4\uB97C NFC \uB85C.
  //     NFC \uB294 \uBA71\uB4F1(NFC\u2218NFC=NFC)\uC774\uB77C idempotence \uAC8C\uC774\uD2B8 \uBD88\uBCC0.
  const text = content.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").normalize("NFC");
  const m = text.match(FM_RE);
  if (!m) return { ok: false, error: "no-frontmatter" };
  const fmText = m[1]!;
  const body = text.slice(m[0].length);

  let docs;
  try { docs = parseAllDocuments(fmText, { strict: true, uniqueKeys: true, merge: false }); }
  catch { return { ok: false, error: "yaml-parse" }; }
  if (docs.length === 0) return { ok: false, error: "empty-frontmatter" };
  if (docs.length > 1) return { ok: false, error: "multi-document" };
  const doc = docs[0]!;
  if (doc.errors.length > 0) {
    return { ok: false, error: doc.errors.some((e) => e.code === "DUPLICATE_KEY") ? "duplicate-key" : "yaml-parse" };
  }
  // 앵커/alias/명시태그(`!!str`·`!custom`) 거부 — polyglot/재정의 벡터 차단.
  let bad: string | null = null;
  visit(doc, {
    Alias() { if (!bad) bad = "anchor-alias"; },
    // eslint 무시: yaml Node 는 anchor?/tag? 를 노출.
    Node(_key, node) {
      const n = node as { anchor?: string; tag?: string };
      if (n.anchor && !bad) bad = "anchor-alias";
      if (n.tag && !bad) bad = "explicit-tag";
    },
  });
  if (bad) return { ok: false, error: bad };

  const js = doc.toJS();
  if (js === null || typeof js !== "object" || Array.isArray(js)) return { ok: false, error: "not-a-map" };

  const schema = kind === "agent" ? AgentFm : SkillFm;
  const parsed = schema.safeParse(js);
  if (!parsed.success) {
    const miss = parsed.error.issues.find((i) => i.path.length === 1);
    return { ok: false, error: miss ? `field:${String(miss.path[0])}` : "schema" };
  }
  const data = parsed.data as Record<string, unknown>;
  // 리네임 금지(DW5). data.name 은 이미 NFC(전체 정규화)·expectedName(:name URL)도 NFC 로 맞춰 비교 →
  //   NFD/NFC 동일 이름 오거부(name-changed 400) 방지(agy R1 MED).
  if (data.name !== expectedName.normalize("NFC")) return { ok: false, error: "name-changed" };
  if (body.trim().length === 0) return { ok: false, error: "empty-body" };

  // canonical 재직렬화(passthrough 포함). lineWidth:0 = 폴딩 금지(단일라인 유지 → 리더 등가·멱등 보장).
  const canonFm = stringify(data, { lineWidth: 0 });
  const canonical = "---\n" + canonFm + "---\n" + body;

  // agy#1(HIGH·핵심): canonical 출력 크기 검사 — 재직렬화 결과가 read cap 을 넘으면 write 前 거부.
  //   불변식 확립: 디스크에 써지는 canonical 은 항상 ≤ MAX_DEF_BYTES = readCappedDef/readDefSafe 상한.
  //   → write ≤ read cap 보장 → 써진 파일이 이후 inventory read 에서 크기초과로 skip 되어 영구 은폐되는
  //   치명 논리결함(에이전트/스킬이 앱에서 사라짐) 원천 차단.
  if (Buffer.byteLength(canonical, "utf8") > MAX_DEF_BYTES) return { ok: false, error: "too-large" };

  // A75 reader-parse 게이트: 앱 실제 리더로 canonical frontmatter 를 파싱 → name/description 동일 검증.
  const rd = parseFrontmatter("---\n" + canonFm + "---\n");
  if (rd.name !== data.name) return { ok: false, error: "reader-divergence" };
  if (typeof data.description === "string" && rd.description !== data.description) {
    return { ok: false, error: "reader-divergence" };
  }
  return { ok: true, canonical, normalized: data };
}

// --- DW3 쓰기 경로탈출 방어 (projectRoot realpath 앵커·하위 세그먼트 심링크 거부·화이트리스트) ------
// server-derived sourcePath(`.claude/agents/*.md`·`.claude/skills/*/SKILL.md`) 만 통과. 클라 경로 금지.
export async function safeDefPath(root: string, sourcePath: string, kind: DefKind): Promise<string | null> {
  const segs = sourcePath.split("/");
  // 구조 화이트리스트(레지스트리 편집 가능 경로·claude+gemini md·이중방어).
  if (!structOk(segs, kind)) return null;
  for (const s of segs) if (!isSafeSegment(s)) return null; // 빈/`.`/`..`/메타 거부
  let realRoot: string;
  try { realRoot = await realpath(root); } catch { return null; }
  // `.claude` 하위 전 세그먼트 lstat 심링크/비디렉토리 거부(I6 통일). leaf 는 정규파일이어야 함(편집 대상 실재).
  let acc = realRoot;
  for (let i = 0; i < segs.length; i++) {
    acc = join(acc, segs[i]!);
    let l;
    try { l = await lstat(acc); } catch { return null; } // 중간/leaf 부재 = 거부(fail-closed)
    if (l.isSymbolicLink()) return null;
    if (i < segs.length - 1 ? !l.isDirectory() : !l.isFile()) return null;
  }
  if (!isWithinRoot(realRoot, acc)) return null; // containment 재확인(비-심링크 세그먼트만 누적했으므로 항상 참·이중방어)
  return acc;
}

// leaf O_NOFOLLOW + 크기캡 read(심링크 대상 read 거부·OOM 방어). 부재/비정규/초과/심링크 = null.
export async function readDefSafe(abs: string): Promise<{ content: string; mtimeMs: number } | null> {
  let fh;
  try { fh = await open(abs, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0)); }
  catch { return null; }
  try {
    const st = await fh.stat();
    if (!st.isFile() || st.size > MAX_DEF_BYTES) return null;
    const buf = Buffer.alloc(Number(st.size));
    let bytesRead = 0;
    if (buf.length > 0) ({ bytesRead } = await fh.read(buf, 0, buf.length, 0));
    return { content: buf.toString("utf8", 0, bytesRead), mtimeMs: st.mtimeMs };
  } catch { return null; }
  finally { await fh.close().catch(() => {}); }
}

// --- 쓰기 임계구역 직렬화 (MED codex · 정의별 in-process 뮤텍스) --------------------------------
// read-hash-backup-write 를 정의(sourcePath)별 단일 임계구역으로 직렬화 → 같은 baseHash 동시 두 PUT 중
//   하나만 성공, 다른 하나는 재-read 로 stale 감지(409). config.withConfigLock 패턴을 키별로 확장(신규
//   락 라이브러리 발명 금지 — 동일 promise-chain 관용구). cross-process 동시성은 out-of-scope(로컬 단일사용자).
const defLocks = new Map<string, Promise<unknown>>();
export function withDefLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = defLocks.get(key) ?? Promise.resolve();
  const run = prev.then(fn, fn); // 이전 실패와 무관하게 진행(체인 끊김 방지)
  defLocks.set(key, run.catch(() => {}));
  return run;
}

// --- DW3/DW4 경화 원자쓰기 (`.claude` 정의 전용 — 검증↔쓰기 TOCTOU 창 폐쇄) ------------------------
// HIGH(codex·쓰기 TOCTOU): safeDefPath 검증 후 writeAtomic 직전 중간 dir 가 심링크로 스왑되면 temp/rename 이
//   `.claude` 밖으로 샐 수 있었다. 본 헬퍼는 write 직전 부모 체인을 **재검증**(전 세그먼트 lstat 심링크 거부 +
//   realpath containment)하고, temp 생성 후 rename 직전 부모 realpath·dev/ino 동일성을 **재확인**(스왑 감지
//   시 temp 삭제·fail-closed). Node 는 openat 미노출이라 pre/post realpath+dev/ino 재검증으로 앵커
//   (M8 servefile TOCTOU 패턴 준용). rename 은 심링크 leaf 를 추종하지 않아 write-through-symlink 불가.
let defWriteCounter = 0;
export async function writeDefSafe(root: string, sourcePath: string, kind: DefKind, content: string): Promise<void> {
  // F14(M-c·§8-2): Windows mutation 기본 차단 — O_NOFOLLOW·심링크·POSIX 경로안전이 Windows서 무의미/오작동.
  //   safePathWindows 증명 전 write 강행 금지(design §8-2·A184 platform matrix). 읽기는 무영향.
  if (process.platform === "win32") throw new Error("unsupported-platform-write");
  // agy#1(HIGH·불변식 하드가드): 최하위 계층에서 write ≤ read cap 을 물리 보증 — caller 우회·회귀와 무관하게
  //   MAX_DEF_BYTES 초과분은 절대 디스크에 기록되지 않음(은폐 유발 파일 생성 원천 봉쇄).
  if (Buffer.byteLength(content, "utf8") > MAX_DEF_BYTES) throw new Error("too-large");
  const segs = sourcePath.split("/");
  // 구조 화이트리스트(structOk·레지스트리 편집 가능 경로·이중방어). 위반 = fail-closed.
  if (!structOk(segs, kind)) throw new Error("path-unsafe");
  for (const s of segs) if (!isSafeSegment(s)) throw new Error("path-unsafe");
  let realRoot: string;
  try { realRoot = await realpath(root); } catch { throw new Error("path-unsafe"); }

  // 부모 체인(leaf 제외) 재검증: 전 세그먼트 lstat 심링크/비디렉토리 거부 + dev/ino 포착(post 재확인용).
  const parentSegs = segs.slice(0, -1);
  const pre: { path: string; dev: number; ino: number }[] = [];
  let acc = realRoot;
  for (const s of parentSegs) {
    acc = join(acc, s);
    const l = await lstat(acc).catch(() => null);
    if (!l || l.isSymbolicLink() || !l.isDirectory()) throw new Error("parent-swap");
    pre.push({ path: acc, dev: l.dev, ino: l.ino });
  }
  const parentDir = acc; // 비-심링크만 누적한 검증된 부모 dir
  const abs = join(parentDir, segs[segs.length - 1]!);
  const realParent = await realpath(parentDir).catch(() => null);
  if (!realParent || !isWithinRoot(realRoot, realParent)) throw new Error("parent-escape");

  // temp 를 검증된 부모 dir 에 O_EXCL 생성 → write → fsync → post 재확인 → rename 을 단일 임계구역으로.
  //   agy#2(HIGH·temp 누수): open 직후부터 rename 완료까지 단일 try/finally 로 통합 — write/sync(ENOSPC·IO)든
  //   post 재확인이든 rename 이든 어느 지점 예외에서도 rename 전이면 finally 가 반드시 temp 를 삭제(찌꺼기 0).
  //   FileHandle close 도 내부 finally 로 예외 무관 보장.
  const tmp = join(parentDir, `.${segs[segs.length - 1]!}.tmp.${process.pid}.${defWriteCounter++}`);
  const fh = await open(tmp, "wx", 0o600);
  let renamed = false;
  try {
    try { await fh.writeFile(content, "utf8"); await fh.sync(); }
    finally { await fh.close().catch(() => {}); }
    // post 재확인(스왑 감지): temp 부모 realpath == 검증 realParent + 부모 체인 dev/ino·비-심링크 불변.
    //   위반 시 throw → finally 가 temp 삭제 — rename 이 `.claude` 밖으로 나가는 것을 물리 차단.
    const realTmpParent = await realpath(dirname(tmp));
    if (realTmpParent !== realParent) throw new Error("parent-swap");
    for (const p of pre) {
      const pl = await lstat(p.path).catch(() => null);
      if (!pl || pl.isSymbolicLink() || pl.dev !== p.dev || pl.ino !== p.ino) throw new Error("parent-swap");
    }
    await rename(tmp, abs);
    renamed = true;
  } finally {
    // rename 완료 전 어떤 실패든(write/sync/재확인/rename) temp 잔재 제거. 성공 시 tmp 는 이미 소멸.
    if (!renamed) await rm(tmp, { force: true }).catch(() => {});
  }
  // fsync(dir) best-effort(내구성). 미지원 FS 는 무시.
  try { const dh = await open(parentDir, "r"); try { await dh.sync(); } finally { await dh.close(); } }
  catch { /* dir fsync 미지원 */ }
}

// --- DW7 백업/롤백 (opaque sha256(sourcePath) 파일명·논리 name 보간 금지·심링크 거부) ---------------
function backupDir(): string { return join(stateHome(), "edit-backups"); }
export function backupPathFor(sourcePath: string): string {
  return join(backupDir(), sha256(sourcePath) + ".bak"); // opaque hex — traversal 불가
}
async function lstatOrNull(p: string) { try { return await lstat(p); } catch { return null; } }

// MED(codex·백업 dir 심링크): <state_home>/edit-backups 생성 前 경화 검증 — stateHome leaf·edit-backups
//   양 세그먼트 lstat 심링크 거부 + realpath 앵커(realpath(edit-backups) ⊆ realpath(stateHome)). stateHome
//   중간 세그먼트 심링크 추종 차단. 검증된 dir 반환(부재 시 생성). 위반 = throw(fail-closed).
async function safeBackupDir(): Promise<string> {
  const home = stateHome();
  const hl = await lstatOrNull(home);
  if (hl && hl.isSymbolicLink()) throw new Error("state-home-symlink"); // stateHome leaf 심링크 거부
  await mkdir(home, { recursive: true });
  const dir = backupDir();
  const dl = await lstatOrNull(dir);
  if (dl && dl.isSymbolicLink()) throw new Error("backup-dir-symlink");
  await mkdir(dir, { recursive: false }).catch((e: NodeJS.ErrnoException) => { if (e.code !== "EEXIST") throw e; });
  const realHome = await realpath(home);
  const realDir = await realpath(dir);
  if (!isWithinRoot(realHome, realDir)) throw new Error("backup-dir-escape"); // realpath 앵커 containment
  return dir;
}

// 백업 dir 경화 검증 + 기존 .bak 심링크 거부 후 writeAtomic(temp O_EXCL→rename, write-through-symlink 불가).
export async function writeBackup(sourcePath: string, content: string): Promise<void> {
  await safeBackupDir(); // stateHome/edit-backups 경화 검증(심링크·escape 거부)
  const bp = backupPathFor(sourcePath);
  const bl = await lstatOrNull(bp);
  if (bl && bl.isSymbolicLink()) throw new Error("backup-symlink");
  await writeAtomic(bp, content);
}
// O_NOFOLLOW read — 심링크 .bak 은 open 실패 → null(no-backup 취급).
export async function readBackup(sourcePath: string): Promise<string | null> {
  const r = await readDefSafe(backupPathFor(sourcePath));
  return r ? r.content : null;
}
