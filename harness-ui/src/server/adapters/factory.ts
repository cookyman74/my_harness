// F11: 팩토리(myharness) 유지관리 — 하네스웹에서 설치·업데이트·제거를 명확히.
//
// 보안 경계(HOME 쓰기 = projectRoot 밖 신규 mutation):
//   - 대상 경로는 **고정 리터럴**(~/.claude/skills/myharness · ~/.agents/skills/myharness 공유) — 사용자 입력 경로 없음 = 경로탈출 불가.
//   - 소스는 projectRoot/skills/myharness — 링크/복사 전 **팩토리 검증**(SKILL.md 존재)으로 임의 디렉토리 링크 차단.
//   - 쓰기(apply)는 config.factoryMaintenanceEnabled 게이트(라우트에서 확인·기본 false) + 세션 인증 뒤에서만.
//   - 실물 디렉토리 파괴 전 **백업**(사용자 데이터 하드삭제 금지). 제거는 confirm 필요.
//   - 심링크 우선(정본 가리켜 항상 최신 = 업데이트 자동)·실패 시 copy 폴백.
import { lstat, stat, readlink, symlink, rm, mkdir, cp, rename, readFile } from "node:fs/promises";
import { join, resolve, dirname } from "node:path";

// F17(M-d·design §7-2): 설치 채널 2개. claude-skill=`~/.claude/skills`(Claude) · shared-skill=`~/.agents/skills`(Codex+Gemini 공유·공식).
//   (구 codex-skill=`~/.codex/skills`는 shared 로 이관 — 선검증서 `.agents/skills` 유저 공유 실재 확인.)
export type SkillTargetId = "claude-skill" | "shared-skill";
export type FactoryAction = "install" | "update" | "remove";

// 대상별 고정 경로(home 주입 — 테스트 가능·사용자 입력 아님).
function skillDest(home: string, target: SkillTargetId): string {
  if (target === "claude-skill") return join(home, ".claude", "skills", "myharness");
  if (target === "shared-skill") return join(home, ".agents", "skills", "myharness"); // Codex+Gemini 공유 채널
  throw new Error("unknown-target"); // enum 밖 — 방어
}

// 소스 = projectRoot/skills/myharness. 팩토리 레포에서만 존재.
function sourceSkillDir(projectRoot: string): string {
  return join(projectRoot, "skills", "myharness");
}

async function pathExists(p: string): Promise<boolean> {
  try { await lstat(p); return true; } catch { return false; }
}

// 소스가 진짜 myharness 팩토리인지. SKILL.md 가 **정규 파일**이고(디렉토리 위장 차단·agy MED),
//   .claude-plugin/plugin.json name==="myharness" 로 **정체성 고정**(임의 SKILL.md 를 소스로 오인 차단·codex MED).
//   projectRoot 는 F3 로 가변이므로 존재만으론 부족 — 정체성까지 확인해 소스 오염을 막는다.
async function isFactorySource(projectRoot: string): Promise<boolean> {
  try {
    const skill = await stat(join(sourceSkillDir(projectRoot), "SKILL.md"));
    if (!skill.isFile()) return false;
    const pj = JSON.parse(await readFile(join(projectRoot, ".claude-plugin", "plugin.json"), "utf8"));
    return pj?.name === "myharness";
  } catch { return false; }
}

// 대상의 상위 경로(홈 하위 고정 세그먼트)가 심링크로 리다이렉트되지 않는지(codex MED — parent symlink).
//   존재하는 부모가 심링크면 쓰기가 의도 밖 위치로 새어나갈 수 있어 거부. 부재는 mkdir 이 실디렉토리로 생성(안전).
async function assertParentChainSafe(home: string, target: SkillTargetId): Promise<void> {
  const segs = target === "claude-skill" ? [".claude", "skills"] : [".agents", "skills"];
  let cur = home;
  for (const s of segs) {
    cur = join(cur, s);
    let st; try { st = await lstat(cur); } catch { continue; } // 부재 = 안전(생성 예정)
    if (st.isSymbolicLink()) throw new Error("parent-unsafe");
  }
}

// 충돌 없는 백업 경로 할당(같은 ms 다중 요청·기존 백업 존재 시 접미 증가·codex/agy MED).
async function allocBackup(dest: string, nowMs: number): Promise<string> {
  let p = `${dest}.bak.${nowMs}`;
  for (let i = 1; await pathExists(p); i++) p = `${dest}.bak.${nowMs}.${i}`;
  return p;
}

// 레포 정본 버전 = .claude-plugin/plugin.json .version.
async function sourceVersion(projectRoot: string): Promise<string | null> {
  try {
    const j = JSON.parse(await readFile(join(projectRoot, ".claude-plugin", "plugin.json"), "utf8"));
    return typeof j?.version === "string" ? j.version : null;
  } catch { return null; }
}

export type SkillState =
  | { kind: "absent" }
  | { kind: "symlink"; points: string; synced: boolean } // synced = 정본을 가리킴(항상 최신)
  | { kind: "copy" }                                       // 실물 복사(버전 불명·재설치 권장)
  | { kind: "foreign" };                                   // 파일 등 예기치 않은 형태

async function detectSkill(home: string, projectRoot: string, target: SkillTargetId): Promise<SkillState> {
  const dest = skillDest(home, target);
  let st;
  try { st = await lstat(dest); } catch { return { kind: "absent" }; }
  if (st.isSymbolicLink()) {
    let points = "";
    try { points = resolve(dirname(dest), await readlink(dest)); } catch { /* dangling */ }
    return { kind: "symlink", points, synced: points === resolve(sourceSkillDir(projectRoot)) };
  }
  if (st.isDirectory()) return { kind: "copy" };
  return { kind: "foreign" };
}

// Claude marketplace 플러그인 설치 감지(installed_plugins.json 권위·읽기전용).
async function detectMarketplace(home: string): Promise<{ installed: boolean; version: string | null }> {
  try {
    const j = JSON.parse(await readFile(join(home, ".claude", "plugins", "installed_plugins.json"), "utf8"));
    const plugins = j?.plugins ?? {};
    const key = Object.keys(plugins).find((k) => k === "myharness" || k.startsWith("myharness@"));
    if (!key) return { installed: false, version: null };
    const e = Array.isArray(plugins[key]) ? plugins[key][0] : plugins[key];
    return { installed: true, version: typeof e?.version === "string" ? e.version : null };
  } catch { return { installed: false, version: null }; }
}

export interface FactoryStatus {
  isFactoryRepo: boolean;          // projectRoot 가 팩토리 정본 레포인가(아니면 유지관리 n/a)
  sourceVersion: string | null;    // 레포 정본 버전(plugin.json)
  maintenanceEnabled: boolean;     // 쓰기 게이트 상태
  targets: {
    claudeSkill: SkillState;
    sharedSkill: SkillState; // Codex+Gemini 공유(`~/.agents/skills`)
    marketplace: { installed: boolean; version: string | null; updateAvailable: boolean }; // 앱 제어 불가·감지/안내만
  };
}

export async function factoryStatus(opts: { projectRoot: string; home: string; maintenanceEnabled: boolean }): Promise<FactoryStatus> {
  const { projectRoot, home, maintenanceEnabled } = opts;
  const isRepo = await isFactorySource(projectRoot);
  const src = isRepo ? await sourceVersion(projectRoot) : null;
  const mkt = await detectMarketplace(home);
  return {
    isFactoryRepo: isRepo,
    sourceVersion: src,
    maintenanceEnabled,
    targets: {
      claudeSkill: isRepo ? await detectSkill(home, projectRoot, "claude-skill") : { kind: "absent" },
      sharedSkill: isRepo ? await detectSkill(home, projectRoot, "shared-skill") : { kind: "absent" },
      marketplace: { installed: mkt.installed, version: mkt.version, updateAvailable: mkt.installed && src != null && mkt.version !== src },
    },
  };
}

// 심링크 시도 → 실패(Windows 권한 등) 시 recursive copy 폴백.
async function linkOrCopy(src: string, dest: string): Promise<"symlink" | "copy"> {
  try { await symlink(src, dest, "dir"); return "symlink"; }
  catch { await cp(src, dest, { recursive: true }); return "copy"; }
}

export interface ApplyResult { ok: true; method: "symlink" | "copy" | "removed" | "noop"; backup?: string; state: SkillState }

// 쓰기 적용. 게이트/인증은 라우트 소관 — 여기선 경로안전·소스검증·백업만 책임.
export async function applyFactoryAction(opts: {
  projectRoot: string; home: string; target: SkillTargetId; action: FactoryAction; confirm?: boolean; nowMs: number;
}): Promise<ApplyResult> {
  const { projectRoot, home, target, action, confirm, nowMs } = opts;
  const dest = skillDest(home, target);
  await assertParentChainSafe(home, target); // 부모 심링크 리다이렉트 차단(모든 쓰기 前)

  if (action === "remove") {
    if (!confirm) throw new Error("confirm-required"); // 파괴 작업 — 명시 확인
    const st = await lstatSafe(dest);
    if (!st) return { ok: true, method: "noop", state: { kind: "absent" } };
    if (st.isSymbolicLink()) { await rm(dest, { force: true }); return { ok: true, method: "removed", state: { kind: "absent" } }; }
    // 실물 디렉토리/파일 → 하드삭제 대신 백업 이동(사용자 데이터 보존·충돌회피 경로).
    const bak = await allocBackup(dest, nowMs);
    await rename(dest, bak);
    return { ok: true, method: "removed", backup: bak, state: { kind: "absent" } };
  }

  // install/update: 소스가 진짜 팩토리인지 검증(임의 디렉토리 링크 차단).
  if (!(await isFactorySource(projectRoot))) throw new Error("source-not-factory");
  const src = resolve(sourceSkillDir(projectRoot));
  await mkdir(dirname(dest), { recursive: true });

  const st = await lstatSafe(dest);
  let restoreLink: string | null = null; // 심링크 relink 실패 시 복원할 옛 대상.
  if (st?.isSymbolicLink()) {
    let cur = "";
    try { cur = resolve(dirname(dest), await readlink(dest)); } catch { /* dangling */ }
    if (cur === src) return { ok: true, method: "noop", state: { kind: "symlink", points: src, synced: true } };
    restoreLink = cur || null;
    await rm(dest, { force: true }); // 다른 곳 가리킴 → 재연결
  } else if (st) {
    // 실물 디렉토리/파일 → 백업 후 교체(파괴 아님·충돌회피 경로).
    const bak = await allocBackup(dest, nowMs);
    await rename(dest, bak);
    try {
      const method = await linkOrCopy(src, dest);
      return { ok: true, method, backup: bak, state: method === "symlink" ? { kind: "symlink", points: src, synced: true } : { kind: "copy" } };
    } catch (e) {
      // 완전 원복(codex R3): 부분 산출물 제거 후 백업 복원 — dest 잔여로 rename 실패 방지.
      await rm(dest, { recursive: true, force: true }).catch(() => {});
      await rename(bak, dest).catch(() => {});
      throw e;
    }
  }

  // absent 또는 심링크 relink 후 신규 링크/복사.
  try {
    const method = await linkOrCopy(src, dest);
    return { ok: true, method, state: method === "symlink" ? { kind: "symlink", points: src, synced: true } : { kind: "copy" } };
  } catch (e) {
    await rm(dest, { recursive: true, force: true }).catch(() => {}); // 부분 산출물 제거
    if (restoreLink) await symlink(restoreLink, dest, "dir").catch(() => {}); // 옛 심링크 복원(공백 방지)
    throw e;
  }
}

async function lstatSafe(p: string) {
  try { return await lstat(p); } catch { return null; }
}
