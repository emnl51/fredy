/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import crypto from 'crypto';

/**
 * Replace permanent plaintext bearer tokens with revocable, scoped token hashes.
 * Existing tokens keep working but are deliberately migrated as read-only.
 *
 * @param {import('better-sqlite3').Database} db
 */
export function up(db) {
  db.exec(`
    CREATE TABLE mcp_tokens (
      id           TEXT PRIMARY KEY,
      user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name         TEXT NOT NULL,
      token_prefix TEXT NOT NULL,
      token_hash   TEXT NOT NULL UNIQUE,
      scopes       JSONB NOT NULL,
      expires_at   INTEGER,
      last_used_at INTEGER,
      revoked_at   INTEGER,
      created_at   INTEGER NOT NULL
    );

    CREATE INDEX idx_mcp_tokens_user ON mcp_tokens(user_id, revoked_at, expires_at);
  `);

  const legacy = db.prepare(`SELECT id, mcp_token FROM users WHERE mcp_token IS NOT NULL`).all();
  const insert = db.prepare(`
    INSERT INTO mcp_tokens
      (id, user_id, name, token_prefix, token_hash, scopes, created_at)
    VALUES (@id, @userId, 'Legacy read-only token', @prefix, @hash, @scopes, @now)
  `);
  for (const row of legacy) {
    insert.run({
      id: crypto.randomUUID(),
      userId: row.id,
      prefix: String(row.mcp_token).slice(0, 14),
      hash: crypto.createHash('sha256').update(row.mcp_token).digest('hex'),
      scopes: JSON.stringify(['jobs:read', 'listings:read']),
      now: Date.now(),
    });
  }
  db.exec(`UPDATE users SET mcp_token = NULL`);
}
