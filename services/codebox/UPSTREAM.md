# Pinned Codebox source

Source: https://github.com/hiteshchoudhary/Codebox
Revision: `9e3a3f690e13ae01b33c2ac325fbad311b710b48`
The upstream package declares the MIT license. Preserve attribution and upstream metadata.

`upstream/` contains the inspected source and dependency lockfile. Its original API,
auto-selected executors, and production compose files are not deployment entrypoints.
`Dockerfile` builds native ARM64/AMD64 runtimes. `dalgo/` provides a restricted API
and BullMQ worker that invoke the upstream `IsolateExecutor` directly.

Local executor patches: allow only the four supported languages and single-file
submissions; remove stale metadata; require reliable sandbox measurements; cap reads
and disallow following output symlinks; distinguish oversized output; keep /tmp
private per sandbox; propagate cleanup failures and compiler infrastructure failures.
`upstream.patch` records the executor changes against the pinned revision.

Runtime defaults: Node 24 LTS, Python 3.12, GCC 13/C++17, OpenJDK 17; exact installed
patch versions belong in each verification report. Isolate is pinned at v2.7.
Updates require rebuilding and repeating the sandbox and problem-bank checks.
