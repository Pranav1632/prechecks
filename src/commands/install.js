import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureGitRepository } from '../git/repository.js';
import {
  BTM_HOOK_MARKER,
  buildPreCommitHook,
  getHookStatus,
  resolvePreCommitHookPath
} from '../git/hooks.js';
import { BtmError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

const cliPath = fileURLToPath(new URL('../cli.js', import.meta.url));

export async function installCommand({ force = false } = {}) {
  const repo = await ensureGitRepository();
  const hookPath = await resolvePreCommitHookPath(repo.root);
  const status = await getHookStatus(hookPath);

  if (status.exists && !status.isManaged && !force) {
    throw new BtmError(
      [
        'A pre-commit hook already exists and is not managed by BTM.',
        `Existing hook: ${hookPath}`,
        'Run `btm install --force` to back it up and replace it.'
      ].join('\n')
    );
  }

  if (status.exists && !status.isManaged && force) {
    const backupPath = await backupExistingHook(hookPath);
    logger.warn(`Backed up existing pre-commit hook to ${backupPath}`);
  }

  await mkdir(dirname(hookPath), { recursive: true });
  await writeFile(hookPath, buildPreCommitHook({ cliPath }), 'utf8');
  await markExecutable(hookPath);

  logger.success(`BTM pre-commit hook installed in ${repo.root}`);
  logger.info(`Hook: ${hookPath}`);
}

export async function uninstallCommand() {
  const repo = await ensureGitRepository();
  const hookPath = await resolvePreCommitHookPath(repo.root);
  const status = await getHookStatus(hookPath);

  if (!status.exists) {
    logger.info('No pre-commit hook is installed.');
    return;
  }

  if (!status.isManaged) {
    throw new BtmError(
      [
        'Refusing to remove an unmanaged pre-commit hook.',
        `Existing hook: ${hookPath}`
      ].join('\n')
    );
  }

  await rm(hookPath);
  logger.success('BTM pre-commit hook removed.');
}

async function backupExistingHook(hookPath) {
  const timestamp = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-');
  const backupPath = join(dirname(hookPath), `${basename(hookPath)}.btm-backup-${timestamp}`);

  const contents = await readFile(hookPath, 'utf8');
  if (contents.includes(BTM_HOOK_MARKER)) {
    return hookPath;
  }

  await rename(hookPath, backupPath);
  return backupPath;
}

async function markExecutable(hookPath) {
  try {
    await chmod(hookPath, 0o755);
  } catch {
    // Windows filesystems may ignore POSIX modes; Git for Windows still executes hooks via sh.
  }
}
