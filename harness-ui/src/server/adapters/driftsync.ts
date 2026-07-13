// F16(M-f): 다런타임 **스킬 사본** drift 분류·동기. 스킬(SKILL.md)은 전 런타임 공통 포맷이라 여러 런타임 dir에
//   같은 이름으로 사본/링크가 존재할 수 있다. 물리 관계를 (dev,ino)로 정확히 분류해 무단/부분 동기와 오판을 막는다.
//
// ⚠ 핵심(design §6-1·R1 감사): **inode 만 비교하면 오판** — inode 는 device 내에서만 고유(cross-fs 우연 일치).
//   반드시 **(dev, ino) 튜플**로 판정. hardlink 는 같은 (dev,ino)지만 심링크 아님(다중 실경로) → 직접 편집은 금지·
//   drift 화면에서 위험 배지 + 명시 확인 후에만.
//
// 분류:
//   - canonical: 우선순위 최상위(claude) 사본 = 동기 기준본.
//   - symlink-to-canonical: 심링크가 정본 realpath 를 가리킴 → 물리 동일·drift 아님·동기 불필요.
//   - hardlink-same-inode: 같은 (dev,ino)·심링크 아님 → **정본과 물리 동일 파일**(내용 항상 동일) → drift 불가·동기 대상 아님.
//       (R1 감사: 하드링크는 정본과 같은 inode라 내용이 항상 정본과 같다 → "동기"는 무의미. 정본 편집 시 함께 바뀜을 알리는 정보 배지만.)
//   - copy-insync: 다른 (dev,ino)·내용 해시 동일 → 동기됨.
//   - copy-drift: 다른 (dev,ino)·내용 상이 → drift(명시 다타깃 apply 대상).
//   - broken: dangling/foreign 심링크(정본 아닌 심링크는 O_NOFOLLOW 쓰기 불가라 안전 동기 불가)·비정규 파일·stat 실패
//       → fail-soft 태깅(스캔 중단 없음·동기 대상 아님).
import { lstat, readlink, realpath, readFile, readdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { createHash } from "node:crypto";
import { editableSkillDirs } from "./runtimes.js";
import { isSafeSegment } from "../lib/paths.js";

// 우선순위 순(정본 선택용): claude > shared(.agents) > gemini. editableSkillDirs 는 Set 순이라 명시 순서 고정.
const SKILL_DIR_PRIORITY = [".claude/skills", ".agents/skills", ".gemini/skills"];
function orderedSkillDirs(): string[] {
  const editable = new Set(editableSkillDirs());
  return SKILL_DIR_PRIORITY.filter((d) => editable.has(d));
}

export type SkillCopyClass =
  | "canonical" | "symlink-to-canonical" | "hardlink-same-inode"
  | "copy-insync" | "copy-drift" | "broken";

export interface SkillCopy {
  dir: string; path: string; runtime: string; cls: SkillCopyClass;
  hash: string | null; nlink: number | null;
}
export interface SkillSyncGroup {
  skill: string; canonicalPath: string; canonicalHash: string | null;
  copies: SkillCopy[]; hasDrift: boolean; hasBroken: boolean;
}

const sha = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");
const RUNTIME_OF: Record<string, string> = { ".claude/skills": "claude", ".agents/skills": "codex/agy", ".gemini/skills": "agy" };

async function listDirsSafe(dir: string): Promise<string[]> {
  try { return (await readdir(dir, { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name); }
  catch { return []; }
}

type Stat = { dev: number; ino: number; isSymlink: boolean; isFile: boolean; nlink: number };
async function statSkill(abs: string): Promise<Stat | null> {
  try {
    const l = await lstat(abs);
    return { dev: l.dev, ino: l.ino, isSymlink: l.isSymbolicLink(), isFile: l.isFile(), nlink: l.nlink };
  } catch { return null; }
}

// 심링크가 정본 SKILL.md 를 가리키는지(readlink→realpath == realpath(정본)).
async function pointsToCanonical(abs: string, canonicalAbs: string): Promise<boolean> {
  try {
    const target = await realpath(abs);         // 심링크 추종한 실경로
    const canon = await realpath(canonicalAbs);
    return target === canon;
  } catch { return false; }
}

async function readHash(abs: string): Promise<string | null> {
  try { return sha(await readFile(abs, "utf8")); } catch { return null; }
}

// 스킬 이름별로 편집 가능 dir 전건을 모아 사본 그룹을 만든다. ≥2 dir 에 존재할 때만 group(단일 = drift 무관).
export async function skillSyncGroups(root: string): Promise<SkillSyncGroup[]> {
  const dirs = orderedSkillDirs();
  // 스킬명 → 존재하는 dir 목록.
  const byName = new Map<string, string[]>();
  for (const d of dirs) {
    for (const name of await listDirsSafe(join(root, ...d.split("/")))) {
      if (!isSafeSegment(name)) continue;
      const abs = join(root, ...d.split("/"), name, "SKILL.md");
      if (await statSkill(abs)) { // SKILL.md 실재하는 dir 만
        const arr = byName.get(name) ?? [];
        arr.push(d);
        byName.set(name, arr);
      }
    }
  }

  const groups: SkillSyncGroup[] = [];
  for (const [skill, presentDirs] of byName) {
    if (presentDirs.length < 2) continue; // 사본 그룹 아님
    // 정본 = 우선순위 최상위(presentDirs 는 dirs 순서 유지 X → 우선순위 재정렬).
    const ordered = dirs.filter((d) => presentDirs.includes(d));
    const canonicalDir = ordered[0]!;
    const canonicalAbs = join(root, ...canonicalDir.split("/"), skill, "SKILL.md");
    const canonStat = await statSkill(canonicalAbs);
    const canonicalHash = await readHash(canonicalAbs);
    // 정본 자체가 비정규/심링크/읽기불가면 비교 기준이 없음 → 전 사본 broken·drift 계산 중단(codex R2 MED).
    const canonBroken = !canonStat || !canonStat.isFile || canonStat.isSymlink || canonicalHash === null;
    const copies: SkillCopy[] = [];
    let hasDrift = false, hasBroken = false;
    for (const d of ordered) {
      const abs = join(root, ...d.split("/"), skill, "SKILL.md");
      const path = `${d}/${skill}/SKILL.md`;
      const runtime = RUNTIME_OF[d] ?? "claude";
      if (d === canonicalDir) {
        const cls: SkillCopyClass = canonBroken ? "broken" : "canonical";
        if (canonBroken) hasBroken = true;
        copies.push({ dir: d, path, runtime, cls, hash: canonicalHash, nlink: canonStat?.nlink ?? null }); continue;
      }
      const st = await statSkill(abs);
      if (!st || canonBroken) { copies.push({ dir: d, path, runtime, cls: "broken", hash: null, nlink: st?.nlink ?? null }); hasBroken = true; continue; }
      let cls: SkillCopyClass;
      let hash: string | null = null;
      if (st.isSymlink) {
        // 정본을 가리키는 심링크만 물리동일. 그 외 심링크(dangling·foreign)는 broken — leaf 심링크는 O_NOFOLLOW 로
        //   안전 쓰기 불가라 동기 대상 아님(R1 codex/agy LOW: dangling → copy-drift 오분류 수정).
        cls = (await pointsToCanonical(abs, canonicalAbs)) ? "symlink-to-canonical" : "broken";
      } else if (!st.isFile) {
        cls = "broken"; // SKILL.md 가 디렉토리 등 비정규 → 동기 대상 아님
      } else if (st.dev === canonStat!.dev && st.ino === canonStat!.ino) {
        cls = "hardlink-same-inode"; // (dev,ino) 동일·심링크 아님 → 정본과 물리 동일(내용 항상 동일·동기 무의미)
      } else if (st.nlink > 1) {
        // foreign hardlink(정본 아닌 다중 링크): 동기 시 rename 이 이 경로의 링크 관계를 끊음(과동기)·nlink>1 write 거부 대상.
        //   안전하게 동기 불가 → broken 분류(codex R2 MED: copy-insync/copy-drift 오분류로 syncable 되던 것 차단).
        cls = "broken";
      } else {
        hash = await readHash(abs);
        if (hash !== null && hash === canonicalHash) cls = "copy-insync";
        else if (hash !== null) { cls = "copy-drift"; hasDrift = true; }
        else { cls = "broken"; } // 읽기 실패
      }
      if (cls === "broken") hasBroken = true;
      copies.push({ dir: d, path, runtime, cls, hash, nlink: st.nlink });
    }
    groups.push({ skill, canonicalPath: `${canonicalDir}/${skill}/SKILL.md`, canonicalHash, copies, hasDrift, hasBroken });
  }
  return groups;
}

// 동기 대상 자격: **copy-drift·copy-insync 만**(별개 파일 → 정본 내용을 안전하게 쓸 수 있음).
//   symlink-to-canonical·hardlink-same-inode = 정본과 물리 동일(내용 항상 같음) → 동기 무의미·대상 아님.
//   broken(dangling/foreign 심링크·비정규) = O_NOFOLLOW 등으로 안전 쓰기 불가 → 대상 아님.
export function isSyncableTarget(cls: SkillCopyClass): boolean {
  return cls === "copy-drift" || cls === "copy-insync";
}
