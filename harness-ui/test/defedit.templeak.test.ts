// M12 F7 외부감사 R2(agy#2) — writeDefSafe temp 누수.
//   현황 결함: temp open 성공 후 writeFile/sync 중 ENOSPC/IO 실패 시 rm(tmp) 가 후속 rename try/catch 에만
//   있어 write 단계 실패가 temp 찌꺼기를 남김.
//   수정 검증: temp open 직후~rename 완료까지 단일 try/finally 통합 → 어느 지점 예외(rename 前)든 finally 가
//   반드시 temp 삭제. FileHandle close 도 내부 finally 보장.
//
// node:fs/promises 를 모듈 모킹해 temp 파일(.tmp.) open 은 실제 생성하되 그 핸들의 writeFile 만 ENOSPC 로
//   throw 시킨다(타 경로 open 은 실 구현 위임). 모킹은 이 파일에 격리(vi.mock 은 파일 스코프).
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  const wrapped = {
    ...actual,
    open: (async (path: unknown, ...rest: unknown[]) => {
      // @ts-expect-error 실 구현으로 위임(가변 시그니처)
      const fh = await actual.open(path, ...rest);
      if (typeof path === "string" && path.includes(".tmp.")) {
        // 이 temp 핸들의 write 만 디스크 풀(ENOSPC)로 실패시킴 — sync/close 는 실 구현 유지.
        fh.writeFile = (async () => {
          const e = new Error("simulated ENOSPC") as NodeJS.ErrnoException;
          e.code = "ENOSPC";
          throw e;
        }) as typeof fh.writeFile;
      }
      return fh;
    }) as typeof actual.open,
  };
  return { ...wrapped, default: wrapped };
});

const { mkdtemp, mkdir, writeFile, rm, readFile, readdir } = await import("node:fs/promises");
const { tmpdir } = await import("node:os");
const { join } = await import("node:path");
const { writeDefSafe } = await import("../src/server/adapters/defedit.js");

let root: string;
const AGENT_MD = "---\nname: alpha\ndescription: alpha agent\n---\n# body\nhello\n";
const SRC = ".claude/agents/alpha.md";

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "hui-leak-"));
  await mkdir(join(root, ".claude", "agents"), { recursive: true });
  await writeFile(join(root, ".claude", "agents", "alpha.md"), AGENT_MD);
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe.skipIf(process.platform === "win32")("agy#2 — writeDefSafe write/sync 실패 시 temp 누수 0", () => {
  it("write(ENOSPC) 실패 → 에러 전파·temp 미잔존·원본 무변경", async () => {
    const next = "---\nname: alpha\ndescription: edited\n---\n# body\nbye\n";
    await expect(writeDefSafe(root, SRC, "agent", next)).rejects.toThrow(/ENOSPC/);
    // temp 파일(.alpha.md.tmp.*) 이 남지 않음 — finally 가 rm 수행.
    const files = await readdir(join(root, ".claude", "agents"));
    expect(files.some((f) => f.startsWith(".alpha.md.tmp"))).toBe(false);
    // 원본 정의는 그대로(rename 미도달).
    expect(await readFile(join(root, ".claude", "agents", "alpha.md"), "utf8")).toBe(AGENT_MD);
  });
});
