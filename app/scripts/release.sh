#!/usr/bin/env bash
set -u
script_dir=$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd) || exit 3
for python in python3 python; do
  if command -v "$python" >/dev/null 2>&1 && "$python" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 11) else 1)' >/dev/null 2>&1; then
    exec "$python" "$script_dir/release.py" "$@"
  fi
done
printf '%s\n' 'Python 3.11+ is required. Install Python and add it to PATH.' >&2
exit 3
