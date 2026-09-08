<p align="right">
  <a href="folocard-deployment.md">English</a> · <strong>简体中文</strong>
</p>

# FoloCard 部署与发布

FoloCard 发布时包含两份资产：

- `FoloToy-AI-Passport-full.bin`：已经验证的 ESP32-C3 完整固件镜像。
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
shasum -a 256 build/FoloToy-AI-Passport-full.bin \
  build/release/FoloCard-<version>-plugin.zip
```

`idf.py --version` 必须显示 `ESP-IDF v5.5.3`。固件命令会在检查 bootloader、分区表 MD5、
应用大小、受保护的 `cardid` 与 Recovery 区域及 UP 键五秒 Recovery 钩子后，才生成
`build/FoloToy-AI-Passport-full.bin`。不得使用只有应用内容的
`build/FoloToy-AI-Passport.bin` 替代。

打包脚本从 `manifest.json` 读取扩展版本，生成 ZIP。其顶层目录包含 `extension/`、原生工具、
依赖文件与双语安装说明；特意排除 `node_modules`、构建输出、Python 字节码、本地环境及所有
用户数据。

## 发布与安装

将两份生成文件及其 SHA-256 上传到 GitHub Release。标签使用
`v<version>-folocard`，例如 `v0.5.0-folocard`。

安装固件时，在 AI Passport 浏览器烧录工具中选择
`FoloToy-AI-Passport-full.bin`，偏移量为 `0x0`。不得把这个合并镜像直接写入已配置的设备：
其资源布局跨越了受保护的身份区。已配置设备应使用 AI Passport 小程序安装流程或分段开发烧录。
绝不能执行整片擦除。

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
