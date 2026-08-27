#!/usr/bin/env bash
set -euo pipefail

if [[ "$(uname -s)" != "Darwin" || "$(uname -m)" != "arm64" ]]; then
  echo "This script must run on Apple Silicon macOS." >&2
  exit 1
fi

core_root="$(cd "$(dirname "$0")/../src-tauri/resources/cores" && pwd)"
identity="${APPLE_SIGNING_IDENTITY:--}"
count=0

while IFS= read -r -d '' core; do
  if [[ "$core" == *.dat || "$(basename "$core")" == ".kingo-platform.json" ]]; then
    continue
  fi
  file "$core" | grep -q "Mach-O 64-bit executable arm64"
  if [[ "$identity" == "-" ]]; then
    codesign --force --sign - "$core"
  else
    codesign --force --options runtime --timestamp --sign "$identity" "$core"
  fi
  codesign --verify --strict --verbose=2 "$core"
  count=$((count + 1))
done < <(find "$core_root" -type f -print0)

if [[ "$count" -ne 10 ]]; then
  echo "Expected 10 Apple Silicon executable cores, signed $count." >&2
  exit 1
fi
echo "Signed and verified $count Apple Silicon core executables."
