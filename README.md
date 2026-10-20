# API Vault

API Vault 是一个纯本地的站点书签与随手记工具，保留原有单页 HTML 体验，并使用 Vite、Tailwind CSS 和 Capacitor 构建 Web 与 Android 版本。

## 本地开发

```powershell
pnpm install
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

页面采用随动态视口变化的 flex 外壳，头部和底栏各占一行，活动内容区 `min-height: 0` + `overflow-y: auto` 独立滚动，不再依靠文档滚动与 fixed 底栏叠加。Android 使用 Capacitor 7 的 `adjustMarginsForEdgeToEdge: auto`，在 Android 15 强制 Edge-to-Edge 时由原生处理系统栏和刘海边距；CSS 不再重复添加 Android 安全区。普通浏览器保留 `env(safe-area-inset-*)` 适配。

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

`pnpm test` 使用 Node 内置测试运行器，无新增依赖。测试涵盖预览无副作用、两种格式的分享/保存分离、取消和错误提示、防重复调用、MIME/UTF-8、实际导出内容与复制入口、不改变传入数据。原始 `API-Vault.html` 不参与修改。

真机仍需验证：JSON/Markdown 各自保存并重新打开（含中文/emoji）、取消保存、分享取消和目标应用返回、连续多次微信分享后返回、文件提供商不可写/失败提示、旧记录保持、Android 14/15 状态栏/刘海/手势导航/三键导航、旋转屏幕和键盘出现时的内容滚动。Web 自动化不能替代这些验证。

GitHub Actions 工作流位于 `.github/workflows/android.yml`，在 push/PR 时构建 Web 资源、同步 Capacitor 并上传 Debug APK artifact。工作流不会签名或发布 APK。

当前项目未选择开源许可证，也未配置公开仓库或签名发布流程。
