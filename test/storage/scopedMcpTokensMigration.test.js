/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import crypto from 'crypto';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { up } from '../../lib/services/storage/migrations/sql/41.scoped-mcp-tokens.js';

describe('scoped MCP tokens migration', () => {
  it('hashes legacy tokens and limits them to read scopes', () => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    db.exec(`
      CREATE TABLE users (id TEXT PRIMARY KEY, mcp_token TEXT);
      INSERT INTO users VALUES ('u1', 'fredy_old-secret');
    `);

    up(db);

    const token = db.prepare(`SELECT * FROM mcp_tokens`).get();
    expect(token.token_hash).toBe(crypto.createHash('sha256').update('fredy_old-secret').digest('hex'));
    expect(token.token_hash).not.toContain('old-secret');
    expect(JSON.parse(token.scopes)).toEqual(['jobs:read', 'listings:read']);
    expect(db.prepare(`SELECT mcp_token FROM users`).get().mcp_token).toBeNull();
    db.close();
  });
});
