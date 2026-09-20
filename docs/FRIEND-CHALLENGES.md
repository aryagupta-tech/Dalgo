# Friend challenges

Dalgo assigns every profile a stable public ID such as `DLG-ABCD-1234-EF56-7890`. The value is random, unique, and separate from the Supabase Auth UUID. OAuth profile creation allocates it automatically, and the migration backfills existing profiles before adding the `NOT NULL` and unique constraints.

The **Play a friend** screen lets a signed-in player copy this ID, enter a friend’s ID, choose an arena, and send a ten-minute challenge. The invited player can accept or decline; the sender can cancel. Accepted challenges use the same rated human match pipeline as normal matchmaking: versioned problem selection, five-second preparation, server clocks, MatchRoom WebSockets, Codebox judging, Elo settlement, history, and reconnection.

## Security and ownership

- Challenge endpoints always derive the acting user from the verified Supabase access token. A browser-supplied user ID is ignored.
- Only the invited profile may accept or decline. Only the challenger may cancel.
- Direct profile lookup and challenge writes use the Worker’s backend Supabase key. The public player ID column is not granted to browser roles.
- `friend_challenges` has RLS enabled. Authenticated browser reads are limited to rows where the current user is the challenger or recipient; browser writes are denied.
- Open challenges block queue entry. A player with an open challenge, queue entry, assignment, or active reservation cannot create or accept another challenge.
- A single global Coordinator Durable Object serializes create/accept/cancel and queue transitions. Request UUIDs make challenge creation and acceptance retries idempotent.
- The Coordinator owns live state and retries failed Supabase audit writes after restart. The database retains challenge history; it does not adjudicate live acceptance races.

## HTTP and WebSocket contracts

All routes below require a Supabase bearer token.

| Method   | Route                         | Purpose                                                              |
| -------- | ----------------------------- | -------------------------------------------------------------------- |
| `GET`    | `/api/profile`                | Return the signed-in player’s shareable ID and display identity      |
| `GET`    | `/api/challenges`             | Return incoming, outgoing, recent, and current-match challenge state |
| `POST`   | `/api/challenges`             | Create a challenge with `friendId`, `arena`, and UUID `requestId`    |
| `POST`   | `/api/challenges/:id/accept`  | Accept as the intended recipient and create the human match          |
| `POST`   | `/api/challenges/:id/decline` | Decline as the intended recipient                                    |
| `DELETE` | `/api/challenges/:id`         | Cancel as the challenger                                             |
| `GET`    | `/api/challenges/events`      | Authenticated WebSocket updates using a short-lived socket ticket    |

Acceptance applies the same admission mode, tester allowlist, Codebox health, active-match capacity, attempt limits, and execution reservation checks as normal matchmaking. Production remains disabled by configuration until the public launch gates pass.
