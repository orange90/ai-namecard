[简体中文](folocard.zh_CN.md) · **English**

# FoloCard MVP

FoloCard replaces the demo launcher with three offline cards: a black Codex
activity dashboard with a green heatmap, a blue Zhihu profile, and a red
Xiaohongshu profile. UP/DOWN cycles the cards, OK toggles details, double OK
opens sync settings, and long OK returns to the main card and cancels sync.
Chinese labels use LVGL's bundled Source Han Sans subset; uncommon glyphs
outside that subset require a custom font.

## Install the desktop tools

The extension is an unpacked Manifest V3 application under
[`tools/folocard/extension`](../../tools/folocard/extension/manifest.json).
Open Chrome's extension manager, enable Developer mode, choose **Load unpacked**,
and select that directory. Copy its extension ID. Open the toolbar popup or use
**Open standalone page** for a larger preview. Both work independently of the
active tab. Collection runs in the extension worker and continues when the popup closes. Reload the extension
in the browser extension manager after updating these files.
Site access, avatar CDN access, and native messaging are declared as required
permissions at installation. The browser may ask for confirmation when
installing or upgrading; collection and synchronization do not request additional
permissions. If site access is restricted manually, allow it in the extension
manager before retrying.
The extension uses dependency-free JavaScript instead of the draft's optional
React/Vite stack. There is no build step, scheduled scraper, or cloud account.

From the repository root:

```bash
python3 -m venv .local-tools/folocard-venv
.local-tools/folocard-venv/bin/pip install -r tools/folocard/requirements.txt
.local-tools/folocard-venv/bin/python tools/folocard/install_native.py \
  --extension-id CHROME_EXTENSION_ID
```

On the device, double-click OK, then click OK to enable synchronization for
three minutes. Click the extension's sync button while it is waiting; the native
component scans for the nearest advertising FoloCard and performs the transfer.
The first authenticated BLE read triggers the macOS pairing dialog; enter the
six-digit PIN shown on the device in that system dialog, not in the extension.
macOS and the ESP32 retain the bond. The native component never reads the pairing
keys. Cancel using OK or long OK; the worker disconnects and releases the NimBLE stack.

## Preview and synchronize

Click **Read data**. The
extension uses the signed-in accounts in its current browser profile, searches
the three sites' open tabs, and opens missing account pages in inactive tabs.
Zhihu's current-user response and Xiaohongshu's Me navigation entry establish
account ownership; an arbitrary visible public profile is never used as identity.
Codex first reads the dashboard's usage API using the existing browser session,
then opens the usage page if the API is unavailable. Each site reports its own result.
An explicitly logged-out site offers **Log in**; sign in on that site and click
**Read data again**. Network errors, site verification, and missing
page data offer **Open to check** rather than claiming that the user is logged out.
Successful sites save independently while unsuccessful sites preserve old data.
Existing user tabs are not navigated or closed. Temporary tabs are closed only
when still inactive and untouched; failed pages remain available to inspect.

Inspect the resulting local preview, check the confirmation box, then
synchronize. Avatar failures do not discard text updates. Fields absent
from a social adapter preserve existing metric values only for the same profile URL. A changed/unrecognized
page fails visibly and leaves the previous card intact. Collected cards are used
directly for preview and confirmed synchronization.

The extension's device preview renders the FoloToy 240 × 320 screen using the
same three pages and detail state as the firmware, including the exact RGB565
avatar embedded in the card. Use its UP/DOWN controls to switch pages and OK
(or click the screen) to inspect the matching detail view.

Adapters recognize visible ISO dates with explicit activity levels and labeled
Codex usage values. Browser quota and native daily tokens have independent
collection states. A successful native scan replaces daily history after browser
collection completes; a failed native scan preserves the previous daily values.
Native history is scoped to the configured local Codex home, not the browser account.
The Zhihu adapter reads the public member API plus the creator
homepage and realtime daily/aggregate endpoints used by zhihu-copilot, only
after the user clicks the read button on their account landing page or creator center.
Public profile subpages are supported; creator statistics are never attached to another profile. It derives today's interactions from
comments plus favorites when those fields are present. Xiaohongshu uses visible
public metrics. Synthetic HTML fixtures test these adapters; they do not
establish compatibility with every live website revision. Abbreviated social
metrics such as `12K` are expanded for preview and can be approximate. Confirm
them before sending. Allowed CDN avatars are center-cropped to a 24 x 24 RGB565
image locally and embedded in the card; the original image URL is not stored.

Missing tokens remain unknown. The grid uses 84 calendar dates ending on the
snapshot date, with missing dates outlined. This week's count means recorded
nonzero activity days in the Monday-based week of the snapshot, not a token sum.
A stale offline snapshot does not imply current-day activity. Quota is separately
labeled and never converted into tokens.

### Automatic native daily Token usage and BLE synchronization (0.5.0)

No CodexBar installation or CLI is required. The bridge includes an independent
Python standard-library scanner, informed by the counter accounting in
[CodexBar's scanner](https://github.com/steipete/CodexBar/blob/170a4d41c6d69e2bb25daac4fb088a92de2f9bc4/Sources/CodexBarCore/Vendored/CostUsage/CostUsageScanner.swift).
Browser extensions cannot directly access local session files. Install the
included native component once from the repository, then reload the extension:

```bash
python3 -m venv .local-tools/folocard-venv
.local-tools/folocard-venv/bin/pip install -r tools/folocard/requirements.txt
.local-tools/folocard-venv/bin/python tools/folocard/install_native.py \
  --extension-id CHROME_EXTENSION_ID
# Optional: --browser brave (repeat for chrome, edge, or chromium)
# Optional: --codex-home /absolute/path/to/codex-home
```

Python 3.10+ is sufficient. The installer supports macOS and Linux and defaults
to registering Chrome and Brave; Windows packaging is not included. The extension
shows a copyable install command with its own ID. Re-run it after updating the
native component or changing extension ID. This is a one-time user-level native
application registration, not something an extension can silently install itself.
On macOS, Brave deliberately uses Chrome's native-host directory; the installer
follows [Brave's startup implementation](https://github.com/brave/brave-core/blob/master/app/brave_main_delegate.cc),
not the location of the Brave profile. The origin allowlist is unchanged.

On each read or device sync, `runtime.connectNative` lets the browser launch
`com.folotoy.folocard`, complete one request, and disconnect. No terminal,
startup code, HTTP listener, login item, or CodexBar is required. The host accepts
only `{type: "codex-usage"}` or a validated `{type: "sync-device", card: ...}`
request, and only from the installed extension origin.
See the [browser native messaging contract](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging).
The installer copies the host and scanner into the user's FoloCard support
directory and writes an origin-restricted browser manifest. On macOS it also
copies the prepared Python environment there, because a browser-launched native
host may be denied access to a virtual environment under a privacy-protected
project folder such as Documents. No credentials are stored.

- Reads `sessions/**/*.jsonl` and `archived_sessions/**/*.jsonl` beneath
  `--codex-home`, `$CODEX_HOME`, or `~/.codex`, in that priority order. No
  `auth.json`, browser cookies, CodexBar cache, shell subprocess, or network is used.
- Keeps only session identifiers, timestamps and numeric counters in memory.
  Appended files resume at the last complete line; truncated files are rescanned.
  Only daily totals and coverage status cross the origin-restricted native pipe.
- Attributes each `event_msg/token_count` increment to the event's local date;
  deduplicates repeated counters and archived session copies. Cached input is
  included in input tokens and reasoning in output, never added twice.
- Subtracts resolved fork-parent baselines. Unresolved forks and ambiguous
  regressing/interleaved counters produce a **partial statistics** label, with
  conservative containment rather than replaying inherited usage. This native
  scanner does not implement CodexBar's full multi-provider pricing engine or
  pi/OMP history ingestion; cloud-only sessions are unavailable locally.
- Shows up to 84 recorded dates, today's value when recorded, a daily table and
  heatmap. Missing dates stay unknown. Grid intensities are relative to the
  largest recorded day. The device receives dated tokens using its existing
  version-1 fields and displays the latest recorded date in its detail view.
  The multi-day sum is not sent as a billing-period total. The legacy wire source
  remains `usage-ui`; provenance is explicit in `collection.localCodex`.
- Browser login failures do not block native Token collection. The local history
  can span different accounts used on this computer and is labeled separately
  from the browser account's quota.

### Codex usage source

The browser implementation follows the cookie-authenticated API path and field
semantics in [CodexBar's dashboard fetcher](https://github.com/steipete/CodexBar/blob/170a4d41c6d69e2bb25daac4fb088a92de2f9bc4/Sources/CodexBarCore/OpenAIWeb/OpenAIDashboardFetcher.swift)
and [usage response model](https://github.com/steipete/CodexBar/blob/170a4d41c6d69e2bb25daac4fb088a92de2f9bc4/Sources/CodexBarCore/Providers/Codex/CodexOAuth/CodexOAuthUsageFetcher.swift).
CodexBar is MIT-licensed by Peter Steinberger. The reviewed revision is
`170a4d41c6d69e2bb25daac4fb088a92de2f9bc4`.

- The tab requests `GET /backend-api/wham/usage` with its browser session.
  Only validated usage fields return to the extension; account identifiers,
  cookie values, tokens, and raw responses are not stored or sent to the bridge.
- Primary and secondary windows are shown separately with used/remaining
  percentages, their reported duration, and reset times. Credits balance is
  remaining credit, not consumed credit or token usage.
- A usage HTTP 401 is checked against `/api/auth/session` before asking the
  user to log in. Forbidden, malformed, and network responses fall back to the
  dashboard parser. A 429 asks the user to retry later without polling again.
- The version-1 device card still holds one quota: primary with a valid reset,
  otherwise secondary with a valid reset. Both windows and credit balance live
  in the browser's separate collection summary. Browser-only readings preserve
  the existing device card, and the status message says so. Reset timestamps
  sent to the device use seconds, without a fractional part.
- This is a website backend endpoint, not a public API contract. Synthetic
  browser tests cover its response shapes; live session compatibility still
  depends on ChatGPT's current authentication and service behavior.
- The dashboard adapter accepts the legacy `/codex/settings/usage` and the
  migrated `/codex/cloud/settings/usage` and `/codex/cloud/settings/analytics`
  routes (including `#usage`). Only these same-origin aliases may follow a
  redirect; arbitrary pages remain rejected. Plain-text absolute reset dates in
  the analytics Balance panel are supported alongside `<time>` and relative dates.

## Wire contract and storage

- JSON version 1; maximum UTF-8 size 8192 bytes. Unknown and duplicate fields,
  invalid dates, unordered days, invalid numbers, and private/query-bearing
  profile links are rejected. Maximum JSON nesting is eight levels.
- Service UUID: `fc010000-4643-0080-464f-435500000001`.
- Write UUID: `fc010000-4643-0080-464f-435500000002`.
- Read acknowledgement UUID: `fc010000-4643-0080-464f-435500000003`.
- All characteristics require an encrypted, authenticated, bonded connection.
- BEGIN: byte `1`, little-endian uint32 length, little-endian uint32 CRC32.
- DATA: byte `2`, little-endian uint16 offset, then 1–241 payload bytes.
- COMMIT: byte `3`. Every new attempt starts with BEGIN. The bridge uses
  17-byte payloads to support the minimum ATT MTU.
- Acknowledgement: `{version, checksum, status, offset, revision}`. Status `1`
  means accepted progress, `2` means committed, and `-1` means rejected. Revision
  is a session counter, not a persistent monotonically increasing identifier.
- Data is staged in RAM, parsed, committed to the inactive NVS blob, then made
  active with a committed selector. Invalid/incomplete messages do not publish.
  Storage-full failures are reported without erasing NVS. Namespaces other than
  `folocard` are never erased.
- The normal extension path uses origin-restricted native messaging, not HTTP,
  and validates the card before starting BLE. `bridge.py` retains its authenticated
  `127.0.0.1:17321` interface only as a manual diagnostic/compatibility tool; it is
  not used by extension version 0.5.0.

The bridge logs no profile payloads or BLE keys. It keeps no account cookie,
access token, prompt, HTML, or session log. The extension stores only the collected
card and numeric collection summaries locally.

## NFC behavior

The installed NTAG213 is a passive tag with ordinary static NDEF storage and no
MCU-facing BSP interface. Firmware therefore cannot switch the NFC target when
the displayed Zhihu or Xiaohongshu page changes. A phone can program one fixed
HTTPS profile URL into the tag; whether that URL opens an installed app or a
browser is controlled by the phone and the site's universal/app-link support.
Screen-dependent NFC requires a hardware revision with an MCU-controllable dynamic
NFC tag or emulator.

## Validation and flashing

```bash
./tools/validate.sh --static
npm --prefix tools/folocard ci
npm --prefix tools/folocard test
# In an activated ESP-IDF 5.5.3 environment:
./tools/validate.sh
```

Browser tests use installed Chrome on macOS, `FOLOCARD_CHROME` when set, or
Playwright's Chromium. Install the latter with `npx playwright install chromium`
from the tools directory when needed. The C parser tests use an MIT-licensed
cJSON copy pinned to the same commit as ESP-IDF 5.5.3.

Preserve the three-megabyte application limit, identity at `0x356000`, Recovery
at `0x700000`, and the five-second UP boot hook. Never erase a provisioned device.
For development, flash the bootloader, partition table and application separately
using `idf.py flash`; do not write padding over NVS. Retain a private local backup
before replacing existing firmware. Only publish the full image after the
repository compatibility gate passes.

A one-shot explicit test transfer can be run without installing the extension:

```bash
.local-tools/folocard-venv/bin/python tools/folocard/bridge.py \
  --device DEVICE_UUID --send path/to/card.json
```

Device acceptance includes PIN pairing, successful commit, malformed and
interrupted transfer retention, power-cycle persistence, 84-date grid comparison,
QR scanning, physical navigation, and repeated sync start/cancel/timeout without
heap loss. Build success alone does not establish these observations.
