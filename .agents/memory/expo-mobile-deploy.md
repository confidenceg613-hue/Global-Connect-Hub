---
name: Mobile artifact deploy failures from Expo package drift
description: What to check when the mobile artifact's production build times out ("Metro timeout") during publish, and a deeper phantom-dependency pitfall behind the same symptom.
---

The mobile artifact's production build (`artifacts/mobile/scripts/build.js`) starts Metro in
`--no-dev --minify` mode and polls a health endpoint for 60s before failing with "Metro timeout".
This generic message can mask two very different root causes — always pull the *actual* deployment
build logs (`listDeploymentBuilds` + `getDeploymentBuild`, tail the logs) before diagnosing; do not
infer the cause solely from `expo install --check` output or a local `pnpm run build` that happens
to succeed, since dev-container node_modules can mask bugs a clean install exposes (see below).

**Cause 1 — Expo native-module/SDK version drift.** `expo-location`/`expo-sqlite`/
`expo-build-properties`/`typescript` resolved to versions that don't match the installed `expo` SDK
(e.g. `expo-location@57.0.1` against `expo@~53`). Fix: `pnpm exec expo install --fix` in
`artifacts/mobile`.

**Cause 2 — phantom dependency (`Cannot find module '@babel/template'`) in a *clean* install.**
`@expo/metro-config`'s `collect-dependencies.js` requires `@babel/template` without declaring it as
a direct dependency. In a long-lived dev container, pnpm's internal hoist folder
(`node_modules/.pnpm/node_modules`) often has a stale/leftover symlink for it from earlier installs,
so a local `pnpm run build` succeeds and hides the bug. Replit's deploy build does a byte-for-byte
fresh `pnpm install` from the lockfile with no such history, so the phantom require fails there even
though it works locally — the deploy logs showed this same "Cannot find module '@babel/template'"
error on builds *before* the version-drift fix too, proving the two causes are independent.

**Why it matters:** a build that succeeds locally is not proof the deploy build will succeed — only
a clean install reproduces what the deployer does.

**How to apply:**
1. Always fetch real deploy build logs first (`listDeploymentBuilds` → `getDeploymentBuild`, tail
   ~80-100 lines) rather than assuming the cause from local symptoms.
2. To truly reproduce, wipe and reinstall: `rm -rf node_modules artifacts/*/node_modules && pnpm
   install --frozen-lockfile`, then `pnpm --filter @workspace/mobile run build` — a real pass ends
   with "Build complete!" and downloads both iOS and Android bundles.
3. Fix for the phantom-dependency case: add `public-hoist-pattern[]=@babel/template` to the repo's
   root `.npmrc` so pnpm always hoists it to the top-level `node_modules/` (an ancestor of every
   `.pnpm/*` package's own require path), regardless of install history/order.
4. After any node_modules-affecting fix, restart all workflows (mobile, app, api-server, and any
   others sharing the workspace's `node_modules`) to confirm dev still works.
