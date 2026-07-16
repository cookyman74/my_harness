// Run Supervisor 코어 (설계 §3). 스키마 최종 저자 = supervisor(LLM 아님).
// manifest/status(queued) 기록 → child spawn(로그파일 stdio·fd close) → 구조화 로그 tail(영속 커서·멱등 seq)
//   → events.jsonl append(전체 재작성 없음) + status/agents 동적 갱신 → exit 처리.
import { spawn } from "node:child_process";
import { open, readFile, mkdir } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { z } from "zod";
import { writeJsonAtomic } from "../lib/atomic.js";
import { Manifest, Status, AgentState, Event, isSchemaValid, type RunState } from "../schemas.js";
import { writeOwner } from "./registry.js";
import { identity } from "./osadapter.js";

const iso = () => new Date().toISOString();

// 런타임(codex --json/claude stream-json)·mock runner 가 방출하는 raw 구조화 로그 한 줄.
export const RawLine = z.object({
  ts: z.string().optional(),
  level: z.enum(["info", "warn", "error", "debug"]).optional(),
  agent: z.string().nullable().optional(),
  skill: z.string().nullable().optional(),
  phase: z.string().optional(),
  event: z.string(),               // started|progress|completed|failed|agent_started|agent_completed …
  message: z.string().optional(),
  usage: Event.shape.usage.optional(),
  progress: z.number().optional(),
  state: z.string().optional(),
});
export type RawLine = z.infer<typeof RawLine>;

type Cursor = { offset: number; lastSeq: number };

const RUN_LOG = "raw.jsonl";
const EVENTS = "events.jsonl";
const CURSOR = ".cursor.json";

export const SUPERVISOR_VERSION = "0.5.0";

export function newRunId(name: string): string {
  const t = iso().replace(/[:.]/g, "-");
  const rnd = Math.abs(hashStr(name + t)).toString(36).slice(0, 6);
  return `${t}-${name}-${rnd}`.replace(/[^A-Za-z0-9._-]/g, "-");
}
function hashStr(s: string): number { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0; return h; }

export async function writeManifest(runDir: string, m: Manifest): Promise<void> {
  await mkdir(runDir, { recursive: true });
  await writeJsonAtomic(join(runDir, "manifest.json"), m);
}

export async function writeStatus(runDir: string, s: Status): Promise<void> {
  await writeJsonAtomic(join(runDir, "status.json"), s);
}

function baseStatus(runId: string, state: RunState): Status {
  return {
    schemaVersion: "1", runId, state, phase: "", progress: 0,
    updatedAt: iso(), heartbeatAt: iso(), serverPid: process.pid, serverStartTime: String(process.env.HARNESS_SRV_START ?? ""),
    childPid: null, childStartTime: null, childProcessGroupId: null,
    exitCode: null, exitSignal: null, cancelRequestedAt: null, stateReason: null, summary: "", error: null,
  };
}

async function readCursor(runDir: string): Promise<Cursor> {
  try { return JSON.parse(await readFile(join(runDir, CURSOR), "utf8")) as Cursor; }
  catch { return { offset: 0, lastSeq: -1 }; }
}

// events.jsonl 의 최대 seq. seq 는 append 순 단조증가 → **마지막 유효 라인**이 최대.
// 꼬리 청크만 역방향 read(전체 스캔 O(N²) 회피 — repairEventsTail 로 끝이 항상 개행·torn 제거됨).
async function durableMaxSeq(runDir: string): Promise<number> {
  const h = await open(join(runDir, EVENTS), "r").catch(() => null);
  if (!h) return -1;
  try {
    const { size } = await h.stat();
    if (size === 0) return -1;
    const CH = 64 * 1024;
    let end = size;
    let acc = Buffer.alloc(0);
    while (end > 0) {
      const start = Math.max(0, end - CH);
      const b = Buffer.alloc(end - start);
      await h.read(b, 0, b.length, start);
      acc = Buffer.concat([b, acc]);
      let s = acc;
      if (s.length && s[s.length - 1] === 0x0a) s = s.subarray(0, s.length - 1); // 마지막 \n 제거
      const nl = s.lastIndexOf(0x0a);
      if (nl >= 0) { // 마지막 완성 라인 확보(>64K 라인도 역방향 누적으로 처리)
        try { const o = JSON.parse(s.subarray(nl + 1).toString("utf8")); return typeof o.seq === "number" ? o.seq : -1; }
        catch { return -1; }
      }
      end = start; // 아직 구분 안 됨 → 더 역방향 read
    }
    // BOF: 파일 전체가 한 라인
    try { const o = JSON.parse(acc.toString("utf8").replace(/\n$/, "")); return typeof o.seq === "number" ? o.seq : -1; }
    catch { return -1; }
  } finally { await h.close().catch(() => {}); }
}

const AGENT_NAME = /^[A-Za-z0-9._-]+$/; // agent 이름 allowlist(파일명 traversal 차단)

const MAX_INGEST = 4 * 1024 * 1024; // 회차당 raw 처리 상한(OOM 방지 — 초과분은 다음 회차)
// 단말 상태 — 이 상태에 도달하면 이후 running/stale 등으로 되돌리지 않는다(상태 clobber 방지 SSOT).
export const TERMINAL_STATES: RunState[] = ["completed", "failed", "cancelled", "stale"];

const locks = new Map<string, Promise<unknown>>(); // 런별 status.json RMW 직렬화(ingest·finalize·superviseRun·reconcile.setState 공유)

// 런별 status 뮤텍스 — status.json read-modify-write 를 한 런 안에서 직렬화한다. 모든 status 쓰기 지점이
//   이 락을 공유해야 read 와 write 사이 타 쓰기가 끼어들어 성공 상태/exitCode 를 clobber 하는 것을 막는다(R21 HIGH).
//   read 도 반드시 fn 안(락 보유 중)에서 수행해야 원자적 RMW 가 된다.
export function withStatusLock<T>(runDir: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(runDir) ?? Promise.resolve();
  const run = prev.then(fn, fn); // 이전 실패해도 다음 실행(체인 유지)
  const guard = run.catch(() => {});
  locks.set(runDir, guard);
  guard.finally(() => { if (locks.get(runDir) === guard) locks.delete(runDir); }); // 누수 방지
  return run;
}

export async function ingest(runDir: string): Promise<number> {
  return withStatusLock(runDir, () => ingestLocked(runDir));
}

// events.jsonl 끝이 개행이 아니면(크래시 torn 라인) 마지막 개행까지 절단 — 다음 append 오염 방지.
// 마지막 \n 을 파일 크기와 무관하게 chunk 역방향 스캔으로 찾음(>64K torn 도 처리). 없으면 0 절단.
async function repairEventsTail(runDir: string): Promise<void> {
  const p = join(runDir, EVENTS);
  const h = await open(p, "r+").catch(() => null);
  if (!h) return;
  try {
    let { size } = await h.stat();
    if (size === 0) return;
    { const last = Buffer.alloc(1); await h.read(last, 0, 1, size - 1); if (last[0] === 0x0a) return; } // 정상 종료
    const CH = 64 * 1024;
    let pos = size, found = -1;
    while (pos > 0) {
      const start = Math.max(0, pos - CH);
      const buf = Buffer.alloc(pos - start);
      await h.read(buf, 0, buf.length, start);
      const nl = buf.lastIndexOf(0x0a);
      if (nl >= 0) { found = start + nl; break; }
      pos = start;
    }
    await h.truncate(found < 0 ? 0 : found + 1); // \n 없으면 전체 torn → 0
    await h.sync().catch(() => {});
  } finally { await h.close().catch(() => {}); }
}

async function ingestLocked(runDir: string): Promise<number> {
  const cur = await readCursor(runDir);
  const rawPath = join(runDir, RUN_LOG);
  const h = await open(rawPath, "r").catch(() => null);
  if (!h) return 0;
  let complete = "", consumed = 0;
  try {
    const { size } = await h.stat();
    if (size <= cur.offset) return 0;
    const capped = size - cur.offset > MAX_INGEST;
    const len = Math.min(size - cur.offset, MAX_INGEST);
    const buf = Buffer.alloc(len);
    await h.read(buf, 0, len, cur.offset); // offset(항상 개행경계)부터 신규 바이트만 read(전체 재읽기 금지)
    const lastNl = buf.lastIndexOf(0x0a);
    if (lastNl < 0) {
      // 창(MAX_INGEST) 안에 개행 없음. capped 면 단일 라인이 상한 초과 → 그 창만큼 offset 전진(정체 방지).
      // (거대 라인은 이후 \n 이 나타나는 창에서 시작이 잘려 JSON.parse 실패로 skip → 실 이벤트 미오염.)
      if (capped) { await writeJsonAtomic(join(runDir, CURSOR), { offset: cur.offset + len, lastSeq: cur.lastSeq } satisfies Cursor); }
      return 0; // 아직 완성 라인 없음(부분 라인 이월)
    }
    complete = buf.subarray(0, lastNl + 1).toString("utf8"); // \n 경계 → UTF-8 안전
    consumed = lastNl + 1;
  } finally { await h.close().catch(() => {}); }

  // 크래시 중복 방지(A25): 이미 durably 승격된 max seq 이하는 재append 안 함(단 상태 projection 은 수행).
  await repairEventsTail(runDir); // torn 라인 절단(다음 append 오염 방지)
  const existingMax = await durableMaxSeq(runDir);
  let seq = cur.lastSeq;

  // status/agents 는 디스크 기존값을 baseline 으로(배치 초기화 regress 방지).
  const st = await loadStatus(runDir);
  const agentCache = new Map<string, AgentState>();
  const eh = await open(join(runDir, EVENTS), "a"); // append handle(fsync 대상)
  let promoted = 0;
  try {
    for (const line of complete.split("\n")) {
      if (!line.trim()) continue;
      let obj: unknown;
      try { obj = JSON.parse(line); } catch { continue; } // 파손 라인 skip(seq 미증가)
      const r = RawLine.safeParse(obj);
      if (!r.success) continue;
      const raw = r.data;
      seq += 1;
      const ev: Event = {
        seq, ts: raw.ts ?? iso(), level: raw.level ?? "info",
        agent: raw.agent ?? null, skill: raw.skill ?? null, phase: raw.phase ?? st.phase,
        event: raw.event, message: raw.message ?? "", usage: raw.usage ?? null,
      };
      // ── 상태 projection: seq-skip 이전에 항상 수행(크래시 후 durable event 상태 유실 방지) ──
      if (raw.phase) st.phase = raw.phase;
      if (typeof raw.progress === "number") st.progress = Math.max(0, Math.min(100, raw.progress));
      // 단말 상태는 sticky — cancel/reap 이 cancelled/stale 을 쓴 뒤 잔여 raw line 의 running/completed 가
      //   이를 되돌리면 취소/스테일 판정이 유실된다(R22 HIGH). 이미 단말이면 raw state projection 생략.
      if (raw.state && !TERMINAL_STATES.includes(st.state) && (["queued", "running", "blocked", "failed", "completed", "cancelled", "stale"] as string[]).includes(raw.state)) {
        st.state = raw.state as RunState;
      }
      if (raw.agent && AGENT_NAME.test(raw.agent)) { // 파일명 traversal 차단(untrusted child 로그)
        const prev = agentCache.get(raw.agent) ?? await loadAgent(runDir, raw.agent);
        const astate: RunState = raw.event.includes("completed") ? "completed" : raw.event.includes("failed") ? "failed" : "running";
        agentCache.set(raw.agent, {
          schemaVersion: "1", name: raw.agent, runtime: "codex", state: astate,
          phase: ev.phase, task: raw.message ?? prev?.task ?? "", startedAt: prev?.startedAt ?? ev.ts,
          updatedAt: ev.ts, inputFiles: prev?.inputFiles ?? [], outputFiles: prev?.outputFiles ?? [], error: null,
        });
      }
      // ── append 만 seq-skip(멱등): 이미 durable 이면 재기록 안 함 ──
      if (seq <= existingMax) continue;
      await eh.appendFile(JSON.stringify(ev) + "\n", "utf8"); // append-only(A24)
      promoted += 1;
    }
    await eh.sync().catch(() => {}); // events fsync — 커서 전진 전 내구성
  } finally { await eh.close().catch(() => {}); }

  st.updatedAt = iso(); st.heartbeatAt = iso(); st.summary = `promoted up to seq ${seq}`;
  await writeStatus(runDir, st);
  for (const [name, a] of agentCache) {
    await mkdir(join(runDir, "agents"), { recursive: true });
    await writeJsonAtomic(join(runDir, "agents", `${name}.json`), a);
  }
  await writeJsonAtomic(join(runDir, CURSOR), { offset: cur.offset + consumed, lastSeq: seq } satisfies Cursor);
  return promoted;
}

async function loadStatus(runDir: string): Promise<Status> {
  const manRaw = await readFile(join(runDir, "manifest.json"), "utf8").catch(() => "{}");
  let runId = "unknown";
  try { const m = JSON.parse(manRaw); if (isSchemaValid(Manifest, m).ok) runId = m.runId; } catch { /* */ }
  const raw = await readFile(join(runDir, "status.json"), "utf8").catch(() => null);
  if (raw) { const v = isSchemaValid(Status, (() => { try { return JSON.parse(raw); } catch { return null; } })()); if (v.ok) return v.value; }
  return baseStatus(runId, "running");
}

async function loadAgent(runDir: string, name: string): Promise<AgentState | undefined> {
  if (!/^[A-Za-z0-9._-]+$/.test(name)) return undefined;
  const raw = await readFile(join(runDir, "agents", `${name}.json`), "utf8").catch(() => null);
  if (!raw) return undefined;
  try { const v = isSchemaValid(AgentState, JSON.parse(raw)); return v.ok ? v.value : undefined; } catch { return undefined; }
}

import type { ChildProcess } from "node:child_process";

// child spawn — 로그파일 stdio(pipe 금지·EPIPE 자살 방지), spawn 후 supervisor fd close, owner 레지스트리 기록.
// 반환 pid<=0 또는 identity null 이면 spawn 실패 → 호출측이 failed 처리(bogus owner 미기록).
export type ExitInfo = { code: number | null; signal: string | null };
export async function spawnRun(runDir: string, cmd: string, args: string[], env: Record<string, string> = {}): Promise<{ pid: number; child: ChildProcess | null; exited: Promise<ExitInfo> }> {
  await mkdir(join(runDir, "agents"), { recursive: true }); // -o 출력 부모 생성(A: codex -o parent)
  const out = await open(join(runDir, RUN_LOG), "a");
  const errfh = await open(join(runDir, "raw.err.log"), "a");
  try {
    // env 최소 allowlist(서버 전체 env 상속 금지 — secret leak 방지) + 호출자 env + 고정 주입.
    const ALLOW = ["PATH", "PATHEXT", "HOME", "USERPROFILE", "LANG", "LC_ALL", "TMPDIR", "TEMP", "TMP",
      "SystemRoot", "ComSpec", "APPDATA", "LOCALAPPDATA", "NODE_ENV", "NODE_OPTIONS",
      "USER", "LOGNAME"]; // Windows npm.cmd/.bat = PATHEXT·ComSpec. USER/LOGNAME = macOS Keychain OAuth 조회 필수(비밀 아님·사용자명)
    const childEnv: Record<string, string> = {};
    for (const k of ALLOW) { const v = process.env[k]; if (v !== undefined) childEnv[k] = v; }
    Object.assign(childEnv, env, { HARNESS_RUN_DIR: runDir });
    const child = spawn(cmd, args, {
      cwd: runDir,
      stdio: ["ignore", out.fd, errfh.fd], // 로그파일 직접(pipe 금지)
      detached: true,
      env: childEnv,
      shell: false,
    });
    child.on("error", () => {}); // spawn ENOENT 등 async error uncaught → 서버 crash 방지(agy R5)
    // exit 를 **동기적으로** 캡처(await 이전) — 빠른 종료 이벤트 유실 방지(codex/agy R2).
    const exited: Promise<ExitInfo> = new Promise((res) => {
      child.once("exit", (code, signal) => res({ code: code ?? null, signal: signal ?? null }));
      child.once("error", () => res({ code: -1, signal: null }));
    });
    const pid = child.pid ?? -1;
    if (pid <= 0) return { pid: -1, child: null, exited };
    child.unref();
    // post-spawn 부트스트랩(identity·owner) 실패는 **reject 금지** — 추적불가 detached child 방지 위해 kill 후 실패 반환.
    try {
      const id = await identity(pid);
      if (!id) { try { child.kill("SIGKILL"); } catch { /* */ } return { pid: -1, child, exited }; } // identity 실패 → 좀비 제거
      await writeOwner({
        runId: (JSON.parse(await readFile(join(runDir, "manifest.json"), "utf8").catch(() => "{}")).runId) ?? "unknown",
        pid, groupId: id.groupId, startTime: id.startTime, exe: id.exe,
        cwd: runDir, nonce: randomBytes(16).toString("hex"),
      });
      return { pid, child, exited };
    } catch { try { child.kill("SIGKILL"); } catch { /* */ } return { pid: -1, child, exited }; }
  } finally {
    await out.close().catch(() => {}); // supervisor fd 복사본 close(누수 방지)
    await errfh.close().catch(() => {});
  }
}

// 실행 관리: spawn + 주기 ingest + child exit 시 최종 ingest·terminal status·owner 정리.
// exit 는 spawnRun 이 동기 캡처한 exited 프로미스로 처리(유실 없음). 모든 콜백 try/catch(rejection→server crash 방지).
export async function superviseRun(runDir: string, cmd: string, args: string[], env: Record<string, string> = {}, onExit?: (info: ExitInfo) => void): Promise<{ pid: number }> {
  const { pid, child, exited } = await spawnRun(runDir, cmd, args, env);
  if (pid <= 0 || !child) {
    await withStatusLock(runDir, async () => {
      const st = await loadStatus(runDir);
      if (TERMINAL_STATES.includes(st.state)) return; // 이미 단말(예: 즉시 cancel)이면 보존
      st.state = "failed"; st.stateReason = "spawn-failed"; st.error = "spawn failed"; st.updatedAt = iso();
      await writeStatus(runDir, st);
    }).catch(() => {});
    onExit?.({ code: -1, signal: null }); // M-y0: spawn 실패도 거버너 release 통지(슬롯 leak 방지)
    return { pid: -1 };
  }
  // running status 를 **먼저** 쓰고(exit 전), 감독 부착은 finally 로 보장.
  // exited 는 (spawnRun 이 동기 캡처한) 프로미스라 이미 resolve 됐어도 이후 .then 이 유효 → 늦은 부착도 유실 없음.
  // 순서상 running-write → (exit 시) finalize 가 뒤에 completed 를 써 clobber 없음(과거 reorder 경쟁 회피).
  try {
    const cur = await import("./osadapter.js").then((m) => m.identity(pid)).catch(() => null);
    await withStatusLock(runDir, async () => {
      const st = await loadStatus(runDir);
      // 단말 상태(취소·완료·실패·stale) 전부 보존 — spawn 직후 즉시 cancel 된 런을 running 으로 되돌리지 않음(R21 MED).
      st.state = TERMINAL_STATES.includes(st.state) ? st.state : "running";
      st.childPid = pid; st.childStartTime = cur?.startTime ?? null; st.childProcessGroupId = cur?.groupId ?? null; st.updatedAt = iso();
      await writeStatus(runDir, st);
    });
  } catch { /* status write 실패 → 감독은 finally 에서 부착되어 finalize/ingest 가 이후 상태 기록 */ }
  finally {
    // 주기 승격 — 자기재예약(setTimeout) 으로 이전 ingest 완료 후에만 다음 틱 예약. setInterval 은 ingest 지연 시
    //   withStatusLock 큐에 프로미스를 무한 적재해 지연 증폭·정리 지연을 낳는다(R22 MED).
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const pump = async () => {
      if (stopped) return;
      try { await ingest(runDir); } catch { /* */ }
      if (!stopped) timer = setTimeout(pump, 500);
    };
    timer = setTimeout(pump, 500);
    exited.then((info) => finalize(runDir, info)).catch(() => {}).finally(() => { stopped = true; if (timer) clearTimeout(timer); });
    // M-y0: 거버너 release 통지 — exit 시 1회(정보 무관·슬롯 반환). finalize 와 독립 체인(release 지연 방지).
    if (onExit) exited.then((info) => { try { onExit(info); } catch { /* */ } }, () => { try { onExit({ code: null, signal: null }); } catch { /* */ } });
  }
  return { pid };
}

async function finalize(runDir: string, info: ExitInfo): Promise<void> {
  try {
    // 종료 후 잔여 로그 전량 승격 — MAX_INGEST(4MB) cap 때문에 1회 호출은 앞부분만 처리한다. promoted>0 인 동안
    //   반복(안전 상한 10000)해 꼬리 로그(최종 결과/완료 이벤트) 유실을 막는다(R22 HIGH).
    for (let i = 0; i < 10000; i++) { if ((await ingest(runDir)) <= 0) break; }
    await withStatusLock(runDir, async () => { // RMW 를 락으로 원자화(ingest/reconcile 와 clobber 방지·R21 HIGH)
      const f = await loadStatus(runDir);
      if (!TERMINAL_STATES.includes(f.state)) f.state = info.code === 0 ? "completed" : "failed";
      f.exitCode = info.code; f.exitSignal = info.signal; f.updatedAt = iso();
      await writeStatus(runDir, f);
    });
    const { removeOwner } = await import("./registry.js");
    const rid = JSON.parse(await readFile(join(runDir, "manifest.json"), "utf8").catch(() => "{}")).runId;
    if (rid) await removeOwner(rid);
  } catch { /* finalize 오류 → 다음 reconcile 이 정리(server crash 방지) */ }
}
