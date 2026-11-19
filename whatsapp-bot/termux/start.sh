#!/data/data/com.termux/files/usr/bin/bash
# Starts the bot in the background, with a loop that starts it again if it stops.
DIR="$(cd "$(dirname "$0")/.." && pwd)"
mkdir -p "$DIR/data"
if [ -f "$DIR/data/run.pid" ] && kill -0 "$(cat "$DIR/data/run.pid")" 2>/dev/null; then echo "already running"; exit 0; fi
termux-wake-lock 2>/dev/null || true
rm -f "$DIR/data/stop"
nohup bash "$DIR/termux/run.sh" >/dev/null 2>&1 &
echo $! > "$DIR/data/run.pid"
echo "started. Settings page: http://localhost:8080"
