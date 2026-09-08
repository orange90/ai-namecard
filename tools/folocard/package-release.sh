#!/usr/bin/env bash
set -euo pipefail

# Build a distributable, unpacked-browser-extension bundle. The firmware is
# produced independently by tools/validate.sh --firmware because only that gate
# verifies the protected AI Passport layout.

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
tool_dir="${repo_root}/tools/folocard"
manifest="${tool_dir}/extension/manifest.json"
output_dir="${1:-${repo_root}/build/release}"

if ! command -v zip >/dev/null 2>&1; then
    echo "zip is required to package the FoloCard plugin" >&2
    exit 1
fi

version="$(sed -nE 's/^[[:space:]]*"version"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/p' "${manifest}")"
if [[ -z "${version}" ]]; then
    echo "Could not read the extension version from ${manifest}" >&2
    exit 1
fi

mkdir -p "${output_dir}"
output_dir="$(cd "${output_dir}" && pwd)"
stage_dir="$(mktemp -d "${TMPDIR:-/tmp}/folocard-plugin.XXXXXX")"
bundle_dir="${stage_dir}/FoloCard-${version}-plugin"
trap 'rm -rf "${stage_dir}"' EXIT

mkdir -p "${bundle_dir}"
cp -R "${tool_dir}/extension" "${bundle_dir}/extension"
cp "${tool_dir}/ble_sync.py" \
   "${tool_dir}/bridge.py" \
   "${tool_dir}/codex_local.py" \
   "${tool_dir}/install_native.py" \
   "${tool_dir}/native_host.py" \
   "${tool_dir}/protocol.py" \
   "${tool_dir}/requirements.txt" \
   "${tool_dir}/README.md" \
   "${tool_dir}/README.zh_CN.md" \
   "${bundle_dir}/"
cp "${repo_root}/LICENSE" "${bundle_dir}/LICENSE"

archive="${output_dir}/FoloCard-${version}-plugin.zip"
rm -f "${archive}"
(cd "${stage_dir}" && zip -qr "${archive}" "$(basename "${bundle_dir}")")

echo "Plugin bundle: ${archive}"
if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "${archive}"
elif command -v sha256sum >/dev/null 2>&1; then
    sha256sum "${archive}"
fi
