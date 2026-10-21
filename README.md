# API Vault

API Vault 是一个纯本地的站点书签与随手记工具，保留原有单页 HTML 体验，并使用 Vite、Tailwind CSS 和 Capacitor 构建 Web 与 Android 版本。

## 项目现状

- 源码仓库：[https://github.com/AApple0528/api-vault](https://github.com/AApple0528/api-vault)。
- 当前源码版本为 `0.3.1`，Android 为 `versionName 0.3.1` / `versionCode 2`；已有 `v0.3.0` Release 保留，`v0.3.1` 正在发布准备中。
- 保留站点管理、分组、标签、搜索筛选、签到、便签、复制、JSON 导入导出和 Markdown 导出；核心界面的 Tailwind 和 Lucide 使用本地依赖，可离线使用。
- 原始 `API-Vault.html` 保留不改；现有应用为原生 HTML/CSS/JavaScript，没有迁移 Vue，也没有引入 iOS 工程。

## 本地开发

使用 Node.js 22+、pnpm 和已提交的 `pnpm-lock.yaml`；CI 使用 Node.js 22、pnpm 9。安装依赖与首次 Android 构建需要网络，源码版本调整不要求升级依赖或 Gradle。

```powershell
pnpm install --frozen-lockfile
pnpm run dev
```

所有站点、分组和便签默认保存在当前 WebView 的 `localStorage` 中；便签未加密，请勿保存需要高强度保密的凭证。

## Web 构建

```powershell
pnpm run build
pnpm run preview
```

## Android

需要安装 Android Studio、Android SDK、JDK 21 和 Capacitor Android 依赖。当前项目已生成 `android/` 工程，运行：

```powershell
pnpm run build
pnpm exec cap sync android
cd android
.\gradlew.bat assembleDebug
```

Debug APK 输出在 `android\app\build\outputs\apk\debug\app-debug.apk`。也可以运行 `pnpm exec cap open android` 在 Android Studio 中启动模拟器或连接的手机。

本地 APK 构建需要将 `JAVA_HOME` 指向 JDK 21，并在 `android/local.properties` 中配置自己的 SDK 路径（该文件不提交）。本次修复已使用 JDK 21 成功执行 `assembleDebug`；构建成功不等于已完成真机验证。

### 安装与保留数据更新

在 [GitHub Releases](https://github.com/AApple0528/api-vault/releases) 选择已经发布的 APK，或使用本地构建产物。将文件传到手机后，由文件管理器打开，并按 Android 提示允许该来源安装应用。仓库地址指向源码，Release 页面用于下载已发布版本。

连接已开启 USB 调试的手机后，也可以在项目根目录执行：

```powershell
adb devices -l
adb install -r android\app\build\outputs\apk\debug\app-debug.apk
```

更新前建议导出 JSON 备份并确认文件已保存（包含站点、分组及站点便签）。更新应覆盖安装，保持包名 `app.apivault.local`、同一签名证书及递增的 `versionCode`；不要卸载旧应用或清除应用数据。签名不匹配时应停止安装并核对构建来源，不能用卸载来解决，否则本地记录会丢失。普通浏览器与 Android App 的本地数据互不共享；导入备份会替换当前站点数据，不会自动合并。

### Debug 签名与诊断日志

当前产物是 Debug APK，Gradle 会使用构建机器上的 Android Debug keystore 自动签名，不是未签名 APK，也尚未配置正式 Release 签名。不同机器或全新 GitHub Actions runner 的 Debug 证书可能不同；CI artifact 只用于构建验证，未经证书比对不能作为已安装版本的覆盖更新包。后续更新应保持现有签名连续性；签名密钥应在仓库外安全保管，不能提交到 Git。改用另一把正式密钥需要单独规划升级兼容性。

保留 `ApiVaultInsets` 与 `ApiVaultTask` 日志：仅在应用具有 `FLAG_DEBUGGABLE` 时启用，记录窗口/视口尺寸、Insets、已知弹窗 ID、生命周期和任务状态，不读取用户输入值、站点内容、URL、便签或 `localStorage`。正式 Release 类型构建不启用这些诊断采样。日志和备份放在本地根目录的 `logs/`、`backups/`，这些目录已被忽略；不要提交个人数据、密钥或设备日志。

### 导出行为

点击 JSON / Markdown 导出只生成预览，不自动下载或分享。一键复制仅复制当前预览格式的文本。各格式保持原有数据内容与文件扩展名。

| 按钮 | Android APK | 普通浏览器 |
| --- | --- | --- |
| 系统分享 | UTF-8 文件写入独立缓存路径，由现有 Capacitor Share 插件打开系统分享面板 | Web Share 文件 API，保留 JSON / Markdown MIME；不支持时明确提示，不自动复制 |
| 保存到文件（不分享）/ 浏览器直接下载 | 本地 `DocumentSaver` 插件使用 `ACTION_CREATE_DOCUMENT`，用户选择目标位置后写入 UTF-8；不调用 Share，也不申请广泛存储权限 | Blob + download 链接，仅报告已请求下载 |

分享和保存使用同一操作锁，防止连续点击重复打开系统界面；离开 App 前关闭导出预览。明确的取消操作仅提示取消，不视为失败，不执行复制或其他回退。保存成功仅在输出流写入并关闭后报告；写入失败时目标提供商可能保留空文件或部分文件，需要用户检查后重试。

分享使用 `exports/<随机标识>/<原文件名>` 缓存路径，避免同日再次导出覆盖仍由外部应用读取的文件。缓存不在分享回调后立即删除，因为回调不代表接收应用已读完；缓存由 Android 管理，需要时可在系统设置中清理缓存（不要清除应用数据）。

### 分享后返回与已知边界

已检查 `@capacitor/share@7.0.2` 的 Android 实现：使用 Activity result 启动 chooser，不主动添加 `NEW_TASK` / 清空任务栈；当前主 Activity 保持 Capacitor 默认的 `singleTask`，没有 `noHistory` 或主动结束 Activity 的代码。本次不修改这些任务栈属性，也不强制拉起 App、刷新 WebView 或重置页面状态。

插件依据 `RESULT_CANCELED` 与 `handleOnStop` 判断取消：离开过 App 后，即使返回 `RESULT_CANCELED`，也可能 resolve 且 `activityType` 为空。因此空结果只提示“分享面板已关闭，系统未报告是否发送”；有目标包名也仅表示选择了应用，不等于实际发送成功。不能依靠插件 promise 完成判断微信已经结束分享或 API Vault 已恢复前台。

微信返回桌面的偶发现象尚未在连接设备上复现，不能据此判定崩溃或宣称已解决。Debug APK 新增 `ApiVaultTask` 生命周期日志，仅记录事件、task ID 和 Activity 状态，不记录内容。连接手机后可分别在复现前后执行：

```powershell
adb devices -l
adb logcat -v threadtime 'ApiVaultTask:D' 'ActivityTaskManager:I' 'ActivityManager:I' '*:S'
# 在另一个终端分别查看：分享前、停留在微信、返回桌面时、重新点图标后
adb shell dumpsys activity activities
```

对比 MainActivity 的 task ID、前台/resumed Activity，以及是否出现新的 create / 原 task resume，才能区分外部 App 返回策略、系统任务切换和 Activity 重建。日志和任务栈输出只在本机排查，不加入仓库。请勿卸载重装或清除应用数据来测试，以免丢失现有本地记录；覆盖安装必须保持相同 applicationId 和签名。

### 布局与图标

页面采用随动态视口变化的 flex 外壳，头部和底栏各占一行，活动内容区 `min-height: 0` + `overflow-y: auto` 独立滚动，不再依靠文档滚动与 fixed 底栏叠加。Android 原生负责系统栏和刘海避让，CSS 不重复添加 Android 安全区。普通浏览器保留 `env(safe-area-inset-*)` 适配。

### Android 键盘与 Insets

Capacitor 7.4.3 的 `CapacitorWebView.edgeToEdgeHandler()` 在 `auto` 模式下只用系统栏和切口 Insets 设置 margin，没有处理 IME，并返回 `CONSUMED`。项目关闭该自动处理，由自有 `WebViewInsets.java` 接管 Android 15+ 的边界；未修改 `node_modules`，未添加 Keyboard 插件。

| 系统版本 | 窗口与键盘策略 |
| --- | --- |
| Android 15+（API 35+） | `setDecorFitsSystemWindows(false)` 保持完整窗口；运行时将调整模式设为 `adjustNothing`，由一个 listener 读取系统栏、切口及 IME Insets，各方向取最大值作为 WebView margin，不相加。消耗已处理的 Insets，避免 WebView 再处理一次。 |
| Android 14 及以下 | 不安装此 listener，不改变窗口 fitting 或软键盘模式，保留 Manifest 的 `adjustResize`。之前的 Capacitor `auto` 在这些版本也不添加 margin。 |

Web 端继续直接使用 VisualViewport 的实测尺寸和偏移，弹窗内部滚动、sticky 操作栏和焦点滚动保持原样；没有在 JS/CSS 中再减去 IME 高度。升级 Capacitor 时应复核内置 Insets 实现，不要同时启用两套边距处理。

Debug APK 的 `ApiVaultInsets` 日志在 Insets 变化时记录 `seq`、`imeVisible`、系统栏/切口与 IME 四边值、应用的 margin 和调整前 WebView 高度；布局后延时采样同一 `seq` 的原生实际宽高、父容器高度、Web `innerHeight` / `clientHeight` / `visualHeight` / `visualTop`、弹窗及焦点矩形。原生单位为 px，Web 单位为 CSS px，记录 `density` 和 `dpr` 方便换算。日志只读尺寸，不读取或记录输入内容、站点、URL 或本地存储，Release 不采样。

```powershell
adb logcat -v threadtime 'ApiVaultInsets:D' '*:S'
```

后续真机回归应分别检查新增分组、编辑分组、新增站点和编辑站点：键盘打开前、打开后、收起后确认 WebView 与 Web 视口变化、当前输入框和操作按钮可见、长表单可滚动。必要时采集日志，核对父容器没有同时缩小、WebView 高度对应父容器减上下 margin。还需检查 Android 14/15、其他 Android 16 设备、刘海/横屏、手势/三键导航和切换前后台。浮动键盘是否遮挡焦点也需真机检查（系统可能不提供底部 IME 避让值）。

已验证记录：用户已在 iQOO Z11 Turbo / Android 16 真机测试并确认键盘遮挡问题通过。该结论来自用户验收，不代表所有输入场景、屏幕方向、导航模式或其他设备均已逐项验证；本地自动化和构建环境没有连接该设备。Node 回归测试与 APK 构建不能替代其他设备的真机验证。

Manifest 引用 `@mipmap/ic_launcher`、`@mipmap/ic_launcher_round`，现已使用 `assets/app-icon.png` 中的正式图案。原始源图保持不变；移除源图外沿和背景后，保留狗狗、墨镜、黑西装、插头及装饰，背景使用从原图采样的蓝色 `#65A0EB`。

Adaptive 图层画布为 108×108 dp，前景限制在中央直径 64 dp 的圆内，为 Android 的 66 dp 安全圆保留余量。Android 8+ 使用现有 `mipmap-anydpi-v26` 自适应 XML 和透明前景；旧版使用各密度下的圆角方形/圆形 PNG。未提供单色图层，不额外设计 Android 13 主题图标。

资源通过等效的标准 Android 资源生成流程产生，没有新增运行时依赖。需要重新生成时，在安装 Pillow 和 NumPy 的 Python 环境执行 `python scripts/generate_launcher_icons.py`；脚本针对当前源图分离背景，覆盖以下 15 个既有 PNG，并输出裁切预览 `android/app/build/icon-preview.png`。替换为其他源图时需重新核对背景分离和 `values/ic_launcher_background.xml` 的颜色。已移除未引用的默认图标 drawable 模板。

| 密度 | Legacy 图标 px | Adaptive 图层 px |
| --- | --- | --- |
| mdpi | 48×48 | 108×108 |
| hdpi | 72×72 | 162×162 |
| xhdpi | 96×96 | 216×216 |
| xxhdpi | 144×144 | 324×324 |
| xxxhdpi | 192×192 | 432×432 |

### 回归验证

`pnpm test` 使用 Node 内置测试运行器，无新增依赖。测试涵盖预览无副作用、两种格式的分享/保存分离、取消和错误提示、防重复调用、MIME/UTF-8、实际导出内容与复制入口、不改变传入数据。键盘回归测试使用模拟视口与元素矩形，覆盖四种输入场景共用的实际 JS 逻辑、原生缩小视口后不重复减高度、焦点滚动、键盘收起、关闭弹窗和浏览器回退；不模拟 Android Insets 分发或真实 DOM 排版。原始 `API-Vault.html` 不参与修改。

真机仍需验证：JSON/Markdown 各自保存并重新打开（含中文/emoji）、取消保存、分享取消和目标应用返回、连续多次微信分享后返回、文件提供商不可写/失败提示、旧记录保持、Android 14/15 状态栏/刘海/手势导航/三键导航、旋转屏幕和键盘出现时的内容滚动。Web 自动化不能替代这些验证。

GitHub Actions 工作流位于 `.github/workflows/android.yml`，在 main 分支 push / PR 时依次配置 pnpm、Node.js 与 pnpm 缓存，使用锁文件安装依赖，运行测试、生成 Web 资源、同步 Capacitor，再执行 Android Debug 构建、单元测试和 lint。`dist/` 不入库，每次从源码重新生成。Linux 构建前会补上 `gradlew` 的可执行权限。

工作流只上传 Debug APK 到 Actions artifact，由 runner 自动进行 Debug 签名；不创建 Tag、GitHub Release，也不上传 Release 附件。正式发布前应核对包名、版本、SHA-256 与签名证书，特别是与用户已安装版本的证书是否一致。

项目源码仓库已公开，目前未选择开源许可证，也未配置正式 Release 签名或自动发布流程；本次准备不新增许可证、不发布新版本，也不覆盖已有 `v0.3.0` Release。
