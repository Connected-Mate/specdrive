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
# electron-builder names the folder after the arch it just built
# (dist/mac-universal today, dist/mac-arm64 before the universal switch), so
# take the NEWEST app it actually produced instead of a hardcoded path — a
# stale folder silently reinstalling an old build is worse than no install.
BUILT=$(ls -dt dist/mac*/SpecDrive.app 2>/dev/null | head -1)
if [ -z "$BUILT" ]; then
  echo "No built app found under dist/ — nothing installed." >&2
  exit 1
fi
echo "Using $BUILT"
osascript -e 'quit app "SpecDrive"' 2>/dev/null || true
sleep 1
# ditto overwrites the installed copy in place. Keeping a spare copy of a 1.2 GB
# app on every install is what fills the disk, so the DMG in dist/ is the
# rollback, not a second bundle in /Applications or the Trash.
ditto "$BUILT" /Applications/SpecDrive.app
open -a SpecDrive
echo "Done — SpecDrive updated and relaunched."
