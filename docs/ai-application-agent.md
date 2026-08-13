# External AI application agent

Fredy is the system of record for listings, application stages, appointments, tasks, and audit events. The external agent owns mailbox access through the user's trusted Gmail or Outlook OAuth integration. Fredy does not need mailbox credentials or message bodies.

## Recommended flow

1. Gmail or Outlook triggers the agent for a new housing-related message.
2. The agent extracts only an object reference, address, provider, event type, deadlines, and appointment facts. It must not forward the full body, attachments, credentials, phone numbers, or unrelated personal data.
3. Call `find_listing_candidates`. Continue only when one candidate is supported by strong evidence; otherwise leave the message for manual review outside Fredy.
4. Call `get_application_context` to prevent stale or contradictory changes.
5. Call `propose_application_update` with the provider message ID as `externalEventId`. Fredy hashes it for idempotency and does not store the original ID.
6. The user accepts or rejects the structured suggestion in **AI Suggestions**. Only acceptance changes Fredy's records.

The MCP endpoint is `https://YOUR-FREDY/api/mcp`. Create a dedicated, revocable token under **Settings → AI integration** with only `jobs:read`, `listings:read`, `applications:read`, and `applications:propose`.

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
