#!/usr/bin/env node

import { Command } from 'commander';
import { installCommand } from './commands/install.js';
import { precommitCommand } from './commands/precommit.js';
import { statusCommand } from './commands/status.js';
import { formatCliError } from './utils/errors.js';
import { logger } from './utils/logger.js';

const program = new Command();

program
  .name('btm')
  .description('Behavioral Time-Diff: pre-commit behavioral regression detection.')
  .version('0.1.0');

program
  .command('install')
  .description('Install the BTM managed pre-commit hook in the current Git repository.')
  .option('-f, --force', 'Back up and replace an existing unmanaged pre-commit hook.')
  .action(async (options) => {
    await installCommand({ force: Boolean(options.force) });
  });

program
  .command('status')
  .description('Show Git repository and BTM hook status.')
  .action(async () => {
    await statusCommand();
  });

program
  .command('precommit')
  .description('Run the BTM pre-commit interception pipeline.')
  .option('--json', 'Print the Phase 1 interception report as JSON.')
  .action(async (options) => {
    await precommitCommand({ json: Boolean(options.json) });
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
