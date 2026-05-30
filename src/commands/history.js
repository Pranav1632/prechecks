import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { ensureGitRepository } from '../git/repository.js';
import {
  addReplayInput,
  closeReplayStore,
  deleteReplayInput,
  getReplayStoreStats,
  listFunctionIdentifiers,
  listReplayInputs,
  openReplayStore
} from '../store/replay-store.js';
import { BtmError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

export async function historyInitCommand() {
  const { store } = await withStore();
  logger.header('BTM Replay History');
  logger.success(`Replay Store initialized at ${store.path}`);
  closeReplayStore(store);
}

export async function historyListCommand({ limit = 20 } = {}) {
  const { store } = await withStore();
  const inputs = listReplayInputs(store.db, { limit });

  logger.header('BTM Replay History');

  if (inputs.length === 0) {
    logger.info('No replay payloads stored yet.');
    closeReplayStore(store);
    return;
  }

  for (const input of inputs) {
    logger.info(
      `#${input.id} ${input.functionName} ${input.label ?? '(unlabeled)'} ${input.source} ${input.createdAt}`
    );
    logger.info(`  function: ${input.functionStableId}`);
  }

  closeReplayStore(store);
}

export async function historyFunctionsCommand({ limit = 20 } = {}) {
  const { store } = await withStore();
  const functions = listFunctionIdentifiers(store.db, { limit });

  logger.header('BTM Function Registry');

  if (functions.length === 0) {
    logger.info('No function identifiers recorded yet. Run `btm run --metrics` after staging code.');
    closeReplayStore(store);
    return;
  }

  for (const fn of functions) {
    const complexity = fn.lastComplexity == null ? 'n/a' : fn.lastComplexity;
    logger.info(`${fn.stableId}`);
    logger.info(`  ${fn.filePath}:${fn.startLine}-${fn.endLine} ${fn.kind} complexity=${complexity}`);
  }

  closeReplayStore(store);
}

export async function historyAddCommand({
  functionId,
  payload,
  payloadFile,
  label = null,
  source = 'manual'
} = {}) {
  const parsedPayload = await parsePayload({ payload, payloadFile });
  const { store } = await withStore();
  const id = addReplayInput(store.db, {
    functionStableId: functionId,
    payload: parsedPayload,
    label,
    source
  });

  logger.success(`Replay payload #${id} stored.`);
  closeReplayStore(store);
}

export async function historyDeleteCommand({ id } = {}) {
  const { store } = await withStore();
  const changes = deleteReplayInput(store.db, Number(id));

  if (changes === 0) {
    closeReplayStore(store);
    throw new BtmError(`No replay payload found for id ${id}.`);
  }

  logger.success(`Replay payload #${id} deleted.`);
  closeReplayStore(store);
}

export async function historyStatsCommand() {
  const { store } = await withStore();
  const stats = getReplayStoreStats(store.db);

  logger.header('BTM Replay Store Stats');
  logger.info(`Path: ${store.path}`);
  logger.info(`Functions: ${stats.functions}`);
  logger.info(`Replay payloads: ${stats.replayInputs}`);
  logger.info(`Execution runs: ${stats.executionRuns}`);
  logger.info(`Execution observations: ${stats.observations}`);
  logger.info(`Incidents: ${stats.incidents}`);

  closeReplayStore(store);
}

async function withStore() {
  const repo = await ensureGitRepository();
  const store = openReplayStore(repo.root);
  return {
    repo,
    store
  };
}

async function parsePayload({ payload, payloadFile }) {
  if (payload && payloadFile) {
    throw new BtmError('Use either --payload or --payload-file, not both.');
  }

  let rawPayload = payload;

  if (payloadFile) {
    rawPayload = await readFile(resolve(process.cwd(), payloadFile), 'utf8');
  }

  if (!rawPayload) {
    throw new BtmError('Missing replay payload JSON. Use --payload "{\\"args\\":[1,2]}" or --payload-file payload.json.');
  }

  try {
    return JSON.parse(stripBom(rawPayload));
  } catch (error) {
    throw new BtmError(`Invalid replay payload JSON: ${error.message}`);
  }
}

function stripBom(value) {
  return value.charCodeAt(0) === 0xfeff ? value.slice(1) : value;
}
