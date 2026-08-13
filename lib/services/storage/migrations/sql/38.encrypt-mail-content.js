/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { encryptMailContent } from '../../../mail/mailCredentialCrypto.js';

/**
 * Encrypt private message fields already stored by the initial inbox version.
 * The migration only needs the external key when plaintext rows actually
 * exist, so installations that never enabled mail are unaffected.
 *
 * @param {import('better-sqlite3').Database} db
 * @returns {void}
 */
export function up(db) {
  db.exec(`ALTER TABLE mail_messages ADD COLUMN content_encrypted TEXT`);

  const rows = db
    .prepare(
      `SELECT id, sender_name, sender_address, subject, text_body
         FROM mail_messages
        WHERE sender_name IS NOT NULL
           OR sender_address IS NOT NULL
           OR subject IS NOT NULL
           OR text_body IS NOT NULL`,
    )
    .all();
  const update = db.prepare(
    `UPDATE mail_messages
        SET content_encrypted = @contentEncrypted,
            sender_name = NULL,
            sender_address = NULL,
            subject = NULL,
            text_body = NULL
      WHERE id = @id`,
  );
  for (const row of rows) {
    update.run({
      id: row.id,
      contentEncrypted: encryptMailContent({
        senderName: row.sender_name,
        senderAddress: row.sender_address,
        subject: row.subject,
        textBody: row.text_body,
      }),
    });
  }
}
