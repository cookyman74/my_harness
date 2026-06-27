<p align="center">
  <img src="harness_banner.png" alt="myharness Banner" width="600">
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Version-1.2.0-brightgreen.svg" alt="Version">
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-Apache_2.0-blue.svg" alt="License"></a>
  <img src="https://img.shields.io/badge/Claude_Code-Plugin-purple.svg" alt="Claude Code Plugin">
  <img src="https://img.shields.io/badge/Runtime-Claude_Code_+_Codex-blueviolet.svg" alt="Dual Runtime">
  <img src="https://img.shields.io/badge/Patterns-6_Architectures-orange.svg" alt="6 Architecture Patterns">
  <img src="https://img.shields.io/badge/Quality_Gate-2--Layer-green.svg" alt="Two-Layer Quality Gate">
  <a href="https://github.com/cookyman74/my_harness/stargazers"><img src="https://img.shields.io/github/stars/cookyman74/my_harness?style=social" alt="GitHub Stars"></a>
</p>

# myharness — The Agent-Team Architecture Factory

**English** | [한국어](README_KO.md) | [日本語](README_JA.md)

> **myharness is a Claude Code · Codex dual-runtime factory that turns a single sentence about your domain into an agent team and skills.**
> Just say `"Build a harness for this project"` — it analyzes your domain and stamps out specialized agent definitions (`.claude/agents/`) and skills (`.claude/skills/`), picking whichever of the 6 team architecture patterns fits.

---

## What is myharness?

When you tackle a complex job with one giant prompt, context gets polluted, the same blind spots repeat, and nothing is reusable. myharness decomposes that job and generates it as **a team of specialized agents with separated roles + skills that carry the procedures + an orchestrator that weaves them together**.

- **Input:** a single sentence about your domain (e.g., "deep research", "full-stack web development", "code review")
- **Output:** agent definitions + skills + an orchestrator skill + entry pointers (`CLAUDE.md`/`AGENTS.md`)
- **Characteristics:** Korean-first · slim by default (gates tighten only as risk rises) · outputs for both Claude Code and Codex

myharness itself is a meta skill (plugin), and it treats itself as **a system that evolves** — it feeds execution feedback back into the appropriate layer (skill/agent/orchestrator) and leaves a change history.

## Quick Start

### 1. Install (pick one)

**Marketplace (recommended)**
```shell
/plugin marketplace add cookyman74/my_harness
/plugin install myharness@myharness-marketplace
```

**Copy directly as a global skill**
```shell
cp -r skills/myharness ~/.claude/skills/myharness
```

**Codex CLI (dual runtime)** — from the repo root:
```shell
bash install.sh        # Linux/macOS/WSL
# or, in Windows PowerShell:
.\install.ps1
# → ~/.codex/skills/myharness  (symlink to the source of truth, always up to date)
# → .agents/skills/myharness   (for trusted projects)
# → AGENTS.md                  (auto-loaded by Codex)
```

`install.ps1` uses directory links when Windows permits them and falls back to a copy with a warning. The repository enforces LF for shell scripts, so Git's `core.autocrlf` setting does not break the Bash installer.

### 2. Turn on agent teams + start the CLI (Claude Code)
```shell
export CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1
claude   # start the Claude Code CLI (for Codex, use the codex command)
```

### 3. Triggers
- **Claude Code:** `Build a harness for this project` · `/myharness` · `Design an agent team for this domain`
- **Codex:** `$myharness` · the `/skills` menu · `Build a harness` (description matching). A session restart after install is recommended. (Codex doesn't support custom slash commands — `/myharness` is unavailable.)

> Copy-paste examples by domain → [Example Prompts](#example-prompts)

## Core Features

| Feature | Details |
|---------|---------|
| **6 team architectures** | Pipeline · Fan-out/Fan-in · Specialist pool · Generate-and-verify · Supervisor · Hierarchical delegation. Picks the pattern that fits the domain |
| **Agent teams by default** | Spawn teammates with the `Agent` tool, communicate directly via `SendMessage`, and self-coordinate through a shared task list (`TaskCreate`). Quality rises through shared findings and debating disagreements |
| **Automatic skill generation** | Progressive Disclosure (staged loading: metadata → body → references) for context efficiency. Trigger descriptions are written aggressively |
| **Two-layer quality gate** | Internal generate-and-verify QA **+** an external independent review loop. Details below |
| **Doctrine injection** | Injects TDD (`tdd-doctrine.md`) and dev rules (`dev-rules.md`) into the working principles of coding/editing agents via **real paths**. Includes **test-as-first-class-review-artifact** (RED verified before GREEN; only contract/schema/security tests go to external cross-review) and a **safe rollback discipline** (destructive `git reset --hard` dropped). Risk tiers (light/standard/critical) tune gate strength |
| **Document system** | Core artifacts (design docs, work plans, work results) live in `docs/{project}/` (durable, committed audit ledger); scratch lives in `_workspace/` (ephemeral) — two-layer split prevents result-doc loss (RAG knowledge cycle). Document tiers (light by default), git-staging promote, fail-fast. Independent of external review tools (internal QA if none) |
| **Dual runtime** | A single source of truth (`skills/myharness/`) + a thin per-runtime adapter. Outputs both `CLAUDE.md` and `AGENTS.md`, with orchestration branching (Claude spawns `Agent` teammates ↔ Codex native subagents / `codex exec`). Phase 7 synchronization prevents drift |
| **Built-harness update** | `/myharness update` (Codex `$myharness update`) — re-propagates the factory source of truth into an already-built harness while **protecting local edits**. `.harness-manifest.json` hash classification (SAME/auto/USER-MODIFIED held/NEW), with `*.local.*` keeping updates safe |
| **Cost & concurrency control** | Model routing (high-reasoning → `opus`, simple → lightweight), a concurrency cap (default 3 / max 5) with backpressure, an external-review budget (skips when there's no change), and smoke/full test modes to keep large fan-out costs under control |
| **Loop self-evaluation** | Each loop produces a `loop_scorecard.json` (alignment · verdict distribution · normalization rounds · cost). **Currently only the measurement logging is active**; the suggest → automatic loopback is experimental. anti-Goodhart guards (against metric gaming and overfitting) |

### Two-Layer Quality Gate (code/design domains)

Internal QA runs in the same session and the same context, so it shares the **same blind spots**. That's why an external independent AI review is placed on a separate axis.

- **Engine diversity** — reviewers are chosen by **excluding** the runner engine (same engine = same blind spots). When running on Claude Code, `codex`+`agy`; when running on Codex, `claude`+`agy`. (`agy` = a Gemini model)
- **Direct verdict on every item** — external reviewers don't know the design decisions, frozen contracts, or actual measurements, so the orchestrator judges every reported issue against **the real code** as confirmed/partial/deferred/rejected. Consensus is not the answer; verdict authority stays with the orchestrator (no delegation).
- **Convergence loop** — loop-until-dry (zero new issues for K consecutive rounds) + a round cap, a verdict ledger (`verdicts.json`, prevents reappearance), and re-review of the fix. Only confirmed items are fixed via TDD.
- **Skip when tools are absent** — `check-review-tools.sh` produces a runner-excluded `REVIEWERS:` list; if no external reviewer exists, the gate shrinks to internal QA (avoids a non-functional skill).

> This README is verified through that gate too — committed after an external audit by `codex` (consistency) + `agy` (performance & stability).

## How It Works — Skills ↔ Agents

A generated harness separates **who** from **how**:

- **Agent = who** — an expert persona + working principles. Defined as a `.claude/agents/{name}.md` file (no inlining → reusable across sessions). 1 agent = 1 role.
- **Skill = how** — procedures + bundled tools. `skills/{name}/SKILL.md`. One agent uses 1–N skills (shareable).
- **Orchestrator = who, when, in what order** — weaves individual agents/skills into a single workflow.
- **Data passing** — messages (real-time coordination) + a shared task list (progress tracking) + files (`_workspace/`, large payloads & audit trail). Result documents keep judgment continuous across stages via a `## Next-step reference` block.
- **Why-first · DRY pointers** — instead of forcing "ALWAYS/NEVER", explain the *why* (sharpens judgment on edge cases) and reference a single source (no duplication).

> In short: the **orchestrator** decides who/when/order, the **agents** are the who, the **skills** are the how, and the **two-layer gate** protects quality.

### 7-Phase Workflow

```
Phase 0  Status audit (check existing harness for drift · branch into new/extend/maintain/update)
Phase 1  Domain analysis (task type · conflicts with existing assets · detect user skill level)
Phase 2  Team architecture design (execution mode + choice among the 6 patterns)
Phase 3  Generate agent definitions (.claude/agents/ · doctrine injection)
Phase 4  Generate skills (.claude/skills/ · Progressive Disclosure)
Phase 5  Integration & orchestration (+ two-layer quality gate · dual-runtime output · CLAUDE.md pointers)
Phase 6  Validation & testing (trigger verification · dry run · with/without comparison)
Phase 7  Harness evolution (feedback loopback · runtime synchronization · built-harness update)
```

> **Read first:** `skills/myharness/references/factory-map.md` — a map of minimal paths by domain/risk. **Slim by default** — external review, TDD, and evaluation are turned on only as risk rises (avoids overburdening a simple harness).

## Execution Modes & Architecture Patterns

| Execution mode | Tools | Best for |
|----------------|-------|----------|
| **Agent team** (default) | `Agent` (spawn teammates) + `SendMessage` + `TaskCreate` | 2+ collaborators, real-time coordination & feedback |
| **Sub-agents** | Direct `Agent` tool calls (`run_in_background` for parallelism) | One-off work, no inter-agent communication needed |
| **Hybrid** | Mix team/sub per phase | When phases have different characteristics |

<p align="center">
  <img src="harness_team.png" alt="myharness Agent Team" width="500">
</p>

| Architecture pattern | Description |
|----------------------|-------------|
| Pipeline | Sequentially dependent tasks |
| Fan-out/Fan-in | Parallel independent tasks, then merge |
| Specialist pool | Selective invocation by situation |
| Generate-and-verify | Generate, then quality-check (retry loop) |
| Supervisor | A central agent distributes work dynamically |
| Hierarchical delegation | Recursive top → bottom delegation |

## Generated Output

```
your-project/
├── .claude/
│   ├── agents/          # agent definitions (analyst.md, builder.md, qa.md …)
│   └── skills/          # skills (each SKILL.md + references/)
├── CLAUDE.md            # Claude Code entry pointer
└── AGENTS.md            # Codex entry pointer (when dual runtime)
```

> **Dual-runtime output:** If Codex is also a target, `.agents/skills/<name>/` and `.codex/agents/<name>.toml` are emitted alongside the `.claude/` output (same source of truth). Details: `skills/myharness/references/runtime-adapters.md`.

## Dual Runtime (Claude Code + Codex)

The source of truth (skill body · references · scripts) is **runtime-agnostic Markdown**. Only the adapter branching differs:

| Concern | Claude Code | Codex CLI |
|---------|-------------|-----------|
| Entry point | `.claude-plugin/plugin.json` + `CLAUDE.md` | `AGENTS.md` (auto-loaded) |
| Skills | `.claude/skills/` | `.agents/skills/` (same format) |
| Agents | `.claude/agents/*.md` | `.codex/agents/*.toml` + built-in worker/explorer |
| Orchestration | `Agent` teammate spawn + `SendMessage` + `TaskCreate` | native subagents / `codex exec` subprocess |
| External reviewers | codex + agy (runner claude excluded) | claude + agy (runner codex excluded) |

> `agy` (antigravity, a Gemini model) is not a host runtime — it's dedicated to external review only. Details: `skills/myharness/references/runtime-adapters.md`.

## Example Prompts

After install, paste these straight into Claude Code (or Codex):

**Deep research**
```
Build a harness for deep research. I need an agent team that investigates a topic from
multiple angles — web search, academic sources, community sentiment — then cross-verifies
and produces a comprehensive report.
```

**Full-stack web development**
```
Build a harness for full-stack web development. I'd like a team where design · frontend
(React/Next.js) · backend (API) · QA collaborate as a pipeline from wireframe to deployment.
```

**Webtoon production**
```
A harness for producing webtoon episodes. I need agents for story · character prompts ·
panel layout · dialogue editing, and have them review each other's output for style consistency.
```

**Code review & refactoring**
```
A harness for comprehensive code review. I want a team that checks architecture · security
vulnerabilities · performance bottlenecks · code style in parallel, then merges every finding
into a single report.
```

**Data pipeline design**
```
A harness for data pipeline design. I need an agent team that hierarchically delegates
schema design · ETL logic · validation rules · monitoring setup.
```

**AIOps — PaaS operations (Kubernetes)** — *one example showing model routing · slim path · a safety gate*
```
Build a harness for PaaS operations management.
- Domain: stable Kubernetes cluster ops (collect → diagnose → remediate → report)
- Environment: single-node kind, kubectl context=docker-desktop, no metrics-server
- Agents: state-collector (read-only), root-cause-diagnoser, remediation-applier, health-reporter
- Risk: ops / non-code → slim path (skip external review · TDD · evaluation)
- Runtime: Claude Code only
- Models: high-reasoning (diagnose/remediate)=opus, collect=haiku, report=sonnet
- Safety gate (kept as a version-controlled procedure in the k8s-remediate skill body):
  evaluate 5 checks before applying any change; apply only if ALL pass. If ANY
  fails, stop and hand off to a human.
    1) Blast radius  2) Rollback  3) Approval  4) Timing  5) Tenant scope
  Put thresholds in references/thresholds.md (do not hard-code numbers in the body).
```

## Plugin Structure

```
my_harness/
├── .claude-plugin/plugin.json   # manifest (name: myharness)
├── skills/myharness/
│   ├── SKILL.md                 # main skill (7-phase workflow)
│   ├── references/              # factory-map · agent-design-patterns · orchestrator-template ·
│   │                            #   external-review-loop · tdd-doctrine · dev-rules ·
│   │                            #   runtime-adapters · harness-update · loop-self-eval, etc.
│   └── scripts/                 # check-review-tools · build-scorecard · harness-update
├── AGENTS.md                    # Codex entry point
├── install.sh                   # dual-runtime install
└── README.md / README_KO.md / README_JA.md
```

## Where It Sits in the Ecosystem

myharness lives at the **meta-factory** layer of the Claude Code agent ecosystem — the side that *generates* other harnesses. Its role differs from adjacent layers, so you can pick one or combine them.

| Neighbor | Their role | Relationship to myharness |
|----------|------------|---------------------------|
| [coleam00/Archon](https://github.com/coleam00/Archon) | A factory for deterministic, reproducible **runtime configuration** | Same meta layer, different sub-area. Archon = runtime determinism, myharness = team architecture. Combinable (design with myharness → deploy with Archon) |
| [LangGraph](https://langchain-ai.github.io/langgraph/) | State-graph orchestration, LLM-agnostic | A different track. LangGraph = long-running & state recovery, myharness = fast, Claude Code-native team design |
| [wshobson/agents](https://github.com/wshobson/agents) | A catalog of subagents/skills | Parts supply ↔ factory. Pick parts from the catalog and absorb them into the team myharness designs |

## Requirements

- **Claude Code:** [enable agent teams](https://code.claude.com/docs/en/agent-teams) — `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`
- **External review (optional):** at least one of the `codex`/`claude`/`agy` CLIs excluding the runner (if `agy` is missing it falls back to the legacy `gemini`; if none are present the gate is auto-skipped)

> **⚠️ Cost warning:** In an agent team each teammate is an independent Claude instance, so by the nature of its parallel/shared-context structure the **API token cost can climb quickly compared to a single prompt**. In cost-sensitive environments, use sub-agent mode (returning only the `run_in_background` result) or turn agent teams off. myharness mitigates this with model routing, a concurrency cap, and an external-review budget.
>
> **Known limitations (experimental):** Agent teams are an experimental Claude Code feature. There are limitations such as no `--resume` restoration, task status lag, and zombie processes in tmux mode — so myharness is designed to checkpoint intermediate output into `_workspace/`, require completion reports via `SendMessage`, and request an explicit shutdown on exit. Details: `skills/myharness/references/agent-design-patterns.md`.

## FAQ

<details>
<summary><b>Q1. Which runtimes are supported?</b></summary>

**A.** Both Claude Code and Codex (dual runtime). A single source of truth (`skills/myharness/`) + a thin per-runtime adapter. Claude Code is the most automated primary runtime (`Agent` teammate spawn); Codex is supported via `AGENTS.md` + `.agents/skills/` + native subagents / `codex exec` (`$myharness` or `/skills`). Gemini is not a host — it's used only as an external reviewer (via agy). Details: `skills/myharness/references/runtime-adapters.md`.
</details>

<details>
<summary><b>Q2. Are the heavy gates all turned on for every task?</b></summary>

**A.** No. **Slim by default.** Simple/non-code/reversible work uses internal QA only; standard code/design gets one external review pass; only contract changes and irreversible critical work get external review at every stage plus an approval ladder. Risk tiers tune the strength (`skills/myharness/references/factory-map.md`).
</details>

<details>
<summary><b>Q3. If I update the factory, does it overwrite the harness I customized?</b></summary>

**A.** No. `/myharness update` classifies files by `.harness-manifest.json` hashes and **holds** USER-MODIFIED ones (replaced only with explicit approval, no partial merge). If you separate your own policy into `*.local.*` files, updates stay safe. Details: `skills/myharness/references/harness-update.md`.
</details>

## License

Apache 2.0
