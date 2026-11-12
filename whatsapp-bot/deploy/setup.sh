#!/usr/bin/env bash
# One-time installation on a fresh Ubuntu 24.04 server. Run as root from the whatsapp-bot folder:
#   bash deploy/setup.sh
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then echo "Run as root: sudo bash deploy/setup.sh"; exit 1; fi
DIR="$(cd "$(dirname "$0")/.." && pwd)"
case "$DIR" in
  /root/*|/home/*) echo "Put the project under /opt (for example /opt/bot), not under $DIR, then run this again."; exit 1 ;;
esac
cd "$DIR"

echo "==> system packages (ffmpeg, Hebrew and emoji fonts, build tools)"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y curl ca-certificates git nano sudo ffmpeg fonts-noto-core fonts-noto-color-emoji fonts-dejavu-core build-essential python3

if ! command -v node >/dev/null 2>&1 || [ "$(node -p 'Number(process.versions.node.split(".")[0])')" -lt 20 ]; then
  echo "==> Node.js 22"
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi

echo "==> user that runs the bot"
id wabot >/dev/null 2>&1 || useradd --system --create-home --shell /usr/sbin/nologin wabot
[ -f .env ] || cp .env.example .env
# the bot's user owns the whole checkout, so "bot update" can pull new versions
TOP="$(git -C "$DIR" rev-parse --show-toplevel 2>/dev/null || echo "$DIR")"
case "$TOP" in
  /|/opt|/usr|/var|/etc|/srv) echo "Refusing to change ownership of $TOP. Clone the project into its own folder, for example /opt/bot."; exit 1 ;;
esac
chown -R wabot:wabot "$TOP"
chmod 600 .env

echo "==> dependencies and build"
sudo -u wabot -H env PATH="$PATH" npm ci
sudo -u wabot -H env PATH="$PATH" npm run build

echo "==> service and the 'bot' command"
sed -e "s|__DIR__|$DIR|g" -e "s|__NODE__|$(command -v node)|g" deploy/whatsapp-bot.service > /etc/systemd/system/whatsapp-bot.service
sed -e "s|__DIR__|$DIR|g" deploy/bot > /usr/local/bin/bot
chmod 755 /usr/local/bin/bot
systemctl daemon-reload
systemctl enable whatsapp-bot >/dev/null

cat <<'DONE'

ההתקנה הסתיימה. השלבים הבאים:
  1. bot env        למלא את המפתח ואת המספרים (שמירה: Ctrl+O, Enter, יציאה: Ctrl+X)
  2. bot doctor     לוודא שהכול תקין
  3. bot link       לחבר את הבוט לוואטסאפ
  4. bot check      לוודא שהבוט מנהל בערוצים
  5. bot preview riddles   לראות פוסטים לדוגמה
  6. bot test riddles      לשלוח 4 פוסטים לבדיקה לערוץ אחד, ולבדוק בטלפון מה הגיע
  7. bot start      להפעיל
DONE
