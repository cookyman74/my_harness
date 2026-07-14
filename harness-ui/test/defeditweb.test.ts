import { describe, it, expect } from "vitest";
import {
  DEF_EDIT_ERRORS, INTEGRITY_DETAIL, defEditErrorText,
  diffLines, diffStats, hasChanges, isDiffCoarse, sideRows,
  skillNeedsName, skillHasClaudePath, isDirty, rollbackBodyFromSave, splitFrontmatter,
  type PutDefResult,
} from "../src/web/defedit.js";

// F7 M12 웹 순수 로직 — 서버 error 코드 한국어 매핑(A80·조용한 드롭 금지)·라인 diff(A86)·
// 409 병합 나란히 비교(A93)·name 필수 힌트·롤백 body 도출. React·fetch 무의존.

describe("defEditErrorText — 서버 error 코드 한국어 매핑(A80·조용한 드롭 금지)", () => {
  it("전 error 코드 집합이 매핑됨(GET/PUT/rollback)", () => {
    const codes = [
      "invalid-name", "path-unsafe", "not-found", "ambiguous-definition", "codex-only-v0.7",
      "edit-disabled", "bad-input", "too-large", "integrity", "backup-failed",
      "stale-write", "path-id-mismatch", "proposal-not-available",
      "stale-rollback", "backup-hash-mismatch", "no-backup",
    ];
    for (const c of codes) {
      expect(DEF_EDIT_ERRORS[c]).toBeDefined();
      expect(defEditErrorText(c).length).toBeGreaterThan(0);
    }
  });

  it("edit-disabled → Settings 안내 포함", () => {
    expect(defEditErrorText("edit-disabled")).toContain("Settings");
  });

  it("integrity + detail 'field:name' → name 필수 안내 병기(name 없는 스킬 예방)", () => {
    const msg = defEditErrorText("integrity", 400, "field:name");
    expect(msg).toContain(DEF_EDIT_ERRORS.integrity);
    expect(msg).toContain("name");
    expect(msg).toContain(INTEGRITY_DETAIL["field:name"]);
  });

  it("integrity + 미지 detail → 세부코드 그대로 노출(조용한 드롭 아님)", () => {
    expect(defEditErrorText("integrity", 400, "weird-sub")).toContain("weird-sub");
  });

  it("integrity + 배열 detail(Zod issues) → 폴백(문자열 아님이면 세부 병기 생략)", () => {
    const msg = defEditErrorText("integrity", 400, [{ path: ["x"] }]);
    expect(msg).toBe(DEF_EDIT_ERRORS.integrity);
  });

  it("proposal-not-available → 사용자 안내(evalProposal fail-closed·설계코드 없이)", () => {
    // 용어 정리: 사용자향 문구에서 F8/M13 설계 코드 제거 — "아직 사용할 수 없습니다" 로 조용한 드롭 금지 유지.
    const msg = defEditErrorText("proposal-not-available");
    expect(msg).toContain("사용할 수 없");
    expect(msg).not.toMatch(/\bF8\b|\bM13\b/); // 설계 코드 누출 금지(회귀 방지)
  });

  it("미지 코드 → 상태코드·코드 포함 폴백", () => {
    const msg = defEditErrorText("boom", 500);
    expect(msg).toContain("500");
    expect(msg).toContain("boom");
  });
});

describe("diffLines / diffStats / hasChanges — 로드본→편집본 라인 diff(A86)", () => {
  it("동일 → 전부 same·변경 없음", () => {
    const ops = diffLines("a\nb", "a\nb");
    expect(ops.every((o) => o.kind === "same")).toBe(true);
    expect(hasChanges("a\nb", "a\nb")).toBe(false);
    expect(diffStats(ops)).toEqual({ added: 0, removed: 0 });
  });

  it("빈 문자열 동일 → 빈 ops", () => {
    expect(diffLines("", "")).toEqual([]);
  });

  it("라인 추가 → add op·removed 0", () => {
    const ops = diffLines("a\nb", "a\nX\nb");
    expect(diffStats(ops)).toEqual({ added: 1, removed: 0 });
    expect(ops.find((o) => o.kind === "add")?.text).toBe("X");
    expect(hasChanges("a\nb", "a\nX\nb")).toBe(true);
  });

  it("라인 삭제 → del op·added 0", () => {
    const ops = diffLines("a\nb\nc", "a\nc");
    expect(diffStats(ops)).toEqual({ added: 0, removed: 1 });
    expect(ops.find((o) => o.kind === "del")?.text).toBe("b");
  });

  it("라인 치환 → del + add(공통 라인 보존·LCS)", () => {
    const ops = diffLines("name: old\nbody", "name: new\nbody");
    const s = diffStats(ops);
    expect(s.added).toBe(1);
    expect(s.removed).toBe(1);
    // 공통 라인 body 는 same 로 보존
    expect(ops.some((o) => o.kind === "same" && o.text === "body")).toBe(true);
  });

  it("op 순서 복원 시 텍스트 라운드트립(before=del+same, after=add+same)", () => {
    const before = "l1\nl2\nl3", after = "l1\nl2x\nl3\nl4";
    const ops = diffLines(before, after);
    const reBefore = ops.filter((o) => o.kind !== "add").map((o) => o.text).join("\n");
    const reAfter = ops.filter((o) => o.kind !== "del").map((o) => o.text).join("\n");
    expect(reBefore).toBe(before);
    expect(reAfter).toBe(after);
  });

  it("CRLF 로드본 vs LF 편집본 → 내용 동일 줄은 same(diff 오인 0·개행 정규화)", () => {
    // 로드본은 디스크 CRLF, 편집본은 textarea LF. 내용은 name 줄만 변경.
    const loaded = "name: old\r\nbody\r\ntail";
    const edited = "name: new\nbody\ntail";
    const ops = diffLines(loaded, edited);
    const s = diffStats(ops);
    // 실제 변경(name) 한 줄만 del+add — \r 잔존으로 인한 전면 오인 없음
    expect(s).toEqual({ added: 1, removed: 1 });
    // 공통 줄은 \r 없이 same 로 표시
    expect(ops.some((o) => o.kind === "same" && o.text === "body")).toBe(true);
    expect(ops.some((o) => o.kind === "same" && o.text === "tail")).toBe(true);
    // del/add 텍스트에도 \r 잔존 없음
    expect(ops.every((o) => !o.text.includes("\r"))).toBe(true);
  });

  it("CRLF↔LF 내용 완전 동일 → 전부 same(변경 줄 0)", () => {
    const ops = diffLines("a\r\nb\r\nc", "a\nb\nc");
    expect(diffStats(ops)).toEqual({ added: 0, removed: 0 });
    expect(ops.every((o) => o.kind === "same")).toBe(true);
    expect(ops.map((o) => o.text)).toEqual(["a", "b", "c"]);
  });

  it("대용량 라인 → coarse 폴백(메모리 폭발 방지)·isDiffCoarse true", () => {
    const big = Array.from({ length: 3000 }, (_, i) => `l${i}`).join("\n");
    const big2 = big + "\nextra"; // 3001 lines → 3000*3001 > 2e6
    expect(isDiffCoarse(big, big2)).toBe(true);
    const ops = diffLines(big, big2);
    // coarse = 전체 del 후 전체 add
    expect(ops.some((o) => o.kind === "del")).toBe(true);
    expect(ops.some((o) => o.kind === "add")).toBe(true);
  });
});

describe("sideRows — 409 병합 나란히 비교(A93 · 디스크↔편집분)", () => {
  it("del=좌측만·add=우측만·same=양쪽", () => {
    const rows = sideRows(diffLines("disk\nshared", "edit\nshared"));
    const del = rows.find((r) => r.kind === "del");
    const add = rows.find((r) => r.kind === "add");
    const same = rows.find((r) => r.kind === "same");
    expect(del).toMatchObject({ left: "disk", right: null });
    expect(add).toMatchObject({ left: null, right: "edit" });
    expect(same).toMatchObject({ left: "shared", right: "shared" });
  });
});

describe("splitFrontmatter — 렌더 모드 frontmatter/본문 분리(타이틀 폰트 오해석 방지)", () => {
  it("frontmatter + 본문 분리", () => {
    const src = "---\nname: doc-syncer\ndescription: 3개국어 동기화\nmodel: opus\n---\n# 본문\n내용\n";
    const { frontmatter, body } = splitFrontmatter(src);
    expect(frontmatter).toContain("name: doc-syncer");
    expect(frontmatter).toContain("model: opus");
    expect(frontmatter).not.toContain("---");   // 구분자 제외
    expect(body).toBe("# 본문\n내용\n");           // 본문만(frontmatter 제거)
    expect(body).not.toContain("name:");
  });
  it("frontmatter 없음 → 전체가 본문", () => {
    const { frontmatter, body } = splitFrontmatter("# 그냥 본문\n텍스트");
    expect(frontmatter).toBeNull();
    expect(body).toBe("# 그냥 본문\n텍스트");
  });
  it("CRLF frontmatter 처리", () => {
    const { frontmatter, body } = splitFrontmatter("---\r\nname: x\r\n---\r\nbody\r\n");
    expect(frontmatter).toContain("name: x");
    expect(body).toBe("body\r\n");
  });
  it("BOM 선행 frontmatter 도 분리(codex LOW)", () => {
    const { frontmatter, body } = splitFrontmatter("\uFEFF---\nname: x\n---\n# 본문\n");
    expect(frontmatter).toContain("name: x");
    expect(body).toBe("# 본문\n");
  });
});

describe("skillNeedsName — name 없는 스킬 저장 전 힌트(400 integrity field:name 예방)", () => {
  it("agent 는 항상 false(kind 무관 힌트 없음)", () => {
    expect(skillNeedsName("agent", "본문만")).toBe(false);
  });
  it("skill + frontmatter 에 name 있음 → false", () => {
    expect(skillNeedsName("skill", "---\nname: foo\ndescription: d\n---\n본문")).toBe(false);
  });
  it("skill + frontmatter 에 name 없음 → true(힌트)", () => {
    expect(skillNeedsName("skill", "---\ndescription: d\n---\n본문")).toBe(true);
  });
  it("skill + frontmatter 자체 부재 → true", () => {
    expect(skillNeedsName("skill", "그냥 본문")).toBe(true);
  });
});

describe("skillHasClaudePath — 편집 버튼 사전 판정(codex-only 비활성)", () => {
  it(".claude 경로 있으면 true", () => {
    expect(skillHasClaudePath([".claude/skills/foo", ".agents/skills/foo"])).toBe(true);
  });
  it(".agents(codex) 뿐이면 false(codex-only·v0.7 비대상)", () => {
    expect(skillHasClaudePath([".agents/skills/foo"])).toBe(false);
  });
  it("빈 배열 → false", () => {
    expect(skillHasClaudePath([])).toBe(false);
  });
});

describe("isDirty / rollbackBodyFromSave — 편집기 상태 헬퍼", () => {
  it("isDirty = loaded !== edited", () => {
    expect(isDirty("a", "a")).toBe(false);
    expect(isDirty("a", "a ")).toBe(true);
  });
  it("rollbackBodyFromSave: expectedCurrentHash=newHash·backupHash=prevHash", () => {
    const save: PutDefResult = {
      ok: true, prevHash: "PREV", newHash: "NEW", pathId: "P", sourcePath: ".claude/agents/x.md", codexDriftWarning: true,
    };
    expect(rollbackBodyFromSave(save)).toEqual({ expectedCurrentHash: "NEW", backupHash: "PREV" });
  });
});
