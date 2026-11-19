#!/data/data/com.termux/files/usr/bin/bash
# Keeps the bot running: starts it again a few seconds after it stops for any reason.
DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$DIR"
export PANEL_PORT=8080 PANEL_HOST=127.0.0.1
LOG="$DIR/data/bot.log"
while [ ! -f "$DIR/data/stop" ]; do
  if [ -f "$LOG" ] && [ "$(stat -c %s "$LOG")" -gt 20000000 ]; then mv -f "$LOG" "$LOG.old"; fi
  node dist/index.js >> "$LOG" 2>&1
  [ -f "$DIR/data/stop" ] && break
  sleep 5
done
