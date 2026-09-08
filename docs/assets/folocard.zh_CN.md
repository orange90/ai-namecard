[English](folocard.md) · **简体中文**

# FoloCard MVP

FoloCard 用三张离线名片替换演示菜单：黑底绿热力图的 Codex 活动页、蓝色知乎
名片和红色小红书名片。UP/DOWN 循环切换，OK 查看详情，双击 OK 打开同步设置，
长按 OK 返回名片并取消同步。中文使用 LVGL 内置的思源黑体子集；子集未覆盖的
生僻字需要另行制作字体。

## 安装桌面工具

扩展位于 [`tools/folocard/extension`](../../tools/folocard/extension/manifest.json)。
在 Chrome 扩展管理页面开启开发者模式，选择“加载已解压的扩展程序”，选中该目录，
复制扩展 ID。打开工具栏插件弹窗，或点击“在独立页打开”使用较大的预览页面，两者均不依赖当前标签页。采集在插件后台执行，关闭弹窗仍会继续；更新文件后请在浏览器扩展管理页重新加载插件。扩展使用无构建依赖的 JavaScript，而非草稿中的 React/Vite 技术栈。
不包含定时抓取或云端账号。
站点、头像 CDN 访问和原生消息均为安装时声明的必需权限。浏览器可能在安装或升级时要求确认，读取和同步时不再追加申请权限。若手动限制了站点访问，请在扩展管理页允许访问后重试。

在仓库根目录运行：

```bash
python3 -m venv .local-tools/folocard-venv
.local-tools/folocard-venv/bin/pip install -r tools/folocard/requirements.txt
.local-tools/folocard-venv/bin/python tools/folocard/install_native.py \
  --extension-id CHROME_EXTENSION_ID
```

在设备上双击 OK，再单击 OK，开启三分钟同步窗口；等待同步时点击扩展中的同步按钮。
本机组件会扫描并连接附近正在广播的 FoloCard。首次访问加密特征会触发 macOS
配对弹窗，请把设备屏幕上的六位 PIN 输入系统弹窗，不要填进扩展。macOS 和 ESP32
保存绑定关系，本机组件不读取配对密钥。OK 或长按 OK 可取消，后台任务会断开连接并释放 NimBLE。

## 预览与同步

点击“一键读取数据”。插件使用当前浏览器配置中已登录的账号，查找三个站点已打开的标签页，并在后台打开缺少的账号页面。
知乎通过当前用户接口、小红书通过“我”的导航入口确认账号归属，不会把正在浏览的任意公开主页当成你的账号。Codex 优先用已有浏览器会话读取用量接口，接口不可用时再打开用量页，三个站点分别显示结果。
明确未登录的站点提供“去登录”按钮，完成网站登录后点击“重新读取数据”。网络错误、站点验证和页面缺少数据会提供“打开检查”，不会一律误报未登录。
成功站点独立保存，失败站点保留原数据。已有标签页不会被导航或关闭；自动创建的标签页只有在仍未激活且未被用户跳转时才关闭，失败页面保留供检查。

检查本机预览，勾选确认后同步。头像失败不丢弃文字更新。仅在主页链接相同时，没有提取到的社交指标保留旧值。
页面结构变化或无法识别时会报错，保留旧名片。采集结果直接用于预览和确认后的同步。

插件中的设备效果预览按 FoloToy 的 240 × 320 屏幕渲染，使用与固件相同的三页和详情状态，
并显示名片中实际保存的 RGB565 头像。点击预览的 UP/DOWN 切换页面，点击 OK 或屏幕查看当前页的详情效果。

适配器支持带明确强度与 ISO 日期的可见格子，以及 Codex 页面明确标注的用量。
浏览器额度与本机每日 Token 分别显示状态；本机扫描成功后在浏览器采集完成时更新每日数据，失败时保留旧数据。本机记录属于配置的 Codex 目录，与浏览器账号分开标注。知乎适配器会在用户
主动点击后读取公开成员接口，支持个人主页子页面；仅在账号首页或创作中心采集时，参考 zhihu-copilot 的方式读取创作者首页、实时日
数据和聚合数据，不会将创作者指标附到他人的主页；当评论与收藏字段存在时，今日互动为两者之和。小红书读取公开
页面上的明确指标。脱敏 HTML 样例测试不代表已兼容所有线上页面版本。`12K` 等
缩写指标会展开供预览，可能是近似值，请核对后发送。允许的图片 CDN 头像会在
本机居中裁剪为 24 x 24 RGB565 后写入名片，原头像 URL 不会保存。

缺少 Token 数时保持未知。热力图按快照日期向前排列 84 个自然日，未知日期描边。
本周活动表示快照所在周（周一开始）已记录的非零活动天数，不是 Token 总和。
离线旧快照不代表今天的活动。额度单独显示，不换算成 Token。

### 自动读取本机每日 Token 与 BLE 同步（0.5.0）

无需安装 CodexBar，也不调用其命令行。桥接内置独立的 Python 标准库扫描器，参考
[CodexBar 扫描器](https://github.com/steipete/CodexBar/blob/170a4d41c6d69e2bb25daac4fb088a92de2f9bc4/Sources/CodexBarCore/Vendored/CostUsage/CostUsageScanner.swift)的计数处理逻辑。
浏览器扩展不能直接访问本机会话文件。先在项目目录安装一次自带本机组件，再重新加载扩展：

```bash
python3 -m venv .local-tools/folocard-venv
.local-tools/folocard-venv/bin/pip install -r tools/folocard/requirements.txt
.local-tools/folocard-venv/bin/python tools/folocard/install_native.py \
  --extension-id CHROME_EXTENSION_ID
# 可选：--browser brave（可重复指定 chrome、edge 或 chromium）
# 可选：--codex-home /absolute/path/to/codex-home
```

读取 Token 只需 Python 3.10+。安装器支持 macOS 和 Linux，默认注册 Chrome 和 Brave，
尚未提供 Windows 安装包。插件提供带当前扩展 ID 的安装命令；更新本机组件或更换扩展 ID 后需重新安装。
这一步是首次注册用户级本机程序，浏览器扩展不能静默替用户完成安装。
macOS 的 Brave 使用 Chrome 的原生组件目录。安装器遵循
[Brave 启动实现](https://github.com/brave/brave-core/blob/master/app/brave_main_delegate.cc)，
不按 Brave 个人资料目录猜测位置；扩展来源白名单保持不变。

之后每次读取或同步设备时，浏览器通过 `runtime.connectNative` 自动启动
`com.folotoy.folocard`，完成一次请求后断开连接。无需终端、启动码、HTTP 监听、
登录启动项或 CodexBar。本机程序只接受已注册扩展来源的 `{type: "codex-usage"}`
或经过校验的 `{type: "sync-device", card: ...}` 请求。
机制参考[浏览器 Native Messaging 契约](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging)。
安装器把读取与同步程序复制到用户的 FoloCard 支持目录，写入仅允许指定扩展的浏览器配置。
macOS 还会把准备好的 Python 环境复制到该支持目录，避免浏览器启动的本机组件因“文稿”等
隐私保护目录的访问限制而立即退出。不保存凭据。

- 按 `--codex-home`、`$CODEX_HOME`、`~/.codex` 的优先级确定目录，读取其下
  `sessions/**/*.jsonl` 和 `archived_sessions/**/*.jsonl`。不读取 `auth.json`、
  浏览器 Cookie 或 CodexBar 缓存，不调用外部命令，不联网。
- 内存中只保留会话标识、时间戳与数值计数；追加文件从最后完整行续读，截断文件重新扫描。
  限定扩展来源的原生消息管道只返回每日合计和统计完整性状态。
- 将 `event_msg/token_count` 的增量归入事件发生的本地日期，去重重复计数和归档副本。
  缓存输入已包含在输入 Token 中，推理已包含在输出中，不重复相加。
- 扣除可确认的分叉父会话基线。无法确认的分叉、回退或交错计数显示“部分统计”，
  采用保守计数，避免重复累加继承用量。本实现不包含 CodexBar 完整的多平台计价引擎，
  不扫描 pi/OMP 历史，也无法读取只存在云端的会话。
- 展示最近 84 天内的已记录日期、今日数值（有记录时）、每日明细与热力图；缺失日期保持未知。
  热力图强度相对于已记录最大单日值计算。设备沿用版本 1 的日期与 Token 字段，
  详情页显示最近一条记录的日期与用量，不把多日合计写成计费周期总额。
  协议来源仍为兼容旧设备的 `usage-ui`，准确来源记录在 `collection.localCodex`。
- 浏览器未登录不影响本机 Token 读取。本机目录可能包含此电脑使用过的多个账号，
  与浏览器账号额度分开展示。

### Codex 用量来源

浏览器实现参考了 [CodexBar 的用量页面采集器](https://github.com/steipete/CodexBar/blob/170a4d41c6d69e2bb25daac4fb088a92de2f9bc4/Sources/CodexBarCore/OpenAIWeb/OpenAIDashboardFetcher.swift)
和[用量响应模型](https://github.com/steipete/CodexBar/blob/170a4d41c6d69e2bb25daac4fb088a92de2f9bc4/Sources/CodexBarCore/Providers/Codex/CodexOAuth/CodexOAuthUsageFetcher.swift)的会话认证接口路径及字段语义。
CodexBar 由 Peter Steinberger 以 MIT 许可证发布。本次查阅版本为 `170a4d41c6d69e2bb25daac4fb088a92de2f9bc4`。

- 标签页使用浏览器会话请求 `GET /backend-api/wham/usage`。仅返回经过校验的用量字段，账号标识、Cookie 值、令牌及原始响应不会保存或发到桥接程序。
- 主周期和次周期分别展示已用/剩余百分比、接口报告的周期长度和重置时间。Credits 余额是剩余点数，不是已消耗点数或 Token 用量。
- 用量接口返回 401 时，先用 `/api/auth/session` 确认会话，再决定是否提示登录。403、格式异常及网络失败会回退到页面解析；429 提示稍后重试，不再轮询。
- 版本 1 的设备名片仍只包含一项额度：优先选择具有有效重置时间的主周期，否则选择具有有效重置时间的次周期。两个周期及余额保存在浏览器独立的采集摘要中。仅有浏览器可展示的数据时保留原设备名片，并在状态中说明。发送到设备的重置时间精确到秒，不带小数部分。
- 该地址属于网站后端，不是公开 API 契约。脱敏浏览器测试覆盖响应结构，实际会话兼容性仍取决于 ChatGPT 当前的认证和服务行为。
- 页面适配同时支持旧 `/codex/settings/usage`、迁移后的 `/codex/cloud/settings/usage`
  与 `/codex/cloud/settings/analytics`（含 `#usage`）。仅允许这些同源别名之间的正常跳转，
  其他页面仍被拒绝。Analytics 的 Balance 区域支持纯文本绝对重置日期，并保留 `<time>` 与相对时间解析。

## 协议与存储

- JSON 版本 1，UTF-8 最多 8192 字节。拒绝未知或重复字段、非法日期、乱序日期、
  非法数值、带查询参数或非公开主页的链接；JSON 嵌套最多八层。
- 服务 UUID：`fc010000-4643-0080-464f-435500000001`。
- 写入 UUID：`fc010000-4643-0080-464f-435500000002`。
- 回执 UUID：`fc010000-4643-0080-464f-435500000003`。
- 所有特征均要求加密、认证和绑定连接。
- BEGIN：字节 `1`，小端 uint32 长度，小端 uint32 CRC32。
- DATA：字节 `2`，小端 uint16 偏移，随后 1–241 字节数据。
- COMMIT：字节 `3`。重试必须重新 BEGIN。桥接程序每片使用 17 字节有效数据，
  兼容最小 ATT MTU。
- 回执：`{version, checksum, status, offset, revision}`。状态 `1` 为已接收进度，
  `2` 为已保存，`-1` 为拒绝。revision 是本次启动的计数，不是跨重启单调版本号。
- 数据先进入 RAM，通过解析后写入非活动 NVS blob，提交成功后再提交活动选择器。
  不完整或非法消息不会生效。存储满时直接报错，不擦除 NVS，也不擦除其他命名空间。
- 扩展的正常路径使用限定来源的原生消息，不使用 HTTP；同步前会先校验名片。
  `bridge.py` 的 `127.0.0.1:17321` 认证接口仅保留为手工诊断和兼容工具，
  扩展 0.5.0 不再调用它。

桥接日志不包含个人资料或 BLE 密钥。不保存账号 Cookie、访问令牌、Prompt、HTML
或会话日志。扩展只把采集到的名片与数值采集摘要保存在本机。

## NFC 行为

板载 NTAG213 是只保存普通静态 NDEF 的被动标签，没有连接 MCU 的 BSP 接口。
因此固件无法随着当前显示的知乎或小红书页面切换 NFC 目标。可以用手机向标签写入
一个固定的 HTTPS 主页链接；碰一碰后由手机系统和站点的 Universal Link/App Link
能力决定打开已安装 App 还是浏览器。若要按屏幕页面动态切换，必须改用 MCU 可控制的
动态 NFC 标签或模拟器并修改硬件。

## 验证与烧录

```bash
./tools/validate.sh --static
npm --prefix tools/folocard ci
npm --prefix tools/folocard test
# 激活 ESP-IDF 5.5.3 后：
./tools/validate.sh
```

浏览器测试优先使用 macOS 已安装的 Chrome，也支持 `FOLOCARD_CHROME` 或
Playwright Chromium；需要时在工具目录运行 `npx playwright install chromium`。
C 解析器测试使用 MIT 许可的 cJSON 副本，提交版本与 ESP-IDF 5.5.3 一致。

保留 3 MB 应用上限、`0x356000` 身份分区、`0x700000` Recovery 及上键五秒入口。
不得整片擦除已配置设备。开发时使用 `idf.py flash` 分别写入 bootloader、分区表和
应用，避免用填充字节覆盖 NVS。更换固件前保留私有本机备份。完整镜像通过仓库
兼容性检查后才可用于发布。

不安装扩展也可主动进行一次测试文件传输：

```bash
.local-tools/folocard-venv/bin/python tools/folocard/bridge.py \
  --device DEVICE_UUID --send path/to/card.json
```

实机验收包括 PIN 配对、成功提交、非法及中断传输保留旧数据、重启持久化、84 天
格子比对、二维码扫描、物理按键，以及反复开启、取消和超时后的堆内存检查。
编译成功不能代替上述实机观察。
