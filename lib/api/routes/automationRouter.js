/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { decideAutomationSuggestion, listAutomationSuggestions } from '../../services/storage/automationStorage.js';

export default async function automationPlugin(fastify) {
  fastify.get('/suggestions', async (request) =>
    listAutomationSuggestions(request.session.currentUser, String(request.query?.state ?? 'pending')),
  );

  fastify.put('/suggestions/:suggestionId', async (request, reply) => {
    try {
      const result = decideAutomationSuggestion({
        suggestionId: String(request.params.suggestionId),
        userId: request.session.currentUser,
        decision: request.body?.decision,
        editedPayload: request.body?.payload ?? null,
      });
      if (!result) return reply.code(404).send({ error: 'Pending suggestion not found.' });
      return result;
    } catch (error) {
      return reply.code(409).send({ error: error.message });
    }
  });
}
