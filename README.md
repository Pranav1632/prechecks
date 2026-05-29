# BTM: Behavioral Time-Diff

BTM, the Temporal Ghost Engine, is a local-first developer CLI that will evolve from a Git pre-commit interceptor into a behavioral regression detector. Instead of stopping at text diffs, BTM will isolate changed functions, replay historical inputs against old and staged code, compare runtime behavior, and ask an AI analysis layer to diagnose risk before the commit lands.

## Phase 1 Scope

This phase establishes the project shell:

- Node.js ES Modules CLI package.
- Commander.js command surface.
- Git repository detection with `simple-git`.
- Local pre-commit hook registration.
- A managed `btm precommit` entry point that inspects staged files and leaves room for the later AST, replay, sandbox, diff, AI, and Ink UI phases.

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
btm install
```

Installs a managed `.git/hooks/pre-commit` hook in the current Git repository. If an unmanaged hook already exists, BTM refuses to overwrite it unless `--force` is provided. When forced, the old hook is backed up first.

```bash
btm status
```

Shows whether the current directory is inside a Git repository and whether BTM manages the pre-commit hook.

```bash
btm precommit
```

Runs the Phase 1 pre-commit interception path. For now it reports staged files and exits successfully. Later phases will plug AST targeting, replay execution, behavioral diffing, AI analysis, and the confirmation UI into this command.

## Installing The Hook While Developing BTM

From inside any Git repository that should use this local checkout:

```bash
node C:/Users/ACER/OneDrive/Documents/cli/src/cli.js install
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

Phase 2 will replace the placeholder report with AST-targeted function isolation while keeping the same command entry point.
