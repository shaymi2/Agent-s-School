/**
 * Persistence.
 *
 * SQLite through Node's built-in node:sqlite — a real relational store with
 * no native build step and no dependency. Deliberately small: eight tables,
 * JSON columns for the shapes the domain already owns, no ORM.
 */

import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS agents (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  provider      TEXT NOT NULL,
  model         TEXT NOT NULL,
  system_prompt TEXT,
  temperature   REAL,
  max_steps     INTEGER NOT NULL,
  created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS skills (
  id     TEXT PRIMARY KEY,
  name   TEXT NOT NULL,
  icon   TEXT NOT NULL,
  blurb  TEXT NOT NULL,
  status TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS exercises (
  id         TEXT PRIMARY KEY,
  skill      TEXT NOT NULL,
  difficulty INTEGER NOT NULL,
  title      TEXT NOT NULL,
  task       TEXT NOT NULL,
  definition TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id             TEXT PRIMARY KEY,
  agent_id       TEXT NOT NULL,
  exercise_id    TEXT NOT NULL,
  skill          TEXT NOT NULL,
  attempt        INTEGER NOT NULL,
  status         TEXT NOT NULL,
  started_at     INTEGER NOT NULL,
  finished_at    INTEGER,
  guidance       TEXT,
  final_response TEXT,
  score          INTEGER,
  success        INTEGER,
  error          TEXT
);

CREATE TABLE IF NOT EXISTS events (
  id          TEXT PRIMARY KEY,
  session_id  TEXT NOT NULL,
  agent_id    TEXT NOT NULL,
  exercise_id TEXT NOT NULL,
  seq         INTEGER NOT NULL,
  type        TEXT NOT NULL,
  at          INTEGER NOT NULL,
  label       TEXT NOT NULL,
  payload     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS evaluations (
  session_id TEXT PRIMARY KEY,
  score      INTEGER NOT NULL,
  success    INTEGER NOT NULL,
  payload    TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS coach_feedback (
  session_id TEXT PRIMARY KEY,
  agent_id   TEXT NOT NULL,
  payload    TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS agent_skill_profiles (
  agent_id   TEXT NOT NULL,
  skill      TEXT NOT NULL,
  payload    TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (agent_id, skill)
);

CREATE TABLE IF NOT EXISTS session_snapshots (
  session_id TEXT PRIMARY KEY,
  payload    TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_events_session ON events (session_id, seq);
CREATE INDEX IF NOT EXISTS idx_sessions_agent ON sessions (agent_id, started_at);
`;

export type Db = DatabaseSync;

export function openDatabase(location?: string): Db {
  const target = location ?? process.env.GYM_DB ?? '.gym/gym.db';
  if (target !== ':memory:') {
    mkdirSync(dirname(target), { recursive: true });
  }
  const db = new DatabaseSync(target);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);
  return db;
}
