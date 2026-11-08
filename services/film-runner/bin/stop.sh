#!/usr/bin/env bash
# Stops the runner on a film's computer. Run by the website's exec, which waits at most 20 s, so it
# returns at once:
#
# 1. SIGTERM to the runner. The runner stops the film command (SIGTERM to the film's
#    own group, SIGKILL after 60 s), posts its last events and exits.
# 2. A detached killer sends SIGKILL to both groups 75 s later, in case the runner could not.
set -u
run_dir="$HOME/br-run"
pid_file="$run_dir/runner.pid"
film_pid_file="$run_dir/film.pid"

if [ ! -f "$pid_file" ]; then
  echo "no runner"
  exit 0
fi
pid="$(cat "$pid_file")"
if ! kill -0 "$pid" 2>/dev/null; then
  echo "runner not running"
  exit 0
fi
pgid="$(ps -o pgid= -p "$pid" | tr -d ' ')"
film_pgid=""
if [ -f "$film_pid_file" ]; then
  film_pid="$(cat "$film_pid_file")"
  film_pgid="$(ps -o pgid= -p "$film_pid" 2>/dev/null | tr -d ' ')"
fi
kill -TERM "$pid" 2>/dev/null || true
setsid -f bash -c "sleep 75; kill -KILL -- -$pgid 2>/dev/null; ${film_pgid:+kill -KILL -- -$film_pgid 2>/dev/null;} true" \
  </dev/null >/dev/null 2>&1
echo "stopping runner $pid"
