/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { nanoid } from 'nanoid';
import SqliteConnection from './SqliteConnection.js';
import { fromJson } from '../../utils.js';
import { normalizeListingStatus } from '../listings/listingStatus.js';
import { hashExternalEvent, userOwnsListing } from './applicationStorage.js';

const json = (value) => (value == null ? null : JSON.stringify(value));

const normalizeText = (value) =>
  String(value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ß/g, 'ss')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

// German property portals commonly abbreviate "Straße" as "Str.". Normalizing this one
// well-known address spelling difference makes a full address useful without weakening the
// deliberately strict exact-address rule below.
const normalizeAddress = (value) =>
  normalizeText(
    String(value ?? '')
      .replace(/straße/gi, 'strasse')
      .replace(/\bstr\.?\b/gi, 'strasse'),
  );
const addressKey = (value) => {
  const text = String(value ?? '').replace(/straße/gi, 'strasse').replace(/\bstr\.?\b/gi, 'strasse');
  const match = text.match(/(.+?\s+\d+[a-zA-Z-]*)\s*,?\s*(\d{5})\b/);
  return match ? `${normalizeText(match[1])}:${match[2]}` : '';
};
const portalReference = (value) => {
  const match = decodedText(value).match(/\/expose\/([^/?#]+)/i);
  return match ? normalizeText(match[1]) : '';
};

const decodedText = (value) => {
  try {
    return decodeURIComponent(String(value ?? ''));
  } catch {
    return String(value ?? '');
  }
};

/**
 * Pick an automatic match only when one candidate has exact, independent evidence.
 * Title-only and partial-address hits remain visible as candidates but never become an automatic
 * suggestion: a human can match those outside this API instead of accepting a false positive.
 */
export function findReliableListingCandidate(candidates, { objectReference, address } = {}) {
  const reference = normalizeText(objectReference);
  if (reference) {
    const portalMatches = candidates.filter((candidate) => portalReference(candidate.link) === reference);
    if (portalMatches.length === 1) return { listingId: portalMatches[0].id, confidence: 100, matchMethod: 'portal_reference' };
  }
  if (reference) {
    const exactReferences = candidates.filter((candidate) => {
      const haystack = [candidate.title, candidate.address, candidate.link, candidate.description]
        .map(decodedText)
        .map(normalizeText)
        .join(' ');
      return haystack.includes(reference);
    });
    if (exactReferences.length === 1) {
      return { listingId: exactReferences[0].id, confidence: 100, matchMethod: 'object_reference' };
    }
  }

  const normalizedAddress = normalizeAddress(address);
  if (normalizedAddress.length >= 8) {
    const exactAddresses = candidates.filter((candidate) => normalizeAddress(candidate.address) === normalizedAddress);
    if (exactAddresses.length === 1) {
      return { listingId: exactAddresses[0].id, confidence: 95, matchMethod: 'normalized_address' };
    }
  }
  const key = addressKey(address);
  if (key) {
    const matches = candidates.filter((candidate) => addressKey(candidate.address) === key);
    if (matches.length === 1) return { listingId: matches[0].id, confidence: 95, matchMethod: 'street_postcode' };
  }
  return null;
}

export function findListingCandidates({ userId, objectReference, address, title, provider, limit = 10 }) {
  const needles = [objectReference, address, title]
    .map((value) =>
      String(value ?? '')
        .trim()
        .toLowerCase(),
    )
    .filter(Boolean);
  if (!needles.length) return [];
  const clauses = needles.map(
    (_, index) =>
      `(lower(l.title) LIKE @q${index} OR lower(l.address) LIKE @q${index} OR lower(l.link) LIKE @q${index} OR lower(l.description) LIKE @q${index})`,
  );
  const params = Object.fromEntries(needles.map((needle, index) => [`q${index}`, `%${needle}%`]));
  params.userId = userId;
  params.provider = provider ? `%${String(provider).toLowerCase()}%` : null;
  params.limit = Math.max(1, Math.min(20, Number(limit) || 10));
  return SqliteConnection.query(
    `SELECT l.id, l.title, l.address, l.provider, l.link, l.description, l.status,
            l.created_at AS createdAt
       FROM listings l
       JOIN jobs j ON j.id = l.job_id
      WHERE j.user_id = @userId
        AND l.manually_deleted = 0
        AND (${clauses.join(' OR ')})
        AND (@provider IS NULL OR lower(l.provider) LIKE @provider)
      ORDER BY l.created_at DESC
      LIMIT @limit`,
    params,
  ).map((row) => ({ ...row, status: fromJson(row.status, null) }));
}

function validatePayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload))
    throw new Error('A structured payload is required.');
  if (payload.status == null && payload.appointment == null && !(payload.tasks ?? []).length) {
    throw new Error('The suggestion must contain a status, appointment, or task update.');
  }
  if (payload.status != null && normalizeListingStatus(payload.status) == null)
    throw new Error('Invalid application status.');
  if (payload.appointment != null) {
    if (!['create', 'reschedule', 'cancel'].includes(payload.appointment.action))
      throw new Error('Invalid appointment action.');
    if (payload.appointment.action !== 'cancel') {
      const startsAt = Number(payload.appointment.startsAt);
      if (!Number.isFinite(startsAt) || startsAt <= 0) throw new Error('A valid appointment start is required.');
    }
  }
  for (const task of payload.tasks ?? []) {
    if (!['complete_form', 'upload_documents', 'confirm_interest', 'book_appointment', 'other'].includes(task.type)) {
      throw new Error(`Invalid task type: ${task.type}`);
    }
  }
  return payload;
}

export function proposeApplicationUpdate({ userId, listingId, payload, confidence, reason, externalEventId }) {
  if (!userOwnsListing(listingId, userId)) throw new Error('Listing not found or not owned by this user.');
  const checked = validatePayload(payload);
  const score = Math.round(Number(confidence));
  if (!Number.isFinite(score) || score < 0 || score > 100) throw new Error('Confidence must be between 0 and 100.');
  const eventHash = hashExternalEvent(externalEventId);
  if (!eventHash) throw new Error('externalEventId is required for idempotency.');
  if (!String(reason ?? '').trim()) throw new Error('A short factual reason is required.');
  const existing = SqliteConnection.query(
    `SELECT * FROM automation_suggestions WHERE user_id = @userId AND external_event_hash = @eventHash LIMIT 1`,
    { userId, eventHash },
  )[0];
  if (existing) return { ...existing, payload: fromJson(existing.payload, {}), duplicate: true };
  const id = nanoid();
  const now = Date.now();
  SqliteConnection.execute(
    `INSERT INTO automation_suggestions
       (id, user_id, listing_id, type, payload, confidence, reason, state, external_event_hash, created_at)
     VALUES (@id, @userId, @listingId, 'application_update', @payload, @confidence, @reason,
             'pending', @eventHash, @now)`,
    { id, userId, listingId, payload: json(checked), confidence: score, reason: String(reason || ''), eventHash, now },
  );
  return { id, listingId, payload: checked, confidence: score, reason, state: 'pending', duplicate: false };
}

export function listAutomationSuggestions(userId, state = 'pending') {
  const allowed = ['pending', 'accepted', 'rejected', 'expired', 'all'];
  const selected = allowed.includes(state) ? state : 'pending';
  return SqliteConnection.query(
    `SELECT s.*, l.title, l.address, l.provider, l.link, l.image_url AS imageUrl, l.status AS listingStatus
       FROM automation_suggestions s
       JOIN listings l ON l.id = s.listing_id
      WHERE s.user_id = @userId
        AND (@state = 'all' OR s.state = @state)
      ORDER BY s.created_at DESC`,
    { userId, state: selected },
  ).map((row) => ({
    id: row.id,
    listingId: row.listing_id,
    payload: fromJson(row.payload, {}),
    confidence: row.confidence,
    reason: row.reason,
    state: row.state,
    createdAt: row.created_at,
    decidedAt: row.decided_at,
    title: row.title,
    address: row.address,
    provider: row.provider,
    link: row.link,
    imageUrl: row.imageUrl,
    listingStatus: fromJson(row.listingStatus, null),
  }));
}

export function decideAutomationSuggestion({ suggestionId, userId, decision, editedPayload = null }) {
  if (!['accepted', 'rejected'].includes(decision)) throw new Error('Decision must be accepted or rejected.');
  let result = null;
  SqliteConnection.withTransaction((db) => {
    const suggestion = db
      .prepare(`SELECT * FROM automation_suggestions WHERE id = @suggestionId AND user_id = @userId`)
      .get({ suggestionId, userId });
    if (!suggestion || suggestion.state !== 'pending') return;
    const now = Date.now();
    const payload = validatePayload(editedPayload ?? fromJson(suggestion.payload, {}));
    if (decision === 'accepted') {
      const listing = db.prepare(`SELECT status FROM listings WHERE id = ?`).get(suggestion.listing_id);
      const previousStatus = fromJson(listing?.status, null);
      if (payload.expectedStatus != null && previousStatus?.status !== payload.expectedStatus) {
        throw new Error('Listing status changed after this suggestion was created. Review it again.');
      }
      if (payload.status != null) {
        const nextStatus = { status: normalizeListingStatus(payload.status), setAt: now };
        db.prepare(`UPDATE listings SET status = @status WHERE id = @listingId`).run({
          listingId: suggestion.listing_id,
          status: json(nextStatus),
        });
        db.prepare(
          `INSERT INTO watch_list (id, listing_id, user_id) VALUES (@id, @listingId, @userId)
           ON CONFLICT(listing_id, user_id) DO NOTHING`,
        ).run({ id: nanoid(), listingId: suggestion.listing_id, userId });
        db.prepare(
          `INSERT INTO application_events
             (id, listing_id, user_id, event_type, previous_value, new_value, source, confidence,
              reason, external_event_hash, created_at)
           VALUES (@id, @listingId, @userId, 'status_changed', @previousValue, @newValue, 'mcp',
                   @confidence, @reason, @eventHash, @now)`,
        ).run({
          id: nanoid(),
          listingId: suggestion.listing_id,
          userId,
          previousValue: json(previousStatus),
          newValue: json(nextStatus),
          confidence: suggestion.confidence,
          reason: suggestion.reason,
          eventHash: `${suggestion.external_event_hash}:status`,
          now,
        });
      }
      const appointment = payload.appointment;
      if (appointment?.action === 'cancel') {
        db.prepare(
          `UPDATE application_appointments SET state = 'cancelled', updated_at = @now
            WHERE id = (SELECT id FROM application_appointments
                         WHERE listing_id = @listingId AND user_id = @userId
                           AND state IN ('scheduled', 'rescheduled') ORDER BY created_at DESC LIMIT 1)`,
        ).run({ listingId: suggestion.listing_id, userId, now });
      } else if (appointment) {
        const previous = db
          .prepare(
            `SELECT id FROM application_appointments
              WHERE listing_id = @listingId AND user_id = @userId
                AND state IN ('scheduled', 'rescheduled') ORDER BY created_at DESC LIMIT 1`,
          )
          .get({ listingId: suggestion.listing_id, userId });
        if (previous) {
          db.prepare(`UPDATE application_appointments SET state = 'rescheduled', updated_at = @now WHERE id = @id`).run(
            {
              id: previous.id,
              now,
            },
          );
        }
        db.prepare(
          `INSERT INTO application_appointments
             (id, listing_id, user_id, starts_at, ends_at, timezone, location, contact_name,
              state, supersedes_id, source, created_at, updated_at)
           VALUES (@id, @listingId, @userId, @startsAt, @endsAt, @timezone, @location,
                   @contactName, 'scheduled', @supersedesId, 'mcp', @now, @now)`,
        ).run({
          id: nanoid(),
          listingId: suggestion.listing_id,
          userId,
          startsAt: Number(appointment.startsAt),
          endsAt: appointment.endsAt == null ? null : Number(appointment.endsAt),
          timezone: appointment.timezone || 'Europe/Berlin',
          location: appointment.location || null,
          contactName: appointment.contactName || null,
          supersedesId: previous?.id ?? null,
          now,
        });
      }
      if (appointment) {
        db.prepare(
          `INSERT INTO application_events
             (id, listing_id, user_id, event_type, new_value, source, confidence,
              reason, external_event_hash, created_at)
           VALUES (@id, @listingId, @userId, @eventType, @newValue, 'mcp', @confidence,
                   @reason, @eventHash, @now)`,
        ).run({
          id: nanoid(),
          listingId: suggestion.listing_id,
          userId,
          eventType:
            appointment.action === 'cancel'
              ? 'appointment_cancelled'
              : appointment.action === 'reschedule'
                ? 'appointment_rescheduled'
                : 'appointment_created',
          newValue: json(appointment),
          confidence: suggestion.confidence,
          reason: suggestion.reason,
          eventHash: `${suggestion.external_event_hash}:appointment`,
          now,
        });
      }
      for (const task of payload.tasks ?? []) {
        db.prepare(
          `INSERT INTO application_tasks
             (id, listing_id, user_id, type, title, due_at, state, source,
              external_event_hash, created_at, updated_at)
           VALUES (@id, @listingId, @userId, @type, @title, @dueAt, 'pending', 'mcp',
                   @eventHash, @now, @now)
           ON CONFLICT(user_id, external_event_hash, type) WHERE external_event_hash IS NOT NULL DO NOTHING`,
        ).run({
          id: nanoid(),
          listingId: suggestion.listing_id,
          userId,
          type: task.type,
          title: task.title || null,
          dueAt: task.dueAt == null ? null : Number(task.dueAt),
          eventHash: `${suggestion.external_event_hash}:${task.type}`,
          now,
        });
      }
    }
    db.prepare(
      `UPDATE automation_suggestions
          SET state = @decision, decided_at = @now, decided_by = @userId, payload = @payload
        WHERE id = @suggestionId`,
    ).run({ decision, now, userId, suggestionId, payload: json(payload) });
    db.prepare(
      `INSERT INTO application_events
         (id, listing_id, user_id, event_type, new_value, source, confidence, reason, created_at)
       VALUES (@id, @listingId, @userId, @eventType, @newValue, 'manual', @confidence, @reason, @now)`,
    ).run({
      id: nanoid(),
      listingId: suggestion.listing_id,
      userId,
      eventType: decision === 'accepted' ? 'suggestion_accepted' : 'suggestion_rejected',
      newValue: json(payload),
      confidence: suggestion.confidence,
      reason: suggestion.reason,
      now,
    });
    result = { id: suggestionId, state: decision };
  });
  return result;
}
