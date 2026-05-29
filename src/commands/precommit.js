import { ensureGitRepository, getStagedFiles } from '../git/repository.js';
import { logger } from '../utils/logger.js';

const SUPPORTED_PHASE_ONE_EXTENSIONS = new Set([
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.ts',
  '.tsx'
]);

export async function precommitCommand({ json = false } = {}) {
  const repo = await ensureGitRepository();
  const stagedFiles = await getStagedFiles(repo.root);
  const candidateFiles = stagedFiles.filter((file) => hasSupportedExtension(file.path));

  const report = {
    phase: 'phase-1',
    repoRoot: repo.root,
    stagedFiles: stagedFiles.map((file) => file.path),
    candidateFiles: candidateFiles.map((file) => file.path),
    decision: 'pass',
    reason: 'Phase 1 only verifies hook interception. Behavioral checks begin in Phase 2.'
  };

  if (json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return;
  }

  logger.header('BTM Temporal Ghost Engine');
  logger.info(`Repository: ${repo.root}`);

  if (stagedFiles.length === 0) {
    logger.info('No staged files detected. Nothing to inspect.');
    return;
  }

  logger.info(`Staged files: ${stagedFiles.length}`);
  logger.info(`Phase 2 AST candidates: ${candidateFiles.length}`);
  logger.success('Phase 1 interception complete. Commit may continue.');
}

function hasSupportedExtension(filePath) {
  const dotIndex = filePath.lastIndexOf('.');
  if (dotIndex === -1) {
    return false;
  }

  return SUPPORTED_PHASE_ONE_EXTENSIONS.has(filePath.slice(dotIndex));
}
