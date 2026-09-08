#!/usr/bin/env python3
"""Install the user-level FoloCard native host once, without a background daemon."""
import argparse
import json
import os
from pathlib import Path
import re
import shlex
import shutil
import sys

NAME = 'com.folotoy.folocard'
# BraveMainDelegate::PreSandboxStartup explicitly overrides the macOS native
# host search directory to Google/Chrome (not its own profile directory).
# https://github.com/brave/brave-core/blob/master/app/brave_main_delegate.cc
MAC_BROWSERS = {'chrome': 'Google/Chrome', 'brave': 'Google/Chrome',
                'edge': 'Microsoft Edge', 'chromium': 'Chromium'}
LINUX_BROWSERS = {'chrome': 'google-chrome', 'brave': 'BraveSoftware/Brave-Browser',
                  'edge': 'microsoft-edge', 'chromium': 'chromium'}


def install_runtime(destination, platform, executable=None, prefix=None,
                    base_prefix=None):
    """Keep the macOS host runtime outside privacy-protected project folders."""
    executable = Path(executable or sys.executable)
    prefix = Path(prefix or sys.prefix)
    base_prefix = Path(base_prefix or sys.base_prefix)
    if platform != 'darwin' or prefix == base_prefix:
        return executable
    runtime = destination/'venv'
    staging = destination/'.venv-installing'
    previous = destination/'.venv-previous'
    for transient in (staging, previous):
        if transient.exists():
            shutil.rmtree(transient)
    shutil.copytree(prefix, staging, symlinks=True,
                    ignore=shutil.ignore_patterns('__pycache__'))
    if runtime.exists():
        runtime.replace(previous)
    try:
        staging.replace(runtime)
    except OSError:
        if previous.exists() and not runtime.exists():
            previous.replace(runtime)
        raise
    if previous.exists():
        shutil.rmtree(previous)
    try:
        relative = executable.relative_to(prefix)
    except ValueError:
        relative = Path('bin/python')
    installed = runtime/relative
    if not installed.exists():
        installed = runtime/'bin/python'
    if not installed.exists():
        raise OSError('无法安装本机 Python 运行环境。')
    return installed


def install(extension_id, browsers, home=None, platform=None, codex_home=None):
    if not re.fullmatch('[a-p]{32}', extension_id):
        raise ValueError('扩展 ID 必须为浏览器扩展管理页显示的 32 位 ID。')
    home = Path(home or Path.home()).resolve()
    platform = platform or sys.platform
    if platform == 'darwin':
        base = home/'Library/Application Support'
        mapping = MAC_BROWSERS
        destination = base/'FoloCard/native'
    elif platform.startswith('linux'):
        base = home/'.config'
        mapping = LINUX_BROWSERS
        destination = home/'.local/share/folocard/native'
    else:
        raise ValueError('当前安装器支持 macOS 和 Linux。')
    if not browsers or any(browser not in mapping for browser in browsers):
        raise ValueError('Unsupported browser')
    destination.mkdir(parents=True, exist_ok=True, mode=0o700)
    origin = f'chrome-extension://{extension_id}/'
    config_path = destination/'native_config.json'
    config = json.loads(config_path.read_text()) if config_path.exists() else {'allowed_origins': []}
    config['allowed_origins'] = sorted(set(config['allowed_origins']) | {origin})
    if codex_home:
        config['codex_home'] = str(Path(codex_home).expanduser().resolve())
    config_path.write_text(json.dumps(config, indent=2)+'\n');config_path.chmod(0o600)
    for name in ('native_host.py', 'codex_local.py', 'ble_sync.py', 'protocol.py'):
        shutil.copyfile(Path(__file__).with_name(name), destination/name)
    python = install_runtime(destination, platform)
    launcher = destination/'folocard-host'
    launcher.write_text('#!/bin/sh\nexec '+shlex.quote(str(python))+' -B -u '+shlex.quote(str(destination/'native_host.py'))+' "$@"\n')
    launcher.chmod(0o700)
    installed = []
    for browser in browsers:
        path = base/mapping[browser]/'NativeMessagingHosts'/(NAME+'.json')
        path.parent.mkdir(parents=True, exist_ok=True)
        old = json.loads(path.read_text()) if path.exists() else {}
        origins = sorted(set(old.get('allowed_origins', [])) | {origin})
        manifest = {'name': NAME, 'description': 'FoloCard local data and BLE sync',
                    'path': str(launcher), 'type': 'stdio', 'allowed_origins': origins}
        path.write_text(json.dumps(manifest, indent=2)+'\n');path.chmod(0o600)
        installed.append(path)
    return installed


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--extension-id', required=True)
    parser.add_argument('--browser', action='append', choices=list(MAC_BROWSERS), help='Repeat for multiple browsers; defaults to Chrome and Brave')
    parser.add_argument('--codex-home')
    args = parser.parse_args()
    try:
        install(args.extension_id, args.browser or ['chrome', 'brave'], codex_home=args.codex_home)
    except (ValueError, OSError) as error:
        parser.error(str(error))
    print('FoloCard 本机读取与 BLE 同步组件已安装。重新加载扩展后即可使用，无需启动码。')


if __name__ == '__main__':
    main()
