#!/bin/zsh
# Build SpecDrive and (re)install it into /Applications, then relaunch.
set -e
cd "$(dirname "$0")/.."
echo "Building SpecDrive…"
# Sign + notarize when the private credentials exist (never committed).
if [ -f "$HOME/.specdrive-signing.env" ]; then
  source "$HOME/.specdrive-signing.env"
  unset CSC_LINK CSC_KEY_PASSWORD
  export CSC_NAME="${CSC_NAME:-Connected Mate (523L8BHNF8)}"
fi
npm run dist >/dev/null
echo "Installing to /Applications…"
osascript -e 'quit app "SpecDrive"' 2>/dev/null || true
sleep 1
ditto dist/mac-arm64/SpecDrive.app /Applications/SpecDrive.app
open -a SpecDrive
echo "Done — SpecDrive updated and relaunched."
