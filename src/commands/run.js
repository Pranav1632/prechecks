import { extname } from 'node:path';
import { parseUnifiedDiff } from '../analysis/diff-parser.js';
import { isolateModifiedFunctions } from '../analysis/function-isolator.js';
import {
  ensureGitRepository,
  getStagedDiff,
  getStagedFileContent,
  getStagedFiles
} from '../git/repository.js';
import { logger } from '../utils/logger.js';

const SUPPORTED_EXTENSIONS = new Set(['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx']);

export async function runCommand({ audit = false, metrics = false, json = false } = {}) {
  const repo = await ensureGitRepository();
  const [stagedFiles, rawDiff] = await Promise.all([
    getStagedFiles(repo.root),
    getStagedDiff(repo.root)
  ]);

  const diffFiles = parseUnifiedDiff(rawDiff);
  const candidates = stagedFiles.filter((file) => SUPPORTED_EXTENSIONS.has(extname(file.path)));
  const modifiedFunctions = [];
  const parseFailures = [];

  for (const file of candidates) {
    const diffFile = diffFiles.find((entry) => entry.newPath === file.path);

    if (!diffFile || diffFile.changedLineRanges.length === 0) {
      continue;
    }

    try {
      const source = await getStagedFileContent(repo.root, file.path);
      const functions = isolateModifiedFunctions({
        filePath: file.path,
        source,
        changedLineRanges: diffFile.changedLineRanges,
        metrics
      });

      modifiedFunctions.push(
        ...functions.map((fn) => ({
          ...fn,
          changedLineRanges: diffFile.changedLineRanges
        }))
      );
    } catch (error) {
      parseFailures.push({
        filePath: file.path,
        message: error.message
      });
    }
  }

  const report = {
    phase: 'phase-2',
    repoRoot: repo.root,
    auditEnabled: audit,
    metricsEnabled: metrics,
    stagedFiles: stagedFiles.map((file) => file.path),
    candidateFiles: candidates.map((file) => file.path),
    modifiedFunctions,
    parseFailures,
    decision: 'pass'
  };

  if (json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return;
  }

  printHumanReport(report);
}

function printHumanReport(report) {
  logger.header('BTM Core Pipeline Triggered.');
  logger.info(`Security Audit Mode: ${report.auditEnabled ? 'ENABLED' : 'disabled'}`);
  logger.info(`Code Metrics Mode: ${report.metricsEnabled ? 'ENABLED' : 'disabled'}`);
  logger.info('Analyzing staged AST and preparing ghost sandboxes...');

  if (report.stagedFiles.length === 0) {
    logger.info('No staged files detected. Nothing to inspect.');
    return;
  }

  logger.info(`Staged files: ${report.stagedFiles.length}`);
  logger.info(`Modified functions isolated: ${report.modifiedFunctions.length}`);

  for (const fn of report.modifiedFunctions) {
    logger.info(`${fn.filePath}:${fn.loc.start.line} ${fn.name} (${fn.kind})`);

    if (report.metricsEnabled && fn.metrics?.isOverThreshold) {
      logger.warn(
        `METRICS WARNING: Cyclomatic Complexity for ${fn.name}() is ${fn.metrics.cyclomaticComplexity} (Recommended < ${fn.metrics.threshold}).`
      );
    }
  }

  for (const failure of report.parseFailures) {
    logger.warn(`AST parse warning for ${failure.filePath}: ${failure.message}`);
  }

  if (report.auditEnabled) {
    logger.info('Security audit AST rules arrive in a later Phase 5 adapter pass.');
  }

  logger.success('Phase 2 AST isolation complete. Commit may continue.');
}
