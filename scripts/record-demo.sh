#!/usr/bin/env bash
# Record an asciinema cast of the senate demo and convert it to an inline
# SVG that GitHub renders directly in the README.
#
# Requirements:
#   - asciinema (brew install asciinema)
#   - npx (ships with Node) — used to fetch svg-term-cli on demand
#   - senate must be on $PATH and authenticated for at least claude
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CAST="$ROOT/assets/demo.cast"
SVG="$ROOT/assets/demo.svg"
DEMO="$ROOT/scripts/demo.sh"

mkdir -p "$ROOT/assets"
chmod +x "$DEMO"

if ! command -v asciinema >/dev/null 2>&1; then
  echo "Error: asciinema not on PATH. Install with: brew install asciinema" >&2
  exit 1
fi

echo "[1/2] Recording cast → $CAST"
echo "      (will run scripts/demo.sh — takes ~60s; press Ctrl-D when prompted, or let it auto-exit)"
asciinema rec --overwrite --cols 100 --rows 30 \
  --command "bash $DEMO" \
  "$CAST"

echo
echo "[2/2] Rendering animated SVG → $SVG"
npx -y svg-term-cli --in "$CAST" --out "$SVG" --window --width 100 --height 30
echo
echo "Done. Cast: $CAST"
echo "      SVG:  $SVG"
echo
echo "The README already references assets/demo.svg — commit both files when you're happy with the take."
