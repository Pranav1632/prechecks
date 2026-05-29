# BTM: Behavioral Time-Diff

BTM, the Temporal Ghost Engine, is a local-first developer CLI that will evolve from a Git pre-commit interceptor into a behavioral regression detector. Instead of stopping at text diffs, BTM will isolate changed functions, replay historical inputs against old and staged code, compare runtime behavior, and ask an AI analysis layer to diagnose risk before the commit lands.

## Current MVP Command Shape

BTM now uses four primary commands:

- `btm init`: install the managed Git hook.
- `btm run`: inspect staged code. Supports `--audit` and `--metrics`.
- `btm test <file>`: analyze a single file without committing.
- `btm history`: placeholder for the Phase 3 Replay Store manager.

## Setup

```bash
npm install
npm run check
```

During local development, run commands through npm:

```bash
npm run btm -- --help
npm run btm -- status
```

After publishing or linking the package, the binary is available as:

```bash
btm --help
```

## Commands

```bash
btm init
```

Installs a managed `.git/hooks/pre-commit` hook in the current Git repository. If an unmanaged hook already exists, BTM refuses to overwrite it unless `--force` is provided. When forced, the old hook is backed up first.

```bash
btm run --metrics
```

Parses the staged Git diff, isolates modified JavaScript/TypeScript function blocks with Babel AST ranges, and calculates Cyclomatic Complexity for each modified function.

```bash
btm test src/example.js --metrics
```

Analyzes all function blocks in a single file without needing staged Git changes.

## Installing The Hook While Developing BTM

From inside any Git repository that should use this local checkout:

```bash
node C:/Users/ACER/OneDrive/Documents/cli/src/cli.js init
```

The generated hook prefers a `BTM_CLI_PATH` environment override, then a globally available `btm`, then `npx --no-install btm`. This keeps the hook usable for global installs, linked package installs, and local development.

## Architecture Boundary Created In Phase 1

The pre-commit command currently produces a lightweight interception report:

```json
{
  "repoRoot": "...",
  "stagedFiles": ["src/example.js"],
  "phase": "phase-1"
}
```

Phase 2 emits AST-targeted function blocks like this:

```json
{
  "phase": "phase-2",
  "modifiedFunctions": [
    {
      "name": "login",
      "kind": "FunctionDeclaration",
      "loc": { "start": { "line": 10 }, "end": { "line": 42 } },
      "metrics": {
        "cyclomaticComplexity": 24,
        "threshold": 15,
        "isOverThreshold": true
      }
    }
  ]
}
```
