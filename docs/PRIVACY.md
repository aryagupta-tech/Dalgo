# dalgo privacy and data requests

**Last updated: 20 September 2026**

Dalgo is operated by **Arya Gupta**. For support, privacy questions, or account and data requests, email **aryaguptaa.vns@gmail.com**.

## Information dalgo stores

Google sign-in provides an account identifier and may provide a display name, email address, and avatar. Dalgo also stores profile pictures uploaded by the player, the player's chosen username, six arena ratings, match participation, verdicts, rating changes, and submission records.

Usernames, display names, profile pictures, ratings, and match statistics may appear to other players or on leaderboards. Uploaded profile pictures are stored in a public Supabase bucket so dalgo can display them throughout the service. For matches started after public code reviews launch, anyone can view both players’ scored Submit code after the result is saved. Sample Run code, hidden tests, and live code are never shown to opponents.

## Code execution and service providers

Live Run and Submit actions send source code and test inputs from Cloudflare to dalgo's private Codebox service on AWS. Expected hidden answers and service credentials are excluded from execution payloads.

Dalgo uses Supabase for authentication and stored application data, Cloudflare for the website and live match coordination, and AWS for private code execution. These services process data as needed to provide dalgo.

## Retention

Submitted source is retained in dalgo's database and live match storage for up to 30 days. Public scored Submit code is available during that period for eligible completed matches. Codebox source and output records are removed after 24 hours. Compact verdicts, match history, and rating changes may be retained after source removal.

Operational logs may contain error details, timing, capacity, and match identifiers. They are configured not to record submitted source code.

## Browser storage

Live editor drafts and sign-in sessions use browser storage. Players can remove these through their browser's site-data controls.

## Access and deletion requests

Email **aryaguptaa.vns@gmail.com** from the email connected to the dalgo account and include the account username. Dalgo may ask for additional verification before disclosing or deleting account data.

A completed deletion removes authentication access, profile data, ratings, challenges, submissions, and linked records required to remove the account. Shared match history may be deleted or anonymized so another player's account remains internally consistent.

## Changes to this notice

This notice will be updated when dalgo changes its providers, retention periods, public features, or contact details. The date above identifies the current version.
