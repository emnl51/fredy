/* Copyright (c) 2026 by Christian Kellner. Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause */
/** @param {import('better-sqlite3').Database} db */
export function up(db) {
  db.exec(`CREATE TABLE listing_external_references (
    id TEXT PRIMARY KEY, listing_id TEXT NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
    provider TEXT, reference_type TEXT NOT NULL, normalized_value TEXT NOT NULL,
    source TEXT NOT NULL, created_at INTEGER NOT NULL,
    UNIQUE(listing_id, reference_type, normalized_value));
    CREATE UNIQUE INDEX idx_listing_external_references_lookup
    ON listing_external_references(reference_type, normalized_value, provider);`);
}
