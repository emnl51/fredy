/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

/**
 * Move application appointments out of the listing status JSON and establish
 * mail-independent workflow records for appointments, tasks, and audit events.
 *
 * @param {import('better-sqlite3').Database} db
 */
export function up(db) {
  db.exec(`
    CREATE TABLE application_appointments (
      id             TEXT PRIMARY KEY,
      listing_id     TEXT NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
      user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      starts_at      INTEGER NOT NULL,
      ends_at        INTEGER,
      timezone       TEXT NOT NULL DEFAULT 'Europe/Berlin',
      location       TEXT,
      contact_name   TEXT,
      state          TEXT NOT NULL DEFAULT 'scheduled'
                     CHECK (state IN ('scheduled', 'rescheduled', 'cancelled', 'completed')),
      supersedes_id  TEXT REFERENCES application_appointments(id) ON DELETE SET NULL,
      source         TEXT NOT NULL DEFAULT 'manual'
                     CHECK (source IN ('manual', 'mcp', 'migration')),
      created_at     INTEGER NOT NULL,
      updated_at     INTEGER NOT NULL
    );

    CREATE INDEX idx_application_appointments_user_start
      ON application_appointments(user_id, starts_at);
    CREATE INDEX idx_application_appointments_listing
      ON application_appointments(listing_id, created_at DESC);

    CREATE TABLE application_events (
      id                  TEXT PRIMARY KEY,
      listing_id          TEXT NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
      user_id             TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      event_type          TEXT NOT NULL,
      previous_value      JSONB,
      new_value           JSONB,
      source              TEXT NOT NULL DEFAULT 'manual',
      confidence          INTEGER,
      reason              TEXT,
      external_event_hash TEXT,
      created_at          INTEGER NOT NULL
    );

    CREATE UNIQUE INDEX idx_application_events_external
      ON application_events(user_id, external_event_hash)
      WHERE external_event_hash IS NOT NULL;
    CREATE INDEX idx_application_events_listing
      ON application_events(listing_id, created_at DESC);

    CREATE TABLE application_tasks (
      id                  TEXT PRIMARY KEY,
      listing_id          TEXT NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
      user_id             TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      type                TEXT NOT NULL CHECK (type IN
                          ('complete_form', 'upload_documents', 'confirm_interest', 'book_appointment', 'other')),
      title               TEXT,
      due_at              INTEGER,
      state               TEXT NOT NULL DEFAULT 'pending'
                          CHECK (state IN ('pending', 'completed', 'dismissed')),
      source              TEXT NOT NULL DEFAULT 'manual',
      external_event_hash TEXT,
      created_at          INTEGER NOT NULL,
      updated_at          INTEGER NOT NULL
    );

    CREATE UNIQUE INDEX idx_application_tasks_external
      ON application_tasks(user_id, external_event_hash, type)
      WHERE external_event_hash IS NOT NULL;
    CREATE INDEX idx_application_tasks_user_due
      ON application_tasks(user_id, state, due_at);

    INSERT INTO application_appointments
      (id, listing_id, user_id, starts_at, timezone, state, source, created_at, updated_at)
    SELECT lower(hex(randomblob(16))), l.id, j.user_id,
           CAST(json_extract(l.status, '$.appointmentAt') AS INTEGER),
           'Europe/Berlin',
           CASE WHEN json_extract(l.status, '$.status') = 'visited' THEN 'completed' ELSE 'scheduled' END,
           'migration',
           COALESCE(CAST(json_extract(l.status, '$.setAt') AS INTEGER), unixepoch() * 1000),
           unixepoch() * 1000
      FROM listings l
      JOIN jobs j ON j.id = l.job_id
     WHERE json_extract(l.status, '$.appointmentAt') IS NOT NULL;

    UPDATE listings
       SET status = json_remove(status, '$.appointmentAt')
     WHERE json_extract(status, '$.appointmentAt') IS NOT NULL;
  `);
}
