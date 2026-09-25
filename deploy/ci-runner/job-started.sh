#!/bin/bash
set -euo pipefail
exec /usr/local/bin/bun "${0%/*}/job-started.ts"
