// 하네스 구성 변경 이력(ledger) — 에이전트/스킬 추가·수정·삭제를 append-only 로 기록.
// UI 빌더(build/create)·편집(PUT definition)·삭제가 발생시킨 변경만 기록(정확·UI 발원). #/build(History) 표시 소스.
import { constants } from "node:fs";
import { open, mkdir } from "node:fs/promises";
import { join } from "node:path";

export type ConfigAction = "create" | "edit" | "delete";
export type ConfigChange = {
  at: string;                    // ISO 시각(호출측 주입·서버 시계)
  action: ConfigAction;
  kind: "agent" | "skill";
  name: string;
  runtime: string;               // 현재 claude 만(편집 대상)
  path: string;                  // sourcePath(.claude/agents/*.md · .claude/skills/*/SKILL.md)
};

const MAX_BYTES = 1 << 20;       // 리더 bound(1MB tail)
const dir = (root: string) => join(root, "_workspace");
const ledger = (root: string) => join(dir(root), "config-changes.jsonl");

// append(+fsync). best-effort — 실패해도 편집/생성 자체는 성공 유지(이력은 부가). O_APPEND 원자 append.
export async function appendConfigChange(root: string, e: ConfigChange): Promise<void> {
  try {
    await mkdir(dir(root), { recursive: true });
    const fh = await open(ledger(root), "a");
    try { await fh.appendFile(JSON.stringify(e) + "\n"); await fh.sync(); } finally { await fh.close(); }
  } catch { /* 이력 실패는 무시(편집 성공 불변) */ }
}

// 최근 N개(최신순) — 꼬리 손상 줄 discard(fail-open). bounded read.
export async function readConfigChanges(root: string, limit = 200): Promise<{ changes: ConfigChange[]; total: number }> {
  let raw = "";
  try {
    const fh = await open(ledger(root), constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      const st = await fh.stat();
      if (!st.isFile()) return { changes: [], total: 0 };
      const n = Math.min(st.size, MAX_BYTES);
      const buf = Buffer.alloc(n);
      await fh.read(buf, 0, n, Math.max(0, st.size - n));   // tail
      raw = buf.toString("utf8");
    } finally { await fh.close(); }
  } catch { return { changes: [], total: 0 }; }
  const out: ConfigChange[] = [];
  for (const ln of raw.split("\n")) {
    if (!ln.trim()) continue;
    try {
      const o = JSON.parse(ln);
      if (o && typeof o.at === "string" && typeof o.name === "string" && typeof o.action === "string") out.push(o as ConfigChange);
    } catch { /* 손상 줄(대개 잘린 첫 줄) discard */ }
  }
  out.reverse();  // 최신순
  return { changes: out.slice(0, limit), total: out.length };
}
