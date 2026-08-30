// M-C — harness_scorecard 스냅샷 축적(append-on-state-change) + 추세 판정.
// 설계: docs/myharness/harness-scorecard-mc-design.md. 계층A compute 결과(sc)를 받아 lock 안에서 I/O만(초 단위·TTL 전제).
import { open, mkdir, readFile, writeFile, rename, unlink, link, stat, readdir } from "node:fs/promises";
import { hostname } from "node:os";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type { HarnessScorecard, FindingType } from "./scorecard.js";

const PENALIZED: FindingType[] = ["orphan", "dead_link", "coverage_gap", "incomplete_def", "oversize"];
const DEBT: FindingType[] = ["link_unknown", "unknown_scope"];
const MAX_ACTIVE_IDS = 500;
const LOCK_TTL_MS = 2 * 60 * 1000;       // 2분 — 임계구역(초 단위)보다 충분히 큼 + 크래시 lock 회수 지연 짧게. reclaim 유일 트리거.
const MAX_SUMMARY_BYTES = 1 << 20;       // summary 리더 bound(1MB)

export type SummaryLine = {
  generated_at: string; config_hash: string; state_key: string; scope: "factory" | "built";
  counts: Record<string, number>; penalized: number; debt: number; active_ids: string[]; truncated: boolean;
};

function deriveSummary(sc: HarnessScorecard, nowIso: string): SummaryLine {
  const active = sc.findings.filter((f) => !f.waived);
  const penalized = active.filter((f) => PENALIZED.includes(f.type)).length;
  const debt = active.filter((f) => DEBT.includes(f.type)).length;
  const ids = active.map((f) => f.id).sort();
  const truncated = ids.length > MAX_ACTIVE_IDS;
  return {
    generated_at: nowIso, config_hash: sc.config_hash, state_key: sc.state_key, scope: sc.scope.runtime,
    counts: sc.counts, penalized, debt, active_ids: ids.slice(0, MAX_ACTIVE_IDS), truncated,
  };
}

// ---- lockfile (하드링크 원자성·비큐 tryLock·TTL 단일 stale 트리거) --------------------
// **스코프: 로컬 단일 호스트 dev tool**(127.0.0.1·`_workspace` 로컬 디렉터리·Date.now↔mtime 동일 시계).
//   네트워크 FS(NFS/PV)·멀티노드 clock skew·K8s 다중 pod 공유볼륨은 이 도구의 배포 모델이 아니다 —
//   그 환경에선 외부 코디네이터(Redis 등) 분산 락을 써야 한다(파일락 근본 한계·impl R5 분산 지적은 out-of-scope).
// reclaim(회수)은 **오직 TTL(mtime) 초과** 시에만. pid 생존검사 제거(R4 — 격리 PID namespace 오판 방지).
// TTL-only + release 안전마진으로 점유<TTL 시 회수 불가 → release unlink 안전. lockfile 미수정 → mtime≈획득시각.
const HOST = hostname();
const RELEASE_MARGIN_MS = 10 * 1000;     // release 안전마진(R5 agy) — 검사 후 unlink 지연이 TTL 넘지 않게
// GC는 **TTL 초과 찌꺼기만**(link 직전 live temp 삭제 방지·codex MED). tmp + rename-aside .stale.* 누수분(R2).
async function gcTemps(dir: string): Promise<void> {
  try {
    for (const f of await readdir(dir)) {
      if (!(f.startsWith(".harness-scorecard.lock.tmp.") || f.startsWith(".harness-scorecard.lock.stale.")
        || f.startsWith("harness_scorecard.json.tmp."))) continue;   // json temp+rename 크래시 잔존분도(R3 agy)
      const p = join(dir, f);
      try { const st = await stat(p); if (Date.now() - st.mtimeMs > LOCK_TTL_MS) await unlink(p).catch(() => {}); } catch { /* */ }
    }
  } catch { /* */ }
}
// 성공 시 release 함수 반환·미획득 시 null. EPERM/EXDEV 등은 throw(fail-closed).
async function tryLock(dir: string): Promise<null | (() => Promise<void>)> {
  const lockPath = join(dir, ".harness-scorecard.lock");
  const tmp = join(dir, ".harness-scorecard.lock.tmp." + randomUUID());
  const fh = await open(tmp, "w");                         // temp 완전 write+fsync(내용 보장)
  try { await fh.writeFile(JSON.stringify({ pid: process.pid, host: HOST, startedAt: Date.now() })); await fh.sync(); }
  finally { await fh.close(); }
  const cleanupTmp = async () => { await unlink(tmp).catch(() => {}); };
  // release ABA/TOCTOU 방어(R3 HIGH): 회수(reclaim)는 **TTL 초과 시에만** 발생(dead-pid 경로는 살아있는 나를 못 지움).
  // 따라서 **점유가 TTL 이내면 그 누구도 내 lock 을 못 뺏었으므로** 안전하게 unlink. TTL 초과면 탈취 가능성 → unlink 생략
  // (남의 lock 삭제 위험 회피·잔존분은 TTL-GC/다음 reclaim 이 정리). inode 일치는 보조 확인.
  const acquiredAt = Date.now();
  const release = async () => {
    if (Date.now() - acquiredAt < LOCK_TTL_MS - RELEASE_MARGIN_MS) {   // 마진 — 검사~unlink 지연이 TTL 못 넘음
      try {
        const [l, t] = await Promise.all([stat(lockPath), stat(tmp)]);
        // inode 일치(내 하드링크) AND unlink 직전 재검사(R6 codex — stat~unlink 사이 SIGSTOP 등 초과 방지)
        if (l.ino === t.ino && l.dev === t.dev && Date.now() - acquiredAt < LOCK_TTL_MS - RELEASE_MARGIN_MS)
          await unlink(lockPath).catch(() => {});
      } catch { /* lockPath 이미 사라짐 */ }
    }
    await cleanupTmp();
  };
  try {
    await link(tmp, lockPath);                             // 원자 획득
    return release;
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code !== "EEXIST") { await cleanupTmp(); throw e; }   // EPERM/EXDEV/EOPNOTSUPP=fail-closed
    // 경합 — stale면 **rename-aside 원자 claim + 재확인**(ABA·이중 rename race 차단·R5 agy):
    if (await isStale(lockPath)) {
      const aside = lockPath + ".stale." + randomUUID();
      try { await rename(lockPath, aside); } catch { await cleanupTmp(); return null; } // 먼저 회수됨 → 경합
      // 재확인: aside 가 여전히 stale 이어야 정당한 회수. 신선하면 타 프로세스 lock 오회수 → 처리 분기(R6 codex):
      //   nlink===1(원 owner 가 이미 tmp 정리·orphan) → 원복 대신 제거 / nlink>1(살아있는 하드링크) → 원복 후 포기.
      if (!(await isStale(aside))) {
        let orphan = false;
        try { orphan = (await stat(aside)).nlink === 1; } catch { orphan = true; }
        if (orphan) await unlink(aside).catch(() => {});
        else await rename(aside, lockPath).catch(() => {});
        await cleanupTmp(); return null;
      }
      await unlink(aside).catch(() => {});
      try { await link(tmp, lockPath); return release; }
      catch { await cleanupTmp(); return null; }               // 재획득 실패=정상 경합
    }
    await cleanupTmp();
    return null;
  }
}
async function isStale(lockPath: string): Promise<boolean> {
  let st; try { st = await stat(lockPath); } catch { return false; }
  return Date.now() - st.mtimeMs > LOCK_TTL_MS;   // 유일 트리거: TTL 초과(PID재사용·타host·크래시·손상 전부 포함·오판 없음)
}

// ---- append-on-state-change ---------------------------------------------------------
export type SnapshotResult = { written: boolean; state_key: string; skipped?: "unchanged" | "contention" };
export async function writeHarnessScorecardSnapshot(
  sc: HarnessScorecard, root: string, nowIso: string,
): Promise<SnapshotResult> {
  const dir = join(root, "_workspace", "evals");
  await mkdir(dir, { recursive: true });
  await gcTemps(dir);
  const release = await tryLock(dir);
  if (!release) return { written: false, state_key: sc.state_key, skipped: "contention" };  // 미획득(경합) → 429
  try {
    const summaryPath = join(dir, "harness_summary.jsonl");
    const jsonPath = join(dir, "harness_scorecard.json");
    const lastKey = await lastSummaryStateKey(summaryPath);
    const jsonKey = await jsonStateKey(jsonPath);
    // skip 조건: summary 최신 state_key 동일 AND scorecard.json 존재+동일. 하나라도 불일치 → 진행(복구).
    if (lastKey === sc.state_key && jsonKey === sc.state_key) return { written: false, state_key: sc.state_key, skipped: "unchanged" };

    // ① summary append(개행 보장+fsync) — 단 이미 최신 줄이면 재append 안 함(부분실패 복구 시)
    if (lastKey !== sc.state_key) {
      await ensureTrailingNewline(summaryPath);
      await appendLineFsync(summaryPath, JSON.stringify(deriveSummary(sc, nowIso)));
    }
    // ② scorecard.json temp+rename(최상위 state_key 포함·generated_at 스탬프)
    const stamped = { ...sc, generated_at: nowIso };
    const jtmp = jsonPath + ".tmp." + randomUUID();
    await writeFile(jtmp, JSON.stringify(stamped, null, 2));
    await rename(jtmp, jsonPath);
    return { written: true, state_key: sc.state_key };
  } finally { await release(); }
}

async function ensureTrailingNewline(path: string): Promise<void> {
  let st; try { st = await stat(path); } catch { return; }        // 파일 없음 → append가 생성
  if (st.size === 0) return;
  const fh = await open(path, "r");
  try {
    const buf = Buffer.alloc(1);
    await fh.read(buf, 0, 1, st.size - 1);
    if (buf[0] !== 0x0a) { const a = await open(path, "a"); try { await a.appendFile("\n"); await a.sync(); } finally { await a.close(); } }
  } finally { await fh.close(); }
}
async function appendLineFsync(path: string, line: string): Promise<void> {
  const fh = await open(path, "a");
  try { await fh.appendFile(line + "\n"); await fh.sync(); } finally { await fh.close(); }
}
async function jsonStateKey(path: string): Promise<string | null> {
  try { return (JSON.parse(await readFile(path, "utf8")) as { state_key?: string }).state_key ?? null; } catch { return null; }
}

// summary 리더 — 꼬리 손상 내성(파싱 실패 줄 discard·직전 완전 줄 폴백·fail-open).
async function readSummaryLines(path: string): Promise<SummaryLine[]> {
  let raw = ""; try { raw = await readFile(path, "utf8"); } catch { return []; }
  if (raw.length > MAX_SUMMARY_BYTES) raw = raw.slice(raw.length - MAX_SUMMARY_BYTES);  // bound(tail)
  const out: SummaryLine[] = [];
  for (const ln of raw.split("\n")) {
    if (!ln.trim()) continue;
    try { const o = JSON.parse(ln); if (o && typeof o.state_key === "string") out.push(o as SummaryLine); } catch { /* 손상 줄 discard */ }
  }
  return out;
}
async function lastSummaryStateKey(path: string): Promise<string | null> {
  const lines = await readSummaryLines(path);
  return lines.length ? lines[lines.length - 1]!.state_key : null;
}

// ---- 추세 판정 ----------------------------------------------------------------------
export type Trend = {
  points: { at: string; penalized: number; debt: number }[];
  latest: SummaryLine | null; prev: SummaryLine | null;
  verdict: "improved" | "regressed" | "steady" | "insufficient";
  delta: number | null;
  findingDelta: "available" | "approximate";
  newFindings: string[] | null; resolvedFindings: string[] | null;
};
export async function readHarnessTrend(root: string): Promise<Trend> {
  const all = await readSummaryLines(join(root, "_workspace", "evals", "harness_summary.jsonl"));
  const empty: Trend = { points: [], latest: null, prev: null, verdict: "insufficient", delta: null, findingDelta: "available", newFindings: null, resolvedFindings: null };
  if (all.length === 0) return empty;
  const latest = all[all.length - 1]!;
  const sameScope = all.filter((l) => l.scope === latest.scope);   // scope 혼합 verdict 차단
  const points = sameScope.slice(-20).map((l) => ({ at: l.generated_at, penalized: l.penalized, debt: l.debt }));
  if (sameScope.length < 2) return { ...empty, points, latest, verdict: "insufficient" };
  const prev = sameScope[sameScope.length - 2]!;
  const delta = latest.penalized - prev.penalized;
  const verdict = delta < 0 ? "improved" : delta > 0 ? "regressed" : "steady";
  // new/resolved — 둘 중 하나라도 truncated면 차집합 무효(ghost 차단)
  let findingDelta: "available" | "approximate" = "available";
  let newFindings: string[] | null = null, resolvedFindings: string[] | null = null;
  if (latest.truncated || prev.truncated) { findingDelta = "approximate"; }
  else {
    const L = new Set(latest.active_ids), P = new Set(prev.active_ids);
    newFindings = latest.active_ids.filter((i) => !P.has(i));
    resolvedFindings = prev.active_ids.filter((i) => !L.has(i));
  }
  return { points, latest, prev, verdict, delta, findingDelta, newFindings, resolvedFindings };
}
