// @vitest-environment jsdom
// M-y2 웹 — 배치 초안 API 클라이언트 계약 소비 고정(URL·method·body/응답 shape·토큰 첨부). 서버 Zod 계약과 정확 일치.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { startBatchRemediate, getBatch, type BatchView } from "../src/web/api.js";

const KEY = "harness-session";
beforeEach(() => { sessionStorage.clear(); vi.restoreAllMocks(); });
function okJson(body: unknown, status = 200): Response {
  return { ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) } as unknown as Response;
}
function errJson(status: number, body: unknown): Response {
  return { ok: false, status, json: async () => body } as unknown as Response;
}

describe("startBatchRemediate — POST /api/eval/remediate/batch", () => {
  it("targets 전송·토큰 첨부·응답 shape 소비", async () => {
    sessionStorage.setItem(KEY, "sess");
    const fetchMock = vi.fn(async () => okJson({ batchId: "2026-07-16T00-00-00-000Z-batch-abcdef", queued: 2, skipped: 1 }, 202));
    vi.stubGlobal("fetch", fetchMock);
    const r = await startBatchRemediate([{ kind: "skill", name: "alpha" }, { kind: "agent", name: "beta" }]);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/eval/remediate/batch");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer sess");
    expect(JSON.parse(init.body as string)).toEqual({ targets: [{ kind: "skill", name: "alpha" }, { kind: "agent", name: "beta" }] });
    expect(r).toEqual({ batchId: "2026-07-16T00-00-00-000Z-batch-abcdef", queued: 2, skipped: 1 });
  });

  it("queue-full 429 → DefEditError(code 보존)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => errJson(429, { error: "queue-full" })));
    await expect(startBatchRemediate([{ kind: "skill", name: "x" }])).rejects.toMatchObject({ code: "queue-full" });
  });

  it("too-many-targets 400 → DefEditError", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => errJson(400, { error: "too-many-targets" })));
    await expect(startBatchRemediate([{ kind: "skill", name: "x" }])).rejects.toMatchObject({ code: "too-many-targets" });
  });
});

describe("getBatch — GET /api/eval/remediate/batch/:batchId", () => {
  it("batchId 인코딩·집계 shape 소비", async () => {
    const view: BatchView = { batchId: "b1", done: 1, total: 2, items: [
      { kind: "skill", name: "alpha", status: "ready", runId: "r1", stale: false },
      { kind: "agent", name: "beta", status: "running", runId: "r2" },
    ] };
    const fetchMock = vi.fn(async () => okJson(view));
    vi.stubGlobal("fetch", fetchMock);
    const r = await getBatch("2026-07-16T00-00-00-000Z-batch-abcdef");
    expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toBe("/api/eval/remediate/batch/2026-07-16T00-00-00-000Z-batch-abcdef");
    expect(r).toEqual(view);
  });

  it("404 → DefEditError not-found", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => errJson(404, { error: "not-found" })));
    await expect(getBatch("batch-none")).rejects.toMatchObject({ code: "not-found" });
  });
});
