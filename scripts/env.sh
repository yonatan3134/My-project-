#!/usr/bin/env bash
# Shared environment for every script in this folder.
# Source it:  . "$(dirname "${BASH_SOURCE[0]}")/env.sh"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export ROOT
export PATH="$ROOT/.venv/bin:$PATH"

# Node tools (Remotion, HyperFrames) only go through HTTPS_PROXY when this is
# set. Cloud sessions need it; without a proxy it changes nothing.
export NODE_USE_ENV_PROXY=1

# No usage telemetry from HyperFrames.
export HYPERFRAMES_NO_TELEMETRY=1
export DO_NOT_TRACK=1
