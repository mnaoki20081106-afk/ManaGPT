#!/usr/bin/env bash
set -euo pipefail
# Apply to an explicit checkout/copy only. Abort if the changed files diverged.
target=${1:?Usage: ROLLBACK.sh /absolute/path/to/checkout}
patch_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
git -C "$target" apply --reverse --check "$patch_dir/agent.patch"
git -C "$target" apply --reverse "$patch_dir/agent.patch"
printf '%s\n' 'ROLLBACK: original source restored'
