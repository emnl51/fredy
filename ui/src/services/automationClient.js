/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { xhrGet, xhrPut } from './xhr.js';

const json = (response) => response.json;

export const getAutomationSuggestions = (state = 'pending') =>
  xhrGet(`/api/automation/suggestions?state=${encodeURIComponent(state)}`).then(json);
export const decideAutomationSuggestion = (suggestionId, decision, payload = null) =>
  xhrPut(`/api/automation/suggestions/${encodeURIComponent(suggestionId)}`, { decision, payload }).then(json);
