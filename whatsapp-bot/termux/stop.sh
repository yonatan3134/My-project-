#!/data/data/com.termux/files/usr/bin/bash
DIR="$(cd "$(dirname "$0")/.." && pwd)"
touch "$DIR/data/stop"
[ -f "$DIR/data/run.pid" ] && kill "$(cat "$DIR/data/run.pid")" 2>/dev/null
pkill -f "node dist/index.js" 2>/dev/null
sleep 2
rm -f "$DIR/data/stop" "$DIR/data/run.pid"
termux-wake-unlock 2>/dev/null || true
echo "stopped"
