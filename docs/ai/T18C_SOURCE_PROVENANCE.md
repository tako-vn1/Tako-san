# T18C approved source provenance

The owner supplied the original `takosan-redesign-os-v2.0.0.zip` during the
2026-09-21 continuation. This supersedes `REFERENCE_BOARDS_NOT_AVAILABLE` in
the historical baseline and safe-pause records; it does not retroactively
turn their zero direct comparisons into completed comparisons.

- Attachment: `.hoplite/attachments/art_upload_b228825f3a7f46aa9b4bc078d3e91f5c/takosan-redesign-os-v2.0.0.zip`
- Durable byte-identical copy: `.hoplite/artifacts/t18c/approved-source.zip`
- Size: 8,257,059 bytes.
- SHA-256: `cbf5c32dd51ce9f068766cd20591c3cfd8a946ca6632aa2349725f4ef0d6492d`.
- All entries in the supplied `CHECKSUMS.sha256` verified successfully using
  `sha256sum -c CHECKSUMS.sha256` from the extracted root.
- Direct boards: `references/board-01-entry-home-scan.png` (01–09),
  `board-02-food-planner.png` (10–18), and
  `board-03-account-settings.png` (19–27), each 1055 × 1491.
- Per-screen authority: `screens/SCREEN_REGISTRY.json`, all 27 `screens/*.md`,
  and the kit's design-system, responsive, state, motion and QA contracts.

The source README explicitly ranks security/current domain truth first,
tokens/primitives second, per-screen contracts third, responsive/a11y/state
contracts fourth, and schematic boards fifth. Boards communicate composition,
hierarchy and tone; fictional names, dates, counts, expiry, prices and provider
features must not replace real application truth. Supplied SVG assets, not
board crops or recreated logos, are the brand authority. Historical T17
execution/branch directions do not override the current T18C continuation.

## Preserved verification checkpoint

Before source-led edits, the exact `2e770f8` pause tree passed
`PORT=5173 pnpm exec playwright test -c playwright.t18c.config.ts
tests/e2e/t17-ui/t18c-matrix.e2e.ts`: **6 tests, 162 screenshots, 162 strict
axe audits, zero reported violations and overflow**, in 7.9 minutes.
`fixed-tree.zip` preserves this checkpoint separately from final evidence.
Axe incomplete/manual-review results remain recorded in its JSON; zero
violations does not imply complete automated contrast or human AT review.

Original baseline SHA-256 remains
`85aeb27ed3660b1e64bdaa90b933a15f7c7b5bd7a720f757d83c5c7ff610a42a`.
Final certification must report fresh results after any subsequent edits.
