import { extname } from 'node:path';
import { parseUnifiedDiff } from '../analysis/diff-parser.js';
import { isolateModifiedFunctions } from '../analysis/function-isolator.js';
import {
  ensureGitRepository,
  getCurrentHead,
  getStagedDiff,
  getStagedFileContent,
  getStagedFiles
} from '../git/repository.js';
import {
  closeReplayStore,
  listReplayInputsForFunctionIds,
  openReplayStore,
  recordAnalysisRun,
  recordExecutionObservation,
  recordIncident,
  upsertFunctionIdentifier
} from '../store/replay-store.js';
import { runTwinSandboxComparisons } from '../sandbox/orchestrator.js';
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

  const replayInputsByFunctionId = persistDiscoveredFunctions({
    repoRoot: repo.root,
    modifiedFunctions
  });

  const sandboxReport = await runTwinSandboxComparisons({
    repoRoot: repo.root,
    modifiedFunctions,
    replayInputsByFunctionId
  });

  const report = {
    phase: 'phase-4',
    repoRoot: repo.root,
    auditEnabled: audit,
    metricsEnabled: metrics,
    stagedFiles: stagedFiles.map((file) => file.path),
    candidateFiles: candidates.map((file) => file.path),
    modifiedFunctions,
    parseFailures,
    sandbox: sandboxReport,
    decision: sandboxReport.divergences.length > 0 ? 'review' : 'pass'
  };

  persistAnalysisReport({
    repoRoot: repo.root,
    report,
    gitHead: await getCurrentHead(repo.root)
  });

  if (json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return;
  }

  printHumanReport(report);
}

function persistDiscoveredFunctions({ repoRoot, modifiedFunctions }) {
  const store = openReplayStore(repoRoot);

  try {
    const transaction = store.db.transaction(() => {
      for (const fn of modifiedFunctions) {
        upsertFunctionIdentifier(store.db, fn);
      }
    });

    transaction();
    return listReplayInputsForFunctionIds(
      store.db,
      modifiedFunctions.map((fn) => fn.id)
    );
  } finally {
    closeReplayStore(store);
  }
}

function persistAnalysisReport({ repoRoot, report, gitHead }) {
  const store = openReplayStore(repoRoot);

  try {
    const transaction = store.db.transaction(() => {
      const runId = recordAnalysisRun(store.db, {
        command: 'run',
        gitHead,
        summary: {
          phase: report.phase,
          auditEnabled: report.auditEnabled,
          metricsEnabled: report.metricsEnabled,
          stagedFileCount: report.stagedFiles.length,
          modifiedFunctionCount: report.modifiedFunctions.length,
          parseFailureCount: report.parseFailures.length,
          comparisonCount: report.sandbox.comparisons.length,
          divergenceCount: report.sandbox.divergences.length
        }
      });

      for (const comparison of report.sandbox.comparisons) {
        if (!comparison.inputId) {
          continue;
        }

        recordExecutionObservation(store.db, {
          runId,
          functionStableId: comparison.functionId,
          inputId: comparison.inputId,
          variant: 'head',
          observation: comparison.oldObservation
        });

        recordExecutionObservation(store.db, {
          runId,
          functionStableId: comparison.functionId,
          inputId: comparison.inputId,
          variant: 'staged',
          observation: comparison.newObservation
        });
      }

      for (const divergence of report.sandbox.divergences) {
        recordIncident(store.db, {
          runId,
          functionStableId: divergence.functionId,
          category: `behavioral:${divergence.type}`,
          severity: divergence.severity,
          title: divergence.message,
          details: divergence
        });
      }
    });

    transaction();
    report.replayStorePath = store.path;
  } finally {
    closeReplayStore(store);
  }
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
  logger.info(`Sandbox comparisons: ${report.sandbox.comparisons.length}`);

  for (const fn of report.modifiedFunctions) {
    logger.info(`${fn.filePath}:${fn.loc.start.line} ${fn.name} (${fn.kind})`);

    if (report.metricsEnabled && fn.metrics?.isOverThreshold) {
      logger.warn(
        `METRICS WARNING: Cyclomatic Complexity for ${fn.name}() is ${fn.metrics.cyclomaticComplexity} (Recommended < ${fn.metrics.threshold}).`
      );
    }
  }

  for (const comparison of report.sandbox.comparisons) {
    if (comparison.status === 'skipped') {
      logger.info(`${comparison.functionName}: skipped sandbox (${comparison.reason})`);
    }
  }

  for (const divergence of report.sandbox.divergences) {
    logger.warn(`BEHAVIORAL DIVERGENCE: ${divergence.message}`);
  }

  for (const failure of report.parseFailures) {
    logger.warn(`AST parse warning for ${failure.filePath}: ${failure.message}`);
  }

  if (report.auditEnabled) {
    logger.info('Security audit AST rules arrive in a later Phase 5 adapter pass.');
  }

  if (report.decision === 'review') {
    logger.warn('Phase 4 detected behavioral divergence. Review before committing.');
    return;
  }

  logger.success('Phase 4 twin sandbox analysis complete. Commit may continue.');
}
