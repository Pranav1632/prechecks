export const AI_RESPONSE_SCHEMA = {
  riskScore: 'number 0-100',
  category: 'behavioral | security | metrics | mixed | none',
  rootCause: 'short technical diagnosis',
  fixSuggestion: 'primary fix recommendation',
  confidence: 'number 0-1',
  options: [
    {
      label: 'Option A',
      kind: 'secure | performance | maintainable | behavioral',
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
    'Analyze behavioral divergences, security findings, and code metrics.',
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
    divergences: report.sandbox?.divergences ?? [],
    securityFindings: report.securityFindings ?? [],
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
