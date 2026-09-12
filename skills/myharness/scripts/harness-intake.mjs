#!/usr/bin/env node
// harness-intake.mjs — 하네스 구성 인터뷰(v1.7.6 S1: `scan` · `selftest` / S2: `questions` · `answer` / S3: `render` · `verify`).
// 계약 단일 출처: scan = docs/v1.7.6/design/harness-interview-design.md §2(구현 명세 v176-S1 §2·§3 이 정정분) ·
//   questions·answer·프로파일·render·verify = skills/myharness/references/harness-interview.md(카탈로그·기본값·답 문법·검증표·`at` 규칙 · 8~10절 결선).
// 결정은 스크립트가, 추천과 질문은 모델이 — scan·questions·render·verify 는 관측만 하고, 파일을 쓰는 것은 answer(프로파일 1개 + prev) 뿐이다.
//
// 사용: node harness-intake.mjs <scan|questions|answer|render|verify|selftest> [--root <dir>] [--now <ISO>] …
//   scan              대상 루트(--root, 기본 cwd)의 에이전트·스킬·플러그인·신호·런타임을 15줄 계약으로 stdout 에
//   questions         --mode <new|extend|maintain|update> [--orchestrator <이름>] [--after irreversible=<토큰,…>] → 문항 JSON 배열
//   answer            --orchestrator <이름> (--set … | --from-env | --from-file <f>) [--defaults] [--recommended …] [--why …] [--mode new|extend]
//                     → <root>/.claude/skills/<이름>/harness-profile.json 원자적 쓰기 · stdout `PROFILE:`·`SOURCES:` 두 줄
//   selftest [대상]   selftest-harness-intake.mjs 로 얇게 위임(가드는 별도 파일 — 이 파일이 통째로 스텁으로 덮여도 살아남게)
//   render            --orchestrator <이름> [--block <id>] → 프로파일만 읽어 표식 블록 5개(또는 1개)를 stdout 에(파일 쓰지 않음 · --now 거부)
//   verify            --orchestrator <이름> → SKILL.md(블록 4종)·CLAUDE.md·AGENTS.md(premise) 대조 · stdout WIRED·DECLARED·ASSUMED 3줄
//   그 밖             rc=2 `모르는 서브커맨드` + 사용법(stderr)
// 종료코드: 0 정상 · 1 내용 검증 실패(scan·render 에는 없음 · verify 는 ok·na 아닌 판정) · 2 사용·환경 오류(프로파일 없음·손상 포함).
// 규약: stdout = 계약 줄만(`KEY: value`, `\n`). 사람용 진단은 stderr — check-review-tools.sh 는 진단도 stdout 이라 선례가 아니다.
// 결정성: 모든 목록은 코드포인트 오름차순(JS 기본 sort 는 UTF-16 코드유닛 순이라 BMP 밖에서 어긋난다) · readdir 결과도 정렬 후 사용.
// 의존성: node 내장 모듈만(팩토리 스킬은 자기완결 — harness-ui 에 기댈 수 없다). node ≥18 문법.
// RUNTIME 탐색은 `command -v` 와 **의도적으로 다르다**: PATH 의 비절대 항목(빈 항목·`.`·상대경로)은 전부 건너뛴다 —
//   scan 의 cwd 는 보통 하네스를 만들 **대상 프로젝트 루트**라, 그 안의 `./claude` 를 --version 으로 실행하면 대상 레포 코드를 실행하게 된다.
// 카탈로그 배제: ~/.claude/plugins/marketplaces(설치 안 된 카탈로그 클론)는 installPath·재귀·심링크 어느 경로로도 읽지 않는다(명세 §6-1).
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const WIN = process.platform === "win32";
const SELF = fileURLToPath(import.meta.url); // 심링크로 실행해도 실경로로 풀린다(명세 §0 실측)

// ───────────────────────── frontmatter 파서 — harness.ts 의미 이식 ─────────────────────────
// 원본: harness-ui/src/server/adapters/harness.ts  stripQuotes(:59-65) · canonName(:67-69) · parseFrontmatterList(:74-103)
//       · parseFrontmatter(:105-122) · splitList(:145-147). 정규식·분기 순서를 바꾸지 않는다 —
//       같은 규칙의 두 구현이 어긋나는 것이 이 레포의 지배적 실패 계열이라 공유 벡터(tests/fixtures/frontmatter-vectors.json)로 묶는다.
//       유일한 차이: parseFrontmatter 의 결과 객체를 프로토타입 없는 객체로 만든다(`__proto__:` 키가 프로토타입을 바꾸지 않게 — 일반 키 의미는 동일).

function stripQuotes(s) {
  const t = s.trim();
  if (t.length >= 2 && ((t[0] === '"' && t[t.length - 1] === '"') || (t[0] === "'" && t[t.length - 1] === "'"))) {
    return t.slice(1, -1);
  }
  return t;
}

// name canonical: 경로/확장자 제거·trim(파일명 basename 기준).
function canonName(s) {
  return s.trim().replace(/^["']|["']$/g, "").split(/[\\/]/).pop().replace(/\.(md|toml)$/i, "").trim();
}

// 나열 분해 공통 전처리: 대괄호·따옴표 제거 후 콤마/공백 split.
function splitList(raw) {
  return raw.replace(/[[\]"']/g, " ").split(/[,\s]+/);
}

// 배열 계약 파서. present = 키 존재(부재 vs 빈 배열 구분). YAML frontmatter(--- 블록)면 그 안에서, 아니면 TOML(전문)에서 탐색.
// 반환 { present, items, syntax }, syntax ∈ missing | empty | array | invalid_scalar.
export function parseFrontmatterList(textIn, key) {
  const text = textIn.replace(/^\uFEFF/, "");
  const fm = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const region = fm ? fm[1] : text; // YAML 블록 우선·없으면 TOML 전문
  const esc = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // 인라인/다중행 배열: key: [ ... ] 또는 key = [ ... ] (최초 ]까지 non-greedy). [ \t]* = 수평 공백만(개행 불식).
  const arr = region.match(new RegExp(`^[ \\t]*${esc}[ \\t]*[:=][ \\t]*\\[([\\s\\S]*?)\\]`, "m"));
  if (arr) {
    const items = [...new Set(splitList(arr[1]).map((s) => canonName(s)).filter(Boolean))]; // dedup
    return { present: true, items, syntax: items.length ? "array" : "empty" };
  }
  // key 라인(배열 아님). [ \t]*(개행 제외) — \s* 는 개행을 삼켜 블록리스트를 scalar 로 오판.
  const kl = region.match(new RegExp(`^([ \\t]*)${esc}[ \\t]*[:=][ \\t]*(.*)$`, "m"));
  if (!kl) return { present: false, items: [], syntax: "missing" };
  const rest = kl[2].trim();
  if (rest === "") {
    // YAML 블록 리스트: 다음 라인들의 `- item` 수집(들여쓰기 무관·비대시 라인에서 종료)
    const after = region.slice(kl.index + kl[0].length).split(/\r?\n/);
    const items = [];
    for (const line of after) {
      if (line.trim() === "") continue;
      const dm = line.match(/^\s*-\s*(.+)$/);
      if (dm) items.push(canonName(dm[1]));
      else break; // 리스트 종료
    }
    const uniq = [...new Set(items.filter(Boolean))]; // dedup
    return uniq.length ? { present: true, items: uniq, syntax: "array" } : { present: true, items: [], syntax: "empty" };
  }
  return { present: true, items: [], syntax: "invalid_scalar" }; // scalar 금지
}

// frontmatter 키 추출: --- 블록에서 key: value. 새 키 = 비들여쓰기 `key:` · 연속행 = 들여쓴 라인만 · 값은 따옴표 제거·trim.
function parseFrontmatter(textIn) {
  const text = textIn.replace(/^\uFEFF/, ""); // BOM 제거
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const out = Object.create(null);
  if (!m) return out;
  let key = null;
  const buf = [];
  const flush = () => { if (key) out[key] = stripQuotes(buf.join(" ").trim()); key = null; buf.length = 0; };
  for (const line of m[1].split(/\r?\n/)) {
    const isIndented = /^\s/.test(line);
    const kv = !isIndented ? line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/) : null;
    if (kv) { flush(); key = kv[1]; buf.push(kv[2]); }
    else if (key && isIndented && line.trim()) { buf.push(line.trim()); }
  }
  flush();
  return out;
}

// ───────────────────────── 공통 유틸 ─────────────────────────

// 코드포인트 오름차순(= UTF-8 바이트 순). 같은 코드포인트면 두 문자열이 같은 폭만큼 전진하므로 인덱스 하나로 충분하다.
function cpCompare(a, b) {
  let i = 0;
  while (i < a.length && i < b.length) {
    const x = a.codePointAt(i), y = b.codePointAt(i);
    if (x !== y) return x < y ? -1 : 1;
    i += x > 0xffff ? 2 : 1;
  }
  return a.length === b.length ? 0 : (a.length < b.length ? -1 : 1);
}

// 토큰 안 공백(공백·탭·개행 등 \s) 연속을 `_` 하나로 — 공백 구분 토큰 분리를 보장하기 위한 **손실 변환**
// (`a b` 와 `a_b` 는 출력에서 구분되지 않는다).
const tok = (s) => String(s).replace(/\s+/g, "_");

// 목록 줄 값: 정규화 → 중복 제거 → 코드포인트 정렬 → 공백 결합, 비었으면 none.
function listValue(arr) {
  const u = [...new Set(arr.map(tok).filter((t) => t !== ""))].sort(cpCompare);
  return u.length ? u.join(" ") : "none";
}

function diag(msg) { process.stderr.write(`harness-intake: ${msg}\n`); }

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

// UTF-8 · 선두 BOM 제거. \r\n 은 그대로 둔다(파서가 \r?\n 을 허용).
function readText(file) { return fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""); }

// 디렉토리 항목: 정렬된 이름 + statSync(심링크 따라감). 없는 디렉토리는 조용히 [] — 깨진 심링크·권한 오류는 건너뛰고 stderr.
// scan 한 번 안에서 같은 디렉토리를 여러 번 보므로 캐시(진단 중복 방지 겸).
const dirCache = new Map();
function listDir(dir) {
  if (dirCache.has(dir)) return dirCache.get(dir);
  let names = [];
  try { names = fs.readdirSync(dir); }
  catch (e) {
    if (e.code !== "ENOENT" && e.code !== "ENOTDIR") diag(`디렉토리 읽기 실패(건너뜀): ${dir} (${e.code || e.message})`);
    names = [];
  }
  names.sort(cpCompare);
  const out = [];
  for (const name of names) {
    const full = path.join(dir, name);
    try { out.push({ name, full, st: fs.statSync(full) }); }
    catch (e) { diag(`항목 건너뜀(깨진 심링크·권한): ${full} (${e.code || e.message})`); }
  }
  dirCache.set(dir, out);
  return out;
}

// 이름이 **정확히** 같은 항목(대소문자 무시 파일시스템에서도 `changelog.md` 를 `CHANGELOG.md` 로 세지 않게 readdir 로 확인).
function child(dir, name, kind /* "file" | "dir" */) {
  const e = listDir(dir).find((x) => x.name === name);
  if (!e) return null;
  if (kind === "file" ? e.st.isFile() : e.st.isDirectory()) return e.full;
  return null;
}

// 경로 표시: 프로젝트 안 = --root 기준 상대 · 홈 안 = `~/` · 그 밖 = 절대. 구분자는 항상 `/`.
function inside(base, abs) {
  const rel = path.relative(base, abs);
  if (rel === "" || rel === ".." || rel.startsWith(".." + path.sep) || path.isAbsolute(rel)) return null;
  return rel;
}
const slash = (p) => p.split(path.sep).join("/");
function display(ctx, abs) {
  const r = inside(ctx.root, abs);
  if (r !== null) return slash(r);
  const h = inside(ctx.home, abs);
  if (h !== null) return "~/" + slash(h);
  return slash(abs);
}

// 카탈로그 경계 판정용 실경로. native 를 먼저 쓴다 — JS realpathSync 는 대소문자 무시 파일시스템(macOS)에서 호출자가 준 대소문자를
// 그대로 돌려줘(실측: .../market/sub vs native .../Market/Sub) 경로 비교가 빗나간다. native 실패(windows 일부 드라이브 등)면 JS 로.
function realCanon(p) {
  try { return fs.realpathSync.native(p); } catch { /* 폴백 */ }
  try { return fs.realpathSync(p); } catch { return null; }
}
// base 와 같거나 그 아래인가 — path.relative 기반이라 구분자 경계를 지킨다(/x/marketplaces2 는 밖) · win32 는 대소문자·구분자 무시.
function within(base, abs) { return path.relative(base, abs) === "" || inside(base, abs) !== null; }

// *.ext 파일(1단계). 파일명이 확장자뿐인 것(`.md`)은 이름이 비므로 제외. 점 파일은 포함(harness.ts listFiles 선례 = endsWith).
function filesWithExt(dir, ext) {
  return listDir(dir)
    .filter((e) => e.st.isFile() && e.name.endsWith(ext) && e.name.length > ext.length)
    .map((e) => ({ name: e.name.slice(0, -ext.length), file: e.full }));
}

// ───────────────────────── 정의 분석(MODEL · LINKS_INVALID · UNKNOWN_FIELDS) ─────────────────────────

const AGENT_KEYS = new Set(["name", "description", "model", "skills", "behaviors", "tools", "color", "effort", "initialPrompt"]);
const SKILL_KEYS = new Set(["name", "description", "orchestrates"]);
const AGENT_LINKS = ["skills", "behaviors"];
const SKILL_LINKS = ["orchestrates"];

function analyzeMd(acc, id, file, kind /* "agent" | "skill" */) {
  let text;
  try { text = readText(file); }
  catch (e) { diag(`정의 읽기 실패 — MODEL·LINKS_INVALID·UNKNOWN_FIELDS 에서 빠짐: ${file} (${e.code || e.message})`); return; }
  const fm = parseFrontmatter(text);
  const base = kind === "agent" ? AGENT_KEYS : SKILL_KEYS;
  for (const k of Object.keys(fm)) if (!base.has(k)) acc.unknown.push(`${id}:${k}`);
  for (const k of kind === "agent" ? AGENT_LINKS : SKILL_LINKS) {
    if (parseFrontmatterList(text, k).syntax === "invalid_scalar") acc.links.push(`${id}:${k}`);
  }
  if (kind === "agent") {
    const v = own(fm, "model") ? (fm.model === "" ? "empty" : fm.model) : "none";
    acc.model.push(`${id}=${tok(v)}`);
  }
}

// .codex/agents/*.toml — name·model 두 키만(여기서 쓰는 것은 model). 첫 매치 · 양끝 따옴표 제거. UNKNOWN/LINKS 판정 없음.
function analyzeToml(acc, id, file) {
  let text;
  try { text = readText(file); }
  catch (e) { diag(`정의 읽기 실패 — MODEL 에서 빠짐: ${file} (${e.code || e.message})`); return; }
  const m = text.match(/^[ \t]*model[ \t]*=[ \t]*(.*)$/m);
  const v = m ? stripQuotes(m[1]) : null;
  acc.model.push(`${id}=${tok(v === null ? "none" : v === "" ? "empty" : v)}`);
}

// ───────────────────────── 플러그인(installed_plugins.json × settings 3계층) ─────────────────────────

function readJson(file, what) {
  let text;
  try { text = readText(file); }
  catch (e) { if (e.code !== "ENOENT") diag(`${what} 읽기 실패: ${file} (${e.code || e.message})`); return undefined; }
  try { return JSON.parse(text); }
  catch (e) { diag(`${what} JSON 오류(없는 것으로 봄): ${file} (${e.message})`); return undefined; }
}

function readEnabled(file) {
  const j = readJson(file, "settings");
  return isObj(j) && isObj(j.enabledPlugins) ? j.enabledPlugins : null;
}

// 키의 `@` 앞 = 플러그인 이름(Claude Code 노출형 `<플러그인>:<에이전트>`). `@` 가 여럿이면 마지막 `@` 기준(`@scope/x@mkt` 대비).
function pluginName(key) { const i = key.lastIndexOf("@"); return i > 0 ? key.slice(0, i) : key; }

// `**/agents/*.md` — 재귀, node_modules·.git 은 건너뜀, 심링크는 따라가되 같은 실경로 디렉토리는 한 번만(순환 방지).
// isCat: 실경로가 marketplaces 카탈로그 안인가 — 그런 디렉토리엔 들어가지 않고, 그리로 향한 에이전트 파일(심링크)도 뺀다(§6-1 ②③).
function walkPluginAgents(dir, seen, out, isCat) {
  let real;
  try { real = fs.realpathSync(dir); } catch (e) { diag(`플러그인 경로 건너뜀: ${dir} (${e.code || e.message})`); return; }
  if (seen.has(real)) return;
  seen.add(real);
  if (isCat(dir)) { diag(`플러그인 경로가 marketplaces 카탈로그 안 — 들어가지 않음: ${dir}`); return; }
  for (const e of listDir(dir)) {
    if (!e.st.isDirectory() || e.name === "node_modules" || e.name === ".git") continue;
    if (e.name === "agents") {
      for (const f of filesWithExt(e.full, ".md")) {
        if (isCat(f.file)) { diag(`에이전트 파일이 marketplaces 카탈로그 안 — 제외: ${f.file}`); continue; }
        out.push(f);
      }
    }
    walkPluginAgents(e.full, seen, out, isCat);
  }
}

function scanPlugins(ctx) {
  const res = { tokens: [], agents: [] }; // agents: { token, file }
  const file = path.join(ctx.home, ".claude", "plugins", "installed_plugins.json");
  // ⚠ ~/.claude/plugins/marketplaces/** 는 어떤 경우에도 읽지 않는다(설치 안 된 카탈로그 클론 — glob 하면 35개가 섞인다).
  //   glob 을 안 쓰는 것만으로는 부족하다 — installPath 가 그 안이거나 그리로 향한 심링크면 재귀가 카탈로그를 읽는다(R1 재현).
  //   그래서 실경로 기준으로 installPath·재귀 디렉토리·에이전트 파일 세 곳에서 막는다. marketplaces 가 없으면 검사 생략.
  const catalog = realCanon(path.join(ctx.home, ".claude", "plugins", "marketplaces"));
  const isCat = (p) => { if (catalog === null) return false; const r = realCanon(p); return r !== null && within(catalog, r); };
  const j = readJson(file, "installed_plugins.json");
  if (j === undefined) return res;
  if (!isObj(j) || !isObj(j.plugins)) { diag(`installed_plugins.json 에 plugins 객체 없음: ${file}`); return res; }
  let rootReal = null;
  // §6-4: projectPath·--root 비교는 양쪽 모두 native 실경로(realCanon) — JS realpath 는 macOS 에서 입력 대소문자를 그대로 돌려줘
  //   대소문자만 다른 같은 디렉토리를 "비적용" 으로 봤다. 대소문자 구분 파일시스템에서는 동작 불변.
  rootReal = realCanon(ctx.root);
  // 우선순위 local > project > user(S0 M2 실측). 최상위 installed_plugins.json.enabledPlugins 는 의미 미확인이라 쓰지 않는다.
  const layers = [
    ["local", readEnabled(path.join(ctx.root, ".claude", "settings.local.json"))],
    ["project", readEnabled(path.join(ctx.root, ".claude", "settings.json"))],
    ["user", readEnabled(path.join(ctx.home, ".claude", "settings.json"))],
  ];
  for (const key of Object.keys(j.plugins).sort(cpCompare)) {
    const raw = j.plugins[key];
    const items = Array.isArray(raw) ? raw : isObj(raw) ? [raw] : null; // 객체 하나인 옛 형식 = [객체]
    if (!items) { diag(`플러그인 ${key}: 설치 항목 형식 불명(건너뜀)`); continue; }
    const installs = new Set();
    for (const it of items) {
      if (!isObj(it)) { diag(`플러그인 ${key}: 객체 아닌 설치 항목(건너뜀)`); continue; }
      let applies = false;
      if (it.projectPath !== undefined && it.projectPath !== null) {
        // projectPath 가 있으면 scope 와 무관하게 이 프로젝트일 때만 적용. 없는 경로면 비적용(다른 프로젝트 설치는 정상이라 진단 없음).
        if (typeof it.projectPath === "string" && rootReal !== null) {
          const pr = realCanon(it.projectPath);
          applies = pr !== null && pr === rootReal;
        }
      } else if (it.scope === "user") {
        applies = true;
      } else {
        diag(`플러그인 ${key}: 적용 판정 불가(scope=${JSON.stringify(it.scope)}, projectPath 없음) — 비적용`);
      }
      if (!applies) continue;
      if (typeof it.installPath !== "string" || !path.isAbsolute(it.installPath)) {
        diag(`플러그인 ${key}: installPath 가 절대경로 문자열이 아님(건너뜀)`);
        continue;
      }
      if (isCat(it.installPath)) {
        // 적용 설치에서 뺀다 — 이 키에 다른 적용 설치가 없으면 PLUGINS 에서도 빠진다(설치 안 됨과 같음).
        diag(`플러그인 ${key}: installPath 가 marketplaces 카탈로그 안 — 제외: ${it.installPath}`);
        continue;
      }
      installs.add(path.resolve(it.installPath));
    }
    if (installs.size === 0) continue; // 이 프로젝트에 설치 안 됨과 같다 → 출력에서 뺀다
    let on = false, src = "none";
    for (const [name, ep] of layers) {
      if (ep && own(ep, key) && typeof ep[key] === "boolean") { on = ep[key] === true; src = name; break; }
    }
    res.tokens.push(`${key}=${on ? "on" : "off"},enabled_source=${src}`);
    if (!on) continue;
    const pname = pluginName(key);
    const seen = new Set();
    for (const ip of [...installs].sort(cpCompare)) {
      const found = [];
      walkPluginAgents(ip, seen, found, isCat);
      for (const f of found) res.agents.push({ token: `${pname}:${f.name}`, file: f.file });
    }
  }
  return res;
}

// ───────────────────────── RUNTIME ─────────────────────────

// PATH 를 node 로 직접 순회(`sh -c "command -v"` 금지 — windows 에 sh 보장 없음).
// `command -v` 와 의도적으로 다름: 절대경로가 아닌 PATH 항목(빈 항목 = POSIX 의 현재 디렉토리 · `.` · `bin` 같은 상대경로)은
// 전부 건너뛴다. cwd 는 보통 대상 프로젝트 루트이고, 그 안의 바이너리를 --version 으로 실행하지 않는다(대상 레포 코드 실행 방지).
// 예전엔 빈 항목만 버리고 `.` 은 따라가 내부 불일치였다(R1).
function findTool(tool) {
  const dirs = (process.env.PATH || "").split(path.delimiter).filter((d) => path.isAbsolute(d));
  const exts = WIN ? (process.env.PATHEXT || ".COM;.EXE;.BAT;.CMD").split(";").filter((x) => x !== "") : null;
  for (const dir of dirs) {
    if (WIN) {
      // 확장자 없는 후보는 건너뛴다 — windows 의 X_OK 는 존재만 봐서 가짜 bin 쌍의 sh 스크립트를 집고 execFile 이 실패한다.
      for (const ext of exts) {
        const p = path.join(dir, tool + ext);
        try { if (fs.statSync(p).isFile()) return p; } catch { /* 다음 후보 */ }
      }
    } else {
      const p = path.join(dir, tool);
      try { if (fs.statSync(p).isFile()) { fs.accessSync(p, fs.constants.X_OK); return p; } } catch { /* 다음 디렉토리 */ }
    }
  }
  return null;
}

// 마감 시 자식 정리. windows 는 taskkill /T /F 로 트리째(cmd.exe 아래 손자가 파이프를 쥐고 남는 경우) — 먼저 child.kill 하면
// 부모가 사라져 /T 가 트리를 못 찾으므로 taskkill 만 쓴다. unix 는 프로세스 그룹 SIGKILL(`sh` → `sleep` 손자까지 — 직계만 죽이면
// 손자가 고아로 남는다, 실측). 스트림 destroy + unref 는 어느 쪽이든 이 프로세스의 종료를 붙잡지 않게 하는 이중 안전장치.
function killChild(child) {
  if (!child) return;
  for (const s of [child.stdout, child.stderr, child.stdin]) { try { s && s.destroy(); } catch { /* 무시 */ } }
  if (WIN) {
    if (child.pid) {
      try {
        const tk = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "taskkill.exe");
        const k = spawn(tk, ["/T", "/F", "/PID", String(child.pid)], { stdio: "ignore", windowsHide: true });
        k.on("error", () => {});
        k.unref();
      } catch { /* 무시 */ }
    }
  } else {
    // 자식은 detached(프로세스 그룹 리더)로 띄웠다 → 음수 pid 로 그룹 전체(sh → sleep 손자 포함) SIGKILL. 실패 시 직계만.
    let grouped = false;
    if (child.pid) { try { process.kill(-child.pid, "SIGKILL"); grouped = true; } catch { grouped = false; } }
    if (!grouped) { try { child.kill("SIGKILL"); } catch { /* 무시 */ } }
  }
  try { child.unref(); } catch { /* 무시 */ }
}

const DEADLINE_MS = 5000;
const MAX_OUT = 1024 * 1024; // --version stdout 상한(execFile maxBuffer 기본값과 같은 1MiB). 넘으면 unknown.
const VERSION_RE = {
  claude: /^(\S+) \(Claude Code\)$/,
  codex: /^codex-cli (\S+)$/,
  agy: /^(\d+\.\d+\.\d+\S*)$/,
};

// `<tool> --version` → 버전 | unknown. 자체 5000ms 마감(timeout 옵션에 기대지 않는다 — 손자가 파이프를 쥐면 close 가 늦는다).
function probeVersion(file, re) {
  return new Promise((resolve) => {
    let done = false;
    let child = null;
    let timer = null;
    const finish = (v) => { if (done) return; done = true; if (timer) clearTimeout(timer); resolve(v); };
    let cmd = file, args = ["--version"];
    const opts = { windowsHide: true };
    if (WIN && /\.(cmd|bat)$/i.test(file)) {
      // Node ≥20.12.2 는 shell 없는 .cmd spawn 에 EINVAL(CVE-2024-27980). ComSpec 에 verbatim 으로 넘긴다.
      cmd = process.env.ComSpec || "cmd.exe";
      args = ["/d", "/s", "/c", "\"\"" + file + "\" --version\""];
      opts.windowsVerbatimArguments = true;
    }
    // unix 만: 새 프로세스 그룹의 리더로 띄워 마감 시 손자까지 그룹 kill 한다. windows 는 detached 금지(새 콘솔이 뜬다) — taskkill /T.
    if (!WIN) opts.detached = true;
    timer = setTimeout(() => { finish("unknown"); killChild(child); }, DEADLINE_MS);
    try {
      // execFile 이 아니라 spawn — execFile 은 옵션을 화이트리스트로만 spawn 에 넘겨 `detached` 를 버린다
      // (node 20.17·24.18 실측: execFile+detached 자식의 pgid = 부모 pgid → 그룹 kill 이 ESRCH 로 빗나가 손자가 남았다).
      child = spawn(cmd, args, opts);
    } catch (e) {
      diag(`--version 실행 실패: ${file} (${e.code || e.message})`);
      return finish("unknown");
    }
    const chunks = [];
    let size = 0;
    child.stdout.on("data", (d) => {
      size += d.length;
      if (size > MAX_OUT) { finish("unknown"); killChild(child); return; }
      chunks.push(d);
    });
    child.stderr.on("data", () => {}); // 비워 준다 — 안 읽으면 stderr 파이프가 차서 자식이 멈춘다
    child.on("error", () => finish("unknown")); // 실행 실패(ENOENT·EACCES 등)
    child.on("close", (code) => {
      if (code !== 0) return finish("unknown"); // rc≠0 · 시그널 종료(code=null)
      const first = Buffer.concat(chunks).toString("utf8").split("\n").map((s) => s.replace(/\r/g, "")).find((s) => s.trim() !== "");
      const m = first === undefined ? null : first.match(re);
      finish(m ? m[1] : "unknown");
    });
  });
}

// [도구, 값] 3쌍(값은 tok 정규화). scan 의 RUNTIME 줄과 answer 의 프로파일 scan.runtime 이 같은 값을 쓴다.
async function runtimeValues() {
  const tools = ["claude", "codex", "agy"];
  const vals = await Promise.all(tools.map((t) => {
    const f = findTool(t);
    return f === null ? Promise.resolve("absent") : probeVersion(f, VERSION_RE[t]);
  }));
  return tools.map((t, i) => [t, tok(vals[i])]);
}

async function scanRuntime() {
  return (await runtimeValues()).map(([t, v]) => `${t}=${v}`).join(" ");
}

// ───────────────────────── SIGNALS · PROFILE ─────────────────────────

function readPkg(file) {
  const j = readJson(file, "package.json");
  if (j === undefined) return null;
  if (!isObj(j)) { diag(`package.json 이 객체가 아님(건너뜀): ${file}`); return null; }
  return j;
}

function scanSignals(ctx) {
  const root = ctx.root;
  const sig = [];
  // 워크플로: *.yml · *.yaml 일반 파일(GitHub 는 두 확장자 모두 읽는다).
  const gh = child(root, ".github", "dir");
  const wfDir = gh && child(gh, "workflows", "dir");
  const workflows = wfDir
    ? listDir(wfDir).filter((e) => e.st.isFile() && /\.ya?ml$/.test(e.name)).map((e) => e.full)
    : [];
  if (workflows.length) sig.push("ci");
  // package.json 후보: 루트 + 루트 직속 디렉토리 전부(점 디렉토리 포함, node_modules 만 제외).
  const pkgDirs = [root, ...listDir(root).filter((e) => e.st.isDirectory() && e.name !== "node_modules").map((e) => e.full)];
  const pkgs = [];
  for (const d of pkgDirs) { const f = child(d, "package.json", "file"); if (f) { const p = readPkg(f); if (p) pkgs.push(p); } }
  const hasTestScript = pkgs.some((p) => isObj(p.scripts) && typeof p.scripts.test === "string");
  if (hasTestScript || child(root, "tests", "dir") || child(root, "test", "dir")) sig.push("tests");
  if (child(root, "CHANGELOG.md", "file")) sig.push("changelog");
  const cp = child(root, ".claude-plugin", "dir");
  if (cp && (child(cp, "marketplace.json", "file") || child(cp, "plugin.json", "file"))) sig.push("plugin-manifest");
  if (pkgs.some((p) => p.private !== true && typeof p.name === "string" && p.name !== "")) sig.push("publishable");
  const needles = ["gh release", "action-gh-release", "npm publish", "git tag"];
  const release = workflows.some((f) => {
    try { const t = readText(f); return needles.some((n) => t.includes(n)); }
    catch (e) { diag(`워크플로 읽기 실패: ${f} (${e.code || e.message})`); return false; }
  });
  if (release) sig.push("release-cmd");
  const prisma = child(root, "prisma", "dir");
  const db = child(root, "db", "dir");
  if (child(root, "migrations", "dir") || (prisma && child(prisma, "migrations", "dir")) || (db && child(db, "migrate", "dir"))) sig.push("migrations");
  return sig;
}

// .claude/skills/*/harness-profile.json 전부. answers.<항목>.source 값별 개수(0 도 적는다) · 파싱 불가·answers 없음 = unreadable.
function scanProfile(ctx) {
  const skillsDir = path.join(ctx.root, ".claude", "skills");
  const entries = [];
  for (const e of listDir(skillsDir)) {
    if (!e.st.isDirectory()) continue;
    const f = child(e.full, "harness-profile.json", "file");
    if (!f) continue;
    const shown = tok(display(ctx, f));
    const j = readJson(f, "harness-profile.json");
    if (!isObj(j) || !isObj(j.answers)) { entries.push({ shown, text: `${shown} unreadable` }); continue; }
    const n = { declared: 0, assumed: 0, scanned: 0 };
    for (const v of Object.values(j.answers)) if (isObj(v) && typeof v.source === "string" && own(n, v.source)) n[v.source]++;
    entries.push({ shown, text: `${shown} declared=${n.declared} assumed=${n.assumed} scanned=${n.scanned}` });
  }
  if (!entries.length) return "absent";
  return entries.sort((a, b) => cpCompare(a.shown, b.shown)).map((x) => x.text).join("; ");
}

// ───────────────────────── scan ─────────────────────────

// 스킬 — <d>/SKILL.md 가 있는 디렉토리(심링크 따라감). scan 과 questions·answer(⑤ 수·scanned)가 같은 판정을 쓴다.
function skillDirs(base) {
  return listDir(base).filter((e) => e.st.isDirectory()).map((e) => ({ name: e.name, md: child(e.full, "SKILL.md", "file") })).filter((x) => x.md);
}

async function scan(ctx) {
  const runtimeP = scanRuntime(); // 파일 스캔과 병렬
  const acc = { model: [], links: [], unknown: [] };
  const dupPaths = new Map(); // 이름/토큰 → Set(표시 경로)
  const addPath = (name, file) => { if (!dupPaths.has(name)) dupPaths.set(name, new Set()); dupPaths.get(name).add(display(ctx, file)); };

  // 에이전트 — 이름은 파일명 기준(frontmatter name 없는 정의가 실재: ~/.claude/agents/smoke-agent.md).
  const proj = filesWithExt(path.join(ctx.root, ".claude", "agents"), ".md");
  const glob = filesWithExt(path.join(ctx.home, ".claude", "agents"), ".md");
  for (const a of proj) analyzeMd(acc, a.name, a.file, "agent");
  for (const a of glob) analyzeMd(acc, `user:${a.name}`, a.file, "agent");
  const globNames = new Set(glob.map((a) => a.name));
  for (const a of proj) if (globNames.has(a.name)) addPath(a.name, a.file);
  for (const a of glob) if (dupPaths.has(a.name)) addPath(a.name, a.file);

  const plugins = scanPlugins(ctx);
  const pluginPaths = new Map();
  for (const a of plugins.agents) {
    analyzeMd(acc, a.token, a.file, "agent");
    if (!pluginPaths.has(a.token)) pluginPaths.set(a.token, new Set());
    pluginPaths.get(a.token).add(display(ctx, a.file));
  }
  for (const [t, ps] of pluginPaths) if (ps.size >= 2) for (const p of ps) { if (!dupPaths.has(t)) dupPaths.set(t, new Set()); dupPaths.get(t).add(p); }

  const codex = filesWithExt(path.join(ctx.root, ".codex", "agents"), ".toml");
  for (const a of codex) analyzeToml(acc, `codex:${a.name}`, a.file);

  const sp = skillDirs(path.join(ctx.root, ".claude", "skills"));
  const sa = skillDirs(path.join(ctx.root, ".agents", "skills"));
  for (const s of sp) analyzeMd(acc, `skill:${s.name}`, s.md, "skill");
  for (const s of sa) analyzeMd(acc, `agents-skill:${s.name}`, s.md, "skill");

  const dup = [];
  for (const [name, ps] of dupPaths) dup.push(`${name}=${[...ps].map(tok).sort(cpCompare).join("|")}`);

  const lines = [
    ["RUNTIME", await runtimeP],
    ["AGENTS_PROJECT", listValue(proj.map((a) => a.name))],
    ["AGENTS_GLOBAL", listValue(glob.map((a) => a.name))],
    ["PLUGINS", listValue(plugins.tokens)],
    ["AGENTS_PLUGIN", listValue(plugins.agents.map((a) => a.token))],
    ["AGENTS_CODEX", listValue(codex.map((a) => a.name))],
    ["AGENTS_BUILTIN", "claude=unknown codex=default,worker,explorer(doc)"],
    ["AGENTS_DUPLICATE", listValue(dup)],
    ["SKILLS_PROJECT", listValue(sp.map((s) => s.name))],
    ["SKILLS_AGENTS", listValue(sa.map((s) => s.name))],
    ["MODEL", listValue(acc.model)],
    ["LINKS_INVALID", listValue(acc.links)],
    ["UNKNOWN_FIELDS", listValue(acc.unknown)],
    ["SIGNALS", listValue(scanSignals(ctx))],
    ["PROFILE", scanProfile(ctx)],
  ];
  return lines.map(([k, v]) => `${k}: ${v}\n`).join("");
}

// ═════════════════════════ S2 — questions · answer · 프로파일 ═════════════════════════
// 계약 단일 출처: skills/myharness/references/harness-interview.md(이하 "참조 문서"). 절 번호는 그 문서 기준.

function deepFreeze(o) {
  if (o !== null && typeof o === "object") { Object.freeze(o); for (const v of Object.values(o)) deepFreeze(v); }
  return o;
}

// 참조 문서 2절 ```json harness-interview-catalog 블록과 **deepEqual** 이어야 한다(테스트가 문서 블록을 파싱해 비교).
// 이 상수를 고치면 문서 블록과 catalog_version 을 함께 고친다 — 같은 규칙의 두 구현이 조용히 갈라지지 않게.
export const CATALOG = deepFreeze({
  catalog_version: 1,
  items: [
    {
      id: "completion", no: "①", header: "완료 기준", select: "multi",
      prompt: "무엇이 되면 이 하네스의 작업이 끝났다고 보나?",
      options: [
        { key: "tests-pass", label: "테스트 게이트 통과", expose: [["tests"]], machine: true },
        { key: "ci-green", label: "CI green", expose: [["ci"]], machine: true },
        { key: "artifacts-present", label: "산출물 경로 존재", expose: [], machine: true },
        { key: "human-signoff", label: "사람의 최종 확인", expose: [], machine: false },
      ],
      default_why: "안전한 쪽: 기계로 검증되는 기준 전부 — 사람 확인을 기본에 넣으면 비대화 경로가 끝나지 않는다",
    },
    {
      id: "irreversible", no: "②", header: "비가역", select: "multi",
      prompt: "이 작업에서 되돌릴 수 없는 것은?",
      options: [
        { key: "release-publish", label: "릴리스·태그 발행", expose: [["release-cmd"], ["changelog", "plugin-manifest"]], signal_based: true },
        { key: "package-publish", label: "패키지 레지스트리 배포(npm publish 등)", expose: [["publishable"]], signal_based: true },
        { key: "db-migration", label: "DB 마이그레이션 적용", expose: [["migrations"]], signal_based: true },
        { key: "force-push", label: "보호 브랜치 강제 push", expose: [], signal_based: false },
        { key: "external-send", label: "외부 발송(메일·메시지·웹훅)", expose: [], signal_based: false },
        { key: "unknown", label: "모름 — 비가역으로 취급", expose: [], signal_based: false },
        { key: "none", label: "없음 — 전부 되돌릴 수 있다", expose: [], signal_based: false, exclusive: true },
      ],
      default_why: "안전한 쪽: 비가역을 모르면 있다고 본다(→ 중대)",
    },
    {
      id: "cost", no: "③", header: "실패 비용", select: "single",
      prompt: "실패했을 때 무엇이 더 아픈가?",
      options: [
        { key: "error-worse", label: "오류가 더 아프다 — 늦더라도 정확하게", expose: [] },
        { key: "delay-worse", label: "지연이 더 아프다 — 빨리 내고 고친다", expose: [] },
        { key: "balanced", label: "둘 다 비슷하다", expose: [] },
      ],
      default_why: "안전한 쪽: 오류를 더 아프게 본다 — 게이트를 약하게 둔 채 틀리는 것보다 느리게 맞는 쪽",
    },
    {
      id: "approval", no: "④", header: "승인 지점", select: "multi",
      prompt: "사람이 반드시 확인해야 하는 지점은?",
      before_label: "「{label}」 직전 승인",
      options: [
        { key: "ladder", label: "중대 단계 승인 사다리(PRD→계획서→실행)", expose: [] },
        { key: "autonomous", label: "자율 노브 허용(_workspace/.autonomous)", expose: [] },
      ],
      default_why: "안전한 쪽: 비가역 직전마다 사람이 보고, 중대 단계는 사다리를 탄다 — 자율 노브는 기본에서 뺀다",
    },
    {
      id: "assets", no: "⑤", header: "기존 자산", select: "single",
      prompt: "이미 있는 에이전트·스킬을 어떻게 다룰까?",
      options: [
        { key: "reuse", label: "재사용 우선 — 에이전트 {agents}·스킬 {skills}", expose: [] },
        { key: "reference-only", label: "참고만 — 새로 만든다", expose: [] },
        { key: "ignore", label: "무시 — 기존 정의를 보지 않는다", expose: [] },
      ],
      default_why: "안전한 쪽: 재사용을 먼저 검토한다 — 역할이 겹치는 정의가 다른 이름으로 누적되는 것을 막는다",
    },
  ],
});

const ITEM_IDS = CATALOG.items.map((i) => i.id); // 카탈로그 순서 = SOURCES·answers 순서
const ITEM = Object.fromEntries(CATALOG.items.map((i) => [i.id, i]));
const OTHER_BEFORE_LABEL = "그 외 비가역"; // before:other 라벨의 {label}(참조 문서 4절)
const PROFILE_SCHEMA = "harness-profile/1";
const ORCH_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

// 내용·사용 오류를 한 곳에서 종료코드로 바꾼다. usage=true 면 USAGE 를 덧붙인다(인자 형식 오류).
class IntakeError extends Error {
  constructor(rc, msg, usage = false) { super(msg); this.rc = rc; this.usage = usage; }
}
const fail2 = (m) => { throw new IntakeError(2, m); };
const fail1 = (m) => { throw new IntakeError(1, m); };
const failUsage = (m) => { throw new IntakeError(2, m, true); };

// 앞뒤 ASCII 공백만 제거(참조 문서 6절 "앞뒤 공백 무시"). NBSP·전각 공백 같은 유니코드 공백은 **남긴다** —
// "유니코드 변형은 그대로 비교(정규화하지 않는다)" 와 같은 방향: 보이지 않는 변형을 조용히 같은 키로 만들지 않는다.
const trimWs = (s) => s.replace(/^[ \t\r\n\f\v]+|[ \t\r\n\f\v]+$/g, "");

// 비교 전용 정규 직렬화(키 코드포인트 정렬). 참조 문서 8절 정규 JSON 과 같은 규칙이지만 S2 는 **동등 비교에만** 쓴다(해시는 S3).
function canon(v) {
  if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]";
  if (isObj(v)) return "{" + Object.keys(v).sort(cpCompare).map((k) => JSON.stringify(k) + ":" + canon(v[k])).join(",") + "}";
  return JSON.stringify(v === undefined ? null : v);
}

const uniqSorted = (arr) => [...new Set(arr)].sort(cpCompare);

// `--now` → Date. 없으면 현재 시각. Date 로 못 읽으면 rc=2. 저장 형식 YYYY-MM-DDTHH:MM:SSZ(UTC · 초 단위).
function parseNow(v) {
  const d = v === undefined ? new Date() : new Date(v);
  if (Number.isNaN(d.getTime())) failUsage(`--now 를 시각으로 읽을 수 없다: ${v}`);
  const s = d.toISOString().slice(0, 19) + "Z";
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(s)) failUsage(`--now 가 4자리 연도 범위를 벗어난다: ${v}`);
  return s;
}

// 내부 재스캔(명세 §2-2) — 입력으로 스캔을 받지 않는다(위변조 경로 없음). RUNTIME 은 여기서 부르지 않는다.
// ⑤ 수·scanned = scan 의 AGENTS_PROJECT·SKILLS_PROJECT 와 같은 판정(filesWithExt·skillDirs). 이름은 원문(tok 변환 없음) · 코드포인트 정렬.
function scanForIntake(ctx) {
  return {
    sig: new Set(scanSignals(ctx)),
    agents: uniqSorted(filesWithExt(path.join(ctx.root, ".claude", "agents"), ".md").map((a) => a.name)),
    skills: uniqSorted(skillDirs(path.join(ctx.root, ".claude", "skills")).map((s) => s.name)),
  };
}

// 노출 판정(참조 문서 2절): expose = OR 목록, 원소 = AND. [] = 항상(signal null). signal = 첫 번째 참인 조건을 `+` 로.
function exposeOf(opt, sig) {
  if (opt.expose.length === 0) return { on: true, signal: null };
  for (const cond of opt.expose) if (cond.every((k) => sig.has(k))) return { on: true, signal: cond.join("+") };
  return { on: false, signal: null };
}

// ④ 의 before:* 정렬 순위: ② 카탈로그 순서(none 제외) → before:other → ladder → autonomous.
const APPROVAL_ORDER = [
  ...ITEM.irreversible.options.filter((o) => o.key !== "none").map((o) => `before:${o.key}`),
  "before:other",
  ...ITEM.approval.options.map((o) => o.key),
];

// 도출된 선택지(내부형 — 카탈로그 필드 유지). irr = ② 답 { value: [키…], other: 문장|null } — ④ 에서만 쓴다.
function deriveOptions(item, sc, irr) {
  if (item.id === "approval") {
    const out = [];
    for (const o of ITEM.irreversible.options) {
      if (o.key !== "none" && irr.value.includes(o.key)) {
        out.push({ key: `before:${o.key}`, label: item.before_label.replace("{label}", () => o.label), signal: null });
      }
    }
    if (irr.other !== null) out.push({ key: "before:other", label: item.before_label.replace("{label}", () => OTHER_BEFORE_LABEL), signal: null });
    for (const o of item.options) out.push({ ...o, signal: null });
    return out;
  }
  const out = [];
  for (const o of item.options) {
    const e = exposeOf(o, sc.sig);
    if (!e.on) continue;
    let label = o.label;
    if (item.id === "assets" && o.key === "reuse") {
      label = label.replace("{agents}", () => String(sc.agents.length)).replace("{skills}", () => String(sc.skills.length));
    }
    out.push({ ...o, label, signal: e.signal });
  }
  return out;
}

// 기본값 — 참조 문서 3절 표("안전한 쪽"). opts = deriveOptions 결과(노출된 것만).
function defaultOf(item, opts) {
  switch (item.id) {
    case "completion": return opts.filter((o) => o.machine === true).map((o) => o.key);
    case "irreversible": return opts.filter((o) => o.signal_based === true || o.key === "unknown").map((o) => o.key);
    case "cost": return ["error-worse"];
    case "approval": return [...opts.filter((o) => o.key.startsWith("before:")).map((o) => o.key), "ladder"]; // ② 가 none 이어도 ladder
    case "assets": return ["reuse"];
    default: return [];
  }
}

// 쪽 수(참조 문서 4절): n>4 면 ⌈n/4⌉ — 쪽 크기(균등·앞쪽부터 1개씩 더함)는 렌더러가 같은 규칙으로 나눈다.
const pagesOf = (n) => (n > 4 ? Math.ceil(n / 4) : 1);

// 문항 객체(키 순서 고정: 명세 §2-3).
function buildQuestion(item, sc, irr) {
  const opts = deriveOptions(item, sc, irr);
  const def = defaultOf(item, opts);
  const rest = opts.filter((o) => o.key !== "none");
  let confirm = rest.length === 1 && def.length === 1 && def[0] === rest[0].key;
  if (item.id === "assets" && sc.agents.length === 0 && sc.skills.length === 0) confirm = true; // 재사용할 것이 없다
  return {
    id: item.id, no: item.no, header: item.header, prompt: item.prompt, select: item.select,
    options: opts.map((o) => (o.exclusive === true ? { key: o.key, label: o.label, signal: o.signal, exclusive: true } : { key: o.key, label: o.label, signal: o.signal })),
    default: def, default_why: item.default_why, recommended: [], confirm_only: confirm, other: true,
    pages: pagesOf(opts.length), carried: false,
  };
}

// ── 답 문법(참조 문서 6절): 항목=토큰[,토큰…][;항목=…] · 토큰 = 선택지 키 | other:<문장> ──
// 판정 순서 ③ 문법 — `=` 없는 조각·빈 값·빈 토큰·숫자 토큰·같은 항목 두 번·같은 토큰 두 번은 모두 rc=2.
// other:<문장> 은 문장이 달라도 **한 항목에 하나** — 프로파일 other 필드가 문장 1개라 둘째를 담을 곳이 없다(담지 못하면 조용한 누락).
const CTRL_RE = /[\x00-\x08\x0a-\x1f\x7f]/; // 탭(\x09) 외 C0 + DEL
function parseGrammar(text, acc, what) {
  for (const raw of text.split(";")) {
    const piece = trimWs(raw);
    const eq = piece.indexOf("=");
    if (eq < 0) fail2(`${what}: '=' 없는 조각: ${JSON.stringify(raw)}`);
    const id = trimWs(piece.slice(0, eq));
    const val = trimWs(piece.slice(eq + 1));
    if (val === "") fail2(`${what}: 빈 값: ${JSON.stringify(id)}=`);
    if (acc.has(id)) fail2(`${what}: 같은 항목 두 번: ${JSON.stringify(id)}`);
    const rawToks = raw.slice(raw.indexOf("=") + 1).split(","); // trim 전 원문 — other 문장의 제어 문자 검사용
    const toks = rawToks.map(trimWs);
    const seen = new Set();
    for (const [ti, t] of toks.entries()) {
      if (t === "") fail2(`${what}: 빈 토큰: ${JSON.stringify(id)}=${JSON.stringify(val)}`);
      if (/^[0-9]+$/.test(t)) fail2(`${what}: 숫자만인 토큰(위치 번호는 받지 않는다 — 안정 키로): ${JSON.stringify(id)}=${t}`);
      const isOther = t.startsWith("other:");
      if (isOther && trimWs(t.slice(6)) === "") fail2(`${what}: other: 뒤 문장이 비었다: ${JSON.stringify(id)}`);
      // 참조 문서 6절(S3 결정): 블록은 줄 단위 — 개행은 줄 구조를 깨고 CR 은 verify 의 CRLF 정규화로 영구 drift. 탭만 허용.
      if (isOther && CTRL_RE.test(rawToks[ti].slice(rawToks[ti].indexOf("other:") + 6))) fail2(`${what}: other: 문장에 제어 문자(개행·CR·탭 외 C0·DEL): ${JSON.stringify(id)}`);
      const ident = isOther ? "other:" : t;
      if (seen.has(ident)) fail2(`${what}: 한 항목 안 같은 토큰 두 번: ${JSON.stringify(id)}=${isOther ? "other:…" : t}`);
      seen.add(ident);
    }
    acc.set(id, toks);
  }
}

// --why 항목=<문장>(문장 = 첫 `=` 뒤 전부 · 앞뒤 공백 제거). ③ 문법 단계.
function parseWhy(list) {
  const out = new Map();
  for (const raw of list) {
    const eq = raw.indexOf("=");
    if (eq < 0) fail2(`--why: '=' 없음: ${JSON.stringify(raw)}`);
    const id = trimWs(raw.slice(0, eq));
    const text = trimWs(raw.slice(eq + 1));
    if (text === "") fail2(`--why: 빈 문장: ${JSON.stringify(id)}=`);
    if (out.has(id)) fail2(`--why: 같은 항목 두 번: ${JSON.stringify(id)}`);
    out.set(id, text);
  }
  return out;
}

// ④ 판정 순서 ④ 존재·노출 — 모르는 항목·모르는 키·이번 스캔에서 미노출 키는 rc=2.
// ④ approval: ladder·autonomous · before:other · before:<② 키>(none 제외 · 이번 스캔에서 노출된 것) 만 존재한다.
//   ② 답에 없는 키를 가리키는지는 ⑤ 의미 단계(rc=1)가 본다.
function resolveItem(id, toks, sc, what) {
  if (!own(ITEM, id)) fail2(`${what}: 모르는 항목 키: ${JSON.stringify(id)}`);
  const item = ITEM[id];
  const keys = [];
  let other = null;
  for (const t of toks) {
    if (t.startsWith("other:")) { other = trimWs(t.slice(6)); continue; }
    if (id === "approval" && t.startsWith("before:")) {
      const x = t.slice(7);
      if (x === "other") { keys.push(t); continue; }
      const o = ITEM.irreversible.options.find((p) => p.key === x);
      if (!o || x === "none") fail2(`${what}: 모르는 선택지 키: approval=${t}`);
      if (!exposeOf(o, sc.sig).on) fail2(`${what}: 이번 스캔에서 노출되지 않은 선택지 키: approval=${t}`);
      keys.push(t);
      continue;
    }
    const o = item.options.find((p) => p.key === t);
    if (!o) fail2(`${what}: 모르는 선택지 키: ${id}=${t}`);
    if (!exposeOf(o, sc.sig).on) fail2(`${what}: 이번 스캔에서 노출되지 않은 선택지 키: ${id}=${t}`);
    keys.push(t);
  }
  return { id, toks, keys, other };
}

// ⑤ 의미 — none 배타 · 단일 문항 복수 · ④ before: 가 ② 답에 없는 키. 모두 rc=1. irr = null 이면 ④ 정합 검사를 건너뛴다(② 가 빠져 ⑥ 에서 rc=2).
function checkSemantics(r, irr, what) {
  const item = ITEM[r.id];
  if (r.toks.length > 1) {
    const ex = r.keys.find((k) => item.options.some((o) => o.key === k && o.exclusive === true));
    if (ex !== undefined) fail1(`${what}: 배타 선택지 '${ex}' 와 다른 토큰을 함께 골랐다: ${r.id}`);
  }
  if (item.select === "single" && r.toks.length > 1) fail1(`${what}: 단일 선택 문항에 토큰 ${r.toks.length}개: ${r.id}`);
  if (r.id === "approval" && irr !== null) {
    for (const k of r.keys) {
      if (!k.startsWith("before:")) continue;
      const x = k.slice(7);
      const ok = x === "other" ? irr.other !== null : irr.value.includes(x);
      if (!ok) fail1(`${what}: ${k} 가 ② 답에 없는 비가역을 가리킨다`);
    }
  }
}

// 고른 키를 표시 순서로(① ② ③ ⑤ = 카탈로그 순서 · ④ = APPROVAL_ORDER).
function orderKeys(id, keys) {
  const order = id === "approval" ? APPROVAL_ORDER : ITEM[id].options.map((o) => o.key);
  return order.filter((k) => keys.includes(k));
}

// ── 프로파일 입출력 ──

function profilePaths(ctx, orch) {
  const dir = path.join(ctx.root, ".claude", "skills", orch);
  return { dir, file: path.join(dir, "harness-profile.json"), prev: path.join(dir, "harness-profile.prev.json") };
}

// 기존 프로파일: 없으면 null · 읽기 실패·JSON 오류·스키마 불일치면 rc=2(조용히 new 로 떨어지지 않는다 — 명세 §2-3).
// 원본 바이트(없으면 null). 잠근 뒤 CAS 비교용 — 파싱하지 않는다.
function readRaw(file) {
  try { return fs.readFileSync(file); }
  catch (e) { if (e.code === "ENOENT") return null; fail2(`프로파일 다시 읽기 실패: ${file} (${e.code || e.message})`); }
}

function readProfile(file) {
  let buf;
  try { buf = fs.readFileSync(file); }
  catch (e) { if (e.code === "ENOENT") return null; fail2(`프로파일 읽기 실패: ${file} (${e.code || e.message})`); }
  let obj;
  try { obj = JSON.parse(buf.toString("utf8").replace(/^\uFEFF/, "")); }
  catch (e) { fail2(`프로파일 JSON 오류: ${file} (${e.message})`); }
  if (!isObj(obj) || obj.schema !== PROFILE_SCHEMA) fail2(`프로파일 스키마 불일치(schema !== "${PROFILE_SCHEMA}"): ${file}`);
  return { obj, buf };
}

// extend 가 옮길 항목 — 객체가 아니면 옮길 것이 없다 → rc=2(비워서 내면 조용한 누락).
function carriedItem(prof, id, file) {
  const a = isObj(prof.answers) ? prof.answers[id] : undefined;
  if (!isObj(a)) fail2(`프로파일에 이을 항목이 없다(extend 는 ${ITEM[id].no} ${id} 를 잇는다): ${file}`);
  return a;
}

// 쓰기 경로 심링크 거부(rc=2): <root>/.claude · .claude/skills · .claude/skills/<orch> 중 존재하는 것 + 프로파일·prev.
// 디렉토리 심링크를 따라가면 대상 밖에 프로파일이 생긴다(실측: .claude/skills/lnk → 밖 이면 rc=0 으로 밖에 생성).
// <root> 자체는 검사하지 않는다 — --root 는 호출자가 고른 경로다(실경로가 어디든 그 안에 쓰는 것이 의도).
function refuseSymlinks(ctx, p) {
  const claude = path.join(ctx.root, ".claude");
  for (const d of [claude, path.join(claude, "skills"), p.dir]) {
    if (isSymlink(d)) fail2(`심링크 디렉토리 — 따라가 대상 밖에 쓰지 않도록 쓰지 않는다: ${d}`);
  }
  for (const f of [p.file, p.prev]) if (isSymlink(f)) fail2(`심링크 — 따라가 다른 파일을 덮지 않도록 쓰지 않는다: ${f}`);
}

function isSymlink(p) {
  try { return fs.lstatSync(p).isSymbolicLink(); }
  catch (e) { if (e.code === "ENOENT") return false; fail2(`경로 확인 실패: ${p} (${e.code || e.message})`); }
}

// 같은 디렉토리의 임시 파일(O_EXCL · `wx`)에 쓰고 rename(원자적). 실패하면 임시 파일을 지우고 rc=2.
function writeAtomic(dest, data) {
  const tmp = `${dest}.tmp-${process.pid}-${crypto.randomBytes(6).toString("hex")}`;
  let fd;
  try {
    fd = fs.openSync(tmp, "wx");
    fs.writeFileSync(fd, data);
    fs.closeSync(fd);
    fd = undefined;
    fs.renameSync(tmp, dest);
  } catch (e) {
    if (fd !== undefined) { try { fs.closeSync(fd); } catch { /* 무시 */ } }
    try { fs.unlinkSync(tmp); } catch { /* 무시 */ }
    fail2(`프로파일 쓰기 실패: ${dest} (${e.code || e.message})`);
  }
}

// 팩토리 버전 = 이 스크립트 기준 ../../../.claude-plugin/plugin.json 의 version, 없으면 unknown(참조 문서 7절).
function factoryVersion() {
  const f = path.resolve(path.dirname(SELF), "..", "..", "..", ".claude-plugin", "plugin.json");
  let j;
  try { j = JSON.parse(readText(f)); } catch { return "unknown"; }
  return isObj(j) && typeof j.version === "string" && j.version !== "" ? j.version : "unknown";
}

// 항목별 해시 필드(참조 문서 8절): value·other·source + assets 는 scanned.
function hashFields(id, a) {
  const h = { value: a.value, other: a.other, source: a.source };
  if (id === "assets") h.scanned = a.scanned;
  return h;
}

// premise 서명: irreversible 의 해시 필드 + source: assumed 항목 집합(각 해시 필드). 이게 바뀔 때만 factory_version 을 갱신한다.
function premiseSig(answers) {
  const ans = isObj(answers) ? answers : {};
  const irr = isObj(ans.irreversible) ? hashFields("irreversible", ans.irreversible) : null;
  const assumed = {};
  for (const id of ITEM_IDS) if (isObj(ans[id]) && ans[id].source === "assumed") assumed[id] = hashFields(id, ans[id]);
  return canon({ irreversible: irr, assumed });
}

const ITEM_KEYS = ["value", "source", "at", "default", "recommended", "why", "options_incomplete", "other", "scanned"];

// 옮기는 항목: 알려진 키는 7절 순서로, 모르는 키는 원래 순서로 뒤에(값은 그대로 — `at` 보존).
function reorderItem(a) {
  const o = {};
  for (const k of ITEM_KEYS) if (own(a, k)) o[k] = a[k];
  for (const k of Object.keys(a)) if (!own(o, k)) o[k] = a[k];
  return o;
}

function premiseLine(rel, prof) {
  const ans = isObj(prof.answers) ? prof.answers : {};
  const irr = isObj(ans.irreversible) ? ans.irreversible : null;
  const irrText = irr === null ? "?" : [...(Array.isArray(irr.value) ? irr.value : []), ...(typeof irr.other === "string" ? [`other:${irr.other}`] : [])].join(",") + `(${irr.source})`;
  const assumed = ITEM_IDS.filter((id) => isObj(ans[id]) && ans[id].source === "assumed");
  return `harness-intake: 전제 — ${rel} · factory_version=${prof.factory_version} · irreversible=${irrText} · assumed=${assumed.length ? assumed.join(",") : "none"}\n`;
}

// ── questions ──

function cmdQuestions(o, ctx) {
  const sc = scanForIntake(ctx);
  let qs;
  let err = "";
  if (o.after !== undefined) {
    // ④ 만 — --after 는 answer 의 ② 규칙과 같은 검증(문법 → 존재·노출 → 의미).
    const m = new Map();
    parseGrammar(o.after, m, "--after");
    for (const id of m.keys()) if (id !== "irreversible") fail2(`--after 는 irreversible=<토큰,…> 만 받는다: ${JSON.stringify(id)}`);
    const r = resolveItem("irreversible", m.get("irreversible"), sc, "--after");
    checkSemantics(r, null, "--after");
    qs = [buildQuestion(ITEM.approval, sc, { value: orderKeys("irreversible", r.keys), other: r.other })];
  } else if (o.mode === "new") {
    qs = ["completion", "irreversible", "cost", "assets"].map((id) => buildQuestion(ITEM[id], sc, null));
  } else {
    const p = profilePaths(ctx, o.orchestrator);
    const rel = slash(path.relative(ctx.root, p.file));
    const prof = readProfile(p.file);
    if (o.mode === "extend") {
      if (prof === null) {
        err = `harness-intake: 프로파일 없음(${rel}) — extend 를 new 와 같은 문항(①②③⑤)으로 낸다\n`;
        qs = ["completion", "irreversible", "cost", "assets"].map((id) => buildQuestion(ITEM[id], sc, null));
      } else {
        // 카탈로그 순서: ① carried · ② 질문 · ③ carried · ④ carried · ⑤ 질문.
        qs = ITEM_IDS.map((id) => {
          if (id === "irreversible" || id === "assets") return buildQuestion(ITEM[id], sc, null);
          const a = carriedItem(prof.obj, id, p.file);
          const it = ITEM[id];
          return { id, no: it.no, header: it.header, carried: true, value: a.value, source: a.source, at: a.at, other: a.other === undefined ? null : a.other };
        });
      }
    } else {
      qs = []; // maintain·update — 구조를 바꾸지 않는다(HI2-1)
      if (prof !== null) err = premiseLine(rel, prof.obj);
    }
  }
  // 자기 검사(참조 문서 3·4절): 질문 문항의 default 가 비었거나 other 가 true 가 아니면 rc=1.
  for (const q of qs) {
    if (q.carried) continue;
    if (!Array.isArray(q.default) || q.default.length === 0) fail1(`문항 ${q.id} 의 기본값이 비었다(무응답이 갈 곳이 없다)`);
    if (q.other !== true) fail1(`문항 ${q.id} 의 other 가 true 가 아니다`);
  }
  return { out: JSON.stringify(qs, null, 2) + "\n", err };
}

// ── answer ──

function readAnswerFile(f) {
  let text;
  try { text = fs.readFileSync(f, "utf8"); }
  catch (e) { fail2(`--from-file 읽기 실패: ${f} (${e.code || e.message})`); }
  text = text.replace(/^\uFEFF/, "");
  if (text.endsWith("\r\n")) text = text.slice(0, -2);
  else if (text.endsWith("\n")) text = text.slice(0, -1);
  if (/[\r\n]/.test(text)) fail2(`--from-file 내용이 한 줄이 아니다(끝 개행 1개·CRLF 의 CR·BOM 만 제거): ${f}`);
  if (text.startsWith("HARNESS_INTAKE_ANSWERS=")) fail2(`--from-file 내용은 값만 쓴다('HARNESS_INTAKE_ANSWERS=' 접두 금지): ${f}`);
  return text;
}

async function cmdAnswer(o, ctx, now) {
  const p = profilePaths(ctx, o.orchestrator);
  const rel = slash(path.relative(ctx.root, p.file));
  let err = "";

  // ② 입력 읽기 · 기존 프로파일(심링크면 쓰지 않는다 — 읽기 전에 거른다).
  let texts = [];
  if (o.set.length) texts = o.set;
  else if (o.fromEnv) {
    const v = process.env.HARNESS_INTAKE_ANSWERS;
    if (v === undefined) fail2("--from-env 인데 HARNESS_INTAKE_ANSWERS 가 없다");
    texts = [v];
  } else if (o.fromFile !== undefined) texts = [readAnswerFile(o.fromFile)];
  refuseSymlinks(ctx, p);
  const existing = readProfile(p.file);
  const extend = o.mode === "extend" && existing !== null;
  if (o.mode === "extend" && existing === null) err += `harness-intake: 프로파일 없음(${rel}) — extend 를 new 와 같이 처리한다\n`;

  // ③ 문법.
  const main = new Map();
  for (const t of texts) parseGrammar(t, main, "답");
  const rec = new Map();
  for (const t of o.recommended) parseGrammar(t, rec, "--recommended");
  const why = parseWhy(o.why);

  // ④ 항목·키 존재/노출.
  const sc = scanForIntake(ctx);
  const inherits = (id) => extend && (id === "completion" || id === "cost");
  const resolved = new Map();
  for (const [id, toks] of main) {
    const r = resolveItem(id, toks, sc, "답");
    if (inherits(id)) fail2(`extend 는 ①③ 을 잇는다 — 입력에 ${id} 를 줄 수 없다`);
    resolved.set(id, r);
  }
  const recRes = new Map();
  for (const [id, toks] of rec) {
    const r = resolveItem(id, toks, sc, "--recommended");
    if (inherits(id)) fail2(`extend 는 ①③ 을 잇는다 — --recommended 에 ${id} 를 줄 수 없다`);
    recRes.set(id, r);
  }
  for (const id of why.keys()) {
    if (!own(ITEM, id)) fail2(`--why: 모르는 항목 키: ${JSON.stringify(id)}`);
    if (inherits(id)) fail2(`extend 는 ①③ 을 잇는다 — --why 에 ${id} 를 줄 수 없다`);
  }
  // extend 에서 ④ 를 입력하지 않으면 기존 ④ 를 그대로 옮긴다 — 옮기는 항목에 추천·근거를 새로 달 곳이 없다.
  const carryApproval = extend && !main.has("approval");
  if (carryApproval && (recRes.has("approval") || why.has("approval"))) fail2("extend 에서 ④ 를 옮길 때(입력에 approval 없음)는 --recommended·--why 에 approval 을 줄 수 없다");

  // ⑤ 의미. 유효 ② = 입력 ② → (--defaults 면) 기본 ② → 없으면 null(⑥ 에서 rc=2).
  const irrOpts = deriveOptions(ITEM.irreversible, sc, null);
  let irrEff = null;
  if (resolved.has("irreversible")) { const r = resolved.get("irreversible"); irrEff = { value: orderKeys("irreversible", r.keys), other: r.other }; }
  else if (o.defaults) irrEff = { value: defaultOf(ITEM.irreversible, irrOpts), other: null };
  for (const id of ITEM_IDS) if (resolved.has(id)) checkSemantics(resolved.get(id), irrEff, "답");
  for (const id of ITEM_IDS) if (recRes.has(id)) checkSemantics(recRes.get(id), irrEff, "--recommended");
  let carriedAnswers = null;
  if (extend) {
    carriedAnswers = {};
    for (const id of ["completion", "cost", ...(carryApproval ? ["approval"] : [])]) carriedAnswers[id] = carriedItem(existing.obj, id, p.file);
    if (carryApproval && irrEff !== null) {
      const v = Array.isArray(carriedAnswers.approval.value) ? carriedAnswers.approval.value : [];
      for (const k of v) {
        if (typeof k !== "string" || !k.startsWith("before:")) continue;
        const x = k.slice(7);
        const ok = x === "other" ? irrEff.other !== null : irrEff.value.includes(x);
        if (!ok) fail1(`② 가 바뀌어 ④ 를 다시 답해야 한다 — 기존 ④ 의 ${k} 가 새 ② 답에 없다(approval 을 입력에 넣는다)`);
      }
    }
  }

  // ⑥ 빠진 항목.
  const need = ITEM_IDS.filter((id) => !(extend && (inherits(id) || (id === "approval" && carryApproval))));
  const missing = need.filter((id) => !resolved.has(id));
  if (missing.length && !o.defaults) fail2(`빠진 항목: ${missing.join(",")} — 기본값을 암묵적으로 쓰지 않는다(--defaults 로 명시)`);

  // 쓰기 준비가 끝난 뒤에만 런타임을 조회한다(오류 입력에 도구를 실행하지 않는다).
  const runtime = Object.fromEntries(await runtimeValues());
  const signals = uniqSorted([...sc.sig]);
  const ex = existing ? existing.obj : null;
  const exAns = ex && isObj(ex.answers) ? ex.answers : {};

  const answers = {};
  for (const id of ITEM_IDS) {
    if (carriedAnswers && own(carriedAnswers, id)) { answers[id] = reorderItem(carriedAnswers[id]); continue; }
    const item = ITEM[id];
    const def = defaultOf(item, deriveOptions(item, sc, irrEff));
    let value, other, source;
    if (resolved.has(id)) { const r = resolved.get(id); value = orderKeys(id, r.keys); other = r.other; source = "declared"; }
    else { value = def; other = null; source = "assumed"; }
    let recommended = [];
    if (recRes.has(id)) { const r = recRes.get(id); recommended = [...orderKeys(id, r.keys), ...(r.other !== null ? [`other:${r.other}`] : [])]; }
    const a = { value, source, at: now, default: def, recommended, why: why.has(id) ? why.get(id) : null, options_incomplete: other !== null, other };
    if (id === "assets") a.scanned = { agents: sc.agents, skills: sc.skills };
    const old = exAns[id];
    if (isObj(old) && typeof old.at === "string" && canon(hashFields(id, a)) === canon(hashFields(id, old))) a.at = old.at; // 같은 값 재기록 → at 불변
    answers[id] = a;
  }

  const oldScan = ex && isObj(ex.scan) ? ex.scan : null;
  const scanAt = oldScan && typeof oldScan.at === "string" && canon({ runtime: oldScan.runtime, signals: oldScan.signals }) === canon({ runtime, signals }) ? oldScan.at : now;
  const fv = ex && typeof ex.factory_version === "string" && premiseSig(ex.answers) === premiseSig(answers) ? ex.factory_version : factoryVersion();
  const profile = {
    schema: PROFILE_SCHEMA,
    factory_version: fv,
    mode: extend ? "extend" : "new",
    at: now,
    scan: { runtime, signals, at: scanAt },
    answers,
  };

  refuseSymlinks(ctx, p); // mkdir -p 가 심링크 디렉토리를 따라 대상 밖에 만들기 전에(참조 문서 6·7절)
  try { fs.mkdirSync(p.dir, { recursive: true }); }
  catch (e) { fail2(`프로파일 디렉토리 생성 실패: ${p.dir} (${e.code || e.message})`); }
  // 쓰기 직전 재확인(첫 확인과 쓰기 사이에 심링크로 바뀐 경우). rename 은 목적지 심링크를 따라가지 않지만 규칙상 거부한다.
  refuseSymlinks(ctx, p);

  // 동시 실행(참조 문서 7절): 잠금(O_EXCL) → 잠근 채 기존 프로파일 재읽기·바이트 비교(CAS) → prev·본문 쓰기.
  // 시작 때 읽은 판(existing — 스캔·RUNTIME 보다 먼저 읽었다)과 다르면 다른 answer 가 그 사이 썼다 → lost update·prev 불일치를 막고 rc=2.
  // 남의 잠금은 지우지 않고 자동으로 깨지도 않는다. 이 실행이 만든 잠금만 finally 에서 지운다(성공·실패·예외 모두).
  const lock = path.join(p.dir, "harness-profile.lock");
  let lfd;
  try { lfd = fs.openSync(lock, "wx"); }
  catch (e) {
    if (e.code === "EEXIST") fail2(`잠금이 이미 있다 — 다른 answer 가 실행 중이거나 남은 잠금(실행 중이 아니면 지우고 다시 한다): ${lock}`);
    fail2(`잠금 생성 실패: ${lock} (${e.code || e.message})`);
  }
  try {
    try { fs.writeSync(lfd, `pid=${process.pid} at=${new Date().toISOString()}\n`); } finally { fs.closeSync(lfd); }
    const cur = readRaw(p.file);
    const same = existing === null ? cur === null : cur !== null && cur.equals(existing.buf);
    if (!same) fail2(`동시 수정 — 시작 뒤 다른 실행이 프로파일을 바꿨다(아무것도 쓰지 않음 · 다시 실행): ${p.file}`);
    if (existing !== null) writeAtomic(p.prev, existing.buf); // 1세대 보존(원본 바이트 그대로)
    writeAtomic(p.file, JSON.stringify(profile, null, 2) + "\n");
  } finally {
    try { fs.unlinkSync(lock); } catch { /* 이미 없음 — 무시 */ }
  }

  const out = `PROFILE: ${rel}\nSOURCES: ${ITEM_IDS.map((id) => `${id}=${answers[id].source}`).join(" ")}\n`;
  return { out, err };
}

// ───────────────────────── S3: render · verify ─────────────────────────
// 계약 단일 출처: references/harness-interview.md 8절(정규 JSON·해시 필드) · 9절(결선표) · 10절(블록 형식·규범 예시·해시 입력·판정).
// render 는 **프로파일만** 읽는다 — 스캔·RUNTIME·실행 시각 없음(같은 프로파일 → 바이트 동일). 파일을 쓰지 않는다(모델이 넣는다).
// verify 는 대상 파일을 읽기만 한다. 해시 = sha256(utf8(canon(입력))) — canon·hashFields 는 S2 의 것을 그대로 쓴다(같은 규칙의 두 구현 금지).

const BLOCK_IDS = ["completion", "tier", "approval", "assets", "premise"]; // render 출력 순서 = WIRED 순서(10-1·10-4)
const SECTION_OF = { completion: "## 완료 기준", tier: "## 리스크 등급", approval: "## 승인 관문", assets: "## 기존 자산" }; // 9절
const PREMISE_SECTION = "## 하네스:"; // 이 접두로 시작하는 섹션(10-4)
const SOURCE_VALUES = ["declared", "assumed", "scanned"]; // 7절(scanned 는 예약 — 받되 DECLARED·ASSUMED 어느 줄에도 넣지 않는다)
const AT_RE = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/; // 7절 저장 형식
const bt = (k) => "`" + k + "`"; // 백틱은 선택지 키를 감싸는 한 쌍뿐(10-1)

const sha256hex = (s) => crypto.createHash("sha256").update(Buffer.from(s, "utf8")).digest("hex");

// 선택지 키 → 라벨(카탈로그). ④ before:<②키> 는 before_label 틀 · ⑤ reuse 는 scanned 목록 길이로 채운다. 모르는 키 = null.
function labelOf(id, key, a) {
  if (id === "approval" && key.startsWith("before:")) {
    const x = key.slice(7);
    if (x === "other") return ITEM.approval.before_label.replace("{label}", () => OTHER_BEFORE_LABEL);
    const o = ITEM.irreversible.options.find((p) => p.key === x && p.key !== "none");
    return o ? ITEM.approval.before_label.replace("{label}", () => o.label) : null;
  }
  const o = ITEM[id].options.find((p) => p.key === key);
  if (!o) return null;
  if (id === "assets" && key === "reuse") {
    return o.label.replace("{agents}", () => String(a.scanned.agents.length)).replace("{skills}", () => String(a.scanned.skills.length));
  }
  return o.label;
}

// 의미 규칙 재검사(참조 문서 10-1): answer 가 거부할 조합(모르는 키 · 단일 문항 복수 · none 배타 · ④ before:<키> 가 ② 답에 없음)이면 rc=2.
// S2 의 resolveItem·checkSemantics 를 **그대로** 부른다(같은 규칙의 두 구현 금지). 노출(스캔 신호) 검사는 하지 않는다 —
// 프로파일은 answer 시점 스캔 기준이고 render·verify 는 재스캔하지 않으므로, 모든 신호가 참인 가짜 sig 를 넘겨 노출 판정을 무력화한다.
// checkSemantics 의 rc=1 은 여기서 rc=2 로 올린다(손으로 고친 프로파일 = 손상 — 사용자 답의 의미 오류가 아니다).
const ALL_EXPOSED = { sig: { has: () => true } };
function checkAnswerSemantics(ans, file) {
  const what = `프로파일 ${file}`;
  try {
    const res = new Map();
    for (const id of ITEM_IDS) {
      const a = ans[id];
      res.set(id, resolveItem(id, [...a.value, ...(a.other !== null ? [`other:${a.other}`] : [])], ALL_EXPOSED, what));
    }
    const irr = { value: ans.irreversible.value, other: ans.irreversible.other };
    for (const id of ITEM_IDS) checkSemantics(res.get(id), irr, what);
  } catch (e) {
    if (e instanceof IntakeError) fail2(`${e.message} — answer 의 의미 규칙 위반(손으로 고친 프로파일 · answer 로 다시 기록한다)`);
    throw e;
  }
}

// render·verify 가 쓰는 answers — 5항목 전부 · 형식(타입·빈 답·같은 키 두 번·at·scanned)이 맞아야 한다(rc=2). 의미 규칙은 checkAnswerSemantics.
function checkedAnswers(prof, file) {
  const ans = prof.answers;
  if (!isObj(ans)) fail2(`프로파일에 answers 가 없다: ${file}`);
  for (const id of ITEM_IDS) {
    const a = ans[id];
    const w = `프로파일 answers.${id}`;
    if (!isObj(a)) fail2(`${w} 가 없다(render·verify 는 5항목 전부 필요 — answer 로 채운다): ${file}`);
    if (!Array.isArray(a.value) || a.value.some((k) => typeof k !== "string")) fail2(`${w}.value 가 문자열 배열이 아니다(손상): ${file}`);
    if (new Set(a.value).size !== a.value.length) fail2(`${w}.value 에 같은 키가 두 번(손상): ${file}`);
    if (!own(a, "other") || !(a.other === null || (typeof a.other === "string" && a.other !== ""))) fail2(`${w}.other 가 null 도 문장도 아니다(손상): ${file}`);
    if (typeof a.source !== "string" || !SOURCE_VALUES.includes(a.source)) fail2(`${w}.source 가 declared|assumed|scanned 가 아니다(손상): ${file}`);
    if (typeof a.at !== "string" || !AT_RE.test(a.at)) fail2(`${w}.at 이 YYYY-MM-DDTHH:MM:SSZ 가 아니다(손상): ${file}`);
    if (id === "assets") {
      const s = a.scanned;
      const names = (v) => Array.isArray(v) && v.every((x) => typeof x === "string");
      if (!isObj(s) || !names(s.agents) || !names(s.skills)) fail2(`${w}.scanned 가 { agents: [..], skills: [..] } 가 아니다(손상): ${file}`);
      if ([...s.agents, ...s.skills].some((x) => CTRL_RE.test(x))) fail2(`${w}.scanned 이름에 제어 문자(탭 외 C0·DEL — 손상): ${file}`);
    }
    // 참조 문서 10-1: 렌더되는 문자열의 제어 문자는 rc=2 — answer 의 CTRL_RE(6절)를 그대로 쓴다(블록은 줄 단위 · CR 은 영구 drift).
    if (typeof a.other === "string" && CTRL_RE.test(a.other)) fail2(`${w}.other 문장에 제어 문자(탭 외 C0·DEL — 손상): ${file}`);
    if (a.value.length === 0 && a.other === null) fail2(`${w} 가 비었다(value [] · other null — 손상): ${file}`);
  }
  checkAnswerSemantics(ans, file);
  // 렌더 전 방어: value 에 `other:…` 로 시작하는 키가 있으면 resolveItem 은 other 토큰으로 읽는다 — 라벨이 없는 키는 여기서 거른다.
  for (const id of ITEM_IDS) for (const k of ans[id].value) if (labelOf(id, k, ans[id]) === null) fail2(`프로파일 answers.${id}.value 의 키가 카탈로그에 없다(손상): ${JSON.stringify(k)} — ${file}`);
  if (typeof prof.factory_version !== "string" || prof.factory_version === "") fail2(`프로파일 factory_version 이 문자열이 아니다(손상): ${file}`);
  if (CTRL_RE.test(prof.factory_version)) fail2(`프로파일 factory_version 에 제어 문자(탭 외 C0·DEL — 손상): ${file}`);
  return ans;
}

// 한 줄 안의 값 목록(10-2 변형 규칙 "이음"·"other"): 값들 → (있으면) `그 외: <문장>` 을 ` · ` 로. keys=true 면 각 값 뒤에 ` (`키`)`.
function inlineValues(id, a, keys) {
  const parts = a.value.map((k) => (keys ? `${labelOf(id, k, a)} (${bt(k)})` : labelOf(id, k, a)));
  if (a.other !== null) parts.push(keys ? `그 외: ${a.other} (${bt("other")})` : `그 외: ${a.other}`);
  return parts.join(" · ");
}

// 줄 단위 블록(completion·approval)의 값 줄들 + other 줄.
function valueLines(id, a) {
  const out = a.value.map((k) => `- ${labelOf(id, k, a)} (${bt(k)})`);
  if (a.other !== null) out.push(`- 그 외: ${a.other} (${bt("other")})`);
  return out;
}

const isNoneIrr = (irr) => irr.value.includes("none"); // checkedAnswers 가 none 을 단독으로 보장한다

// 블록 id → { hash, inner: [안쪽 줄] }. rel = 대상 루트 기준 프로파일 경로(`/`).
function renderBlocks(prof, rel, file) {
  const ans = checkedAnswers(prof, file);
  const cv = CATALOG.catalog_version;
  const hf = (id) => hashFields(id, ans[id]);
  const out = new Map();
  const put = (id, extra, inner) => out.set(id, { hash: sha256hex(canon({ block: id, catalog_version: cv, ...extra })), inner });

  put("completion", { completion: hf("completion") }, valueLines("completion", ans.completion));

  const irr = ans.irreversible;
  const rules = [];
  if (!isNoneIrr(irr)) rules.push(`단계 산출물이 비가역 목록에 닿는다 → 중대 — 비가역: ${inlineValues("irreversible", irr, true)}`);
  rules.push("계약 변경·다도메인(SKILL.md 5-6 표) → 중대", "다파일·기능 추가 → 표준", "그 밖 → 경량");
  const tier = ["단계 등급은 아래를 위에서부터 적용해 처음 맞는 것으로 정한다.", ...rules.map((r, i) => `${i + 1}. ${r}`)];
  if (ans.cost.value.includes("error-worse")) tier.push("하한: 실패 비용 = 오류 우선 → 코드·설계 단계는 최소 표준");
  put("tier", { irreversible: hf("irreversible"), cost: hf("cost") }, tier);

  // ④ 는 ② 에서 파생하지 않는다(10-3) — 저장된 value 그대로.
  const appr = valueLines("approval", ans.approval);
  if (!ans.approval.value.includes("autonomous")) appr.push("- 자율 노브(_workspace/.autonomous): 허용하지 않음");
  put("approval", { approval: hf("approval") }, appr);

  const as = ans.assets;
  const names = (arr) => (arr.length ? arr.join(", ") : "없음");
  put("assets", { assets: hf("assets") }, [
    `- 정책: ${inlineValues("assets", as, true)}`,
    `- 스캔된 에이전트(${as.scanned.agents.length}): ${names(as.scanned.agents)}`,
    `- 스캔된 스킬(${as.scanned.skills.length}): ${names(as.scanned.skills)}`,
  ]);

  // premise: 가정 항목(카탈로그 순서) → 비가역. 날짜 = premise 항목(irreversible + assumed)의 항목별 at 최신값 날짜 — 최상위 at 은 쓰지 않는다.
  const assumedIds = ITEM_IDS.filter((id) => ans[id].source === "assumed");
  const assumed = Object.fromEntries(assumedIds.map((id) => [id, hf(id)]));
  const date = uniqSorted(["irreversible", ...assumedIds].map((id) => ans[id].at)).pop().slice(0, 10);
  const fv = prof.factory_version;
  const premise = [`**전제:** 프로파일 ${bt(rel)} (${date} · 팩토리 ${fv})`];
  for (const id of assumedIds) premise.push(`- ⚠ 가정(무응답): ${ITEM[id].header} = ${inlineValues(id, ans[id], false)}`);
  premise.push(isNoneIrr(irr) ? "- 비가역: 없음 — 전부 되돌릴 수 있다" : `- 비가역: ${inlineValues("irreversible", irr, false)} → 이 목록에 닿는 단계는 중대`);
  put("premise", { irreversible: hf("irreversible"), assumed, date, factory_version: fv, profile: rel }, premise);
  return out;
}

const blockText = (id, b) => `<!-- harness-profile:${id} sha256=${b.hash} -->\n${b.inner.join("\n")}\n<!-- /harness-profile:${id} -->\n`;

function loadForS3(o, ctx) {
  const p = profilePaths(ctx, o.orchestrator);
  const rel = slash(path.relative(ctx.root, p.file));
  const prof = readProfile(p.file);
  if (prof === null) fail2(`프로파일 없음: ${rel} — answer 로 먼저 만든다`);
  return { p, rel, prof: prof.obj, blocks: renderBlocks(prof.obj, rel, p.file) };
}

function cmdRender(o, ctx) {
  const { blocks } = loadForS3(o, ctx);
  const ids = o.block === undefined ? BLOCK_IDS : [o.block];
  return { rc: 0, out: ids.map((id) => blockText(id, blocks.get(id))).join("\n"), err: "" };
}

// ── verify ──

// 대상 파일: 없음 → absent · 읽기 실패(권한·디렉토리 등 I/O) → rc=2 · UTF-8 아님 → unreadable · 그 밖 → BOM 1개 제거 · CRLF→LF 뒤 줄 배열.
function readTarget(file) {
  let buf;
  try { buf = fs.readFileSync(file); }
  catch (e) {
    if (e.code === "ENOENT" || e.code === "ENOTDIR") return { state: "absent" };
    fail2(`대상 파일을 읽을 수 없다(환경 오류 — 검사하지 못했다): ${file} (${e.code || e.message})`);
  }
  let text;
  try { text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(buf); }
  catch { diag(`대상 파일이 UTF-8 이 아니다(unreadable 로 판정): ${file}`); return { state: "unreadable" }; }
  const lines = text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").split("\n");
  return { state: "ok", lines, info: lineInfo(lines) };
}

// 줄마다 { fenced, section }. 코드 펜스 = CommonMark 기본형: 0~3칸 들여쓴 ``` 또는 ~~~(3개 이상)로 열고(백틱 펜스의 info 에 백틱 금지),
// 같은 문자·같거나 긴 길이·뒤 공백만인 줄로 닫는다 · 닫히지 않으면 문서 끝까지. 펜스 줄 자체도 fenced.
// 섹션 = 펜스 밖 헤딩(HEADING_RE — 0~3칸 들여쓰기 뒤 # 또는 ## + 공백·탭/줄 끝)부터 다음 헤딩 전까지. 첫 헤딩 전은 section null.
const HEADING_RE = /^ {0,3}#{1,2}(?:[ \t]|$)/;
function lineInfo(lines) {
  const info = [];
  let fence = null;
  let section = null;
  for (const line of lines) {
    if (fence !== null) {
      const m = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(line);
      if (m && m[1][0] === fence.ch && m[1].length >= fence.len) fence = null;
      info.push({ fenced: true, section });
      continue;
    }
    const m = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (m && !(m[1][0] === "`" && m[2].includes("`"))) {
      fence = { ch: m[1][0], len: m[1].length };
      info.push({ fenced: true, section });
      continue;
    }
    // 헤딩(참조 문서 10-4 · CommonMark ATX): 0~3칸 들여쓰기 뒤 # 또는 ## + 공백·탭(또는 줄 끝). 4칸 이상 = 코드 블록 · ### 이하 = 경계 아님.
    // 섹션 문구는 들여쓰기·끝 공백을 뗀 값 — 지정 섹션 비교(정확 일치 · `## 하네스:` 접두)가 들여쓰기에 흔들리지 않게.
    if (HEADING_RE.test(line)) section = line.replace(/^ {0,3}/, "").replace(/[ \t]+$/, "");
    info.push({ fenced: false, section });
  }
  return info;
}

const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// 한 파일 안 블록 하나의 판정(10-4 표 — 위에서부터 처음 맞는 것). want = { hash, inner } · inSection(section) = 지정 섹션인가.
// 표식 = 펜스 밖에서 **줄 전체**가 정확히 여는/닫는 표식인 줄. 그 블록 id 의 `harness-profile:<id>` 를 담고 `<!--`·`-->` 가 있는데
// 정확한 표식이 아닌 줄(앞뒤 공백·해시 형식·대문자 등)은 형식 불일치 → malformed.
function judgeBlock(id, doc, want, inSection) {
  if (doc.state === "absent") return "missing";
  if (doc.state === "unreadable") return "unreadable";
  const openRe = new RegExp(`^<!-- harness-profile:${reEsc(id)} sha256=([0-9a-f]{64}) -->$`);
  const close = `<!-- /harness-profile:${id} -->`;
  const looseRe = new RegExp(`harness-profile:${reEsc(id)}(?![A-Za-z0-9_-])`);
  const ev = [];
  doc.lines.forEach((line, i) => {
    if (doc.info[i].fenced) return;
    const m = openRe.exec(line);
    if (m) ev.push({ t: "open", hash: m[1], i });
    else if (line === close) ev.push({ t: "close", i });
    else if (looseRe.test(line) && (line.includes("<!--") || line.includes("-->"))) ev.push({ t: "bad", i });
  });
  if (ev.length === 0) return "missing";
  if (ev.some((e) => e.t === "bad")) return "malformed";
  const pairs = [];
  let cur = null;
  for (const e of ev) {
    if (e.t === "open") { if (cur !== null) return "malformed"; cur = e; }
    else { if (cur === null) return "malformed"; pairs.push([cur, e]); cur = null; }
  }
  if (cur !== null) return "malformed";
  if (pairs.length > 1) return "duplicate";
  const [op, cl] = pairs[0];
  if (!inSection(doc.info[op.i].section) || !inSection(doc.info[cl.i].section)) return "misplaced";
  if (op.hash !== want.hash) return "stale";
  if (doc.lines.slice(op.i + 1, cl.i).join("\n") !== want.inner.join("\n")) return "drift";
  return "ok";
}

function cmdVerify(o, ctx) {
  const { p, prof, blocks } = loadForS3(o, ctx);
  const skill = readTarget(path.join(p.dir, "SKILL.md"));
  const claude = readTarget(path.join(ctx.root, "CLAUDE.md"));
  const agents = readTarget(path.join(ctx.root, "AGENTS.md"));
  const inPremise = (s) => s !== null && s.startsWith(PREMISE_SECTION);
  const w = [];
  for (const id of BLOCK_IDS.slice(0, 4)) w.push([id, judgeBlock(id, skill, blocks.get(id), (s) => s === SECTION_OF[id])]);
  w.push(["premise.claude", judgeBlock("premise", claude, blocks.get("premise"), inPremise)]);
  w.push(["premise.agents", agents.state === "absent" ? "na" : judgeBlock("premise", agents, blocks.get("premise"), inPremise)]);
  const ans = prof.answers;
  const dated = (src) => {
    const ids = ITEM_IDS.filter((id) => ans[id].source === src);
    return ids.length ? ids.map((id) => `${id}(${ans[id].at.slice(0, 10)})`).join(" ") : "none";
  };
  const out = `WIRED: ${w.map(([k, v]) => `${k}=${v}`).join(" ")}\nDECLARED: ${dated("declared")}\nASSUMED: ${dated("assumed")}\n`;
  return { rc: w.some(([, v]) => v !== "ok" && v !== "na") ? 1 : 0, out, err: "" };
}

// ── 인자 ──

const ARG_SPEC = {
  questions: { val: ["--root", "--now", "--orchestrator", "--mode", "--after"], rep: [], flag: [] },
  answer: { val: ["--root", "--now", "--orchestrator", "--mode", "--from-file"], rep: ["--set", "--recommended", "--why"], flag: ["--from-env", "--defaults"] },
  // S3 — --now 는 받지 않는다(시각을 쓰지 않으므로 받으면 결정성을 오해한다 · rc=2).
  render: { val: ["--root", "--orchestrator", "--block"], rep: [], flag: [] },
  verify: { val: ["--root", "--orchestrator"], rep: [], flag: [] },
};

// 판정 순서 ① — 인자 형식·출처 개수·--orchestrator. 반복 가능 옵션(--set·--recommended·--why) 외에 두 번 오면 rc=2.
function parseS2Args(sub, argv) {
  const spec = ARG_SPEC[sub];
  const seen = new Set();
  const v = Object.create(null);
  const rep = { "--set": [], "--recommended": [], "--why": [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (spec.flag.includes(a)) {
      if (seen.has(a)) failUsage(`옵션이 두 번: ${a}`);
      seen.add(a);
    } else if (spec.val.includes(a) || spec.rep.includes(a)) {
      if (i + 1 >= argv.length) failUsage(`${a} 에 값이 없다`);
      const val = argv[++i];
      if (spec.rep.includes(a)) rep[a].push(val);
      else { if (seen.has(a)) failUsage(`옵션이 두 번: ${a}`); seen.add(a); v[a] = val; }
    } else if (a === "--now" && (sub === "render" || sub === "verify")) {
      failUsage(`${sub} 는 --now 를 받지 않는다 — 시각을 쓰지 않는다(같은 프로파일 → 같은 출력)`);
    } else if (a.startsWith("-")) {
      failUsage(`모르는 옵션(${sub}): ${a}`);
    } else {
      failUsage(`남는 인자: ${a}`);
    }
  }
  const o = {
    root: v["--root"], now: v["--now"], orchestrator: v["--orchestrator"], mode: v["--mode"], after: v["--after"], fromFile: v["--from-file"], block: v["--block"],
    fromEnv: seen.has("--from-env"), defaults: seen.has("--defaults"),
    set: rep["--set"], recommended: rep["--recommended"], why: rep["--why"],
  };
  if (sub === "questions") {
    if (o.mode === undefined) failUsage("--mode 가 없다(new|extend|maintain|update)");
    if (!["new", "extend", "maintain", "update"].includes(o.mode)) failUsage(`--mode 값이 아니다: ${o.mode}(new|extend|maintain|update)`);
    if (o.after !== undefined && o.mode !== "new") failUsage("--after 는 --mode new 와만 쓴다");
    if (o.mode !== "new" && o.orchestrator === undefined) failUsage(`--mode ${o.mode} 는 --orchestrator 가 필요하다(기존 프로파일 위치)`);
  } else if (sub === "answer") {
    if (o.mode === undefined) o.mode = "new";
    if (!["new", "extend"].includes(o.mode)) failUsage(`answer 의 --mode 는 new|extend: ${o.mode}`);
    if (o.orchestrator === undefined) failUsage("--orchestrator 가 없다");
    const n = (o.set.length ? 1 : 0) + (o.fromEnv ? 1 : 0) + (o.fromFile !== undefined ? 1 : 0);
    if (n > 1) failUsage("--set·--from-env·--from-file 중 하나만 쓴다");
  } else {
    if (o.orchestrator === undefined) failUsage("--orchestrator 가 없다");
    if (o.block !== undefined && !BLOCK_IDS.includes(o.block)) failUsage(`--block 값이 블록 id 가 아니다: ${JSON.stringify(o.block)}(${BLOCK_IDS.join("|")})`);
  }
  if (o.orchestrator !== undefined && !ORCH_RE.test(o.orchestrator)) failUsage(`--orchestrator 이름이 ^[a-z0-9][a-z0-9-]{0,63}$ 가 아니다: ${JSON.stringify(o.orchestrator)}`);
  return o;
}

function rootOf(root) {
  const rootAbs = path.resolve(root === undefined ? process.cwd() : root);
  let isDir = false;
  try { isDir = fs.statSync(rootAbs).isDirectory(); } catch { isDir = false; }
  if (!isDir) failUsage(`--root 가 디렉토리가 아니다: ${rootAbs}`);
  return rootAbs;
}

async function runS2(sub, argv) {
  try {
    const o = parseS2Args(sub, argv);
    const now = sub === "questions" || sub === "answer" ? parseNow(o.now) : null; // render·verify 는 시각을 쓰지 않는다
    const ctx = { root: rootOf(o.root), home: path.resolve(os.homedir()) };
    const r = sub === "questions" ? cmdQuestions(o, ctx)
      : sub === "answer" ? await cmdAnswer(o, ctx, now)
      : sub === "render" ? cmdRender(o, ctx)
      : cmdVerify(o, ctx);
    return exitWith(r.rc === undefined ? 0 : r.rc, r.out, r.err);
  } catch (e) {
    if (e instanceof IntakeError) return exitWith(e.rc, "", `harness-intake: ${e.message}\n${e.usage ? USAGE + "\n" : ""}`);
    throw e;
  }
}

// ───────────────────────── CLI ─────────────────────────

const USAGE = "사용: node harness-intake.mjs <scan|questions|answer|render|verify|selftest> [--root <dir>] [--now <ISO>] …(questions·answer·render·verify 옵션: references/harness-interview.md)";

function exitWith(code, out, err) {
  if (err) process.stderr.write(err);
  if (out) process.stdout.write(out, () => process.exit(code)); // 파이프 flush 뒤 종료(마감 넘긴 고아 자식이 종료를 붙잡지 않게)
  else process.exit(code);
}

function usageError(msg) { exitWith(2, "", `harness-intake: ${msg}\n${USAGE}\n`); }

async function main(argv) {
  const sub = argv[0];
  if (sub === undefined || sub.startsWith("-")) return usageError("서브커맨드가 없다");
  if (sub === "selftest") {
    // 얇은 위임만 — 가드 로직은 별도 파일에 둔다(이 파일 전체가 스텁으로 덮이는 사고에도 가드가 살아남게).
    const st = path.join(path.dirname(SELF), "selftest-harness-intake.mjs");
    if (!fs.existsSync(st)) return exitWith(2, "", `harness-intake: selftest 파일 없음: ${st}\n`);
    const r = spawnSync(process.execPath, [st, ...argv.slice(1)], { stdio: "inherit" });
    return exitWith(typeof r.status === "number" ? r.status : 2, "", r.error ? `harness-intake: selftest 실행 실패 (${r.error.message})\n` : "");
  }
  if (sub === "questions" || sub === "answer" || sub === "render" || sub === "verify") return runS2(sub, argv.slice(1));
  if (sub !== "scan") return usageError(`모르는 서브커맨드: ${sub}`);

  let root = process.cwd();
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--root" || a === "--now") {
      if (i + 1 >= argv.length) return usageError(`${a} 에 값이 없다`);
      const v = argv[++i];
      if (a === "--root") root = v;
      // --now: 시각은 `at` 필드에만 쓴다 — scan 출력에는 시각이 없으므로 받기만 한다(S2 answer 가 사용).
    } else if (a.startsWith("-")) {
      return usageError(`모르는 옵션: ${a}`);
    } else {
      return usageError(`남는 인자: ${a}`);
    }
  }
  const rootAbs = path.resolve(root);
  let isDir = false;
  try { isDir = fs.statSync(rootAbs).isDirectory(); } catch { isDir = false; }
  if (!isDir) return usageError(`--root 가 디렉토리가 아니다: ${rootAbs}`);

  const ctx = { root: rootAbs, home: path.resolve(os.homedir()) };
  const out = await scan(ctx);
  return exitWith(0, out, "");
}

// named export(parseFrontmatterList)를 import 할 때는 CLI 를 돌리지 않는다. 심링크로 실행해도 맞도록 양쪽 실경로 비교.
function isMain() {
  try { return !!process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(SELF); }
  catch { return false; }
}

if (isMain()) {
  main(process.argv.slice(2)).catch((e) => exitWith(2, "", `harness-intake: 내부 오류 — ${e && e.stack ? e.stack : e}\n`));
}
