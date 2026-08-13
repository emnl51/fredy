/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { xhrDelete, xhrGet, xhrPost } from './xhr.js';

const json = (response) => response.json;

export const getMcpTokens = () => xhrGet('/api/mcp-tokens').then(json);
export const createMcpToken = (payload) => xhrPost('/api/mcp-tokens', payload).then(json);
export const revokeMcpToken = (tokenId) => xhrDelete(`/api/mcp-tokens/${encodeURIComponent(tokenId)}`).then(json);
