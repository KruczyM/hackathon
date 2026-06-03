import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const DEFAULT_DB_PATH = "data/novapolis.sqlite";
const CACHE_UPDATED_AT_KEY = "company_cache_updated_at";

let database;

export function getDatabase() {
  if (database) return database;

  const dbPath = path.resolve(process.env.NOVAPOLIS_DB_PATH || DEFAULT_DB_PATH);
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  database = new DatabaseSync(dbPath);
  database.exec("PRAGMA journal_mode = DELETE");
  database.exec("PRAGMA synchronous = NORMAL");
  database.exec("PRAGMA foreign_keys = ON");
  database.exec("PRAGMA busy_timeout = 5000");
  initializeSchema(database);
  return database;
}

export function closeDatabase() {
  if (!database) return;
  database.close();
  database = null;
}

export function runInTransaction(callback) {
  const db = getDatabase();
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = callback(db);
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function getMetadata(key) {
  const row = getDatabase().prepare("SELECT value FROM app_metadata WHERE key = ?").get(key);
  return row?.value || "";
}

export function deleteMetadata(key) {
  getDatabase().prepare("DELETE FROM app_metadata WHERE key = ?").run(key);
}

export { CACHE_UPDATED_AT_KEY };

function initializeSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS app_metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS seen_signals (
      id TEXT PRIMARY KEY,
      first_seen_at TEXT NOT NULL,
      business_id TEXT,
      company_name TEXT,
      type TEXT,
      title TEXT,
      source_url TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_seen_signals_business_id
      ON seen_signals (business_id);

    CREATE TABLE IF NOT EXISTS displayed_companies (
      business_id TEXT PRIMARY KEY,
      company_name TEXT,
      first_displayed_at TEXT NOT NULL,
      last_displayed_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS company_growth_snapshots (
      business_id TEXT PRIMARY KEY,
      company_name TEXT,
      snapshot_at TEXT NOT NULL,
      score INTEGER NOT NULL DEFAULT 0,
      signal_count INTEGER NOT NULL DEFAULT 0,
      important_notices INTEGER NOT NULL DEFAULT 0,
      official_signals INTEGER NOT NULL DEFAULT 0,
      external_signals INTEGER NOT NULL DEFAULT 0,
      contacts INTEGER NOT NULL DEFAULT 0,
      employee_count INTEGER,
      consecutive_growth_runs INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS company_enrichment_cache (
      business_id TEXT PRIMARY KEY,
      company_name TEXT,
      fetched_at TEXT NOT NULL,
      last_modified TEXT,
      website TEXT,
      employee_count TEXT,
      employee_count_source_url TEXT,
      contact_source_url TEXT,
      enrichment_json TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_company_enrichment_cache_fetched_at
      ON company_enrichment_cache (fetched_at);

    CREATE TABLE IF NOT EXISTS official_market_cache (
      cache_key TEXT PRIMARY KEY,
      fetched_at TEXT NOT NULL,
      market_mode TEXT,
      region TEXT,
      payload_json TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_official_market_cache_fetched_at
      ON official_market_cache (fetched_at);

    CREATE TABLE IF NOT EXISTS company_cache_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      at TEXT NOT NULL,
      saved INTEGER NOT NULL DEFAULT 0,
      checked INTEGER NOT NULL DEFAULT 0,
      market_mode TEXT,
      region TEXT,
      source TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_company_cache_runs_at
      ON company_cache_runs (at);

    CREATE TABLE IF NOT EXISTS company_cache_daily_journal (
      date TEXT PRIMARY KEY,
      first_updated_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      saved INTEGER NOT NULL DEFAULT 0,
      checked INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS company_cache_daily_values (
      date TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('mode', 'region', 'source')),
      value TEXT NOT NULL,
      PRIMARY KEY (date, kind, value),
      FOREIGN KEY (date) REFERENCES company_cache_daily_journal (date) ON DELETE CASCADE
    );
  `);
}
