export function buildHeuristicAnalysis(report) {
  const divergences = report.sandbox?.divergences ?? [];
  const securityFindings = report.securityFindings ?? [];
  const metricWarnings = (report.modifiedFunctions ?? []).filter((fn) => fn.metrics?.isOverThreshold);

  const riskScore = Math.min(
    100,
    divergences.length * 35 +
      securityFindings.filter((finding) => finding.severity === 'critical').length * 40 +
      securityFindings.filter((finding) => finding.severity === 'high').length * 25 +
      metricWarnings.length * 15
  );

  const category = chooseCategory({ divergences, securityFindings, metricWarnings });

  return {
    provider: 'heuristic',
    riskScore,
    category,
    rootCause: buildRootCause({ divergences, securityFindings, metricWarnings }),
    fixSuggestion: buildFixSuggestion({ divergences, securityFindings, metricWarnings }),
    confidence: riskScore > 0 ? 0.72 : 0.9,
    options: buildOptions({ divergences, securityFindings, metricWarnings })
  };
}

function chooseCategory({ divergences, securityFindings, metricWarnings }) {
  const active = [
    divergences.length > 0 && 'behavioral',
    securityFindings.length > 0 && 'security',
    metricWarnings.length > 0 && 'metrics'
  ].filter(Boolean);

  if (active.length === 0) {
    return 'none';
  }

  return active.length > 1 ? 'mixed' : active[0];
}

function buildRootCause({ divergences, securityFindings, metricWarnings }) {
  if (divergences.length > 0) {
    return divergences[0].message;
  }

  if (securityFindings.length > 0) {
    return securityFindings[0].message;
  }

  if (metricWarnings.length > 0) {
    return `${metricWarnings[0].name} exceeds the maintainability complexity threshold.`;
  }

  return 'No high-risk behavioral, security, or metric issues were detected.';
}

function buildFixSuggestion({ divergences, securityFindings, metricWarnings }) {
  if (securityFindings.some((finding) => finding.ruleId === 'sql-injection')) {
    return 'Replace string-built SQL with parameterized queries.';
  }

  if (divergences.length > 0) {
    return 'Compare the changed function against replay inputs and restore the intended return/error contract.';
  }

  if (metricWarnings.length > 0) {
    return 'Split branching logic into smaller helper functions and add focused replay payloads for each branch.';
  }

  return 'Proceed with normal review.';
}

function buildOptions({ divergences, securityFindings, metricWarnings }) {
  const options = [];

  if (securityFindings.length > 0) {
    options.push({
      label: 'Option A',
      kind: 'secure',
      recommendation: buildFixSuggestion({ divergences: [], securityFindings, metricWarnings: [] })
    });
  }

  if (metricWarnings.length > 0) {
    options.push({
      label: 'Option B',
      kind: 'maintainable',
      recommendation: 'Extract high-branch regions into named helpers until complexity is below 15.'
    });
  }

  if (divergences.length > 0) {
    options.push({
      label: options.length === 0 ? 'Option A' : 'Option C',
      kind: 'behavioral',
      recommendation: 'Preserve the previous observable contract or intentionally update replay expectations.'
    });
  }

  return options.length > 0
    ? options
    : [
        {
          label: 'Option A',
          kind: 'behavioral',
          recommendation: 'No fix required from BTM findings.'
        }
      ];
}
