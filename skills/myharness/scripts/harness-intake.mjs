#!/usr/bin/env node
// harness-intake.mjs — 하네스 구성 인터뷰 스캐너(v1.7.6 S1: `scan` · `selftest`).
// 계약 단일 출처: docs/v1.7.6/design/harness-interview-design.md §2(구현 명세 v176-S1 §2·§3 이 정정분).
// 결정은 스크립트가, 추천과 질문은 모델이 — 이 파일은 관측만 한다(파일 쓰기 없음).
//
// 사용: node harness-intake.mjs <scan|selftest> [--root <dir>] [--now <ISO>]
//   scan              대상 루트(--root, 기본 cwd)의 에이전트·스킬·플러그인·신호·런타임을 15줄 계약으로 stdout 에
//   selftest [대상]   selftest-harness-intake.mjs 로 얇게 위임(가드는 별도 파일 — 이 파일이 통째로 스텁으로 덮여도 살아남게)
//   그 밖             rc=2 `not implemented in this version: <sub>`(questions·answer·render·verify 는 S2 이후)
// 종료코드: 0 정상 · 1 내용 검증 실패(scan 에는 없음) · 2 사용·환경 오류.
// 규약: stdout = 계약 줄만(`KEY: value`, `\n`). 사람용 진단은 stderr — check-review-tools.sh 는 진단도 stdout 이라 선례가 아니다.
// 결정성: 모든 목록은 코드포인트 오름차순(JS 기본 sort 는 UTF-16 코드유닛 순이라 BMP 밖에서 어긋난다) · readdir 결과도 정렬 후 사용.
// 의존성: node 내장 모듈만(팩토리 스킬은 자기완결 — harness-ui 에 기댈 수 없다). node ≥18 문법.
// RUNTIME 탐색은 `command -v` 와 **의도적으로 다르다**: PATH 의 비절대 항목(빈 항목·`.`·상대경로)은 전부 건너뛴다 —
//   scan 의 cwd 는 보통 하네스를 만들 **대상 프로젝트 루트**라, 그 안의 `./claude` 를 --version 으로 실행하면 대상 레포 코드를 실행하게 된다.
// 카탈로그 배제: ~/.claude/plugins/marketplaces(설치 안 된 카탈로그 클론)는 installPath·재귀·심링크 어느 경로로도 읽지 않는다(명세 §6-1).
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
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

async function scanRuntime() {
  const tools = ["claude", "codex", "agy"];
  const vals = await Promise.all(tools.map((t) => {
    const f = findTool(t);
    return f === null ? Promise.resolve("absent") : probeVersion(f, VERSION_RE[t]);
  }));
  return tools.map((t, i) => `${t}=${tok(vals[i])}`).join(" ");
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

  // 스킬 — <d>/SKILL.md 가 있는 디렉토리(심링크 따라감).
  const skillDirs = (base) => listDir(base).filter((e) => e.st.isDirectory()).map((e) => ({ name: e.name, md: child(e.full, "SKILL.md", "file") })).filter((x) => x.md);
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

// ───────────────────────── CLI ─────────────────────────

const USAGE = "사용: node harness-intake.mjs <scan|selftest> [--root <dir>] [--now <ISO>]";

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
  if (sub !== "scan") return exitWith(2, "", `not implemented in this version: ${sub}\n`);

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
