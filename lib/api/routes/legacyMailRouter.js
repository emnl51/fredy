/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import SqliteConnection from '../../services/storage/SqliteConnection.js';

function summary(userId) {
  const account = SqliteConnection.query(
    `SELECT id, host, username, mailbox, enabled, last_sync_at AS lastSyncAt
       FROM mail_accounts WHERE user_id = @userId LIMIT 1`,
    { userId },
  )[0];
  if (!account) return { retained: false, account: null, messageCount: 0, matchCount: 0 };
  const messageCount = SqliteConnection.query(
    `SELECT COUNT(*) AS count FROM mail_messages WHERE account_id = @accountId`,
    { accountId: account.id },
  )[0].count;
  const matchCount = SqliteConnection.query(
    `SELECT COUNT(*) AS count
       FROM mail_message_listing_matches mm
       JOIN mail_messages m ON m.id = mm.message_id
      WHERE m.account_id = @accountId`,
    { accountId: account.id },
  )[0].count;
  return { retained: true, account, messageCount, matchCount };
}

export default async function legacyMailPlugin(fastify) {
  fastify.get('/', async (request) => summary(request.session.currentUser));

  fastify.delete('/', async (request, reply) => {
    if (request.body?.confirmation !== 'DELETE') {
      return reply.code(400).send({ error: 'Set confirmation to DELETE to remove retained mailbox data.' });
    }
    const result = summary(request.session.currentUser);
    if (result.account) {
      SqliteConnection.execute(`DELETE FROM mail_accounts WHERE id = @id AND user_id = @userId`, {
        id: result.account.id,
        userId: request.session.currentUser,
      });
    }
    return { deleted: result.retained, messageCount: result.messageCount };
  });
}
