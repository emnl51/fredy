/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { describe, expect, it } from 'vitest';
import { findReliableListingCandidate } from '../../lib/services/storage/automationStorage.js';

const candidate = (overrides = {}) => ({
  id: 'l1',
  title: '2 Zimmer',
  address: 'Thomas-Mann-Str. 12, 10409 Berlin',
  link: 'https://example.test/1000%2F00185%2F0101%2F0218',
  description: '',
  ...overrides,
});

describe('findReliableListingCandidate', () => {
  it('uses a uniquely matching decoded object reference', () => {
    expect(findReliableListingCandidate([candidate()], { objectReference: '1000/00185/0101/0218' })).toEqual({
      listingId: 'l1',
      confidence: 100,
      matchMethod: 'object_reference',
    });
  });

  it('uses a unique normalized full address when there is no object reference', () => {
    expect(findReliableListingCandidate([candidate()], { address: 'Thomas Mann Straße 12, 10409 Berlin' })).toEqual({
      listingId: 'l1',
      confidence: 95,
      matchMethod: 'normalized_address',
    });
  });

  it('does not automatically match ambiguous references or partial addresses', () => {
    expect(
      findReliableListingCandidate([candidate(), candidate({ id: 'l2' })], { objectReference: '1000/00185/0101/0218' }),
    ).toBeNull();
    expect(findReliableListingCandidate([candidate()], { address: 'Thomas-Mann-Str. 12' })).toBeNull();
  });
});
