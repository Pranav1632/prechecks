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
  const raw = await git.raw(['diff', '--cached', '--name-status', '-z', '--diff-filter=ACMR']);

  if (!raw) {
    return [];
  }

  return parseNameStatusOutput(raw);
}

export async function getStagedDiff(repoRoot) {
  const git = gitFor(repoRoot);
  return git.raw(['diff', '--cached', '--unified=0', '--diff-filter=ACMR']);
}

export async function getStagedFileContent(repoRoot, filePath) {
  const git = gitFor(repoRoot);
  return git.raw(['show', `:${filePath}`]);
}

export async function getHeadFileContent(repoRoot, filePath) {
  const git = gitFor(repoRoot);

  try {
    return await git.raw(['show', `HEAD:${filePath}`]);
  } catch {
    return null;
  }
}

export async function getCurrentHead(repoRoot) {
  const git = gitFor(repoRoot);

  try {
    return await git.revparse(['--verify', 'HEAD']);
  } catch {
    return null;
  }
}

function parseNameStatusOutput(raw) {
  const parts = raw.split('\0').filter(Boolean);
  const files = [];

  for (let index = 0; index < parts.length; index += 1) {
    const status = parts[index];
    let path = parts[index + 1];

    if (!path) {
      break;
    }

    if (status.startsWith('R') || status.startsWith('C')) {
      path = parts[index + 2];
      index += 2;
    } else {
      index += 1;
    }

    files.push({
      status,
      path,
      extension: extname(path)
    });
  }

  return files;
}
