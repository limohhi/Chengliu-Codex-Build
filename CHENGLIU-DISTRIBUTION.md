# Chengliu Codex++ distribution

This is a branded distribution of Codex++ with the Chengliu API provider preset.
The upstream project is licensed under AGPL-3.0-only; this distribution keeps
that license and the upstream copyright notices. If binaries are distributed,
provide the corresponding modified source and build instructions under AGPL-3.0.

## Build artifacts

Run the `Chengliu desktop builds` GitHub Actions workflow manually. It builds
Windows x64 NSIS and macOS app bundles and uploads them as workflow artifacts.
The macOS artifact is unsigned unless a signing and notarization pipeline is
configured; Gatekeeper may block it. Do not present it as a public release.

The app uses bundle identifier `top.chengliu.codexplusplus`, distinct from the
upstream Codex++ identifier, and the provider preset points to
`https://api.chengliu-api.top/v1` using the Responses protocol.
