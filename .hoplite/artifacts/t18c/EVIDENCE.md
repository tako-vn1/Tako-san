# T18C evidence index

Final application freeze: `6f8f6f40bb2c47dacd33670ac7397b0528b469a8`.
Repository: ID `1368281478`, `vn-tako/Frigo-dev`.
Branch: `feat/t18c-final-redesign-certification`; base: `b8447e85`.

All captures use isolated local Preview and synthetic fixtures. No private
customer media, real account data, provider transactions or production claims.
Final evidence is separate from the immutable baseline, approved source and
failed/interrupted attempts. Full report: `docs/ai/T18C_VISUAL_CERTIFICATION.md`.

## Final result and contents

- **27/27** directly board/contract-compared at six widths:
  **2 PASS / 25 PASS_WITH_DOCUMENTED_DIFFERENCE**, no unresolved P0/P1/P2.
- **390 unique browser cases: 379 PASS / 11 intentional skips.** Three outer
  40-minute wrappers ended with 385 receipts; five exact recovery cases passed.
  This is complete accounted coverage, not one uninterrupted green runner exit.
- **162 canonical screenshots**, zero strict axe violations/overflow;
  **449 regression screenshot files**. Axe incomplete records are retained.
- Final repository gates: lint/typecheck, **184 files / 4222 tests**,
  migration smoke, build, style **39/0**, contrast **33/33**, diff checks PASS.
- Human VoiceOver/NVDA: **NOT PERFORMED**.

`final-matrix.zip` contains canonical screenshots, registry/accessibility JSON,
all three six-width visual reports and contact sheets, `reports/commands.md`,
`case-manifest.json`, `case-receipts.json`, `summary.json`, the completeness
validator, and final serial repository logs. `final-shard-{a,b,c}.zip` and
`final-recovery.zip` retain original browser logs/reports/results without
discarding outer-timeout receipts. `home-responsive.png` is a current,
shareable mobile/desktop comparison; it is also inside the final archive.

Historical evidence: `pre-zoom-matrix.zip` and `pre-zoom-regressions.zip`
preserve the **378/11/1** Home 200%-text failure at `b024b0d`, explicitly not
final. `zoom-followup.zip` retains the fix's **12/12** focused proof.
`resource-contention.zip` retains the interrupted concurrent Vitest attempt;
the serial final `test.log` passes without timeout/coverage changes.
Earlier baseline/fixed-tree/diagnostic archives remain unchanged in this folder.

## Restore and verify

From the repository root, extract the five `final-*.zip` files listed below
into `.hoplite/artifacts/t18c/`. They contain paths rooted at `final/`.
Then execute:

```sh
python3 .hoplite/artifacts/t18c/final/reports/summarize-evidence.py
```

The validator rejects missing/duplicate/unexpected cases, non-allowlisted
skips, incomplete 27-screen sets, strict axe violations or horizontal overflow.
Exact browser, recovery and repository commands are in `final/reports/commands.md`.
All listed ZIP members passed CRC/integrity validation; all are below 100 MiB.
An independent temporary-directory restore of all five final archives also
reproduced `summary.json` exactly using the archived validator. All indexed
byte counts and SHA-256 values were checked against the files before commit.

## Bytes and SHA-256

| Archive | Bytes | SHA-256 |
|---|---:|---|
| `baseline.zip` | 26,580,172 | `85aeb27ed3660b1e64bdaa90b933a15f7c7b5bd7a720f757d83c5c7ff610a42a` |
| `approved-source.zip` | 8,257,059 | `cbf5c32dd51ce9f068766cd20591c3cfd8a946ca6632aa2349725f4ef0d6492d` |
| `pre-zoom-matrix.zip` | 30,401,634 | `ca29ff5187f8ef77b63fe0fb50d0c8288736407a7e33b0dea9beb05d43a75d67` |
| `pre-zoom-regressions.zip` | 52,611,203 | `978ebf3e6bd11ec9aef8aedd5150519fc277505190d0c765bff6072c578840e4` |
| `resource-contention.zip` | 17,537 | `c1f1cf18c2a23aadb8e9914242720ee4f3ad296daa5078fb904d2a38ff1fd4ca` |
| `final-matrix.zip` | 52,281,172 | `bf20d80f9c88afa5e4980490c8a68398716531a42418f3dc2297c60a46356410` |
| `final-shard-a.zip` | 28,697,869 | `d219a4ad7f5ef88b6322535e5487f4753ebeb07f43d63abe3204ff985ed151fa` |
| `final-shard-b.zip` | 30,448,749 | `04a68b13c64f4947d1c1339539c2790326c58f7df64bf74f41f86b3ff4fd6f22` |
| `final-shard-c.zip` | 40,591,010 | `7958de45c887ba7e7668d70aeb43ff64db518d35d514b415a715f648f2769654` |
| `final-recovery.zip` | 9,732,671 | `def76c075cd084010b1d8a8b455202b6e46855f32068ec63241baf6fcca9e737` |
