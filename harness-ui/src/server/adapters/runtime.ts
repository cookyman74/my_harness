// 런타임 감지 (설계 §API /api/runtimes). claude/codex/agy 설치·버전·경로 + 비-TTY 인증 상태.
import { safeExec } from "../lib/exec.js";

// authenticated: "authenticated" | "unauthenticated" | "unknown"
//   - claude: `claude auth status`(JSON .loggedIn) — 비-TTY 지원.
//   - codex: `codex login status`("Logged in …") — 비-TTY 지원.
//   - agy: 비-TTY status 미지원(bubbletea /dev/tty 요구)·자격 파일 휴리스틱 부재 → "조회 미지원"(고장 아님·리뷰 사용은 정상).
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
  // agy 및 기타: 비대화형 인증 조회 수단 없음(TTY 요구·자격 파일 부재). "unknown"(고장 암시) 대신 정직하게 "조회 미지원".
  return "조회 미지원";
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
