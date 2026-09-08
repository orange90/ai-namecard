<p align="right">
  <a href="CHANGELOG.zh_CN.md">简体中文</a> · <strong>English</strong>
</p>

# Changelog

## Unreleased

- Replaced the Zhihu card's `Today interactions` metric with an instruction to
  press OK to view the profile QR code.

- Replaced the FoloCard Codex, Zhihu, and Xiaohongshu page marks with the
  supplied official brand icons.

- Corrected the Codex weekly summary to read `Weekly active: N days`, removing
  the unsupported middle-dot glyph from the device display.

- FoloCard 0.5.0 moves confirmed BLE synchronization into the installed native component, removing the extension's loopback fetch and startup-code field. The macOS installer copies its Python runtime out of privacy-protected project folders so Brave can launch it reliably. The Codex summary now shows a single-line weekly active-day count, omits the misleading `84 DAYS`, prompts for synchronization when history is absent, and logs the displayed summary over serial. Profile text is canonicalized to the firmware wire contract, and transactional card saves reclaim the inactive NVS slot before writing so a near-8 KiB update does not require space for three cards. Documents the passive NTAG213 limitation for screen-dependent NFC.

- Removed the FoloCard editing section, including manual profile fields, JSON editing, and demo data. Collected cards now feed preview and confirmed device synchronization directly.

- Fixed Zhihu and Xiaohongshu avatar collection by filtering lazy-load placeholders, retrying trusted CDN candidates, and checking the declared wildcard host permission. The device preview now renders the exact RGB565 avatar stored in the card.

- FoloCard 0.4.0 adds a one-time native host installer and browser-triggered daily Token reading without a startup code. Fixes Codex's migrated cloud analytics URL and plain-text quota reset dates; arbitrary redirects remain blocked.

- FoloCard 0.3.0 adds native Codex daily-token scanning through its own loopback bridge, without CodexBar or its CLI. Shows daily totals and a heatmap independently of browser quotas, preserves previous daily data on failure, and labels incomplete fork/interleaved history. Token-only bridge operation requires no BLE device.

- FoloCard 0.2.2 declares site, avatar CDN, and local bridge access at installation and removes additional permission requests during collection and synchronization.

- Added CodexBar-informed Codex usage API collection with browser-session authentication, separate primary/secondary quota and credit-balance previews, dashboard fallback, and confirmed-login/rate-limit handling. Corrected reset timestamps to the device's second-precision wire format.

- Changed FoloCard collection to one-click discovery of the signed-in Codex, Zhihu, and Xiaohongshu accounts across browser tabs. Each site has separate progress and login/verification guidance; background collection persists partial successes and updates the device preview without automatically synchronizing.

- Added an interactive 240 × 320 FoloToy screen preview to the FoloCard extension. It mirrors the Codex activity/usage and Zhihu/Xiaohongshu card layouts, including the device page and OK-detail interactions.

- Fixed FoloCard profile extraction for Zhihu subpages and achievement labels, nested Xiaohongshu counters, and Codex remaining quotas with relative reset times. Standalone extension pages retain their source tab; extraction saves locally and avatar failures no longer discard profile updates.

- Added FoloCard offline cards with branded Codex, Zhihu, and Xiaohongshu dashboards, explicit encrypted BLE synchronization, local avatar conversion, an editable browser extension, and a macOS loopback bridge.

- Added the supplied 80-byte CW2017 profile for the specified 520 mAh cell, including content/update-flag checks, verified writes, the required restart sequence, and bounded SOC-readiness polling.

- Reorganized the documentation by function area with a dual entry point: the root `AGENTS.md` is now a thin router (hard constraints + task routing only) and the detailed AI workflow lives in `docs/development/ai-guide.md`; `agent-guide.md` was folded in. `docs/development/` gained a second level (`engineering/`, `ci/`, `release/`), and the `plays/` application archive and `experiences/` moved into a `docs/reference/` area with a dedicated README. Removed `docs/software-design/` (empty scaffold); folded the three `assets/{fonts,images,music}/README` leaves into the `assets/` README; flattened the six `project-completion` sub-documents into a single file; and unified each directory to a single README, eliminating every `INDEX` file and a duplicated experience index. All cross-references and bibliographic links were updated; no content was dropped.

- Made mini-program BLE install compatibility a template-level invariant: fixed
  protected `cardid`/Recovery partitions, retained the five-second UP-key
  Recovery boot hook, and added CI validation for merged-image structure,
  partition MD5/ranges, the 3 MB app limit, and protected payload exclusion.
- Documented a release-title convention for multi-app releases: name tags as `v<version>-<app-name>` (e.g. `v0.1.0-voice-keychain`) so the release title carries the version and the app, and confirm the title after the release is published so a release list is scannable by app.
- Added a post-release follow-up workflow: an `issue-suggestions` skill for filing user feedback as issues against the upstream project, an `experience-pr` skill for submitting reusable development experience as a documentation PR, a `docs/experiences/` directory for per-entry experience files, and supporting `project-completion`, `file-issues`, and experience-index documents.
- Simplified the tracked repository root: moved GitHub-recognized community documents into `.github/`, moved the changelog into `docs/`, updated every reference, and added a root-document allowlist to repository checks.
- Repository-wide language policy: every maintained Markdown default `.md` file is English, Simplified Chinese uses a paired `.zh_CN.md`, and both provide language switches. Static checks reject missing peers, missing switches, and Chinese prose in English defaults.
- Phase one of the AI development workflow: streamlined task-based context routing, unified local/CI validation, added PR checks and a template, and committed the dependency lock for reproducible builds.
- PR review fixes: pinned GitHub Actions to full commit SHAs, split build/release jobs by least privilege, disabled persisted sync checkout credentials, added Feature Request and Usage Question forms, clarified private security-report fallback, and corrected stale README, CI-trigger, and branch descriptions.
- Changed commit titles, PR titles, and PR bodies from Chinese-default to English; updated the Chinese punctuation rule so it no longer applies to PR descriptions.
- Reworked `build-firmware.yml` to pass `SDKCONFIG_DEFAULTS=sdkconfig.defaults`, enable `partitions.csv`, preserve the 8 MB image header, merge a flashable `FoloToy-AI-Passport-full.bin`, publish only that artifact, and use Actions cache v5.
- Integrated upstream PR #6 to resolve PR #4 conflicts: Wi-Fi, Bluetooth LE, radio lifecycle, and low-power demos; a 3 MB factory partition; build/menu/configuration updates; hardware-guide coverage; and bilingual capability tables.
- Defined English imperative Conventional Commit formatting for both commits and PR titles.
- Removed stale sync-workflow template comments and generalized an irrelevant Redis TTL rule to cache components.
- Added Chinese punctuation, credential safety, and recoverable file-deletion conventions.
- Expanded source-comment requirements for functions, state, ownership, concurrency, timing, registers, and magic values.
- Removed AI execution instructions from product READMEs so they remain human-facing product and repository overviews.
- Added `docs/development/agent-guide.md` as the focused AI workflow guide.
- Updated `AGENTS.md`, `docs/INDEX.md`, and the development index for the agent guide.
- Documented why the root README path is reserved for fork owners and how GitHub README precedence supports it.
- Created `main-update` from the upstream-aligned baseline and combined the repository-structure, firmware-CI, and upstream-sync work.
- Corrected the merged documentation index, workflow path, project tree, and CI references.
- Moved CI documentation from software design to `docs/development/`.
- Moved fork-only documentation assets from `assets/docs/` to `docs/assets/`.
- Moved the upstream English/Chinese project READMEs under `docs/` and renamed the documentation catalog to `docs/INDEX.md`.
- Initialized `AGENTS.md`, `CLAUDE.md`, and `CHANGELOG.md`.
- Standardized the initial project README language filenames.
- Added the `docs/`, `assets/`, and `skills/` directory structure.
- Moved the upstream hardware guide into `docs/hardware-design/`.
- Standardized subdirectory README capitalization and introduced fork conventions.
- Allowed fork-owned root README and supplemental documentation content on fork `main`.
- Added and documented the fork-only supplemental-document directory.
- Moved the build CI document to its dedicated CI branch before consolidation.
- Documented clean-`main` reasons, the direct-development exception, and Actions enablement for forks.
- Split the original agent rules into contribution, development, and fork documents with a compact root index.
- Updated software-design and project README references for the new documentation structure.
- Added the documentation catalog and task-triggered routing based on the earlier repository model.
- Added bilingual contribution, code-of-conduct, security, and support documents tailored to this ESP-IDF and fork workflow.
