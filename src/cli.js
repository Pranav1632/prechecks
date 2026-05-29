#!/usr/bin/env node

import { Command } from 'commander';
import { historyCommand } from './commands/history.js';
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

program
  .command('history')
  .description('Manage historical replay payloads from the local Replay Store.')
  .action(async () => {
    await historyCommand();
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
