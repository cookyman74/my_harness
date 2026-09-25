#!/usr/bin/env node
// selftest-harness-intake.mjs — harness-intake.mjs `scan` 행동 자기검증(스텁 회귀 가드).
// 배경: v1.7.5 에 check-review-tools.sh 가 5줄 스텁(고정 출력)으로 릴리스됐다(d33d304). 텍스트 매칭 가드는 세 번 틀렸다 —
//   부분 스텁을 통과시키고 정상 리팩터를 FAIL 시켰다. 그래서 대상 소스를 보지 않고, **격리된 HOME/PATH 의 임시 프로젝트에서
//   대상을 자식 프로세스로 실행해 입력을 바꿀 때 출력이 따라 바뀌는지**만 본다.
// 가드는 대상과 **다른 파일**에 둔다 — v1.7.5 사고는 파일 전체 덮어쓰기라 같은 파일의 가드는 함께 사라진다.
// 무작위화: 에이전트 이름·model 값·스킬(scalar) 값·신규 키 이름·플러그인 이름·런타임 버전·스킬/codex/프로필 이름·프로필 개수를
//   실행마다 바꾼다 — 관측값을 상수로 박은 모방 스텁은 어느 한 실행에서 깨진다.
// 커버리지: 계약 15줄 중 고정 문자열 AGENTS_BUILTIN 을 뺀 **14줄 전부**가 어느 케이스에서 이전 출력 대비 바뀌어야 한다 —
//   한 줄이라도 안 움직이면 그 줄을 상수로 고정한 부분 스텁이 통과한다(R1 재현: PROFILE·SKILLS_*·AGENTS_CODEX·AGENTS_DUPLICATE).
//   줄 → 움직이는 케이스: RUNTIME ⑨ · AGENTS_PROJECT ②⑤⑬ · AGENTS_GLOBAL ⑥ · PLUGINS ⑦ · AGENTS_PLUGIN ⑦ · AGENTS_CODEX ⑫ ·
//   AGENTS_DUPLICATE ⑬ · SKILLS_PROJECT ⑩ · SKILLS_AGENTS ⑪ · MODEL ②⑫ · LINKS_INVALID ④⑩ · UNKNOWN_FIELDS ③ · SIGNALS ⑧ · PROFILE ⑭.
// 불변식: 매 실행 stdout 이 계약 키 15개를 각 1번, 정해진 순서로 가진다(줄을 빼거나·중복·순서를 바꾼 스텁 차단).
// 격리: HOME·USERPROFILE=<tmp>/home, PATH=<tmp>/bin(빈 디렉토리에서 시작 — 진짜 claude·codex·agy 차단. node 디렉토리를 넣으면
//   같은 곳에 설치된 진짜 codex 가 섞인다). 대상은 process.execPath 로 실행하므로 PATH 에 node 가 없어도 된다.
// 한계: 우발적 스텁 차단이 목적이다. 검사 로직을 읽고 맞춤 제작한 위장은 대상이 아니다(무작위화는 비용을 올릴 뿐 막지 못한다).
// 사용: node selftest-harness-intake.mjs [path/to/harness-intake.mjs]   → 0=PASS 1=FAIL 2=사용·환경 오류
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const WIN = process.platform === "win32";
const HERE = path.dirname(fileURLToPath(import.meta.url));

function envError(msg) { process.stdout.write(`SELFTEST: ERROR — ${msg}\n`); process.exit(2); }

const args = process.argv.slice(2);
if (args.length > 1) envError("사용: node selftest-harness-intake.mjs [대상]");
const target = path.resolve(args[0] ?? path.join(HERE, "harness-intake.mjs"));
let targetOk = false;
try { targetOk = fs.statSync(target).isFile(); } catch { targetOk = false; }
if (!targetOk) envError(`파일 없음: ${target}`);

let T;
try { T = fs.mkdtempSync(path.join(os.tmpdir(), "hi-selftest-")); }
catch (e) { envError(`임시 디렉토리 생성 실패(tmpdir='${os.tmpdir()}': ${e.code || e.message}) — 격리 디렉토리 없이는 실행하지 않는다`); }

const rnd = (p) => p + crypto.randomBytes(4).toString("hex");
// 계약 키(명세 §3 순서). 값은 보지 않고 키 순서만 — 값 검사는 케이스가 행동으로 한다.
const KEYS = ["RUNTIME", "AGENTS_PROJECT", "AGENTS_GLOBAL", "PLUGINS", "AGENTS_PLUGIN", "AGENTS_CODEX", "AGENTS_BUILTIN",
  "AGENTS_DUPLICATE", "SKILLS_PROJECT", "SKILLS_AGENTS", "MODEL", "LINKS_INVALID", "UNKNOWN_FIELDS", "SIGNALS", "PROFILE"];
const rint = (n) => crypto.randomInt(n);

let code = 2;
try {
  code = run();
} catch (e) {
  process.stdout.write(`SELFTEST: ERROR — 픽스처 준비 실패 (${e.code || e.message})\n`);
  code = 2;
} finally {
  try { fs.rmSync(T, { recursive: true, force: true }); } catch { /* 정리 실패는 결과에 영향 없음 */ }
}
process.exit(code);

function run() {
  const proj = path.join(T, "proj"), home = path.join(T, "home"), bin = path.join(T, "bin"), plug = path.join(T, "plug");
  for (const d of [proj, home, bin]) fs.mkdirSync(d, { recursive: true });

  // 환경: 상속하되 PATH·HOME·USERPROFILE 은 대소문자 무관하게 지우고 다시 넣는다(windows 의 `Path` 와 `PATH` 이중 키 방지).
  const env = {};
  for (const [k, v] of Object.entries(process.env)) {
    const u = k.toUpperCase();
    if (u !== "PATH" && u !== "HOME" && u !== "USERPROFILE") env[k] = v;
  }
  env.HOME = home; env.USERPROFILE = home; env.PATH = bin;

  let fail = false;
  const ok = (m) => process.stdout.write(`  ✓ ${m}\n`);
  const bad = (m) => { process.stdout.write(`  ✗ ${m}\n`); fail = true; };

  const scan = () => {
    const r = spawnSync(process.execPath, [target, "scan", "--root", proj], { env, cwd: T, encoding: "utf8", timeout: 30000, windowsHide: true });
    return { rc: r.status, err: r.error, out: typeof r.stdout === "string" ? r.stdout : "" };
  };
  // 계약 줄 값(같은 키가 여러 번이면 마지막). CR 제거.
  const line = (out, key) => {
    let v = null;
    for (const raw of out.split("\n")) { const s = raw.replace(/\r$/, ""); if (s.startsWith(key + ": ")) v = s.slice(key.length + 2); }
    return v;
  };
  const has = (out, key, token) => { const v = line(out, key); return v !== null && v.split(" ").includes(token); };
  const show = (out, key) => `${key}='${line(out, key)}'`;
  // stdout = 계약 줄만: 마지막 \n 뒤 빈 조각을 빼면 정확히 15줄이고 키가 KEYS 와 같은 순서(빈 줄·잡음 줄도 위반).
  const keysOf = (out) => {
    const ls = out.split("\n").map((x) => x.replace(/\r$/, ""));
    if (ls.length && ls[ls.length - 1] === "") ls.pop();
    return ls.map((x) => { const i = x.indexOf(": "); return i < 0 ? x : x.slice(0, i); });
  };

  let prev = null;
  const step = (label, mutate, checks) => {
    mutate();
    const r = scan();
    if (r.err || r.rc !== 0) bad(`${label}: 종료코드 ${r.rc}${r.err ? ` (${r.err.code || r.err.message})` : ""} — 계약 위반`);
    const ks = keysOf(r.out);
    if (ks.length !== KEYS.length || ks.some((k, i) => k !== KEYS[i])) bad(`${label}: 계약 키 15개·순서 위반 — [${ks.join(",").slice(0, 300)}]`);
    for (const [cond, what, key] of checks(r.out, prev)) {
      if (cond) ok(`${label}: ${what}`);
      else bad(`${label}: ${what} 아님 — ${show(r.out, key)}`);
    }
    prev = r.out;
  };
  const changed = (cur, p, key) => p !== null && line(cur, key) !== line(p, key);

  const A = rnd("a"), M = rnd("model-"), K = rnd("k"), S = rnd("s"), G = rnd("g"), P3 = rnd("p");
  const PLUG = rnd("plug"), MKT = rnd("mkt"), KEY = `${PLUG}@${MKT}`;
  const VER = `${rint(1000)}.${rint(1000)}.${rint(1000)}`;
  const SK = rnd("sk"), OV = rnd("o"), SA = rnd("sa"), C = rnd("c"), M2 = rnd("model-"), PR = rnd("pr");
  const AS = rint(3); // 프로필 assumed 개수(0~2) — declared 는 1 고정(명세 §6-2)
  const agentsDir = path.join(proj, ".claude", "agents");
  const agentFile = path.join(agentsDir, `${A}.md`);
  const fm = (extra) => `---\nname: ${A}\ndescription: selftest\nmodel: ${M}\n${extra}---\n본문\n`;

  // ① 빈 프로젝트 · 빈 PATH
  step("① 빈 프로젝트", () => {}, (o) => [
    [line(o, "AGENTS_PROJECT") === "none", "AGENTS_PROJECT: none", "AGENTS_PROJECT"],
    [line(o, "RUNTIME") === "agy=absent claude=absent codex=absent gemini=absent", "RUNTIME 넷 다 absent", "RUNTIME"],
  ]);

  // ② 에이전트 추가
  step("② 에이전트 추가", () => { fs.mkdirSync(agentsDir, { recursive: true }); fs.writeFileSync(agentFile, fm("")); }, (o, p) => [
    [has(o, "AGENTS_PROJECT", A) && changed(o, p, "AGENTS_PROJECT"), `AGENTS_PROJECT 에 ${A}`, "AGENTS_PROJECT"],
    [has(o, "MODEL", `${A}=${M}`) && changed(o, p, "MODEL"), `MODEL 에 ${A}=${M}`, "MODEL"],
  ]);

  // ③ 신규 frontmatter 키
  step("③ 신규 키", () => fs.writeFileSync(agentFile, fm(`${K}: x\n`)), (o, p) => [
    [has(o, "UNKNOWN_FIELDS", `${A}:${K}`) && changed(o, p, "UNKNOWN_FIELDS"), `UNKNOWN_FIELDS 에 ${A}:${K}`, "UNKNOWN_FIELDS"],
  ]);

  // ④ scalar skills:
  step("④ scalar skills", () => fs.writeFileSync(agentFile, fm(`${K}: x\nskills: ${S}\n`)), (o, p) => [
    [has(o, "LINKS_INVALID", `${A}:skills`) && changed(o, p, "LINKS_INVALID"), `LINKS_INVALID 에 ${A}:skills`, "LINKS_INVALID"],
  ]);

  // ⑤ 에이전트 삭제
  step("⑤ 에이전트 삭제", () => fs.rmSync(agentFile), (o, p) => [
    [line(o, "AGENTS_PROJECT") === "none" && changed(o, p, "AGENTS_PROJECT"), "AGENTS_PROJECT: none 으로 복귀", "AGENTS_PROJECT"],
  ]);

  // ⑥ 전역 에이전트
  step("⑥ 전역 에이전트", () => {
    const d = path.join(home, ".claude", "agents"); fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, `${G}.md`), "전역 에이전트(frontmatter 없음)\n");
  }, (o, p) => [
    [has(o, "AGENTS_GLOBAL", G) && changed(o, p, "AGENTS_GLOBAL"), `AGENTS_GLOBAL 에 ${G}`, "AGENTS_GLOBAL"],
  ]);

  // ⑦-a 설치(user) + 사용자 settings 활성
  step("⑦ 플러그인 활성(user)", () => {
    fs.mkdirSync(path.join(plug, "agents"), { recursive: true });
    fs.writeFileSync(path.join(plug, "agents", `${P3}.md`), `---\nname: ${P3}\ndescription: selftest\n---\n`);
    const pd = path.join(home, ".claude", "plugins"); fs.mkdirSync(pd, { recursive: true });
    fs.writeFileSync(path.join(pd, "installed_plugins.json"), JSON.stringify({ version: 2, plugins: { [KEY]: [{ scope: "user", installPath: plug, version: "1.0.0" }] } }));
    fs.writeFileSync(path.join(home, ".claude", "settings.json"), JSON.stringify({ enabledPlugins: { [KEY]: true } }));
  }, (o, p) => [
    [has(o, "AGENTS_PLUGIN", `${PLUG}:${P3}`) && changed(o, p, "AGENTS_PLUGIN"), `AGENTS_PLUGIN 에 ${PLUG}:${P3}`, "AGENTS_PLUGIN"],
    [has(o, "PLUGINS", `${KEY}=on,enabled_source=user`) && changed(o, p, "PLUGINS"), `PLUGINS 에 ${KEY}=on,enabled_source=user`, "PLUGINS"],
  ]);

  // ⑦-b 프로젝트 settings 가 false 로 덮음
  step("⑦ 플러그인 비활성(project)", () => {
    fs.mkdirSync(path.join(proj, ".claude"), { recursive: true });
    fs.writeFileSync(path.join(proj, ".claude", "settings.json"), JSON.stringify({ enabledPlugins: { [KEY]: false } }));
  }, (o, p) => [
    [line(o, "AGENTS_PLUGIN") === "none" && changed(o, p, "AGENTS_PLUGIN"), "AGENTS_PLUGIN: none 으로 복귀", "AGENTS_PLUGIN"],
    [has(o, "PLUGINS", `${KEY}=off,enabled_source=project`) && changed(o, p, "PLUGINS"), `PLUGINS 에 ${KEY}=off,enabled_source=project`, "PLUGINS"],
  ]);

  // ⑧ CHANGELOG.md
  step("⑧ CHANGELOG", () => fs.writeFileSync(path.join(proj, "CHANGELOG.md"), "# Changelog\n"), (o, p) => [
    [has(o, "SIGNALS", "changelog") && changed(o, p, "SIGNALS"), "SIGNALS 에 changelog", "SIGNALS"],
  ]);

  // ⑨ 가짜 claude 를 PATH 에
  step("⑨ 가짜 claude", () => {
    if (WIN) fs.writeFileSync(path.join(bin, "claude.cmd"), `@echo ${VER} (Claude Code)\r\n`);
    else { const f = path.join(bin, "claude"); fs.writeFileSync(f, `#!/bin/sh\necho '${VER} (Claude Code)'\n`); fs.chmodSync(f, 0o755); }
  }, (o, p) => [
    [has(o, "RUNTIME", `claude=${VER}`) && changed(o, p, "RUNTIME"), `RUNTIME 에 claude=${VER}`, "RUNTIME"],
  ]);

  // ⑩ 프로젝트 스킬 + scalar orchestrates
  step("⑩ 프로젝트 스킬", () => {
    const d = path.join(proj, ".claude", "skills", SK); fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, "SKILL.md"), `---\nname: ${SK}\ndescription: selftest\norchestrates: ${OV}\n---\n본문\n`);
  }, (o, p) => [
    [has(o, "SKILLS_PROJECT", SK) && changed(o, p, "SKILLS_PROJECT"), `SKILLS_PROJECT 에 ${SK}`, "SKILLS_PROJECT"],
    [has(o, "LINKS_INVALID", `skill:${SK}:orchestrates`) && changed(o, p, "LINKS_INVALID"), `LINKS_INVALID 에 skill:${SK}:orchestrates`, "LINKS_INVALID"],
  ]);

  // ⑪ .agents 스킬
  step("⑪ .agents 스킬", () => {
    const d = path.join(proj, ".agents", "skills", SA); fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, "SKILL.md"), `---\nname: ${SA}\ndescription: selftest\n---\n`);
  }, (o, p) => [
    [has(o, "SKILLS_AGENTS", SA) && changed(o, p, "SKILLS_AGENTS"), `SKILLS_AGENTS 에 ${SA}`, "SKILLS_AGENTS"],
  ]);

  // ⑫ codex 에이전트(TOML)
  step("⑫ codex 에이전트", () => {
    const d = path.join(proj, ".codex", "agents"); fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, `${C}.toml`), `name = "${C}"\nmodel = "${M2}"\n`);
  }, (o, p) => [
    [has(o, "AGENTS_CODEX", C) && changed(o, p, "AGENTS_CODEX"), `AGENTS_CODEX 에 ${C}`, "AGENTS_CODEX"],
    [has(o, "MODEL", `codex:${C}=${M2}`) && changed(o, p, "MODEL"), `MODEL 에 codex:${C}=${M2}`, "MODEL"],
  ]);

  // ⑬ 전역 에이전트(⑥의 G)와 같은 이름의 프로젝트 에이전트 → 중복(두 경로)
  step("⑬ 이름 중복", () => {
    fs.mkdirSync(agentsDir, { recursive: true });
    fs.writeFileSync(path.join(agentsDir, `${G}.md`), `---\nname: ${G}\ndescription: selftest\n---\n`);
  }, (o, p) => {
    const v = line(o, "AGENTS_DUPLICATE");
    const t = v === null ? undefined : v.split(" ").find((x) => x.startsWith(`${G}=`));
    return [[t !== undefined && t.slice(G.length + 1).split("|").length === 2 && changed(o, p, "AGENTS_DUPLICATE"),
      `AGENTS_DUPLICATE 에 ${G}=<경로>|<경로>`, "AGENTS_DUPLICATE"]];
  });

  // ⑭ harness-profile.json(declared 1 · assumed AS)
  step("⑭ 프로필", () => {
    const d = path.join(proj, ".claude", "skills", PR); fs.mkdirSync(d, { recursive: true });
    const answers = { [rnd("q")]: { source: "declared" } };
    for (let i = 0; i < AS; i++) answers[rnd("q")] = { source: "assumed" };
    fs.writeFileSync(path.join(d, "harness-profile.json"), JSON.stringify({ answers }));
  }, (o, p) => {
    const want = `.claude/skills/${PR}/harness-profile.json declared=1 assumed=${AS} scanned=0`;
    const v = line(o, "PROFILE");
    return [[v !== null && v.split("; ").includes(want) && changed(o, p, "PROFILE"), `PROFILE 에 ${want}`, "PROFILE"]];
  });

  process.stdout.write(fail ? `SELFTEST: FAIL (${target})\n` : `SELFTEST: PASS (${target})\n`);
  return fail ? 1 : 0;
}
