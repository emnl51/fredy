/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { up } from '../../lib/services/storage/migrations/sql/40.application-workflow.js';

describe('application workflow migration', () => {
  it('moves embedded appointments to a mail-independent table', () => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    db.exec(`
      CREATE TABLE users (id TEXT PRIMARY KEY);
      CREATE TABLE jobs (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id));
      CREATE TABLE listings (
        id TEXT PRIMARY KEY,
        job_id TEXT NOT NULL REFERENCES jobs(id),
        status JSON,
        manually_deleted INTEGER NOT NULL DEFAULT 0
      );
      INSERT INTO users VALUES ('u1');
      INSERT INTO jobs VALUES ('j1', 'u1');
      INSERT INTO listings VALUES
        ('l1', 'j1', '{"status":"invited","setAt":10,"appointmentAt":1893456000000}', 0);
    `);

    up(db);

    const appointment = db.prepare(`SELECT * FROM application_appointments`).get();
    expect(appointment.listing_id).toBe('l1');
    expect(appointment.user_id).toBe('u1');
    expect(appointment.starts_at).toBe(1893456000000);
    expect(appointment.source).toBe('migration');
    expect(JSON.parse(db.prepare(`SELECT status FROM listings WHERE id = 'l1'`).get().status)).toEqual({
      status: 'invited',
      setAt: 10,
    });

    db.close();
  });
});
