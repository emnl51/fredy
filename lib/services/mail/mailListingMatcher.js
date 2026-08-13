/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import {
  assignMailMessageToListing,
  getMatchedMailThreadAnchors,
  getOwnedListingsForMailMatching,
  getUnmatchedMailMessages,
} from '../storage/mailStorage.js';

/**
 * Make punctuation, casing and German diacritics irrelevant while retaining
 * word boundaries needed for conservative exact matching.
 *
 * @param {unknown} value
 * @returns {string}
 */
export function normalizeMailMatchText(value) {
  return String(value ?? '')
    .replace(/ß/g, 'ss')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function compactHouseNumberSuffix(value) {
  return value.replace(/\b(\d{1,4})\s+([a-z])\b/g, '$1$2');
}

function normalizeAddressText(value) {
  return compactHouseNumberSuffix(normalizeMailMatchText(value))
    .replace(/\b([a-z]{3,})(?:strasse|str)\b/g, '$1 str')
    .replace(/\b(?:strasse|str)\b/g, 'str');
}

/**
 * IDs from listing URLs are more reliable than addresses. Only URL tokens
 * containing a digit are accepted; common words such as "wohnung" can never
 * become a match key, and five-digit German postal codes are excluded.
 *
 * @param {string|null|undefined} link
 * @returns {string[]}
 */
export function extractListingCodes(link) {
  if (!link) return [];
  const candidates = new Set();
  const addTokens = (value) => {
    let decoded = String(value);
    try {
      decoded = decodeURIComponent(decoded);
    } catch {
      // A malformed portal URL is still safe to tokenize in its raw form.
    }
    const normalizedTokens = normalizeMailMatchText(decoded).split(' ');
    const compactToken = normalizedTokens.join('');
    const tokens = compactToken !== normalizedTokens[0] ? [...normalizedTokens, compactToken] : normalizedTokens;
    for (const token of tokens) {
      const hasLetter = /[a-z]/.test(token);
      const hasDigit = /\d/.test(token);
      if (!hasDigit) continue;
      if ((!hasLetter && token.length < 6) || (hasLetter && token.length < 5)) continue;
      candidates.add(token);
    }
  };

  try {
    const url = new URL(link);
    for (const segment of url.pathname.split('/')) addTokens(segment);
    for (const [name, value] of url.searchParams) {
      if (
        /^(?:id|objectid|object_id|listingid|listing_id|offerid|offer_id|adid|ad_id|expose|exposeid|expose_id|oid|reference|ref)$/i.test(
          name,
        )
      ) {
        addTokens(value);
      }
    }
    addTokens(url.hash);
  } catch {
    addTokens(link);
  }
  return [...candidates];
}

/**
 * A city or postal code is not enough for an address match. Require a house
 * number that is not a five-digit postcode and a meaningful street name.
 *
 * @param {string|null|undefined} address
 * @returns {string|null}
 */
export function normalizeMatchableAddress(address) {
  const normalized = normalizeAddressText(address);
  if (normalized.length < 8 || !/[a-z]/.test(normalized)) return null;
  const hasHouseNumber = normalized.split(' ').some((token) => /^\d{1,4}[a-z]?$/.test(token));
  return hasHouseNumber ? normalized : null;
}

/**
 * Conservative address forms ordered from most to least specific. Besides the
 * full address, retain street + house number so replies that omit postcode and
 * city can still match when that phrase belongs to only one owned listing.
 */
export function extractAddressVariants(address) {
  const normalized = normalizeMatchableAddress(address);
  if (!normalized) return [];
  const tokens = normalized.split(' ');
  const numberIndex = tokens.findIndex((token) => /^\d{1,4}[a-z]?$/.test(token));
  if (numberIndex < 1) return [normalized];
  const streetAndNumber = tokens.slice(0, numberIndex + 1).join(' ');
  return [...new Set([normalized, streetAndNumber])].filter((value) => value.length >= 6);
}

function containsPhrase(text, phrase) {
  return ` ${text} `.includes(` ${phrase} `);
}

function normalizeMessageId(value) {
  return String(value ?? '')
    .trim()
    .replace(/^<|>$/g, '')
    .trim()
    .toLowerCase();
}

function messageReferences(message) {
  const references = Array.isArray(message.references)
    ? message.references
    : typeof message.references === 'string'
      ? message.references.split(/\s+/)
      : [];
  return [message.inReplyTo, ...references].map(normalizeMessageId).filter(Boolean);
}

function anchoredListingIds(message, threadAnchors) {
  const listingIds = new Set();
  for (const reference of messageReferences(message)) {
    for (const listingId of threadAnchors.get(reference) ?? []) listingIds.add(listingId);
  }
  return listingIds;
}

function extractLabeledNumericReferences(value) {
  const references = new Set();
  const source = String(value ?? '');
  const pattern =
    /(?:objekt(?:nummer|-?nr\.?|\s?id)?|angebots?(?:nummer|-?nr\.?|\s?id)|expos[eé](?:nummer|-?nr\.?|\s?id)?|inserats?(?:nummer|-?nr\.?|\s?id)|referenz(?:nummer|-?nr\.?|\s?id)?|angebot\s*#)\s*[:#-]?\s*([\d][\d ./-]{4,}\d)/giu;
  for (const match of source.matchAll(pattern)) {
    const digits = match[1].replace(/\D/g, '');
    if (digits.length >= 6) references.add(digits);
  }
  return references;
}

function currentReplyText(body) {
  return String(body ?? '').split(
    /\n(?:-{2,}\s*(?:ursprungliche|ursprüngliche|original) nachricht\s*-{2,}|am .{0,160} schrieb .{0,160}:|von:\s*.{0,160}\n(?:gesendet|sent):)/iu,
  )[0];
}

function validLocalDate(year, month, day, hour, minute) {
  const date = new Date(year, month - 1, day, hour, minute);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day ? date.getTime() : null;
}

/** Extract common numeric and German month-name viewing timestamps. */
export function extractGermanAppointmentAt(value) {
  const raw = String(value ?? '');
  const numeric = raw.match(
    /\b(\d{1,2})[./](\d{1,2})[./](\d{2}|\d{4})\s*(?:,|\s)+(?:um\s+)?(\d{1,2})[:.](\d{2})\s*(?:uhr)?\b/i,
  );
  if (numeric) {
    const [, day, month, rawYear, hour, minute] = numeric;
    const year = Number(rawYear) < 100 ? 2000 + Number(rawYear) : Number(rawYear);
    return validLocalDate(year, Number(month), Number(day), Number(hour), Number(minute));
  }

  const named = normalizeMailMatchText(raw).match(
    /\b(\d{1,2})\s+(jan(?:uar)?|feb(?:ruar)?|marz|apr(?:il)?|mai|jun(?:i)?|jul(?:i)?|aug(?:ust)?|sep(?:tember)?|okt(?:ober)?|nov(?:ember)?|dez(?:ember)?)\s+(\d{4})\s+(?:um\s+)?(\d{1,2})\s+(\d{2})\b/,
  );
  if (!named) return null;
  const months = {
    jan: 1,
    januar: 1,
    feb: 2,
    februar: 2,
    marz: 3,
    apr: 4,
    april: 4,
    mai: 5,
    jun: 6,
    juni: 6,
    jul: 7,
    juli: 7,
    aug: 8,
    august: 8,
    sep: 9,
    september: 9,
    okt: 10,
    oktober: 10,
    nov: 11,
    november: 11,
    dez: 12,
    dezember: 12,
  };
  const [, day, monthName, year, hour, minute] = named;
  return validLocalDate(Number(year), months[monthName], Number(day), Number(hour), Number(minute));
}

/**
 * Recognize explicit German application workflow messages. These rules require
 * strong phrases from the property manager and deliberately ignore generic
 * words such as "Termin" or "Unterlagen" on their own.
 *
 * @param {unknown} subject
 * @param {unknown} body
 * @returns {{status:string,appointmentAt?:number}|null}
 */
export function inferGermanApplicationUpdate(subject, body) {
  const raw = [subject, currentReplyText(body)].filter(Boolean).join('\n');
  const text = normalizeMailMatchText(raw);
  if (!text) return null;

  if (
    /\b(?:zusage|wohnungszusage)\b/.test(text) ||
    /\bwir haben uns fur sie entschieden\b/.test(text) ||
    /\bwir mochten ihnen die wohnung anbieten\b/.test(text) ||
    /\bsie erhalten den mietvertrag\b/.test(text)
  ) {
    return { status: 'accepted' };
  }

  if (
    /\b(?:wohnung|objekt) (?:wurde|ist) anderweitig vergeben\b/.test(text) ||
    /\bwir haben uns fur (?:einen|eine) andere[nr]? (?:bewerber|interessent)\b/.test(text) ||
    /\bkonnen wir ihnen (?:die|das) (?:wohnung|objekt) leider nicht anbieten\b/.test(text) ||
    /\bleider mussen wir ihnen eine absage erteilen\b/.test(text)
  ) {
    return { status: 'rejected' };
  }

  if (
    /\b(?:konnten|kann|konnen) wir ihre anfrage nicht berucksichtigen\b/.test(text) ||
    /\bihre anfrage (?:leider )?nicht berucksichtigen\b/.test(text) ||
    /\bnicht fur einen besichtigungstermin berucksichtigen\b/.test(text) ||
    /\bkonnen wir ihnen (?:leider )?keinen besichtigungstermin anbieten\b/.test(text)
  ) {
    return { status: 'not_invited' };
  }

  if (
    /\bterminbestatigung\b/.test(text) ||
    /\bterminerinnerung\b/.test(text) ||
    /\berinnerung besichtigungstermin\b/.test(text) ||
    /\beinladung zum besichtigungstermin\b/.test(text) ||
    /\beinladung zu einem besichtigungstermin\b/.test(text) ||
    /\beinladung terminbuchung\b/.test(text) ||
    /\bbesichtigungstermin (?:bestatigen|bestatigt)\b/.test(text)
  ) {
    const appointmentAt = extractGermanAppointmentAt(raw);
    if (appointmentAt != null) return { status: 'invited', appointmentAt };
    return { status: 'invited' };
  }

  if (
    /\bformularbestatigung\b/.test(text) ||
    /\bunterlagen (?:sind )?(?:erfolgreich )?(?:hochgeladen|eingegangen|ubermittelt|erhalten)\b/.test(text) ||
    /\b(?:selbstauskunft|formular) (?:ist |wurde )?(?:erfolgreich )?(?:eingegangen|ubermittelt|abgesendet)\b/.test(text)
  ) {
    return { status: 'documents_sent' };
  }

  if (
    /\banfragebestatigung\b/.test(text) ||
    /\bbestatigung ihrer anfrage\b/.test(text) ||
    /\bwir freuen uns uber ihre anfrage\b/.test(text) ||
    /\bihre anfrage weiter bearbeiten\b/.test(text)
  ) {
    return { status: 'applied' };
  }
  return null;
}

function portalKey(value) {
  try {
    const hostname = new URL(value).hostname.toLowerCase().replace(/^www\./, '');
    return hostname.split('.').slice(-2).join('.');
  } catch {
    return null;
  }
}

function senderPortalKey(senderAddress) {
  const domain = String(senderAddress ?? '')
    .split('@')
    .at(-1)
    ?.toLowerCase();
  if (!domain) return null;
  const labels = domain.split('.');
  return labels.length >= 2 ? labels.slice(-2).join('.') : domain;
}

function distinctiveTitle(title) {
  const normalized = normalizeMailMatchText(title);
  return normalized.length >= 16 && normalized.split(' ').length >= 3 ? normalized : null;
}

function narrowCandidates(candidates, message, text) {
  if (candidates.length <= 1) return candidates;

  const senderPortal = senderPortalKey(message.senderAddress);
  if (senderPortal) {
    const byPortal = candidates.filter((listing) => listing.portal === senderPortal);
    if (byPortal.length > 0) candidates = byPortal;
  }

  if (candidates.length > 1) {
    const byProvider = candidates.filter(
      (listing) => listing.normalizedProvider && containsPhrase(text, listing.normalizedProvider),
    );
    if (byProvider.length > 0) candidates = byProvider;
  }

  if (candidates.length > 1) {
    const byTitle = candidates.filter(
      (listing) => listing.normalizedTitle && containsPhrase(text, listing.normalizedTitle),
    );
    if (byTitle.length > 0) candidates = byTitle;
  }
  return candidates;
}

/**
 * Match all currently unassigned messages belonging to one user.
 *
 * Listing code wins over address. A match is persisted only when exactly one
 * owned listing qualifies; ambiguous messages stay available for manual work.
 *
 * @param {string} userId
 * @param {Object} [options]
 * @returns {Promise<{processed:number,matched:number,ambiguous:number}>}
 */
export async function matchUnmatchedMailMessages(userId, options = {}) {
  const listings = options.listings ?? getOwnedListingsForMailMatching(userId);
  const assign = options.assign ?? assignMailMessageToListing;
  const getMessages = options.getMessages ?? getUnmatchedMailMessages;
  const hasInjectedMessageSource = options.messages !== undefined || options.getMessages !== undefined;
  const anchors = options.anchors ?? (hasInjectedMessageSource ? [] : getMatchedMailThreadAnchors(userId));
  const pageSize = Math.max(1, Math.min(500, Number(options.pageSize) || 200));
  let matched = 0;
  let ambiguous = 0;
  let processed = 0;
  let cursor = null;
  const unresolved = [];

  const prepared = listings.map((listing) => ({
    ...listing,
    codes: [...new Set([...extractListingCodes(listing.link), ...extractListingCodes(listing.hash)])],
    addressVariants: extractAddressVariants(listing.address),
    portal: portalKey(listing.link),
    normalizedProvider: normalizeMailMatchText(listing.provider),
    normalizedTitle: distinctiveTitle(listing.title),
  }));
  const listingById = new Map(prepared.map((listing) => [listing.id, listing]));
  const threadAnchors = new Map();
  const addThreadAnchor = (messageId, listingId) => {
    const normalized = normalizeMessageId(messageId);
    if (!normalized || !listingById.has(listingId)) return;
    const listingIds = threadAnchors.get(normalized) ?? new Set();
    listingIds.add(listingId);
    threadAnchors.set(normalized, listingIds);
  };
  for (const anchor of anchors) addThreadAnchor(anchor.messageId, anchor.listingId);

  while (true) {
    const messages = options.messages
      ? cursor == null
        ? options.messages
        : []
      : getMessages(userId, pageSize, cursor);
    if (messages.length === 0) break;
    processed += messages.length;

    for (const message of messages) {
      const rawText = [message.subject, message.textBody].filter(Boolean).join('\n');
      const text = normalizeMailMatchText(rawText);
      const addressText = normalizeAddressText(rawText);
      const applicationUpdate = inferGermanApplicationUpdate(message.subject, message.textBody);
      if (!text) {
        unresolved.push({ message, directAmbiguous: false });
        continue;
      }

      const labeledReferences = extractLabeledNumericReferences(rawText);
      let codeCandidates = prepared.filter((listing) =>
        listing.codes.some((code) => containsPhrase(text, code) || (/^\d+$/.test(code) && labeledReferences.has(code))),
      );
      codeCandidates = narrowCandidates(codeCandidates, message, text);
      let candidate = codeCandidates.length === 1 ? codeCandidates[0] : null;
      let method = 'listing_code';
      let confidence = 100;
      let directAmbiguous = codeCandidates.length > 1;

      if (codeCandidates.length === 0) {
        let addressCandidates = prepared.filter((listing) =>
          listing.addressVariants.some((variant) => containsPhrase(addressText, variant)),
        );
        addressCandidates = narrowCandidates(addressCandidates, message, text);
        candidate = addressCandidates.length === 1 ? addressCandidates[0] : null;
        method = 'address';
        confidence = 85;
        directAmbiguous = addressCandidates.length > 1;
      }

      const existingThreadCandidates = anchoredListingIds(message, threadAnchors);
      const conflictsWithThread =
        candidate && existingThreadCandidates.size === 1 && !existingThreadCandidates.has(candidate.id);

      if (
        candidate &&
        !conflictsWithThread &&
        assign({
          messageId: message.id,
          listingId: candidate.id,
          userId,
          method,
          confidence,
          automatic: true,
          ...(applicationUpdate ?? {}),
        })
      ) {
        matched += 1;
        addThreadAnchor(message.messageId, candidate.id);
      } else {
        unresolved.push({
          message,
          directAmbiguous: directAmbiguous || conflictsWithThread,
          blockThread: conflictsWithThread,
        });
      }
    }

    if (options.messages || messages.length < pageSize) break;
    const last = messages.at(-1);
    const nextCursor = { sortAt: Number(last.matchSortAt), id: last.id };
    if (!Number.isFinite(nextCursor.sortAt) || !nextCursor.id) break;
    cursor = nextCursor;
  }

  // Direct matches above seed anchors for every message in this run. Resolve
  // replies iteratively so a chain can inherit through another newly matched
  // reply even when messages were returned newest-first by IMAP.
  let pending = unresolved;
  let madeProgress = true;
  while (madeProgress && pending.length > 0) {
    madeProgress = false;
    const next = [];
    for (const entry of pending) {
      if (entry.blockThread) {
        next.push(entry);
        continue;
      }
      const candidateIds = anchoredListingIds(entry.message, threadAnchors);
      if (candidateIds.size !== 1) {
        next.push({ ...entry, threadAmbiguous: candidateIds.size > 1 });
        continue;
      }

      const [listingId] = candidateIds;
      if (
        assign({
          messageId: entry.message.id,
          listingId,
          userId,
          method: 'thread',
          confidence: 95,
          automatic: true,
          ...(inferGermanApplicationUpdate(entry.message.subject, entry.message.textBody) ?? {}),
        })
      ) {
        matched += 1;
        madeProgress = true;
        addThreadAnchor(entry.message.messageId, listingId);
      } else {
        next.push(entry);
      }
    }
    pending = next;
  }
  ambiguous += pending.filter((entry) => entry.directAmbiguous || entry.threadAmbiguous).length;

  return { processed, matched, ambiguous };
}
