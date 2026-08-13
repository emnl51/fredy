/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { describe, expect, it, vi } from 'vitest';
import {
  extractListingCodes,
  extractAddressVariants,
  inferGermanApplicationUpdate,
  matchUnmatchedMailMessages,
  normalizeMailMatchText,
  normalizeMatchableAddress,
} from '../../../lib/services/mail/mailListingMatcher.js';

describe('mailListingMatcher normalization', () => {
  it('normalizes German text and extracts safe URL identifiers', () => {
    expect(normalizeMailMatchText('Grüße aus der Goethestraße!')).toBe('grusse aus der goethestrasse');
    expect(extractListingCodes('https://www.immobilienscout24.de/expose/123456789')).toEqual(['123456789']);
    expect(extractListingCodes('https://example.com/wohnung/10115/berlin')).toEqual([]);
  });

  it('requires a street-level address with a house number', () => {
    expect(normalizeMatchableAddress('Goethestraße 18, 10625 Berlin')).toBe('goethe str 18 10625 berlin');
    expect(normalizeMatchableAddress('10625 Berlin')).toBeNull();
  });

  it('normalizes common German street and house-number spelling variants', () => {
    expect(extractAddressVariants('Goethestraße 18 a, 10625 Berlin')).toEqual([
      'goethe str 18a 10625 berlin',
      'goethe str 18a',
    ]);
    expect(extractListingCodes('https://example.com/search?object_id=AB-12345#offer-998877')).toEqual([
      'ab12345',
      '998877',
      'offer998877',
    ]);
  });
});

describe('matchUnmatchedMailMessages', () => {
  const listings = [
    {
      id: 'listing-1',
      link: 'https://www.immobilienscout24.de/expose/123456789',
      address: 'Goethestraße 18, 10625 Berlin',
    },
    {
      id: 'listing-2',
      link: 'https://www.wg-gesucht.de/9876543.html',
      address: 'Kantstraße 10, 10623 Berlin',
    },
  ];

  it('prefers a unique listing code over another address in the same message', async () => {
    const assign = vi.fn(() => true);
    const result = await matchUnmatchedMailMessages('user-1', {
      messages: [
        {
          id: 'message-1',
          subject: 'Ihre Anfrage 123456789',
          textBody: 'Unser Büro ist in der Kantstraße 10, 10623 Berlin.',
        },
      ],
      listings,
      assign,
    });

    expect(assign).toHaveBeenCalledWith({
      messageId: 'message-1',
      listingId: 'listing-1',
      userId: 'user-1',
      method: 'listing_code',
      confidence: 100,
      automatic: true,
    });
    expect(result).toEqual({ processed: 1, matched: 1, ambiguous: 0 });
  });

  it('matches a slash-formatted Objektnummer from the listing hash and marks the application', async () => {
    const assign = vi.fn(() => true);
    await matchUnmatchedMailMessages('user-1', {
      messages: [
        {
          id: 'gewobag-confirmation',
          subject: 'Anfragebestätigung – Objektnummer "1000/00191/0101/0002"',
          textBody:
            'Wir freuen uns über Ihre Anfrage. Greifswalder Str. 87, 10409 Berlin. Objektnummer: 1000/00191/0101/0002',
        },
      ],
      listings: [
        {
          id: 'gewobag-listing',
          hash: '1000/00191/0101/0002',
          link: 'https://example.com/object',
          address: 'Greifswalder Straße 87, 10409 Berlin',
        },
      ],
      assign,
    });

    expect(assign).toHaveBeenCalledWith(
      expect.objectContaining({
        listingId: 'gewobag-listing',
        method: 'listing_code',
        status: 'applied',
        automatic: true,
      }),
    );
  });

  it('recognizes a household self-disclosure request as an application update', async () => {
    expect(
      inferGermanApplicationUpdate(
        'Ihr Interesse Egon-Erwin-Kisch-Str. 1, 13059 Berlin',
        'Um Ihre Anfrage weiter bearbeiten zu können, bitten wir Sie, weitere Informationen zu Ihrem Haushalt hochzuladen.',
      ),
    ).toEqual({ status: 'applied' });
  });

  it('recognizes a German document request without treating generic mail as documents sent', async () => {
    expect(
      inferGermanApplicationUpdate(
        'Neue Nachricht – Objektnummer 1000/00185/0101/0218',
        'Bitte verwenden Sie das Formular, um folgende Unterlagen hochzuladen: Einkommen, Schufa, Mietschuldenfreiheit.',
      ),
    ).toEqual({ status: 'documents_sent' });
    expect(inferGermanApplicationUpdate('Unterlagen zu Ihrer Information', 'Vielen Dank.')).toBeNull();
  });

  it('extracts the viewing date and time from a German Terminbestätigung', async () => {
    const update = inferGermanApplicationUpdate(
      'Terminbestätigung – Objektnummer 1000/00185/0101/0218',
      'Der Termin für das Objekt findet am 11.08.2026 um 13:30 Uhr statt.',
    );

    expect(update).toEqual({
      status: 'invited',
      appointmentAt: new Date(2026, 7, 11, 13, 30).getTime(),
    });
  });

  it.each([
    'Einladung zum Besichtigungstermin - Immobilienanfrage',
    'Terminerinnerung - Immobilienanfrage',
    'Erinnerung Besichtigungstermin - Egon-Erwin-Kisch-Str. 1',
    'Terminbestätigung: Baikalstr. 21, 10319 Berlin',
    'Einladung Terminbuchung Welsestr. 95, 13057 Berlin',
    'Einladung zu einem Besichtigungstermin Karl-Marx-Allee 48',
  ])('recognizes invitation subject: %s', (subject) => {
    expect(inferGermanApplicationUpdate(subject, 'Wir freuen uns auf Ihren Besuch.')).toEqual({ status: 'invited' });
  });

  it('recognizes an abbreviated required-documents subject', () => {
    expect(
      inferGermanApplicationUpdate('Mietobjekt Welsestr. 95, 13057 Berlin Erforderl. Unterlag', 'Guten Tag'),
    ).toEqual({ status: 'documents_sent' });
  });

  it('recognizes provider-specific application and form confirmations', () => {
    expect(inferGermanApplicationUpdate('Bestätigung Ihrer Anfrage - Immobilienanfrage', 'Vielen Dank.')).toEqual({
      status: 'applied',
    });
    expect(inferGermanApplicationUpdate('Formularbestätigung - Immobilienanfrage', 'Vielen Dank.')).toEqual({
      status: 'documents_sent',
    });
  });

  it('does not assign workflow stages from generic portal subjects', () => {
    expect(
      inferGermanApplicationUpdate('Ihre persönliche Vorstellung beim Anbieter', 'Die Nr. 1 für Immobilien'),
    ).toBeNull();
    expect(inferGermanApplicationUpdate('Ihre Wohnungsanfrage - Selbstauskunft', 'Guten Tag')).toBeNull();
  });

  it('matches a Deutsche Wohnen slash reference in parentheses', async () => {
    const assign = vi.fn(() => true);
    await matchUnmatchedMailMessages('user-1', {
      messages: [
        {
          id: 'deutsche-wohnen-message',
          subject: 'Ihre Immobilienanfrage Turiner Straße 14 (0851/343381/3004) #IO_23509022#',
        },
      ],
      listings: [
        {
          id: 'deutsche-wohnen-listing',
          hash: '0851/343381/3004',
          link: 'https://example.com/listing',
          address: 'Turiner Straße 14, 13347 Berlin',
        },
      ],
      assign,
    });

    expect(assign).toHaveBeenCalledWith(
      expect.objectContaining({ listingId: 'deutsche-wohnen-listing', method: 'listing_code', automatic: true }),
    );
  });

  it('extracts a bare parenthesized Objekt number without assigning a generic new-message status', async () => {
    const assign = vi.fn(() => true);
    await matchUnmatchedMailMessages('user-1', {
      messages: [
        {
          id: 'immoscout-message',
          subject: 'Neue Nachricht zu Ihrer Anfrage (Objekt 169767342)',
          textBody: 'Du hast eine neue Nachricht vom Anbieter.',
        },
      ],
      listings: [
        {
          id: 'immoscout-listing',
          hash: '169767342',
          link: 'https://www.immobilienscout24.de/expose/169767342',
          address: 'Welsestraße 95, 13057 Berlin',
        },
      ],
      assign,
    });

    expect(assign).toHaveBeenCalledWith(
      expect.objectContaining({ listingId: 'immoscout-listing', method: 'listing_code', automatic: true }),
    );
    expect(assign.mock.calls[0][0]).not.toHaveProperty('status');
  });

  it('matches a reference number embedded in a typical German reply', async () => {
    const assign = vi.fn(() => true);
    await matchUnmatchedMailMessages('user-1', {
      messages: [
        {
          id: 'message-german-reference',
          subject: 'Bestätigung Ihrer Anfrage – Objektnummer 123456789',
          textBody: 'Vielen Dank für Ihr Interesse an der Wohnung.',
        },
      ],
      listings,
      assign,
    });

    expect(assign).toHaveBeenCalledWith(
      expect.objectContaining({ listingId: 'listing-1', method: 'listing_code', confidence: 100 }),
    );
  });

  it('matches a labeled reference whose digits are visually grouped', async () => {
    const assign = vi.fn(() => true);
    await matchUnmatchedMailMessages('user-1', {
      messages: [{ id: 'formatted-reference', subject: 'Objekt-Nr.: 123 456 789', textBody: null }],
      listings,
      assign,
    });

    expect(assign).toHaveBeenCalledWith(
      expect.objectContaining({ messageId: 'formatted-reference', listingId: 'listing-1', method: 'listing_code' }),
    );
  });

  it('uses an exact normalized address when no listing code is present', async () => {
    const assign = vi.fn(() => true);
    await matchUnmatchedMailMessages('user-1', {
      messages: [{ id: 'message-2', subject: 'Besichtigung', textBody: 'Objekt: Goethestrasse 18, 10625 Berlin' }],
      listings,
      assign,
    });

    expect(assign).toHaveBeenCalledWith(expect.objectContaining({ listingId: 'listing-1', method: 'address' }));
  });

  it('matches a unique street and house number when postcode and city are omitted', async () => {
    const assign = vi.fn(() => true);
    await matchUnmatchedMailMessages('user-1', {
      messages: [{ id: 'short-address', subject: 'Termin in der Goethestr. 18', textBody: null }],
      listings,
      assign,
    });

    expect(assign).toHaveBeenCalledWith(expect.objectContaining({ listingId: 'listing-1', method: 'address' }));
  });

  it('keeps a shared street and house number ambiguous without another signal', async () => {
    const assign = vi.fn(() => true);
    const result = await matchUnmatchedMailMessages('user-1', {
      messages: [{ id: 'shared-address', subject: 'Termin Goethestrasse 18', textBody: null }],
      listings: [listings[0], { ...listings[0], id: 'listing-other-city', address: 'Goethestraße 18, 04109 Leipzig' }],
      assign,
    });

    expect(assign).not.toHaveBeenCalled();
    expect(result.ambiguous).toBe(1);
  });

  it('uses the sender portal to disambiguate duplicate portal identifiers', async () => {
    const assign = vi.fn(() => true);
    await matchUnmatchedMailMessages('user-1', {
      messages: [
        {
          id: 'portal-code',
          senderAddress: 'service@immobilienscout24.de',
          subject: 'Objektnummer 123456789',
          textBody: null,
        },
      ],
      listings: [listings[0], { ...listings[0], id: 'other-portal', link: 'https://example.org/expose/123456789' }],
      assign,
    });

    expect(assign).toHaveBeenCalledWith(expect.objectContaining({ listingId: 'listing-1' }));
  });

  it('uses an explicit provider name to narrow otherwise duplicate identifiers', async () => {
    const assign = vi.fn(() => true);
    await matchUnmatchedMailMessages('user-1', {
      messages: [{ id: 'provider-code', subject: 'WG-Gesucht Anfrage 123456789', textBody: null }],
      listings: [
        { ...listings[0], provider: 'ImmobilienScout24' },
        {
          ...listings[0],
          id: 'wg-duplicate',
          provider: 'WG Gesucht',
          link: 'https://www.wg-gesucht.de/123456789.html',
        },
      ],
      assign,
    });

    expect(assign).toHaveBeenCalledWith(expect.objectContaining({ listingId: 'wg-duplicate' }));
  });

  it('uses a distinctive full title only as an ambiguity tie-breaker', async () => {
    const assign = vi.fn(() => true);
    await matchUnmatchedMailMessages('user-1', {
      messages: [
        {
          id: 'title-code',
          subject: '123456789 – Helle Altbauwohnung am Viktoriapark',
          textBody: null,
        },
      ],
      listings: [
        { ...listings[0], title: 'Ruhiges Apartment am Lietzensee' },
        { ...listings[0], id: 'title-match', title: 'Helle Altbauwohnung am Viktoriapark' },
      ],
      assign,
    });

    expect(assign).toHaveBeenCalledWith(expect.objectContaining({ listingId: 'title-match' }));
  });

  it('inherits a listing match through a German email thread', async () => {
    const assign = vi.fn(() => true);
    const result = await matchUnmatchedMailMessages('user-1', {
      messages: [
        {
          id: 'reply-1',
          messageId: '<reply-1@example.com>',
          inReplyTo: '<application-1@example.com>',
          references: ['<application-1@example.com>'],
          subject: 'AW: Ihre Anfrage',
          textBody: 'Der Besichtigungstermin wurde bestätigt.',
        },
        {
          id: 'application-1',
          messageId: '<application-1@example.com>',
          subject: 'Bestätigung Ihrer Anfrage 123456789',
          textBody: null,
        },
      ],
      listings,
      assign,
    });

    expect(assign).toHaveBeenCalledWith(
      expect.objectContaining({ messageId: 'reply-1', listingId: 'listing-1', method: 'thread', confidence: 95 }),
    );
    expect(result).toEqual({ processed: 2, matched: 2, ambiguous: 0 });
  });

  it('normalizes brackets and casing in email thread identifiers', async () => {
    const assign = vi.fn(() => true);
    await matchUnmatchedMailMessages('user-1', {
      anchors: [{ messageId: '<Application-Case@Example.COM>', listingId: 'listing-1' }],
      messages: [
        {
          id: 'case-reply',
          messageId: '<case-reply@example.com>',
          inReplyTo: 'application-case@example.com',
          references: [],
          subject: 'AW: Ihre Anfrage',
          textBody: null,
        },
      ],
      listings,
      assign,
    });

    expect(assign).toHaveBeenCalledWith(
      expect.objectContaining({ messageId: 'case-reply', listingId: 'listing-1', method: 'thread' }),
    );
  });

  it('accepts a whitespace-separated References header from an injected source', async () => {
    const assign = vi.fn(() => true);
    await matchUnmatchedMailMessages('user-1', {
      anchors: [{ messageId: '<root@example.com>', listingId: 'listing-1' }],
      messages: [
        {
          id: 'string-references',
          messageId: '<reply@example.com>',
          references: '<unrelated@example.com> <ROOT@example.com>',
          subject: 'AW: Termin',
        },
      ],
      listings,
      assign,
    });

    expect(assign).toHaveBeenCalledWith(expect.objectContaining({ listingId: 'listing-1', method: 'thread' }));
  });

  it('leaves a message unresolved when direct evidence contradicts its established thread', async () => {
    const assign = vi.fn(() => true);
    const result = await matchUnmatchedMailMessages('user-1', {
      anchors: [{ messageId: '<root@example.com>', listingId: 'listing-1' }],
      messages: [
        {
          id: 'conflicting-reply',
          inReplyTo: '<root@example.com>',
          references: [],
          subject: 'Objektnummer 9876543',
        },
      ],
      listings,
      assign,
    });

    expect(assign).not.toHaveBeenCalled();
    expect(result).toEqual({ processed: 1, matched: 0, ambiguous: 1 });
  });

  it('leaves duplicate identifiers unmatched for manual selection', async () => {
    const assign = vi.fn(() => true);
    const result = await matchUnmatchedMailMessages('user-1', {
      messages: [{ id: 'message-3', subject: '123456789', textBody: null }],
      listings: [...listings, { ...listings[0], id: 'listing-duplicate' }],
      assign,
    });

    expect(assign).not.toHaveBeenCalled();
    expect(result).toEqual({ processed: 1, matched: 0, ambiguous: 1 });
  });

  it('paginates past recent nonmatches so older messages are not starved', async () => {
    const assign = vi.fn(() => true);
    const getMessages = vi
      .fn()
      .mockReturnValueOnce([
        { id: 'new-2', subject: 'Newsletter', textBody: null, matchSortAt: 300 },
        { id: 'new-1', subject: 'General reply', textBody: null, matchSortAt: 200 },
      ])
      .mockReturnValueOnce([{ id: 'old-match', subject: 'Ihre Anfrage 123456789', textBody: null, matchSortAt: 100 }]);

    const result = await matchUnmatchedMailMessages('user-1', {
      getMessages,
      pageSize: 2,
      listings,
      assign,
    });

    expect(getMessages).toHaveBeenNthCalledWith(2, 'user-1', 2, { sortAt: 200, id: 'new-1' });
    expect(assign).toHaveBeenCalledWith(expect.objectContaining({ messageId: 'old-match', listingId: 'listing-1' }));
    expect(result).toEqual({ processed: 3, matched: 1, ambiguous: 0 });
  });
});
