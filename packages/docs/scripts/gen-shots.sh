#!/usr/bin/env bash
#
# gen-shots.sh — capture Cyberstrike TUI screenshots/gifs with VHS.
#
# Deterministic dialog/menu shots only (no live AI). Runs the real `cyberstrike`
# in an ISOLATED profile (CYBERSTRIKE_TEST_HOME) from a neutral demo dir so no
# real auth/sessions/paths leak. Recipe: JetBrains Mono 26, 2000x1300,
# screenshots via MP4 -> frame -> trim -> version-mask; gifs via mask -> gifsicle.
#
# Usage: scripts/gen-shots.sh [name ...]   (no args = all)
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SHOT_OUT="$ROOT/public/docs/images/screenshots"
GIF_OUT="$ROOT/public/docs/images/gifs"
DEMO=/tmp/acme-shop
export CYBERSTRIKE_DISABLE_AUTOUPDATE=1

# neutral demo project (hides real path; shows /private/tmp/acme-shop:main)
setup_demo() {
  [ -d "$DEMO/.git" ] && return
  mkdir -p "$DEMO"; ( cd "$DEMO"; git init -q; git config user.email d@d.co; git config user.name demo
    echo "# acme-shop" > README.md; git add -A; git commit -qm init )
}

HDR='Set Shell "bash"
Set FontFamily "JetBrains Mono"
Set FontSize 26
Set Width 2000
Set Height 1300
Set Padding 32'
LAUNCH='Hide
Type "cd /tmp/acme-shop && clear"
Enter
Sleep 400ms
Type "cyberstrike"
Enter
Sleep 5s
Show'

mask_png() { # black-out the bottom-right version banner (bg is pure black -> seamless)
  local f="$1" W H; W=$(magick identify -format "%w" "$f"); H=$(magick identify -format "%h" "$f")
  magick "$f" -fill black -draw "rectangle $((W*84/100)),$((H*90/100)) $W,$H" "$f"
}

# shot <name> <action-tape-lines>   -> screenshots/<name>.png
shot() {
  local name="$1" action="$2"
  local tape="$ROOT/assets/tapes/$name.tape" tmp="/tmp/shot_$name.mp4"
  { echo "Output \"$tmp\""; echo "$HDR"; echo "$LAUNCH"; echo "$action"; echo 'Ctrl+C'; echo 'Sleep 300ms'; } > "$tape"
  local SB; SB=$(mktemp -d); CYBERSTRIKE_TEST_HOME="$SB" timeout 120 vhs "$tape" >/dev/null 2>&1 || { echo "  ✗ $name (vhs)"; return; }
  ffmpeg -y -sseof -1 -i "$tmp" -vframes 1 -q:v 2 "/tmp/shot_$name.png" >/dev/null 2>&1
  magick "/tmp/shot_$name.png" -fuzz 6% -trim +repage -bordercolor black -border 24 "$SHOT_OUT/$name.png"
  mask_png "$SHOT_OUT/$name.png"
  echo "  ✓ $name.png ($(magick identify -format '%wx%h' "$SHOT_OUT/$name.png"))"
}

# clip <name> <action-tape-lines>   -> gifs/<name>.gif
clip() {
  local name="$1" action="$2"
  local tape="$ROOT/assets/tapes/$name.tape" out="$GIF_OUT/$name.gif"
  { echo "Output \"$out\""; echo "$HDR"; echo "$LAUNCH"; echo "$action"; echo 'Ctrl+C'; echo 'Sleep 300ms'; } > "$tape"
  local SB; SB=$(mktemp -d); CYBERSTRIKE_TEST_HOME="$SB" timeout 120 vhs "$tape" >/dev/null 2>&1 || { echo "  ✗ $name (vhs)"; return; }
  local W H; W=$(ffprobe -v error -select_streams v:0 -show_entries stream=width -of csv=p=0 "$out")
  H=$(ffprobe -v error -select_streams v:0 -show_entries stream=height -of csv=p=0 "$out")
  magick "$out" -coalesce -fill black -draw "rectangle $((W*84/100)),$((H*90/100)) $W,$H" -layers optimize "$out" >/dev/null 2>&1
  command -v gifsicle >/dev/null && gifsicle -O3 --lossy=30 --colors 200 -b "$out" >/dev/null 2>&1 || true
  echo "  ✓ $name.gif ($(ls -la "$out" | awk '{print $5}')b)"
}

setup_demo
want() { [ "$#" -eq 0 ] && return 0; case " $ALL " in *" $1 "*) return 0;; *) return 1;; esac; }
ALL="$*"

# ---- Screenshots (dialog/menu via keybind) ----
want s05-provider-dialog   && shot s05-provider-dialog   'Type "/connect"
Enter
Sleep 2s'
want s08-slash-menu        && shot s08-slash-menu        'Type "/"
Sleep 2s'
want s09-agent-select      && shot s09-agent-select      'Ctrl+X
Sleep 300ms
Type "a"
Sleep 2s'
want tui-theme-selector    && shot tui-theme-selector    'Ctrl+X
Sleep 300ms
Type "t"
Sleep 2s'
want tui-commands          && shot tui-commands          'Ctrl+P
Sleep 2s'
want anthropic-model-select && shot anthropic-model-select 'Ctrl+X
Sleep 300ms
Type "m"
Sleep 800ms
Type "claude"
Sleep 1500ms'
want openai-model-select   && shot openai-model-select   'Ctrl+X
Sleep 300ms
Type "m"
Sleep 800ms
Type "gpt"
Sleep 1500ms'
want gemini-model-select   && shot gemini-model-select   'Ctrl+X
Sleep 300ms
Type "m"
Sleep 800ms
Type "gemini"
Sleep 1500ms'

# ---- Gifs (interaction) ----
want g02-model-switch      && clip g02-model-switch      'Ctrl+X
Sleep 300ms
Type "m"
Sleep 1200ms
Down
Sleep 500ms
Down
Sleep 500ms
Enter
Sleep 1500ms'
want g05-agent-switch      && clip g05-agent-switch      'Ctrl+X
Sleep 300ms
Type "a"
Sleep 1200ms
Down
Sleep 600ms
Enter
Sleep 1500ms'
want navigation-commands   && clip navigation-commands   'Type "/"
Sleep 1200ms
Down
Sleep 500ms
Down
Sleep 500ms
Down
Sleep 1200ms'
want session-commands      && clip session-commands      'Ctrl+X
Sleep 300ms
Type "l"
Sleep 2500ms'
