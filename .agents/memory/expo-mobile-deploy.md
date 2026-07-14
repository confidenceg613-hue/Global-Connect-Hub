---
name: Mobile artifact deploy failures from Expo package drift
description: What to check when the mobile artifact's production build times out ("Metro timeout") during publish.
---

The mobile artifact's production build (`artifacts/mobile/scripts/build.js`) starts Metro in
`--no-dev --minify` mode and polls a health endpoint for 60s before failing with "Metro timeout".
If publish fails with `ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL @workspace/mobile ... build` preceded by
a Metro timeout, suspect Expo native-module/SDK version drift before anything else.

**Why:** one incident had `expo-location` resolved to `57.0.1` (an SDK numbering far past the
installed `expo@~53` project) while code was written against the stable ~18.x API — Metro couldn't
build a valid production bundle within the health-check window. `expo-sqlite`,
`expo-build-properties`, and `typescript` had also drifted from `expo install --check`'s expected
versions.

**How to apply:** run `pnpm exec expo install --check` (or `--fix`) in `artifacts/mobile` whenever
the mobile production build times out or a mobile-related project task mentions "mismatched Expo
package versions". After fixing, verify with `pnpm --filter @workspace/mobile run build` directly
in the shell (not just via publish) — a full successful run downloads iOS+Android bundles and ends
with "Build complete!". Then restart the `artifacts/mobile: expo` dev workflow to confirm the same
shared node_modules still serves dev correctly.
