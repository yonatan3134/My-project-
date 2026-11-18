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

# small free servers (1GB, like Google Cloud e2-micro) need swap to build and render video
if [ "$(awk '/MemTotal/ {print $2}' /proc/meminfo)" -lt 2000000 ] && ! swapon --show | grep -q .; then
  echo "==> adding 2GB swap (this server has little memory)"
  fallocate -l 2G /swapfile || dd if=/dev/zero of=/swapfile bs=1M count=2048
  chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

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
systemctl restart whatsapp-bot

echo "==> waiting for the settings website"
for _ in $(seq 1 30); do [ -s "$DIR/data/panel-password" ] && break; sleep 1; done
IP="$(curl -s -m 3 -H 'Metadata-Flavor: Google' http://metadata.google.internal/computeMetadata/v1/instance/network-interfaces/0/access-configs/0/external-ip || true)"
[ -n "$IP" ] || IP="$(curl -s -m 5 https://api.ipify.org || echo 'כתובת-השרת')"

cat <<DONE

==============================================
 הבוט מותקן ורץ 24/7.

 אתר ההגדרות:  http://$IP
 סיסמה:        $(cat "$DIR/data/panel-password" 2>/dev/null)
 (שם משתמש: כל דבר)
==============================================

באתר: שומרים מפתח Gemini ומספרים, לוחצים "לקבל קוד חיבור"
ומקלידים את הקוד בטלפון של הבוט.

אם האתר לא נפתח: בגוגל קלאוד צריך לאפשר HTTP לשרת
(VM instances > השרת > Edit > Allow HTTP traffic > Save).

שכחת את הסיסמה?  bot password
DONE
