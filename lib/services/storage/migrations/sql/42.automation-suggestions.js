/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

/** @param {import('better-sqlite3').Database} db */
export function up(db) {
  db.exec(`
    CREATE TABLE automation_suggestions (
      id                  TEXT PRIMARY KEY,
      user_id             TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      listing_id          TEXT NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
      type                TEXT NOT NULL DEFAULT 'application_update',
      payload             JSONB NOT NULL,
      confidence          INTEGER NOT NULL CHECK (confidence BETWEEN 0 AND 100),
      reason              TEXT NOT NULL,
      state               TEXT NOT NULL DEFAULT 'pending'
                          CHECK (state IN ('pending', 'accepted', 'rejected', 'expired')),
      external_event_hash TEXT NOT NULL,
      created_at          INTEGER NOT NULL,
      decided_at          INTEGER,
      decided_by          TEXT REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE UNIQUE INDEX idx_automation_suggestions_external
      ON automation_suggestions(user_id, external_event_hash);
    CREATE INDEX idx_automation_suggestions_user_state
      ON automation_suggestions(user_id, state, created_at DESC);
  `);
}
