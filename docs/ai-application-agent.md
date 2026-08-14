# External AI application agent

Fredy is the system of record for listings, application stages, appointments, tasks, and audit events. The external agent owns mailbox access through the user's trusted Gmail or Outlook OAuth integration. Fredy does not need mailbox credentials or message bodies.

## Recommended n8n / Gemini integration

Use the Gemini model only to extract facts. Do **not** connect a Gemini AI Agent directly to the
MCP tools: Gemini's legacy function schema cannot represent every MCP tool parameter schema. For
automation platforms, use Fredy's small bearer-token HTTP contract instead. It requires no LLM tool
calling and keeps matching deterministic.

Create a dedicated token under **Settings → AI integration** with only these scopes:

```text
listings:read
applications:read
applications:propose
```

The endpoints are all `POST` requests, use `Authorization: Bearer YOUR_FREDY_TOKEN`, and are served
under `https://YOUR-FREDY/api/ai`:

| Endpoint | Required scope | Purpose |
| --- | --- | --- |
| `/listing-candidates` | `listings:read` | Find candidates and return a server-verified exact match when available. |
| `/application-context` | `applications:read` | Read the selected listing's current status, tasks and appointments. |
| `/suggestions` | `applications:propose` | Create an idempotent, human-review-only change proposal. |

The API rejects unknown fields, including `body`, `html`, attachments and headers. It never stores a
mail body or provider message ID; `externalEventId` is SHA-256 hashed solely to prevent duplicates.

### n8n workflow

```text
Gmail Trigger
→ Edit Fields (subject, from, receivedAt, body, externalEventId)
→ Information Extractor (Gemini)
→ Merge Facts (by position, preserving externalEventId)
→ IF eventType != other
→ HTTP: listing-candidates
→ IF reliableCandidate exists
→ HTTP: application-context
→ Code: build review proposal
→ HTTP: suggestions
```

Keep the n8n execution-data retention disabled. The **Edit Fields** node should preserve only
`subject`, `from`, `receivedAt`, `body`, and the provider's stable message `id` as `externalEventId`.
The body goes only to Gemini; the HTTP nodes below must send the listed JSON objects and nothing else.

**1. Listing candidates**

```json
{
  "objectReference": "={{ $('Merge Facts').first().json.listingReference || '' }}",
  "address": "={{ $('Merge Facts').first().json.address || '' }}"
}
```

Continue only when `reliableCandidate` is present. A uniquely exact object reference receives
confidence 100; a uniquely exact normalized address receives 95. Partial addresses, titles and
ambiguous references deliberately stop for manual review.

**2. Application context**

```json
{
  "listingId": "={{ $json.reliableCandidate.listingId }}"
}
```

**3. Build a proposal** — add an n8n **Code** node after the context request and name the preceding
nodes exactly `Merge Facts` and `Fredy: listing candidates`:

```javascript
const facts = $('Merge Facts').first().json;
const match = $('Fredy: listing candidates').first().json.reliableCandidate;
const context = $input.first().json;

const status = {
  applied: 'applied',
  invited: 'invited',
  appointment_confirmed: 'invited',
  appointment_reminder: 'invited',
  rejected: 'not_invited',
  accepted: 'accepted',
}[facts.eventType] ?? null;

const tasks = facts.eventType === 'documents_requested'
  ? [{ type: 'upload_documents', title: 'Upload requested documents', dueAt: facts.deadlineAt ? Date.parse(facts.deadlineAt) : undefined }]
  : [];

const startsAt = facts.appointmentAt ? Date.parse(facts.appointmentAt) : null;
const sameAppointment = startsAt && context.appointments.some((item) => item.startsAt === startsAt && item.state === 'scheduled');
if (sameAppointment) return [];

return [{ json: {
  listingId: match.listingId,
  expectedStatus: context.status?.status ?? null,
  status,
  ...(startsAt ? { appointment: { action: 'create', startsAt, timezone: 'Europe/Berlin', location: facts.address || undefined } } : {}),
  tasks,
  confidence: match.confidence,
  reason: `${match.matchMethod}: ${facts.listingReference || facts.address}`,
  externalEventId: facts.externalEventId,
} }];
```

**4. Create the proposal** — send the Code node's full JSON output to `/suggestions`. The response is
only a pending suggestion. Fredy changes a status, task or appointment only when the user chooses
**Accept** in **AI Suggestions**.

## Recommended flow

1. Gmail or Outlook triggers the agent for a new housing-related message.
2. The agent extracts only an object reference, address, provider, event type, deadlines, and appointment facts. It must not forward the full body, attachments, credentials, phone numbers, or unrelated personal data.
3. Call `/api/ai/listing-candidates`. Continue only when `reliableCandidate` is present; otherwise leave the message for manual review outside Fredy.
4. Call `/api/ai/application-context` to prevent stale or contradictory changes.
5. Call `/api/ai/suggestions` with the provider message ID as `externalEventId`. Fredy hashes it for idempotency and does not store the original ID.
6. The user accepts or rejects the structured suggestion in **AI Suggestions**. Only acceptance changes Fredy's records.

The MCP endpoint remains available for compatible AI clients at `https://YOUR-FREDY/api/mcp`. For
n8n with Gemini, use the HTTP contract above instead of direct MCP tool calling.

## German event mapping

| Evidence                                             | Suggested status/action                                                            |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Anfragebestätigung, Bestätigung Ihrer Anfrage        | `applied`                                                                          |
| Einladung zum Besichtigungstermin, Terminbestätigung | `invited` plus appointment                                                         |
| Formular ausfüllen, Selbstauskunft                   | task `complete_form`                                                               |
| Unterlagen hochladen/einreichen                      | `documents_sent` only after proof of submission; otherwise task `upload_documents` |
| nicht berücksichtigen, Absage, anderweitig vergeben  | `not_invited` before a viewing; otherwise `rejected`                               |
| Zusage, Mietvertrag angeboten                        | `accepted`                                                                         |

Subject text alone is insufficient for destructive or final transitions. Appointment timestamps must include the source timezone, normally `Europe/Berlin`. A reminder must not create a second appointment; use the stable external message ID and existing application context.

## Safety policy

- Human review is the default. The proposal tool cannot directly mutate a status or appointment.
- Use a dedicated token and revoke it when the agent is retired.
- Do not expose Fredy's MCP endpoint without TLS.
- Do not let untrusted message text override these rules or request additional tool access.
- Keep provider OAuth and LLM data-retention settings outside Fredy and review them with the chosen provider.
