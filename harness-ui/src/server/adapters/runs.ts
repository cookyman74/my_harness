// runs reader (설계 §API /api/runs). _workspace/runs/** 스캔. 없거나 비어도 안전(A5be).
// 보안: runId SAFE_SEGMENT + symlink 거부 + realpath 경계. events는 스트리밍(무제한 read 방지).
import { constants } from "node:fs";
import { readdir, opendir, lstat, realpath, open } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { StringDecoder } from "node:string_decoder";
import { join } from "node:path";
import { Manifest, Status, AgentState, Event, isSchemaValid, type RunsQuery } from "../schemas.js";
import type { z } from "zod";
import { isSafeSegment, isWithinRoot } from "../lib/paths.js";

// M9 S1: anchor 파라미터화(통합감사-#3·하드코딩 2벌 금지). 기본 `_workspace/runs`(F4/F6),
//   M13(F8)은 `<state_home>/evals-rollup` 등 다른 anchor 로 동일 공용 리더 재사용. sub 미지정 =
//   기존 M7 호출부 계약 불변(default 로 동일 경로 → F4 거부 스위트 회귀 0).
const DEFAULT_RUNS_SUB = ["_workspace", "runs"] as const;
function runsDir(root: string, sub: readonly string[] = DEFAULT_RUNS_SUB): string { return join(root, ...sub); }
const MAX_LINE = 256 * 1024; // 라인 상한(과대 라인 skip)
// M9 R2 HIGH(agy·DoS): 과대 무개행 라인 drain 시 데드라인 없이도 강제 종료하는 누적바이트 상한.
//   drain 구간엔 yield 가 없어 호출자 데드라인/라인캡 검사가 못 돈다(§readCappedLines). deadlineAt
//   미주입 호출자를 위한 하드 백스톱 — 이 바이트를 넘도록 개행이 안 나오면 강제 abort(무한 블로킹 차단).
export const MAX_DRAIN_BYTES = 64 * 1024 * 1024; // 64MB(단일 과대 라인 drain 상한)

// M7 F4 스캔 바운드(상수 확정 — AS3). 읽기전용·OOM/ReDoS/데드라인 방어.
export const MAX_RUNS_SCAN = 1000;      // 내용 read 상한(콜드캐시/Windows 현실값·V13)
export const SCAN_DEADLINE_MS = 2000;   // 스캔 데드라인(초과 시 부분결과)
export const MAX_JSON_BYTES = 64 * 1024; // status/manifest 개별 크기 상한(OOM 방어)
export const MAX_RUN_DIRS = 100000;     // 이름+stat 열거 backstop
export const MAX_EVENTS_PER_RUN = 50000; // M9: 집계 시 run 당 유효 event 스캔 상한(CPU/시간 바운드)
// R1 HIGH(agy·DoS): 처리 라인(파손 포함) 상한. 유효 event 만 세는 maxEvents 는 비-JSON/스키마부적합 라인이
//   폭주하면(count 미증가) for-await 가 파일 끝까지 무한 순회 → 수십초 블로킹. 처리 "라인" 자체를 바운드해
//   maxEvents 미증가 무한루프를 차단. 유효 event 여유(4×)를 둬 정상 run 오탐 절단 방지.
export const MAX_EVENT_LINES_PER_RUN = 200000;

// agy#2: root/base realpath 앵커. 스캔 루프 바깥에서 1회 resolve 후 safeRunDir 에 주입 —
//   호출마다 realpath(root)+realpath(base) 재조회(풀스캔 최대 2*N I/O) 제거. leaf 검증은 per-run 유지.
interface RunAnchors { realRoot: string; realBase: string; }

// 고정 앵커(root/base)의 realpath·containment 를 opendir 이전에 1회 계산(R7 codex#1 HIGH —
//   base 열거를 선행 보안경계로). 반환 kind:
//   - ok        : base 존재·root 내포 → 선계산 앵커(safeRunDir 공유 주입).
//   - enumerate : base ENOENT(runs 디렉토리 없음=정당) → 앵커 없이 opendir 에 위임. 실 ENOENT→빈 정상,
//                 opendir 주입 오류(EACCES 등)는 기존 opendir catch 가 정직 노출(scan_error). R5 계약 불변.
//   - blocked   : base 가 root 밖(심링크 탈출)·root/base 접근오류(EACCES/IO) → 외부 디렉토리 열거 자체 차단(fail-closed).
type AnchorResolution =
  | { kind: "ok"; anchors: RunAnchors }
  | { kind: "enumerate" }
  | { kind: "blocked" };

async function resolveRunAnchors(root: string, sub: readonly string[] = DEFAULT_RUNS_SUB): Promise<AnchorResolution> {
  let realRoot: string;
  try { realRoot = await realpath(root); }
  catch { return { kind: "blocked" }; }                     // root 자체 resolve 실패 = 안전 차단
  let realBase: string;
  try { realBase = await realpath(runsDir(root, sub)); }
  catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === "ENOENT") return { kind: "enumerate" }; // base 부재=정당
    return { kind: "blocked" };                             // EACCES/IO 등 = 외부 열거 차단
  }
  if (!isWithinRoot(realRoot, realBase)) return { kind: "blocked" }; // base 심링크 탈출 차단(codex#1)
  return { kind: "ok", anchors: { realRoot, realBase } };
}

// runId → 안전한 run 디렉토리 절대경로. base·leaf symlink/traversal/경계이탈이면 null.
// anchors 주입 시 root/base realpath·containment 는 선계산분 재사용(하위호환: 미주입 시 내부 계산).
// 보안 계약 불변: leaf lstat 심링크 거부·O_NOFOLLOW·leaf realpath containment 재확인은 그대로.
async function safeRunDir(root: string, runId: string, anchors?: RunAnchors | null, sub: readonly string[] = DEFAULT_RUNS_SUB): Promise<string | null> {
  if (!isSafeSegment(runId)) return null;
  const base = runsDir(root, sub);
  const dir = join(base, runId);
  try {
    let realBase: string;
    if (anchors) {
      realBase = anchors.realBase; // 선계산 앵커(고정 base) 재사용 — root/base realpath·containment 검증 완료분
    } else {
      // 미주입 경로(다른 호출자·하위호환): base(_workspace/runs)가 심링크로 프로젝트 밖을 재앵커하는 것 차단(codex#1).
      const realRoot = await realpath(root);
      realBase = await realpath(base);
      if (!isWithinRoot(realRoot, realBase)) return null;
    }
    const l = await lstat(dir);
    if (l.isSymbolicLink() || !l.isDirectory()) return null; // symlink run 디렉토리 거부(per-run·불변)
    const real = await realpath(dir);
    if (!isWithinRoot(realBase, real)) return null;
    return real;
  } catch { return null; }
}

// run 디렉토리 내 파일을 leaf symlink 없이 원자적으로 open(O_NOFOLLOW) — check-reopen TOCTOU 제거(codex R3).
// fd 확보 후 fstat 로 정규파일 확인. 열린 FileHandle 반환(호출측이 finally close). POSIX 기준; Windows는 O_NOFOLLOW 무시 가능(로컬 위협 낮음).
async function safeOpen(dir: string, name: string): Promise<FileHandle | null> {
  if (!/^[A-Za-z0-9._-]+$/.test(name)) return null; // 파일명 allowlist(traversal 차단)
  let h: FileHandle | null = null;
  try {
    h = await open(join(dir, name), constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const st = await h.stat();
    if (!st.isFile()) { await h.close(); return null; }
    return h;
  } catch { if (h) await h.close().catch(() => {}); return null; }
}
// M7 V2: 크기상한(MAX_JSON_BYTES) 바운드 리더. readJsonSafe(전체 readFile·상한 없음) 재사용 금지.
// safeOpen→fstat.size>상한이면 read 자체를 호출하지 않고 skip(oversize). 초과 아닐 때만 size 바운드 제한읽기 후 parse.
export async function readJsonCapped(dir: string, name: string): Promise<{ ok: boolean; value: unknown; oversize: boolean }> {
  const h = await safeOpen(dir, name);
  if (!h) return { ok: false, value: null, oversize: false };
  try {
    const st = await h.stat();
    if (st.size > MAX_JSON_BYTES) return { ok: false, value: null, oversize: true }; // read 미호출(OOM 방어·R-5)
    const buf = Buffer.alloc(Number(st.size));
    // M3: bytesRead 로 절단(stat↔read 사이 파일 축소 시 널바이트 억울한 quarantine 방지).
    let bytesRead = 0;
    if (buf.length > 0) ({ bytesRead } = await h.read(buf, 0, buf.length, 0)); // size 바운드 제한읽기(전체 readFile 아님)
    return { ok: true, value: JSON.parse(buf.toString("utf8", 0, bytesRead)), oversize: false };
  } catch { return { ok: false, value: null, oversize: false }; }
  finally { await h.close().catch(() => {}); }
}

// agy#1(R8 HIGH): 크기상한 리더 + 스키마 검증을 합친 헬퍼. 잔여 readJsonSafe(무바운드 readFile) 경로
//   (getRun/currentRunState/readRunAgents)를 전부 이 헬퍼로 대체 → 수 GB status/manifest/agent json 도
//   read 미호출 skip(OOM 방어). 반환은 isSchemaValid 와 동일 shape({ok,value}|{ok,error}) 로 각 호출부의
//   기존 반환 계약(null+error 문자열 / null / skip)을 불변 유지. 초과/미판독은 오류 대신 안전 fallback.
async function readCappedValidated<T>(
  schema: z.ZodType<T>, dir: string, name: string,
): Promise<{ ok: true; value: T } | { ok: false; error: string }> {
  const r = await readJsonCapped(dir, name);
  if (!r.ok) {
    return { ok: false, error: r.oversize ? `oversize: ${name} > ${MAX_JSON_BYTES} bytes` : `unreadable: ${name}` };
  }
  return isSchemaValid(schema, r.value);
}

// A47 레거시 무인자 경로. 반환 shape {runs:[{runId,status,valid}]} 불변.
// agy#3: readdir 전건+전 status readFile(무바운드 OOM) → opendir 스트리밍 열거 + MAX_RUN_DIRS/
//   MAX_RUNS_SCAN/SCAN_DEADLINE_MS 상한 + readJsonCapped(크기상한). 상한 도달 시 조용히 상위 N만
//   (레거시 shape 유지 위해 truncated 필드는 추가하지 않음 — queryRuns 가 정직 노출 경로).
export async function listRuns(root: string): Promise<{ runs: Array<{ runId: string; status: unknown | null; valid: boolean }> }> {
  const start = Date.now();
  const base = runsDir(root);

  // R7 codex#1 HIGH: opendir(base) 이전에 base 앵커·containment 검증(외부 base 열거 차단).
  //   blocked(심링크 탈출/접근오류) → 외부 디렉토리를 열지 않고 fail-closed {runs:[]}(레거시 shape).
  //   agy#2: ok 앵커는 스캔 루프 safeRunDir 에 공유 주입(root/base realpath 1회).
  const anchorRes = await resolveRunAnchors(root);
  if (anchorRes.kind === "blocked") return { runs: [] };
  const anchors: RunAnchors | null = anchorRes.kind === "ok" ? anchorRes.anchors : null;

  const names: string[] = [];
  let dh: Awaited<ReturnType<typeof opendir>> | undefined;
  try {
    dh = await opendir(base);
  } catch {
    return { runs: [] }; // 디렉토리 없음/접근불가 = 빈(A5be·레거시 계약: 조용히 빈)
  }
  try {
    for await (const e of dh) {
      if (Date.now() - start > SCAN_DEADLINE_MS) break;            // 열거 데드라인
      if (!e.isDirectory() || !isSafeSegment(e.name)) continue;
      names.push(e.name);
      if (names.length >= MAX_RUN_DIRS) break;                     // 이름 열거 backstop
    }
  } catch { /* 순회 예외 → 수집분으로 진행(레거시: 부분결과 조용히) */ }
  finally { if (dh) await dh.close().catch(() => {}); }            // 예외/조기절단서도 dir 핸들 확정 close

  // R7 MED(agy): read 루프 진입 직전 이름 내림차순 정렬 — opendir OS 무작위 열거서 MAX_RUNS_SCAN 절단 시
  //   시계열 runId(ULID/ISO/zero-pad) 최신 우선 수집(best-effort, queryRuns Step D 동일 근거·최종 권위 아님).
  names.sort();
  names.reverse();

  const runs: Array<{ runId: string; status: unknown | null; valid: boolean }> = [];
  let reads = 0;
  for (const id of names) {
    if (Date.now() - start > SCAN_DEADLINE_MS) break;              // read 루프 데드라인
    if (reads >= MAX_RUNS_SCAN) break;                             // 내용 read 상한(OOM 방어·agy#3)
    reads++;
    const dir = await safeRunDir(root, id, anchors);
    if (!dir) continue;
    const sr = await readJsonCapped(dir, "status.json");           // 전체 readFile 금지(크기상한 리더)
    const v = sr.ok ? isSchemaValid(Status, sr.value) : { ok: false as const, value: undefined };
    const valid = "ok" in v && v.ok;
    runs.push({ runId: id, status: valid ? v.value : null, valid });
  }
  return { runs };
}

// E5-a: 검증된 runDir 절대경로(심링크·containment 방어분). 고정 하위파일명만 join 하는 호출자용(사용자 세그먼트 금지).
export async function resolveRunDir(root: string, runId: string): Promise<string | null> {
  return safeRunDir(root, runId);
}

export async function getRun(root: string, runId: string) {
  const dir = await safeRunDir(root, runId);
  if (!dir) return null;
  const manifest = await readCappedValidated(Manifest, dir, "manifest.json"); // agy#1: 크기상한(OOM 방어)
  const status = await readCappedValidated(Status, dir, "status.json");
  return {
    runId,
    manifest: manifest.ok ? manifest.value : null,
    status: status.ok ? status.value : null,
    manifestError: manifest.ok ? null : manifest.error,
    statusError: status.ok ? null : status.error,
  };
}

async function currentRunState(dir: string): Promise<string | null> {
  const v = await readCappedValidated(Status, dir, "status.json"); // agy#1: readEvents 폴링마다 실행 — 크기상한 필수
  return v.ok ? v.value.state : null;
}

// agy#2(R8 HIGH): 고정 청크 커스텀 라인 리더. FileHandle.readLines()(내부 readline)는 개행 전까지
//   단일 문자열 버퍼에 무한 누적 → 개행 없는 수백MB 블록이 MAX_LINE 검사 도달 전 V8 힙 초과 OOM.
//   대신 64KB 고정 청크로 직접 read 하고, 누적 라인 길이가 MAX_LINE 초과 시 즉시 버퍼를 비우고
//   다음 개행까지 drain(무시)해 과대 라인이 힙을 넘지 못하게 한다(정상 라인은 그대로 yield).
//   StringDecoder 로 멀티바이트 UTF-8 이 청크 경계에 걸쳐도 손실 없이 재조립. FileHandle close 는 호출측 finally.
const READ_CHUNK = 64 * 1024;
// M9 R2 HIGH(agy·DoS): 과대 라인 drain 조기종료 신호. drain 구간은 yield 가 없어 호출자 루프의
//   데드라인/라인캡 검사가 실행되지 못하므로, 리더 내부에서 초과를 감지하면 이 sentinel 로 throw 해
//   호출자가 truncated/reason 을 정직하게 반영(또는 안전 fallback)하게 한다.
class LineReaderAbort extends Error {
  constructor(public readonly abortReason: "deadline_exceeded" | "limit_reached") {
    super(`readCappedLines aborted: ${abortReason}`);
    this.name = "LineReaderAbort";
  }
}
// deadlineAt(옵션): drain(과대 무개행 라인) 구간에서 매 청크 후 Date.now()>deadlineAt 검사 →
//   초과 시 LineReaderAbort("deadline_exceeded") throw. MAX_DRAIN_BYTES 초과 시 강제 종료(무한 블로킹 차단).
async function* readCappedLines(h: FileHandle, deadlineAt?: number): AsyncGenerator<string> {
  const buf = Buffer.allocUnsafe(READ_CHUNK);
  const decoder = new StringDecoder("utf8");
  let pending = "";        // 현재 라인 누적(개행 전). 항상 ≤ MAX_LINE + READ_CHUNK 로 바운드.
  let dropping = false;    // 과대 라인 drain 모드: 다음 개행까지 무시(힙 초과 방지).
  let dropBytes = 0;       // drain 모드 누적 바이트(개행 없는 과대 라인 강제 종료 백스톱).
  let position = 0;
  for (;;) {
    const { bytesRead } = await h.read(buf, 0, READ_CHUNK, position);
    if (bytesRead === 0) break;
    position += bytesRead;
    let chunk = decoder.write(buf.subarray(0, bytesRead));
    let nl: number;
    while ((nl = chunk.indexOf("\n")) !== -1) {
      const segment = chunk.slice(0, nl);
      chunk = chunk.slice(nl + 1);
      if (dropping) { dropping = false; dropBytes = 0; pending = ""; continue; } // 과대 라인 종료 → 정상 복귀
      yield pending + segment;
      pending = "";
    }
    if (dropping) {
      // R2 HIGH: drain 구간엔 yield 가 없어 호출자 데드라인/라인캡 검사가 못 돈다. 수백MB 무개행
      //   단일 블록이 여기서 통제 불능 블로킹(수십초 DoS)하지 못하도록 매 청크 후 데드라인·누적바이트
      //   상한을 직접 검사해 초과 시 즉시 abort(호출자에 truncated/reason 신호).
      dropBytes += bytesRead;
      if (deadlineAt !== undefined && Date.now() > deadlineAt) throw new LineReaderAbort("deadline_exceeded");
      if (dropBytes > MAX_DRAIN_BYTES) throw new LineReaderAbort("limit_reached");
      continue;                             // 개행 없는 나머지 = 계속 drain(바운드 하에)
    }
    pending += chunk;
    if (pending.length > MAX_LINE) { pending = ""; dropping = true; dropBytes = 0; } // 과대 라인 → drain
  }
  const tail = decoder.end();               // 미완 멀티바이트 flush
  if (!dropping) {
    pending += tail;
    if (pending.length > 0 && pending.length <= MAX_LINE) yield pending; // 개행 없이 끝난 마지막 라인
  }
}

// events: cursor(after exclusive, 기본 -1로 seq 0 포함)+limit. 스트리밍(전체 read 금지).
export async function readEvents(root: string, runId: string, afterIn: number, limitIn: number) {
  const after = Number.isFinite(afterIn) ? Math.max(-1, Math.trunc(afterIn)) : -1;
  const limit = Math.min(1000, Math.max(1, Number.isFinite(limitIn) ? Math.trunc(limitIn) : 200));
  const empty = { items: [] as Event[], nextAfter: after, hasMore: false, runState: null as string | null, schemaVersion: "1" as const };
  const dir = await safeRunDir(root, runId);
  if (!dir) return empty;
  const runState = await currentRunState(dir);
  const h = await safeOpen(dir, "events.jsonl"); // O_NOFOLLOW open — leaf symlink·재open 갭 제거
  if (!h) return { ...empty, runState };
  // R2 HIGH: 자체 요청 처리 데드라인 — readCappedLines drain 구간이 이 시각을 넘기면 조기 abort.
  //   요청당 상한(SCAN_DEADLINE_MS)으로 과대 무개행 라인 drain 이 무한 블로킹하지 못하게 한다.
  const deadlineAt = Date.now() + SCAN_DEADLINE_MS;
  const items: Event[] = [];
  let hasMore = false;
  try {
    for await (const line of readCappedLines(h, deadlineAt)) { // agy#2/R2: 고정 청크 리더 + drain 데드라인
      if (!line || line.length > MAX_LINE) continue; // 빈/과대 라인 skip(seq 갭 가능 — 문서화)
      let obj: unknown;
      try { obj = JSON.parse(line); } catch { continue; }   // 파손 라인 skip
      const v = isSchemaValid(Event, obj);
      if (!v.ok || v.value.seq <= after) continue;
      if (items.length >= limit) { hasMore = true; break; }
      items.push(v.value);
    }
  } catch { /* 읽기 오류 → 지금까지 수집분 반환 */ }
  finally { await h.close().catch(() => {}); } // FD 확실히 close
  items.sort((a, b) => a.seq - b.seq);
  const page = items.slice(0, limit);
  return {
    items: page,
    nextAfter: page.length ? page[page.length - 1]!.seq : after,
    hasMore: hasMore || items.length > page.length,
    runState,
    schemaVersion: "1" as const,
  };
}

// --- M7 F4: queryRuns — 필터/검색/정렬/페이지네이션(읽기전용) --------------
export interface RunRecord {
  runId: string;
  runtime: string | null;
  mode: string | null;
  state: string | null;
  recordedAt: string;        // FS-time(birthtime||mtime) ISO
  recordedAtMs: number;
  createdAt: string | null;  // manifest(표시·보조키) — recordedAt과 괴리 가능
  updatedAt: string | null;  // status
  goal: string | null;       // ≤200자 excerpt
  agent: string | null;
  requestedBy: string | null;
}

export interface QueryRunsResult {
  items: RunRecord[];
  total: number;
  offset: number;
  limit: number;
  hasMore: boolean;
  scanned: number;
  truncated: boolean;
  // R4-1: opendir 순회 예외 부분결과를 정직 노출하는 "scan_error" 확장.
  truncatedReason: "limit_reached" | "deadline_exceeded" | "scan_error" | null;
  recordedAtSource: "birthtime" | "mtime";
  schemaVersion: "1";
}

const GOAL_EXCERPT_MAX = 200;
function excerpt(s: unknown): string | null {
  if (typeof s !== "string") return null;
  return s.length > GOAL_EXCERPT_MAX ? s.slice(0, GOAL_EXCERPT_MAX) : s;
}
function isoMs(iso: unknown): number | null {
  if (typeof iso !== "string") return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
}

// 정렬 캐시(C): 공개 recordedAtMs 외 createdAt/updatedAt 파싱을 1회만. _-필드는 응답 shape 에 넣지 않음.
interface QEntry { r: RunRecord; createdAtMs: number | null; updatedAtMs: number | null; isMtime: boolean; }

export async function queryRuns(root: string, query: RunsQuery): Promise<QueryRunsResult> {
  const limit = query.limit;
  const offset = query.offset;
  const empty: QueryRunsResult = {
    items: [], total: 0, offset, limit, hasMore: false, scanned: 0,
    truncated: false, truncatedReason: null, recordedAtSource: "birthtime", schemaVersion: "1",
  };

  // A/H1: 데드라인 기준을 모든 FS 열거 이전(함수 최상단)에 고정 — readdir 자체가 데드라인/메모리를 우회하지 못하게.
  const start = Date.now();
  let deadlineHit = false;
  let limitReached = false;
  let scanError = false; // R4-1: opendir 순회 예외 = 부분결과(정직 노출).
  const base = runsDir(root);

  // R7 codex#1 HIGH: opendir(base) 이전에 base 앵커·containment 검증(외부 base 열거/오염 차단).
  //   blocked(base 심링크 탈출/접근오류) → 외부 디렉토리를 열지 않고 fail-closed scan_error(외부 후보가
  //   total/hasMore/items 에 미반영). enumerate(base ENOENT) → 앵커 없이 아래 opendir 에 위임(빈 정상).
  //   agy#2: ok 앵커는 스캔 루프 바깥 1회 resolve → 양 경로 safeRunDir 에 공유 주입(root/base realpath 1회).
  const anchorRes = await resolveRunAnchors(root);
  if (anchorRes.kind === "blocked") return { ...empty, truncated: true, truncatedReason: "scan_error" };
  const anchors: RunAnchors | null = anchorRes.kind === "ok" ? anchorRes.anchors : null;

  // 1) opendir async-iterator 스트리밍 열거(A): 전체 entries 를 메모리에 올리지 않고 이름만 bounded 수집.
  //    MAX_RUN_DIRS 도달 또는 SCAN_DEADLINE_MS 초과 시 즉시 중단(메모리 = 이름 배열만).
  const names: string[] = [];
  let dh: Awaited<ReturnType<typeof opendir>> | undefined;
  try {
    dh = await opendir(base);
  } catch (err) {
    // R5-HIGH(codex): ENOENT(runs 디렉토리 없음)만 빈 정상. EACCES/IO 등 그 외 오류는
    //   빈 정상 결과로 은폐하지 말고 순회 예외(scan_error)와 일관되게 truncated:true 로 정직 노출.
    if ((err as NodeJS.ErrnoException)?.code === "ENOENT") return empty;
    return { ...empty, truncated: true, truncatedReason: "scan_error" };
  }
  try {
    for await (const e of dh) {
      if (Date.now() - start > SCAN_DEADLINE_MS) { deadlineHit = true; break; }
      if (!e.isDirectory() || !isSafeSegment(e.name)) continue;
      names.push(e.name);
      if (names.length >= MAX_RUN_DIRS) { limitReached = true; break; } // 이름 열거 backstop
    }
  } catch { scanError = true; /* R4-1: 열거 예외 → 수집분으로 진행하되 truncated:true·reason:"scan_error" 로 부분결과 노출 */ }
  // agy#3: 예외·조기절단·Windows 엣지서 dir 핸들 확정 close(readEvents finally 패턴 준용).
  //   정상 완료/break 시 async-iterator 가 이미 close 했어도 재-close 는 catch 로 무해 흡수.
  finally { if (dh) await dh.close().catch(() => {}); }

  // D: 이름 문자열 내림차순 정렬 후 그 순서로 stat/read — 데드라인 절단 시에도 최신 우선 수집(best-effort).
  //    ULID/ISO/zero-pad run-NNN 등 시계열 runId 가정. runId 형식 무의존 정확성은 아래 recordedAtMs desc 재정렬이 최종 권위.
  names.sort();
  names.reverse();

  // 2) 각 dir stat → recordedAt(birthtime||mtime). symlink/비디렉토리/stat불가 = 제외.
  const fromMs = isoMs(query.from);
  const toMs = isoMs(query.to);
  let usedMtime = false;
  const cands: Array<{ runId: string; recordedAtMs: number; isMtime: boolean }> = [];
  for (const name of names) {
    if (Date.now() - start > SCAN_DEADLINE_MS) { deadlineHit = true; break; } // 열거 루프 데드라인
    const p = join(base, name);
    let l;
    try { l = await lstat(p); } catch { continue; } // stat 불가 = quarantine(제외)
    if (l.isSymbolicLink() || !l.isDirectory()) continue; // symlink run dir backstop(권위는 safeRunDir)
    const bt = l.birthtimeMs;
    let recordedAtMs: number;
    let isMtime = false;
    if (Number.isFinite(bt) && bt > 0) { recordedAtMs = bt; }
    else { recordedAtMs = l.mtimeMs; usedMtime = true; isMtime = true; }
    // window 정리(codex#1/agy#1): coarse 드롭은 birthtime 경로(!isMtime)의 상한(to) prefix 만.
    //   cands 는 recordedAtMs desc → to 초과 run 은 앞쪽 prefix(읽기 도달 전 stat 단계서 절약).
    //   하한(from) suffix 는 Step4 read 루프의 birthtime break 로 처리(이중 windowing 제거).
    //   mtime fallback 은 mtime≠createdAt 괴리 → 여기서 드롭 금지(Step4 per-entry createdAt 정밀판정).
    if (!isMtime && toMs !== null && recordedAtMs > toMs) continue;
    cands.push({ runId: name, recordedAtMs, isMtime });
  }
  // 응답 요약값 전용(codex#1): 개별 window/tie-break 판정에 쓰지 않음 — per-entry isMtime 이 권위.
  const recordedAtSource: "birthtime" | "mtime" = usedMtime ? "mtime" : "birthtime";

  // 3) recordedAt desc 정렬(runId 형식 무의존)·tie-break=runId 내림차순(최신 우선 — agy#2).
  //    스캔 캡/데드라인 절단 시 동일 timestamp 다건서 최신 runId 유실 방지·Step7 최종정렬 방향과 일관.
  cands.sort((a, b) => b.recordedAtMs - a.recordedAtMs || (b.runId < a.runId ? -1 : b.runId > a.runId ? 1 : 0));

  const dirMul = query.order === "asc" ? 1 : -1;
  const hasWindow = fromMs !== null || toMs !== null;
  // agy#2: anchors 는 opendir 이전(함수 상단)에서 1회 resolve 완료 — 스캔 루프 safeRunDir 에 공유 주입.

  // ── R4-3 경로 분리 ─────────────────────────────────────────────────────────
  // total 의미 계약: 저렴경로 total=열거 run 수(무필터·read 불요), 풀스캔 total=in-scan 매칭 수(+truncated면 하계).
  //   UI 는 truncated 시 total 을 하계로 취급(W3 문구).
  // 저렴 경로 = q·mode·agent·state·runtime·from·to 전무 + sort=recordedAt(정렬/페이지만).
  //   → 페이지 슬라이스만 readJsonCapped(O(limit) read). state/runtime/updatedAt·state-정렬은 status/manifest
  //     read 없이는 평가 불가하므로 "필터 있음"으로 보고 풀스캔(정확 in-scan total·상한으로 안전).
  const hasFilter = query.q !== undefined || query.mode !== undefined || query.agent !== undefined
    || query.state !== undefined || query.runtime !== undefined || hasWindow;
  if (!hasFilter && query.sort === "recordedAt") {
    const total = cands.length; // 열거 run dir 수(read 불요) — 무필터 계약
    // Step3 은 recordedAtMs desc 고정 → asc 요청 시만 재정렬(tie-break=runId, Step7 방향과 일관).
    const ordered = dirMul === -1 ? cands
      : [...cands].sort((a, b) => (a.recordedAtMs - b.recordedAtMs) || (a.runId < b.runId ? -1 : a.runId > b.runId ? 1 : 0));
    // agy#1: total=cands.length 를 이미 알고 offset↔cands 인덱스 1:1 이므로 +1 여유분 제거.
    //   정확히 limit 건만 슬라이스 → 여유분에 낀 quarantine(invalid) 이 페이지 items 로 편입되어 다음
    //   페이지 첫 항목과 중복되는 경계 버그 제거. quarantine 으로 반환 수가 limit 미만이어도 클라는
    //   다음 offset(+limit)으로 정상 진행(cands 인덱스 정합). hasMore 는 total 기준(+1 불요).
    const pageCands = ordered.slice(offset, offset + limit);
    const pageRecords: RunRecord[] = [];
    let scannedCheap = 0;
    for (const c of pageCands) {
      if (Date.now() - start > SCAN_DEADLINE_MS) { deadlineHit = true; break; }
      scannedCheap++;
      const dir = await safeRunDir(root, c.runId, anchors); // 권위 심링크/경계 거부(R-7)·선계산 앵커
      if (!dir) continue;
      const sr = await readJsonCapped(dir, "status.json");
      const statusV = sr.ok ? isSchemaValid(Status, sr.value) : { ok: false as const, value: undefined };
      if (!("ok" in statusV) || !statusV.ok) continue; // status 무효/파손/초과 = quarantine
      const status = statusV.value;
      const mr = await readJsonCapped(dir, "manifest.json");
      const manV = mr.ok ? isSchemaValid(Manifest, mr.value) : null;
      const man = manV && manV.ok ? manV.value : null;
      pageRecords.push({
        runId: c.runId,
        runtime: man ? man.runtime : null,
        mode: man ? man.mode : null,
        state: status.state,
        recordedAt: new Date(c.recordedAtMs).toISOString(),
        recordedAtMs: c.recordedAtMs,
        createdAt: man ? man.createdAt : null,
        updatedAt: status.updatedAt,
        goal: man ? excerpt(man.goal) : null,
        agent: man ? (man.agent ?? null) : null,
        requestedBy: man ? man.requestedBy : null,
      });
    }
    // truncated 는 열거 캡/데드라인/scan_error 기준(저렴경로는 read-cap 미사용).
    const cheapReason: QueryRunsResult["truncatedReason"] =
      deadlineHit ? "deadline_exceeded" : limitReached ? "limit_reached" : scanError ? "scan_error" : null;
    return {
      items: pageRecords.slice(0, limit),
      total, offset, limit,
      hasMore: offset + limit < total,
      scanned: scannedCheap,
      truncated: cheapReason !== null,
      truncatedReason: cheapReason,
      recordedAtSource, schemaVersion: "1",
    };
  }

  // 4) recordedAt desc 순회하며 read(readJsonCapped)·경량레코드 구성. status 무효 = quarantine(items 제외·scanned).
  //    B: from/to 지정 시 window 필터(mtime 경로=createdAt·birthtime 경로=recordedAt)를 read 직후 인라인 적용.
  //    "읽은 후보 수"가 아니라 "in-window 후보 수"로 채운다 → mtime top-N 이 window 밖이어도 range 내 run 이
  //    manifest read 전 탈락하지 않도록 read 예산(MAX_RUNS_SCAN)·데드라인 한도 내 bounded scan.
  // agy#1: birthtime-only(혼재 mtime 없음) 확신 시에만 from 하한 break 적용. mtime 후보가 하나라도 있으면
  //   eff=createdAt 이 recordedAtMs 정렬순서와 무관 → break 불가(캡까지 스캔·degraded 수용, 정확성 우선).
  //   birthtime 지원이 기본이라 실사용 대부분 이 최적화가 적용됨.
  const canBreakFrom = fromMs !== null && !usedMtime;
  let scanned = 0;
  let reads = 0;
  const entries: QEntry[] = [];
  for (const c of cands) {
    if (Date.now() - start > SCAN_DEADLINE_MS) { deadlineHit = true; break; }
    // agy#1: cands 는 recordedAtMs desc → birthtime 후보가 from 하한 밑이면 이후 전부 범위 밖.
    //   read 이전에 break(불필요 read 절약·가짜 limit_reached 방지). reads/scanned 미증가.
    if (canBreakFrom && fromMs !== null && !c.isMtime && c.recordedAtMs < fromMs) break;
    // R4-2: break 를 못 하는 mtime 혼재 경로에서도, birthtime 하한 밑 엔트리(eff=recordedAt<from 확정)는
    //   readJsonCapped 이전에 skip → 최대 MAX_RUNS_SCAN 낭비 read 제거. mtime 엔트리(eff=createdAt)는 그대로 read.
    if (fromMs !== null && !c.isMtime && c.recordedAtMs < fromMs) continue;
    if (reads >= MAX_RUNS_SCAN) { limitReached = true; break; } // 내용 read 상한
    reads++;
    scanned++;
    const dir = await safeRunDir(root, c.runId, anchors); // 권위 심링크/경계 거부(R-7)·선계산 앵커
    if (!dir) continue;
    const sr = await readJsonCapped(dir, "status.json");
    const statusV = sr.ok ? isSchemaValid(Status, sr.value) : { ok: false as const, value: undefined };
    if (!("ok" in statusV) || !statusV.ok) continue; // status 무효/파손/초과 = quarantine
    const status = statusV.value;
    const mr = await readJsonCapped(dir, "manifest.json");
    const manV = mr.ok ? isSchemaValid(Manifest, mr.value) : null;
    const man = manV && manV.ok ? manV.value : null; // 없음/파손/초과 → null(최소필드는 status로)
    const createdAt = man ? man.createdAt : null;
    const updatedAt = status.updatedAt;
    const r: RunRecord = {
      runId: c.runId,
      runtime: man ? man.runtime : null,
      mode: man ? man.mode : null,
      state: status.state,
      recordedAt: new Date(c.recordedAtMs).toISOString(),
      recordedAtMs: c.recordedAtMs,
      createdAt,
      updatedAt,
      goal: man ? excerpt(man.goal) : null,
      agent: man ? (man.agent ?? null) : null,
      requestedBy: man ? man.requestedBy : null,
    };
    // C: createdAt/updatedAt 파싱을 1회만 캐시(정렬 comparator 재파싱 금지). 응답 shape 엔 포함하지 않음.
    const createdAtMs = isoMs(createdAt);
    const updatedAtMs = isoMs(updatedAt);
    // codex#1: window 필터를 per-entry 로 — birthtime 후보=recordedAt·mtime 후보=createdAt(부재 시 recordedAt).
    //   전역 recordedAtSource 판정(하나라도 mtime 이면 birthtime 후보까지 createdAt 로 재던) 불일치 제거.
    if (hasWindow) {
      const eff = c.isMtime ? (createdAtMs ?? c.recordedAtMs) : c.recordedAtMs;
      if (fromMs !== null && eff < fromMs) continue;
      if (toMs !== null && eff > toMs) continue;
    }
    entries.push({ r, createdAtMs, updatedAtMs, isMtime: c.isMtime });
    // codex#2: offset+limit+1 조기중단 제거 — MAX_RUNS_SCAN 상한 내 in-window 매칭 전체 수집(정확한 total).
  }

  // 5) 잔여 필터: state/runtime(enum eq)·mode/agent(리터럴 eq). window 는 Step4 인라인 처리 완료.
  let filtered = entries.filter((e) => {
    const r = e.r;
    if (query.state && r.state !== query.state) return false;
    if (query.runtime && r.runtime !== query.runtime) return false;
    if (query.mode !== undefined && r.mode !== query.mode) return false;
    if (query.agent !== undefined && r.agent !== query.agent) return false;
    return true;
  });

  // 6) q 리터럴 부분일치(ReDoS 방어 — new RegExp 금지). goal/mode/agent/requestedBy.
  if (query.q !== undefined) {
    const needle = query.q.toLowerCase();
    filtered = filtered.filter((e) =>
      [e.r.goal, e.r.mode, e.r.agent, e.r.requestedBy].some((f) => typeof f === "string" && f.toLowerCase().includes(needle)));
  }

  // 7) 전역 정렬(페이지 버퍼만 재정렬 금지)·tie-break: (두 엔트리 모두 mtime) createdAt → runId.
  //    codex#1: per-entry isMtime 로 tie-break(전역 recordedAtSource 미사용).
  //    agy#2: 최종 fallback runId 도 요청 order 와 방향 일관(desc → runId desc)하도록 dirMul 곱.
  //    C: comparator 는 캐시 숫자만 비교(isoMs 재호출 금지). dirMul 은 경로분리 이전에 정의.
  const cmpTie = (a: QEntry, b: QEntry): number => {
    if (a.isMtime && b.isMtime) {
      const ca = a.createdAtMs, cb = b.createdAtMs;
      if (ca !== null && cb !== null && ca !== cb) return (ca - cb) * dirMul;
    }
    return (a.r.runId < b.r.runId ? -1 : a.r.runId > b.r.runId ? 1 : 0) * dirMul;
  };
  filtered.sort((a, b) => {
    let d = 0;
    if (query.sort === "recordedAt") d = (a.r.recordedAtMs - b.r.recordedAtMs) * dirMul;
    else if (query.sort === "updatedAt") d = ((a.updatedAtMs ?? 0) - (b.updatedAtMs ?? 0)) * dirMul;
    else if (query.sort === "state") d = (a.r.state ?? "").localeCompare(b.r.state ?? "") * dirMul;
    return d !== 0 ? d : cmpTie(a, b);
  });

  const total = filtered.length;
  const items = filtered.slice(offset, offset + limit).map((e) => e.r); // _-캐시 제거 → 응답 shape 불변
  const truncatedReason: QueryRunsResult["truncatedReason"] =
    deadlineHit ? "deadline_exceeded" : limitReached ? "limit_reached" : scanError ? "scan_error" : null; // deadline>limit>scan_error
  return {
    items, total, offset, limit,
    hasMore: offset + items.length < total,
    scanned,
    truncated: truncatedReason !== null,
    truncatedReason,
    recordedAtSource,
    schemaVersion: "1",
  };
}

// --- M9 F6: 공용 바운드 run 열거(anchor 파라미터) + 이벤트 스트리머 ----------------
// queryRuns/listRuns 본문은 손대지 않는다(F4 거부 스위트 회귀 0). 보안 프리미티브
// (resolveRunAnchors·safeRunDir·safeOpen·readCappedLines)만 재사용 — 앵커/심링크 2벌 금지.
export interface RunRef { runId: string; dir: string; recordedAtMs: number; isMtime: boolean; }
export interface BoundedRunEnum {
  items: RunRef[];             // 상위 N(FS-time desc)만·safeRunDir 통과분
  scanned: number;             // safeRunDir 시도 수
  truncated: boolean;
  truncatedReason: "limit_reached" | "deadline_exceeded" | "scan_error" | null;
  recordedAtSource: "birthtime" | "mtime";
}

// anchor=sub(기본 `_workspace/runs`). 이름 열거→FS-time desc 정렬→상위 MAX_RUNS_SCAN 만 safeRunDir 해석.
//   데드라인/캡/scan_error 를 truncatedReason 으로 정직 노출(0 위장 금지·V13 2원인 분리).
export async function enumerateRunsBounded(root: string, sub: readonly string[] = DEFAULT_RUNS_SUB): Promise<BoundedRunEnum> {
  const start = Date.now();
  let deadlineHit = false, limitReached = false, scanError = false;
  const base = runsDir(root, sub);
  const empty = (reason: BoundedRunEnum["truncatedReason"]): BoundedRunEnum =>
    ({ items: [], scanned: 0, truncated: reason !== null, truncatedReason: reason, recordedAtSource: "birthtime" });

  const anchorRes = await resolveRunAnchors(root, sub);
  if (anchorRes.kind === "blocked") return empty("scan_error"); // 외부 재앵커/접근오류 fail-closed
  const anchors: RunAnchors | null = anchorRes.kind === "ok" ? anchorRes.anchors : null;

  const names: string[] = [];
  let dh: Awaited<ReturnType<typeof opendir>> | undefined;
  try {
    dh = await opendir(base);
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === "ENOENT") return empty(null); // base 부재 = 빈 정상(A5be)
    return empty("scan_error");
  }
  try {
    for await (const e of dh) {
      if (Date.now() - start > SCAN_DEADLINE_MS) { deadlineHit = true; break; }
      if (!e.isDirectory() || !isSafeSegment(e.name)) continue;
      names.push(e.name);
      if (names.length >= MAX_RUN_DIRS) { limitReached = true; break; }
    }
  } catch { scanError = true; }
  finally { if (dh) await dh.close().catch(() => {}); }

  names.sort(); names.reverse(); // 시계열 runId 최신 우선(best-effort — 아래 recordedAtMs desc 가 최종 권위)

  const cands: Array<{ runId: string; recordedAtMs: number; isMtime: boolean }> = [];
  let usedMtime = false;
  for (const name of names) {
    if (Date.now() - start > SCAN_DEADLINE_MS) { deadlineHit = true; break; }
    let l;
    try { l = await lstat(join(base, name)); } catch { continue; }
    if (l.isSymbolicLink() || !l.isDirectory()) continue; // symlink run dir backstop(권위는 safeRunDir)
    const bt = l.birthtimeMs;
    let recordedAtMs: number, isMtime = false;
    if (Number.isFinite(bt) && bt > 0) { recordedAtMs = bt; }
    else { recordedAtMs = l.mtimeMs; usedMtime = true; isMtime = true; }
    cands.push({ runId: name, recordedAtMs, isMtime });
  }
  cands.sort((a, b) => b.recordedAtMs - a.recordedAtMs || (b.runId < a.runId ? -1 : b.runId > a.runId ? 1 : 0));
  const recordedAtSource: "birthtime" | "mtime" = usedMtime ? "mtime" : "birthtime";

  const items: RunRef[] = [];
  let reads = 0;
  for (const c of cands) {
    if (Date.now() - start > SCAN_DEADLINE_MS) { deadlineHit = true; break; }
    if (reads >= MAX_RUNS_SCAN) { limitReached = true; break; } // 내용 read 상한(OOM 방어)
    reads++;
    const dir = await safeRunDir(root, c.runId, anchors, sub); // 권위 심링크/경계 거부·선계산 앵커
    if (!dir) continue;
    items.push({ runId: c.runId, dir, recordedAtMs: c.recordedAtMs, isMtime: c.isMtime });
  }
  const truncatedReason: BoundedRunEnum["truncatedReason"] =
    deadlineHit ? "deadline_exceeded" : limitReached ? "limit_reached" : scanError ? "scan_error" : null;
  return { items, scanned: reads, truncated: truncatedReason !== null, truncatedReason, recordedAtSource };
}

// 안전 run 디렉토리의 events.jsonl 을 스트리밍하며 스키마 통과 이벤트를 콜백에 전달(전체 read 금지·
//   readCappedLines 재사용·MAX_EVENTS_PER_RUN 캡). 파손/과대/부재 = 안전 skip(throw 없음).
// R1 HIGH(agy·DoS): (1) deadlineAt(공유 스캔 데드라인) 초과 시 즉시 중단, (2) 처리 라인 상한(MAX_EVENT_LINES_PER_RUN)
//   으로 파손 라인 폭주(유효 event 0·count 미증가) 무한루프 차단. 중단 사유를 정직 반환(caller 가 커버리지 truncatedReason 로 노출).
export interface StreamResult { truncated: boolean; reason: "deadline_exceeded" | "limit_reached" | null; }
export async function streamRunEvents(
  dir: string,
  onEvent: (e: Event) => void,
  opts: { maxEvents?: number; maxLines?: number; deadlineAt?: number } = {},
): Promise<StreamResult> {
  const maxEvents = opts.maxEvents ?? MAX_EVENTS_PER_RUN;
  const maxLines = opts.maxLines ?? MAX_EVENT_LINES_PER_RUN;
  const deadlineAt = opts.deadlineAt;
  const h = await safeOpen(dir, "events.jsonl");
  if (!h) return { truncated: false, reason: null };
  let count = 0;   // 유효 event
  let lines = 0;   // 처리 라인(파손 포함) — count 미증가 무한루프 바운드
  let reason: StreamResult["reason"] = null;
  try {
    for await (const line of readCappedLines(h, deadlineAt)) { // R2 HIGH: drain 구간 데드라인/바이트캡 주입
      if (deadlineAt !== undefined && Date.now() > deadlineAt) { reason = "deadline_exceeded"; break; } // 공유 데드라인
      if (++lines > maxLines) { reason = "limit_reached"; break; }  // 파손 라인 폭주 차단(무한루프 아님)
      if (!line || line.length > MAX_LINE) continue;
      let obj: unknown;
      try { obj = JSON.parse(line); } catch { continue; }
      const v = isSchemaValid(Event, obj);
      if (!v.ok) continue; // 구 events(agent/skill/usage=null 이어도 스키마 통과) 안전 파싱
      onEvent(v.value);
      if (++count >= maxEvents) { reason = "limit_reached"; break; } // 유효 event 상한 도달 = 부분 스캔(정직 노출)
    }
  } catch (e) {
    // R2 HIGH: readCappedLines 가 drain 구간서 데드라인/바이트캡 초과로 abort 하면 그 사유를 정직 반영.
    if (e instanceof LineReaderAbort) reason = e.abortReason;
    /* 그 외 읽기 오류 → 부분 스캔(수집분 유지) */
  }
  finally { await h.close().catch(() => {}); }
  return { truncated: reason !== null, reason };
}

export async function readRunAgents(root: string, runId: string) {
  const dir = await safeRunDir(root, runId);
  if (!dir) return { agents: [] };
  const adir = join(dir, "agents");
  let files: string[] = [];
  try {
    const entries = await readdir(adir, { withFileTypes: true });
    files = entries.filter((e) => e.isFile() && e.name.endsWith(".json")).map((e) => e.name);
  } catch { return { agents: [] }; }
  const agents = [];
  for (const f of files) {
    const v = await readCappedValidated(AgentState, adir, f); // agy#1: leaf symlink 거부 + 크기상한(OOM 방어)
    if (v.ok) agents.push(v.value);
  }
  return { agents };
}
