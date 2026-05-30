# BTM: Behavioral Time-Diff

BTM, the Temporal Ghost Engine, is a local-first developer CLI that will evolve from a Git pre-commit interceptor into a behavioral regression detector. Instead of stopping at text diffs, BTM will isolate changed functions, replay historical inputs against old and staged code, compare runtime behavior, and ask an AI analysis layer to diagnose risk before the commit lands.

## Current MVP Command Shape

BTM now uses four primary commands:

- `btm init`: install the managed Git hook.
- `btm run`: inspect staged code. Supports `--audit` and `--metrics`.
- `btm test <file>`: analyze a single file without committing.
- `btm history`: manage local SQLite replay payloads.

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

```bash
btm history init
btm history stats
btm history functions
btm history add "src/example.js:add:1:7" --payload "{\"args\":[1,2]}" --label "simple add"
btm history add "src/example.js:add:1:7" --payload-file payload.json
btm history delete 1
```

Initializes and manages the local `btm.db` Replay Store. Phase 3 records discovered function identifiers from `btm run`, stores replay input payloads, and creates the relational tables Phase 4 will use for twin sandbox observations.

## Phase 4 Twin Sandbox Flow

Phase 4 executes stored replay payloads against both the `HEAD` version and the staged version of a modified function:

```bash
node ./src/cli.js run --metrics
```

When replay inputs exist for a modified function, BTM:

- reads the old function body from `HEAD`;
- reads the staged function body from the Git index;
- executes both in separate `isolated-vm` V8 isolates;
- captures return values, thrown errors, and duration;
- records observations and incidents in `btm.db`;
- marks the run as `review` if behavior diverges.

Replay payloads use this JSON shape:

```json
{
  "args": [10, 4]
}
```

## Phase 5 DevSecOps Dashboard And AI Layer

Phase 5 adds opt-in security auditing, provider-agnostic AI analysis, and an interactive commit gate:

```bash
node ./src/cli.js run --audit --metrics
node ./src/cli.js run --audit --metrics --no-ai
```

AI provider selection is controlled with environment variables:

```bash
BTM_AI_PROVIDER=ollama
BTM_AI_MODEL=llama3
```

BTM also loads a `.env` file from the current repository or a parent directory. For example, create this file in the project where you run `btm`:

```bash
# .env
BTM_AI_PROVIDER=gemini
GEMINI_API_KEY=paste-your-key-here
BTM_AI_MODEL=gemini-2.5-flash
```

For OpenAI:

```bash
BTM_AI_PROVIDER=openai
OPENAI_API_KEY=paste-your-key-here
BTM_AI_MODEL=gpt-4o-mini
```

Supported provider values:

- `heuristic`: default local rules, no network.
- `ollama`: local Ollama model via the `ollama` package.
- `gemini`: Gemini via `GEMINI_API_KEY`.
- `openai`: OpenAI-compatible SDK via `OPENAI_API_KEY` and optional `OPENAI_BASE_URL`.

When a run finds behavioral divergence, security findings, or complexity warnings, BTM marks the decision as `review`. In a terminal, the Ink dashboard asks whether to abort or commit anyway. In non-interactive mode, BTM fails closed and aborts.

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
