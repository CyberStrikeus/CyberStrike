#!/usr/bin/env bash
#
# gen-assets.sh — generate documentation assets from source files.
#
#   Diagrams:  assets/diagrams/*.mmd|*.mermaid  --mmdc-->  public/docs/images/diagrams/*.svg
#   GIFs:      assets/tapes/*.tape              --vhs--->  public/docs/images/gifs/*.gif  (path set inside each tape)
#
# Usage:
#   scripts/gen-assets.sh              # everything
#   scripts/gen-assets.sh diagrams     # only mermaid -> svg
#   scripts/gen-assets.sh gifs         # only vhs tapes -> gif
#   scripts/gen-assets.sh diagrams config-priority   # a single diagram by basename
#
set -euo pipefail

DOCS_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIAGRAM_SRC="$DOCS_ROOT/assets/diagrams"
TAPE_SRC="$DOCS_ROOT/assets/tapes"
DIAGRAM_OUT="$DOCS_ROOT/public/docs/images/diagrams"
GIF_OUT="$DOCS_ROOT/public/docs/images/gifs"
MERMAID_CFG="$DOCS_ROOT/assets/mermaid.config.json"
PUPPETEER_CFG="$DOCS_ROOT/assets/puppeteer.json"

info() { printf '\033[36m▸ %s\033[0m\n' "$*"; }
warn() { printf '\033[33m! %s\033[0m\n' "$*"; }
ok()   { printf '\033[32m✓ %s\033[0m\n' "$*"; }

# Resolve mmdc: local node_modules → global → npx fallback (first run downloads it).
resolve_mmdc() {
  if [ -x "$DOCS_ROOT/node_modules/.bin/mmdc" ]; then
    MMDC=("$DOCS_ROOT/node_modules/.bin/mmdc")
  elif command -v mmdc >/dev/null 2>&1; then
    MMDC=(mmdc)
  elif command -v npx >/dev/null 2>&1; then
    warn "mmdc not installed locally — using 'npx @mermaid-js/mermaid-cli' (first run downloads it)."
    MMDC=(npx -y "@mermaid-js/mermaid-cli@11")
  else
    warn "No mmdc and no npx. Install with: npm i -D @mermaid-js/mermaid-cli"
    return 1
  fi
}

gen_diagrams() {
  local only="${1:-}"
  mkdir -p "$DIAGRAM_OUT"
  resolve_mmdc || return 1
  shopt -s nullglob
  local found=0
  for src in "$DIAGRAM_SRC"/*.mmd "$DIAGRAM_SRC"/*.mermaid; do
    local base; base="$(basename "${src%.*}")"
    [ -n "$only" ] && [ "$base" != "$only" ] && continue
    found=1
    local out="$DIAGRAM_OUT/$base.svg"
    info "diagram: $base.svg"
    "${MMDC[@]}" -i "$src" -o "$out" \
      -c "$MERMAID_CFG" -p "$PUPPETEER_CFG" \
      -b transparent >/dev/null
    ok "$out"
  done
  [ "$found" = 0 ] && warn "No matching diagram sources in $DIAGRAM_SRC"
  return 0
}

gen_gifs() {
  local only="${1:-}"
  if ! command -v vhs >/dev/null 2>&1; then
    warn "vhs not installed. Install with: brew install vhs"
    return 1
  fi
  mkdir -p "$GIF_OUT"
  shopt -s nullglob
  local found=0
  for tape in "$TAPE_SRC"/*.tape; do
    local base; base="$(basename "${tape%.tape}")"
    [ -n "$only" ] && [ "$base" != "$only" ] && continue
    found=1
    info "gif: $base (vhs $tape)"
    ( cd "$DOCS_ROOT" && vhs "$tape" )
    # Optimize any gif this tape may have produced, if gifsicle is available.
    if command -v gifsicle >/dev/null 2>&1; then
      local g="$GIF_OUT/$base.gif"
      [ -f "$g" ] && gifsicle -O3 --lossy=80 --colors 128 -b "$g" && ok "optimized $g"
    else
      warn "gifsicle not found — skipping optimization (brew install gifsicle)"
    fi
  done
  [ "$found" = 0 ] && warn "No matching tapes in $TAPE_SRC"
  return 0
}

target="${1:-all}"
name="${2:-}"
case "$target" in
  diagrams) gen_diagrams "$name" ;;
  gifs)     gen_gifs "$name" ;;
  all)      gen_diagrams "$name"; gen_gifs "$name" ;;
  *) echo "Usage: $0 [all|diagrams|gifs] [basename]"; exit 1 ;;
esac
