# Contributing to myharness

Thanks for considering a contribution to **myharness** — a Claude Code · Codex meta-skill factory that turns a domain sentence into an agent team and the skills they use.

> **Note:** myharness is a **personal fork-factory** maintained by a single maintainer. Response times are **best-effort**, not a contractual SLA. Pinging an open issue/PR after a while is welcome — that's the agreed feedback loop, not rudeness.

This document covers: how to contribute, development setup, PR conventions, commit message rules, and code of conduct.

---

## How to Contribute

Plain GitHub issues and discussions — there are no custom issue forms.

### Bug report
- Open a GitHub issue. Include: Claude Code version, `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` flag state, reproduction steps, expected vs actual, OS.
- Small reproductions (< 30 lines) are ideal. For a full project, link a public fork.

### Feature request
- Open an issue with a short "what problem does this solve" paragraph. If you have a proposal, say which of the 6 team-architecture patterns it extends/replaces (Pipeline, Fan-out/Fan-in, Expert Pool, Producer-Reviewer, Supervisor, Hierarchical Delegation).

### Question / Discussion
- Use [GitHub Discussions](https://github.com/cookyman74/my_harness/discussions) for open-ended matters; promote to an issue once direction is clear.

### Security
- Do **not** open a public issue for anything that could be abused.
- Email `cookyman@gmail.com` with subject prefix `[myharness-security]`. Best-effort acknowledgement; please allow time.

---

## Development Setup

### Prerequisites
- Claude Code `v2.x` (agent teams via the `Agent` tool — `TeamCreate`/`TeamDelete` were removed in v2.1.178)
- Codex CLI (optional, for the dual-runtime path)
- `git`; `codex` / `agy` CLIs optional (external review — skipped if absent)

### Agent teams flag (Claude Code)
myharness's default mode uses Claude Code's experimental agent teams:
```bash
export CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1
```
Dependency tracked in `docs/experimental-dependency.md` (Scenario A/C realized — `TeamCreate`/`TeamDelete` removed; teammates now spawn via the `Agent` tool).

### Install for local testing
```bash
# Claude Code — via marketplace
/plugin marketplace add cookyman74/my_harness
/plugin install myharness@myharness-marketplace

# or global skill copy
cp -r skills/myharness ~/.claude/skills/myharness

# Codex (dual runtime)
bash install.sh        # Linux/macOS/WSL
# Windows PowerShell: .\install.ps1
```

### Run the meta-skill
```bash
claude "build a harness for a fintech risk-assessment team"
# or:  /myharness   (Codex: $myharness)
```
Scaffolded agents/skills land under `.claude/agents/` and `.claude/skills/` (and `.agents/`, `.codex/` for the dual-runtime output).

### Checks (factory-repo self-audit)
```bash
bash skills/myharness/scripts/run-policy-audit.sh   # link/version/cap/dual-runtime parity (fail=block, warn=review)
bash tests/test-harness-update.sh                   # update safety regression suite
bash skills/myharness/scripts/check-review-tools.sh         # external reviewer availability (runner-excluded)
```

---

## Pull Request Guidelines

### Branch naming — `type/short-description`
| Prefix | Use for | Example |
|--------|---------|---------|
| `feat/` | New user-visible capability | `feat/expert-pool-variance-mode` |
| `fix/` | Bug fix | `fix/agent-teams-flag-detection` |
| `docs/` | Docs-only changes | `docs/quickstart-agy-section` |
| `refactor/` | Internal structure, no behavior change | `refactor/skill-loader-split` |
| `chore/` | Build, deps, housekeeping | `chore/release-1.3.0` |
| `test/` | Tests only | `test/fan-out-fan-in-e2e` |

### Before opening a PR
- Run `run-policy-audit.sh` (PASS, fail 0) and `tests/test-harness-update.sh`.
- Keep `SKILL.md` ≤ 500 lines (Progressive Disclosure — move detail to `references/`).
- Dual-runtime: factory canonical lives at `skills/myharness/`; `.agents/skills/myharness` is a symlink (auto-synced).

### Commit message language
- **Korean and English both accepted.** Write in whichever you're more precise in.
- If the change hits the CHANGELOG/release notes, also give an English title in the PR description.

### Review
- Maintainer review before merge. Best-effort turnaround — ping if blocked.

---

## Commit Message Convention

A light variant of **Conventional Commits** mapped to SemVer.
```
<type>(<scope>)!: <short summary>

<body — optional>

<footer — optional>
```

| Commit type | SemVer impact | Example |
|-------------|---------------|---------|
| `feat!:` or `BREAKING CHANGE:` footer | **major** (1.x → 2.0) | `feat!: rename pattern "Supervisor" → "Orchestrator"` |
| `feat:` | **minor** (1.2 → 1.3) | `feat: add document-system tiering` |
| `fix:` | **patch** (1.2.3 → 1.2.4) | `fix: correct flag detection on zsh` |
| `docs:` / `chore:` / `refactor:` / `test:` | no bump | `docs: clarify dual-runtime adapters` |

- Korean summaries are fine: `feat: 전문가 풀 패턴에 분산 지표 추가`.
- The `!` suffix (or `BREAKING CHANGE:` footer) is the **only** major-version trigger — don't set it lightly.

### Releases
- Cut ad-hoc as features land (no fixed cadence), via the `release-flow` skill: CHANGELOG promote + `plugin.json`/`marketplace.json`/README badges sync + `git tag vMAJOR.MINOR.PATCH` from `main`.

---

## Code of Conduct

This project follows the **Contributor Covenant v1.4**:
- Be welcoming and inclusive; assume good intent.
- No harassment, personal attacks, or discriminatory language.
- Critique ideas, not people; back claims with references where possible.
- The maintainer may moderate or remove content that violates these principles.

Full text: <https://www.contributor-covenant.org/version/1/4/code-of-conduct/>
Report violations privately to `cookyman@gmail.com` with subject prefix `[myharness-coc]`.

---

## Maintainer

| Role | Handle | Area |
|------|--------|------|
| Maintainer | [@cookyman74](https://github.com/cookyman74) | Direction, releases, review — everything |

Sustained contributors may be added here. Open a Discussion if you'd like to talk about a maintainer path.

---

## License

By contributing, you agree your contributions are licensed under the same license as this repository (see [`LICENSE`](./LICENSE)).
