import { extname } from 'node:path';
import { analyzeRisk } from '../ai/gateway.js';
import { parseUnifiedDiff } from '../analysis/diff-parser.js';
import { findFunctionInSource, isolateModifiedFunctions } from '../analysis/function-isolator.js';
import { analyzeSecurityFindings } from '../analysis/security-audit.js';
import {
  ensureGitRepository,
  getCurrentHead,
  getHeadFileContent,
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
  const removedFunctions = [];
  const parseFailures = [];

  for (const file of candidates) {
    const diffFile = diffFiles.find((entry) => entry.newPath === file.path);

    if (
      !diffFile ||
      (diffFile.newChangedLineRanges.length === 0 && diffFile.oldChangedLineRanges.length === 0)
    ) {
      continue;
    }

    try {
      const source = await getStagedFileContent(repo.root, file.path);
      let newRangeFunctions = [];

      try {
        newRangeFunctions = isolateModifiedFunctions({
          filePath: file.path,
          source,
          changedLineRanges: diffFile.newChangedLineRanges,
          metrics
        });
      } catch (error) {
        const previousFunctions = await findPreviousFunctionsTouchedByOldRanges({
          repoRoot: repo.root,
          filePath: diffFile.oldPath,
          oldChangedLineRanges: diffFile.oldChangedLineRanges,
          metrics
        });

        parseFailures.push({
          filePath: file.path,
          message: error.message,
          oldChangedLineRanges: diffFile.oldChangedLineRanges,
          newChangedLineRanges: diffFile.newChangedLineRanges,
          previousFunctions: previousFunctions.map(compactFunctionForFailure)
        });
        continue;
      }

      const oldRangeImpact = await findFunctionsTouchedByOldRanges({
        repoRoot: repo.root,
        oldFilePath: diffFile.oldPath,
        newFilePath: file.path,
        stagedSource: source,
        oldChangedLineRanges: diffFile.oldChangedLineRanges,
        metrics
      });
      const functions = dedupeFunctions([...newRangeFunctions, ...oldRangeImpact.modifiedFunctions]);

      modifiedFunctions.push(
        ...functions.map((fn) => ({
          ...fn,
          changedLineRanges: diffFile.changedLineRanges,
          oldChangedLineRanges: diffFile.oldChangedLineRanges,
          newChangedLineRanges: diffFile.newChangedLineRanges
        }))
      );
      removedFunctions.push(
        ...oldRangeImpact.removedFunctions.map((fn) => ({
          ...fn,
          removalLineRanges: diffFile.oldChangedLineRanges
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
    modifiedFunctions,
    removedFunctions: dedupeFunctions(removedFunctions),
    parseFailures
  });

  const sandboxReport = await runTwinSandboxComparisons({
    repoRoot: repo.root,
    modifiedFunctions,
    replayInputsByFunctionId
  });
  const securityFindings = audit ? analyzeSecurityFindings(modifiedFunctions) : [];
  const metricWarnings = modifiedFunctions.filter((fn) => fn.metrics?.isOverThreshold);

  const localReviewRequired =
    sandboxReport.divergences.length > 0 ||
    securityFindings.length > 0 ||
    metricWarnings.length > 0 ||
    removedFunctions.length > 0 ||
    parseFailures.length > 0;

  const report = {
    phase: 'phase-5',
    repoRoot: repo.root,
    auditEnabled: audit,
    metricsEnabled: metrics,
    stagedFiles: stagedFiles.map((file) => file.path),
    candidateFiles: candidates.map((file) => file.path),
    modifiedFunctions,
    removedFunctions: dedupeFunctions(removedFunctions),
    parseFailures,
    securityFindings,
    sandbox: sandboxReport,
    decision: localReviewRequired ? 'review' : 'pass'
  };

  report.aiAnalysis = await analyzeRisk(report, { enabled: ai });
  if (report.decision === 'pass' && report.aiAnalysis.riskScore > 0) {
    report.decision = 'review';
  }

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

function persistDiscoveredFunctions({ repoRoot, modifiedFunctions, removedFunctions = [], parseFailures = [] }) {
  const store = openReplayStore(repoRoot);

  try {
    const transaction = store.db.transaction(() => {
      const previousFunctions = [
        ...parseFailures.flatMap((failure) => failure.previousFunctions ?? []),
        ...modifiedFunctions.map((fn) => fn.previousFunction).filter(Boolean)
      ];

      for (const fn of dedupeFunctions([...modifiedFunctions, ...removedFunctions, ...previousFunctions])) {
        upsertFunctionIdentifier(store.db, fn);
      }
    });

    transaction();
    return listReplayInputsForModifiedFunctions(store.db, modifiedFunctions);
  } finally {
    closeReplayStore(store);
  }
}

function listReplayInputsForModifiedFunctions(db, modifiedFunctions) {
  const lookupIds = [
    ...new Set(modifiedFunctions.flatMap((fn) => [fn.id, fn.previousId]).filter(Boolean))
  ];
  const replayInputsByLookupId = listReplayInputsForFunctionIds(db, lookupIds);
  const replayInputsByFunctionId = new Map();

  for (const fn of modifiedFunctions) {
    const inputs = [
      ...(replayInputsByLookupId.get(fn.id) ?? []),
      ...(fn.previousId ? replayInputsByLookupId.get(fn.previousId) ?? [] : [])
    ];

    if (inputs.length > 0) {
      replayInputsByFunctionId.set(fn.id, dedupeReplayInputs(inputs));
    }
  }

  return replayInputsByFunctionId;
}

function dedupeReplayInputs(inputs) {
  return [...new Map(inputs.map((input) => [input.id, input])).values()];
}

async function findPreviousFunctionsTouchedByOldRanges({
  repoRoot,
  filePath,
  oldChangedLineRanges,
  metrics
}) {
  if (oldChangedLineRanges.length === 0) {
    return [];
  }

  const oldSource = await getHeadFileContent(repoRoot, filePath);
  if (!oldSource) {
    return [];
  }

  return pruneNestedFunctions(
    isolateModifiedFunctions({
      filePath,
      source: oldSource,
      changedLineRanges: oldChangedLineRanges,
      metrics
    })
  );
}

async function findFunctionsTouchedByOldRanges({
  repoRoot,
  oldFilePath,
  newFilePath,
  stagedSource,
  oldChangedLineRanges,
  metrics
}) {
  if (oldChangedLineRanges.length === 0) {
    return {
      modifiedFunctions: [],
      removedFunctions: []
    };
  }

  const oldSource = await getHeadFileContent(repoRoot, oldFilePath);
  if (!oldSource) {
    return {
      modifiedFunctions: [],
      removedFunctions: []
    };
  }

  const oldFunctions = isolateModifiedFunctions({
    filePath: oldFilePath,
    source: oldSource,
    changedLineRanges: oldChangedLineRanges,
    metrics
  });
  const modifiedFunctions = [];
  const removedFunctions = [];

  for (const oldFn of oldFunctions) {
    const stagedFn = findFunctionInSource({
      filePath: newFilePath,
      source: stagedSource,
      target: oldFn,
      metrics
    });

    if (stagedFn) {
      modifiedFunctions.push({
        ...stagedFn,
        previousId: oldFn.id,
        previousFilePath: oldFilePath,
        previousFunction: compactFunctionForFailure(oldFn)
      });
    } else {
      removedFunctions.push(oldFn);
    }
  }

  return {
    modifiedFunctions,
    removedFunctions: pruneNestedFunctions(removedFunctions)
  };
}

function dedupeFunctions(functions) {
  return [...new Map(functions.map((fn) => [fn.id, fn])).values()];
}

function compactFunctionForFailure(fn) {
  return {
    id: fn.id,
    name: fn.name,
    kind: fn.kind,
    filePath: fn.filePath,
    loc: fn.loc,
    metrics: fn.metrics
  };
}

function pruneNestedFunctions(functions) {
  return functions.filter(
    (fn) =>
      !functions.some(
        (candidate) =>
          candidate.id !== fn.id &&
          candidate.loc.start.line <= fn.loc.start.line &&
          candidate.loc.end.line >= fn.loc.end.line
      )
  );
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
          removedFunctionCount: report.removedFunctions.length,
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

      for (const fn of report.removedFunctions) {
        recordIncident(store.db, {
          runId,
          functionStableId: fn.id,
          category: 'structure:removed-function',
          severity: 'medium',
          title: `Removed function ${fn.name}() from ${fn.filePath}.`,
          details: fn
        });
      }

      for (const failure of report.parseFailures) {
        recordIncident(store.db, {
          runId,
          functionStableId: failure.previousFunctions?.[0]?.id ?? null,
          category: 'syntax:parse-failure',
          severity: 'high',
          title: `Unable to parse ${failure.filePath}.`,
          details: failure
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
  logger.raw(paint('dim', '------------------------------------------------------------'));
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
  logger.raw(`${tree('+')} Staged files: ${paint('bold', report.stagedFiles.length)}`);
  logger.raw(`${tree('+')} Modified functions: ${paint('bold', report.modifiedFunctions.length)}`);
  logger.raw(`${tree('+')} Removed functions: ${paint('bold', (report.removedFunctions ?? []).length)}`);
  logger.raw(`${tree('+')} Parse failures: ${paint('bold', report.parseFailures.length)}`);
  logger.raw(`${tree('+')} Sandbox comparisons: ${paint('bold', report.sandbox.comparisons.length)}`);
  logger.raw(`${tree('+')} Security findings: ${paint('bold', report.securityFindings.length)}`);
  logger.raw(`${tree('`')} Risk Oracle: ${paint(riskColor, paint('bold', `${report.aiAnalysis.riskScore}/100`))} ${paint('dim', `(${report.aiAnalysis.category})`)}`);
}

function printFunctionTree(report) {
  const removedFunctions = report.removedFunctions ?? [];

  if (report.modifiedFunctions.length === 0 && removedFunctions.length === 0) {
    return;
  }

  if (report.modifiedFunctions.length > 0) {
    logger.section('Changed Function Map');

    for (const [index, fn] of report.modifiedFunctions.entries()) {
      const branch = index === report.modifiedFunctions.length - 1 ? '`' : '+';
      const metric = fn.metrics
        ? ` ${riskTag(`C${fn.metrics.cyclomaticComplexity}`, fn.metrics.isOverThreshold ? 'yellow' : 'green')}`
        : '';

      logger.raw(
        `${tree(branch)} ${paint('bold', fn.name)} ${paint('dim', `(${fn.kind})`)}${metric}`
      );
      logger.raw(`${tree(index === report.modifiedFunctions.length - 1 ? ' ' : '|')}  ${paint('blue', `${fn.filePath}:${fn.loc.start.line}`)}`);
    }
  }

  if (removedFunctions.length > 0) {
    logger.section('Removed Function Map');

    for (const [index, fn] of removedFunctions.entries()) {
      const branch = index === removedFunctions.length - 1 ? '`' : '+';

      logger.raw(`${tree(branch)} ${paint('bold', fn.name)} ${paint('dim', `(${fn.kind})`)}`);
      logger.raw(`${tree(index === removedFunctions.length - 1 ? ' ' : '|')}  ${paint('blue', `${fn.filePath}:${fn.loc.start.line}`)}`);
    }
  }
}

function printRiskTree(report) {
  const metricWarnings = report.modifiedFunctions.filter((fn) => fn.metrics?.isOverThreshold);
  const skippedComparisons = report.sandbox.comparisons.filter((comparison) => comparison.status === 'skipped');
  const removedFunctions = report.removedFunctions ?? [];
  const parseFailures = report.parseFailures ?? [];

  logger.section('Risk Tree');

  if (
    report.sandbox.divergences.length === 0 &&
    report.securityFindings.length === 0 &&
    metricWarnings.length === 0 &&
    removedFunctions.length === 0 &&
    parseFailures.length === 0 &&
    skippedComparisons.length === 0
  ) {
    logger.raw(`${tree('`')} ${riskTag('OK', 'green')} No syntax, behavioral, structural, security, or metric warnings.`);
    return;
  }

  printParseFailures(parseFailures);
  printSecurityFindings(report.securityFindings);
  printRemovedFunctions(removedFunctions);
  printBehavioralDivergences(report.sandbox.divergences);
  printMetricWarnings(metricWarnings);
  printSkippedSandboxes(skippedComparisons);
}

function printSecurityFindings(findings) {
  if (findings.length === 0) {
    logger.raw(`${tree('+')} ${riskTag('SECURITY', 'green')} No findings`);
    return;
  }

  logger.raw(`${tree('+')} ${riskTag('SECURITY', 'red')} ${findings.length} finding(s)`);

  for (const finding of findings) {
    logger.raw(`${tree('|  +')} ${severityTag(finding.severity)} ${finding.message}`);
    logger.raw(`${tree('|  |')} ${paint('blue', `${finding.filePath}:${finding.line}`)} ${paint('dim', finding.ruleId)}`);
  }
}

function printParseFailures(failures) {
  if (failures.length === 0) {
    logger.raw(`${tree('+')} ${riskTag('SYNTAX', 'green')} No parse failures`);
    return;
  }

  logger.raw(`${tree('+')} ${riskTag('SYNTAX', 'red')} ${failures.length} file(s) failed to parse`);

  for (const failure of failures) {
    logger.raw(`${tree('|  +')} ${severityTag('high')} ${failure.filePath}: ${shortParseMessage(failure.message)}`);
    logger.raw(`${tree('|  |')} ${paint('dim', 'Staged file is invalid JavaScript/TypeScript. Fix syntax before committing.')}`);

    if (failure.previousFunctions?.length > 0) {
      logger.raw(
        `${tree('|  |')} ${paint('dim', `Previous touched function(s): ${failure.previousFunctions.map((fn) => `${fn.name}()`).join(', ')}`)}`
      );
    }
  }
}

function shortParseMessage(message) {
  return message.replace(/^Unable to parse [^:]+:\s*/, '');
}

function printRemovedFunctions(functions) {
  if (functions.length === 0) {
    logger.raw(`${tree('+')} ${riskTag('STRUCTURE', 'green')} No removed functions`);
    return;
  }

  logger.raw(`${tree('+')} ${riskTag('STRUCTURE', 'yellow')} ${functions.length} removed function(s)`);

  for (const fn of functions) {
    logger.raw(`${tree('|  +')} ${severityTag('medium')} Removed ${fn.name}(); verify callers and props were updated.`);
    logger.raw(`${tree('|  |')} ${paint('blue', `${fn.filePath}:${fn.loc.start.line}`)} ${paint('dim', fn.kind)}`);
  }
}

function printBehavioralDivergences(divergences) {
  if (divergences.length === 0) {
    logger.raw(`${tree('+')} ${riskTag('BEHAVIOR', 'green')} No divergences`);
    return;
  }

  logger.raw(`${tree('+')} ${riskTag('BEHAVIOR', 'yellow')} ${divergences.length} divergence(s)`);

  for (const divergence of divergences) {
    logger.raw(`${tree('|  +')} ${severityTag(divergence.severity)} ${divergence.message}`);
    logger.raw(`${tree('|  |')} ${paint('dim', divergence.functionId)}`);
  }
}

function printMetricWarnings(functions) {
  if (functions.length === 0) {
    logger.raw(`${tree('+')} ${riskTag('METRICS', 'green')} Complexity within threshold`);
    return;
  }

  logger.raw(`${tree('+')} ${riskTag('METRICS', 'yellow')} ${functions.length} warning(s)`);

  for (const fn of functions) {
    logger.raw(
      `${tree('|  +')} ${severityTag('medium')} ${fn.name} complexity ${fn.metrics.cyclomaticComplexity} > ${fn.metrics.threshold}`
    );
    logger.raw(`${tree('|  |')} ${paint('blue', `${fn.filePath}:${fn.loc.start.line}`)}`);
  }
}

function printSkippedSandboxes(comparisons) {
  if (comparisons.length === 0) {
    logger.raw(`${tree('`')} ${riskTag('REPLAY', 'green')} Replay inputs available`);
    return;
  }

  logger.raw(`${tree('`')} ${riskTag('REPLAY', 'cyan')} ${comparisons.length} sandbox check(s) skipped`);

  for (const comparison of comparisons.slice(0, 5)) {
    logger.raw(`${tree('   +')} ${comparison.functionName}: ${paint('dim', comparison.reason)}`);
  }

  if (comparisons.length > 5) {
    logger.raw(`${tree('   `')} ${paint('dim', `${comparisons.length - 5} more skipped checks`)}`);
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
