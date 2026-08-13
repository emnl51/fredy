/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

/**
 * Bound private-message retention per mailbox account.
 *
 * @param {import('better-sqlite3').Database} db
 * @returns {void}
 */
export function up(db) {
  db.exec(`
    ALTER TABLE mail_accounts
      ADD COLUMN retention_days INTEGER NOT NULL DEFAULT 90
      CHECK (retention_days IN (30, 90, 180, 365));
  `);
}
