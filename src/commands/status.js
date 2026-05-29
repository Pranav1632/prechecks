import { getHookStatus, resolvePreCommitHookPath } from '../git/hooks.js';
import { findGitRepository } from '../git/repository.js';
import { logger } from '../utils/logger.js';

export async function statusCommand() {
  const repo = await findGitRepository();

  logger.header('BTM Status');

  if (!repo) {
    logger.warn('Current directory is not inside a Git repository.');
    return;
  }

  const hookPath = await resolvePreCommitHookPath(repo.root);
  const hookStatus = await getHookStatus(hookPath);

  logger.info(`Repository: ${repo.root}`);
  logger.info(`Git directory: ${repo.gitDir}`);
  logger.info(`Pre-commit hook: ${hookPath}`);

  if (!hookStatus.exists) {
    logger.warn('BTM hook is not installed.');
    return;
  }

  if (hookStatus.isManaged) {
    logger.success('BTM hook is installed and managed.');
    return;
  }

  logger.warn('A pre-commit hook exists, but it is not managed by BTM.');
}
