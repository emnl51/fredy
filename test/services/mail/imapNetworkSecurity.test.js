/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { describe, expect, it, vi } from 'vitest';
import {
  assertSafeImapEndpoint,
  createSafeImapLookup,
  isBlockedImapAddress,
  publicImapErrorMessage,
  secureImapConnectionOptions,
} from '../../../lib/services/mail/imapNetworkSecurity.js';

describe('IMAP network security', () => {
  it.each([
    '127.0.0.1',
    '10.0.0.1',
    '100.64.0.1',
    '169.254.169.254',
    '172.16.0.1',
    '192.168.1.1',
    '::1',
    'fc00::1',
    'fe80::1',
    '::ffff:127.0.0.1',
    '::ffff:7f00:1',
    '64:ff9b::7f00:1',
    '2002:7f00:1::',
  ])('blocks non-public address %s', (address) => {
    expect(isBlockedImapAddress(address)).toBe(true);
  });

  it.each(['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111'])('allows public address %s', (address) => {
    expect(isBlockedImapAddress(address)).toBe(false);
  });

  it('rejects local hostnames and non-standard ports before connecting', () => {
    expect(() => assertSafeImapEndpoint('localhost', 993)).toThrow(/public IP/);
    expect(() => assertSafeImapEndpoint('mail.local', 993)).toThrow(/public IP/);
    expect(() => assertSafeImapEndpoint('imap.example.com', 22)).toThrow(/143, 993/);
  });

  it('requires STARTTLS and installs the guarded resolver on port 143', () => {
    const options = secureImapConnectionOptions({
      host: 'imap.example.com',
      port: 143,
      secure: false,
    });

    expect(options.doSTARTTLS).toBe(true);
    expect(options.tls.lookup).toBeTypeOf('function');
  });

  it('rejects a DNS result containing an internal address', async () => {
    const lookup = createSafeImapLookup((_hostname, _options, callback) =>
      callback(null, [
        { address: '8.8.8.8', family: 4 },
        { address: '169.254.169.254', family: 4 },
      ]),
    );

    await expect(
      new Promise((resolve, reject) =>
        lookup('imap.example.com', { all: true }, (error, value) => (error ? reject(error) : resolve(value))),
      ),
    ).rejects.toMatchObject({ code: 'IMAP_ENDPOINT_BLOCKED' });
  });

  it('returns only the public DNS result used by the socket', async () => {
    const resolver = vi.fn((_hostname, _options, callback) => callback(null, '8.8.8.8', 4));
    const lookup = createSafeImapLookup(resolver);

    await expect(
      new Promise((resolve, reject) =>
        lookup('imap.example.com', {}, (error, address, family) =>
          error ? reject(error) : resolve({ address, family }),
        ),
      ),
    ).resolves.toEqual({ address: '8.8.8.8', family: 4 });
  });

  it('does not expose raw socket details in public errors', () => {
    expect(publicImapErrorMessage(new Error('connect ECONNREFUSED 10.0.0.5:22'))).toBe(
      'Unable to connect to the IMAP server.',
    );
    expect(publicImapErrorMessage(new Error('authentication failed for user secret@example.com'))).toBe(
      'IMAP authentication failed.',
    );
  });
});
