import { findFunctionInSource } from '../analysis/function-isolator.js';
import { getHeadFileContent } from '../git/repository.js';
import { compareObservations } from './behavioral-diff.js';
import { executeFunctionInIsolate } from './function-runner.js';

export async function runTwinSandboxComparisons({
  repoRoot,
  modifiedFunctions,
  replayInputsByFunctionId,
  timeoutMs = 100
}) {
  const comparisons = [];
  const divergences = [];

  for (const stagedFn of modifiedFunctions) {
    const replayInputs = replayInputsByFunctionId.get(stagedFn.id) ?? [];

    if (replayInputs.length === 0) {
      comparisons.push({
        functionId: stagedFn.id,
        functionName: stagedFn.name,
        status: 'skipped',
        reason: 'No replay inputs stored for this function.'
      });
      continue;
    }

    const oldSource = await getHeadFileContent(repoRoot, stagedFn.filePath);
    if (!oldSource) {
      comparisons.push({
        functionId: stagedFn.id,
        functionName: stagedFn.name,
        status: 'skipped',
        reason: 'No HEAD version exists for this file.'
      });
      continue;
    }

    const oldFn = findFunctionInSource({
      filePath: stagedFn.filePath,
      source: oldSource,
      target: stagedFn
    });

    if (!oldFn) {
      comparisons.push({
        functionId: stagedFn.id,
        functionName: stagedFn.name,
        status: 'skipped',
        reason: 'No matching HEAD function found.'
      });
      continue;
    }

    for (const input of replayInputs) {
      const [oldObservation, newObservation] = await Promise.all([
        executeFunctionInIsolate({
          fn: oldFn,
          payload: input.payload,
          variant: 'head',
          timeoutMs
        }),
        executeFunctionInIsolate({
          fn: stagedFn,
          payload: input.payload,
          variant: 'staged',
          timeoutMs
        })
      ]);

      const inputDivergences = compareObservations({
        functionId: stagedFn.id,
        inputId: input.id,
        oldObservation,
        newObservation
      });

      comparisons.push({
        functionId: stagedFn.id,
        functionName: stagedFn.name,
        inputId: input.id,
        inputLabel: input.label,
        status: inputDivergences.length > 0 ? 'diverged' : 'matched',
        oldObservation,
        newObservation,
        divergences: inputDivergences
      });

      divergences.push(...inputDivergences);
    }
  }

  return {
    comparisons,
    divergences
  };
}
