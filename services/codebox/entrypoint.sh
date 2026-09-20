#!/bin/sh
set -eu
# This container sees only its own delegated cgroup tree, never the host root.
test -f /sys/fs/cgroup/cgroup.controllers
mkdir -p /sys/fs/cgroup/worker /sys/fs/cgroup/isolate
printf '%s\n' "$$" > /sys/fs/cgroup/worker/cgroup.procs
printf '%s\n' '+cpu +memory +pids' > /sys/fs/cgroup/cgroup.subtree_control
printf '%s\n' '+cpu +memory +pids' > /sys/fs/cgroup/isolate/cgroup.subtree_control
mkdir -p /var/local/lib/isolate /run/isolate
exec "$@"
