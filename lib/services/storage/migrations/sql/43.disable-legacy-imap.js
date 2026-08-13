/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

/**
 * Stop legacy mailbox accounts without deleting private data. Users can review
 * the retained row/message counts and explicitly delete them after upgrading.
 *
 * @param {import('better-sqlite3').Database} db
 */
export function up(db) {
  db.prepare(`UPDATE mail_accounts SET enabled = 0, updated_at = ? WHERE enabled <> 0`).run(Date.now());
}
