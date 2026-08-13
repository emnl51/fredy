/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { issueMcpToken, listMcpTokens, revokeMcpToken } from '../../services/storage/mcpTokenStorage.js';

export default async function mcpTokenPlugin(fastify) {
  fastify.get('/', async (request) => listMcpTokens(request.session.currentUser));

  fastify.post('/', async (request, reply) => {
    try {
      return issueMcpToken({
        userId: request.session.currentUser,
        name: request.body?.name,
        scopes: request.body?.scopes,
        expiresAt: request.body?.expiresAt ?? null,
      });
    } catch (error) {
      return reply.code(400).send({ error: error.message });
    }
  });

  fastify.delete('/:tokenId', async (request, reply) => {
    const revoked = revokeMcpToken(request.session.currentUser, String(request.params.tokenId));
    if (!revoked) return reply.code(404).send({ error: 'Token not found.' });
    return { revoked: true };
  });
}
