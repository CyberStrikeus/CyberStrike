# VHS tape — terminal GIF source for the docs.
# Docs: https://github.com/charmbracelet/vhs
# Generate:  vhs assets/tapes/example-first-run.tape   (or: npm run assets:gifs)
#
# Output path MUST point into public/docs/images/gifs/ so the docs can reference it.
Output public/docs/images/gifs/example-first-run.gif

# --- Look & feel (Cyberstrike brand) ---
Set Shell "bash"
Set FontFamily "JetBrains Mono"
Set FontSize 20
Set Width 1200
Set Height 700
Set Padding 24
Set Theme { "name": "cyberstrike", "background": "#0b1220", "foreground": "#e6f2ff", "cursor": "#00ff88", "green": "#00ff88", "cyan": "#00d4ff", "red": "#ff4444" }

# --- Script: type a command, run it, pause so the frame is readable ---
Type "cyberstrike --version"
Sleep 500ms
Enter
Sleep 2s

# Capture a still frame (PNG) at any point with:
# Screenshot public/docs/images/screenshots/example.png
