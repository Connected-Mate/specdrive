#!/bin/zsh
# Build SpecDrive and (re)install it into /Applications, then relaunch.
set -e
cd "$(dirname "$0")/.."
echo "Building SpecDrive…"
npm run dist >/dev/null
echo "Installing to /Applications…"
osascript -e 'quit app "SpecDrive"' 2>/dev/null || true
sleep 1
ditto dist/mac-arm64/SpecDrive.app /Applications/SpecDrive.app
open -a SpecDrive
echo "Done — SpecDrive updated and relaunched."
