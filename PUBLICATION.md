# Public snapshot validation

Prepared 2026-11-18 as an independent source snapshot. No private repository history is included. Original source repository was not modified.

## Cleanup

- Omitted three historical playback/performance reports and the account-specific live diagnostic containing private playlist assumptions.
- Replaced six commercial album-cover fixtures with original abstract SVGs and fictional design-preview recordings. Updated artwork test references.
- Replaced desktop/tray icons, browser favicon and inline app/service marks with original or neutral artwork.
- Named the independent build Opal Music Desktop with its own app identity. First-party service URLs and provider labels remain functional.
- Added explicit unofficial status, source-only availability, macOS scope, and no-notarization disclosure.
- No project license was selected on the owner's behalf. This is not a claim that the project is open-source licensed. Third-party dependencies retain their licenses; no dependency directories are distributed in this snapshot.

## Validation performed

On Windows with Node 24.14.1: npm ci --ignore-scripts completed; npm run build:ui completed. Bundler emitted existing dependency directive and chunk-size warnings.

Full Node test suite: 262 tests, 252 passed, 7 failed, 3 skipped. Five failures report inability to open the private Chrome sign-in fixture; another reports Windows symlink EPERM, and another expects POSIX mode 0600 but sees Windows mode 0666. Tests were not weakened or removed to hide these failures. This is not a passing full-platform test claim.

Native macOS compilation, app packaging, ICNS acceptance by Apple tooling, sign-in, live playback, and desktop UI behavior have not been validated for this snapshot. A supported Mac is required before representing it as a tested downloadable release. This snapshot is source code for review and developer experimentation, not a production-ready installer.

No account credentials, cookies, browser profile, listening export, built application, dependencies, or git history are intentionally included. Pattern scanning reduces risk but cannot prove absolute absence of secrets or establish all third-party rights.
