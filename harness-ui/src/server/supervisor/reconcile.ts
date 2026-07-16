// reconcile / cancel (설계 §4-A·§4-C). kill 은 3중+ 검증(서명·identity·startTime·exe·groupId) 통과 시에만.
// 단일 근거 kill 절대 금지. 불일치→kill 안 함. lookup 실패→미결정(owner 보존·재시도). leaderless group 정리.
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { readOwner, removeOwner } from "./registry.js";
import { identity, groupAlive, terminateTree, IdentityLookupError } from "./osadapter.js";
import { writeStatus } from "./supervisor.js";
import { Status, isSchemaValid, type RunState } from "../schemas.js";

export type ReconcileResult =
  | { action: "none"; reason: string }
  | { action: "killed"; reason: string }
  | { action: "kill-failed"; reason: string }
  | { action: "skipped-mismatch"; reason: string }
  | { action: "indeterminate"; reason: string }   // lookup 실패 → owner 보존, 재시도 대상
  | { action: "gone"; reason: string };

async function setState(runDir: string, state: RunState, reason: string): Promise<void> {
  const raw = await readFile(join(runDir, "status.json"), "utf8").catch(() => null);
  let st: Status | null = null;
  if (raw) { const v = isSchemaValid(Status, (() => { try { return JSON.parse(raw); } catch { return null; } })()); if (v.ok) st = v.value; }
  if (!st) return;
  st.state = state; st.stateReason = reason; st.updatedAt = new Date().toISOString();
  await writeStatus(runDir, st);
}

export async function reconcileRun(
  runDir: string, runId: string,
  opts: { terminate: boolean; finalState: RunState } = { terminate: true, finalState: "stale" },
): Promise<ReconcileResult> {
  const owner = await readOwner(runId);
  if (!owner) { await setState(runDir, opts.finalState, "no-signed-owner"); return { action: "none", reason: "no-signed-owner" }; }

  let id;
  try { id = await identity(owner.pid); }
  catch (e) {
    if (e instanceof IdentityLookupError) return { action: "indeterminate", reason: "identity-lookup-failed" }; // owner 보존·재시도
    throw e;
  }

  if (!id) {
    // leader 부재. leaderless group 이 살아있으면 소유권 검증 불가(leader identity 없음) → **kill 안 함**(오kill 방지).
    // stale 표시만(고아 잔존 = 알려진 v0.5 갭 A21b → v0.6 Job Object 로 완전 정리). owner 보존(재시도/v0.6).
    if (owner.groupId !== null && await groupAlive(owner.groupId, owner.pid)) {
      await setState(runDir, opts.finalState, "leaderless-group-unverifiable(v0.6-jobobject)");
      return { action: "skipped-mismatch", reason: "leaderless-unverifiable" };
    }
    await setState(runDir, opts.finalState, "process-gone");
    await removeOwner(runId);
    return { action: "gone", reason: "process-gone" };
  }

  // 검증: startTime(불투명 정확일치) 필수 + exe/groupId best-effort(양쪽 값 있을 때만·verifyLeader R15 와 정합).
  //   exe/groupId 를 strict 로 요구하면 transient comm/pgid lookup 실패로 빈 owner 메타가 기록된 경우
  //   유효 run 을 reuse 로 오판해 cancel 이 영구 무효화된다(R17). startTime 이 재사용 방어의 주 게이트.
  const exeMismatch = !!id.exe && !!owner.exe && id.exe !== owner.exe;
  const groupMismatch = owner.groupId !== null && String(id.groupId) !== String(owner.groupId);
  if (id.startTime !== owner.startTime || exeMismatch || groupMismatch) {
    await setState(runDir, opts.finalState, "identity-mismatch(reuse)");
    return { action: "skipped-mismatch", reason: "identity-mismatch" };
  }
  if (!opts.terminate) return { action: "none", reason: "verified-alive" };

  // cancel TOCTOU: kill 직전 status 재확인 — 그새 terminal 되었으면 덮지 않음(멱등).
  if (opts.finalState === "cancelled") {
    const raw = await readFile(join(runDir, "status.json"), "utf8").catch(() => null);
    if (raw) { const v = isSchemaValid(Status, (() => { try { return JSON.parse(raw); } catch { return null; } })()); if (v.ok && ["completed", "failed", "cancelled"].includes(v.value.state)) return { action: "none", reason: `raced-terminal(${v.value.state})` }; }
  }
  const dead = await terminateTree(owner.groupId, owner.pid, { startTime: owner.startTime, exe: owner.exe });
  if (dead) { await setState(runDir, opts.finalState, "terminated-after-verify"); await removeOwner(runId); return { action: "killed", reason: "verified" }; }
  await setState(runDir, opts.finalState, "kill-incomplete"); // 종료 미확인 → owner 보존
  return { action: "kill-failed", reason: "still-alive-after-terminate" };
}

export async function cancelRun(runDir: string, runId: string): Promise<ReconcileResult> {
  // terminal 상태면 멱등 — 재작성/재kill 안 함(완료/실패/취소된 run 을 cancelled 로 덮지 않음).
  const raw = await readFile(join(runDir, "status.json"), "utf8").catch(() => null);
  if (raw) {
    const v = isSchemaValid(Status, (() => { try { return JSON.parse(raw); } catch { return null; } })());
    if (v.ok && ["completed", "failed", "cancelled"].includes(v.value.state)) {
      return { action: "none", reason: `already-terminal(${v.value.state})` };
    }
  }
  return reconcileRun(runDir, runId, { terminate: true, finalState: "cancelled" });
}
