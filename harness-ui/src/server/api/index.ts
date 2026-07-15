// API 라우트 등록. 보안 미들웨어(token/Host/Origin/denylist)는 security.ts.
import { readdir, lstat } from "node:fs/promises";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { detectRuntimes } from "../adapters/runtime.js";
import { harnessInventory, readAgents, readSkills, findAgent, agentFingerprint, resolveEditableAgent, resolveEditableSkill, type DefResolution } from "../adapters/harness.js";
import {
  canonicalizeDefinition, safeDefPath, readDefSafe, sha256, writeBackup, readBackup,
  writeDefSafe, withDefLock, MAX_DEF_BYTES, type DefKind, type CanonResult,
} from "../adapters/defedit.js";
import { listRuns, getRun, readEvents, readRunAgents, queryRuns } from "../adapters/runs.js";
import { detectDrift, syncPlan } from "../adapters/drift.js";
import { skillSyncGroups, isSyncableTarget } from "../adapters/driftsync.js";
import { evaluateArtifacts } from "../adapters/artifacteval.js";
import { stateStats, settings } from "../adapters/statestats.js";
import { computeHarnessScorecard } from "../adapters/scorecard.js";
import { writeHarnessScorecardSnapshot, readHarnessTrend } from "../adapters/scorecard-snapshot.js";
import { homedir } from "node:os";
import { factoryStatus, applyFactoryAction } from "../adapters/factory.js";
import { appendConfigChange, readConfigChanges } from "../adapters/confighistory.js";
import { listHarnesses } from "../adapters/harnesslist.js";
import { skillUsage } from "../adapters/skillusage.js";
import { runtimeOfPath, editableMdAgentDirs, editableTomlAgentDirs, editableSkillDirs } from "../adapters/runtimes.js";
import { canonicalizeTomlAgent, validateTomlRestore } from "../adapters/toml.js";

// F15(M-e): 정의 canonicalizer 를 sourcePath 확장자로 라우팅. `.toml`(codex 에이전트)=limited-edit(주석 보존
//   verbatim·직전본 대비 semantic diff) · 그 외 `.md`=기존 md canonicalizer.
//   R2(agy HIGH·방어심화): toml + curContent===null 은 **rollback(신뢰 백업 복원) 전용** — semantic diff 를 생략하므로
//   신규 생성 경로로 흘러들면 임의 구조/특권 필드 주입 우회가 된다. `opts.restore` 명시 없이는 거부(fail-closed).
//   (현재 create 라우트는 `.claude/*.md`·canonicalizeDefinition 직접 사용이라 여기로 오지 않음 — 미래 배선 실수까지 차단.)
function canonicalizeByPath(
  sourcePath: string, content: string, kind: DefKind, name: string, curContent: string | null,
  opts?: { restore?: boolean },
): CanonResult {
  if (sourcePath.endsWith(".toml")) {
    if (curContent === null && !opts?.restore) return { ok: false, error: "toml-create-unsupported" };
    const r = curContent === null ? validateTomlRestore(content, name) : canonicalizeTomlAgent(content, name, curContent);
    return r.ok ? { ok: true, canonical: r.canonical, normalized: r.normalized } : { ok: false, error: r.error };
  }
  return canonicalizeDefinition(content, kind, name);
}
import { docsTree } from "../adapters/docs.js";
import { RunsQuery } from "../schemas.js";
import { z } from "zod";
import { overview as metricsOverview, agents as metricsAgents, skills as metricsSkills, type MetricsOptions } from "../adapters/metrics.js";
import { MAX_RUNS_SCAN } from "../adapters/runs.js";
import { isSafeSegment, isSafeDocsSegment, ARGV_TOKEN } from "../lib/paths.js";
import { openSafeFile, sendDownload, sendPreview, DOWNLOAD_MAX, VIEW_MAX, CONTEXT_RENDERABLE_EXT } from "../lib/servefile.js";
import { contextTree, ensureCreatePath } from "../adapters/context.js";
import { classifyContextPath, deniedContextPath } from "../lib/contextpaths.js";
import { BuildDraftInput, draftDefinition, BuildGate, BuildHarnessInput, draftHarness, type ExecFn } from "../lib/builddraft.js";
import { safeExec } from "../lib/exec.js";
import { deniedPath, deniedDocsPath } from "../security.js";
import { RunRequest, launchRun } from "../exec-run.js";
import { cancelRun } from "../supervisor/reconcile.js";
import { join as pjoin } from "node:path";
import { projectsHomeFromEnv, updateConfig, loadConfigFromDisk, type ConfigPatch } from "../lib/config.js";
import {
  validateDocsSourcePath, lexicalValidate, sourceId,
  MAX_DOCS_SOURCES, MAX_DOCS_PATH_LEN, MAX_DOCS_LABEL_LEN,
} from "../lib/docssources.js";
import { validateProjectRoot, revalidateForPersist } from "../lib/projectroot.js";
import { listEvalLoops, loopTrend, scorecardDetail, loopProposal, gateStatus } from "../adapters/evals.js";
import { loadEvalsConfig, updateEvalsConfig, EvalsConfigBody } from "../lib/evalsconfig.js";

// PV3: activeRunsWarning 산출. listRuns 재사용(신규 스캐너 금지) → status.json running 카운트.
//   재시작 시 고아될 라이브 supervised run 판정(owner 레지스트리 cross-restart 는 미사용 — 열린질문 4).
const ACTIVE_RUN_STATES = new Set<string>(["running"]);

// F7 PUT/rollback 요청 스키마(Zod 신뢰경계). 해시는 sha256 hex 64자 고정. content 는 char 상한(byte 상한은
//   핸들러에서 재검증 — UTF-8 byte ≥ char). evalProposal 은 파싱만(존재 시 fail-closed 거부·DW11).
const EvalProposalSchema = z.object({ nonce: z.string(), envelope: z.unknown() }).passthrough();
const PutDefBody = z.object({
  content: z.string().max(1048576), // 느슨한 char 상한(Fastify bodyLimit 정합) — byte 상한(MAX_DEF_BYTES)은 핸들러가 권위 검증
  baseHash: z.string().length(64),
  pathId: z.string().length(64),
  evalProposal: EvalProposalSchema.optional(),
}).strict();
const RollbackBody = z.object({
  expectedCurrentHash: z.string().length(64),
  backupHash: z.string().length(64),
}).strict();
async function countActiveRuns(projectRoot: string): Promise<number> {
  const { runs } = await listRuns(projectRoot);
  return runs.filter((r) => {
    if (!r.valid || !r.status || typeof r.status !== "object") return false;
    const state = (r.status as { state?: unknown }).state;
    return typeof state === "string" && ACTIVE_RUN_STATES.has(state);
  }).length;
}

export function registerApi(
  app: FastifyInstance, projectRoot: string, opts: { buildExec?: ExecFn; home?: string } = {},
): void {
  // F10(M15) 빌드 초안 exec 경계(주입 가능·테스트는 mock·실 LLM 미호출). 기본 = safeExec(execFile+argv·shell 금지).
  const buildExec: ExecFn = opts.buildExec ?? ((cmd, args, eopts) => safeExec(cmd, args, eopts));
  const home: string = opts.home ?? homedir(); // F11 팩토리 유지관리 HOME(주입 가능·테스트는 임시 dir).
  // HB8 백프레셔 게이트(registerApi 인스턴스별 — draft·create 공통 in-flight 뮤텍스 + draft 쿨다운).
  const buildGate = new BuildGate();

  app.get("/api/runtimes", async () => detectRuntimes());

  app.get("/api/harness", async () => harnessInventory(projectRoot));
  app.get("/api/harnesses", async () => listHarnesses(projectRoot)); // 하네스 목록(오케스트레이터→에이전트 파생)
  app.get("/api/skills-usage", async () => skillUsage(projectRoot)); // F13(M-b): 공용·서브 스킬 역인덱스·분류(읽기전용·"usage" 스킬명 shadow 회피·별 네임스페이스)

  // :name 은 논리적 이름(메모리 배열 필터 — FS 접근 아님). 공백 포함 이름 허용, 길이만 제한.
  const okName = (n: string) => n.length > 0 && n.length <= 200;

  app.get("/api/agents", async () => ({ agents: await readAgents(projectRoot) }));
  app.get<{ Params: { name: string } }>("/api/agents/:name", async (req, reply) => {
    if (!okName(req.params.name)) return reply.code(400).send({ error: "invalid-name" });
    const found = (await readAgents(projectRoot)).find((a) => a.name === req.params.name);
    return found ?? reply.code(404).send({ error: "not-found" });
  });

  // F2(M10·A64): 에이전트 프리필 초안(정의에서 재도출·클라 주장 무시·read-only·side-effect 0).
  // :name 은 FS 재도출 진입점 → isSafeSegment 상향(../·공백/메타 거부, `/api/agents/:name` 의 okName 보다 엄격).
  // suggestedAllowedTools = 정의 tools = U⊆D 상한 D. permissionMode 는 항상 보수적 read-only(상향은 사용자 명시).
  app.get<{ Params: { name: string } }>("/api/agents/:name/run-template", async (req, reply) => {
    if (!isSafeSegment(req.params.name)) return reply.code(400).send({ error: "invalid-name" });
    const info = await findAgent(projectRoot, req.params.name);
    if (!info) return reply.code(404).send({ error: "not-found" });
    return {
      agent: info.name,
      runtime: info.runtime,
      domainTemplate: info.domainTemplate,
      targets: info.targets,
      suggestedAllowedTools: info.tools,
      permissionMode: "read-only",
      fingerprint: agentFingerprint(info),
    };
  });

  app.get("/api/skills", async () => ({ skills: await readSkills(projectRoot) }));
  app.get<{ Params: { name: string } }>("/api/skills/:name", async (req, reply) => {
    if (!okName(req.params.name)) return reply.code(400).send({ error: "invalid-name" });
    const found = (await readSkills(projectRoot)).find((s) => s.name === req.params.name);
    return found ?? reply.code(404).send({ error: "not-found" });
  });

  // ── F7(M12) 정의 편집기 — DW1~DW11. I8 읽기전용 원칙의 유일 예외(`.claude` 정의 편집만·게이트 스코프) ──
  // mutating(PUT/rollback/설정)은 security.ts onRequest 훅이 Host/Origin/token 자동 게이트(추가 배선 불요·/api 하위).
  // DW1 매 요청 strict boolean 판독 — 부재/손상/판독불가 config → false(fail-closed) → 403.
  // F14(M-c·§8-2·A184): Windows mutation 차단을 **route 진입부**에 — writeBackup/ensureCreatePath 등 어떤 FS 변경보다 앞.
  //   (writeDefSafe 내부 차단은 최종 방어이나 backup·dir 생성이 그 전에 일어날 수 있어 route 진입에서 선차단.)
  const winWriteBlocked = (reply: import("fastify").FastifyReply): boolean => {
    if (process.platform === "win32") { reply.code(501).send({ error: "unsupported-platform-write" }); return true; }
    return false;
  };
  async function isEditEnabled(): Promise<boolean> {
    try { return (await loadConfigFromDisk()).definitionEditEnabled === true; }
    catch { return false; } // unsupported-schema 등 throw → fail-closed
  }
  const editName = (n: string) => n.length > 0 && n.length <= 200; // :name 논리 이름(경로 아님)
  const resolveDef = (kind: DefKind, name: string): Promise<DefResolution> =>
    kind === "agent" ? resolveEditableAgent(projectRoot, name) : resolveEditableSkill(projectRoot, name);
  // DefResolution 오류 → HTTP 코드. not-found=404·ambiguous/codex-only=409(비결정 해소·범위밖 명시).
  const resErr = (e: Exclude<DefResolution, { ok: true }>["error"]) =>
    e === "not-found" ? 404 : 409;

  // GET 정의: 이름→정규 sourcePath 서버 재조회(DW2) → 안전 read(DW3) → content+baseHash+pathId+mtime+editable.
  function registerDefRoutes(kind: DefKind) {
    const seg = kind === "agent" ? "agents" : "skills";
    app.get<{ Params: { name: string } }>(`/api/${seg}/:name/definition`, async (req, reply) => {
      if (!editName(req.params.name)) return reply.code(400).send({ error: "invalid-name" });
      const r = await resolveDef(kind, req.params.name);
      if (!r.ok) return reply.code(resErr(r.error)).send({ error: r.error });
      const abs = await safeDefPath(projectRoot, r.sourcePath, kind);
      if (!abs) return reply.code(400).send({ error: "path-unsafe" });
      const f = await readDefSafe(abs);
      if (!f) return reply.code(404).send({ error: "not-found" });
      return {
        name: req.params.name, sourcePath: r.sourcePath, pathId: sha256(r.sourcePath),
        content: f.content, baseHash: sha256(f.content), mtimeMs: f.mtimeMs,
        editable: await isEditEnabled(),
      };
    });

    // PUT 저장: 게이트(DW1)·evalProposal fail-closed(DW11)·pathId 일치·낙관적 동시성(DW6)·무결성(DW5)·
    //   백업(DW7)·원자 쓰기(DW4). 저장은 파일 기록만·실행 트리거 안 함(DW9).
    app.put<{ Params: { name: string } }>(`/api/${seg}/:name/definition`, async (req, reply) => {
      if (!(await isEditEnabled())) return reply.code(403).send({ error: "edit-disabled" });
      if (winWriteBlocked(reply)) return; // F14(M-c): Windows write 차단(진입부)
      if (!editName(req.params.name)) return reply.code(400).send({ error: "invalid-name" });
      const parsed = PutDefBody.safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: "bad-input", detail: parsed.error.issues });
      // DW11: evalProposal 존재 = F8 제안 적용 경로(crypto 미구현·M13 의존) → fail-closed 거부.
      //   무음 일반편집 통과 절대 금지(통합-2 F8→F7 우회 차단). 부재 = 일반 편집(DW1~DW7).
      if (parsed.data.evalProposal !== undefined) return reply.code(409).send({ error: "proposal-not-available" });
      const { content, baseHash, pathId } = parsed.data;
      if (Buffer.byteLength(content, "utf8") > MAX_DEF_BYTES) return reply.code(400).send({ error: "too-large" });

      const r = await resolveDef(kind, req.params.name);
      if (!r.ok) return reply.code(resErr(r.error)).send({ error: r.error });
      if (sha256(r.sourcePath) !== pathId) return reply.code(409).send({ error: "path-id-mismatch" }); // GET↔PUT 다른 정의 타격 차단
      const abs = await safeDefPath(projectRoot, r.sourcePath, kind);
      if (!abs) return reply.code(400).send({ error: "path-unsafe" });
      // MED(codex·lost-update): read-hash-backup-write 를 정의별 뮤텍스로 단일 임계구역화 —
      //   같은 baseHash 동시 두 PUT 중 하나만 성공, 다른 하나는 재-read 로 stale(409).
      return withDefLock(r.sourcePath, async () => {
        const cur = await readDefSafe(abs);
        if (!cur) return reply.code(404).send({ error: "not-found" });
        const prevHash = sha256(cur.content);
        if (prevHash !== baseHash) return reply.code(409).send({ error: "stale-write", currentHash: prevHash });
        // F15(M-e): toml=limited-edit(직전본 cur.content 대비 semantic diff) · md=기존. 확장자 라우팅.
        const canon = canonicalizeByPath(r.sourcePath, content, kind, req.params.name, cur.content);
        // agy#1(HIGH): canonical 출력이 read cap 초과면 write 前 400 too-large(디스크 미기록·은폐 불가).
        if (!canon.ok) {
          if (canon.error === "too-large") return reply.code(400).send({ error: "too-large" });
          return reply.code(400).send({ error: "integrity", detail: canon.error });
        }
        // 백업(직전 1개·opaque 파일명) 성공 후 경화 원자 교체. 백업 실패 시 저장 중단(되돌리기 불가 상태 방지).
        try { await writeBackup(r.sourcePath, cur.content); }
        catch { return reply.code(400).send({ error: "backup-failed" }); }
        // DW3/DW4 경화쓰기(부모 체인 재검증·TOCTOU 스왑 감지). 스왑 등 위반 = fail-closed 400.
        try { await writeDefSafe(projectRoot, r.sourcePath, kind, canon.canonical); }
        catch { return reply.code(400).send({ error: "path-unsafe" }); }
        await appendConfigChange(projectRoot, { at: new Date().toISOString(), action: "edit", kind, name: req.params.name, runtime: runtimeOfPath(r.sourcePath), path: r.sourcePath }); // F14: 런타임 태그=sourcePath 기반(claude/gemini)
        return {
          ok: true, prevHash, newHash: sha256(canon.canonical), pathId, sourcePath: r.sourcePath,
          codexDriftWarning: true, // DW8/F7.7: Codex 듀얼(.codex/.agents) 피어는 v0.7 비대상 — drift 경고만.
        };
      });
    });

    // POST rollback: 게이트 → 현재 해시==expectedCurrentHash(DW6) → 백업 해시==backupHash(변조 거부) →
    //   백업 DW5 재검증(손상본 복원 차단) → DW3 재실행 → 원자 복원.
    app.post<{ Params: { name: string } }>(`/api/${seg}/:name/definition/rollback`, async (req, reply) => {
      if (!(await isEditEnabled())) return reply.code(403).send({ error: "edit-disabled" });
      if (winWriteBlocked(reply)) return; // F14(M-c): Windows write 차단(진입부)
      if (!editName(req.params.name)) return reply.code(400).send({ error: "invalid-name" });
      const parsed = RollbackBody.safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: "bad-input", detail: parsed.error.issues });
      const { expectedCurrentHash, backupHash } = parsed.data;
      const r = await resolveDef(kind, req.params.name);
      if (!r.ok) return reply.code(resErr(r.error)).send({ error: r.error });
      const abs = await safeDefPath(projectRoot, r.sourcePath, kind);
      if (!abs) return reply.code(400).send({ error: "path-unsafe" });
      // 정의별 뮤텍스(PUT 과 동일 키) — rollback 의 read-hash-check-write 도 단일 임계구역.
      return withDefLock(r.sourcePath, async () => {
        const cur = await readDefSafe(abs);
        if (!cur) return reply.code(404).send({ error: "not-found" });
        const curHash = sha256(cur.content);
        if (curHash !== expectedCurrentHash) return reply.code(409).send({ error: "stale-rollback", currentHash: curHash });
        const backup = await readBackup(r.sourcePath);
        if (backup === null) return reply.code(404).send({ error: "no-backup" });
        if (sha256(backup) !== backupHash) return reply.code(409).send({ error: "backup-hash-mismatch" }); // 손상/변조 백업 거부
        // F15(M-e): 복원=직전 유효본(신뢰 백업) 재검증(semantic diff 없음). restore:true 로 null-toml 복원 허용
        //   (일반 create 경로의 null-toml 우회는 restore 플래그 부재로 fail-closed·R2 방어).
        const canon = canonicalizeByPath(r.sourcePath, backup, kind, req.params.name, null, { restore: true }); // 손상본 복원 차단(DW5 재검증)
        // agy#1(HIGH): 복원본 canonical 도 read cap 이내여야 write(은폐 유발 복원 차단).
        if (!canon.ok) {
          if (canon.error === "too-large") return reply.code(400).send({ error: "too-large" });
          return reply.code(400).send({ error: "integrity", detail: canon.error });
        }
        // DW3/DW4 경화쓰기(부모 체인 재검증·TOCTOU 스왑 감지).
        try { await writeDefSafe(projectRoot, r.sourcePath, kind, canon.canonical); }
        catch { return reply.code(400).send({ error: "path-unsafe" }); }
        return { ok: true, prevHash: curHash, restoredHash: sha256(canon.canonical), pathId: sha256(r.sourcePath) };
      });
    });
  }
  registerDefRoutes("agent");
  registerDefRoutes("skill");

  // ── F10(M15) 하네스 컨텍스트 관리 + 빌더 — 멀티런타임 읽기(HR)·편집 게이트(HR6)·빌드(HB) ──
  //   읽기 = 신규 화이트리스트(deniedContextPath·전역 DENY 미수정). 쓰기 = `.claude/agents·skills`+신규만(I8).

  // A121·A129: 멀티런타임 화이트리스트 트리(각 노드 runtime 라벨·MAX_CONTEXT_NODES 바운드·truncated).
  app.get("/api/context/tree", async () => contextTree(projectRoot));

  // A122: 파일 열람(HR1~HR7). classify(구조 화이트리스트) + deniedContextPath(dot/시크릿/node_modules) →
  //   openSafeFile(심링크·O_NOFOLLOW·dev/ino·realpath 이중앵커·CSP) 재사용. md/TOML 텍스트 렌더(실행 안 함).
  app.get<{ Querystring: { path?: string; download?: string } }>("/api/context/file", async (req, reply) => {
    const parsed = z.string().min(1).max(1024).safeParse(req.query.path);
    if (!parsed.success) return reply.code(400).send({ error: "invalid-path" });
    const rel = parsed.data;
    const segs = rel.split("/").filter((s) => s.length > 0);
    const c = classifyContextPath(segs);
    if (!c) return reply.code(400).send({ error: "invalid-path" });          // HR1/HR2 구조 위반
    if (deniedContextPath(rel)) return reply.code(400).send({ error: "invalid-path" }); // HR2/HR4/HR7 denylist
    const base = c.baseSegs.length ? join(projectRoot, ...c.baseSegs) : projectRoot;
    // openSafeFile 은 projectRoot→base 중간 조상을 walk 하지 않음 → 서브루트 앵커 세그먼트를 ancestors 로 전달.
    const ancestors = c.baseSegs.slice(0, -1).map((_, i) => join(projectRoot, ...c.baseSegs.slice(0, i + 1)));
    const r = await openSafeFile(projectRoot, base, c.restSegs, {
      denyPath: deniedContextPath, isSafeSeg: isSafeDocsSegment,
      ancestors: ancestors.length ? ancestors : undefined,
    });
    if (!r.ok) return reply.code(r.code).send({ error: r.error });
    try {
      if (req.query.download !== undefined) return await sendDownload(reply, r, DOWNLOAD_MAX);
      return await sendPreview(reply, r, rel, VIEW_MAX, CONTEXT_RENDERABLE_EXT); // TOML 렌더 포함(A122)
    } finally { await r.fh.close().catch(() => {}); }
  });

  // 이 라우트는 **아무것도 쓰지 않는다**(I8 — 쓰기 경계 불변). 편집 진입 안내만: 편집 가능 **정의 파일**(F7 대상)은
  //   edit-via-f7 로 딥링크, 그 외는 읽기전용. F15(M-e·R4 drift 해소): 편집 가능 판정을 **레지스트리 editable dir**
  //   기준으로 일반화 — claude·gemini md 에이전트/스킬 + codex toml 에이전트가 모두 F7 편집 가능해졌으므로
  //   런타임 하드코딩(claude만 f7·나머지 -edit-v0.7) drift 제거. 비-정의(references·top rules 파일)는 여전히 읽기전용.
  const ContextEditBody = z.object({ path: z.string().min(1).max(1024) }).passthrough();
  app.put("/api/context/edit", async (req, reply) => {
    const parsed = ContextEditBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "bad-input", detail: parsed.error.issues });
    const c = classifyContextPath(parsed.data.path.split("/").filter((s) => s.length > 0));
    if (!c) return reply.code(400).send({ error: "invalid-path" });
    const dir = c.baseSegs.join("/");
    const rs = c.restSegs;
    // F7 편집 가능 정의: 에이전트(editable md dir + *.md · editable toml dir + *.toml) 또는 스킬(editable dir + */SKILL.md).
    //   R5(codex LOW): 파일/디렉토리명은 ARGV_TOKEN(첫 글자 영숫자·점시작 dotfile 거부) — 웹 정규식과 동일 엄격도
    //   (`.hidden.toml` 류 false-positive edit-via-f7 차단). `.gemini`는 애초에 classifyContextPath 에서 400(트리 밖).
    const nameOk = (s: string) => ARGV_TOKEN.test(s);
    const isAgentDef = rs.length === 1 && (
      (editableMdAgentDirs().includes(dir) && rs[0]!.endsWith(".md") && nameOk(rs[0]!.slice(0, -3))) ||
      (editableTomlAgentDirs().includes(dir) && rs[0]!.endsWith(".toml") && nameOk(rs[0]!.slice(0, -5)))
    );
    const isSkillDef = rs.length === 2 && editableSkillDirs().includes(dir) && rs[1] === "SKILL.md" && nameOk(rs[0]!);
    if (isAgentDef || isSkillDef) return reply.code(409).send({ error: "edit-via-f7", runtime: c.runtime });
    // claude 서브루트의 비-정의(references·CLAUDE.md 등) = 읽기전용. 그 외 런타임의 비-정의 = v0.7 비대상 읽기전용.
    if (c.runtime === "claude") return reply.code(409).send({ error: "context-file-readonly", runtime: c.runtime });
    return reply.code(409).send({ error: `${c.runtime}-edit-v0.7`, runtime: c.runtime });
  });

  // A124·HB1~HB4·HB7·HB8: 빌드 초안(폼→초안 반환·디스크 미기록). 게이트(definitionEditEnabled) + 백프레셔.
  app.post("/api/context/build/draft", async (req, reply) => {
    // MED(R4 codex): 게이트/입력 검증은 백프레셔 게이트 **밖**에서 — exec/LLM 미실행 요청(403 edit-disabled·
    //   400 bad-input)이 쿨다운(lastDraftMs)을 소비하거나 in-flight 를 점유하지 않게. 유효 요청만 acquire →
    //   동시성/쿨다운 계약은 실제 exec 시도 간에만 성립(HB8 의미 불변).
    if (!(await isEditEnabled())) return reply.code(403).send({ error: "edit-disabled" }); // HB7 fail-closed
    if (winWriteBlocked(reply)) return; // F14(M-c): Windows write 차단(진입부)
    const parsed = BuildDraftInput.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "bad-input", detail: parsed.error.issues }); // HB1 bounded
    const g = buildGate.acquire(true); // HB8 in-flight 뮤텍스 + 쿨다운(유효 요청·exec 진입 직전)
    if (!g.ok) return reply.code(429).send({ error: g.reason });
    try {
      const r = await draftDefinition(parsed.data, buildExec); // HB2 execFile+argv·timeout·maxBuffer·HB4 디스크 미기록
      if (!r.ok) return reply.code(502).send({ error: r.error });
      return { ok: true, kind: r.kind, draft: r.draft, applied: false }; // HB4 no-auto-apply(표시만)
    } finally { buildGate.release(true); }
  });

  // C: 하네스 전체 초안(오케스트레이터+에이전트+스킬 세트). draft 만·디스크 미기록. 생성은 사람 승인 후 build/create 반복.
  app.post("/api/context/build/harness-draft", async (req, reply) => {
    if (!(await isEditEnabled())) return reply.code(403).send({ error: "edit-disabled" }); // HB7 fail-closed
    if (winWriteBlocked(reply)) return; // F14(M-c): Windows write 차단(진입부)
    const parsed = BuildHarnessInput.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "bad-input", detail: parsed.error.issues });
    const g = buildGate.acquire(true); // HB8 in-flight + 쿨다운(exec spawn)
    if (!g.ok) return reply.code(429).send({ error: g.reason });
    try {
      const r = await draftHarness(parsed.data, buildExec);
      if (!r.ok) return reply.code(502).send({ error: r.error });
      return { ok: true, draft: r.draft, applied: false }; // no-auto-apply(표시만·생성은 별 build/create)
    } finally { buildGate.release(true); }
  });

  // A125·A126·HB5·HB6: 승인 초안 → 신규 정의 생성(신규 구축·F7 저장 전건 통과). `.claude/agents·skills` 스코프만.
  const BuildCreateBody = z.object({
    kind: z.enum(["agent", "skill"]),
    name: z.string().min(1).max(120),
    content: z.string().max(1048576),
  }).strict();
  app.post("/api/context/build/create", async (req, reply) => {
    // MED(R4 codex 정합): 게이트/입력 검증은 백프레셔 게이트 밖에서(403/400 은 in-flight 미점유). 유효 요청만 acquire.
    if (!(await isEditEnabled())) return reply.code(403).send({ error: "edit-disabled" }); // HB7
    if (winWriteBlocked(reply)) return; // F14(M-c): Windows write 차단(진입부)
    const parsed = BuildCreateBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "bad-input", detail: parsed.error.issues });
    const { kind, name, content } = parsed.data;
    if (Buffer.byteLength(content, "utf8") > MAX_DEF_BYTES) return reply.code(400).send({ error: "too-large" });
    if (!ARGV_TOKEN.test(name) || name.length > 120) return reply.code(400).send({ error: "invalid-name" });
    // HB6 무결성: canonicalize(strict YAML·완전 스키마·name 불변)·초안 무결성 위반 400(폴리글롯/필수누락).
    const canon = canonicalizeDefinition(content, kind, name);
    if (!canon.ok) {
      if (canon.error === "too-large") return reply.code(400).send({ error: "too-large" });
      return reply.code(400).send({ error: "integrity", detail: canon.error });
    }
    const sourcePath = kind === "agent" ? `.claude/agents/${name}.md` : `.claude/skills/${name}/SKILL.md`;
    const g = buildGate.acquire(false); // HB8 in-flight 뮤텍스(유효 요청 진입 직전·exec 아님 → 쿨다운 미적용)
    if (!g.ok) return reply.code(429).send({ error: g.reason });
    try {
      return await withDefLock(sourcePath, async () => {
        // 논리 이름 충돌(기존 claude 정의 존재) → 409.
        const existing = await resolveDef(kind, name);
        if (existing.ok) return reply.code(409).send({ error: "name-collision" });
        // HB5 신규 생성 경로안전(부모 심링크 거부·skill dir mkdir 안전·leaf 미존재 확인).
        const cp = await ensureCreatePath(projectRoot, kind, name);
        if (!cp.ok) {
          // LOW-1: 경로안전 위반 잔여코드(parent-unsafe/mkdir-failed/escape)를 웹 매핑된 path-unsafe 로 정규화.
          //   invalid-name(400)·name-collision(409) 은 그대로 전달(웹 매핑 존재).
          const err = (cp.error === "parent-unsafe" || cp.error === "mkdir-failed" || cp.error === "escape")
            ? "path-unsafe" : cp.error;
          return reply.code(cp.code).send({ error: err });
        }
        // HB6 저장 = F7 경화 원자쓰기(부모 체인 재검증·TOCTOU 스왑 감지) 재사용.
        try { await writeDefSafe(projectRoot, sourcePath, kind, canon.canonical); }
        catch { return reply.code(400).send({ error: "path-unsafe" }); }
        await appendConfigChange(projectRoot, { at: new Date().toISOString(), action: "create", kind, name, runtime: "claude", path: sourcePath });
        return { ok: true, created: true, sourcePath, pathId: sha256(sourcePath), newHash: sha256(canon.canonical) };
      });
    } finally { buildGate.release(false); }
  });

  // DW1/DW8: 게이트 노브 토글(mutating·F3.7 원자 RMW·타 필드 보존). Zod strict boolean(그 외 400).
  const DefEditBody = z.object({ enabled: z.boolean() }).strict();
  app.post("/api/settings/definition-edit", async (req, reply) => {
    const parsed = DefEditBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "bad-input", detail: parsed.error.issues });
    const next = await updateConfig({ definitionEditEnabled: parsed.data.enabled }); // projectRoot/projectsHome/evals 보존
    return { ok: true, definitionEditEnabled: next.definitionEditEnabled };
  });

  // F11: 팩토리(myharness) 유지관리 — 웹에서 설치·업데이트·제거 명확화.
  //   상태 조회는 무게이트(읽기). 쓰기(apply)는 factoryMaintenanceEnabled 게이트 + confirm(제거).
  app.get("/api/factory/status", async () => {
    const cfg = await loadConfigFromDisk();
    return factoryStatus({ projectRoot, home, maintenanceEnabled: cfg.factoryMaintenanceEnabled === true });
  });
  const FactoryMaintBody = z.object({ enabled: z.boolean() }).strict();
  app.post("/api/settings/factory-maintenance", async (req, reply) => {
    const parsed = FactoryMaintBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "bad-input", detail: parsed.error.issues });
    const next = await updateConfig({ factoryMaintenanceEnabled: parsed.data.enabled }); // 타 필드 보존
    return { ok: true, factoryMaintenanceEnabled: next.factoryMaintenanceEnabled };
  });
  const FactoryApplyBody = z.object({
    target: z.enum(["claude-skill", "shared-skill"]),
    action: z.enum(["install", "update", "remove"]),
    confirm: z.boolean().optional(),
  }).strict();
  app.post("/api/factory/apply", async (req, reply) => {
    const parsed = FactoryApplyBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "bad-input", detail: parsed.error.issues });
    const cfg = await loadConfigFromDisk();
    if (cfg.factoryMaintenanceEnabled !== true) return reply.code(403).send({ error: "maintenance-disabled" }); // fail-closed 게이트
    try {
      const r = await applyFactoryAction({
        projectRoot, home, target: parsed.data.target, action: parsed.data.action,
        confirm: parsed.data.confirm, nowMs: Date.now(),
      });
      return r;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // 예상 사유는 409(계약 위반)·그 외 500.
      const known = ["confirm-required", "source-not-factory", "unknown-target", "parent-unsafe"];
      return reply.code(known.includes(msg) ? 409 : 500).send({ error: msg });
    }
  });

  // 무인자(raw 쿼리 부재) → 기존 listRuns({runs} 계약 불변). 인자 → RunsQuery 검증 후 queryRuns.
  // presence 판단은 Zod default 적용 前 raw 쿼리로(default가 무인자를 인자로 오판 방지).
  app.get<{ Querystring: Record<string, unknown> }>("/api/runs", async (req, reply) => {
    if (Object.keys(req.query ?? {}).length === 0) return listRuns(projectRoot);
    const parsed = RunsQuery.safeParse(req.query);
    if (!parsed.success) return reply.code(400).send({ error: "invalid-query", detail: parsed.error.issues });
    return queryRuns(projectRoot, parsed.data);
  });
  app.get<{ Params: { runId: string } }>("/api/runs/:runId", async (req, reply) => {
    const r = await getRun(projectRoot, req.params.runId);
    return r ?? reply.code(404).send({ error: "not-found" });
  });
  app.get<{ Params: { runId: string }; Querystring: { after?: string; limit?: string } }>(
    "/api/runs/:runId/events",
    async (req) => {
      // after 미지정 = -1(seq 0 포함). 지정 시 그 값 이후(exclusive).
      const after = req.query.after !== undefined ? Number.parseInt(req.query.after, 10) : -1;
      const limit = Number.parseInt(req.query.limit ?? "200", 10);
      return readEvents(projectRoot, req.params.runId, after, limit); // 클램프는 adapter 내부
    },
  );
  app.get<{ Params: { runId: string } }>("/api/runs/:runId/agents", async (req) =>
    readRunAgents(projectRoot, req.params.runId));

  // artifact list + serve(untrusted): 공용 경화 리더(openSafeFile) 소비 — SAFE_SEGMENT·denylist·심링크 거부·
  // O_NOFOLLOW·dev/ino 바인딩·CSP·nosniff·attachment·크기 상한. base 앵커 = runId/artifacts.
  app.get<{ Params: { runId: string } }>("/api/runs/:runId/artifacts", async (req, reply) => {
    if (!isSafeSegment(req.params.runId)) return reply.code(400).send({ error: "invalid-runId" });
    const dir = join(projectRoot, "_workspace", "runs", req.params.runId, "artifacts");
    try {
      const e = await readdir(dir, { withFileTypes: true });
      return { files: e.filter((x) => x.isFile() && !x.isSymbolicLink()).map((x) => x.name) };
    } catch { return { files: [] }; }
  });
  app.get<{ Params: { runId: string; "*": string } }>("/api/runs/:runId/artifacts/*", async (req, reply) => {
    if (!isSafeSegment(req.params.runId)) return reply.code(400).send({ error: "invalid-runId" });
    const runsRoot = join(projectRoot, "_workspace", "runs");
    const base = join(runsRoot, req.params.runId, "artifacts");
    const segs = (req.params["*"] ?? "").split("/");
    const r = await openSafeFile(projectRoot, base, segs, {
      denyPath: deniedPath, ancestors: [join(runsRoot, req.params.runId)],
    });
    if (!r.ok) return reply.code(r.code).send({ error: r.error });
    try { return await sendDownload(reply, r, DOWNLOAD_MAX); }
    finally { await r.fh.close().catch(() => {}); }
  });

  // F5 docs 뷰어(DV1~DV9): 트리(화이트루트 docs/ 재귀) + 파일 열람. 읽기전용(I8).
  // 미리보기(기본) = JSON {content,mime,renderable,binary,truncated,size}(원문 텍스트·sanitize는 클라).
  // ?download=1 = attachment 원본(다운로드 前 413·중간중단 금지). 두 응답 모두 엄격 CSP + nosniff.
  //
  // F9(M14): 다중 소스 확장. 무 source = 기본 `docs`(레거시·config 미읽음·완전 하위호환).
  //   ?source=<id> = config docsSources 해석. **요청마다 loadConfigFromDisk()** 최신본을 읽어 Settings 변경
  //   즉시 반영(모듈 상수 캐시 금지·R1). (F3 projectRoot 는 모듈 상수 캡처라 재시작 필요 — 성격 차이.)
  //   소스 경로는 **serve 시점 validateDocsSourcePath 재검증**(DS7 TOCTOU·등록 후 심링크 스왑 차단).

  // 등록 소스 목록 {id,label,path,valid,enabled}. valid=경로 검증 통과·enabled=docsMenuEnabled.
  app.get("/api/docs/sources", async () => {
    const cfg = await loadConfigFromDisk();
    const enabled = cfg.docsMenuEnabled;
    const sources = [];
    for (const s of cfg.docsSources) {
      const v = await validateDocsSourcePath(s.path, projectRoot);
      sources.push({ id: sourceId(s.path), label: s.label, path: s.path, valid: v.ok, enabled });
    }
    return { enabled, sources };
  });

  app.get<{ Querystring: { source?: string } }>("/api/docs", async (req, reply) => {
    const id = req.query.source;
    if (id === undefined) return docsTree(projectRoot); // 레거시 하위호환(무설정·config 미읽음)
    const cfg = await loadConfigFromDisk();
    if (!cfg.docsMenuEnabled) return { enabled: false, root: null, tree: [], count: 0, truncated: false };
    const s = cfg.docsSources.find((x) => sourceId(x.path) === id);
    if (!s) return reply.code(400).send({ error: "invalid-source" });
    const v = await validateDocsSourcePath(s.path, projectRoot); // DS7 재검증
    // L1: 세 분기 동형 shape {enabled,root,tree,count,truncated}. 무효 소스 = 빈 트리(enabled 유지).
    if (!v.ok) return { enabled: true, root: s.path, tree: [], count: 0, truncated: false };
    return { enabled: true, ...(await docsTree(projectRoot, v.base, s.path)) };
  });

  app.get<{ Params: { "*": string }; Querystring: { download?: string; source?: string } }>("/api/docs/*", async (req, reply) => {
    const rel = req.params["*"] ?? "";
    const segs = rel.split("/");
    let base: string;
    let ancestors: string[] | undefined;
    const id = req.query.source;
    if (id === undefined) {
      base = join(projectRoot, "docs"); // 레거시 하위호환
    } else {
      const cfg = await loadConfigFromDisk();
      // 토글 정합(informational LOW): 파일 열람도 트리 라우트와 동일하게 docsMenuEnabled=false면 비활성.
      //   (보안경계 아님 — 트리↔열람 토글 일관성. 무 source 레거시 경로는 미게이트·하위호환.)
      if (!cfg.docsMenuEnabled) return reply.code(404).send({ error: "docs-menu-disabled" });
      const s = cfg.docsSources.find((x) => sourceId(x.path) === id);
      if (!s) return reply.code(400).send({ error: "invalid-source" });
      const v = await validateDocsSourcePath(s.path, projectRoot); // DS7 TOCTOU 재검증(등록 신뢰 금지)
      if (!v.ok) return reply.code(400).send({ error: v.error });
      base = v.base;
      // openSafeFile 은 projectRoot→base 중간 조상 심링크를 walk 하지 않음 → ancestors 로 전달(전 세그먼트 커버).
      ancestors = v.segs.slice(0, -1).map((_, i) => join(projectRoot, ...v.segs.slice(0, i + 1)));
    }
    const r = await openSafeFile(projectRoot, base, segs, { denyPath: deniedDocsPath, isSafeSeg: isSafeDocsSegment, ancestors });
    if (!r.ok) return reply.code(r.code).send({ error: r.error });
    try {
      if (req.query.download !== undefined) return await sendDownload(reply, r, DOWNLOAD_MAX);
      return await sendPreview(reply, r, rel, VIEW_MAX);
    } finally { await r.fh.close().catch(() => {}); }
  });

  // F9 소스 설정 쓰기(mutating → security.ts onRequest 훅이 Host/Origin/token 자동 게이트). config 만 쓰기(I8·F3 축).
  //   Zod strict(DS6 개수/길이/미지필드 400) → 중복 경로 병합 → 각 경로 DS1~DS5 검증. dryRun = 프리뷰(디스크 미변경).
  //   무효 경로(write) → 400·config 미기록(취소 시 무변경·DS8 fail-closed).
  const DocsSourceEntry = z.object({
    label: z.string().min(1).max(MAX_DOCS_LABEL_LEN),
    path: z.string().min(1).max(MAX_DOCS_PATH_LEN),
  }).strict();
  const DocsSourcesBody = z.object({
    docsSources: z.array(DocsSourceEntry).max(MAX_DOCS_SOURCES),
    docsMenuEnabled: z.boolean().optional(),
    dryRun: z.boolean().optional().default(false),
  }).strict();
  app.post("/api/settings/docs-sources", async (req, reply) => {
    const parsed = DocsSourcesBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "bad-input", detail: parsed.error.issues });
    const { docsSources, docsMenuEnabled, dryRun } = parsed.data;
    // DS6 중복 경로 병합 — 병합 키·저장 path 를 **canonical rel**(lexicalValidate 세그먼트 재조합)로 정규화.
    //   lexical-equivalent 경로(`docs`·`./docs`·`docs//`·`docs/.`)를 한 소스로 흡수하고 sourceId 를 안정화(A115).
    //   lexical 실패 경로는 원본 보존(아래 validateDocsSourcePath 가 invalid 로 보고·저장 아님). 첫 등장 라벨 유지.
    const seen = new Set<string>();
    const merged: { label: string; path: string }[] = [];
    for (const s of docsSources) {
      const lex = lexicalValidate(s.path);
      const canonical = lex.ok ? lex.segs.join("/") : s.path.normalize("NFC");
      if (seen.has(canonical)) continue;
      seen.add(canonical);
      merged.push({ label: s.label, path: lex.ok ? canonical : s.path });
    }
    // 각 경로 DS1~DS5 검증(valid + error 코드).
    const results = [];
    for (const s of merged) {
      const v = await validateDocsSourcePath(s.path, projectRoot);
      results.push({ id: sourceId(s.path), label: s.label, path: s.path, valid: v.ok, error: v.ok ? null : v.error });
    }
    if (dryRun) {
      // DS8 dryRun: 디스크 미변경 프리뷰(per-소스 유효성·인라인 에러용·A119). 무효 있어도 200(프리뷰).
      return { ok: true, dryRun: true, written: false, docsMenuEnabled: docsMenuEnabled ?? true, sources: results };
    }
    const invalid = results.filter((r) => !r.valid);
    if (invalid.length) {
      return reply.code(400).send({ error: "invalid-source", invalid: invalid.map((r) => ({ path: r.path, error: r.error })) });
    }
    const patch: ConfigPatch = { docsSources: merged };
    if (docsMenuEnabled !== undefined) patch.docsMenuEnabled = docsMenuEnabled;
    const next = await updateConfig(patch); // RMW·뮤텍스·타 필드 보존
    return { ok: true, written: true, docsSources: next.docsSources, docsMenuEnabled: next.docsMenuEnabled };
  });

  // F6 metrics(M9 · 계층 B 읽기전용 집계). 입력 clamp·Zod. 빈/손상/디렉토리없음 → 안전 빈 응답(에러 아님).
  //   from/to = ISO window(선택). limit = 집계 편입 run 상한(1..MAX_RUNS_SCAN clamp).
  const MetricsQuery = z.object({
    from: z.string().datetime({ offset: true }).optional(),
    to: z.string().datetime({ offset: true }).optional(),
    limit: z.preprocess((v) => {
      if (v === undefined || v === null || v === "") return undefined;
      const n = typeof v === "number" ? v : Number.parseInt(String(v), 10);
      if (!Number.isFinite(n)) return undefined;
      return Math.min(MAX_RUNS_SCAN, Math.max(1, Math.trunc(n)));
    }, z.number().int().min(1).max(MAX_RUNS_SCAN).optional()),
  });
  const parseMetricsOpts = (q: unknown): MetricsOptions => {
    const p = MetricsQuery.safeParse(q ?? {});
    if (!p.success) return {}; // 잘못된 window → 전체 집계로 안전 폴백(에러 아님·A5be)
    const fromMs = p.data.from ? Date.parse(p.data.from) : null;
    const toMs = p.data.to ? Date.parse(p.data.to) : null;
    return { fromMs: Number.isFinite(fromMs) ? fromMs : null, toMs: Number.isFinite(toMs) ? toMs : null, limit: p.data.limit ?? null };
  };
  app.get<{ Querystring: Record<string, unknown> }>("/api/metrics/overview", async (req) =>
    metricsOverview(projectRoot, parseMetricsOpts(req.query)));
  app.get<{ Querystring: Record<string, unknown> }>("/api/metrics/agents", async (req) =>
    metricsAgents(projectRoot, parseMetricsOpts(req.query)));
  app.get<{ Querystring: Record<string, unknown> }>("/api/metrics/skills", async (req) =>
    metricsSkills(projectRoot, parseMetricsOpts(req.query)));

  // drift
  app.get("/api/drift", async () => ({ findings: await detectDrift(projectRoot) }));
  app.post("/api/drift/sync-plan", async () => syncPlan(projectRoot)); // 무변경(계획만)

  // F16(M-f): 스킬 사본 (dev,ino) 분류 그룹(읽기전용·side-effect 0). symlink-to-canonical/hardlink/copy-drift 등.
  app.get("/api/drift/skill-groups", async () => ({ groups: await skillSyncGroups(projectRoot) }));

  // Eval v1 E1: 아티팩트 4축 단일 평가(계층A 정적·결정적·읽기전용·side-effect 0). LLM/삭제 테스트=E3(여기 없음).
  app.get("/api/eval/artifacts", async () => evaluateArtifacts(projectRoot)); // now=고정 default(결정성·같은 repo=같은 점수·both MED)

  // F16(M-f): 명시 다타깃 동기(정본 SKILL.md 를 선택 사본에 전파). 대상별 pathId/baseHash 낙관적 동시성·부분성공.
  //   자동 동기는 symlink-to-canonical(할 것 없음)만 — copy 만 명시 apply. hardlink/symlink-to-canonical 은 정본과 물리
  //   동일(내용 항상 같음)이라 동기 대상 아님. 쓰기경계·백업·원자쓰기·게이트 = F7(defedit) 재사용.
  //   M-e fail-soft: 대상 런타임 스킬이 편집 불가면 차단(현 전부 editable·스킬은 md 공통).
  const SkillSyncBody = z.object({
    skill: z.string().min(1).max(200),
    targets: z.array(z.object({ path: z.string().min(1).max(1024), baseHash: z.string().length(64) })).min(1).max(8),
  }).strict();
  app.post("/api/drift/sync-skill", async (req, reply) => {
    if (!(await isEditEnabled())) return reply.code(403).send({ error: "edit-disabled" });
    if (winWriteBlocked(reply)) return; // Windows mutation 차단(진입부)
    const parsed = SkillSyncBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "bad-input", detail: parsed.error.issues });
    const { skill, targets } = parsed.data;
    if (!okName(skill)) return reply.code(400).send({ error: "invalid-name" });
    const groups = await skillSyncGroups(projectRoot);
    const g = groups.find((x) => x.skill === skill);
    if (!g) return reply.code(404).send({ error: "skill-group-not-found" });
    // 정본 SKILL.md 읽기 + 무결성 검증(전파 전 canonical 이 유효 스킬 정의인지·name===skill).
    const canonAbs = await safeDefPath(projectRoot, g.canonicalPath, "skill");
    if (!canonAbs) return reply.code(400).send({ error: "path-unsafe" });
    const canonRead = await readDefSafe(canonAbs);
    if (!canonRead) return reply.code(404).send({ error: "canonical-not-found" });
    // 검증만 canonicalizeDefinition(유효 정의·name===skill). 전파는 정본 **원문 바이트**(canonRead.content)로 —
    //   canonical 형태로 재작성하면 정본(원문)과 바이트 불일치 → drift 무한 재발(agy MED). 원문 전파로 사본=정본 동일.
    const canon = canonicalizeDefinition(canonRead.content, "skill", skill);
    if (!canon.ok) return reply.code(400).send({ error: "canonical-integrity", detail: canon.error });
    const canonicalContent = canonRead.content;

    const results: Array<Record<string, unknown>> = [];
    for (const t of targets) {
      const copy = g.copies.find((c) => c.path === t.path);
      if (!copy) { results.push({ path: t.path, status: "unknown-target" }); continue; }
      if (copy.cls === "canonical") { results.push({ path: t.path, status: "skip-canonical" }); continue; }
      // symlink-to-canonical·hardlink-same-inode = 정본과 물리 동일 → 동기 무의미. broken = 안전 쓰기 불가.
      if (!isSyncableTarget(copy.cls)) { results.push({ path: t.path, status: `not-syncable:${copy.cls}` }); continue; }
      // 대상별 뮤텍스 + 낙관적 baseHash + 백업 + 경화 원자쓰기(F7 재사용).
      const r = await withDefLock(t.path, async (): Promise<Record<string, unknown>> => {
        const abs = await safeDefPath(projectRoot, t.path, "skill");
        if (!abs) return { status: "path-unsafe" };
        // R3(codex LOW): classify→write TOCTOU 봉쇄 — 쓰기 직전 lock 안에서 nlink 재검증. 분류 후 대상이 foreign
        //   hardlink(nlink>1)로 바뀌면 rename 이 링크 관계를 끊는다 → 여기서 fail-closed(분류뿐 아니라 최종 쓰기 직전에도 강제).
        const l = await lstat(abs).catch(() => null);
        if (!l || l.isSymbolicLink() || !l.isFile()) return { status: "not-syncable:non-file" };
        if (l.nlink > 1) return { status: "not-syncable:foreign-hardlink" };
        const cur = await readDefSafe(abs);
        if (!cur) return { status: "not-found" };
        const prevHash = sha256(cur.content);
        if (prevHash !== t.baseHash) return { status: "stale", currentHash: prevHash };
        if (prevHash === g.canonicalHash) return { status: "already-synced" }; // 내용 이미 동일(경쟁 후)
        try { await writeBackup(t.path, cur.content); } catch { return { status: "backup-failed" }; }
        try { await writeDefSafe(projectRoot, t.path, "skill", canonicalContent); }
        catch { return { status: "path-unsafe" }; }
        return { status: "applied", newHash: sha256(canonicalContent) };
      });
      results.push({ path: t.path, ...r });
    }
    return { skill, canonicalHash: g.canonicalHash, results };
  });

  // overview 상태·통계(A35-A38) + settings
  app.get("/api/overview/state-stats", async () => stateStats(projectRoot));
  // 구성 자기평가 계층A(harness_scorecard) — Eval 화면 패널. 정적·읽기전용·결정적(now=만료판정용).
  app.get("/api/eval/harness-scorecard", async () => computeHarnessScorecard(projectRoot, { now: new Date().toISOString().slice(0, 10) }));
  // M-C 추세(읽기·summary.jsonl 파생·GET 비오염).
  app.get("/api/eval/harness-scorecard/trend", async () => readHarnessTrend(projectRoot));
  // M-C 스냅샷 기록(명시 점검 cadence). 무본문 허용·초과 필드 거부·in-flight 429·_workspace/evals 만 write(정의 파일 불변).
  let snapshotInFlight = false;   // HTTP 레벨 in-flight gate(codex — compute 포함 전체 직렬화·동시 POST 즉시 429)
  app.post("/api/eval/harness-scorecard/snapshot", async (req, reply) => {
    const parsed = z.object({}).strict().safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: "unexpected-body" });
    if (snapshotInFlight) return reply.code(429).send({ error: "snapshot-in-progress" });
    snapshotInFlight = true;
    try {
      const sc = await computeHarnessScorecard(projectRoot, { now: new Date().toISOString().slice(0, 10) });
      const r = await writeHarnessScorecardSnapshot(sc, projectRoot, new Date().toISOString());
      if (r.skipped === "contention") return reply.code(429).send({ error: "snapshot-in-progress" });
      return { written: r.written, state_key: r.state_key };
    } finally { snapshotInFlight = false; }
  });
  // 하네스 구성 변경 이력(History) — 에이전트/스킬 추가·수정·삭제(UI 발원). 읽기전용.
  app.get("/api/config-changes", async () => readConfigChanges(projectRoot));
  app.get("/api/settings", async () => settings(projectRoot));

  // F3(M11·A68~A71·A99·A101): projectRoot 편집. **mutating** → security.ts onRequest 훅이 Host/Origin/token
  //   자동 게이트(추가 배선 불요). config 만 쓰기(I8 예외·프로젝트 파일 무변경). 라이브 재바인딩 비목표(requiresRestart).
  //   신뢰경계 = env SSOT(HARNESS_PROJECTS_HOME). 미프로비저닝 → 409 boundary-not-provisioned(편집 비활성).
  const ProjectRootBody = z.object({
    path: z.string().min(1).max(4096),
    dryRun: z.boolean().optional().default(false),
  }).strict();
  app.post("/api/settings/project-root", async (req, reply) => {
    const parsed = ProjectRootBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "bad-input", detail: parsed.error.issues });
    const { path: inputPath, dryRun } = parsed.data;
    const projectsHome = projectsHomeFromEnv(); // env SSOT
    if (!projectsHome) return reply.code(409).send({ error: "boundary-not-provisioned" });
    // 공통 검증(양 모드): D1 → D4 → D3 → D2/D6 → D5.
    const v = await validateProjectRoot(inputPath, projectsHome);
    if (!v.ok) return reply.code(400).send({ error: v.error });
    const activeRunsWarning = await countActiveRuns(projectRoot); // PV3: status.json running 카운트(listRuns 재사용)
    if (dryRun) {
      // 프리뷰: 디스크 미변경(취소 시 무변경·A101).
      return { ok: true, effectiveRoot: v.effectiveRoot, activeRunsWarning, requiresRestart: true, written: false };
    }
    // 쓰기: D7 TOCTOU 재검증(지속 직전 realpath 재확인) → config RMW(projectRoot 만·타 필드 보존).
    const v2 = await revalidateForPersist(inputPath, projectsHome, v.effectiveRoot);
    if (!v2.ok) return reply.code(400).send({ error: v2.error });
    await updateConfig({ projectRoot: v2.effectiveRoot });
    return {
      accepted: true, requiresRestart: true, effectiveRoot: v2.effectiveRoot,
      appliedAt: new Date().toISOString(), activeRunsWarning,
    };
  });

  // ops status(A7·A8): 런타임 설치·버전 + 비-TTY 인증 상태.
  //   authenticated: detectRuntimes 가 claude(`auth status` JSON)·codex(`login status`)를 실조회.
  //     agy 는 CLI 비대화형 인증 조회 미지원(bubbletea /dev/tty 요구) → 자격 파일 기반 추정
  //     ("configured" 설정 감지 / "unauthenticated" 부재 / "unknown" owner 검증 불가). "인증됨" 단정 아님.
  //   usage/quota 컬럼은 제거됨 — 런타임 CLI 가 대화형 /status·provider API 로만 제공해 비-TTY 서버서 항상 조회 불가(개선 불가·상시 '불가'라 무의미).
  app.get("/api/ops/status", async () => {
    const rt = await detectRuntimes();
    return {
      updatedAt: new Date().toISOString(),
      runtimes: Object.fromEntries(Object.entries(rt).map(([k, v]) => [k, {
        installed: v.installed, version: v.version, health: v.installed ? "ok" : "absent",
        authenticated: v.installed ? v.authenticated : "absent",
      }])),
    };
  });

  // 실행(M5, 위험작업): Zod 검증 → dry-run(파일 미기록 미리보기) 또는 spawn.
  // F2(M10): agent 지정 시 제출 시점 정의 재조회·D 재도출(템플릿 시점 D 신뢰 금지·R4-#1) → U⊆D 강제.
  //   D 밖 도구 → 400 unauthorized-tool(조용한 드롭 금지). 정의 부재/지문 변경(stale 폼) → 409 agent-definition-changed.
  //   agent 미지정 일반 New Run = D 상한 없음 = v0.5 계약 그대로.
  app.post("/api/runs", async (req, reply) => {
    const parsed = RunRequest.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid-request", detail: parsed.error.issues });
    const r = parsed.data;
    if (r.agent) {
      const info = await findAgent(projectRoot, r.agent); // 제출 시점 재도출(TOCTOU 방어)
      const hasTools = r.allowedTools.length > 0;
      if (!info) {
        // 상한 검증 불가(비어있지 않은 U) 또는 클라가 지문을 echo(stale 폼) → 명시 반려. 태그만(빈 U·지문 없음) 은 무해 허용.
        if (hasTools || r.agentFingerprint) return reply.code(409).send({ error: "agent-definition-changed" });
      } else {
        if (r.agentFingerprint && r.agentFingerprint !== agentFingerprint(info)) {
          return reply.code(409).send({ error: "agent-definition-changed" });
        }
        const D = new Set(info.tools);
        const extra = r.allowedTools.filter((t) => !D.has(t)); // U \ D
        if (extra.length) return reply.code(400).send({ error: "unauthorized-tool", detail: extra });
      }
    }
    return launchRun(projectRoot, r);
  });
  app.post<{ Params: { runId: string } }>("/api/runs/:runId/cancel", async (req, reply) => {
    if (!isSafeSegment(req.params.runId)) return reply.code(400).send({ error: "invalid-runId" });
    const runDir = pjoin(projectRoot, "_workspace", "runs", req.params.runId);
    return cancelRun(runDir, req.params.runId);
  });

  // ── F8(M13) Eval 대시보드 — 축소안(Part A 읽기 + Part B 제안·자동금지 + Part C config) ──
  //   암호 원장(체인 rollup·키링·durable nonce·HMAC 서명·receipt)은 v0.7 이월(미구현). 제안 적용 =
  //   사용자가 F7 편집기로 수동 편집(evalProposal 은 F7 DW11 에서 fail-closed·409 proposal-not-available 유지).
  //   Part A/B GET = side-effect 0(순수 조회·ingest/서명/append 없음). Part C POST 만 mutating(config RMW).

  // Part C: config 읽기(GET·side-effect 0)·쓰기(POST·mutating → security.ts Host/Origin/token 자동 게이트).
  //   static 세그먼트 "config" 는 Fastify radix 우선 → `/api/evals/:loop` 파라미터보다 먼저 매칭(loop 오인 없음).
  app.get("/api/evals/config", async () => loadEvalsConfig());
  // 채택 단계 졸업 게이트(현 단계→다음 자격·근거·반대신호) — 읽기전용. 상향은 config POST(사람 결정).
  app.get("/api/evals/gate", async () => gateStatus(projectRoot, await loadEvalsConfig()));
  app.post("/api/evals/config", async (req, reply) => {
    const parsed = EvalsConfigBody.safeParse(req.body);
    // adoptionStage:4(union 실패)·floor 미만 임계(.min 실패)·미지 필드(strict) → 400(silent-clamp 아님).
    if (!parsed.success) return reply.code(400).send({ error: "bad-input", detail: parsed.error.issues });
    const next = await updateEvalsConfig(parsed.data); // evals 서브객체 원자 RMW(타 필드 보존·뮤텍스)
    return { ok: true, config: next };
  });

  // Part A: loop 목록·최근 요약(GET·읽기전용).
  app.get("/api/evals", async () => listEvalLoops(projectRoot));
  // Part A: 추세(GET·읽기전용). :loop 은 어댑터가 isSafeSegment 검증(위반 → found:false).
  app.get<{ Params: { loop: string } }>("/api/evals/:loop", async (req) => loopTrend(projectRoot, req.params.loop));
  // Part B: 제안 카드(GET·읽기전용 판정·자동 적용 절대 없음). 단계<3·데이터부족 → 비활성 사유.
  //   static "proposal" 세그먼트가 `/api/evals/:loop/:stage/:run`(4-세그) 보다 얕아 충돌 없음.
  app.get<{ Params: { loop: string } }>("/api/evals/:loop/proposal", async (req) =>
    loopProposal(projectRoot, req.params.loop, await loadEvalsConfig()));
  // Part A: scorecard 상세(GET·읽기전용). 세그먼트는 어댑터가 검증·안전 해석.
  app.get<{ Params: { loop: string; stage: string; run: string } }>(
    "/api/evals/:loop/:stage/:run",
    async (req) => scorecardDetail(projectRoot, req.params.loop, req.params.stage, req.params.run));

  app.get("/api/health", async () => ({ ok: true }));
  // /healthz — **비인증 liveness**(/api/ 아니므로 게이트 통과). 런처 멱등 판정용. 데이터 없음.
  app.get("/healthz", async () => ({ ok: true }));
}
