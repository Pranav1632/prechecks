import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { analyzeFunctionsInSource } from '../analysis/function-isolator.js';
import { logger } from '../utils/logger.js';

export async function testCommand({ file, metrics = false, json = false } = {}) {
  const filePath = resolve(process.cwd(), file);
  const source = await readFile(filePath, 'utf8');
  const functions = analyzeFunctionsInSource({
    filePath,
    source,
    metrics
  });

  const report = {
    phase: 'phase-2',
    mode: 'test',
    filePath,
    metricsEnabled: metrics,
    functions
  };

  if (json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return;
  }

  logger.header('BTM File Playground');
  logger.info(`File: ${filePath}`);
  logger.info(`Functions discovered: ${functions.length}`);

  for (const fn of functions) {
    const suffix = metrics ? ` | complexity ${fn.metrics.cyclomaticComplexity}` : '';
    logger.info(`${fn.name} (${fn.kind}) lines ${fn.loc.start.line}-${fn.loc.end.line}${suffix}`);
  }
}
