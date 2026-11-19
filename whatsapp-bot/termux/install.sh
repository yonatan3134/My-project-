#!/data/data/com.termux/files/usr/bin/bash
# Installs (or updates) the bot on an Android phone inside Termux, and starts it.
#   pkg install -y git && git clone https://github.com/yonatan3134/My-project-.git ~/bot && bash ~/bot/whatsapp-bot/termux/install.sh
# To update later: bash ~/bot/whatsapp-bot/termux/install.sh
set -e
DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$DIR"
say() { printf '\n\033[1;36m==> %s\033[0m\n' "$1"; }

say "Updating the code"
git -C "$DIR" pull --ff-only || echo "(could not update from GitHub, using the code already here)"

say "Installing Node.js, ffmpeg and git"
pkg update -y || true
pkg install -y nodejs-lts ffmpeg git || pkg install -y nodejs ffmpeg git
ok=$(node -p 'const [a,b]=process.versions.node.split(".").map(Number); a>22||(a===22&&b>=13)?1:0')
if [ "$ok" != "1" ]; then
  echo "Node.js $(node -v) is too old, installing the current version"
  pkg uninstall -y nodejs-lts || true
  pkg install -y nodejs
fi
echo "Node.js $(node -v)"

say "Installing libraries (a few minutes)"
npm ci --no-audit --no-fund
# the phone version of the picture library (it draws pictures but not text: text goes into the caption)
npm install --no-save --no-audit --no-fund --force "@img/sharp-wasm32@$(node -p 'require("sharp/package.json").version')" || echo "pictures will not be available on this phone"
npm run build
[ -f .env ] || cp .env.example .env

say "Start with the phone"
mkdir -p "$HOME/.termux/boot"
cat > "$HOME/.termux/boot/whatsapp-bot.sh" <<BOOT
#!/data/data/com.termux/files/usr/bin/bash
termux-wake-lock
bash "$DIR/termux/start.sh"
BOOT
chmod +x "$HOME/.termux/boot/whatsapp-bot.sh" termux/*.sh

say "Starting the bot"
bash termux/stop.sh >/dev/null 2>&1 || true
bash termux/start.sh
for i in $(seq 1 60); do [ -s data/panel-password ] && break; sleep 1; done

cat <<DONE

==============================================
 The bot is running.
 Settings page: http://localhost:8080  (open it in the phone's browser)
==============================================
Keep Termux open in the background (do not type "exit").
In Android settings, turn off battery optimisation for Termux.
To start with the phone, install the "Termux:Boot" app from F-Droid and open it once.
Stop: bash $DIR/termux/stop.sh   Start: bash $DIR/termux/start.sh
DONE
