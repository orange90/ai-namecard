<p align="right">
  <a href="folocard-deployment.md">English</a> · <strong>简体中文</strong>
</p>

# FoloCard 部署与发布

FoloCard 发布时包含两份资产：

- `ai-namecard-full.bin`：已经验证的 ESP32-C3 完整固件镜像。
- `FoloCard-<version>-plugin.zip`：可解压加载的 Chromium 扩展，以及原生消息与 BLE
  同步工具。

浏览器扩展不是 Chrome 应用商店安装包，必须使用开发者模式加载。其中不包含固件、凭据、
浏览器会话、BLE 绑定、原生组件注册、虚拟环境或采集到的名片数据。

## 构建发布资产

使用面向 ESP32-C3 的 ESP-IDF 5.5.3。在仓库根目录执行：

```bash
source /path/to/esp-idf-v5.5.3/export.sh
idf.py --version
./tools/validate.sh --static
./tools/validate.sh --firmware
./tools/folocard/package-release.sh build/release
shasum -a 256 build/ai-namecard-full.bin \
  build/release/FoloCard-<version>-plugin.zip
```

`idf.py --version` 必须显示 `ESP-IDF v5.5.3`。固件命令会在检查 bootloader、分区表 MD5、
应用大小、受保护的 `cardid` 与 Recovery 区域及 UP 键五秒 Recovery 钩子后，才生成
`build/ai-namecard-full.bin`。不得使用只有应用内容的
`build/ai-namecard.bin` 替代。

打包脚本从 `manifest.json` 读取扩展版本，生成 ZIP。其顶层目录包含 `extension/`、原生工具、
依赖文件与双语安装说明；特意排除 `node_modules`、构建输出、Python 字节码、本地环境及所有
用户数据。

## 发布与安装

将两份生成文件及其 SHA-256 上传到 GitHub Release。标签使用
`v<version>-folocard`，例如 `v0.5.1-folocard`。

通过 USB 安装固件时，使用 ESP32-C3 烧录工具将 `ai-namecard-full.bin`
写入 `0x0`。完整镜像包含 bootloader、分区表和 factory 应用；写入后会清空普通
NVS，因此之前同步的名片数据会重置。经过校验的镜像会在 `0x356000` 的受保护
`cardid` 分区和 `0x700000` 的永久 Recovery 之前结束；绝不能执行整片擦除，否则这些
区域也会被删除。如需保留普通 NVS，请使用 AI Passport 小程序应用安装流程或分段开发烧录。

安装插件时，解压 ZIP，以未打包扩展方式加载其中的 `extension/` 文件夹，复制扩展 ID，按包内
README 所示运行 `install_native.py`。注册后重新加载扩展。设备上双击 OK，再单击 OK，开启三分钟
同步窗口。在扩展中确认预览后再同步；设备显示的六位 PIN 只能填写到操作系统的配对弹窗。

## 发布检查表

- 最终提交必须通过 `./tools/validate.sh --static` 和
  `./tools/validate.sh --firmware`。
- 仅上传完整固件镜像和插件 ZIP；不得上传本地 `sdkconfig`、构建目录、日志、含个人数据的测试
  样例、浏览器配置或配对材料。
- 发布英文和简体中文说明，覆盖新行为、构建命令、安装方式与受保护分区警告。
- 下载已经上传的完整固件并在实体设备上验证；编译和上传产物不能证明硬件功能。
