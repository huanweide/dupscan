**中文** · [README.md](./README.md)

> [!WARNING]
> **⚠️ This tool has been merged into the [doctors](https://github.com/huanweide/doctors) monorepo and is no longer maintained here.**
>
> The source now lives at [`doctors/packages/dupscan/`](https://github.com/huanweide/doctors/tree/main/packages/dupscan). Inside doctors it runs as the `doctors dup` subcommand (or `node packages/dupscan/index.js`). This repository no longer accepts changes — please use <https://github.com/huanweide/doctors>.

<!-- badges -->
[![License](https://img.shields.io/github/license/huanweide/dupscan)](LICENSE)
[![Stars](https://img.shields.io/github/stars/huanweide/dupscan)](https://github.com/huanweide/dupscan/stargazers)
[![zero-dep checkup CLI](https://img.shields.io/badge/zero--dep%20checkup%20CLI-18%20tools-22c55e)](https://github.com/huanweide/family-showcase)
<!-- /badges -->

**🔧 Part of the [huanweide zero-dependency CLI family](https://github.com/huanweide/family-showcase) (18 single-file tools). Use it standalone, as a subcommand inside the [doctors](https://github.com/huanweide/doctors) monorepo, or run everything together via [enghealth](https://github.com/huanweide/enghealth).**

# dupscan

Zero-dependency, single-file duplicate-code-block detector — part of the huanweide zero-dependency CLI family, focused on "duplicate code".

Scans the JS / TS ecosystem (`.js .mjs .cjs .ts .jsx .tsx .vue .svelte`), finds contiguous duplicated code snippets, and gives a severity-weighted health score plus an out-of-the-box CI gate. No network, no install, no config — a single `index.js` runs directly.

## Who should use this

- Teams that want copy-paste duplication made visible in Code Review and CI.
- Projects where the same logic is pasted in multiple places (a classic SonarQube #1 tech-debt smell).
- Anyone who wants a deterministic, dependency-free duplication gate.

## Who should not use this

- If you need cross-language duplication detection — dupscan focuses on JS/TS.
- Note: this repo is deprecated — prefer `doctors dup` for new setups.

## Why you need it

Duplicated code is one of the top tech-debt smells listed by SonarQube: the same logic is copy-pasted, and when you fix it in one place you forget the other, planting a bug. dupscan quantifies "duplicate blocks" with deterministic static scanning, so copy-paste has nowhere to hide in Code Review and CI.

## Install and run

```bash
git clone https://github.com/huanweide/dupscan
cd dupscan
node index.js .          # Node >= 14
```

Zero dependencies, no `npm install` needed.

> **This package is not published to the npm registry** (`npm i -g dupscan` returns 404). After cloning you can `npm link` to use it as a global command, or just run `node index.js`.
>
> Runtime: **Node >= 14** (the `engines` field declares this honestly; CI has a tested Node 14 / 22 dual-version matrix). Note: `node --test` needs Node >= 18, so on Node 14 CI uses an equivalent smoke self-check path.

## Usage

```bash
# Scan the current directory
node index.js .

# Scan a specific directory, min duplicate block raised to 6 lines
node index.js src --min-lines 6

# Machine-readable output (pipe to jq / pipeline in CI)
node index.js . --json

# CI gate: forbid any HIGH duplicate block, and no more than 3 duplicate blocks total
node index.js . --fail-on-high --max-issues 3

# Tolerate at most 20 "extra duplicate lines" (cumulative: block lines × copies − 1)
node index.js . --max-lines 20
```

## Three-state gate (important)

The worst failure mode for a scanning gate is "**scanned 0 objects but reported pass**" — a green light on CI that never goes out. More subtly: even with an explicit `--max-issues` / `--fail-on-high`, an empty input still "passes", and your gate config is utterly meaningless at that moment.

So dupscan doesn't output a boolean conclusion — it outputs three states (see `gate.state` and `basisComplete` in `--json`):

| `gate.state` | Exit code | Meaning |
| --- | --- | --- |
| `pass` | 0 | gate threshold configured, input trustworthy, metrics met |
| `fail` | 2 | gate threshold configured, and at least one item unmet |
| `inconclusive` | 3 | **cannot conclude**: no gate threshold configured, or scan input empty / all files unparseable |

```jsonc
{
  "scanned": 128,
  "health": 94,
  "duplicateBlocks": 3,
  "gate": { "state": "pass", "configured": true, "reason": "all metrics met" },
  "basisComplete": true   // false means this conclusion is untrustworthy; don't use it as compliance evidence
}
```

> Returning `3` instead of `0` when no gate is configured is deliberate: that way "I just ran it to look" won't be misread in CI as "check passed". To let it pass, explicitly write `--max-issues 9999`.
>
> **Exit-code change**: gate failure historically returned `1`; it's now unified to the family convention `2` (`0` pass / `2` fail / `3` inconclusive).

All numeric parameters must be **valid integers**: `--min-lines` must be `>= 1` (`0` degenerates the n-gram window into an empty string and judges the whole file as mutually duplicated), `--max-issues` / `--max-lines` must be `>= 0`; missing value, empty string, decimal, trailing junk (e.g. `5abc`) all exit `2`. `5abc` is especially critical — `parseInt('5abc') === 5` silently truncates a misspelled gate value, leaving the gate completely ineffective.

## How it works

1. **Character-by-character tokenizer strips noise**: comment and string-literal positions become spaces, but newlines are preserved (line numbers stay aligned). String contents are normalized to a placeholder `_`, so copies that are "logically identical but differ in strings" are correctly identified as duplicates.
2. **Regex context-awareness**: a `/regex/` literal won't have its inner quotes misread as a string (a classic zero-dependency SAST pitfall).
3. **Line normalization**: each line is trimmed and internal whitespace collapsed.
4. **Line-hash n-gram sliding window**: for every contiguous `--min-lines` lines, compute a block fingerprint; identical fingerprints are grouped.
5. **Interval merge + cross-file aggregation**: overlapping windows are merged into continuous duplicate blocks, and block fingerprints are counted across files for "copy count".
6. **Severity-weighted health score**: more duplicate lines, more copies, and cross-file duplication all raise severity.

## Severity

| Level | Trigger |
| --- | --- |
| `HIGH` | block ≥ 15 lines **or** cross-file duplicate **or** appears ≥ 4 times |
| `MED` | block ≥ 8 lines **or** appears ≥ 2 times |
| `low` | the rest |

## Health score

`health = clamp(100 - extraDuplicateLines / totalLines × 200, 0, 100)`. Extra duplicate lines = Σ (block lines × (copies − 1)). Zero duplicates = 100.

## How it differs from jscpd

| | dupscan | jscpd |
| --- | --- | --- |
| Dependencies | zero-dependency single file | needs `npm install` + config |
| Scope | JS/TS-focused, deterministic | cross-language generalization |
| CI gate | built-in `--max-issues` / `--max-lines` / `--fail-on-high` | needs extra integration |
| Positioning | one member of the out-of-the-box zero-dependency CLI family | general-purpose duplication detection |

## Same-family zero-dependency CLIs

`devdoctor` (dependency checkup) · `testlite` (test hygiene) · `debtlens` (tech debt) · `a11ydoctor` (frontend a11y) · `awaitscan` (async performance) · `cycscan` (structural complexity) · `secscan` (security anti-patterns) · **`dupscan` (duplicate code)**

## Caveats

Cross-file duplication is often a real signal of a "shared library / shared pattern" (e.g. many files share the same CLI skeleton) — that's tech debt worth governing, not a false positive. Just set your CI tolerance with `--max-issues` / `--max-lines`.

## License

MIT

---

## Author

Maintained by **huanweide** · [GitHub](https://github.com/huanweide)

## CI gate usage

Runs out of the box in CI: run it in your pipeline, it prints the health score and severity and explicitly prints the gate state; if an item is unmet it ends with exit code `2`, and if it cannot conclude it ends with `3` — **only a genuinely judged pass is `0`** (see "Usage" above).

## Test

```bash
node --test          # 37 groups: unit tests + spawn-level smoke (Node >= 18)
```

`test/smoke-cli.js` really spawns a process to verify the **exit-code contract**. This layer is not skippable: the `node --test` unit tests only test exported functions and never touch `process.exitCode`, so changing an exit code leaves unit tests all green.

## Portability · zero-dependency promise

- Zero runtime dependencies: uses only one Node built-in module, no `npm install`.
- Single file: the whole tool is one `index.js`, copy it into any repo and it works.
- Offline / cross-platform: Node 18+ is enough, no network, no OS preference.
- One command: `node index.js --root ./src` (see Usage above).

← [Back to the zero-dependency CLI family overview](https://github.com/huanweide/family-showcase)
