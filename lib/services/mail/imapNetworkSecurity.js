/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { lookup as dnsLookup } from 'node:dns';
import net from 'node:net';

export const ALLOWED_IMAP_PORTS = Object.freeze([143, 993]);

const blockedAddresses = new net.BlockList();

for (const [network, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
]) {
  blockedAddresses.addSubnet(network, prefix, 'ipv4');
}

for (const [network, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['64:ff9b::', 96],
  ['64:ff9b:1::', 48],
  ['100::', 64],
  ['2001::', 23],
  ['2001:db8::', 32],
  ['2002::', 16],
  ['3fff::', 20],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
]) {
  blockedAddresses.addSubnet(network, prefix, 'ipv6');
}

/**
 * Return true for addresses that must never be reached through a user-owned
 * mailbox configuration.
 *
 * @param {string} address
 * @returns {boolean}
 */
export function isBlockedImapAddress(address) {
  const family = net.isIP(address);
  if (family === 4) return blockedAddresses.check(address, 'ipv4');
  if (family !== 6) return true;

  const mappedIpv4 = address.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i)?.[1];
  if (mappedIpv4) return isBlockedImapAddress(mappedIpv4);
  return blockedAddresses.check(address, 'ipv6');
}

/**
 * Validate values that can be rejected before DNS resolution.
 *
 * @param {string} host
 * @param {number} port
 * @returns {void}
 */
export function assertSafeImapEndpoint(host, port) {
  const normalizedHost = String(host ?? '')
    .trim()
    .replace(/\.$/, '')
    .toLowerCase();
  if (!normalizedHost) throw createBlockedEndpointError();
  if (!ALLOWED_IMAP_PORTS.includes(Number(port))) {
    const error = new Error(`IMAP port must be one of: ${ALLOWED_IMAP_PORTS.join(', ')}.`);
    error.code = 'IMAP_PORT_NOT_ALLOWED';
    throw error;
  }
  if (
    normalizedHost === 'localhost' ||
    normalizedHost.endsWith('.localhost') ||
    normalizedHost.endsWith('.local') ||
    (net.isIP(normalizedHost) && isBlockedImapAddress(normalizedHost))
  ) {
    throw createBlockedEndpointError();
  }
}

/**
 * Create a Node-compatible DNS lookup callback that validates the exact
 * addresses handed to net.connect/tls.connect. This avoids a validation-to-
 * connection DNS rebinding window.
 *
 * @param {typeof dnsLookup} [lookup]
 * @returns {typeof dnsLookup}
 */
export function createSafeImapLookup(lookup = dnsLookup) {
  return (hostname, options, callback) => {
    lookup(hostname, options, (error, address, family) => {
      if (error) return callback(error);

      const results = Array.isArray(address) ? address : [{ address, family }];
      if (!results.length || results.some((result) => isBlockedImapAddress(result.address))) {
        return callback(createBlockedEndpointError());
      }

      if (Array.isArray(address)) return callback(null, results);
      return callback(null, address, family);
    });
  };
}

/**
 * Add the guarded resolver used by ImapFlow for both direct TLS and STARTTLS.
 *
 * @param {Object} account
 * @returns {Object}
 */
export function secureImapConnectionOptions(account) {
  assertSafeImapEndpoint(account.host, account.port);
  return {
    host: account.host,
    port: account.port,
    secure: account.secure,
    // Port 143 must upgrade before credentials are sent; ImapFlow's default
    // opportunistic mode may otherwise continue without TLS.
    doSTARTTLS: account.secure ? undefined : true,
    tls: { lookup: createSafeImapLookup() },
  };
}

/**
 * Convert connection failures to a small set of messages that do not expose
 * internal addresses, ports, DNS details, or raw socket errors.
 *
 * @param {unknown} error
 * @returns {string}
 */
export function publicImapErrorMessage(error) {
  if (error?.code === 'IMAP_ENDPOINT_BLOCKED') return 'IMAP host must resolve only to public IP addresses.';
  if (error?.code === 'IMAP_PORT_NOT_ALLOWED') return error.message;

  const value = String(error?.message ?? '');
  if (/auth|credential|login/i.test(value)) return 'IMAP authentication failed.';
  if (/certificate|\btls\b|\bssl\b|self[- ]signed/i.test(value)) return 'IMAP TLS validation failed.';
  if (/timeout|timed out/i.test(value)) return 'IMAP connection timed out.';
  if (/mailbox/i.test(value)) return 'The configured IMAP mailbox is unavailable.';
  return 'Unable to connect to the IMAP server.';
}

function createBlockedEndpointError() {
  const error = new Error('IMAP host must resolve only to public IP addresses.');
  error.code = 'IMAP_ENDPOINT_BLOCKED';
  return error;
}
