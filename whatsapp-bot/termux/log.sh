#!/data/data/com.termux/files/usr/bin/bash
DIR="$(cd "$(dirname "$0")/.." && pwd)"
tail -n "${1:-40}" "$DIR/data/bot.log" | node "$DIR/dist/cli/pretty.js"
