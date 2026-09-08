<p align="right">
  <a href="README.zh_CN.md">简体中文</a> · <strong>English</strong>
</p>

# Assets

This directory stores reusable fonts, images, music, and sound effects, organized by asset type.

Keep each asset in the matching subdirectory and document its destination, naming, integration method, and source/license. Do not mix binary assets with Markdown documentation.

## Fonts

Store reusable font files and generated font sources in `fonts/`.

- Use descriptive names that include the family, weight, size, and format when relevant.
- Document the source, license, character range, conversion command, and expected destination.
- Check Flash and internal-RAM impact before adding a font; the ESP32-C3 has no PSRAM.
- Do not commit fonts whose license does not permit redistribution.

## Images

Store reusable source images and generated display assets in `images/`.

- Use descriptive names and document dimensions, pixel format, conversion steps, and destination.
- Prefer formats suitable for the 240 × 320 RGB565 display and account for Flash and internal RAM.
- Preserve editable sources where licensing permits, and record the source and license.
- Never commit device QR secrets, credentials, or personal data in images.

### FoloCard brand marks

`images/folocard-{codex,zhihu,xiaohongshu}-source.png` are the original brand
marks supplied for the FoloCard pages: Codex (640 × 640), Zhihu (512 × 512),
and Xiaohongshu (256 × 256). They were supplied by the project contributor;
confirm redistribution rights before releasing the assets outside this project.

`images/folocard-*-40.argb8888` are 40 × 40 BGRA byte buffers derived from
those originals with macOS `sips` (resize, BMP export, then remove the
138-byte BMP header). `main/folocard_logos.c` exposes them as LVGL
ARGB8888 images via `EMBED_FILES`, keeping the device from decoding full-size
PNG files at runtime. Each buffer occupies 6,400 bytes of flash. The original
PNG files are also copied to `tools/folocard/extension/assets/` so the browser
extension's device-screen preview uses the same marks.

## Music and sound effects

Store reusable music and sound-effect sources in `music/`.

- Document the source, license, sample rate, bit depth, channels, conversion command, and destination.
- Prefer 16 kHz, 16-bit mono PCM when it matches the current BSP audio path.
- Check Flash and internal-RAM cost before embedding audio; stream or chunk long recordings.
- Do not commit media without redistribution permission.
