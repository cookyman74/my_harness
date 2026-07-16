// `npm start` 원커맨드 진입점 — 서버 기동(127.0.0.1) + 브라우저 자동 오픈(fragment 토큰) + 단일 오리진.
//   범위: **로컬 단일 사용자(127.0.0.1)** 전용. 원격/다중기기(0.0.0.0·IP)는 비목표(v0.7·별도 보안 설계) —
//   Host 게이트(security.ts)를 넓히지 말 것.
//
// 흐름: resolveBootProjectRoot(D1~D7) → buildServer({security,projectRoot}) → 127.0.0.1:PORT listen →
//   writeBootstrap(0600 파일·런처 재접속용) → bootstrapUrl(#fragment 토큰) → openArgs 로 execFile 브라우저 오픈.
//   보안 불변식 I2/I3: 브라우저 오픈은 execFile+argv(shell 금지). bootstrap 토큰은 fragment(#) 로만 —
//   **stdout 에는 토큰 없는 base URL 만** 출력(터미널/로그 미노출). 오픈 성공/실패 무관 수동 접속 안내.
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import type { FastifyInstance } from "fastify";
import { buildServer, resolveBootProjectRoot } from "./index.js";
import { makeSecurity } from "./security.js";
import { openArgs, writeBootstrap, bootstrapUrl, readBootstrap } from "./launcher.js";

export const DEFAULT_PORT = 5174;

// 브라우저 오픈 argv 구성(순수·테스트 가능). new URL 로 127.0.0.1 로컬만 허용(비로컬 오픈 차단) → openArgs.
//   shell 없음(execFile+argv). 반환 args 에 fragment(#토큰) 포함 URL 그대로.
//   심층방어: win32 openArgs 는 cmd.exe 를 경유하므로(빌트인 start), URL 전체를 cmd/shell 메타문자 대해 재검증한다.
//   정상 URL 은 `http://127.0.0.1:PORT/#<hex 토큰>` 뿐 — `& | < > ^ " % $ ; ` 백틱·공백·개행이 있으면 변조로 보고 거부.
//   (fragment 토큰은 encodeURIComponent(hex) 라 이 문자들이 절대 나오지 않음.) `new URL` 은 fragment 의 `&`·`|` 를
//   통과시키므로 이 검사가 실제 갭을 막는다.
const OPEN_URL_METACHAR = /[&|<>^"%$;`\s]/;
export function buildOpenCommand(url: string): { cmd: string; args: string[] } {
  const u = new URL(url);
  if (u.protocol !== "http:" || u.hostname !== "127.0.0.1") throw new Error("non-local-url");
  if (OPEN_URL_METACHAR.test(url)) throw new Error("unsafe-url-metachar");
  return openArgs(url);
}

// 브라우저 오픈(fire-and-forget·shell 금지). 실패해도 throw 안 함(수동 접속 fallback). deps 주입(테스트).
export function openBrowser(
  url: string,
  spawn: (cmd: string, args: string[]) => void = (c, a) => execFile(c, a, () => {}),
): boolean {
  try {
    const { cmd, args } = buildOpenCommand(url);
    spawn(cmd, args);
    return true;
  } catch {
    return false;
  }
}

// base URL(토큰 없음) — stdout/로그용. bootstrapUrl(#fragment) 은 브라우저 오픈 argv 에만.
export function baseUrl(port: number): string {
  return `http://127.0.0.1:${port}/`;
}

export interface StartResult {
  server: FastifyInstance;
  port: number;
  openUrl: string; // #fragment 토큰 포함(브라우저 오픈 전용 — 로그 금지)
  base: string;    // 토큰 없는 base(stdout 안전)
}

// 서버 기동 + bootstrap 파일 기록. 브라우저 오픈은 호출측(main)에서(테스트는 listen 없이 buildOpenCommand 만).
export async function startServer(opts: { port?: number } = {}): Promise<StartResult> {
  const port = opts.port ?? Number.parseInt(process.env.PORT ?? String(DEFAULT_PORT), 10);
  const security = makeSecurity(port);
  const boot = await resolveBootProjectRoot();
  const app = buildServer({ security, projectRoot: boot.root });
  // M-y0 거버너 부팅 재건·reap 타이머 — **실 진입점은 start.ts** 다(index.ts isMain 은 이 경로에서 안 뜸).
  //   listen 전에 boot reap 으로 크래시 잔존/누수 슬롯을 회수하지 않으면 K 슬롯이 영구 잠겨 신규 run 이 queued 로 멈춘다
  //   ("AI로 반영" 무응답의 근본원인). 실패는 로깅만(거버너 없이도 서버는 뜸·다음 tick 복구).
  await (await import("./adapters/governed.js")).initGovernance(boot.root).catch((e) => { process.stderr.write(`[governor] init failed: ${e}\n`); });
  await app.listen({ host: "127.0.0.1", port });
  await writeBootstrap(security.bootstrap).catch(() => {}); // 0600 파일(토큰 stdout 미출력)
  return { server: app, port, openUrl: bootstrapUrl(port, security.bootstrap), base: baseUrl(port) };
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMain) {
  void (async () => {
    const port = Number.parseInt(process.env.PORT ?? String(DEFAULT_PORT), 10);
    try {
      const r = await startServer({ port });
      // stdout: 토큰 없는 base URL 만(수동 접속 안내). 브라우저 오픈 argv 에만 #fragment 토큰.
      process.stdout.write(`harness-ui running at ${r.base}\n(브라우저가 자동으로 열립니다. 안 열리면 위 주소로 접속하세요.)\n`);
      openBrowser(r.openUrl);
    } catch (e: unknown) {
      const err = e as { code?: string };
      if (err?.code === "EADDRINUSE") {
        // 이미 실행 중 — 기존 bootstrap 으로 재오픈 시도(A31). 파일 없으면 base URL 안내만.
        const existing = await readBootstrap();
        const openUrl = existing ? bootstrapUrl(port, existing) : baseUrl(port);
        process.stdout.write(`harness-ui already running at ${baseUrl(port)} — 재오픈합니다.\n`);
        openBrowser(openUrl);
        process.exit(0);
      }
      process.stderr.write(String(e) + "\n");
      process.exit(1);
    }
  })();
}
