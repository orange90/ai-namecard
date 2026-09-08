<p align="right">
  <a href="folocard-deployment.zh_CN.md">简体中文</a> · <strong>English</strong>
</p>

# FoloCard deployment and release

This guide deploys FoloCard as two release assets:

- `ai-namecard-full.bin` is the verified ESP32-C3 firmware image.
- `FoloCard-<version>-plugin.zip` is the unpacked Chromium extension plus the
  native messaging and BLE synchronization tools.

The browser extension is not a Chrome Web Store package and must be loaded in
Developer mode. It does not contain firmware, credentials, browser sessions,
BLE bonds, native-host registrations, virtual environments, or collected card
data.

## Build the release assets

Use ESP-IDF 5.5.3 with the ESP32-C3 target. From the repository root:

```bash
source /path/to/esp-idf-v5.5.3/export.sh
idf.py --version
./tools/validate.sh --static
./tools/validate.sh --firmware
./tools/folocard/package-release.sh build/release
shasum -a 256 build/ai-namecard-full.bin \
  build/release/FoloCard-<version>-plugin.zip
```

`idf.py --version` must report `ESP-IDF v5.5.3`. The firmware command creates
`build/ai-namecard-full.bin` only after checking the bootloader,
partition-table MD5, application size, protected `cardid` and Recovery regions,
and the five-second UP-key Recovery hook. Do not substitute the app-only
`build/ai-namecard.bin`.

The packaging script reads the extension version from `manifest.json` and
creates a ZIP whose top-level directory contains `extension/`, the native tools,
their requirements file, and bilingual installation instructions. It deliberately
excludes `node_modules`, build output, Python bytecode, local environments, and
all user data.

## Publish and install

Upload both generated files and their SHA-256 values to the GitHub Release. Use
a tag named `v<version>-folocard`, for example `v0.5.1-folocard`.

To install over USB, write `ai-namecard-full.bin` at offset `0x0` with an ESP32-C3
flasher. This full image contains the bootloader, partition table, and factory
application. Writing it clears ordinary NVS, so previously synchronized card
data is reset. The verified image ends before the protected `cardid` partition
at `0x356000` and permanent Recovery at `0x700000`; never run an erase-flash
operation, which would erase those regions too. Use the AI Passport mini-program
application flow or segmented development flashing when ordinary NVS must be
preserved.

To install the plugin, extract the ZIP, load its `extension/` folder as an
unpacked extension, copy its extension ID, and run `install_native.py` as shown
in the bundled README. Reload the extension after registration. On the device,
double-click OK, then press OK once to open the three-minute synchronization
window. Confirm the preview in the extension before synchronizing; enter the
device's six-digit PIN only in the operating system pairing dialog.

## Release checklist

- Confirm `./tools/validate.sh --static` and `./tools/validate.sh --firmware`
  pass on the final commit.
- Upload only the full firmware image and plugin ZIP, never a local `sdkconfig`,
  build tree, logs, test fixtures containing personal data, browser profiles,
  or pairing material.
- Publish English and Simplified Chinese release notes covering new behavior,
  build commands, installation, and the protected-partition warning.
- Download the uploaded full firmware and validate it on a physical device;
  compilation and artifact upload do not prove hardware behavior.
