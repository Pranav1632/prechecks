import { extname } from 'node:path';
import { analyzeRisk } from '../ai/gateway.js';
import { parseUnifiedDiff } from '../analysis/diff-parser.js';
import { isolateModifiedFunctions } from '../analysis/function-isolator.js';
import { analyzeSecurityFindings } from '../analysis/security-audit.js';
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
import { showDecisionDashboard } from '../ui/dashboard.js';
import { BtmError } from '../utils/errors.js';
import { logger, paint } from '../utils/logger.js';

const SUPPORTED_EXTENSIONS = new Set(['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx']);

export async function runCommand({ audit = false, metrics = false, ai = true, json = false } = {}) {
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
  const securityFindings = audit ? analyzeSecurityFindings(modifiedFunctions) : [];
  const metricWarnings = modifiedFunctions.filter((fn) => fn.metrics?.isOverThreshold);

  const report = {
    phase: 'phase-5',
    repoRoot: repo.root,
    auditEnabled: audit,
    metricsEnabled: metrics,
    stagedFiles: stagedFiles.map((file) => file.path),
    candidateFiles: candidates.map((file) => file.path),
    modifiedFunctions,
    parseFailures,
    securityFindings,
    sandbox: sandboxReport,
    decision:
      sandboxReport.divergences.length > 0 || securityFindings.length > 0 || metricWarnings.length > 0
        ? 'review'
        : 'pass'
  };

  report.aiAnalysis = await analyzeRisk(report, { enabled: ai });

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

  const decision = await showDecisionDashboard({
    report,
    aiAnalysis: report.aiAnalysis
  });

  if (decision === 'abort') {
    throw new BtmError('Commit aborted by BTM.', { exitCode: 1 });
  }
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
          securityFindingCount: report.securityFindings.length,
          comparisonCount: report.sandbox.comparisons.length,
          divergenceCount: report.sandbox.divergences.length,
          riskScore: report.aiAnalysis.riskScore
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

      for (const finding of report.securityFindings) {
        recordIncident(store.db, {
          runId,
          functionStableId: finding.functionId,
          category: `security:${finding.ruleId}`,
          severity: finding.severity,
          title: finding.message,
          details: finding
        });
      }

      for (const fn of report.modifiedFunctions) {
        if (!fn.metrics?.isOverThreshold) {
          continue;
        }

        recordIncident(store.db, {
          runId,
          functionStableId: fn.id,
          category: 'metrics:cyclomatic-complexity',
          severity: 'medium',
          title: `Cyclomatic Complexity for ${fn.name}() is ${fn.metrics.cyclomaticComplexity}.`,
          details: fn.metrics
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
  logger.raw('');
  logger.header('BTM Core Pipeline Triggered');
  logger.raw(paint('dim', '────────────────────────────────────────────────────────────'));
  logger.highlight('[AUDIT]', report.auditEnabled ? 'Security audit enabled' : 'Security audit disabled', report.auditEnabled ? 'green' : 'dim');
  logger.highlight('[METRICS]', report.metricsEnabled ? 'Code metrics enabled' : 'Code metrics disabled', report.metricsEnabled ? 'green' : 'dim');
  logger.highlight('[AI]', `${report.aiAnalysis.provider} risk analysis`, report.aiAnalysis.riskScore > 0 ? 'yellow' : 'green');
  logger.raw('');
  logger.info('Analyzing staged AST and preparing ghost sandboxes...');

  if (report.stagedFiles.length === 0) {
    logger.info('No staged files detected. Nothing to inspect.');
    return;
  }

  printSummary(report);
  printFunctionTree(report);
  printRiskTree(report);

  for (const failure of report.parseFailures) {
    logger.warn(`AST parse warning for ${failure.filePath}: ${failure.message}`);
  }

  if (report.decision === 'review') {
    logger.section('Recommendation');
    logger.raw(`${riskTag('ACTION', 'yellow')} ${report.aiAnalysis.fixSuggestion}`);
    return;
  }

  logger.raw('');
  logger.success('Phase 5 DevSecOps analysis complete. Commit may continue.');
}

function printSummary(report) {
  const riskColor = colorForRiskScore(report.aiAnalysis.riskScore);

  logger.section('Summary');
  logger.raw(`${tree('├')} Staged files: ${paint('bold', report.stagedFiles.length)}`);
  logger.raw(`${tree('├')} Modified functions: ${paint('bold', report.modifiedFunctions.length)}`);
  logger.raw(`${tree('├')} Sandbox comparisons: ${paint('bold', report.sandbox.comparisons.length)}`);
  logger.raw(`${tree('├')} Security findings: ${paint('bold', report.securityFindings.length)}`);
  logger.raw(`${tree('└')} Risk Oracle: ${paint(riskColor, paint('bold', `${report.aiAnalysis.riskScore}/100`))} ${paint('dim', `(${report.aiAnalysis.category})`)}`);
}

function printFunctionTree(report) {
  if (report.modifiedFunctions.length === 0) {
    return;
  }

  logger.section('Changed Function Map');

  for (const [index, fn] of report.modifiedFunctions.entries()) {
    const branch = index === report.modifiedFunctions.length - 1 ? '└' : '├';
    const metric = fn.metrics
      ? ` ${riskTag(`C${fn.metrics.cyclomaticComplexity}`, fn.metrics.isOverThreshold ? 'yellow' : 'green')}`
      : '';

    logger.raw(
      `${tree(branch)} ${paint('bold', fn.name)} ${paint('dim', `(${fn.kind})`)}${metric}`
    );
    logger.raw(`${tree(index === report.modifiedFunctions.length - 1 ? ' ' : '│')}  ${paint('blue', `${fn.filePath}:${fn.loc.start.line}`)}`);
  }
}

function printRiskTree(report) {
  const metricWarnings = report.modifiedFunctions.filter((fn) => fn.metrics?.isOverThreshold);
  const skippedComparisons = report.sandbox.comparisons.filter((comparison) => comparison.status === 'skipped');

  logger.section('Risk Tree');

  if (
    report.sandbox.divergences.length === 0 &&
    report.securityFindings.length === 0 &&
    metricWarnings.length === 0 &&
    skippedComparisons.length === 0
  ) {
    logger.raw(`${tree('└')} ${riskTag('OK', 'green')} No behavioral, security, or metric warnings.`);
    return;
  }

  printSecurityFindings(report.securityFindings);
  printBehavioralDivergences(report.sandbox.divergences);
  printMetricWarnings(metricWarnings);
  printSkippedSandboxes(skippedComparisons);
}

function printSecurityFindings(findings) {
  if (findings.length === 0) {
    logger.raw(`${tree('├')} ${riskTag('SECURITY', 'green')} No findings`);
    return;
  }

  logger.raw(`${tree('├')} ${riskTag('SECURITY', 'red')} ${findings.length} finding(s)`);

  for (const finding of findings) {
    logger.raw(`${tree('│  ├')} ${severityTag(finding.severity)} ${finding.message}`);
    logger.raw(`${tree('│  │')} ${paint('blue', `${finding.filePath}:${finding.line}`)} ${paint('dim', finding.ruleId)}`);
  }
}

function printBehavioralDivergences(divergences) {
  if (divergences.length === 0) {
    logger.raw(`${tree('├')} ${riskTag('BEHAVIOR', 'green')} No divergences`);
    return;
  }

  logger.raw(`${tree('├')} ${riskTag('BEHAVIOR', 'yellow')} ${divergences.length} divergence(s)`);

  for (const divergence of divergences) {
    logger.raw(`${tree('│  ├')} ${severityTag(divergence.severity)} ${divergence.message}`);
    logger.raw(`${tree('│  │')} ${paint('dim', divergence.functionId)}`);
  }
}

function printMetricWarnings(functions) {
  if (functions.length === 0) {
    logger.raw(`${tree('├')} ${riskTag('METRICS', 'green')} Complexity within threshold`);
    return;
  }

  logger.raw(`${tree('├')} ${riskTag('METRICS', 'yellow')} ${functions.length} warning(s)`);

  for (const fn of functions) {
    logger.raw(
      `${tree('│  ├')} ${severityTag('medium')} ${fn.name} complexity ${fn.metrics.cyclomaticComplexity} > ${fn.metrics.threshold}`
    );
    logger.raw(`${tree('│  │')} ${paint('blue', `${fn.filePath}:${fn.loc.start.line}`)}`);
  }
}

function printSkippedSandboxes(comparisons) {
  if (comparisons.length === 0) {
    logger.raw(`${tree('└')} ${riskTag('REPLAY', 'green')} Replay inputs available`);
    return;
  }

  logger.raw(`${tree('└')} ${riskTag('REPLAY', 'cyan')} ${comparisons.length} sandbox check(s) skipped`);

  for (const comparison of comparisons.slice(0, 5)) {
    logger.raw(`${tree('   ├')} ${comparison.functionName}: ${paint('dim', comparison.reason)}`);
  }

  if (comparisons.length > 5) {
    logger.raw(`${tree('   └')} ${paint('dim', `${comparisons.length - 5} more skipped checks`)}`);
  }
}

function riskTag(label, color) {
  return paint(color, paint('bold', `[${label}]`));
}

function severityTag(severity) {
  const colors = {
    critical: 'red',
    high: 'red',
    medium: 'yellow',
    low: 'cyan'
  };

  return riskTag(severity.toUpperCase(), colors[severity] ?? 'cyan');
}

function colorForRiskScore(score) {
  if (score >= 70) {
    return 'red';
  }

  if (score >= 30) {
    return 'yellow';
  }

  return 'green';
}

function tree(symbol) {
  return paint('dim', symbol);
}
