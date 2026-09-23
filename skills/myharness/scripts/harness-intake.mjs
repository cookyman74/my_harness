#!/usr/bin/env node
// harness-intake.mjs — 하네스 구성 인터뷰(v1.7.6 S1: `scan` · `selftest` / S2: `questions` · `answer` / S3: `render` · `verify`).
// 계약 단일 출처: scan = docs/v1.7.6/design/harness-interview-design.md §2(구현 명세 v176-S1 §2·§3 이 정정분) ·
//   questions·answer·프로파일·render·verify = skills/myharness/references/harness-interview.md(카탈로그·기본값·답 문법·검증표·`at` 규칙 · 8~10절 결선).
// 결정은 스크립트가, 추천과 질문은 모델이 — scan·questions·render·verify 는 관측만 하고, 파일을 쓰는 것은 answer(프로파일 1개 + prev) 뿐이다.
//
// 사용: node harness-intake.mjs <scan|questions|answer|render|verify|assemble|place|settings|egress|selftest> [--root <dir>] [--now <ISO>] …
//   scan              대상 루트(--root, 기본 cwd)의 에이전트·스킬·플러그인·신호·런타임을 15줄 계약으로 stdout 에
//   questions         --mode <new|extend|maintain|update> [--orchestrator <이름>] [--after irreversible=<토큰,…>] → 문항 JSON 배열
//   answer            --orchestrator <이름> (--set … | --from-env | --from-file <f>) [--defaults] [--recommended …] [--why …] [--mode new|extend]
//                     → <root>/.claude/skills/<이름>/harness-profile.json 원자적 쓰기 · stdout `PROFILE:`·`SOURCES:` 두 줄
//   selftest [대상]   selftest-harness-intake.mjs 로 얇게 위임(가드는 별도 파일 — 이 파일이 통째로 스텁으로 덮여도 살아남게)
//   render            --orchestrator <이름> [--block <id>] → 프로파일만 읽어 표식 블록 5개(또는 1개)를 stdout 에(파일 쓰지 않음 · --now 거부)
//   verify            --orchestrator <이름> → SKILL.md(블록 4종)·CLAUDE.md·AGENTS.md(premise) 대조 · stdout WIRED·DECLARED·ASSUMED 3줄
//   assemble          --orchestrator <이름> --provider <id> --tier deep|standard|light --runtime <런타임> → 프로바이더 파라미터 조립
//                     · stdout PROVIDER·MODEL·PARAMS·DROPPED 4줄 · 파일을 쓰지 않는다(v1.8.3 S1 · references/model-profiles.md)
//   place             --orchestrator <이름> [--roster <f>] [--runtime claude|codex] [--agent <이름>] [--verify]
//                     → 팀 구성표의 역할 한 줄에서 티어·모델·강도를 결정 · PLACE·AGENT·RATIONALE·UNMATCHED·FALLBACK · --verify 는 PLACED(v1.8.3 S2)
//   settings          --orchestrator <이름> --set-fallback --runtime <런타임> --root <dir> [--now <ISO>] [--approve]
//                     → <root>/.claude/settings.json 의 fallbackModel 만 키 단위 병합 · SETTINGS·FALLBACK·BACKUP(·NEEDS_APPROVAL) (v1.8.3 S2)
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
// 런타임 후보 — check-review-tools.sh:66 과 **같은 집합**이고 코드포인트 정렬이다(파일 머리말 결정성 규약).
// ⑥ 의 `scanned` 소속 검증도 이 상수를 본다(같은 목록을 두 곳에 적지 않는다).
const RUNTIME_TOOLS = ["agy", "claude", "codex", "gemini"];

const VERSION_RE = {
  claude: /^(\S+) \(Claude Code\)$/,
  codex: /^codex-cli (\S+)$/,
  agy: /^(\d+\.\d+\.\d+\S*)$/,
  // gemini 출력 형식은 **미실측**이다 — agy 와 같은 관대한 패턴을 재사용하고, 어긋나면 probeVersion 이 unknown 을 낸다.
  // **unknown 도 present** 다: 버전 값은 허용 판정에 쓰지 않는다(설치 여부만 본다 · T-I4).
  gemini: /^(\d+\.\d+\.\d+\S*)$/,
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
    // ⚠ 마감은 **자식이 실제로 뜬 뒤**부터 잰다. 전에는 spawn() **앞**에서 걸어 fork/exec 대기와 스케줄 지연까지
    //   예산에 먹었고, 그래서 **아무것도 하지 않는 테스트 스텁**이 스위트 부하만으로 마감에 걸렸다
    //   (v1.8.3 S5 실측: 5085·5170·5071ms — 전부 마감값 근처 · 결과는 `unknown`). 걸리면 조용히 `unknown` 이 되고
    //   그 값이 런타임 스냅샷과 ⑥ 의 `scanned` 로 들어가 **설치된 도구가 허용 목록에서 빠진다**(S3 MED 와 같은 실패형).
    //   자식이 뜨지 않는 경우는 아래 spawn 예외와 error 이벤트가 따로 잡는다.
    const arm = () => { if (!done && timer === null) timer = setTimeout(() => { finish("unknown"); killChild(child); }, DEADLINE_MS); };
    try {
      // execFile 이 아니라 spawn — execFile 은 옵션을 화이트리스트로만 spawn 에 넘겨 `detached` 를 버린다
      // (node 20.17·24.18 실측: execFile+detached 자식의 pgid = 부모 pgid → 그룹 kill 이 ESRCH 로 빗나가 손자가 남았다).
      child = spawn(cmd, args, opts);
      child.on("spawn", arm);
      // 'spawn' 이벤트가 오지 않는 런타임·경로가 있으면 마감이 영영 안 걸린다 — 다음 틱에 보강한다(이중 무장은 arm 이 막는다).
      setImmediate(arm);
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
  const tools = RUNTIME_TOOLS;
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
  catalog_version: 2,
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
    {
      // ⑥ 은 **items 배열 맨 뒤**다 — ITEM_IDS 가 SOURCES·answers 출력 순서이므로 앞에 끼우면 골든이 전부 갈린다.
      // 라벨에 치환 토큰(`{…}`)을 쓰지 않는다: 그러려면 문항 생성 시점에 도구 프로브가 필요한데
      // "questions 는 런타임을 조회하지 않는다" 가 테스트된 계약이자 안전 속성이다(잘못된 입력에 외부 도구를 돌리지 않는다).
      id: "egress", no: "⑥", header: "외부 반출", select: "single",
      prompt: "이 하네스가 다루는 내용을 현재 런타임 밖의 API 로 보내도 되나?",
      options: [
        { key: "runtime-only", label: "현재 런타임만 — 밖으로 보내지 않는다", expose: [] },
        { key: "allow-listed", label: "허용 목록만 — 현재 런타임 + 이미 설치해 쓰는 리뷰어 엔진", expose: [] },
        { key: "any", label: "제한 없음 — 어떤 프로바이더든", expose: [] },
      ],
      default_why: "안전한 쪽: 이미 설치해 쓰는 리뷰어는 반출을 허용한 증거로 보되 그 밖은 막는다 — runtime-only 를 기본에 두면 비대화 생성마다 외부리뷰가 조용히 꺼진다",
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
    case "egress": return ["allow-listed"]; // 안전한 쪽: runtime-only 를 기본에 두면 비대화 생성마다 외부리뷰가 조용히 꺼진다
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
// **egress.scanned 는 넣지 않는다** — ⑥ 은 블록을 만들지 않아 렌더에 들어가는 값이 없고,
// 넣으면 리뷰어를 하나 설치·삭제하는 것만으로 전 블록이 stale 이 되고 factory_version 갱신까지 유발한다(§3-5-1).
function hashFields(id, a) {
  const h = { value: a.value, other: a.other, source: a.source };
  if (id === "assets") h.scanned = a.scanned;
  return h;
}

// **`at` 보존 판정 전용** 비교(§6-1 R28·R29). hashFields 와 같은 규칙의 두 구현이 아니라 **목적이 다른 두 비교**다:
// hashFields 는 "렌더 내용이 같은가"(블록 해시·전제 서명), atFields 는 "출처 기록이 같은가"다.
// ⑥ 은 value 가 같아도 **스냅샷이 바뀌면 답한 시점이 달라진 것**이므로 at 을 갱신해야 한다 —
// 그러지 않으면 "⑥ 을 답한 시점의 스냅샷" 이라는 기록이 거짓이 된다.
function atFields(id, a) {
  const h = hashFields(id, a);
  if (id === "egress") h.scanned = a.scanned;
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

// maintain·update 분기의 stderr 전제 요약. **⑥ 을 답할 수단이 없는 경로라 이 줄이 유일한 사람 대상 신호다** —
// 원본 answers 를 그대로 읽으면 ⑥ 없는 프로파일에서 `assumed=none` 이라는 거짓 보고가 나간다(시나리오 C-8).
function premiseLine(rel, prof) {
  const ans = fillMissing(isObj(prof.answers) ? prof.answers : {}).ans;
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
    // 2차 = **④⑥**. ④ 는 ② 답에 의존해 어차피 2차이고, ⑥ 을 여기 붙여 1차 4문항 상한을 지킨다(§6-1).
    qs = [buildQuestion(ITEM.approval, sc, { value: orderKeys("irreversible", r.keys), other: r.other }), buildQuestion(ITEM.egress, sc, null)];
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
          // ⑥ 은 **질문한다**(이월하지 않는다) — 확장으로 도메인이 바뀌면 반출 가부도 바뀔 수 있다(⑤ assets 와 같은 계열).
          if (id === "irreversible" || id === "assets" || id === "egress") return buildQuestion(ITEM[id], sc, null);
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
  // --only 를 주면 **나열한 것만** 새 답이고 나머지는 전부 기존 프로파일에서 이월한다(--defaults 가 있어도 건드리지 않는다).
  const onlyIds = o.onlyIds;
  const inherits = (id) => extend && (onlyIds !== undefined ? !onlyIds.includes(id) : (id === "completion" || id === "cost"));
  const inheritErr = (where, id) => (onlyIds === undefined
    ? `extend 는 ①③ 을 잇는다 — ${where}에 ${id} 를 줄 수 없다`
    : `--only ${onlyIds.join(",")} 밖의 항목은 그대로 이월한다 — ${where}에 ${id} 를 줄 수 없다`);
  const resolved = new Map();
  for (const [id, toks] of main) {
    const r = resolveItem(id, toks, sc, "답");
    if (inherits(id)) fail2(inheritErr("입력", id));
    resolved.set(id, r);
  }
  const recRes = new Map();
  for (const [id, toks] of rec) {
    const r = resolveItem(id, toks, sc, "--recommended");
    if (inherits(id)) fail2(inheritErr("--recommended", id));
    recRes.set(id, r);
  }
  for (const id of why.keys()) {
    if (!own(ITEM, id)) fail2(`--why: 모르는 항목 키: ${JSON.stringify(id)}`);
    if (inherits(id)) fail2(inheritErr("--why", id));
  }
  // extend 에서 ④ 를 입력하지 않으면 기존 ④ 를 그대로 옮긴다 — 옮기는 항목에 추천·근거를 새로 달 곳이 없다.
  const carryApproval = extend && !main.has("approval");
  if (carryApproval && (recRes.has("approval") || why.has("approval"))) fail2("extend 에서 ④ 를 옮길 때(입력에 approval 없음)는 --recommended·--why 에 approval 을 줄 수 없다");

  // ⑤ 의미. 유효 ② = 입력 ② → (--defaults 면) 기본 ② → 없으면 null(⑥ 에서 rc=2).
  const irrOpts = deriveOptions(ITEM.irreversible, sc, null);
  let irrEff = null;
  if (resolved.has("irreversible")) { const r = resolved.get("irreversible"); irrEff = { value: orderKeys("irreversible", r.keys), other: r.other }; }
  // --only 로 ② 를 재답하지 않았으면 **이월된 ②** 가 유효값이다. 기본값을 쓰면 ④ 의 before: 키 검사가
  // 답을 바꾸지도 않았는데 rc=1 로 죽는다(--only 의 목적은 건드리지 않는 것이다).
  else if (extend && onlyIds !== undefined && !onlyIds.includes("irreversible") && existing !== null) {
    const c = carriedItem(existing.obj, "irreversible", p.file);
    irrEff = { value: Array.isArray(c.value) ? c.value : [], other: c.other === undefined ? null : c.other };
  }
  else if (o.defaults) irrEff = { value: defaultOf(ITEM.irreversible, irrOpts), other: null };
  for (const id of ITEM_IDS) if (resolved.has(id)) checkSemantics(resolved.get(id), irrEff, "답");
  for (const id of ITEM_IDS) if (recRes.has(id)) checkSemantics(recRes.get(id), irrEff, "--recommended");
  let carriedAnswers = null;
  if (extend) {
    carriedAnswers = {};
    const carryIds = onlyIds !== undefined
      ? ITEM_IDS.filter((id) => !onlyIds.includes(id))                       // --only: 나열 밖 **전부** 이월
      : ["completion", "cost", ...(carryApproval ? ["approval"] : [])];
    for (const id of carryIds) carriedAnswers[id] = carriedItem(existing.obj, id, p.file);
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

  // **안전망(§6-4-0)** — 동작을 바꾸지 않고 알리기만 한다. `--defaults` 의 의미를 바꾸면 비대화 경로의 기존 계약이 흔들린다.
  if (extend && o.defaults && onlyIds === undefined && existing !== null && isObj(existing.obj.answers)) {
    const dec = ITEM_IDS.filter((id) => isObj(existing.obj.answers[id]) && existing.obj.answers[id].source === "declared");
    if (dec.length) err += `WARN: extend + --defaults 는 선언 답 ${dec.length}개를 기본값으로 덮는다 — --only <id> 를 쓰라\n`;
  }

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
    // ⑥ 스냅샷 = **그 시점 내부 재스캔**에서 present 인 도구(absent 아님). 코드포인트 정렬 · 새 프로브를 돌리지 않는다.
    if (id === "egress") a.scanned = uniqSorted(Object.keys(runtime).filter((t) => runtime[t] !== "absent"));
    const old = exAns[id];
    if (isObj(old) && typeof old.at === "string" && canon(atFields(id, a)) === canon(atFields(id, old))) a.at = old.at; // 같은 값 재기록 → at 불변(egress 는 scanned 까지 같아야 한다)
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

  // ⑥ 은 블록을 만들지 않아 허용 목록이 사람 눈에 닿는 지점이 0 이었다(시나리오 B-3).
  // 내부 재스캔이 이미 가진 값이라 새 실행 비용이 없고, PROFILE:·SOURCES: 와 같은 `KEY: value` 규약이다.
  const sn = answers.egress.scanned;
  const out = `PROFILE: ${rel}\nSOURCES: ${ITEM_IDS.map((id) => `${id}=${answers[id].source}`).join(" ")}\n`
    + `SCANNED: egress=${sn.length ? sn.join(" ") : "none"}\n`;
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
// **부재 항목 채움 — 대상은 ⑥ 하나뿐이다.** 기존 다섯이 없으면 "아직 안 생긴 항목" 이 아니라
// 사람이 지웠거나 파일이 깨진 것이고, 자동 복구는 손상을 조용히 덮는다(부재≠손상 · §6-4).
// **원본을 변형하지 않는다**(새 객체) — render·verify 는 파일도 메모리도 쓰지 않는 것이 계약이다.
const FILLABLE = ["egress"];
function fillMissing(src) {
  const ans = { ...src };
  const filled = [];
  for (const id of FILLABLE) {
    if (isObj(ans[id])) continue;
    const item = ITEM[id];
    // 채운 항목의 at = **프로파일에 실재하는 항목별 at 중 최신값**. render·verify 는 --now 를 받지 않으므로
    // 파일에서만 유도해야 "같은 프로파일 → 바이트 동일" 이 유지된다(§6-4).
    const ats = ITEM_IDS.map((x) => (isObj(ans[x]) && typeof ans[x].at === "string" ? ans[x].at : null)).filter((x) => x !== null);
    const def = defaultOf(item, item.options.map((o) => o.key));
    ans[id] = {
      value: def, source: "assumed", at: uniqSorted(ats).pop() ?? "1970-01-01T00:00:00Z",
      default: def, recommended: [], why: null, options_incomplete: false, other: null,
    };
    filled.push(id);
  }
  return { ans, filled };
}

function normalizeAnswers(prof, file) {
  if (!isObj(prof.answers)) fail2(`프로파일에 answers 가 없다: ${file}`);
  const { ans, filled } = fillMissing(prof.answers);
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
    // ⑥ 은 **같은 규약, 다른 모양**(평평한 배열)이다. **부재는 손상이 아니다** — 블록을 만들지 않아 렌더에 쓰이지 않고
    // egress 서브커맨드가 현재 스캔으로 폴백한다(§6-4). 있는데 깨졌으면 rc=2.
    if (id === "egress" && own(a, "scanned")) {
      const rev = ` — harness-profile.prev.json 을 되돌린다(1세대만 보관)`;
      if (!Array.isArray(a.scanned) || a.scanned.some((x) => typeof x !== "string")) fail2(`${w}.scanned 가 문자열 배열이 아니다(손상): ${file}${rev}`);
      if (a.scanned.some((x) => CTRL_RE.test(x))) fail2(`${w}.scanned 이름에 제어 문자(탭 외 C0·DEL — 손상): ${file}${rev}`);
      // **정렬·중복·소속까지 본다(S3 R1 codex MED).** `assets.scanned` 는 이름이 임의(에이전트·스킬)라 소속을 볼 수 없지만
      // ⑥ 은 **닫힌 집합**(runtimeValues 후보)이라 검증이 가능하다. 특히 **모르는 이름은 조용히 무시돼 허용 목록을 좁힌다** —
      // 오타 하나로 리뷰어가 사라지는데 아무 신호가 없다. drop 오타를 rc=2 로 막는 것과 같은 계열이다.
      if (canon(a.scanned) !== canon(uniqSorted(a.scanned))) fail2(`${w}.scanned 가 코드포인트 정렬·중복 없음이 아니다(손상 — answer 는 항상 정렬해 쓴다): ${file}${rev}`);
      const bad = a.scanned.filter((x) => !RUNTIME_TOOLS.includes(x));
      if (bad.length) fail2(`${w}.scanned 에 모르는 도구 이름(조용히 무시되면 허용 목록이 좁아진다): ${bad.join(",")}(${RUNTIME_TOOLS.join("|")}) — ${file}${rev}`);
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
  return { ans, filled };
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
// **보정본을 인자로 받는다**(안에서 다시 정규화하지 않는다) — render 와 verify 가 같은 출력 하나를 보게 하는 장치다(§6-4-1).
function renderBlocks(ans, factory_version, rel, file) {
  const cv = CATALOG.catalog_version;
  const hf = (id) => hashFields(id, ans[id]);
  const out = new Map();
  const put = (id, extra, inner) => out.set(id, { hash: sha256hex(canon({ block: id, catalog_version: cv, ...extra })), inner });

  put("completion", { completion: hf("completion") }, valueLines("completion", ans.completion));

  const irr = ans.irreversible;
  const rules = [];
  // **표시 어휘와 기계 키를 병기한다**(시나리오 C-6) — 런처는 기계 키(`critical`·`standard`·`light`)를 요구하는데
  // 블록이 표시 어휘만 내면 그 값을 그대로 옮긴 사람이 첫 게이트에서 die_launcher 를 맞는다.
  if (!isNoneIrr(irr)) rules.push(`단계 산출물이 비가역 목록에 닿는다 → 중대(critical) — 비가역: ${inlineValues("irreversible", irr, true)}`);
  rules.push("계약 변경·다도메인(SKILL.md 5-6 표) → 중대(critical)", "다파일·기능 추가 → 표준(standard)", "그 밖 → 경량(light)");
  const tier = ["단계 등급은 아래를 위에서부터 적용해 처음 맞는 것으로 정한다.", ...rules.map((r, i) => `${i + 1}. ${r}`)];
  if (ans.cost.value.includes("error-worse")) tier.push("하한: 실패 비용 = 오류 우선 → 코드·설계 단계는 최소 표준(standard)");
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
  const fv = factory_version;
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
  // **normalizeAnswers 를 1회만** 부른다 — 블록 해시와 ASSUMED: 가 서로 다른 답을 근거로 계산되는 경로가 구조적으로 사라진다.
  const { ans, filled } = normalizeAnswers(prof.obj, p.file);
  return { p, rel, prof: prof.obj, ans, filled, blocks: renderBlocks(ans, prof.obj.factory_version, rel, p.file) };
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
  const { p, ans, blocks } = loadForS3(o, ctx);
  const skill = readTarget(path.join(p.dir, "SKILL.md"));
  const claude = readTarget(path.join(ctx.root, "CLAUDE.md"));
  const agents = readTarget(path.join(ctx.root, "AGENTS.md"));
  const inPremise = (s) => s !== null && s.startsWith(PREMISE_SECTION);
  const w = [];
  for (const id of BLOCK_IDS.slice(0, 4)) w.push([id, judgeBlock(id, skill, blocks.get(id), (s) => s === SECTION_OF[id])]);
  w.push(["premise.claude", judgeBlock("premise", claude, blocks.get("premise"), inPremise)]);
  w.push(["premise.agents", agents.state === "absent" ? "na" : judgeBlock("premise", agents, blocks.get("premise"), inPremise)]);
  // **보정본**을 쓴다 — 원본을 보면 ⑥ 없는 프로파일에서 ans[id].source 접근이 TypeError 로 죽는다(§6-4-1).
  const dated = (src) => {
    const ids = ITEM_IDS.filter((id) => ans[id].source === src);
    return ids.length ? ids.map((id) => `${id}(${ans[id].at.slice(0, 10)})`).join(" ") : "none";
  };
  const out = `WIRED: ${w.map(([k, v]) => `${k}=${v}`).join(" ")}\nDECLARED: ${dated("declared")}\nASSUMED: ${dated("assumed")}\n`;
  return { rc: w.some(([, v]) => v !== "ok" && v !== "na") ? 1 : 0, out, err: "" };
}

// ───────────────────────── S4(v1.8.3): 모델 프로파일 · assemble ─────────────────────────
// 계약 단일 출처: docs/v1.8.3/design/model-aware-harness-design.md §2-1(경로)·§2-2(스키마)·§3-1(인자·rc)·§3-4(조립·출력).
// **정본은 모델을 모른다** — 프로바이더·티어·파라미터는 전부 데이터 파일이 갖는다(MA2: 프로바이더 추가 = 파일 1개 편집, 코드 diff 0).

const MODEL_PROFILES_SCHEMA = "model-profiles/1";
const TIERS = ["deep", "standard", "light"];

// 데이터 파일은 **SELF 상대 고정**이다(§2-1) — 이 스크립트와 함께 배달되는 정본이라 심링크로 실행해도 실경로로 풀린다.
// `--root` 로 찾는 **인터뷰 프로파일과 경로 규칙이 다르다**(그쪽은 대상 레포의 것 · profilePaths).
// env 노브는 두지 않는다 — 정책 입력을 env 로 열면 호출자가 fail-closed 를 우회한다(설계서 §0-7 c).
const modelProfilesPath = () => path.join(path.dirname(SELF), "..", "references", "model-profiles.json");

// 데이터 파일 로더 + 선사용 차단. `place`(S2)·`egress`(S3) 도 이 함수를 쓴다 — 같은 규칙의 두 구현을 만들지 않는다.
// **로더를 두 층으로 나눈다(§2-1 경계 · T-P2).** 생성 하네스가 읽는 것은 `tools`·`runtime_provider`·`review_tiers` 뿐이고
// `providers`·`placement` 는 **팩토리 실행에서만** 읽힌다. 한 로더가 전부를 요구하면 그 경계가 코드에 존재하지 않는다 —
// `egress` 는 얇은 층만, `place`·`assemble` 은 두꺼운 층까지 요구한다.
function loadModelProfilesThin() {
  const file = modelProfilesPath();
  let raw;
  try { raw = fs.readFileSync(file, "utf8"); }
  catch (e) { fail2(`모델 프로파일 읽기 실패: ${file} (${e.code || e.message})`); }
  let mp;
  try { mp = JSON.parse(raw.replace(/^\uFEFF/, "")); }
  catch (e) { fail2(`모델 프로파일 JSON 오류: ${file} (${e.message})`); }
  if (!isObj(mp) || mp.schema !== MODEL_PROFILES_SCHEMA) fail2(`모델 프로파일 스키마 불일치(schema !== "${MODEL_PROFILES_SCHEMA}"): ${file}`);
  if (!isObj(mp.runtime_provider) || Object.keys(mp.runtime_provider).length === 0) fail2(`모델 프로파일에 runtime_provider 가 없다: ${file}`);
  return { mp, file };
}

/** 팩토리 실행용 — `providers`·`placement` 와 예약 슬롯 선사용 차단까지 요구한다(`place`·`assemble`). */
function loadModelProfiles() {
  const { mp, file } = loadModelProfilesThin();
  if (!isObj(mp.providers) || Object.keys(mp.providers).length === 0) fail2(`모델 프로파일에 providers 가 없다: ${file}`);
  // 예약 슬롯 선사용 차단(§2-2) — 값이 들어오면 **미검증 기능이 조용히 배포**된다. 뒤 릴리스가 열 자리다.
  if (!isObj(mp.behavior) || Object.keys(mp.behavior).length !== 0) fail2(`behavior 는 이 릴리스에서 빈 객체여야 한다(L3 슬롯 예약 · MA5 는 ADR-002 뒤): ${file}`);
  for (const id of Object.keys(mp.providers).sort(cpCompare)) {
    const p = mp.providers[id];
    if (!isObj(p)) fail2(`providers.${id} 가 객체가 아니다: ${file}`);
    if (!isObj(p.local)) fail2(`providers.${id}.local 이 객체가 아니다: ${file}`);
    for (const k of Object.keys(p.local).sort(cpCompare)) {
      if (p.local[k] !== null) fail2(`providers.${id}.local.${k} 는 이 릴리스에서 null 이어야 한다(로컬 호스팅은 범위 밖 · MA2 슬롯): ${file}`);
    }
  }
  return { mp, file };
}

// 점 표기 경로에 값을 얹는다 — `reasoning.effort` → {"reasoning":{"effort":…}}.
// 중간 마디가 객체가 아니면 rc=2: 파라미터를 조용히 덮어써 **다른 요청이 나가는 것**을 막는다.
function setDotted(obj, dotted, value, file, id) {
  const segs = dotted.split(".");
  if (segs.some((s) => s === "")) fail2(`providers.${id}.effort_field 의 점 표기가 비어 있다: ${JSON.stringify(dotted)} (${file})`);
  // `__proto__` 는 일반 키가 아니다 — `obj["__proto__"] = v` 는 **키를 만들지 않고 프로토타입을 건드린다**.
  // 그대로 두면 rc=0 인데 PARAMS 에 추론 강도가 없다(조용한 MA2 위반 · S1 R1 양 엔진 HIGH).
  if (segs.includes("__proto__")) fail2(`providers.${id}.effort_field 에 __proto__ 마디를 쓸 수 없다: ${JSON.stringify(dotted)} (${file})`);
  let cur = obj;
  for (let i = 0; i < segs.length - 1; i++) {
    const s = segs[i];
    if (!Object.hasOwn(cur, s)) cur[s] = {};
    else if (!isObj(cur[s])) fail2(`effort_field 경로가 params 와 충돌한다(providers.${id}.params.${segs.slice(0, i + 1).join(".")} 가 객체가 아니다): ${file}`);
    cur = cur[s];
  }
  cur[segs[segs.length - 1]] = value;
}

/** 조립 코어 — `assemble` 과 `place` 가 **같은 함수**를 부른다(같은 규칙의 두 구현 금지 · §3-1 · S1 결과서 「다음 단계 참조」). */
function assembleFor(mp, file, providerId, tier) {
  const prov = mp.providers[providerId];
  const tierObj = isObj(prov.tiers) && isObj(prov.tiers[tier]) ? prov.tiers[tier] : undefined;
  if (tierObj === undefined) fail2(`providers.${providerId}.tiers.${tier} 가 없다: ${file}`);

  const effort = tierObj.effort;
  if (typeof effort !== "string" || effort === "") fail2(`providers.${providerId}.tiers.${tier}.effort 가 비었다: ${file}`);
  const forbidden = Array.isArray(prov.effort_forbidden) ? prov.effort_forbidden : fail2(`providers.${providerId}.effort_forbidden 이 배열이 아니다: ${file}`);
  // **MA3 — 금지값은 멈춘다.** 한 단계 올려 통과시키면(하한 클램프) 데이터 결함이 조용히 배포된다(PRD §3 제약 4).
  if (forbidden.includes(effort)) fail2(`MA3 — tiers.${tier}.effort 가 금지값이다(providers.${providerId}.effort_forbidden): ${effort}`);
  const vocab = Array.isArray(prov.effort_vocab) ? prov.effort_vocab : fail2(`providers.${providerId}.effort_vocab 이 배열이 아니다: ${file}`);
  // S1 결정(S0 이월 · 결과서 §5-3) — 어휘에도 금지목록에도 없는 **오타값**은 모든 검사를 통과한 뒤 그대로 프로바이더로 나간다.
  if (!vocab.includes(effort)) fail2(`tiers.${tier}.effort 가 effort_vocab 에 없다(providers.${providerId}): ${effort}(${vocab.join("|")})`);

  const ef = prov.effort_field;
  if (typeof ef !== "string" || ef === "") fail2(`providers.${providerId}.effort_field 가 비었다: ${file}`);
  if (!isObj(prov.params)) fail2(`providers.${providerId}.params 가 객체가 아니다: ${file}`);
  const drop = prov.drop;
  if (!Array.isArray(drop) || drop.some((k) => typeof k !== "string")) fail2(`providers.${providerId}.drop 이 문자열 배열이 아니다: ${file}`);

  // 조립 순서(§3-4): ① params 복사 → ② effort_field 얹기 → ③ drop 제거.
  // 순서 자체는 **관측 불가능**하다 — 아래 명시 가드(drop 이 effort_field 를 제거 → rc=2)가 순서보다 먼저 걸리기 때문이다.
  // 합법 입력 588조합 전수에서 두 순서의 결과가 다른 조합은 0 이다(설계서 §3-4 정정 · S1 결과서). 이 순서는 **읽는 사람의 모델**을 위한 것이고,
  // 안전을 지키는 것은 가드 두 개와 아래 되읽기 사후조건이다.
  const params = JSON.parse(JSON.stringify(prov.params));
  const head = ef.split(".")[0];
  setDotted(params, ef, effort, file, providerId);

  const dropped = [];
  for (const k of drop) {
    // 추론 강도를 빼는 것은 MA2 위반이다 — 점 표기면 첫 마디도 같은 키다.
    if (k === ef || k === head) fail2(`MA2 위반 — drop 이 effort_field 를 제거한다(providers.${providerId}.drop): ${k}`);
    // **선언만 하고 아무것도 못 빼는 drop 은 rc=2** — 오타가 조용히 무효가 되면 "뺐다" 를 검증할 수 없다(§3-4).
    if (!Object.hasOwn(params, k)) fail2(`drop 이 제거할 것이 없다(params 에 없는 키 · providers.${providerId}.drop): ${k}`);
    delete params[k];
    dropped.push(k);
  }

  // **되읽기 사후조건.** 조립이 끝난 뒤 `effort_field` 경로에 그 값이 실제로 있는지 확인한다.
  // 위 두 가드(__proto__ · drop)가 막지 못한 새 경로로 추론 강도가 사라져도 여기서 멈춘다 —
  // "조립했다" 는 rc=0 인데 보낼 것에 강도가 없는 상태를 통과시키지 않는다(MA2).
  let cur = params;
  for (const seg of ef.split(".")) {
    if (!isObj(cur) || !Object.hasOwn(cur, seg)) cur = undefined;
    else cur = cur[seg];
    if (cur === undefined) break;
  }
  if (cur !== effort) fail2(`조립 결과에 effort_field 값이 없다(providers.${providerId}.effort_field=${ef}) — 조립이 추론 강도를 잃었다: ${file}`);

  // pinned_id 는 사람이 명시할 때만 있다(§2-2) — 없으면 family_alias. 문자열 유효성은 검증하지 않는다(T-P7 · 실패 판정은 probe 몫).
  const pinned = tierObj.pinned_id;
  const model = typeof pinned === "string" && pinned !== "" ? pinned : tierObj.family_alias;
  if (typeof model !== "string" || model === "") fail2(`providers.${providerId}.tiers.${tier}.family_alias 가 비었다: ${file}`);

  return { model, effort, params, dropped };
}

function cmdAssemble(o, ctx) {
  const { mp, file } = loadModelProfiles();

  // 대상 하네스 확인(§3-1 fail-loud). 이 서브커맨드는 **파일을 쓰지 않지만**, 엉뚱한 --root 를 그대로 진행하면
  // "조립됐다" 는 결과만 남고 어느 하네스의 것인지 알 수 없다. S3 의 egress 강제 ① 도 이 프로파일을 읽는다.
  const pp = profilePaths(ctx, o.orchestrator);
  const aProf = readProfile(pp.file);
  if (aProf === null) fail2(`하네스 프로파일이 없다: ${pp.file} (--root·--orchestrator 확인)`);

  if (!Object.hasOwn(mp.runtime_provider, o.runtime)) {
    failUsage(`--runtime 이 runtime_provider 에 없다: ${o.runtime}(${Object.keys(mp.runtime_provider).sort(cpCompare).join("|")})`);
  }
  if (!Object.hasOwn(mp.providers, o.provider)) {
    failUsage(`--provider 가 데이터 파일에 없다: ${o.provider}(${Object.keys(mp.providers).sort(cpCompare).join("|")})`);
  }
  // **egress 강제 ①** — `runtime-only` 면 **현재 런타임의 프로바이더만** 조립할 수 있다(§6-3 · T-E1).
  // 판정 축이 --runtime 이므로 같은 --provider 라도 런타임이 바뀌면 결과가 뒤집힌다(고정값 구현을 배제한다).
  if (egressAnswer(aProf.obj, pp.file).key === "runtime-only" && o.provider !== mp.runtime_provider[o.runtime]) {
    fail2(`egress 위반: ${o.provider} — ⑥ 이 runtime-only 인데 현재 런타임(${o.runtime} → ${mp.runtime_provider[o.runtime]}) 밖의 프로바이더를 조립하려 한다`);
  }

  const { model, params, dropped } = assembleFor(mp, file, o.provider, o.tier);

  // soft_switch 는 읽지 않는다(§3-4 R6 MED-1 · MA6 는 PRD §5 비목표) — `SOFT_SWITCH:` 줄도 만들지 않는다. T-D3 가 기계로 고정한다.
  const out = `PROVIDER: ${o.provider}\nMODEL: ${model}\nPARAMS: ${canon(params)}\n`
    + `DROPPED: ${dropped.length ? dropped.slice().sort(cpCompare).join(" ") : "none"}\n`;
  return { rc: 0, out, err: "" };
}


// ── S4(v1.8.3) S3: egress — 반출 정책을 허용 도구 집합으로 번역한다(§3-5·§3-5-1) ──

const GRADES = ["critical", "light", "standard"];
const EGRESS_KEYS = ["allow-listed", "any", "runtime-only"];

/** ⑥ 답 + 스냅샷을 읽는다. 없으면 기본값으로 채우고 **왜 채웠는지**를 함께 돌려준다(부재≠손상 · §6-4). */
function egressAnswer(prof, file) {
  const { ans, filled } = normalizeAnswers(prof, file);
  const a = ans.egress;
  const key = a.value[0];
  // 손상이라 rc=2 다(위 normalizeAnswers 의 labelOf 검사가 보통 먼저 잡는다 — 이것은 두 번째 방어선이다).
  if (!EGRESS_KEYS.includes(key)) fail2(`프로파일 ⑥ egress 값이 카탈로그 밖이다(손으로 고친 프로파일 · answer 로 다시 기록한다): ${JSON.stringify(key)}(${EGRESS_KEYS.join("|")})`);
  // note 조건은 **"항목 부재" 가 아니라 source === "assumed"** 다(시나리오 B-2) — `--defaults` 무응답도 같은 대우를 받는다.
  // 그러지 않으면 "사람이 한 번도 승인하지 않은 반출 허용" 이 선언분과 똑같이 중대 게이트를 통과한다.
  const missing = filled.includes("egress");
  return { key, scanned: Array.isArray(a.scanned) ? a.scanned : null, assumed: a.source === "assumed", missing };
}

async function cmdEgress(o, ctx) {
  const { mp, file } = loadModelProfilesThin();   // 생성 하네스가 읽는 키만 요구한다(§2-1 · T-P2)
  const pp = profilePaths(ctx, o.orchestrator);
  const prof = readProfile(pp.file);
  if (prof === null) fail2(`하네스 프로파일이 없다: ${pp.file} — answer 로 먼저 만든다(--root·--orchestrator 확인)`);
  if (!Object.hasOwn(mp.runtime_provider, o.runner)) {
    failUsage(`--runner 가 runtime_provider 에 없다: ${o.runner}(${Object.keys(mp.runtime_provider).sort(cpCompare).join("|")})`);
  }
  if (!isObj(mp.tools) || Object.keys(mp.tools).length === 0) fail2(`데이터 파일에 tools 매핑이 없다: ${file}`);
  // 후보 4종의 단일 출처는 check-review-tools.sh 다 — 그 목록을 **파싱해** 대조한다(세 번째 구현을 만들지 않는다).
  // **양방향으로 본다(S3 R3 codex MED).** 빠진 것만 막으면 **데이터 파일이 도구를 늘렸을 때 허용 목록이 조용히 넓어진다** —
  // `any` 는 그 이름을 그대로 담고 `allow-listed` 도 같은 프로바이더면 담는다. 반출 경계를 정하는 파일에서
  // "늘어난 것" 이 무신호로 통과하면 ⑥ 이 약속한 경계가 데이터 편집 한 줄로 넓어진다.
  const cand = reviewToolCandidates();
  const miss = cand.filter((t) => !Object.hasOwn(mp.tools, t));
  if (miss.length) fail2(`tools 매핑에 후보 도구가 없다: ${miss.join(",")} — check-review-tools.sh 의 후보와 같아야 한다(${file})`);
  const extra = Object.keys(mp.tools).filter((t) => !cand.includes(t)).sort(cpCompare);
  if (extra.length) fail2(`tools 매핑에 후보 밖 도구가 있다(허용 목록이 조용히 넓어진다): ${extra.join(",")} — check-review-tools.sh 의 후보(${cand.join(",")})와 **같은 집합**이어야 한다(${file})`);

  const e = egressAnswer(prof.obj, pp.file);
  const runnerProvider = mp.runtime_provider[o.runner];
  // 스냅샷이 **있으면 재스캔하지 않는다** — 스냅샷이 스냅샷인 이유다. 없으면 그때만 현재 스캔으로 폴백하고 rc=0
  // (구 하네스의 리뷰 게이트를 죽이지 않는다 · R11-A).
  let snap = e.scanned;
  if (snap === null) snap = uniqSorted((await runtimeValues()).filter(([, v]) => v !== "absent").map(([t]) => t));

  // **허용은 프로바이더 단위다** — scanned 에 agy 만 있어도 google 이 허용되므로 gemini 도 들어간다.
  // 같은 회사로 같은 내용을 보내는 두 경로를 다르게 취급하는 것이 오히려 허점이다.
  const provOf = (t) => (Object.hasOwn(mp.tools, t) ? mp.tools[t] : null);
  let providers;
  if (e.key === "any") providers = new Set(Object.values(mp.tools));
  else if (e.key === "runtime-only") providers = new Set([runnerProvider]);
  else providers = new Set([runnerProvider, ...snap.map(provOf).filter((x) => x !== null)]);
  const allowed = uniqSorted(Object.keys(mp.tools).filter((t) => providers.has(mp.tools[t])));
  // 러너 도구가 반드시 들어가므로 빌 수 없다 — 비면 tools/runtime_provider 데이터 결함이다.
  if (allowed.length === 0) fail2(`허용 집합이 비었다(러너 도구가 tools 에 없다 — 데이터 결함): ${file}`);
  const reviewers = allowed.filter((t) => t !== o.runner);   // 러너 엔진은 리뷰어 자격이 없다(독립성)

  let mc = "none", ma = "none";
  if (o.grade !== undefined) {
    const rt = mp.review_tiers;
    if (!isObj(rt) || !isObj(rt[o.grade])) fail2(`review_tiers.${o.grade} 가 없다: ${file}`);
    // 계약 줄의 어휘는 **모델 ID 또는 `none`** 이다(§3-5). 데이터 파일은 같은 뜻을 `runtime-default` 로 적으므로
    // **여기서 번역한다** — 그러지 않으면 셸이 데이터 파일 어휘까지 알아야 하고(두 번째로 아는 곳),
    // 실제로 `codex exec -m runtime-default` 라는 없는 모델명이 리뷰어에게 넘어갔다(S4 실측).
    const pick = (k) => {
      const v = rt[o.grade][k];
      return typeof v === "string" && v !== "" && v !== "runtime-default" ? v : "none";
    };
    mc = pick("codex"); ma = pick("agy");
  }

  // stderr note — 접두 `note: ` 고정 · 줄바꿈 없음 · **문구는 egress 가 소유한다**(호출자가 조립하지 않는다).
  let err = "";
  if (e.assumed) {
    err = e.missing
      ? "note: egress 는 assumed(구 프로파일 · 스냅샷 없음 → 현재 스캔)\n"
      : "note: egress 는 assumed(무응답 기본값 · 사람이 승인한 적 없다)\n";
  }
  const out = `EGRESS: ${e.key}\nALLOWED_TOOLS: ${allowed.join(" ")}\n`
    + `REVIEWERS_ALLOWED: ${reviewers.length ? reviewers.join(" ") : "none"}\n`
    + `REVIEW_MODEL_CODEX: ${mc}\nREVIEW_MODEL_AGY: ${ma}\n`;
  return { rc: 0, out, err };
}

/** check-review-tools.sh 의 후보 목록을 **파싱**한다 — 목록을 여기 다시 적으면 세 번째 구현이 된다(§8-1 과 같은 규약). */
function reviewToolCandidates() {
  const f = path.join(path.dirname(SELF), "check-review-tools.sh");
  let txt;
  try { txt = fs.readFileSync(f, "utf8"); }
  catch (e) { fail2(`후보 도구 목록을 읽지 못했다: ${f} (${e.code || e.message})`); }
  const m = txt.match(/^for t in ([a-z0-9 _-]+); do$/m);
  if (m === null) fail2(`${f} 에서 후보 도구 목록(for t in …; do)을 찾지 못했다`);
  return trimWs(m[1]).split(/\s+/);
}

// ── S2(v1.8.3): 팀 구성표 · place · place --verify ──
// 계약 단일 출처: 설계서 §3-2(roster) · §3-3(place) · §3-3-1(--verify) · §4(MA7 매핑).

const ROSTER_SCHEMA = "team-roster/1";
const ROSTER_MODES = ["hybrid", "sub", "team"];
const RUN_KINDS = ["orchestrator", "sub-oneshot", "teammate"];
const MULTITURN = ["orchestrator", "teammate"];        // 나머지(sub-oneshot)는 단발 — §3-2
// 제어문자 검사는 기존 CTRL_RE(:774 · 탭 외 C0 + DEL)를 그대로 쓴다 — 같은 규칙의 두 상수를 만들지 않는다.
// §4-1 기본 티어. **성격별 정책**이라 프로바이더와 무관하고, 데이터 파일 `placement` 는 keywords·priority·boundary
// 셋만 갖는다(§2-2). 경계 행(build+단발 · 매칭 없음)만 데이터가 정한다. priority 에 있는 성격인데 여기 없으면 rc=2 —
// 성격이 늘었는데 티어 정책이 비어 조용히 떨어지면 배치가 사라진 줄 모른다.
const BASE_TIER = { build: "deep", collect: "light", design: "deep", docs: "standard", judge: "deep", orchestrate: "standard" };

const rosterPath = (ctx, orch) => path.join(profilePaths(ctx, orch).dir, "team-roster.json");
// --root 상대 경로를 **POSIX 구분자**로 낸다 — 출력이 OS 마다 달라지면 결정성 단정이 windows 에서만 깨진다.
const relOf = (ctx, p) => path.relative(ctx.root, p).split(path.sep).join("/");
// session_fallback 직렬화는 **함수 하나**다 — place 와 settings 가 같은 값을 내야 한다(T-S3).
function fallbackChain(mp, file) {
  const fb = mp.session_fallback;
  if (!Array.isArray(fb) || fb.length === 0 || fb.some((x) => typeof x !== "string" || x === "")) {
    fail2(`session_fallback 이 비지 않은 문자열 배열이 아니다: ${file}`);
  }
  return fb.join(",");
}

function readRoster(file) {
  let raw;
  try { raw = fs.readFileSync(file, "utf8"); }
  catch (e) {
    if (e.code === "ENOENT") fail2(`팀 구성표가 없다: ${file} — Phase 2-5 로 team-roster.json 을 만든다`);
    fail2(`팀 구성표 읽기 실패: ${file} (${e.code || e.message})`);
  }
  let r;
  try { r = JSON.parse(raw.replace(/^﻿/, "")); }
  catch (e) { fail2(`팀 구성표 JSON 오류: ${file} (${e.message})`); }
  if (!isObj(r)) fail2(`팀 구성표 최상위가 객체가 아니다: ${file}`);
  // 여기서부터는 **내용 판정**이라 rc=1 이다 — 파일은 읽혔다(§3-3 rc 분할).
  if (r.schema !== ROSTER_SCHEMA) fail1(`팀 구성표 schema 가 "${ROSTER_SCHEMA}" 가 아니다: ${JSON.stringify(r.schema)}`);
  if (!ROSTER_MODES.includes(r.mode)) fail1(`mode 가 ${ROSTER_MODES.join("|")} 가 아니다: ${JSON.stringify(r.mode)}`);
  if (!Array.isArray(r.agents) || r.agents.length === 0) fail1(`agents 가 비지 않은 배열이 아니다: ${file}`);
  const seen = new Set();
  for (const a of r.agents) {
    if (!isObj(a)) fail1(`agents 항목이 객체가 아니다: ${file}`);
    if (typeof a.name !== "string" || !ORCH_RE.test(a.name)) fail1(`agents[].name 이 ${ORCH_RE.source} 가 아니다: ${JSON.stringify(a.name)}`);
    if (seen.has(a.name)) fail1(`agents[].name 이 중복이다: ${a.name}`);
    seen.add(a.name);
    // role 은 MA7 키워드 매칭의 입력이자 근거 주석에 실린다 — 제어문자가 들어오면 정의 파일 한 줄이 깨진다.
    if (typeof a.role !== "string" || trimWs(a.role) === "") fail1(`agents[${a.name}].role 이 비어 있다`);
    if (CTRL_RE.test(a.role)) fail1(`agents[${a.name}].role 에 제어문자가 있다(근거 주석은 한 줄이다)`);
    if (!RUN_KINDS.includes(a.run)) fail1(`agents[${a.name}].run 이 ${RUN_KINDS.join("|")} 가 아니다: ${JSON.stringify(a.run)}`);
    if (a.placed !== undefined && typeof a.placed !== "boolean") fail1(`agents[${a.name}].placed 가 불리언이 아니다`);
    if (a.tier_override !== undefined) {
      if (!TIERS.includes(a.tier_override)) fail1(`agents[${a.name}].tier_override 가 ${TIERS.join("|")} 가 아니다: ${JSON.stringify(a.tier_override)}`);
      // **근거 없는 수동 배치 금지**(§3-2) — override 는 --verify 의 기대값을 바꾸므로 사유가 파일에 남아야 한다.
      if (typeof a.tier_override_why !== "string" || trimWs(a.tier_override_why) === "") {
        fail1(`agents[${a.name}] 에 tier_override_why 가 없다(근거 없는 수동 배치 금지)`);
      }
      if (CTRL_RE.test(a.tier_override_why)) fail1(`agents[${a.name}].tier_override_why 에 제어문자가 있다`);
    }
    // C-2 — 오케스트레이터는 스킬이라 정의 파일이 없다. placed:true 로 두면 전원 missing 으로 Phase 6 이 막힌다.
    if (a.run === "orchestrator" && a.placed !== false) {
      fail1(`agents[${a.name}] 은 run=orchestrator 인데 placed 가 false 가 아니다(오케스트레이터는 정의 파일이 없다 — C-2)`);
    }
  }
  return r;
}

// §4-2 — 소문자화 + 연속 공백 1칸. **유니코드 정규화는 하지 않는다**(§12 미결 — 보이지 않는 변형을 같은 키로 만들지 않는다).
const normRole = (role) => trimWs(String(role).toLowerCase().replace(/\s+/g, " "));

/** 걸린 성격과 그 성격의 키워드들. 겹치면 placement.priority 순서가 이긴다(§4-2 규칙 3). 정규식이 아니라 부분 문자열이다. */
function matchTrait(mp, role, file) {
  const pl = mp.placement;
  if (!isObj(pl) || !Array.isArray(pl.priority) || !isObj(pl.keywords)) fail2(`placement.priority·keywords 가 없다: ${file}`);
  const n = normRole(role);
  for (const t of pl.priority) {
    const ws = pl.keywords[t];
    // **빈 배열은 허용한다** — "그 성격은 매칭하지 않는다" 는 뜻이고, 어휘가 정말 데이터에서 오는지는
    // 키워드를 지워 확인하는 것 외에 증명할 방법이 없다(MA2). 정본이 비지 않는다는 보장은 T-D2·감사 #13 이 갖는다.
    if (!Array.isArray(ws) || ws.some((w) => typeof w !== "string")) fail2(`placement.keywords.${t} 가 문자열 배열이 아니다: ${file}`);
    const hit = ws.filter((w) => typeof w === "string" && w !== "" && n.includes(w));
    if (hit.length) return { trait: t, hit };
  }
  return { trait: null, hit: [] };
}

/** 성격·실행 모드·③ cost → 티어·via·사유 본문. **경계 행만** 데이터(placement.boundary)가 정한다(§4-3). */
function decideTier(mp, trait, hit, run, cost, file) {
  const bd = mp.placement.boundary;
  if (!isObj(bd) || !isObj(bd.build_oneshot) || !isObj(bd.ambiguous)) fail2(`placement.boundary 가 없다: ${file}`);
  const q = (xs) => xs.map((w) => `"${w}"`).join(",");
  const fromBoundary = (row) => {
    const t = bd[row][cost];
    if (!TIERS.includes(t)) fail2(`placement.boundary.${row}.${cost} 가 티어가 아니다: ${file}`);
    return t;
  };
  if (trait === null) return { tier: fromBoundary("ambiguous"), via: "ambiguous", why: "키워드 매칭 없음(모호)" };
  if (trait === "build" && !MULTITURN.includes(run)) {   // 현재 유일한 경계 행(§4-3)
    return { tier: fromBoundary("build_oneshot"), via: "boundary", why: `역할 어휘 ${q(hit)}→build(경계 행 · 단발)` };
  }
  const tier = BASE_TIER[trait];
  if (tier === undefined) fail2(`placement.priority 의 성격 "${trait}" 에 §4-1 기본 티어가 없다: ${file}`);
  return { tier, via: "matched", why: `역할 어휘 ${q(hit)}→${trait}(비경계)` };
}

/** roster 행 하나 → 배치 결과. --runtime codex 는 값을 정하지 않는다(런타임 기본 · SKILL.md:125). */
function placeAgent(mp, file, a, cost, runtime, providerId) {
  let tier, via, why, trait;
  if (a.tier_override !== undefined) {          // 키워드·③ 승강을 통째로 건너뛴다(§3-2 · via 표)
    tier = a.tier_override; via = "override"; why = a.tier_override_why; trait = "-";
  } else {
    const m = matchTrait(mp, a.role, file);
    const d = decideTier(mp, m.trait, m.hit, a.run, cost, file);
    tier = d.tier; via = d.via; why = d.why; trait = m.trait === null ? "-" : m.trait;
  }
  const base = { name: a.name, role: a.role, tier, trait, via, why };
  if (runtime === "codex") return { ...base, model: "runtime-default", effort: "-" };
  const asm = assembleFor(mp, file, providerId, tier);   // 같은 규칙의 두 구현 금지(§3-1) — S1 의 조립부를 그대로 부른다
  return { ...base, model: asm.model, effort: asm.effort };
}

// 정의 파일에 들어갈 주석 한 줄. `--verify` 가 이 문자열을 **바이트 비교**한다(§3-3-1).
const rationaleOf = (r, cost) => `# tier=${r.tier} trait=${r.trait} via=${r.via} cost=${cost} why=${r.why}`;

/** place 공통 — roster·프로파일·데이터를 읽고 배치를 계산한다. `--verify` 와 **같은 입력·같은 계산**(§3-3-1). */
function placeCore(o, ctx) {
  const { mp, file } = loadModelProfiles();
  const pp = profilePaths(ctx, o.orchestrator);
  const prof = readProfile(pp.file);
  if (prof === null) fail2(`하네스 프로파일이 없다: ${pp.file} (--root·--orchestrator 확인)`);
  const rfile = o.roster === undefined ? rosterPath(ctx, o.orchestrator) : path.resolve(ctx.root, o.roster);
  const roster = readRoster(rfile);

  const cv = prof.obj.answers?.cost?.value;
  const cost = Array.isArray(cv) ? cv[0] : undefined;
  const costKeys = ITEM.cost.options.map((x) => x.key);
  // **손상은 rc=2 다**(rc=1 아님) — 같은 파일을 render·verify 가 rc=2 로 판정하므로(labelOf null → fail2)
  // 여기만 rc=1 이면 **같은 손상 파일이 명령마다 다른 rc** 를 낸다(S3 실측). 프로파일은 기계가 쓰는 파일이고
  // 카탈로그 밖 값은 손으로 고쳤다는 뜻이다 — 답을 바꿔서 고칠 수 없고 answer 로 다시 기록해야 한다.
  if (!costKeys.includes(cost)) fail2(`프로파일 ③ cost 답이 카탈로그 밖이다(손으로 고친 프로파일 · answer 로 다시 기록한다): ${JSON.stringify(cost)}(${costKeys.join("|")})`);

  if (!Object.hasOwn(mp.runtime_provider, o.runtime)) {
    failUsage(`--runtime 이 runtime_provider 에 없다: ${o.runtime}(${Object.keys(mp.runtime_provider).sort(cpCompare).join("|")})`);
  }
  const providerId = mp.runtime_provider[o.runtime];
  if (!Object.hasOwn(mp.providers, providerId)) fail2(`runtime_provider.${o.runtime} = ${providerId} 가 providers 에 없다: ${file}`);

  // placed:false 는 배치·검증 대상에서 뺀다(§3-2 · C-1·C-2). --agent 는 그 뒤에 한 명만 남긴다.
  let rows = roster.agents.filter((a) => a.placed !== false);
  if (o.agent !== undefined) {
    rows = rows.filter((a) => a.name === o.agent);
    if (rows.length === 0) fail1(`--agent 가 배치 대상에 없다: ${o.agent}`);
  }
  const placed = rows.map((a) => placeAgent(mp, file, a, cost, o.runtime, providerId)).sort((x, y) => cpCompare(x.name, y.name));
  const head = `PLACE: ${o.orchestrator} roster=${relOf(ctx, rfile)} profile=${relOf(ctx, pp.file)} cost=${cost} runtime=${o.runtime} provider=${providerId}\n`;
  return { mp, file, cost, placed, head, fallback: fallbackChain(mp, file) };
}

function cmdPlace(o, ctx) {
  const c = placeCore(o, ctx);
  if (o.verify) return placeVerify(o, ctx, c);
  // AGENT: 의 why 는 **사유 본문 + " · <tier>"** 다(§3-3 예시). RATIONALE: 은 본문만 — 정의 파일에 그대로 들어간다.
  const agents = c.placed.map((r) =>
    `AGENT: ${r.name} tier=${r.tier} model=${r.model} effort=${r.effort} trait=${r.trait} via=${r.via} why=${r.why} · ${r.tier}\n`).join("");
  const rats = c.placed.map((r) => `RATIONALE: ${r.name} ${rationaleOf(r, c.cost)}\n`).join("");
  // 항목은 공백, 항목 **안의 토큰은 쉼표** — 둘 다 공백이면 이 줄을 파싱할 수 없다(설계서 §3-3 문구를 이렇게 확정).
  const un = c.placed.filter((r) => r.via === "ambiguous").map((r) => `${r.name}=${normRole(r.role).split(" ").join(",")}`);
  return { rc: 0, out: c.head + agents + rats + `UNMATCHED: ${un.length ? un.join(" ") : "none"}\n` + `FALLBACK: ${c.fallback}\n`, err: "" };
}

/** 정의 파일 한 개 판정. 우선순위 missing → unreadable → malformed → mismatch → ok(§3-3-1 · verify 규약과 같은 모양). */
function verdictFor(ctx, r, cost) {
  const f = path.join(ctx.root, ".claude", "agents", `${r.name}.md`);
  const doc = readTarget(f);
  if (doc.state === "absent") return "missing";
  if (doc.state === "unreadable") return "unreadable";
  const lines = doc.lines;
  let i = 0;
  while (i < lines.length && trimWs(lines[i]) === "") i++;
  if (i >= lines.length || trimWs(lines[i]) !== "---") return "malformed";
  let end = -1;
  for (let j = i + 1; j < lines.length; j++) if (trimWs(lines[j]) === "---") { end = j; break; }
  if (end === -1) return "malformed";
  const fm = lines.slice(i + 1, end);
  const field = (k) => {
    const hit = fm.filter((l) => l.startsWith(`${k}:`));
    return hit.length === 1 ? trimWs(hit[0].slice(k.length + 1)) : undefined;   // 중복 키는 undefined → mismatch
  };
  // 근거 주석은 **frontmatter 안**에 있어야 한다(§4-6) — 본문에 두면 사람이 본문을 고치다 지운다. 중복도 mismatch.
  const cmt = fm.filter((l) => trimWs(l).startsWith("# tier="));
  if (cmt.length !== 1 || trimWs(cmt[0]) !== rationaleOf(r, cost)) return "mismatch";
  if (field("model") !== r.model || field("effort") !== r.effort) return "mismatch";
  // **뒤따르는 `---` 블록이 배치값을 흉내 내면 mismatch.** 파서는 첫 블록만 읽으므로(실측: `scan` 이 첫 블록의
  // model 을 낸다) 실행에는 영향이 없지만, 파일을 읽는 사람은 아래쪽 `model:` 을 진짜로 본다 — MA7 ① 이 지키려는 것이
  // 바로 "적힌 근거를 믿을 수 있다" 이다. 본문의 수평선(`---`)은 정상이므로 **`model:`·`effort:` 를 담은 경우만** 잡는다.
  for (let j = end + 1; j < lines.length; j += 1) {
    const t = trimWs(lines[j]);
    if (t.startsWith("model:") || t.startsWith("effort:") || t.startsWith("# tier=")) return "mismatch";
  }
  return "ok";
}

function placeVerify(o, ctx, c) {
  // C-16 — codex 축은 배치값이 runtime-default/effort=- 라 **대조할 값이 없다**. 에이전트별로 내지 않는다.
  if (o.runtime === "codex") return { rc: 0, out: c.head + "PLACED: na(codex — 런타임 기본)\n", err: "" };
  const v = c.placed.map((r) => [r.name, verdictFor(ctx, r, c.cost)]);
  // 배치 대상이 하나도 없으면(전원 placed:false) **`none`** 이다 — 빈 값은 "검사 결과 없음" 과 "줄이 깨졌다" 를
  // 구분할 수 없고, 이 레포의 모든 계약 줄은 빈 경우 `none` 을 쓴다(`UNMATCHED:`·`BACKUP:`·`DROPPED:`).
  const out = c.head + `PLACED: ${v.length ? v.map(([n, s]) => `${n}=${s}`).join(" ") : "none"}\n`;
  // rc: 전부 ok 또는 na → 0(cmdVerify 와 같은 규약). na 를 실패로 세면 듀얼 감사가 상시 FAIL 한다(R34).
  return { rc: v.some(([, s]) => s !== "ok" && s !== "na") ? 1 : 0, out, err: "" };
}

// 백업 파일명용 압축 시각 — ISO 에서 `-`·`:` 를 뺀다. **Windows 는 파일명에 `:` 를 쓸 수 없다**(2-OS CI 계약 · §3-6).
const stampOf = (iso) => iso.replace(/[-:]/g, "");

/** settings --set-fallback — **유일한 쓰기 명령**(§3-6). rc 는 0/2 뿐이고 승인 대기는 계약 줄로 낸다. */
function cmdSettings(o, ctx, now) {
  // ① 런타임 축을 **가장 먼저** 본다(C-15). Codex 전용 트리에는 `.claude/skills/<orch>/` 자체가 없어서
  //    프로파일 가드를 먼저 두면 "건드리지 않는다" 가 rc=2 가 된다(T-S5 ①).
  if (o.runtime !== "claude") {
    const dir = profilePaths(ctx, o.orchestrator).dir;
    // 듀얼 트리(.claude 쪽이 있다)인데 codex 를 넘긴 것은 **오용**이다 — 그대로 건너뛰면 MA7 자동 복구가 조용히 빠진다(R42).
    if (fs.existsSync(dir)) {
      fail2(`--runtime ${o.runtime} 인데 ${relOf(ctx, dir)} 가 있다(듀얼 하네스는 .claude 쪽 settings 를 써야 한다 — --runtime claude)`);
    }
    return { rc: 0, out: `SETTINGS: skipped runtime=${o.runtime}\n`, err: "" };
  }

  const pp = profilePaths(ctx, o.orchestrator);
  if (readProfile(pp.file) === null) fail2(`하네스 프로파일이 없다: ${pp.file} (--root·--orchestrator 확인)`);
  const { mp, file } = loadModelProfiles();
  const want = fallbackChain(mp, file);            // place 의 FALLBACK: 과 **같은 함수**다(T-S3)

  const cdir = path.join(ctx.root, ".claude");
  const dest = path.join(cdir, "settings.json");
  // 심링크는 따라가면 대상 밖을 덮는다 — 프로파일 쓰기 규칙과 같다(참조 문서 7절 「쓰기」).
  if (isSymlink(cdir)) fail2(`심링크 디렉토리 — 쓰지 않는다: ${dest}`);
  if (isSymlink(dest)) fail2(`심링크 — 따라가 다른 파일을 덮지 않도록 쓰지 않는다: ${dest}`);

  let raw = null;
  try { raw = fs.readFileSync(dest, "utf8"); }
  catch (e) { if (e.code !== "ENOENT") fail2(`settings 읽기 실패: ${dest} (${e.code || e.message})`); }

  const head = `SETTINGS: ${relOf(ctx, dest)}\nFALLBACK: ${want}\n`;
  const backupLine = (p) => `BACKUP: ${p === null ? "none" : relOf(ctx, p)}\n`;

  if (raw === null) {                              // 파일 없음 → 생성(디렉토리 포함) · 백업할 것이 없다
    fs.mkdirSync(cdir, { recursive: true });
    writeAtomic(dest, JSON.stringify({ fallbackModel: want }, null, 2) + "\n");
    return { rc: 0, out: head + backupLine(null), err: "" };
  }

  let obj;
  try { obj = JSON.parse(raw.replace(/^﻿/, "")); }
  catch (e) { fail2(`settings JSON 오류 — 파일을 건드리지 않는다: ${dest} (${e.message})`); }
  if (!isObj(obj)) fail2(`settings 최상위가 객체가 아니다 — 병합 대상이 아니다: ${dest}`);

  const cur = obj.fallbackModel;
  if (cur === want) return { rc: 0, out: head + backupLine(null), err: "" };   // 멱등 — 아무것도 쓰지 않는다

  // 값이 **이미 있는데 다르면** 사람 확인 없이 덮지 않는다. 승인 대기는 실패가 아니라 결과이므로 rc=0 + 계약 줄이다(§3-6).
  if (cur !== undefined && o.approve !== true) {
    return {
      rc: 0,
      out: head + backupLine(null)
        + `NEEDS_APPROVAL: fallbackModel before=${JSON.stringify(String(cur))} after=${JSON.stringify(want)} — --approve 로 다시 실행\n`,
      err: "",
    };
  }

  // 키 단위 병합 — 다른 키의 값·순서를 보존한다(있던 키면 제자리, 없던 키면 뒤에 붙는다).
  // 같은 초에 두 번 쓰거나 --now 를 고정해 돌리면 백업 이름이 겹친다. 덮으면 **먼저 만든 백업을 잃고**,
  // 그대로 실패시키면 사용자가 승인한 쓰기가 거부된다(드라이런 실측) — 겹치면 `-2`, `-3` … 으로 비켜 간다.
  // `existsSync` 로 먼저 보고 쓰면 두 프로세스가 같은 경로를 고른다(TOCTOU · R2 codex MED).
  // **`wx` 로 만들어 보고 EEXIST 면 다음 이름으로 전진**한다 — 만드는 행위 자체가 자리 선점이다.
  const base = path.join(cdir, `settings.json.bak-${stampOf(now)}`);
  let bak = null;
  for (let n = 1; n <= 100; n += 1) {
    const cand = n === 1 ? base : `${base}-${n}`;
    try { fs.writeFileSync(cand, raw, { flag: "wx" }); bak = cand; break; }
    catch (e) { if (e.code !== "EEXIST") fail2(`백업을 만들지 못해 쓰지 않는다: ${cand} (${e.code || e.message})`); }
  }
  if (bak === null) fail2(`백업 이름을 100회 시도해도 비우지 못했다 — 쓰지 않는다: ${base}`);
  obj.fallbackModel = want;
  writeAtomic(dest, JSON.stringify(obj, null, 2) + "\n");
  return { rc: 0, out: head + backupLine(bak), err: "" };
}

// ── 인자 ──

const ARG_SPEC = {
  questions: { val: ["--root", "--now", "--orchestrator", "--mode", "--after"], rep: [], flag: [] },
  answer: { val: ["--root", "--now", "--orchestrator", "--mode", "--from-file", "--only"], rep: ["--set", "--recommended", "--why"], flag: ["--from-env", "--defaults"] },
  // S3 — --now 는 받지 않는다(시각을 쓰지 않으므로 받으면 결정성을 오해한다 · rc=2).
  render: { val: ["--root", "--orchestrator", "--block"], rep: [], flag: [] },
  verify: { val: ["--root", "--orchestrator"], rep: [], flag: [] },
  // S4(v1.8.3) — 읽기 전용 셋. --now 를 받지 않는다(시각을 쓰지 않는다 · render·verify 와 같은 규약).
  assemble: { val: ["--root", "--orchestrator", "--provider", "--tier", "--runtime"], rep: [], flag: [] },
  // S2(v1.8.3) — place 는 읽기 전용 셋(--now 거부) · settings 는 **유일한 쓰기 명령**이라 --now 를 받는다(백업 파일명).
  place: { val: ["--root", "--orchestrator", "--roster", "--runtime", "--agent"], rep: [], flag: ["--verify"] },
  settings: { val: ["--root", "--orchestrator", "--runtime", "--now"], rep: [], flag: ["--set-fallback", "--approve"] },
  // egress 도 읽기 전용 셋이다 — --now 를 받지 않고 파일을 쓰지 않는다.
  egress: { val: ["--root", "--orchestrator", "--runner", "--grade"], rep: [], flag: [] },
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
    } else if (a === "--now" && (sub === "render" || sub === "verify" || sub === "assemble" || sub === "place" || sub === "egress")) {
      failUsage(`${sub} 는 --now 를 받지 않는다 — 시각을 쓰지 않는다(같은 프로파일 → 같은 출력)`);
    } else if (a.startsWith("-")) {
      failUsage(`모르는 옵션(${sub}): ${a}`);
    } else {
      failUsage(`남는 인자: ${a}`);
    }
  }
  const o = {
    root: v["--root"], now: v["--now"], orchestrator: v["--orchestrator"], mode: v["--mode"], after: v["--after"], fromFile: v["--from-file"], block: v["--block"], only: v["--only"],
    provider: v["--provider"], tier: v["--tier"], runtime: v["--runtime"],
    roster: v["--roster"], agent: v["--agent"], verify: seen.has("--verify"), runner: v["--runner"], grade: v["--grade"],
    setFallback: seen.has("--set-fallback"), approve: seen.has("--approve"),
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
    if (o.only !== undefined) {
      // --only 는 **확장이 선언 답을 조용히 덮는 것**을 막는 장치다(§6-4-0 · 실측 재현: extend + --defaults 가
      // irreversible 을 [force-push,external-send] declared → [unknown] assumed 로 바꾸고 rc=0 이었다).
      if (o.mode !== "extend") failUsage("--only 는 --mode extend 와만 쓴다(새 프로파일에는 이월할 답이 없다)");
      const ids = o.only.split(",").map((x) => trimWs(x));
      if (ids.length === 0 || ids.some((x) => x === "")) failUsage(`--only 값이 비었다: ${JSON.stringify(o.only)}`);
      const bad = ids.filter((x) => !ITEM_IDS.includes(x));
      if (bad.length) failUsage(`--only 에 카탈로그 밖 항목: ${bad.join(",")}(${ITEM_IDS.join("|")})`);
      if (new Set(ids).size !== ids.length) failUsage(`--only 에 같은 항목이 두 번: ${o.only}`);
      o.onlyIds = ids;
    }
  } else if (sub === "egress") {
    if (o.orchestrator === undefined) failUsage("--orchestrator 가 없다");
    if (o.runner === undefined) failUsage("--runner 가 없다(claude|codex — 리뷰어 후보에서 뺄 실행 엔진)");
    if (o.grade !== undefined && !GRADES.includes(o.grade)) failUsage(`--grade 값이 아니다: ${o.grade}(${GRADES.join("|")})`);
  } else if (sub === "place") {
    if (o.orchestrator === undefined) failUsage("--orchestrator 가 없다");
    if (o.runtime === undefined) o.runtime = "claude";   // place 의 --runtime 은 기본 claude(§3-1 — assemble 과 다르다)
    if (o.agent !== undefined && !ORCH_RE.test(o.agent)) failUsage(`--agent 이름이 ${ORCH_RE.source} 가 아니다: ${JSON.stringify(o.agent)}`);
  } else if (sub === "settings") {
    if (o.orchestrator === undefined) failUsage("--orchestrator 가 없다");
    // 유일한 쓰기 명령이라 cwd 추정을 금지한다 — 엉뚱한 디렉토리에 rc=0 으로 settings.json 을 만든다(§3-1).
    if (o.root === undefined) failUsage("settings 는 --root 가 필요하다(유일한 쓰기 명령 — cwd 를 추정하지 않는다)");
    if (!o.setFallback) failUsage("--set-fallback 이 없다(현재 settings 의 유일한 동작)");
    if (o.runtime === undefined) failUsage("--runtime 이 없다(**대상 하네스의 런타임** — 실행 러너가 아니다)");
  } else if (sub === "assemble") {
    // 넷 다 필수다. --runtime 은 **대상 하네스의 런타임**이고(R25-1), 없으면 egress 강제 ①(S3)이 원리적으로 성립하지 않는다.
    if (o.orchestrator === undefined) failUsage("--orchestrator 가 없다");
    if (o.provider === undefined) failUsage("--provider 가 없다");
    if (o.tier === undefined) failUsage(`--tier 가 없다(${TIERS.join("|")})`);
    if (!TIERS.includes(o.tier)) failUsage(`--tier 값이 아니다: ${o.tier}(${TIERS.join("|")})`);
    if (o.runtime === undefined) failUsage("--runtime 이 없다(대상 하네스의 런타임 — 값 어휘는 데이터 파일 runtime_provider 가 갖는다)");
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
    const now = sub === "questions" || sub === "answer" || sub === "settings" ? parseNow(o.now) : null; // render·verify·assemble·place 는 시각을 쓰지 않는다
    const ctx = { root: rootOf(o.root), home: path.resolve(os.homedir()) };
    const r = sub === "questions" ? cmdQuestions(o, ctx)
      : sub === "answer" ? await cmdAnswer(o, ctx, now)
      : sub === "render" ? cmdRender(o, ctx)
      : sub === "assemble" ? cmdAssemble(o, ctx)
      : sub === "place" ? cmdPlace(o, ctx)
      : sub === "settings" ? cmdSettings(o, ctx, now)
      : sub === "egress" ? await cmdEgress(o, ctx)
      : cmdVerify(o, ctx);
    return exitWith(r.rc === undefined ? 0 : r.rc, r.out, r.err);
  } catch (e) {
    if (e instanceof IntakeError) return exitWith(e.rc, "", `harness-intake: ${e.message}\n${e.usage ? USAGE + "\n" : ""}`);
    throw e;
  }
}

// ───────────────────────── CLI ─────────────────────────

const USAGE = "사용: node harness-intake.mjs <scan|questions|answer|render|verify|assemble|place|settings|egress|selftest> [--root <dir>] [--now <ISO>] …(questions·answer·render·verify 옵션: references/harness-interview.md · assemble·place·settings: references/model-profiles.md)";

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
  if (sub === "questions" || sub === "answer" || sub === "render" || sub === "verify" || sub === "assemble" || sub === "place" || sub === "settings" || sub === "egress") return runS2(sub, argv.slice(1));
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
