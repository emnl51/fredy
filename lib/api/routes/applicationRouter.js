/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import {
  getApplicationContext,
  listApplicationAppointments,
  setApplicationStatus,
  updateAppointmentState,
  upsertAppointment,
} from '../../services/storage/applicationStorage.js';

export default async function applicationPlugin(fastify) {
  fastify.get('/appointments', async (request) =>
    listApplicationAppointments(request.session.currentUser, {
      includeArchived: request.query?.includeArchived !== 'false',
    }),
  );

  fastify.post('/appointments', async (request, reply) => {
    try {
      const appointment = upsertAppointment({
        ...request.body,
        userId: request.session.currentUser,
        source: 'manual',
      });
      if (!appointment) return reply.code(404).send({ error: 'Listing not found.' });
      return appointment;
    } catch (error) {
      return reply.code(400).send({ error: error.message });
    }
  });

  fastify.patch('/appointments/:appointmentId', async (request, reply) => {
    try {
      const updated = updateAppointmentState({
        appointmentId: String(request.params.appointmentId),
        userId: request.session.currentUser,
        state: request.body?.state,
      });
      if (!updated) return reply.code(404).send({ error: 'Appointment not found.' });
      return { updated: true };
    } catch (error) {
      return reply.code(400).send({ error: error.message });
    }
  });

  fastify.get('/:listingId', async (request, reply) => {
    const context = getApplicationContext(String(request.params.listingId), request.session.currentUser);
    if (!context) return reply.code(404).send({ error: 'Listing not found.' });
    return context;
  });

  fastify.put('/:listingId/status', async (request, reply) => {
    try {
      const updated = setApplicationStatus({
        listingId: String(request.params.listingId),
        userId: request.session.currentUser,
        status: request.body?.status ?? null,
      });
      if (!updated) return reply.code(404).send({ error: 'Listing not found.' });
      return { updated: true };
    } catch (error) {
      return reply.code(400).send({ error: error.message });
    }
  });
}
