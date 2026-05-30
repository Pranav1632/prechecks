import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import Database from 'better-sqlite3';
import { BtmError } from '../utils/errors.js';
import { REPLAY_STORE_SCHEMA, SCHEMA_VERSION } from './schema.js';

export function resolveReplayStorePath(repoRoot) {
  return process.env.BTM_DB_PATH || join(repoRoot, 'btm.db');
}

export function openReplayStore(repoRoot) {
  const dbPath = resolveReplayStorePath(repoRoot);
  mkdirSync(dirname(dbPath), { recursive: true });

  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(REPLAY_STORE_SCHEMA);
  db.pragma(`user_version = ${SCHEMA_VERSION}`);

  return {
    db,
    path: dbPath
  };
}

export function closeReplayStore(store) {
  store?.db?.close();
}

export function upsertFunctionIdentifier(db, fn) {
  const stableId = fn.id;
  const complexity = fn.metrics?.cyclomaticComplexity ?? null;

  db.prepare(`
    INSERT INTO function_identifiers (
      stable_id, name, file_path, kind, start_line, end_line, last_complexity
    )
    VALUES (@stableId, @name, @filePath, @kind, @startLine, @endLine, @complexity)
    ON CONFLICT(stable_id) DO UPDATE SET
      name = excluded.name,
      file_path = excluded.file_path,
      kind = excluded.kind,
      start_line = excluded.start_line,
      end_line = excluded.end_line,
      last_complexity = excluded.last_complexity,
      last_seen_at = CURRENT_TIMESTAMP
  `).run({
    stableId,
    name: fn.name,
    filePath: fn.filePath,
    kind: fn.kind,
    startLine: fn.loc.start.line,
    endLine: fn.loc.end.line,
    complexity
  });

  return db.prepare('SELECT * FROM function_identifiers WHERE stable_id = ?').get(stableId);
}

export function recordAnalysisRun(db, { command, gitHead, summary }) {
  const started = db.prepare(`
    INSERT INTO execution_runs (command, git_head, status, summary_json)
    VALUES (?, ?, 'completed', ?)
  `).run(command, gitHead, stringifyJson(summary));

  db.prepare('UPDATE execution_runs SET completed_at = CURRENT_TIMESTAMP WHERE id = ?').run(started.lastInsertRowid);
  return started.lastInsertRowid;
}

export function addReplayInput(db, { functionStableId, label = null, source = 'manual', payload }) {
  const fn = db.prepare('SELECT id FROM function_identifiers WHERE stable_id = ?').get(functionStableId);

  if (!fn) {
    throw new BtmError(`Unknown function id: ${functionStableId}`);
  }

  const payloadJson = stringifyJson(payload);
  const payloadHash = createHash('sha256').update(payloadJson).digest('hex');

  const result = db.prepare(`
    INSERT INTO replay_inputs (function_id, label, source, payload_json, payload_hash)
    VALUES (?, ?, ?, ?, ?)
  `).run(fn.id, label, source, payloadJson, payloadHash);

  return result.lastInsertRowid;
}

export function listReplayInputs(db, { limit = 20 } = {}) {
  return db.prepare(`
    SELECT
      replay_inputs.id,
      replay_inputs.label,
      replay_inputs.source,
      replay_inputs.payload_json AS payloadJson,
      replay_inputs.payload_hash AS payloadHash,
      replay_inputs.created_at AS createdAt,
      function_identifiers.stable_id AS functionStableId,
      function_identifiers.name AS functionName,
      function_identifiers.file_path AS filePath
    FROM replay_inputs
    JOIN function_identifiers ON function_identifiers.id = replay_inputs.function_id
    ORDER BY replay_inputs.created_at DESC, replay_inputs.id DESC
    LIMIT ?
  `).all(limit);
}

export function listReplayInputsForFunctionIds(db, functionStableIds) {
  if (functionStableIds.length === 0) {
    return new Map();
  }

  const placeholders = functionStableIds.map(() => '?').join(', ');
  const rows = db.prepare(`
    SELECT
      replay_inputs.id,
      replay_inputs.label,
      replay_inputs.source,
      replay_inputs.payload_json AS payloadJson,
      replay_inputs.payload_hash AS payloadHash,
      function_identifiers.stable_id AS functionStableId
    FROM replay_inputs
    JOIN function_identifiers ON function_identifiers.id = replay_inputs.function_id
    WHERE function_identifiers.stable_id IN (${placeholders})
    ORDER BY replay_inputs.created_at ASC, replay_inputs.id ASC
  `).all(...functionStableIds);

  const byFunction = new Map();

  for (const row of rows) {
    const input = {
      id: row.id,
      label: row.label,
      source: row.source,
      payloadHash: row.payloadHash,
      payload: parseJson(row.payloadJson)
    };

    if (!byFunction.has(row.functionStableId)) {
      byFunction.set(row.functionStableId, []);
    }

    byFunction.get(row.functionStableId).push(input);
  }

  return byFunction;
}

export function listFunctionIdentifiers(db, { limit = 20 } = {}) {
  return db.prepare(`
    SELECT
      stable_id AS stableId,
      name,
      file_path AS filePath,
      kind,
      start_line AS startLine,
      end_line AS endLine,
      last_complexity AS lastComplexity,
      last_seen_at AS lastSeenAt
    FROM function_identifiers
    ORDER BY last_seen_at DESC, id DESC
    LIMIT ?
  `).all(limit);
}

export function deleteReplayInput(db, id) {
  return db.prepare('DELETE FROM replay_inputs WHERE id = ?').run(id).changes;
}

export function recordExecutionObservation(db, {
  runId,
  functionStableId,
  inputId,
  variant,
  observation
}) {
  const fn = db.prepare('SELECT id FROM function_identifiers WHERE stable_id = ?').get(functionStableId);

  db.prepare(`
    INSERT INTO execution_observations (
      run_id, function_id, input_id, variant, status, return_json, error_json, duration_ms
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    runId,
    fn?.id ?? null,
    inputId ?? null,
    variant,
    observation.status,
    stringifyJson(observation.returnValue ?? null),
    stringifyJson(observation.error ?? null),
    observation.durationMs ?? null
  );
}

export function recordIncident(db, {
  functionStableId,
  runId,
  category,
  severity,
  title,
  details
}) {
  const fn = db.prepare('SELECT id FROM function_identifiers WHERE stable_id = ?').get(functionStableId);

  db.prepare(`
    INSERT INTO incidents (function_id, run_id, category, severity, title, details_json)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    fn?.id ?? null,
    runId ?? null,
    category,
    severity,
    title,
    stringifyJson(details ?? {})
  );
}

export function getReplayStoreStats(db) {
  return {
    functions: db.prepare('SELECT COUNT(*) AS count FROM function_identifiers').get().count,
    replayInputs: db.prepare('SELECT COUNT(*) AS count FROM replay_inputs').get().count,
    executionRuns: db.prepare('SELECT COUNT(*) AS count FROM execution_runs').get().count,
    observations: db.prepare('SELECT COUNT(*) AS count FROM execution_observations').get().count,
    incidents: db.prepare('SELECT COUNT(*) AS count FROM incidents').get().count
  };
}

function stringifyJson(value) {
  try {
    return JSON.stringify(value);
  } catch (error) {
    throw new BtmError(`Unable to serialize replay payload: ${error.message}`);
  }
}

function parseJson(value) {
  try {
    return JSON.parse(value);
  } catch (error) {
    throw new BtmError(`Unable to parse stored replay payload: ${error.message}`);
  }
}
