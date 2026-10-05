# Officer Email route

Status: the route currently renders the collaborative event-mail view. It will become the route shell
for the role-aware Email workspace.

## Route responsibility

- Load portal capability data before rendering any mailbox, target, or action.
- Render Inbox, Sent, Drafts, and Assignments from the organization Email feature.
- Preserve URL-level access checks; hidden UI is not an authorization boundary.
- Keep message content, attachment fetches, and mutations behind typed portal gateway calls.
- Never expose the extension AI key or private mail/auth service credentials.

## Migration sequence

1. Add the new Email workspace behind a feature flag.
2. Reuse current collaborative draft components through an adapter.
3. Add shared Inbox/Sent and member-safe message types.
4. Switch the navigation label from Email Drafts to Email.
5. Remove the old view only after route, capability, and workflow parity tests pass.

The member event Inbox is a separate member-facing rendering of released event communications; this
officer route MUST NOT expose officer queues or internal audit metadata to members.
