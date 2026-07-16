// M-y3 E2E — 배치 검토→일괄 적용 HTTP 경로(buildServer.inject). 러너 spawn 은 dogfood(P0)로 실측; 여기선
//   ready 결과를 fixture 로 심어 readBatch→readRemediationResult(실검증)→getDefinition→putDefinition(실 F7·백업)
//   전 구간을 결정적으로 커버. 무손실 요약·초안 baseHash 낙관적 동시성 확인.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { buildServer } from "../src/server/index.js";
import { EDIT_OPEN, EDIT_CLOSE } from "../src/server/adapters/remediate.js";

const sha = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");
const skillDef = (n: string) => `---\nname: ${n}\ndescription: 짧은 설명\n---\n# ${n}\n본문.\n`;
const proposedDef = (n: string) => `---\nname: ${n}\ndescription: 이 스킬은 ${n} 작업을 구체적 트리거와 함께 수행합니다 — 명확한 사용 시점 포함\n---\n# ${n}\n본문.\n`;
const wrap = (inner: string) => `${EDIT_OPEN}\n${inner}\n${EDIT_CLOSE}`;
const resultLine = (text: string) => JSON.stringify({ type: "result", subtype: "success", is_error: false, result: text });

let root: string, stateDir: string;
const origState = process.env.HARNESS_STATE_HOME;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "hui-e2e-"));
  stateDir = await mkdtemp(join(tmpdir(), "hui-e2estate-"));
  process.env.HARNESS_STATE_HOME = stateDir;
  await writeFile(join(stateDir, "config.json"), JSON.stringify({ schemaVersion: "1", definitionEditEnabled: true, projectRoot: root }), "utf8");
});
afterEach(async () => {
  if (origState === undefined) delete process.env.HARNESS_STATE_HOME; else process.env.HARNESS_STATE_HOME = origState;
  await rm(root, { recursive: true, force: true }); await rm(stateDir, { recursive: true, force: true });
});
const app = () => buildServer({ projectRoot: root });

// 스킬 정의 + ready remediation run(fixture) + 배치 item.
async function seedTarget(name: string, runId: string) {
  await mkdir(join(root, ".claude", "skills", name), { recursive: true });
  await writeFile(join(root, ".claude", "skills", name, "SKILL.md"), skillDef(name), "utf8");
  const dir = join(root, "_workspace", "runs", runId);
  await mkdir(join(dir, "remediation"), { recursive: true });
  await writeFile(join(dir, "status.json"), JSON.stringify({ schemaVersion: "1", runId, state: "completed" }), "utf8");
  await writeFile(join(dir, "raw.jsonl"), `{"type":"system","subtype":"init"}\n${resultLine(wrap(proposedDef(name)))}\n`, "utf8");
  await writeFile(join(dir, "remediation", "request.json"),
    JSON.stringify({ kind: "skill", name, baseHash: sha(skillDef(name)), originalContent: skillDef(name), findings: [{ action: "rewrite-description", why: "설명 보강" }] }), "utf8");
  return { kind: "skill" as const, name, baseHash: sha(skillDef(name)), baseCanonicalHash: "c", findings: [], runId, status: "running" as const };
}

// Windows 는 정의 mutation 이 기본 차단(501 unsupported-platform-write·v0.8 확립 정책·safePathWindows 증명 전)이라
//   PUT 적용을 검증하는 이 E2E 는 POSIX 전용. 기존 defedit/driftsync mutation 스위트와 동일 가드.
describe.skipIf(process.platform === "win32")("M-y3 배치 검토→일괄 적용 E2E (HTTP·결정적)", () => {
  it("3개 대상 배치 → GET ready 집계 → 대상별 초안 조회 → PUT 적용 → 무손실", async () => {
    const batchId = "2026-07-16T00-00-00-000Z-batch-e2edeadbeef";
    const items = [await seedTarget("alpha", `${batchId}-0`), await seedTarget("beta", `${batchId}-1`), await seedTarget("gamma", `${batchId}-2`)];
    await mkdir(join(root, "_workspace", "batches", batchId), { recursive: true });
    await writeFile(join(root, "_workspace", "batches", batchId, "batch.json"), JSON.stringify({ batchId, createdAt: "t", items }), "utf8");
    const a = app();

    // 1) GET 배치 → 3개 ready(readRemediationResult 실검증)·done 집계.
    const gv = await a.inject({ url: `/api/eval/remediate/batch/${batchId}` });
    expect(gv.statusCode).toBe(200);
    const view = gv.json();
    expect(view.total).toBe(3);
    expect(view.items.filter((i: { status: string }) => i.status === "ready").length).toBe(3);
    expect(view.items.every((i: { stale?: boolean }) => i.stale === false)).toBe(true); // 현재 정의==초안 base

    // 2) 대상별 초안 조회 → PUT 적용(초안 baseHash 낙관적 동시성). 3) 무손실 확인.
    let applied = 0;
    for (const it of items) {
      const rem = (await a.inject({ url: `/api/eval/remediate/${it.runId}` })).json();
      expect(rem.status).toBe("ready");
      const def = (await a.inject({ url: `/api/skills/${it.name}/definition` })).json();
      const put = await a.inject({ method: "PUT", url: `/api/skills/${it.name}/definition`, payload: { content: rem.proposedContent, baseHash: rem.baseHash, pathId: def.pathId } });
      expect(put.statusCode).toBe(200);
      applied++;
      const onDisk = await readFile(join(root, ".claude", "skills", it.name, "SKILL.md"), "utf8");
      expect(onDisk).toContain("구체적 트리거"); // 초안이 실제로 파일에 반영
    }
    expect(applied).toBe(3); // 무손실 — 3개 전부 적용

    // 백업·롤백 계약 — alpha 를 되돌리면 원본 복원(rollback 성공 = 백업본이 실제로 생성됐다는 증거).
    const put0 = (await a.inject({ method: "PUT", url: `/api/skills/alpha/definition`, payload: {
      content: proposedDef("alpha") + "\n추가\n", baseHash: sha(proposedDef("alpha")), pathId: (await a.inject({ url: "/api/skills/alpha/definition" })).json().pathId } })).json();
    const rb = await a.inject({ method: "POST", url: `/api/skills/alpha/definition/rollback`, payload: { expectedCurrentHash: put0.newHash, backupHash: put0.prevHash } });
    expect(rb.statusCode).toBe(200); // 백업 존재+복원 성공
    const restored = await readFile(join(root, ".claude", "skills", "alpha", "SKILL.md"), "utf8");
    expect(restored).not.toContain("추가"); // 직전 상태(proposed)로 복원
  });

  it("초안 base 와 현재 정의가 다르면(stale) 적용이 409 로 차단(동시 수정 유실 방지)", async () => {
    const batchId = "2026-07-16T00-00-00-000Z-batch-stalecafe";
    const it = await seedTarget("delta", `${batchId}-0`);
    await mkdir(join(root, "_workspace", "batches", batchId), { recursive: true });
    await writeFile(join(root, "_workspace", "batches", batchId, "batch.json"), JSON.stringify({ batchId, createdAt: "t", items: [it] }), "utf8");
    const a = app();
    // 외부에서 정의를 수정(초안 base 와 달라짐).
    await writeFile(join(root, ".claude", "skills", "delta", "SKILL.md"), skillDef("delta") + "\n외부 수정\n", "utf8");
    const rem = (await a.inject({ url: `/api/eval/remediate/${it.runId}` })).json();
    expect(rem.status).toBe("ready"); expect(rem.stale).toBe(true); // 서버가 stale 판정
    // 초안 base 로 PUT → 현재 정의와 불일치 → 409(현재본 위 초안 덮어쓰기 차단).
    const def = (await a.inject({ url: `/api/skills/delta/definition` })).json();
    const put = await a.inject({ method: "PUT", url: `/api/skills/delta/definition`, payload: { content: rem.proposedContent, baseHash: rem.baseHash, pathId: def.pathId } });
    expect(put.statusCode).toBe(409); // stale-write 차단
  });
});
