#!/usr/bin/env bash
set -euo pipefail
target=${1:?Usage: ROLLBACK.sh /absolute/path/to/checkout}
patch_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
git -C "$target" apply --reverse --check "$patch_dir/accuracy.patch"
git -C "$target" apply --reverse "$patch_dir/accuracy.patch"
printf '%s\n' 'ROLLBACK: original source restored'
