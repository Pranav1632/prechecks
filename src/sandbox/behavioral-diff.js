const DEFAULT_REGRESSION_FACTOR = 1.5;
const DEFAULT_REGRESSION_MIN_MS = 25;

export function compareObservations({
  functionId,
  inputId,
  oldObservation,
  newObservation,
  timingRegressionFactor = DEFAULT_REGRESSION_FACTOR,
  timingRegressionMinMs = DEFAULT_REGRESSION_MIN_MS
}) {
  const divergences = [];

  if (oldObservation.status !== newObservation.status) {
    divergences.push({
      type: 'status',
      severity: 'high',
      message: `Execution status changed from ${oldObservation.status} to ${newObservation.status}.`
    });
  }

  if (!sameJsonValue(oldObservation.returnValue, newObservation.returnValue)) {
    divergences.push({
      type: 'return',
      severity: 'high',
      message: 'Return value changed.',
      before: oldObservation.returnValue,
      after: newObservation.returnValue
    });
  }

  if (!sameJsonValue(normalizeError(oldObservation.error), normalizeError(newObservation.error))) {
    divergences.push({
      type: 'error',
      severity: 'high',
      message: 'Thrown error changed.',
      before: normalizeError(oldObservation.error),
      after: normalizeError(newObservation.error)
    });
  }

  if (isTimingRegression({
    before: oldObservation.durationMs,
    after: newObservation.durationMs,
    factor: timingRegressionFactor,
    minMs: timingRegressionMinMs
  })) {
    divergences.push({
      type: 'timing',
      severity: 'medium',
      message: `Execution time regressed from ${oldObservation.durationMs}ms to ${newObservation.durationMs}ms.`,
      before: oldObservation.durationMs,
      after: newObservation.durationMs
    });
  }

  return divergences.map((divergence) => ({
    functionId,
    inputId,
    ...divergence
  }));
}

function sameJsonValue(a, b) {
  return stableStringify(a) === stableStringify(b);
}

function stableStringify(value) {
  if (value === undefined) {
    return '__undefined__';
  }

  return JSON.stringify(sortKeys(value));
}

function sortKeys(value) {
  if (Array.isArray(value)) {
    return value.map(sortKeys);
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, child]) => [key, sortKeys(child)])
    );
  }

  return value;
}

function normalizeError(error) {
  if (!error) {
    return null;
  }

  return {
    name: error.name ?? 'Error',
    message: error.message ?? String(error)
  };
}

function isTimingRegression({ before, after, factor, minMs }) {
  if (typeof before !== 'number' || typeof after !== 'number') {
    return false;
  }

  if (after - before < minMs) {
    return false;
  }

  return before === 0 ? after >= minMs : after >= before * factor;
}
