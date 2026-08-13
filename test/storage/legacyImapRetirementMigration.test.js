/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { up } from '../../lib/services/storage/migrations/sql/43.disable-legacy-imap.js';

describe('legacy IMAP retirement migration', () => {
  it('disables accounts without deleting private data', () => {
    const db = new Database(':memory:');
    db.exec(`
      CREATE TABLE mail_accounts (id TEXT PRIMARY KEY, enabled INTEGER, updated_at INTEGER);
      CREATE TABLE mail_messages (id TEXT PRIMARY KEY, account_id TEXT);
      INSERT INTO mail_accounts VALUES ('a1', 1, 1);
      INSERT INTO mail_messages VALUES ('m1', 'a1');
    `);

    up(db);

    expect(db.prepare(`SELECT enabled FROM mail_accounts WHERE id = 'a1'`).get().enabled).toBe(0);
    expect(db.prepare(`SELECT COUNT(*) AS count FROM mail_messages`).get().count).toBe(1);
    db.close();
  });
});
