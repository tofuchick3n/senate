#!/usr/bin/env bash
# Curated senate demo. Wrapped by scripts/record-demo.sh under asciinema.
# Each step pauses briefly so the recording reads cleanly.
set -euo pipefail

pause() { sleep "${1:-1.2}"; }
type_cmd() {
  # Echo the command with a "$ " prompt before running it, so viewers see
  # what's being invoked. Slow-type effect makes the recording feel live.
  printf '\n\033[1;34m$\033[0m '
  for ((i=0; i<${#1}; i++)); do
    printf '%s' "${1:$i:1}"
    sleep 0.025
  done
  printf '\n'
  pause 0.6
}

clear
cat <<'BANNER'

   ███████╗███████╗███╗   ██╗ █████╗ ████████╗███████╗
   ██╔════╝██╔════╝████╗  ██║██╔══██╗╚══██╔══╝██╔════╝
   ███████╗█████╗  ██╔██╗ ██║███████║   ██║   █████╗
   ╚════██║██╔══╝  ██║╚██╗██║██╔══██║   ██║   ██╔══╝
   ███████║███████╗██║ ╚████║██║  ██║   ██║   ███████╗
   ╚══════╝╚══════╝╚═╝  ╚═══╝╚═╝  ╚═╝   ╚═╝   ╚══════╝

   multi-model orchestration: ask claude + gemini at once,
   get a synthesized answer with consensus, disagreements,
   outliers, and a final recommendation.

BANNER
pause 2.5

# 1. Quick consult — the 30-second pitch.
type_cmd 'senate "Should I use REST or GraphQL for an internal API?" --consult-only --quiet'
senate "Should I use REST or GraphQL for an internal API?" --consult-only --quiet || true
pause 2.5

# 2. The new --diff flag reviewing a tiny buggy patch.
DIFF=$(mktemp)
cat > "$DIFF" <<'PATCH'
diff --git a/src/math.rs b/src/math.rs
index abc..def 100644
--- a/src/math.rs
+++ b/src/math.rs
@@ -1,3 +1,3 @@
-pub fn add(a: i32, b: i32) -> i32 { a + b }
+pub fn add(a: i32, b: i32) -> i32 { a - b }
PATCH

type_cmd "senate --diff $DIFF -a claude --consult-only --quiet"
senate --diff "$DIFF" -a claude --consult-only --quiet || true
rm -f "$DIFF"
pause 2

echo
echo
echo "Try it: npm install -g senate-ai"
echo "Repo:   https://github.com/tofuchick3n/senate"
pause 2
