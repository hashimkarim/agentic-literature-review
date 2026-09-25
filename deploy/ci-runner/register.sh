#!/bin/bash
set -euo pipefail
if [[ $# != 2 || -e .runner ]]; then
  echo 'Expected repository URL and runner name; existing registration is preserved.' >&2
  exit 1
fi
IFS= read -r ACTIONS_RUNNER_INPUT_TOKEN
export ACTIONS_RUNNER_INPUT_TOKEN
./config.sh --unattended --url "$1" --name "$2" --labels prometheus-ci --work /work
unset ACTIONS_RUNNER_INPUT_TOKEN
