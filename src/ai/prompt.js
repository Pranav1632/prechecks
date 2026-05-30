export const AI_RESPONSE_SCHEMA = {
  riskScore: 'number 0-100',
  category: 'syntax | behavioral | security | structural | metrics | mixed | none',
  rootCause: 'short technical diagnosis',
  fixSuggestion: 'primary fix recommendation',
  confidence: 'number 0-1',
  options: [
    {
      label: 'Option A',
      kind: 'syntax | secure | performance | maintainable | behavioral | structural',
      recommendation: 'actionable recommendation'
    }
  ]
};

export function buildAnalysisPrompt(report) {
  return [
    'You are the BTM Temporal Ghost Engine AI reviewer.',
    'Return strict JSON only. Do not include markdown.',
    'Use this schema:',
    JSON.stringify(AI_RESPONSE_SCHEMA, null, 2),
    'Analyze parse failures, behavioral divergences, security findings, removed functions, and code metrics.',
    'Function removals are allowed when the staged code still parses and stale references are cleaned up.',
    'Prefer concrete fixes over generic advice.',
    'Input report:',
    JSON.stringify(compactReport(report), null, 2)
  ].join('\n\n');
}

function compactReport(report) {
  return {
    phase: report.phase,
    auditEnabled: report.auditEnabled,
    metricsEnabled: report.metricsEnabled,
    decision: report.decision,
    parseFailures: report.parseFailures ?? [],
    divergences: report.sandbox?.divergences ?? [],
    securityFindings: report.securityFindings ?? [],
    removedFunctions: (report.removedFunctions ?? []).map((fn) => ({
      id: fn.id,
      name: fn.name,
      kind: fn.kind,
      filePath: fn.filePath,
      loc: fn.loc,
      code: fn.code
    })),
    metricWarnings: (report.modifiedFunctions ?? [])
      .filter((fn) => fn.metrics?.isOverThreshold)
      .map((fn) => ({
        functionId: fn.id,
        name: fn.name,
        filePath: fn.filePath,
        complexity: fn.metrics.cyclomaticComplexity,
        threshold: fn.metrics.threshold
      })),
    functions: (report.modifiedFunctions ?? []).map((fn) => ({
      id: fn.id,
      name: fn.name,
      filePath: fn.filePath,
      loc: fn.loc,
      code: fn.code
    }))
  };
}
