#!/usr/bin/env bash
# Cut silent pauses out of a talking video. See scripts/jumpcut.py or --help.
set -euo pipefail
. "$(dirname "${BASH_SOURCE[0]}")/env.sh"
exec "$ROOT/.venv/bin/python" "$ROOT/scripts/jumpcut.py" "$@"
