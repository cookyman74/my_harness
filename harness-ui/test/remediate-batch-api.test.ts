// M-y1 배치 라우트 — edit-gate 403·캡 400·경로 분리(batch vs :runId)·404. 실행(spawn) 경로는 유닛(remediate-batch.test)에서.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildServer } from "../src/server/index.js";

let root: string, stateDir: string;
const origState = process.env.HARNESS_STATE_HOME;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "hui-rba-"));
  stateDir = await mkdtemp(join(tmpdir(), "hui-rbastate-"));
  process.env.HARNESS_STATE_HOME = stateDir;
  await mkdir(join(root, ".claude", "skills", "beta"), { recursive: true });
  await writeFile(join(root, ".claude", "skills", "beta", "SKILL.md"), "---\nname: beta\ndescription: beta skill\n---\n# body\n");
});
afterEach(async () => {
  if (origState === undefined) delete process.env.HARNESS_STATE_HOME; else process.env.HARNESS_STATE_HOME = origState;
  await rm(root, { recursive: true, force: true }); await rm(stateDir, { recursive: true, force: true });
});

function app() { return buildServer({ projectRoot: root }); }
async function setGate(enabled: boolean) {
  await writeFile(join(stateDir, "config.json"), JSON.stringify({ schemaVersion: "1", definitionEditEnabled: enabled }), "utf8");
}
const post = (body: unknown) => app().inject({ method: "POST", url: "/api/eval/remediate/batch", payload: body as object });

describe("POST /api/eval/remediate/batch — 게이트·캡·검증", () => {
  it("edit-disabled → 403(fail-closed)", async () => {
    await setGate(false);
    const r = await post({ targets: [{ kind: "skill", name: "beta" }] });
    expect(r.statusCode).toBe(403);
    expect(r.json().error).toBe("edit-disabled");
  });

  it("빈 body/빈 targets → 400 invalid-body", async () => {
    await setGate(true);
    expect((await post({})).statusCode).toBe(400);
    expect((await post({ targets: [] })).statusCode).toBe(400);
  });

  it("대상>50 → 400 too-many-targets", async () => {
    await setGate(true);
    const targets = Array.from({ length: 51 }, (_, i) => ({ kind: "skill", name: `s${i}` }));
    const r = await post({ targets });
    expect(r.statusCode).toBe(400);
    expect(r.json().error).toBe("too-many-targets");
  });

  it("traversal 이름 → 다운스트림 경로안전(safeDefPath)이 invalid 처리 → no-valid-targets(크래시·경로탈출 없음)", async () => {
    await setGate(true);
    const r = await post({ targets: [{ kind: "skill", name: "../evil" }] });
    expect(r.statusCode).toBe(400);
    expect(r.json().error).toBe("no-valid-targets"); // 정의 해석 실패=invalid item → 실행분 0
  });

  it("초과 필드 → 400(strict)", async () => {
    await setGate(true);
    const r = await post({ targets: [{ kind: "skill", name: "beta" }], extra: 1 });
    expect(r.statusCode).toBe(400);
  });
});

describe("GET /api/eval/remediate/batch/:batchId — 게이트·경로 분리·404", () => {
  it("edit-disabled → 403", async () => {
    await setGate(false);
    const r = await app().inject({ url: "/api/eval/remediate/batch/batch-x" });
    expect(r.statusCode).toBe(403);
  });

  it("잘못된 batchId 형식 → 400(traversal 차단)", async () => {
    await setGate(true);
    const r = await app().inject({ url: "/api/eval/remediate/batch/..%2f..%2fetc" });
    expect(r.statusCode).toBe(400);
  });

  it("존재하지 않는 batchId → 404(단건 :runId 와 경로 분리)", async () => {
    await setGate(true);
    const r = await app().inject({ url: "/api/eval/remediate/batch/batch-nope" });
    expect(r.statusCode).toBe(404);
    expect(r.json().error).toBe("not-found");
  });

  it("newRunId 형식 batchId(<TS>-batch-<hex>) GET → 200(정규식이 실제 id 를 막지 않음·R3 HIGH)", async () => {
    await setGate(true);
    const batchId = "2026-07-16T13-24-31-230Z-batch-a1b2c3d4e5f6"; // newRunId 형식(선두 숫자·batch 는 중간)
    const dir = join(root, "_workspace", "batches", batchId);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "batch.json"), JSON.stringify({ batchId, createdAt: "t", items: [] }), "utf8");
    const r = await app().inject({ url: `/api/eval/remediate/batch/${batchId}` });
    expect(r.statusCode).toBe(200);
    expect(r.json().batchId).toBe(batchId);
  });
});
