# Building a release

From a clean checkout on Apple silicon, run `npm ci`, then `npm test` and
`bash scripts/package-release.sh`. The script builds, ad-hoc signs, and verifies
the macOS app and produces a DMG and SHA-256 checksum in `dist/releases/`.

Publish those two files on a GitHub release tagged for the version in
`src-tauri/tauri.conf.json`. Keep local conversations, preferences, model files,
and credentials out of release artifacts. These builds are not Apple-notarized.
