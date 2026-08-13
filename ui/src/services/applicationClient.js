/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { xhrGet, xhrPost, xhrPut } from './xhr.js';

const json = (response) => response.json;

export const getAppointments = (includeArchived = true) =>
  xhrGet(`/api/applications/appointments?includeArchived=${includeArchived}`).then(json);
export const saveAppointment = (appointment) => xhrPost('/api/applications/appointments', appointment).then(json);
export const setAppointmentState = (appointmentId, state) =>
  xhrPut(`/api/applications/appointments/${encodeURIComponent(appointmentId)}`, { state }).then(json);
export const getApplicationContext = (listingId) =>
  xhrGet(`/api/applications/${encodeURIComponent(listingId)}`).then(json);
export const updateApplicationStatus = (listingId, status) =>
  xhrPut(`/api/applications/${encodeURIComponent(listingId)}/status`, { status }).then(json);
