[English](README.md) · **简体中文**

# FoloCard 桌面工具

本目录包含 FoloCard 浏览器扩展及可选的原生消息组件。扩展仅在用户点击“读取数据”后
读取当前浏览器配置，先在本地保存经过校验的名片数据；设备开启同步窗口后，才会通过加密、
已绑定的 BLE 发送数据。

完整的设备、安全、验证与发布步骤见 [FoloCard 部署说明](../../docs/development/release/folocard-deployment.zh_CN.md)。

## 从发布包安装

解压 `FoloCard-<version>-plugin.zip`。在 Chrome、Brave、Edge 或 Chromium 中打开扩展
管理页，开启开发者模式，选择“加载已解压的扩展程序”，再选择解压后的 `extension`
目录。复制生成的扩展 ID，然后在解压后的套件目录执行：

```bash
python3 -m venv .folocard-venv
.folocard-venv/bin/pip install -r requirements.txt
.folocard-venv/bin/python install_native.py --extension-id CHROME_EXTENSION_ID
```

安装或更新原生组件后请重新加载扩展。需要 Python 3.10 及以上版本。安装器支持 macOS
和 Linux，默认注册 Chrome 与 Brave；可通过重复指定 `--browser` 注册其他受支持的
Chromium 浏览器。

不得提交或分发生成的虚拟环境、浏览器配置、原生组件注册、会话日志、配对密钥或采集到的
名片数据。

## 移除本机组件

先在浏览器中移除已解压扩展并关闭浏览器。macOS 上删除
`~/Library/Application Support/FoloCard/native`，并只删除所选浏览器在
`~/Library/Application Support` 下 `NativeMessagingHosts` 目录中的
`com.folotoy.folocard.json`。Linux 上删除 `~/.local/share/folocard/native`，
并只删除所选浏览器在 `~/.config` 下 `NativeMessagingHosts` 目录中的同名配置文件。

不要删除浏览器配置或 Application Support 的上级目录。
