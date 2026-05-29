import { extname } from 'node:path';
import simpleGit from 'simple-git';
import { BtmError } from '../utils/errors.js';

export function gitFor(baseDir = process.cwd()) {
  return simpleGit({
    baseDir,
    binary: 'git',
    maxConcurrentProcesses: 1,
    trimmed: true
  });
}

export async function findGitRepository(baseDir = process.cwd()) {
  const git = gitFor(baseDir);
  const isRepo = await git.checkIsRepo();

  if (!isRepo) {
    return null;
  }

  const [root, gitDir] = await Promise.all([
    git.revparse(['--show-toplevel']),
    git.revparse(['--git-dir'])
  ]);

  return {
    root,
    gitDir
  };
}

export async function ensureGitRepository(baseDir = process.cwd()) {
  const repo = await findGitRepository(baseDir);

  if (!repo) {
    throw new BtmError('BTM must be run inside a Git repository.');
  }

  return repo;
}

export async function getStagedFiles(repoRoot) {
  const git = gitFor(repoRoot);
  const raw = await git.raw(['diff', '--cached', '--name-status', '--diff-filter=ACMR']);

  if (!raw.trim()) {
    return [];
  }

  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map(parseNameStatusLine);
}

export async function getStagedDiff(repoRoot) {
  const git = gitFor(repoRoot);
  return git.raw(['diff', '--cached', '--unified=0', '--diff-filter=ACMR']);
}

export async function getStagedFileContent(repoRoot, filePath) {
  const git = gitFor(repoRoot);
  return git.raw(['show', `:${filePath}`]);
}

function parseNameStatusLine(line) {
  const [status, ...pathParts] = line.split(/\s+/);
  const path = pathParts.join(' ');

  return {
    status,
    path,
    extension: extname(path)
  };
}
