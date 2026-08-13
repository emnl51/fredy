/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import crypto from 'crypto';
import SqliteConnection from './SqliteConnection.js';
import { fromJson } from '../../utils.js';

export const MCP_SCOPES = Object.freeze([
  'jobs:read',
  'listings:read',
  'applications:read',
  'applications:propose',
  'applications:write',
  'appointments:write',
]);

const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

export function issueMcpToken({ userId, name, scopes, expiresAt = null }) {
  const selected = [...new Set(Array.isArray(scopes) ? scopes : [])];
  if (!selected.length || selected.some((scope) => !MCP_SCOPES.includes(scope))) {
    throw new Error('At least one valid MCP scope is required.');
  }
  const rawToken = `fredy_${crypto.randomBytes(32).toString('hex')}`;
  const id = crypto.randomUUID();
  const now = Date.now();
  SqliteConnection.execute(
    `INSERT INTO mcp_tokens
       (id, user_id, name, token_prefix, token_hash, scopes, expires_at, created_at)
     VALUES (@id, @userId, @name, @prefix, @hash, @scopes, @expiresAt, @now)`,
    {
      id,
      userId,
      name: String(name || 'MCP token').trim(),
      prefix: rawToken.slice(0, 14),
      hash: hashToken(rawToken),
      scopes: JSON.stringify(selected),
      expiresAt: expiresAt == null ? null : Number(expiresAt),
      now,
    },
  );
  return { id, token: rawToken, name: String(name || 'MCP token').trim(), scopes: selected, expiresAt };
}

export function listMcpTokens(userId) {
  return SqliteConnection.query(
    `SELECT id, name, token_prefix AS tokenPrefix, scopes, expires_at AS expiresAt,
            last_used_at AS lastUsedAt, revoked_at AS revokedAt, created_at AS createdAt
       FROM mcp_tokens WHERE user_id = @userId ORDER BY created_at DESC`,
    { userId },
  ).map((row) => ({ ...row, scopes: fromJson(row.scopes, []) }));
}

export function revokeMcpToken(userId, tokenId) {
  return (
    SqliteConnection.execute(
      `UPDATE mcp_tokens SET revoked_at = @now
        WHERE id = @tokenId AND user_id = @userId AND revoked_at IS NULL`,
      { tokenId, userId, now: Date.now() },
    ).changes > 0
  );
}

export function validateScopedMcpToken(token) {
  if (!token) return null;
  const now = Date.now();
  const row = SqliteConnection.query(
    `SELECT id, user_id AS userId, scopes
       FROM mcp_tokens
      WHERE token_hash = @hash
        AND revoked_at IS NULL
        AND (expires_at IS NULL OR expires_at > @now)
      LIMIT 1`,
    { hash: hashToken(token), now },
  )[0];
  if (!row) return null;
  SqliteConnection.execute(`UPDATE mcp_tokens SET last_used_at = @now WHERE id = @id`, { id: row.id, now });
  return { tokenId: row.id, userId: row.userId, scopes: fromJson(row.scopes, []) };
}
