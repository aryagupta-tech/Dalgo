# Dalgo beta privacy notice — operator review required

This draft still needs the operator's name and public support email before it can be published as Dalgo's privacy notice. It describes the implemented architecture, not a claim of legal compliance.

Dalgo uses Google or GitHub sign-in through Supabase. It stores an account identifier, profile name/avatar, six arena ratings, match results, and submission records. Profile names and ratings appear on the leaderboard. Players cannot read an opponent's submitted code or the hidden problem answers.

For real Run and Submit actions, Dalgo sends the source code and test inputs to its private Codebox execution service on a private Google Compute Engine server. Credentials and expected hidden answers are excluded from the execution payload. The execution service removes temporary code and output records within its 24-hour retention window; the operator must verify the hosted retention job before launch.

Dalgo retains private submitted source for 30 days, then removes it from its database and live-match storage. Compact verdicts, match history, and rating changes remain. Live-match coordination runs on Cloudflare; account and match records use Supabase. Operational logs track errors, timing, execution capacity, and match identifiers without logging source code.

Demo code is not executed or submitted to the judge, and demo ratings are not saved. Demo state and drafts use browser session storage. Live editor drafts use local browser storage. A player can clear these through the browser's site-data controls; restarting a demo creates a new session.

The operator should publish a support contact and a process for account/data requests as soon as those details are supplied. A deletion request needs a reviewed retention/anonymization workflow for linked rating and match records; simply deleting an authentication row is not a complete account-deletion implementation.
