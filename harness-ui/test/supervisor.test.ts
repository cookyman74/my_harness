import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, rm, writeFile, readFile, appendFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { ingest, spawnRun, writeManifest, SUPERVISOR_VERSION } from "../src/server/supervisor/supervisor.js";
import { Event, Status, AgentState, Manifest, isSchemaValid } from "../src/server/schemas.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
let stateDir: string;

const manifest = (runId: string): Manifest => ({
  schemaVersion: "1", runId, projectRoot: "/x", runtime: "codex", mode: "build",
  createdAt: "2026-07-09T10:00:00+09:00", requestedBy: "test", goal: "g", agents: [], agent: null,
  targets: [], permissionMode: "read-only", model: "default", supervisorVersion: SUPERVISOR_VERSION,
});
const raw = (o: object) => JSON.stringify({ ts: "2026-07-09T10:00:00+09:00", level: "info", event: "x", ...o }) + "\n";

async function eventsOf(runDir: string) {
  const t = await readFile(join(runDir, "events.jsonl"), "utf8").catch(() => "");
  return t.split("\n").filter(Boolean).map((l) => JSON.parse(l));
}

beforeAll(async () => { stateDir = await mkdtemp(join(tmpdir(), "hui-state-")); process.env.HARNESS_STATE_HOME = stateDir; });
afterAll(async () => { await rm(stateDir, { recursive: true, force: true }); delete process.env.HARNESS_STATE_HOME; });

describe("supervisor ingest — schema-valid 저자(A6be)", () => {
  it("raw 로그 → supervisor가 schema-valid manifest/status/events/agents 생성", async () => {
    const runDir = await mkdtemp(join(tmpdir(), "hui-run-"));
    await writeManifest(runDir, manifest("run-a"));
    await writeFile(join(runDir, "raw.jsonl"),
      raw({ agent: "planner", phase: "P1", event: "agent_started", progress: 20 }) +
      raw({ agent: "planner", phase: "P1", event: "agent_completed", progress: 50 }) +
      raw({ agent: "builder", phase: "P2", event: "agent_completed", progress: 100, state: "completed" }));
    const n = await ingest(runDir);
    expect(n).toBe(3);
    // events schema-valid + seq 연속
    const evs = await eventsOf(runDir);
    expect(evs.map((e) => e.seq)).toEqual([0, 1, 2]);
    for (const e of evs) expect(isSchemaValid(Event, e).ok).toBe(true);
    // status schema-valid, 최종 state/phase/progress
    const st = JSON.parse(await readFile(join(runDir, "status.json"), "utf8"));
    expect(isSchemaValid(Status, st).ok).toBe(true);
    expect(st.state).toBe("completed"); expect(st.progress).toBe(100); expect(st.phase).toBe("P2");
    // agents schema-valid
    const pa = JSON.parse(await readFile(join(runDir, "agents", "planner.json"), "utf8"));
    expect(isSchemaValid(AgentState, pa).ok).toBe(true);
    expect(pa.state).toBe("completed");
    await rm(runDir, { recursive: true, force: true });
  });
});

describe("events append 무재작성(A24) + 재시작 커서 무손실·무중복(A25)", () => {
  it("2차 ingest는 신규만 append, 이전 내용 보존, seq 연속", async () => {
    const runDir = await mkdtemp(join(tmpdir(), "hui-run2-"));
    await writeManifest(runDir, manifest("run-b"));
    await writeFile(join(runDir, "raw.jsonl"), raw({ event: "a" }) + raw({ event: "b" }));
    expect(await ingest(runDir)).toBe(2);
    const firstBytes = await readFile(join(runDir, "events.jsonl"), "utf8");
    // 부분 라인(개행 없음) 추가 — 이번엔 이월돼야
    await appendFile(join(runDir, "raw.jsonl"), raw({ event: "c" }) + `{"event":"partial-no-newline"`);
    const n2 = await ingest(runDir);
    expect(n2).toBe(1); // c만(부분 라인 이월)
    const after = await readFile(join(runDir, "events.jsonl"), "utf8");
    expect(after.startsWith(firstBytes)).toBe(true); // A24: append(이전 바이트 보존)
    const evs = await eventsOf(runDir);
    expect(evs.map((e) => e.seq)).toEqual([0, 1, 2]); // A25: seq 연속·중복 없음
    expect(evs.map((e) => e.event)).toEqual(["a", "b", "c"]);
    // 부분 라인 완성 후 재ingest → 이월분 처리
    await appendFile(join(runDir, "raw.jsonl"), `,"ts":"2026-07-09T10:00:00+09:00","level":"info"}\n`);
    const n3 = await ingest(runDir);
    expect(n3).toBe(1);
    expect((await eventsOf(runDir)).map((e) => e.seq)).toEqual([0, 1, 2, 3]);
    await rm(runDir, { recursive: true, force: true });
  });
});

describe("크래시 중복방지(A25) + status/agent baseline 유지", () => {
  it("커서 유실(크래시 시뮬) 후 재ingest → 중복 없음", async () => {
    const runDir = await mkdtemp(join(tmpdir(), "hui-crash-"));
    await writeManifest(runDir, manifest("run-crash"));
    await writeFile(join(runDir, "raw.jsonl"), raw({ event: "a" }) + raw({ event: "b" }));
    expect(await ingest(runDir)).toBe(2);
    // 크래시 시뮬: events 는 durable(seq 0,1) 이나 커서가 초기값으로 유실됨
    await writeFile(join(runDir, ".cursor.json"), JSON.stringify({ offset: 0, lastSeq: -1 }));
    const n2 = await ingest(runDir); // 재처리하되 existingMax=1 로 중복 append 안 함
    expect(n2).toBe(0);
    const evs = await eventsOf(runDir);
    expect(evs.map((e) => e.seq)).toEqual([0, 1]); // 중복 없음
    await rm(runDir, { recursive: true, force: true });
  });
  it("torn events.jsonl 라인(크래시 mid-append) → repair 후 오염 없음", async () => {
    const runDir = await mkdtemp(join(tmpdir(), "hui-torn-"));
    await writeManifest(runDir, manifest("run-torn"));
    // 정상 이벤트 1개 + torn 라인(개행 없음)을 events.jsonl 에 직접 심음
    await writeFile(join(runDir, "events.jsonl"),
      `{"seq":0,"ts":"2026-07-09T10:00:00+09:00","level":"info","agent":null,"skill":null,"phase":"p","event":"a","message":"","usage":null}\n` +
      `{"seq":1,"ts":"2026-07-09T10:00:00+09:00","level":"info"`); // torn(개행·중괄호 없음)
    await writeFile(join(runDir, "raw.jsonl"), raw({ event: "b" }) + raw({ event: "c" }));
    await ingest(runDir);
    const evs = await eventsOf(runDir); // 모든 라인이 유효 JSON이어야(torn 제거됨)
    for (const e of evs) expect(typeof e.seq).toBe("number");
    expect(evs.every((e) => e.event !== undefined)).toBe(true); // 오염 라인 없음
    await rm(runDir, { recursive: true, force: true });
  });
  it("raw.agent traversal(../..) → agents 파일 임의쓰기 차단", async () => {
    const runDir = await mkdtemp(join(tmpdir(), "hui-trav-"));
    await writeManifest(runDir, manifest("run-trav"));
    await writeFile(join(runDir, "raw.jsonl"),
      raw({ agent: "../../pwned", event: "agent_started" }) +
      raw({ agent: "planner", event: "agent_completed" }));
    await ingest(runDir);
    const { readdir } = await import("node:fs/promises");
    const files = await readdir(join(runDir, "agents")).catch(() => [] as string[]);
    expect(files).toContain("planner.json");
    expect(files.some((f) => f.includes(".."))).toBe(false); // traversal 이름 파일 없음
    // 상위(runDir 밖)에 pwned.json 안 생김
    const { stat } = await import("node:fs/promises");
    await expect(stat(join(runDir, "..", "pwned.json"))).rejects.toBeTruthy();
    await rm(runDir, { recursive: true, force: true });
  });
  it("단말(cancelled) 상태는 sticky — 잔여 raw line 의 state:running 이 되돌리지 못함(R22)", async () => {
    const runDir = await mkdtemp(join(tmpdir(), "hui-sticky-"));
    await writeManifest(runDir, manifest("run-sticky"));
    // cancel 이 status 를 cancelled 로 기록한 상태 모사
    const { writeStatus } = await import("../src/server/supervisor/supervisor.js");
    const cancelled: Status = {
      schemaVersion: "1", runId: "run-sticky", state: "cancelled", phase: "p", progress: 80,
      updatedAt: "2026-07-09T10:00:00+09:00", heartbeatAt: "2026-07-09T10:00:00+09:00",
      serverPid: 1, serverStartTime: "x", childPid: null, childStartTime: null, childProcessGroupId: null,
      exitCode: null, exitSignal: null, cancelRequestedAt: null, stateReason: "user", summary: "", error: null,
    };
    await writeStatus(runDir, cancelled);
    // 취소 직전 child 가 남긴 running 이벤트가 커서에 남아있는 상황
    await writeFile(join(runDir, "raw.jsonl"), raw({ event: "still-working", state: "running", progress: 80 }));
    await ingest(runDir);
    const st = JSON.parse(await readFile(join(runDir, "status.json"), "utf8"));
    expect(st.state).toBe("cancelled"); // running 으로 clobber 안 됨
    await rm(runDir, { recursive: true, force: true });
  });
  it("state 없는 배치가 completed 를 running 으로 regress 안 함", async () => {
    const runDir = await mkdtemp(join(tmpdir(), "hui-base-"));
    await writeManifest(runDir, manifest("run-base"));
    await writeFile(join(runDir, "raw.jsonl"), raw({ event: "done", state: "completed", progress: 100, phase: "P9" }));
    await ingest(runDir);
    expect(JSON.parse(await readFile(join(runDir, "status.json"), "utf8")).state).toBe("completed");
    // state 없는 후속 배치
    await appendFile(join(runDir, "raw.jsonl"), raw({ event: "trailing-log" }));
    await ingest(runDir);
    const st = JSON.parse(await readFile(join(runDir, "status.json"), "utf8"));
    expect(st.state).toBe("completed"); // regress 안 됨
    expect(st.phase).toBe("P9"); expect(st.progress).toBe(100);
    await rm(runDir, { recursive: true, force: true });
  });
});

describe("spawnRun e2e — mock runner", () => {
  it("spawn → raw.jsonl 생성 → ingest → schema-valid", async () => {
    const runDir = await mkdtemp(join(tmpdir(), "hui-spawn-"));
    await writeManifest(runDir, manifest("run-c"));
    const mock = join(__dirname, "fixtures", "mock-runner.mjs");
    await spawnRun(runDir, process.execPath, [mock]);
    // child 완료 대기(짧음). 폴링.
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 50));
      const t = await readFile(join(runDir, "raw.jsonl"), "utf8").catch(() => "");
      if (t.split("\n").filter(Boolean).length >= 4) break;
    }
    const n = await ingest(runDir);
    expect(n).toBeGreaterThanOrEqual(4);
    const st = JSON.parse(await readFile(join(runDir, "status.json"), "utf8"));
    expect(isSchemaValid(Status, st).ok).toBe(true);
    expect(st.state).toBe("completed");
    await rm(runDir, { recursive: true, force: true });
  });
});
