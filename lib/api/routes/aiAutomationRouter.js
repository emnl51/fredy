/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { authenticateRequest } from '../../mcp/mcpAuthentication.js';
import { getUser } from '../../services/storage/userStorage.js';
import {
  findListingCandidates,
  findReliableListingCandidate,
  proposeApplicationUpdate,
} from '../../services/storage/automationStorage.js';
import { getApplicationContext } from '../../services/storage/applicationStorage.js';

const MAX_STRING_LENGTH = 500;
const MAX_REASON_LENGTH = 500;
const MAX_EVENT_ID_LENGTH = 500;
const MAX_REQUESTS_PER_MINUTE = 60;
const requestWindows = new Map();

function authForScope(request, reply, scope) {
  const auth = authenticateRequest(request.raw);
  if (!auth) {
    reply.code(401).send({ error: 'Unauthorized. Provide a valid Bearer token.' });
    return null;
  }
  if (!auth.scopes.includes(scope)) {
    reply.code(403).send({ error: `Token is missing required scope: ${scope}.` });
    return null;
  }
  const user = getUser(auth.userId);
  if (!user) {
    reply.code(401).send({ error: 'Unauthorized. Provide a valid Bearer token.' });
    return null;
  }

  const now = Date.now();
  const current = requestWindows.get(auth.tokenId);
  if (!current || now - current.startedAt >= 60_000) {
    requestWindows.set(auth.tokenId, { startedAt: now, count: 1 });
  } else {
    current.count += 1;
    if (current.count > MAX_REQUESTS_PER_MINUTE) {
      reply.code(429).send({ error: 'AI automation rate limit exceeded.' });
      return null;
    }
  }
  return { auth, user };
}

function stringOrUndefined(value, name, maxLength = MAX_STRING_LENGTH) {
  if (value == null || value === '') return undefined;
  if (typeof value !== 'string') throw new Error(`${name} must be a string.`);
  const trimmed = value.trim();
  if (trimmed.length > maxLength) throw new Error(`${name} is too long.`);
  return trimmed || undefined;
}

function requireString(value, name, maxLength = MAX_STRING_LENGTH) {
  const result = stringOrUndefined(value, name, maxLength);
  if (!result) throw new Error(`${name} is required.`);
  return result;
}

function onlyKnownFields(value, allowed, name = 'request') {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${name} must be an object.`);
  const unexpected = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unexpected.length) throw new Error(`Unexpected ${name} field: ${unexpected[0]}.`);
  return value;
}

function finiteOptionalNumber(value, name) {
  if (value == null || value === '') return undefined;
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`${name} must be a number.`);
  return number;
}

function safeCandidates(candidates) {
  return candidates.map(({ id, title, address, provider, link, status, createdAt }) => ({
    id,
    title,
    address,
    provider,
    link,
    status,
    createdAt,
  }));
}

function safeContext(context) {
  return {
    id: context.id,
    title: context.title,
    address: context.address,
    provider: context.provider,
    status: context.status,
    appointments: context.appointments.map(({ id, startsAt, endsAt, timezone, location, state }) => ({
      id,
      startsAt,
      endsAt,
      timezone,
      location,
      state,
    })),
    tasks: context.tasks.map(({ id, type, title, dueAt, state }) => ({ id, type, title, dueAt, state })),
  };
}

function proposalPayload(body) {
  const payload = {
    expectedStatus: body.expectedStatus ?? undefined,
    status: body.status ?? undefined,
    appointment: undefined,
    tasks: undefined,
  };
  if (payload.expectedStatus != null && typeof payload.expectedStatus !== 'string')
    throw new Error('expectedStatus must be a string or null.');
  if (payload.status != null && typeof payload.status !== 'string') throw new Error('status must be a string or null.');
  if (body.appointment != null) {
    const appointment = onlyKnownFields(
      body.appointment,
      ['action', 'startsAt', 'endsAt', 'timezone', 'location'],
      'appointment',
    );
    payload.appointment = {
      action: requireString(appointment.action, 'appointment.action', 32),
      startsAt: finiteOptionalNumber(appointment.startsAt, 'appointment.startsAt'),
      endsAt: finiteOptionalNumber(appointment.endsAt, 'appointment.endsAt'),
      timezone: stringOrUndefined(appointment.timezone, 'appointment.timezone', 64),
      location: stringOrUndefined(appointment.location, 'appointment.location'),
    };
  }
  if (body.tasks != null) {
    if (!Array.isArray(body.tasks) || body.tasks.length > 10)
      throw new Error('tasks must contain at most ten entries.');
    payload.tasks = body.tasks.map((task) => {
      onlyKnownFields(task, ['type', 'title', 'dueAt'], 'task');
      return {
        type: requireString(task.type, 'task.type', 64),
        title: stringOrUndefined(task.title, 'task.title'),
        dueAt: finiteOptionalNumber(task.dueAt, 'task.dueAt'),
      };
    });
  }
  return payload;
}

/**
 * Narrow bearer-token HTTP API for deterministic automation platforms such as n8n.
 *
 * It deliberately accepts only structured facts. Mail bodies, headers, attachments and
 * credentials are neither accepted nor persisted. Suggestions always require review in Fredy.
 */
export default async function aiAutomationPlugin(fastify) {
  fastify.post('/listing-candidates', async (request, reply) => {
    const authorized = authForScope(request, reply, 'listings:read');
    if (!authorized) return;
    try {
      onlyKnownFields(request.body ?? {}, ['objectReference', 'address', 'title', 'provider', 'limit']);
      const facts = {
        objectReference: stringOrUndefined(request.body?.objectReference, 'objectReference'),
        address: stringOrUndefined(request.body?.address, 'address'),
        title: stringOrUndefined(request.body?.title, 'title'),
        provider: stringOrUndefined(request.body?.provider, 'provider'),
        limit: finiteOptionalNumber(request.body?.limit, 'limit'),
      };
      const candidates = findListingCandidates({ userId: authorized.user.id, ...facts });
      const reliableCandidate = findReliableListingCandidate(candidates, facts);
      return { candidates: safeCandidates(candidates), reliableCandidate };
    } catch (error) {
      return reply.code(400).send({ error: error.message });
    }
  });

  fastify.post('/application-context', async (request, reply) => {
    const authorized = authForScope(request, reply, 'applications:read');
    if (!authorized) return;
    try {
      onlyKnownFields(request.body ?? {}, ['listingId']);
      const listingId = requireString(request.body?.listingId, 'listingId');
      const context = getApplicationContext(listingId, authorized.user.id, false);
      if (!context) return reply.code(404).send({ error: 'Listing not found.' });
      return safeContext(context);
    } catch (error) {
      return reply.code(400).send({ error: error.message });
    }
  });

  fastify.post('/suggestions', async (request, reply) => {
    const authorized = authForScope(request, reply, 'applications:propose');
    if (!authorized) return;
    try {
      const body = onlyKnownFields(request.body ?? {}, [
        'listingId',
        'expectedStatus',
        'status',
        'appointment',
        'tasks',
        'confidence',
        'reason',
        'externalEventId',
      ]);
      const listingId = requireString(body.listingId, 'listingId');
      const confidence = finiteOptionalNumber(body.confidence, 'confidence');
      const reason = requireString(body.reason, 'reason', MAX_REASON_LENGTH);
      const externalEventId = requireString(body.externalEventId, 'externalEventId', MAX_EVENT_ID_LENGTH);
      const payload = proposalPayload(body);
      const suggestion = proposeApplicationUpdate({
        userId: authorized.user.id,
        listingId,
        payload,
        confidence,
        reason,
        externalEventId,
      });
      return reply.code(suggestion.duplicate ? 200 : 201).send(suggestion);
    } catch (error) {
      return reply.code(400).send({ error: error.message });
    }
  });
}
