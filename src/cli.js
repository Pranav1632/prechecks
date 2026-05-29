#!/usr/bin/env node

import { Command } from 'commander';
import {
  historyAddCommand,
  historyDeleteCommand,
  historyFunctionsCommand,
  historyInitCommand,
  historyListCommand,
  historyStatsCommand
} from './commands/history.js';
import { installCommand } from './commands/install.js';
import { runCommand } from './commands/run.js';
import { statusCommand } from './commands/status.js';
import { testCommand } from './commands/test.js';
import { formatCliError } from './utils/errors.js';
import { logger } from './utils/logger.js';

const program = new Command();

program
  .name('btm')
  .description('Behavioral Time-Diff: pre-commit behavioral regression detection.')
  .version('0.1.0');

program
  .command('init')
  .description('Install the BTM managed pre-commit hook in the current Git repository.')
  .option('-f, --force', 'Back up and replace an existing unmanaged pre-commit hook.')
  .action(async (options) => {
    await installCommand({ force: Boolean(options.force) });
  });

program
  .command('run')
  .description('Run the BTM staged-code analysis pipeline.')
  .option('-a, --audit', 'Enable opt-in security audit analysis.')
  .option('-m, --metrics', 'Enable opt-in code metrics analysis.')
  .option('--json', 'Print the Phase 2 analysis report as JSON.')
  .action(async (options) => {
    await runCommand({
      audit: Boolean(options.audit),
      metrics: Boolean(options.metrics),
      json: Boolean(options.json)
    });
  });

program
  .command('test <file>')
  .description('Analyze a single file without requiring a Git commit.')
  .option('-m, --metrics', 'Enable opt-in code metrics analysis.')
  .option('--json', 'Print the file analysis report as JSON.')
  .action(async (file, options) => {
    await testCommand({
      file,
      metrics: Boolean(options.metrics),
      json: Boolean(options.json)
    });
  });

const history = program
  .command('history')
  .description('Manage historical replay payloads from the local Replay Store.')
  .option('-l, --limit <number>', 'Maximum rows to show.', parseInteger, 20)
  .action(async (options) => {
    await historyListCommand({ limit: options.limit });
  });

history
  .command('init')
  .description('Initialize the local SQLite Replay Store.')
  .action(async () => {
    await historyInitCommand();
  });

history
  .command('functions')
  .description('List function identifiers discovered by BTM.')
  .option('-l, --limit <number>', 'Maximum rows to show.', parseInteger, 20)
  .action(async (options) => {
    await historyFunctionsCommand({ limit: options.limit });
  });

history
  .command('add <functionId>')
  .description('Add a replay payload for a known function identifier.')
  .option('-p, --payload <json>', 'Replay payload JSON, for example {"args":[1,2]}.')
  .option('--payload-file <path>', 'Path to a JSON file containing the replay payload.')
  .option('--label <label>', 'Human-readable payload label.')
  .option('--source <source>', 'Payload source.', 'manual')
  .action(async (functionId, options) => {
    await historyAddCommand({
      functionId,
      payload: options.payload,
      payloadFile: options.payloadFile,
      label: options.label,
      source: options.source
    });
  });

history
  .command('delete <id>')
  .description('Delete a replay payload by id.')
  .action(async (id) => {
    await historyDeleteCommand({ id });
  });

history
  .command('stats')
  .description('Show Replay Store table counts.')
  .action(async () => {
    await historyStatsCommand();
  });

program
  .command('status')
  .description('Show Git repository and BTM hook status.')
  .action(async () => {
    await statusCommand();
  });

program
  .command('install', { hidden: true })
  .description('Alias for init.')
  .option('-f, --force', 'Back up and replace an existing unmanaged pre-commit hook.')
  .action(async (options) => {
    await installCommand({ force: Boolean(options.force) });
  });

program
  .command('precommit', { hidden: true })
  .description('Compatibility alias for run.')
  .option('-a, --audit', 'Enable opt-in security audit analysis.')
  .option('-m, --metrics', 'Enable opt-in code metrics analysis.')
  .option('--json', 'Print the Phase 2 analysis report as JSON.')
  .action(async (options) => {
    await runCommand({
      audit: Boolean(options.audit),
      metrics: Boolean(options.metrics),
      json: Boolean(options.json)
    });
  });

program
  .command('uninstall')
  .description('Remove the BTM managed pre-commit hook.')
  .action(async () => {
    const { uninstallCommand } = await import('./commands/install.js');
    await uninstallCommand();
  });

try {
  await program.parseAsync(process.argv);
} catch (error) {
  logger.error(formatCliError(error));
  process.exitCode = error.exitCode ?? 1;
}

function parseInteger(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? 20 : parsed;
}
