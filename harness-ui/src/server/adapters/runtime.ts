// 런타임 감지 (설계 §API /api/runtimes). claude/codex/agy 설치·버전·경로 + 비-TTY 인증 상태.
import { safeExec } from "../lib/exec.js";
import { stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

// authenticated: "authenticated" | "configured" | "unauthenticated" | "unknown"
//   - claude: `claude auth status`(JSON .loggedIn) — 비-TTY 지원.
//   - codex: `codex login status`("Logged in …") — 비-TTY 지원.
//   - agy: 비-TTY status 미지원(bubbletea /dev/tty 요구) → 자격 파일(`~/.gemini/oauth_creds.json`) 기반 추정.
//     존재+현재유저 owner="configured"(설정 감지), 부재="unauthenticated", owner 검증 불가(Windows)="unknown". "인증됨" 단정 아님(만료/폐기 미구분).
export type RuntimeInfo = { installed: boolean; version: string | null; path: string | null; authenticated: string };

async function probeAuth(bin: string): Promise<string> {
  if (bin === "claude") {
    const r = await safeExec("claude", ["auth", "status"], { timeoutMs: 8000 });
    if (!r.ok) return "unknown";
    try {
      const j = JSON.parse(r.stdout) as { loggedIn?: boolean; subscriptionType?: string };
      if (j.loggedIn === true) return j.subscriptionType ? `authenticated (${j.subscriptionType})` : "authenticated";
      if (j.loggedIn === false) return "unauthenticated";
    } catch { /* 비-JSON 출력 → unknown */ }
    return "unknown";
  }
  if (bin === "codex") {
    const r = await safeExec("codex", ["login", "status"], { timeoutMs: 8000 });
    if (!r.ok) return "unknown";
    // codex 는 "Logged in …" 을 stderr 로 출력(stdout 비어있음) → 두 스트림 결합 검사.
    const out = `${r.stdout}\n${r.stderr}`;
    if (/not logged in|logged out/i.test(out)) return "unauthenticated";
    if (/logged in/i.test(out)) return "authenticated";
    return "unknown";
  }
  // agy(Gemini): CLI 비대화형 인증 조회 미지원. **자격 파일 근거**로 상태 추정(F17·design §7-4):
  //   ~/.gemini/oauth_creds.json 존재 + 현재 유저 owner → "configured(설정 감지)". 부재 → "unauthenticated".
  //   내용 미판독(비밀 미접근). "인증됨" 단정 금지(만료/폐기 구분 불가).
  //   - stat(=심링크 추종): stow 등으로 자격 파일을 심링크한 파워유저도 정상 감지(agy LOW).
  //   - owner 검증 불가 환경(Windows·getuid 부재)에서는 "configured" 단정 금지 → "unknown"(정직·codex MED).
  if (bin === "agy" || bin === "gemini") {
    try {
      const st = await stat(join(homedir(), ".gemini", "oauth_creds.json"));
      if (!st.isFile()) return "unauthenticated";
      if (typeof process.getuid !== "function") return "unknown"; // owner 검증 불가 → 단정 금지
      return st.uid === process.getuid() ? "configured" : "unauthenticated";
    } catch { return "unauthenticated"; }
  }
  return "unknown";
}

async function probe(bin: string): Promise<RuntimeInfo> {
  // safeExec 이 내부에서 PATH 해소(중복 resolve 제거). path 없으면 미설치.
  const r = await safeExec(bin, ["--version"], { timeoutMs: 5000 });
  if (!r.path) return { installed: false, version: null, path: null, authenticated: "unknown" };
  const version = r.ok ? (r.stdout.trim().split(/\r?\n/)[0] ?? null) : null;
  // 설치된 런타임만 인증 조회(미설치는 스킵).
  const authenticated = await probeAuth(bin);
  return { installed: true, version, path: r.path, authenticated };
}

export async function detectRuntimes(): Promise<Record<string, RuntimeInfo>> {
  const [claude, codex, agy] = await Promise.all([probe("claude"), probe("codex"), probe("agy")]);
  return { claude, codex, agy };
}
