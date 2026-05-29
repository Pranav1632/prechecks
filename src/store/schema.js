export const SCHEMA_VERSION = 1;

export const REPLAY_STORE_SCHEMA = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS function_identifiers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  stable_id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  file_path TEXT NOT NULL,
  kind TEXT NOT NULL,
  start_line INTEGER,
  end_line INTEGER,
  last_complexity INTEGER,
  first_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS replay_inputs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  function_id INTEGER NOT NULL,
  label TEXT,
  source TEXT NOT NULL DEFAULT 'manual',
  payload_json TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_used_at TEXT,
  FOREIGN KEY (function_id) REFERENCES function_identifiers(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS execution_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  command TEXT NOT NULL,
  git_head TEXT,
  status TEXT NOT NULL DEFAULT 'created',
  started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT,
  summary_json TEXT
);

CREATE TABLE IF NOT EXISTS execution_observations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id INTEGER NOT NULL,
  function_id INTEGER,
  input_id INTEGER,
  variant TEXT NOT NULL,
  status TEXT NOT NULL,
  return_json TEXT,
  error_json TEXT,
  duration_ms REAL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (run_id) REFERENCES execution_runs(id) ON DELETE CASCADE,
  FOREIGN KEY (function_id) REFERENCES function_identifiers(id) ON DELETE SET NULL,
  FOREIGN KEY (input_id) REFERENCES replay_inputs(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS incidents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  function_id INTEGER,
  run_id INTEGER,
  category TEXT NOT NULL,
  severity TEXT NOT NULL,
  title TEXT NOT NULL,
  details_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resolved_at TEXT,
  FOREIGN KEY (function_id) REFERENCES function_identifiers(id) ON DELETE SET NULL,
  FOREIGN KEY (run_id) REFERENCES execution_runs(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_function_identifiers_file_path
  ON function_identifiers(file_path);

CREATE INDEX IF NOT EXISTS idx_replay_inputs_function_id
  ON replay_inputs(function_id);

CREATE INDEX IF NOT EXISTS idx_execution_runs_started_at
  ON execution_runs(started_at);

CREATE INDEX IF NOT EXISTS idx_incidents_created_at
  ON incidents(created_at);
`;
