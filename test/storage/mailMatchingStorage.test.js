/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const calls = vi.hoisted(() => []);
const owned = vi.hoisted(() => ({ message: true, listing: true }));
const mailAccount = vi.hoisted(() => ({ row: null }));
const sqliteMock = vi.hoisted(() => ({
  execute: vi.fn((sql, params) => {
    calls.push({ sql, params });
    return { changes: 1 };
  }),
  query: vi.fn(() => []),
  withTransaction: vi.fn((callback) =>
    callback({
      prepare: (sql) => ({
        get: () => {
          if (/FROM mail_accounts/.test(sql)) return mailAccount.row ?? undefined;
          if (/FROM mail_messages/.test(sql)) return owned.message ? { id: 'message-1' } : undefined;
          if (/FROM listings/.test(sql)) {
            return owned.listing
              ? { id: 'listing-1', status: JSON.stringify({ status: 'invited', setAt: 100, appointmentAt: 200 }) }
              : undefined;
          }
          return undefined;
        },
        run: (params) => {
          calls.push({ sql, params });
          return { changes: 1 };
        },
      }),
    }),
  ),
}));

vi.mock('../../lib/services/storage/SqliteConnection.js', () => ({ default: sqliteMock }));

const {
  assignMailMessageToListing,
  deleteAllMailMessages,
  getEnabledMailAccountsForSync,
  getMatchedMailThreadAnchors,
  getMailMessagesForListing,
  getInvitationTracking,
  getMailMessages,
  getUnmatchedMailMessages,
  markMailSyncSuccessful,
  removeMailMessageListingMatch,
  searchOwnedListingsForMailAssignment,
  setInvitationAppointment,
  purgeExpiredMailMessages,
  storeMailMessage,
  upsertMailAccount,
} = await import('../../lib/services/storage/mailStorage.js');

beforeEach(() => {
  process.env.FREDY_MAIL_ENCRYPTION_KEY = Buffer.alloc(32, 13).toString('base64');
  calls.length = 0;
  owned.message = true;
  owned.listing = true;
  mailAccount.row = null;
  vi.clearAllMocks();
});

describe('private mail storage', () => {
  it('stores private presentation fields only in the encrypted envelope', async () => {
    storeMailMessage({
      accountId: 'account-1',
      mailbox: 'INBOX',
      uidValidity: '1',
      uid: 10,
      senderName: 'Agent',
      senderAddress: 'agent@example.com',
      subject: 'Besichtigung',
      textBody: 'Private phone number',
    });

    const insert = calls.find((call) => /INSERT INTO mail_messages/.test(call.sql));
    expect(insert.sql).toMatch(/content_encrypted/);
    expect(insert.sql).not.toMatch(/sender_name/);
    expect(insert.params).not.toHaveProperty('textBody');
    expect(insert.params.contentEncrypted).toMatch(/^v1c\./);
    const { decryptMailContent } = await import('../../lib/services/mail/mailCredentialCrypto.js');
    expect(decryptMailContent(insert.params.contentEncrypted)).toEqual({
      senderName: 'Agent',
      senderAddress: 'agent@example.com',
      subject: 'Besichtigung',
      textBody: 'Private phone number',
    });
  });

  it('decrypts private fields before returning messages to the user', async () => {
    const { encryptMailContent } = await import('../../lib/services/mail/mailCredentialCrypto.js');
    sqliteMock.query.mockReturnValueOnce([
      {
        id: 'message-1',
        references_json: '[]',
        content_encrypted: encryptMailContent({
          senderName: 'Agent',
          senderAddress: 'agent@example.com',
          subject: 'Besichtigung',
          textBody: 'Private body',
        }),
      },
    ]);

    const [message] = getMailMessages('user-1');

    expect(message).toEqual(
      expect.objectContaining({
        senderName: 'Agent',
        senderAddress: 'agent@example.com',
        subject: 'Besichtigung',
        textBody: 'Private body',
      }),
    );
    expect(message).not.toHaveProperty('content_encrypted');
  });

  it('scopes bulk deletion to the requesting mailbox owner', () => {
    expect(deleteAllMailMessages('user-1')).toBe(1);
    expect(calls.at(-1).sql).toMatch(/user_id = @userId/);
    expect(calls.at(-1).params).toEqual({ userId: 'user-1' });
  });

  it('purges messages using each account retention period', () => {
    expect(purgeExpiredMailMessages(123456)).toBe(1);
    expect(calls.at(-1).sql).toMatch(/a\.retention_days \* 86400000/);
    expect(calls.at(-1).params).toEqual({ now: 123456 });
  });
});

describe('mail account identity', () => {
  const savedAccount = {
    id: 'account-old',
    host: 'imap.example.com',
    username: 'old@example.com',
    mailbox: 'INBOX',
  };
  const input = {
    userId: 'user-1',
    host: 'imap.example.com',
    port: 993,
    secure: true,
    username: 'old@example.com',
    passwordEncrypted: 'encrypted',
    mailbox: 'INBOX',
    enabled: true,
  };

  it.each([
    ['host', 'imap.other.example.com'],
    ['username', 'new@example.com'],
    ['mailbox', 'Applications'],
  ])('replaces the account identity when %s changes', (field, value) => {
    mailAccount.row = savedAccount;

    upsertMailAccount({ ...input, [field]: value });

    expect(calls.find((call) => /DELETE FROM mail_accounts/.test(call.sql))?.params).toEqual({ userId: 'user-1' });
    const insert = calls.find((call) => /INSERT INTO mail_accounts/.test(call.sql));
    expect(insert.params.id).not.toBe(savedAccount.id);
  });

  it('preserves the account identity and cursor for non-identity settings', () => {
    mailAccount.row = savedAccount;

    upsertMailAccount({ ...input, port: 143, secure: false, passwordEncrypted: 'new-encrypted' });

    expect(calls.some((call) => /DELETE FROM mail_accounts/.test(call.sql))).toBe(false);
    const insert = calls.find((call) => /INSERT INTO mail_accounts/.test(call.sql));
    expect(insert.params.id).toBe(savedAccount.id);
    expect(insert.sql).not.toMatch(/uid_validity\s*=/);
    expect(insert.sql).not.toMatch(/last_uid\s*=/);
  });

  it('prevents an in-flight sync for the previous identity from restoring its cursor', () => {
    mailAccount.row = savedAccount;

    upsertMailAccount({ ...input, username: 'new@example.com' });
    const replacement = calls.find((call) => /INSERT INTO mail_accounts/.test(call.sql));

    markMailSyncSuccessful(savedAccount.id, '42', 100);

    const cursorUpdate = calls.find((call) => /UPDATE mail_accounts/.test(call.sql));
    expect(replacement.params.id).not.toBe(savedAccount.id);
    expect(cursorUpdate.params.accountId).toBe(savedAccount.id);
    expect(cursorUpdate.sql).toMatch(/WHERE id = @accountId/);
  });
});

describe('mail matching storage ownership', () => {
  it('assigns owned rows and updates listing status atomically', () => {
    expect(
      assignMailMessageToListing({
        messageId: 'message-1',
        listingId: 'listing-1',
        userId: 'user-1',
        method: 'manual',
        confidence: 100,
        status: 'documents_sent',
      }),
    ).toBe(true);

    expect(calls.find((call) => /INSERT INTO mail_message_listing_matches/.test(call.sql))).toBeTruthy();
    const statusCall = calls.find((call) => /UPDATE listings SET status/.test(call.sql));
    expect(JSON.parse(statusCall.params.status).status).toBe('documents_sent');
    const watchCall = calls.find((call) => /INSERT INTO watch_list/.test(call.sql));
    expect(watchCall.params).toEqual(expect.objectContaining({ listingId: 'listing-1', userId: 'user-1' }));
  });

  it('does not assign a listing outside the mailbox owner', () => {
    owned.listing = false;
    expect(
      assignMailMessageToListing({
        messageId: 'message-1',
        listingId: 'someone-elses-listing',
        userId: 'user-1',
        method: 'manual',
        confidence: 100,
      }),
    ).toBe(false);
    expect(calls.some((call) => /INSERT INTO mail_message_listing_matches/.test(call.sql))).toBe(false);
  });

  it('scopes removal through the message account owner', () => {
    expect(removeMailMessageListingMatch('message-1', 'user-1')).toBe(true);
    expect(calls[0].sql).toMatch(/a\.user_id = @userId/);
    expect(calls[0].params).toEqual({ messageId: 'message-1', userId: 'user-1' });
  });

  it('uses a stable timestamp and id cursor for unmatched message pages', () => {
    getUnmatchedMailMessages('user-1', 200, { sortAt: 1234, id: 'message-9' });

    expect(sqliteMock.query).toHaveBeenCalledWith(expect.stringMatching(/m\.id < @cursorId/), {
      userId: 'user-1',
      limit: 200,
      cursorSortAt: 1234,
      cursorId: 'message-9',
    });
  });

  it('scopes thread anchors to the mailbox owner', () => {
    getMatchedMailThreadAnchors('user-1');

    expect(sqliteMock.query).toHaveBeenCalledWith(expect.stringMatching(/a\.user_id = @userId/), {
      userId: 'user-1',
    });
  });

  it('lists related messages through the requesting mailbox owner', () => {
    getMailMessagesForListing('user-1', 'listing-1');

    expect(sqliteMock.query).toHaveBeenCalledWith(expect.stringMatching(/a\.user_id = @userId/), {
      userId: 'user-1',
      listingId: 'listing-1',
    });
  });

  it('lists only enabled accounts without selecting credentials', () => {
    getEnabledMailAccountsForSync();

    const sql = sqliteMock.query.mock.calls.at(-1)[0];
    expect(sql).toMatch(/WHERE enabled = 1/);
    expect(sql).not.toMatch(/password_encrypted/);
  });

  it('searches only owned listings and escapes SQL wildcards', () => {
    searchOwnedListingsForMailAssignment('user-1', '50%_Berlin', 500);

    expect(sqliteMock.query).toHaveBeenCalledWith(expect.stringMatching(/j\.user_id = @userId/), {
      userId: 'user-1',
      query: '50%_berlin',
      pattern: '%50\\%\\_berlin%',
      limit: 200,
    });
  });

  it('lists only invited listings owned by the mailbox user', () => {
    sqliteMock.query.mockReturnValueOnce([
      { id: 'listing-1', status: JSON.stringify({ status: 'invited', setAt: 100, appointmentAt: 200 }) },
    ]);
    const [invitation] = getInvitationTracking('user-1');

    expect(sqliteMock.query.mock.calls[0][0]).toMatch(/j\.user_id = @userId/);
    expect(sqliteMock.query.mock.calls[0][0]).toMatch(/IN \('invited', 'visited'\)/);
    expect(invitation).toEqual(expect.objectContaining({ id: 'listing-1', appointmentAt: 200, messages: [] }));
  });

  it('keeps the appointment when a mail assignment marks an invitation visited', () => {
    expect(
      assignMailMessageToListing({
        messageId: 'message-1',
        listingId: 'listing-1',
        userId: 'user-1',
        method: 'manual',
        confidence: 100,
        status: 'visited',
      }),
    ).toBe(true);

    const statusCall = calls.find((call) => /UPDATE listings SET status/.test(call.sql));
    expect(JSON.parse(statusCall.params.status)).toEqual(
      expect.objectContaining({ status: 'visited', appointmentAt: 200 }),
    );
  });

  it('updates an invitation appointment without replacing its status timestamp', () => {
    expect(setInvitationAppointment('user-1', 'listing-1', 300)).toBe(true);
    const update = calls.find((call) => /UPDATE listings SET status/.test(call.sql));
    expect(JSON.parse(update.params.status)).toEqual({ status: 'invited', setAt: 100, appointmentAt: 300 });
  });
});
