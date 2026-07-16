// OS 프로세스 어댑터 (설계 §4-B·§4-C). identity(shell·불투명 startTime)·group 생존·트리 종료.
// v0.5 shell 확정(native/Job Object=v0.6). POSIX=pgroup·kill(-pgid). Windows=taskkill /T + CreationDate.
// 안전 핵심: 오kill 방지 — lookup 실패(timeout)와 부재를 구분, SIGKILL 전 재검증, EPERM≠dead.
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const pexec = promisify(execFile);
const isWin = process.platform === "win32";

export type ProcIdentity = {
  pid: number;
  startTime: string;        // 불투명 문자열(정확일치 비교 — 파싱 금지)
  exe: string;
  groupId: number | string | null; // POSIX pgid | Windows pid-marker
};

// lookup 실패(exec timeout/spawn 오류)는 throw, "프로세스 부재"만 null.
export class IdentityLookupError extends Error {}

function isTransient(e: unknown): boolean {
  const err = e as { killed?: boolean; signal?: string; code?: unknown };
  // timeout(killed+SIGTERM) 또는 code 가 숫자 아님(spawn 실패 ENOENT 등) = transient. code 숫자 = ps 정상 실행 후 non-zero(부재).
  return err.killed === true || (err.code !== undefined && typeof err.code !== "number");
}

export async function identity(pid: number): Promise<ProcIdentity | null> {
  if (!Number.isInteger(pid) || pid <= 0) return null;
  try {
    if (isWin) {
      const { stdout } = await pexec("powershell", [
        "-NoProfile", "-NonInteractive", "-Command",
        `$p = Get-CimInstance Win32_Process -Filter "ProcessId=${pid}"; if ($p) { "$($p.CreationDate.ToString('o'))|$($p.ExecutablePath)" }`,
      ], { timeout: 10000, windowsHide: true });
      const line = stdout.trim();
      if (!line) return null; // 부재
      const [startTime, exe] = line.split("|");
      return { pid, startTime: startTime ?? "", exe: exe ?? "", groupId: `pid:${pid}` };
    }
    // POSIX: pgid(단일 토큰) 먼저, lstart(5필드) 나머지 → comm 공백 모호성 제거.
    const { stdout } = await pexec("ps", ["-o", "pgid=,lstart=", "-p", String(pid)], { timeout: 8000 });
    const line = stdout.trim();
    if (!line) return null; // 부재
    const sp = line.indexOf(" ");
    const pgid = Number.parseInt(line.slice(0, sp), 10);
    const startTime = line.slice(sp + 1).trim(); // lstart 전체(불투명)
    let exe = "";
    try { exe = (await pexec("ps", ["-o", "comm=", "-p", String(pid)], { timeout: 8000 })).stdout.trim(); } catch { /* best-effort */ }
    return { pid, startTime, exe, groupId: Number.isNaN(pgid) ? null : pgid };
  } catch (e) {
    if (isTransient(e)) throw new IdentityLookupError(String((e as Error).message ?? e));
    return null; // ps 정상 실행·non-zero → 프로세스 부재
  }
}

// process group 생존. ESRCH=dead, EPERM=alive(권한만 없음 — dead 아님).
export async function groupAlive(groupId: number | string | null, pid: number): Promise<boolean> {
  if (isWin || typeof groupId !== "number") {
    try { return (await identity(pid)) !== null; } catch { return true; } // lookup 실패 시 살아있다고 보수적 가정
  }
  try { process.kill(-groupId, 0); return true; }
  catch (e) { return (e as { code?: string }).code === "EPERM"; } // EPERM=alive, ESRCH=dead
}

// leader identity 가 expected 와 일치하는지. lookup 실패→null(호출측 보수 처리).
//   startTime 필수 대조. exe 는 best-effort 추가 게이트(양쪽 값 있을 때만 — 같은-초 PID 재사용 오kill 방어·R15 HIGH).
//   groupId!==null 이면 그룹까지 요구·null 이면 leader pid 단독 대조(leaf 러너 orphan; groupId 소실 시 quarantine capacity leak 방지·R15 MED).
async function verifyLeader(pid: number, groupId: number | string | null, expected: { startTime: string; exe?: string }): Promise<boolean | null> {
  let cur;
  try { cur = await identity(pid); } catch { return null; } // 미확인
  if (!cur) return false; // leader 부재(pid 부재)=확정 사멸
  if (!expected.startTime) return null;                                   // 기대 startTime 미확보=검증 불가(오kill·오release 금지·R18)
  if (cur.startTime !== expected.startTime) return false;                 // startTime 불일치=PID 재사용
  if (expected.exe && cur.exe && cur.exe !== expected.exe) return false;  // exe 대조(양쪽 값 있을 때만·하위호환)
  if (groupId !== null && String(cur.groupId) !== String(groupId)) return false; // 그룹 요구(null=leader 단독)
  return true;
}

// 우리 트리 사멸 여부. 단순 pid 존재 대신 leader identity(startTime/exe/group) 대조 — PID/PGID 재사용 시
//   엉뚱한 새 프로세스를 "생존"으로 오판해 orphan 슬롯을 영구 quarantine(capacity leak)하는 것을 막는다(R16 HIGH).
//   verifyLeader===false(부재/불일치=우리 것 아님)→사멸. true(우리 것 생존)→생존. null(lookup 미확인)→생존 보수.
//   leaf 러너 전제: leader 사멸=트리 사멸(자식 없음).
async function isTreeDead(groupId: number | string | null, pid: number, expected: { startTime: string; exe?: string }): Promise<boolean> {
  return (await verifyLeader(pid, groupId, expected)) === false;
}

// 트리 종료. **모든 시그널 직전 leader 재검증**(reuse 오kill 방지). 검증 불가/불일치 → 시그널 안 보냄.
// 반환: 종료 확인(true). 미확인/부분생존 → false(호출측이 kill-failed 처리·owner 보존).
export async function terminateTree(
  groupId: number | string | null, pid: number,
  expected: { startTime: string; exe: string }, graceMs = 3000,
): Promise<boolean> {
  const ok1 = await verifyLeader(pid, groupId, expected);
  if (ok1 !== true) return await isTreeDead(groupId, pid, expected); // 불일치/부재/미확인 → kill 안 함(오kill 방지)

  if (isWin) {
    if ((await verifyLeader(pid, groupId, expected)) !== true) return await isTreeDead(groupId, pid, expected);
    try { await pexec("taskkill", ["/T", "/F", "/PID", String(pid)], { timeout: 8000, windowsHide: true }); } catch { /* */ }
    return await isTreeDead(groupId, pid, expected);
  }
  const target = typeof groupId === "number" ? -groupId : pid;
  try { process.kill(target, "SIGTERM"); } catch { /* */ }
  await sleep(graceMs);
  if ((await verifyLeader(pid, groupId, expected)) === true) { // SIGKILL 직전 재검증(grace 중 reuse 방어)
    try { process.kill(target, "SIGKILL"); } catch { /* */ }
  }
  return await isTreeDead(groupId, pid, expected);
}

function sleep(ms: number): Promise<void> { return new Promise((r) => setTimeout(r, ms)); }
