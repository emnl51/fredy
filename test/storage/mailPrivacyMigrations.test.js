/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { decryptMailContent } from '../../lib/services/mail/mailCredentialCrypto.js';
import { up as createInbox } from '../../lib/services/storage/migrations/sql/35.mail-inbox.js';
import { up as encryptContent } from '../../lib/services/storage/migrations/sql/38.encrypt-mail-content.js';
import { up as addRetention } from '../../lib/services/storage/migrations/sql/39.mail-retention.js';

const ENV_NAME = 'FREDY_MAIL_ENCRYPTION_KEY';
const originalKey = process.env[ENV_NAME];

beforeEach(() => {
  process.env[ENV_NAME] = Buffer.alloc(32, 11).toString('base64');
});

afterEach(() => {
  if (originalKey == null) delete process.env[ENV_NAME];
  else process.env[ENV_NAME] = originalKey;
});

function database() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(`CREATE TABLE users (id TEXT PRIMARY KEY); INSERT INTO users VALUES ('user-1')`);
  createInbox(db);
  db.prepare(
    `INSERT INTO mail_accounts
       (id, user_id, host, port, secure, username, password_encrypted, created_at, updated_at)
     VALUES ('account-1', 'user-1', 'imap.example.com', 993, 1, 'user@example.com', 'encrypted', 1, 1)`,
  ).run();
  return db;
}

describe('mail privacy migrations', () => {
  it('encrypts existing private message fields and clears their plaintext columns', () => {
    const db = database();
    db.prepare(
      `INSERT INTO mail_messages
         (id, account_id, mailbox, uid_validity, uid, sender_name, sender_address, subject, text_body, created_at)
       VALUES
         ('message-1', 'account-1', 'INBOX', '1', 1, 'Agent', 'agent@example.com', 'Besichtigung',
          'Telefon 030 123456', 1)`,
    ).run();

    encryptContent(db);

    const row = db.prepare(`SELECT * FROM mail_messages WHERE id = 'message-1'`).get();
    expect(row.sender_name).toBeNull();
    expect(row.sender_address).toBeNull();
    expect(row.subject).toBeNull();
    expect(row.text_body).toBeNull();
    expect(row.content_encrypted).toMatch(/^v1c\./);
    expect(decryptMailContent(row.content_encrypted)).toEqual({
      senderName: 'Agent',
      senderAddress: 'agent@example.com',
      subject: 'Besichtigung',
      textBody: 'Telefon 030 123456',
    });
    db.close();
  });

  it('does not require an encryption key when no messages exist', () => {
    const db = database();
    delete process.env[ENV_NAME];
    expect(() => encryptContent(db)).not.toThrow();
    db.close();
  });

  it('adds a bounded 90-day retention default', () => {
    const db = database();
    addRetention(db);

    expect(db.prepare(`SELECT retention_days FROM mail_accounts`).get().retention_days).toBe(90);
    expect(() => db.prepare(`UPDATE mail_accounts SET retention_days = 7`).run()).toThrow();
    expect(() => db.prepare(`UPDATE mail_accounts SET retention_days = 365`).run()).not.toThrow();
    db.close();
  });
});
