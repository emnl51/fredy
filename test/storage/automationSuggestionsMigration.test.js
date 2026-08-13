/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { up } from '../../lib/services/storage/migrations/sql/42.automation-suggestions.js';

describe('automation suggestions migration', () => {
  it('creates user-scoped idempotent suggestions', () => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    db.exec(`
      CREATE TABLE users (id TEXT PRIMARY KEY);
      CREATE TABLE listings (id TEXT PRIMARY KEY);
      INSERT INTO users VALUES ('u1');
      INSERT INTO listings VALUES ('l1');
    `);
    up(db);

    const insert = db.prepare(`
      INSERT INTO automation_suggestions
        (id, user_id, listing_id, payload, confidence, reason, external_event_hash, created_at)
      VALUES (@id, 'u1', 'l1', '{}', 90, 'reference match', 'same-message', 1)
    `);
    insert.run({ id: 's1' });
    expect(() => insert.run({ id: 's2' })).toThrow();
    expect(() => db.prepare(`UPDATE automation_suggestions SET confidence = 101 WHERE id = 's1'`).run()).toThrow();
    db.close();
  });
});
