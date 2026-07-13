// @vitest-environment jsdom
// F10 M15 웹 순수 로직 — 런타임 배지/필터·편집 활성 판정(runtime==claude && 정의경로)·트리 조회·
//   error 코드 한국어 매핑(조용한 드롭 금지·A128)·미적용 초안 세션 유지(A107)·CLAUDE.md 포인터 스니펫.
//   React·fetch 무의존(shape·상태머신·데이터 로직만). 서버 계약(contextpaths·context adapter)과 정합.
import { describe, it, expect, beforeEach } from "vitest";
import {
  runtimeBadgeKind, availableRuntimes, filterContextTree, findContextFile,
  contextEditTarget, editDecision, contextReadonlyReason,
  CONTEXT_EDIT_ERRORS, contextEditErrorText, BUILD_ERRORS, buildErrorText,
  saveDraftSession, loadDraftSession, clearDraftSession, claudePointerSnippet,
  type ContextTree, type Runtime,
} from "../src/web/context.js";

// 서버 contextapi.test.ts 픽스처와 동형 트리(멀티런타임·present·서브루트 파일).
const TREE: ContextTree = {
  projectRoot: "/proj",
  topFiles: [
    { name: "CLAUDE.md", path: "CLAUDE.md", runtime: "claude", present: true },
    { name: "AGENTS.md", path: "AGENTS.md", runtime: "codex/agy", present: false },
    { name: "GEMINI.md", path: "GEMINI.md", runtime: "agy", present: true },
  ],
  roots: [
    { path: ".claude/agents", runtime: "claude", present: true, children: [
      { type: "file", name: "a1.md", path: ".claude/agents/a1.md", runtime: "claude", ext: "md" },
    ] },
    { path: ".claude/skills", runtime: "claude", present: true, children: [
      { type: "dir", name: "alpha", path: ".claude/skills/alpha", runtime: "claude", children: [
        { type: "file", name: "SKILL.md", path: ".claude/skills/alpha/SKILL.md", runtime: "claude", ext: "md" },
        { type: "file", name: "notes.md", path: ".claude/skills/alpha/notes.md", runtime: "claude", ext: "md" },
      ] },
    ] },
    { path: ".codex/agents", runtime: "codex", present: true, children: [
      { type: "file", name: "cx.toml", path: ".codex/agents/cx.toml", runtime: "codex", ext: "toml" },
    ] },
    { path: ".agents/skills", runtime: "codex/agy", present: true, children: [
      { type: "dir", name: "beta", path: ".agents/skills/beta", runtime: "codex/agy", children: [
        { type: "file", name: "SKILL.md", path: ".agents/skills/beta/SKILL.md", runtime: "codex/agy", ext: "md" },
      ] },
    ] },
  ],
  count: 5,
  truncated: false,
};

describe("runtimeBadgeKind — 색 비의존 배지 kind(A92·텍스트가 의미)", () => {
  it("claude=ok·codex=warn·agy=muted·codex/agy=warn(전 런타임 매핑)", () => {
    expect(runtimeBadgeKind("claude")).toBe("ok");
    expect(runtimeBadgeKind("codex")).toBe("warn");
    expect(runtimeBadgeKind("agy")).toBe("muted");
    expect(runtimeBadgeKind("codex/agy")).toBe("warn");
  });
});

describe("availableRuntimes / filterContextTree — 런타임 필터(A128)", () => {
  it("present 한 distinct 런타임만 정본 순서로(부재 topFile 제외)", () => {
    // AGENTS.md(codex/agy) 는 present:false 지만 .agents/skills 루트가 codex/agy present → codex/agy 포함.
    expect(availableRuntimes(TREE)).toEqual(["claude", "codex", "agy", "codex/agy"]);
  });
  it("전부 부재 → 빈 배열", () => {
    const empty: ContextTree = {
      ...TREE,
      topFiles: TREE.topFiles.map((f) => ({ ...f, present: false })),
      roots: TREE.roots.map((r) => ({ ...r, present: false })),
    };
    expect(availableRuntimes(empty)).toEqual([]);
  });
  it("null 필터 → 원본 그대로(전체)", () => {
    expect(filterContextTree(TREE, null)).toBe(TREE);
  });
  it("claude 필터 → claude topFiles·roots 만(codex/agy 루트 제거)", () => {
    const f = filterContextTree(TREE, "claude");
    expect(f.topFiles.map((x) => x.name)).toEqual(["CLAUDE.md"]);
    expect(f.roots.map((x) => x.path)).toEqual([".claude/agents", ".claude/skills"]);
  });
  it("codex/agy 필터 → 정확히 codex/agy 루트만(codex 과 혼동 없음)", () => {
    const f = filterContextTree(TREE, "codex/agy");
    expect(f.roots.map((x) => x.path)).toEqual([".agents/skills"]);
    // 필터는 runtime 매칭만 — present 는 별도(부재 topFile 은 트리에서 "없음" 배지로 표시). codex 은 섞이지 않음.
    expect(f.topFiles.map((x) => x.name)).toEqual(["AGENTS.md"]);
    expect(f.topFiles.every((x) => x.runtime === "codex/agy")).toBe(true);
  });
});

describe("findContextFile — 선택 경로의 파일 노드 runtime 권위 재확인", () => {
  it("top file(present) 조회", () => {
    expect(findContextFile(TREE, "CLAUDE.md")).toEqual({ runtime: "claude", path: "CLAUDE.md" });
  });
  it("서브루트 중첩 파일 조회(재귀)", () => {
    expect(findContextFile(TREE, ".claude/skills/alpha/SKILL.md")).toEqual({ runtime: "claude", path: ".claude/skills/alpha/SKILL.md" });
    expect(findContextFile(TREE, ".agents/skills/beta/SKILL.md")).toEqual({ runtime: "codex/agy", path: ".agents/skills/beta/SKILL.md" });
  });
  it("부재 top file·미존재 경로 → null", () => {
    expect(findContextFile(TREE, "AGENTS.md")).toBeNull(); // present:false
    expect(findContextFile(TREE, ".claude/agents/nope.md")).toBeNull();
  });
});

describe("contextEditTarget — 정의 경로 파싱(F7 편집 대상만)", () => {
  it("agent 정의(.claude/agents/<name>.md)", () => {
    expect(contextEditTarget(".claude/agents/a1.md")).toEqual({ kind: "agent", name: "a1" });
  });
  it("skill 정의(.claude/skills/<name>/SKILL.md)", () => {
    expect(contextEditTarget(".claude/skills/alpha/SKILL.md")).toEqual({ kind: "skill", name: "alpha" });
  });
  it("F15: codex toml 에이전트·shared(.agents) 스킬 = 컨텍스트 트리 편집 대상", () => {
    expect(contextEditTarget(".codex/agents/cx.toml")).toEqual({ kind: "agent", name: "cx" });
    expect(contextEditTarget(".agents/skills/beta/SKILL.md")).toEqual({ kind: "skill", name: "beta" });
  });
  it("정의 아님·트리 밖 → null(.gemini 는 트리 스코프 밖·서버 동형·dotfile 거부)", () => {
    expect(contextEditTarget(".claude/skills/alpha/notes.md")).toBeNull();
    expect(contextEditTarget(".claude/skills/alpha/references/x.md")).toBeNull();
    expect(contextEditTarget("CLAUDE.md")).toBeNull();
    expect(contextEditTarget("GEMINI.md")).toBeNull();
    expect(contextEditTarget(".codex/agents/cx.md")).toBeNull();          // codex 에이전트는 toml 만
    expect(contextEditTarget(".gemini/agents/g1.md")).toBeNull();         // .gemini = 트리 밖(서버 400 동형·R5 MED)
    expect(contextEditTarget(".gemini/skills/gs/SKILL.md")).toBeNull();
    expect(contextEditTarget(".codex/agents/.hidden.toml")).toBeNull();   // dotfile 첫 글자 점 → 거부(R5 LOW)
  });
});

describe("editDecision — 편집 활성 계약(runtime==claude && 정의경로 && gateOn)", () => {
  it("게이트 off → 항상 비활성(사유: 비활성)", () => {
    const d = editDecision({ runtime: "claude", path: ".claude/agents/a1.md", type: "file" }, false);
    expect(d.editable).toBe(false);
    if (!d.editable) expect(d.reason).toContain("비활성");
  });
  it("게이트 on + claude 정의 → 활성(kind·name)", () => {
    expect(editDecision({ runtime: "claude", path: ".claude/agents/a1.md", type: "file" }, true))
      .toEqual({ editable: true, kind: "agent", name: "a1" });
    expect(editDecision({ runtime: "claude", path: ".claude/skills/alpha/SKILL.md", type: "file" }, true))
      .toEqual({ editable: true, kind: "skill", name: "alpha" });
  });
  it("F15(M-e): 게이트 on + codex toml 에이전트 정의 → 활성(런타임 무관 편집)", () => {
    for (const rt of ["codex", "codex/agy"] as Runtime[]) {
      const d = editDecision({ runtime: rt, path: ".codex/agents/cx.toml", type: "file" }, true);
      expect(d).toEqual({ editable: true, kind: "agent", name: "cx" });
    }
    // 공유 스킬도 편집 가능
    expect(editDecision({ runtime: "codex/agy", path: ".agents/skills/beta/SKILL.md", type: "file" }, true))
      .toEqual({ editable: true, kind: "skill", name: "beta" });
  });
  it("정의 아님 런타임 파일(top rules·references) → 비활성(읽기전용 사유)", () => {
    expect(editDecision({ runtime: "agy", path: "GEMINI.md", type: "file" }, true).editable).toBe(false);
  });
  it("게이트 on·claude 인데 정의 파일 아님(references·top file) → 비활성", () => {
    expect(editDecision({ runtime: "claude", path: ".claude/skills/alpha/notes.md", type: "file" }, true).editable).toBe(false);
    expect(editDecision({ runtime: "claude", path: "CLAUDE.md", type: "file" }, true).editable).toBe(false);
  });
  it("디렉토리 → 비활성", () => {
    expect(editDecision({ runtime: "claude", path: ".claude/skills/alpha", type: "dir" }, true).editable).toBe(false);
  });
});

describe("contextReadonlyReason — 읽기전용 사유(색 비의존 텍스트·서버 409 신호 동형)", () => {
  it("런타임별 읽기전용(현재 미지원) 문구", () => {
    expect(contextReadonlyReason("codex", ".codex/agents/cx.toml")).toContain("지원하지 않습니다");
    expect(contextReadonlyReason("agy", "GEMINI.md")).toContain("지원하지 않습니다");
    expect(contextReadonlyReason("codex/agy", ".agents/skills/beta/SKILL.md")).toContain("지원하지 않습니다");
  });
  it("claude top file → 읽기전용 컨텍스트", () => {
    expect(contextReadonlyReason("claude", "CLAUDE.md")).toContain("읽기전용");
  });
});

describe("에러 코드 한국어 매핑 — 조용한 드롭 금지(A128)", () => {
  it("PUT edit 전 error 코드 매핑(서버 계약 정확 일치)", () => {
    const codes = ["codex-edit-v0.7", "codex/agy-edit-v0.7", "agy-edit-v0.7", "context-file-readonly", "edit-via-f7", "invalid-path", "bad-input"];
    for (const c of codes) {
      expect(CONTEXT_EDIT_ERRORS[c]).toBeDefined();
      expect(contextEditErrorText(c).length).toBeGreaterThan(0);
    }
  });
  it("미지 edit 코드 → 코드·상태 포함 폴백(삼키지 않음)", () => {
    const m = contextEditErrorText("weird", 409);
    expect(m).toContain("weird");
    expect(m).toContain("409");
  });
  it("build 전 error 코드 매핑(draft/create 서버 계약)", () => {
    const codes = ["bad-input", "edit-disabled", "build-in-progress", "build-cooldown",
      "draft-failed", "runtime-not-found", "empty-draft", "too-large", "invalid-name", "integrity", "path-unsafe", "name-collision"];
    for (const c of codes) {
      expect(BUILD_ERRORS[c]).toBeDefined();
      expect(buildErrorText(c).length).toBeGreaterThan(0);
    }
  });
  it("edit-disabled → Settings 안내 · name-collision → 다른 이름 안내", () => {
    expect(buildErrorText("edit-disabled")).toContain("Settings");
    expect(buildErrorText("name-collision")).toContain("이름");
  });
  it("미지 build 코드 → 코드·상태 포함 폴백", () => {
    expect(buildErrorText("boom", 502)).toContain("boom");
    expect(buildErrorText("boom", 502)).toContain("502");
  });
});

describe("미적용 초안 세션 유지(A107·서버 무상태·유실 방지)", () => {
  beforeEach(() => sessionStorage.clear());

  it("save→load 라운드트립(폼+초안+이름)", () => {
    saveDraftSession({ kind: "skill", domain: "d", role: "r", name: "s", draft: "---\nname: s\n---\n" });
    expect(loadDraftSession()).toEqual({ kind: "skill", domain: "d", role: "r", name: "s", draft: "---\nname: s\n---\n" });
  });
  it("draft null(폼만) 유지 가능", () => {
    saveDraftSession({ kind: "agent", domain: "d", role: "r", name: "", draft: null });
    expect(loadDraftSession()?.draft).toBeNull();
  });
  it("clear 후 → null", () => {
    saveDraftSession({ kind: "agent", domain: "d", role: "r", name: "n", draft: "x" });
    clearDraftSession();
    expect(loadDraftSession()).toBeNull();
  });
  it("저장분 없음 → null", () => {
    expect(loadDraftSession()).toBeNull();
  });
  it("오염된 저장분(잘못된 kind·JSON 파손) → null(크래시 없이 폐기)", () => {
    sessionStorage.setItem("harness-context-draft", JSON.stringify({ kind: "bogus", domain: "d", role: "r", name: "n", draft: null }));
    expect(loadDraftSession()).toBeNull();
    sessionStorage.setItem("harness-context-draft", "{not json");
    expect(loadDraftSession()).toBeNull();
  });
});

describe("claudePointerSnippet — 포인터 스니펫(자동 쓰기 없음·복사용 데이터)", () => {
  it("agent → 이름·sourcePath 포함", () => {
    const s = claudePointerSnippet({ kind: "agent", name: "my-agent", sourcePath: ".claude/agents/my-agent.md" });
    expect(s).toContain("my-agent");
    expect(s).toContain(".claude/agents/my-agent.md");
  });
  it("skill → 트리거 언급 포함", () => {
    const s = claudePointerSnippet({ kind: "skill", name: "my-skill", sourcePath: ".claude/skills/my-skill/SKILL.md" });
    expect(s).toContain("my-skill");
    expect(s).toContain("트리거");
  });
});
