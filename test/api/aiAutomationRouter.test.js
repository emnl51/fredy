/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';

const state = {
  auth: {
    tokenId: 'token-1',
    userId: 'user-1',
    scopes: ['listings:read', 'applications:read', 'applications:propose'],
  },
  user: { id: 'user-1', isAdmin: false },
};

vi.mock('../../lib/mcp/mcpAuthentication.js', () => ({
  authenticateRequest: vi.fn(() => state.auth),
}));
vi.mock('../../lib/services/storage/userStorage.js', () => ({
  getUser: vi.fn(() => state.user),
}));
vi.mock('../../lib/services/storage/automationStorage.js', () => ({
  findListingCandidates: vi.fn(() => [
    {
      id: 'listing-1',
      title: 'Apartment',
      address: 'Thomas-Mann-Str. 12, 10409 Berlin',
      provider: 'Gewobag',
      link: 'https://example.test/1000%2F00185%2F0101%2F0218',
      description: 'Private details must not leave this module',
      status: { status: 'applied' },
      createdAt: 1,
    },
  ]),
  findReliableListingCandidate: vi.fn(() => ({
    listingId: 'listing-1',
    confidence: 100,
    matchMethod: 'object_reference',
  })),
  proposeApplicationUpdate: vi.fn(() => ({ id: 'suggestion-1', state: 'pending', duplicate: false })),
}));
vi.mock('../../lib/services/storage/applicationStorage.js', () => ({
  getApplicationContext: vi.fn(() => ({
    id: 'listing-1',
    title: 'Apartment',
    address: 'Thomas-Mann-Str. 12, 10409 Berlin',
    provider: 'Gewobag',
    link: 'https://example.test/private',
    status: { status: 'applied' },
    appointments: [
      {
        id: 'appointment-1',
        startsAt: 10,
        endsAt: null,
        timezone: 'Europe/Berlin',
        location: null,
        state: 'scheduled',
      },
    ],
    tasks: [{ id: 'task-1', type: 'upload_documents', title: 'Upload documents', dueAt: 20, state: 'pending' }],
    events: [{ reason: 'Must not be returned' }],
  })),
}));

import {
  findListingCandidates,
  findReliableListingCandidate,
  proposeApplicationUpdate,
} from '../../lib/services/storage/automationStorage.js';
import { getApplicationContext } from '../../lib/services/storage/applicationStorage.js';
import aiAutomationPlugin from '../../lib/api/routes/aiAutomationRouter.js';

describe('AI automation HTTP routes', () => {
  let app;

  beforeEach(async () => {
    vi.clearAllMocks();
    state.auth = {
      tokenId: 'token-1',
      userId: 'user-1',
      scopes: ['listings:read', 'applications:read', 'applications:propose'],
    };
    state.user = { id: 'user-1', isAdmin: false };
    app = Fastify();
    await app.register(aiAutomationPlugin, { prefix: '/api/ai' });
    await app.ready();
  });

  afterEach(async () => app.close());

  it('returns only minimum candidate fields and a server-calculated reliable match', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/ai/listing-candidates',
      payload: { objectReference: '1000/00185/0101/0218', address: 'Thomas-Mann-Str. 12, 10409 Berlin' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      candidates: [
        {
          id: 'listing-1',
          title: 'Apartment',
          address: 'Thomas-Mann-Str. 12, 10409 Berlin',
          provider: 'Gewobag',
          link: 'https://example.test/1000%2F00185%2F0101%2F0218',
          status: { status: 'applied' },
          createdAt: 1,
        },
      ],
      reliableCandidate: { listingId: 'listing-1', confidence: 100, matchMethod: 'object_reference' },
    });
    expect(findListingCandidates).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-1', objectReference: '1000/00185/0101/0218' }),
    );
    expect(findReliableListingCandidate).toHaveBeenCalled();
  });

  it('requires the appropriate scope for every endpoint', async () => {
    state.auth.scopes = ['listings:read'];
    const response = await app.inject({
      method: 'POST',
      url: '/api/ai/application-context',
      payload: { listingId: 'listing-1' },
    });
    expect(response.statusCode).toBe(403);
    expect(getApplicationContext).not.toHaveBeenCalled();
  });

  it('returns a minimized context for the chosen user-owned listing', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/ai/application-context',
      payload: { listingId: 'listing-1' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).not.toHaveProperty('link');
    expect(response.json()).not.toHaveProperty('events');
    expect(getApplicationContext).toHaveBeenCalledWith('listing-1', 'user-1', false);
  });

  it('creates a review-only suggestion from a strict, minimal payload', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/ai/suggestions',
      payload: {
        listingId: 'listing-1',
        expectedStatus: 'applied',
        status: 'invited',
        appointment: { action: 'create', startsAt: 1786534200000, timezone: 'Europe/Berlin' },
        confidence: 100,
        reason: 'Exact object reference match.',
        externalEventId: 'gmail-message-1',
      },
    });
    expect(response.statusCode).toBe(201);
    expect(proposeApplicationUpdate).toHaveBeenCalledWith({
      userId: 'user-1',
      listingId: 'listing-1',
      payload: {
        expectedStatus: 'applied',
        status: 'invited',
        appointment: { action: 'create', startsAt: 1786534200000, timezone: 'Europe/Berlin' },
        tasks: undefined,
      },
      confidence: 100,
      reason: 'Exact object reference match.',
      externalEventId: 'gmail-message-1',
    });
  });

  it('rejects mail bodies and other fields outside the minimum contract', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/ai/suggestions',
      payload: {
        listingId: 'listing-1',
        status: 'applied',
        confidence: 100,
        reason: 'Exact reference match.',
        externalEventId: 'gmail-message-1',
        body: 'Private correspondence',
      },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toMatch(/Unexpected request field: body/);
    expect(proposeApplicationUpdate).not.toHaveBeenCalled();
  });
});
