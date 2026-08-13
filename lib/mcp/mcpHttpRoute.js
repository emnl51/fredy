/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createMcpServer } from './mcpAdapter.js';
import { authenticateRequest } from './mcpAuthentication.js';
import logger from '../services/logger.js';
import crypto from 'crypto';

/**
 * Active transports keyed by session id.
 * @type {Map<string, { server: McpServer, transport: StreamableHTTPServerTransport }>}
 */
const sessions = new Map();
const requestWindows = new Map();
const MCP_RATE_LIMIT = 120;
const MCP_RATE_WINDOW_MS = 60_000;

function withinRateLimit(auth) {
  const now = Date.now();
  const current = requestWindows.get(auth.tokenId);
  if (!current || now - current.startedAt >= MCP_RATE_WINDOW_MS) {
    requestWindows.set(auth.tokenId, { startedAt: now, count: 1 });
    return true;
  }
  current.count += 1;
  return current.count <= MCP_RATE_LIMIT;
}

/**
 * @param {string|undefined} sessionId
 * @param {{ userId: string }} auth
 */
function getOrCreateSession(sessionId, auth) {
  if (sessionId && sessions.has(sessionId)) {
    const existing = sessions.get(sessionId);
    if (existing.userId !== auth.userId || existing.tokenId !== auth.tokenId) {
      throw new Error('MCP session belongs to a different token.');
    }
    return existing;
  }

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => crypto.randomUUID(),
    onsessioninitialized: (sid) => {
      sessions.set(sid, entry);
      logger.debug(`MCP session created: ${sid}`);
    },
  });

  const server = createMcpServer();
  const entry = { server, transport, userId: auth.userId, tokenId: auth.tokenId };

  transport.onclose = () => {
    const sid = transport.sessionId;
    if (sid) {
      sessions.delete(sid);
      logger.debug(`MCP session closed: ${sid}`);
    }
  };

  return entry;
}

/**
 * Register MCP Streamable HTTP routes on a fastify instance.
 *
 * POST /api/mcp  - JSON-RPC messages
 * GET  /api/mcp  - SSE stream for server-initiated notifications
 * DELETE /api/mcp - session termination
 *
 * All endpoints require a valid Bearer token in the Authorization header.
 *
 * @param {import('fastify').FastifyInstance} fastify
 */
export function registerMcpRoutes(fastify) {
  fastify.post('/api/mcp', async (request, reply) => {
    const auth = authenticateRequest(request.raw);
    if (!auth) {
      return reply.code(401).send({ error: 'Unauthorized. Provide a valid Bearer token.' });
    }
    if (!withinRateLimit(auth)) return reply.code(429).send({ error: 'MCP rate limit exceeded.' });

    const sessionId = request.raw.headers['mcp-session-id'];
    let entry;
    try {
      entry = getOrCreateSession(sessionId, auth);
    } catch (error) {
      return reply.code(403).send({ error: error.message });
    }
    const { server, transport } = entry;

    if (!transport.onmessage) {
      await server.connect(transport);
    }

    request.raw.auth = auth;

    reply.hijack();
    await transport.handleRequest(request.raw, reply.raw, request.body);
  });

  fastify.get('/api/mcp', async (request, reply) => {
    const auth = authenticateRequest(request.raw);
    if (!auth) {
      return reply.code(401).send({ error: 'Unauthorized. Provide a valid Bearer token.' });
    }

    const sessionId = request.raw.headers['mcp-session-id'];
    if (!sessionId || !sessions.has(sessionId)) {
      return reply.code(400).send({ error: 'Invalid or missing session. Send an initialize request first.' });
    }

    const entry = sessions.get(sessionId);
    if (entry.userId !== auth.userId || entry.tokenId !== auth.tokenId) {
      return reply.code(403).send({ error: 'MCP session belongs to a different token.' });
    }
    const { transport } = entry;
    request.raw.auth = auth;
    reply.hijack();
    await transport.handleRequest(request.raw, reply.raw);
  });

  fastify.delete('/api/mcp', async (request, reply) => {
    const auth = authenticateRequest(request.raw);
    if (!auth) {
      return reply.code(401).send({ error: 'Unauthorized. Provide a valid Bearer token.' });
    }

    const sessionId = request.raw.headers['mcp-session-id'];
    if (!sessionId || !sessions.has(sessionId)) {
      return reply.code(404).send({ error: 'Session not found.' });
    }

    const entry = sessions.get(sessionId);
    if (entry.userId !== auth.userId || entry.tokenId !== auth.tokenId) {
      return reply.code(403).send({ error: 'MCP session belongs to a different token.' });
    }
    const { transport } = entry;
    await transport.close();
    sessions.delete(sessionId);
    return { ok: true };
  });

  logger.debug('MCP Streamable HTTP endpoint registered at /api/mcp');
}
