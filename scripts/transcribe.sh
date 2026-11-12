#!/usr/bin/env bash
# Transcribe audio/video with Whisper (ivrit.ai model for Hebrew).
# See scripts/transcribe.py for the options, or run with --help.
set -euo pipefail
. "$(dirname "${BASH_SOURCE[0]}")/env.sh"
exec "$ROOT/.venv/bin/python" "$ROOT/scripts/transcribe.py" "$@"
