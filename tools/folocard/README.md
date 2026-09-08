[简体中文](README.zh_CN.md) · **English**

# FoloCard desktop tools

This directory contains the FoloCard browser extension and its optional native
messaging component. The extension reads the current browser profile only after
the user chooses **Read data**, stores validated card data locally, and can send
it to a waiting FoloCard over encrypted, bonded BLE.

For the complete device, safety, validation, and release instructions, see the
[FoloCard deployment guide](../../docs/development/release/folocard-deployment.md).

## Install from a release bundle

Extract `FoloCard-<version>-plugin.zip`. In Chrome, Brave, Edge, or Chromium,
open the extension management page, enable Developer mode, select **Load
unpacked**, and choose the extracted `extension` directory. Copy the resulting
extension ID, then run from the extracted bundle directory:

```bash
python3 -m venv .folocard-venv
.folocard-venv/bin/pip install -r requirements.txt
.folocard-venv/bin/python install_native.py --extension-id CHROME_EXTENSION_ID
```

Reload the extension after installing or updating the native component. Python
3.10 or newer is required. The installer supports macOS and Linux; it registers
Chrome and Brave by default and may be repeated with `--browser` for other
supported Chromium browsers.

Do not commit or distribute the generated virtual environment, browser profile,
native-host registration, session logs, pairing keys, or collected card data.
