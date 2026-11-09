#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
version=$(node -p "require('./src-tauri/tauri.conf.json').version")
app=src-tauri/target/release/bundle/macos/LocalForge.app
if [[ ${1:-} != --skip-build ]]; then npm run bundle; fi
test "$(lipo -archs "$app/Contents/MacOS/localforge")" = arm64
test "$(plutil -extract CFBundleShortVersionString raw "$app/Contents/Info.plist")" = "$version"
out="$PWD/dist/releases"
mkdir -p "$out"
stage=$(mktemp -d)
trap 'rm -rf "$stage"' EXIT
ditto "$app" "$stage/LocalForge.app"
codesign --force --sign - "$stage/LocalForge.app"
codesign --verify --strict "$stage/LocalForge.app"
ln -s /Applications "$stage/Applications"
name="LocalForge-${version}-macOS-arm64.dmg"
hdiutil create -ov -volname LocalForge -srcfolder "$stage" -format UDZO "$out/$name"
hdiutil verify "$out/$name"
(cd "$out" && shasum -a 256 "$name" > SHA256SUMS.txt && shasum -a 256 -c SHA256SUMS.txt)
