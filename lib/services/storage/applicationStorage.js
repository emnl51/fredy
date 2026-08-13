/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { createHash } from 'crypto';
import { nanoid } from 'nanoid';
import SqliteConnection from './SqliteConnection.js';
import { fromJson } from '../../utils.js';
import { normalizeListingStatus } from '../listings/listingStatus.js';

const parseJson = (value) => fromJson(value, null);
const json = (value) => (value == null ? null : JSON.stringify(value));

export function hashExternalEvent(value) {
  const normalized = String(value ?? '').trim();
  return normalized ? createHash('sha256').update(normalized).digest('hex') : null;
}

export function userOwnsListing(listingId, userId, isAdmin = false) {
  const rows = SqliteConnection.query(
    `SELECT 1
       FROM listings l
       JOIN jobs j ON j.id = l.job_id
      WHERE l.id = @listingId
        AND l.manually_deleted = 0
        AND (@isAdmin = 1 OR j.user_id = @userId)
      LIMIT 1`,
    { listingId, userId, isAdmin: isAdmin ? 1 : 0 },
  );
  return rows.length > 0;
}

export function listApplicationAppointments(userId, { includeArchived = true } = {}) {
  const rows = SqliteConnection.query(
    `SELECT a.*, l.title, l.address, l.provider, l.link, l.image_url AS imageUrl,
            l.price, l.size, l.rooms, l.status
       FROM application_appointments a
       JOIN listings l ON l.id = a.listing_id
      WHERE a.user_id = @userId
        AND l.manually_deleted = 0
        AND (@includeArchived = 1 OR a.state IN ('scheduled', 'rescheduled'))
      ORDER BY a.starts_at ASC, a.created_at ASC`,
    { userId, includeArchived: includeArchived ? 1 : 0 },
  );
  return rows.map((row) => ({
    id: row.id,
    listingId: row.listing_id,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    timezone: row.timezone,
    location: row.location,
    contactName: row.contact_name,
    appointmentState: row.state,
    source: row.source,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    title: row.title,
    address: row.address,
    provider: row.provider,
    link: row.link,
    imageUrl: row.imageUrl,
    price: row.price,
    size: row.size,
    rooms: row.rooms,
    status: parseJson(row.status),
  }));
}

export function getApplicationContext(listingId, userId, isAdmin = false) {
  if (!userOwnsListing(listingId, userId, isAdmin)) return null;
  const listing = SqliteConnection.query(
    `SELECT id, title, address, provider, link, status FROM listings WHERE id = @listingId LIMIT 1`,
    { listingId },
  )[0];
  const appointments = SqliteConnection.query(
    `SELECT id, starts_at AS startsAt, ends_at AS endsAt, timezone, location,
            contact_name AS contactName, state, source, created_at AS createdAt
       FROM application_appointments
      WHERE listing_id = @listingId AND user_id = @userId
      ORDER BY created_at DESC`,
    { listingId, userId },
  );
  const tasks = SqliteConnection.query(
    `SELECT id, type, title, due_at AS dueAt, state, source, created_at AS createdAt
       FROM application_tasks
      WHERE listing_id = @listingId AND user_id = @userId
      ORDER BY created_at DESC`,
    { listingId, userId },
  );
  const events = SqliteConnection.query(
    `SELECT id, event_type AS eventType, previous_value AS previousValue,
            new_value AS newValue, source, confidence, reason, created_at AS createdAt
       FROM application_events
      WHERE listing_id = @listingId AND user_id = @userId
      ORDER BY created_at DESC LIMIT 100`,
    { listingId, userId },
  ).map((event) => ({
    ...event,
    previousValue: parseJson(event.previousValue),
    newValue: parseJson(event.newValue),
  }));
  return { ...listing, status: parseJson(listing.status), appointments, tasks, events };
}

export function setApplicationStatus({ listingId, userId, isAdmin = false, status, source = 'manual', reason = null }) {
  const normalized = status == null ? null : normalizeListingStatus(status);
  if (status != null && normalized == null) throw new Error(`Invalid listing status: ${status}`);
  if (!userOwnsListing(listingId, userId, isAdmin)) return false;
  SqliteConnection.withTransaction((db) => {
    const previous = parseJson(db.prepare(`SELECT status FROM listings WHERE id = ?`).get(listingId)?.status);
    const now = Date.now();
    const next = normalized == null ? null : { status: normalized, setAt: now };
    db.prepare(`UPDATE listings SET status = @status WHERE id = @listingId`).run({ listingId, status: json(next) });
    db.prepare(
      `INSERT INTO application_events
         (id, listing_id, user_id, event_type, previous_value, new_value, source, reason, created_at)
       VALUES (@id, @listingId, @userId, 'status_changed', @previousValue, @newValue, @source, @reason, @now)`,
    ).run({
      id: nanoid(),
      listingId,
      userId,
      previousValue: json(previous),
      newValue: json(next),
      source,
      reason,
      now,
    });
    if (normalized != null) {
      db.prepare(
        `INSERT INTO watch_list (id, listing_id, user_id) VALUES (@id, @listingId, @userId)
         ON CONFLICT(listing_id, user_id) DO NOTHING`,
      ).run({ id: nanoid(), listingId, userId });
    }
  });
  return true;
}

export function upsertAppointment({
  listingId,
  userId,
  isAdmin = false,
  startsAt,
  endsAt = null,
  timezone = 'Europe/Berlin',
  location = null,
  contactName = null,
  state = 'scheduled',
  source = 'manual',
  reason = null,
}) {
  const start = Number(startsAt);
  if (!Number.isFinite(start) || start <= 0) throw new Error('A valid appointment start is required.');
  if (!['scheduled', 'rescheduled', 'cancelled', 'completed'].includes(state))
    throw new Error('Invalid appointment state.');
  if (!userOwnsListing(listingId, userId, isAdmin)) return null;
  let result;
  SqliteConnection.withTransaction((db) => {
    const previous = db
      .prepare(
        `SELECT * FROM application_appointments
          WHERE listing_id = @listingId AND user_id = @userId
          ORDER BY created_at DESC LIMIT 1`,
      )
      .get({ listingId, userId });
    const now = Date.now();
    const id = nanoid();
    if (previous && ['scheduled', 'rescheduled'].includes(previous.state)) {
      db.prepare(`UPDATE application_appointments SET state = 'rescheduled', updated_at = @now WHERE id = @id`).run({
        id: previous.id,
        now,
      });
    }
    db.prepare(
      `INSERT INTO application_appointments
         (id, listing_id, user_id, starts_at, ends_at, timezone, location, contact_name,
          state, supersedes_id, source, created_at, updated_at)
       VALUES (@id, @listingId, @userId, @startsAt, @endsAt, @timezone, @location, @contactName,
               @state, @supersedesId, @source, @now, @now)`,
    ).run({
      id,
      listingId,
      userId,
      startsAt: start,
      endsAt: endsAt == null ? null : Number(endsAt),
      timezone,
      location,
      contactName,
      state,
      supersedesId: previous?.id ?? null,
      source,
      now,
    });
    db.prepare(
      `INSERT INTO application_events
         (id, listing_id, user_id, event_type, previous_value, new_value, source, reason, created_at)
       VALUES (@eventId, @listingId, @userId, @eventType, @previousValue, @newValue, @source, @reason, @now)`,
    ).run({
      eventId: nanoid(),
      listingId,
      userId,
      eventType: previous ? 'appointment_rescheduled' : 'appointment_created',
      previousValue: json(previous),
      newValue: json({ id, startsAt: start, endsAt, timezone, location, contactName, state }),
      source,
      reason,
      now,
    });
    result = { id, listingId, startsAt: start, endsAt, timezone, location, contactName, state, source };
  });
  return result;
}

export function updateAppointmentState({ appointmentId, userId, state, source = 'manual' }) {
  if (!['scheduled', 'rescheduled', 'cancelled', 'completed'].includes(state))
    throw new Error('Invalid appointment state.');
  let updated = false;
  SqliteConnection.withTransaction((db) => {
    const previous = db
      .prepare(`SELECT * FROM application_appointments WHERE id = @appointmentId AND user_id = @userId`)
      .get({ appointmentId, userId });
    if (!previous) return;
    const now = Date.now();
    db.prepare(`UPDATE application_appointments SET state = @state, updated_at = @now WHERE id = @appointmentId`).run({
      appointmentId,
      state,
      now,
    });
    db.prepare(
      `INSERT INTO application_events
         (id, listing_id, user_id, event_type, previous_value, new_value, source, created_at)
       VALUES (@id, @listingId, @userId, @eventType, @previousValue, @newValue, @source, @now)`,
    ).run({
      id: nanoid(),
      listingId: previous.listing_id,
      userId,
      eventType: state === 'cancelled' ? 'appointment_cancelled' : 'appointment_updated',
      previousValue: json(previous),
      newValue: json({ ...previous, state }),
      source,
      now,
    });
    updated = true;
  });
  return updated;
}
