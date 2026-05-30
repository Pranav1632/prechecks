export function buildHeuristicAnalysis(report) {
  const divergences = report.sandbox?.divergences ?? [];
  const securityFindings = report.securityFindings ?? [];
  const removedFunctions = report.removedFunctions ?? [];
  const parseFailures = report.parseFailures ?? [];
  const metricWarnings = (report.modifiedFunctions ?? []).filter((fn) => fn.metrics?.isOverThreshold);

  const riskScore = Math.min(
    100,
    divergences.length * 35 +
      securityFindings.filter((finding) => finding.severity === 'critical').length * 40 +
      securityFindings.filter((finding) => finding.severity === 'high').length * 25 +
      securityFindings.filter((finding) => finding.severity === 'medium').length * 10 +
      parseFailures.length * 45 +
      removedFunctions.length * 20 +
      metricWarnings.length * 15
  );

  const category = chooseCategory({ divergences, securityFindings, removedFunctions, parseFailures, metricWarnings });

  return {
    provider: 'heuristic',
    riskScore,
    category,
    rootCause: buildRootCause({ divergences, securityFindings, removedFunctions, parseFailures, metricWarnings }),
    fixSuggestion: buildFixSuggestion({ divergences, securityFindings, removedFunctions, parseFailures, metricWarnings }),
    confidence: riskScore > 0 ? 0.72 : 0.9,
    options: buildOptions({ divergences, securityFindings, removedFunctions, parseFailures, metricWarnings })
  };
}

function chooseCategory({ divergences, securityFindings, removedFunctions, parseFailures, metricWarnings }) {
  const active = [
    parseFailures.length > 0 && 'syntax',
    divergences.length > 0 && 'behavioral',
    securityFindings.length > 0 && 'security',
    removedFunctions.length > 0 && 'structural',
    metricWarnings.length > 0 && 'metrics'
  ].filter(Boolean);

  if (active.length === 0) {
    return 'none';
  }

  return active.length > 1 ? 'mixed' : active[0];
}

function buildRootCause({ divergences, securityFindings, removedFunctions, parseFailures, metricWarnings }) {
  if (parseFailures.length > 0) {
    return parseFailureSummary(parseFailures[0]);
  }

  if (removedFunctions.length > 0) {
    return removedFunctionSummary(removedFunctions[0]);
  }

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

function buildFixSuggestion({ divergences, securityFindings, removedFunctions, parseFailures, metricWarnings }) {
  if (parseFailures.length > 0) {
    return 'Make the staged file parse again. Finish the deletion cleanly by removing or updating every stale reference.';
  }

  if (removedFunctions.length > 0) {
    const fn = removedFunctions[0];
    const base = `Finish removing ${fn.name}() by updating every caller, prop, or import that referenced it.`;

    if (securityFindings.length > 0) {
      return `${base} Then address: ${securityFindings[0].message}`;
    }

    return base;
  }

  if (securityFindings.some((finding) => finding.ruleId === 'sql-injection')) {
    return 'Replace string-built SQL with parameterized queries.';
  }

  if (securityFindings.some((finding) => finding.ruleId === 'suspicious-api-call')) {
    return 'Correct the suspicious API call before committing.';
  }

  if (divergences.length > 0) {
    return 'Compare the changed function against replay inputs and restore the intended return/error contract.';
  }

  if (metricWarnings.length > 0) {
    return 'Split branching logic into smaller helper functions and add focused replay payloads for each branch.';
  }

  return 'Proceed with normal review.';
}

function buildOptions({ divergences, securityFindings, removedFunctions, parseFailures, metricWarnings }) {
  const options = [];

  if (parseFailures.length > 0) {
    options.push({
      label: nextOptionLabel(options),
      kind: 'syntax',
      recommendation: 'Fix the parse error first so BTM can analyze the staged code safely.'
    });
  }

  if (removedFunctions.length > 0) {
    options.push({
      label: nextOptionLabel(options),
      kind: 'structural',
      recommendation: `Update all code that used ${removedFunctions[0].name}().`
    });
  }

  if (securityFindings.length > 0) {
    options.push({
      label: nextOptionLabel(options),
      kind: securityFindings.some((finding) => finding.ruleId === 'suspicious-api-call') ? 'behavioral' : 'secure',
      recommendation: buildFixSuggestion({ divergences: [], securityFindings, removedFunctions: [], parseFailures: [], metricWarnings: [] })
    });
  }

  if (metricWarnings.length > 0) {
    options.push({
      label: nextOptionLabel(options),
      kind: 'maintainable',
      recommendation: 'Extract high-branch regions into named helpers until complexity is below 15.'
    });
  }

  if (divergences.length > 0) {
    options.push({
      label: nextOptionLabel(options),
      kind: 'behavioral',
      recommendation: 'Preserve the previous observable contract or update replay expectations to match the new contract.'
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

function removedFunctionSummary(fn) {
  return `Removed function ${fn.name}() from ${fn.filePath}:${fn.loc.start.line}.`;
}

function parseFailureSummary(failure) {
  const touched = failure.previousFunctions?.length > 0
    ? ` Previous touched function(s): ${failure.previousFunctions.map((fn) => `${fn.name}()`).join(', ')}.`
    : '';

  return `Staged code does not parse in ${failure.filePath}: ${shortParseMessage(failure.message)}.${touched}`;
}

function nextOptionLabel(options) {
  return `Option ${String.fromCharCode(65 + options.length)}`;
}

function shortParseMessage(message) {
  return message.replace(/^Unable to parse [^:]+:\s*/, '');
}
