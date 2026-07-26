# Stem Studio：完整交接说明

> 交接时间：2026-07-26 ｜ 当前版本 v0.6.1 ｜ main 分支 6 个 commit ｜ 仓库：`/Users/haruki/Documents/New project 2`

## 一、项目定位

本地离线运行的桌面音频/视频分轨工具 **Stem Studio**。
技术路线：Electron + 本地 Demucs 命令行推理引擎，目标平台 macOS 和 Windows。用户选择/拖入媒体文件，分离为多个音轨（人声、鼓、贝斯、钢琴、吉他、其他）；处理全程本机完成，不上传网络。中文深色单页 UI。

## 二、提交历史（本次会话完成）

| commit | 版本 | 内容 |
|---|---|---|
| `d7c91a3` | v0.2.0 | 初始提交：移除开发机硬编码引擎路径、设置页（引擎路径/默认导出目录持久化）、进程树终止、MPS→CPU 自动回退、按 pass 归一化进度、磁盘/FFmpeg 前置检测、错误中文归类、音轨勾选、WAV/FLAC/MP3、三档性能、拖拽导入 |
| `4007e0a` | v0.3.0 | 批量任务队列（多选/多文件拖拽、顺序处理、运行中拖入自动加队列、逐文件状态与打开入口、取消全部）+ 任务历史（50 条持久化） |
| `cfa29f5` | v0.4.0 | 已用时/预计剩余估算、多文件总进度、完成后系统通知（后台时）、回车快捷键、页脚版本号 |
| `6461264` | v0.5.0 | 抽取 `src/lib.js` 纯逻辑层 + `test/lib.test.js` 9 个 node:test 用例（全通过）+ 三平台 CI 工作流 |
| `3fc0b4a` | v0.6.0 | 记住上次分离模式、窗口大小/位置持久化、音轨全选/清空 |
| `68b10f4` | v0.6.1 | productName 更名 "Stem Studio"（原 "Stem Studio v0.1"）、新增一键安装脚本 `安装到应用程序.command` |

## 三、文件与架构

```
src/lib.js        纯逻辑（无 Electron 依赖，可单测）：buildDemucsArgs / nextProgress / classifyFailure / sanitizeSettings / isVideoPath 及各常量表
src/main.js       主进程：队列调度、引擎发现、spawn 与进程树终止、设置/历史持久化、系统通知、IPC
src/preload.js    contextBridge → window.stemStudio（含 webUtils.getPathForFile）
src/renderer.js   UI 状态、拖拽、队列/历史渲染、ETA、设置面板
src/index.html    界面结构；src/styles.css 深色样式
test/lib.test.js  9 个用例（npm test）
ci.yml            ⚠ 在根目录，需手动移入 .github/workflows/（见"待办"）
安装到应用程序.command  一键打包安装脚本（已 chmod +x）
CLAUDE.md         Claude Code 项目说明（架构、命令、约定）
```

核心命令行：`demucs -n <htdemucs|htdemucs_6s> --float32 --clip-mode rescale [--mp3 --mp3-bitrate 320|--flac] [--shifts N --overlap X] [-d mps|cpu] -o <root> <input>`
性能档位 → shifts/overlap：快速 1/0.25、均衡 2/0.5、极致 10/0.75。
输出结构：`<导出位置>/<模型名>/<源文件名>/<stem>.<ext>`；导出位置默认源文件同级 `Stem Studio Exports`，可设固定目录。

引擎发现顺序：设置路径（userData/settings.json）→ `STEM_STUDIO_DEMUCS` → 打包资源（mac `engine/bin/demucs`、win `engine/Scripts/demucs.exe`）→ PATH。
持久化：设置 `userData/settings.json`（enginePath/defaultOutputDir/format/performance/lastMode/windowBounds）；历史 `userData/history.json`（上限 50）。

关键可靠性设计：任务取消终止整个进程树（Windows `taskkill /pid X /T /F`；POSIX spawn 时 detached 成进程组组长，负 pid SIGTERM + 3 秒后 SIGKILL）；窗口关闭/退出时清理运行中任务；macOS 默认 `-d mps`，失败且日志含 mps 时自动改 `-d cpu` 重试一次；启动前检测磁盘空间（2GB×队列数）与视频输入的 FFmpeg 依赖；失败日志归类为中文提示（内存不足/模型下载失败/无法解码等）。

## 四、工程化状态

- `npm run lint`：node --check main/preload/renderer/lib
- `npm test`：node --test，9/9 通过
- CI：三平台（macOS/Windows/Ubuntu）lint+test，**工作流文件还在根目录 `ci.yml`**（远程写入 `.github/workflows/` 被安全策略拦截），需要：`mkdir -p .github/workflows && mv ci.yml .github/workflows/`
- 无 package-lock.json（CI 里用 npm install 而非 npm ci）
- 打包：`npm run package:mac` / `package:win`（Windows 必须在 Windows 上打）

## 五、⚠ 重要待办与已知问题

1. **端到端未验证**：v0.2.0 之后所有功能只过了静态检查 + lib 单测 + Chromium 模拟引擎的 UI 演示，**从未在真实媒体文件上跑通完整分离**。最优先：本机 `npm start` 实测批量队列、取消、MPS 回退、进度解析。
2. **ci.yml 待移位**（见上）。
3. **引擎分发是最大发布阻塞项**：打包产物不带 Demucs/Python/PyTorch。推荐路线：ONNX Runtime（demucs-onnx，MIT，PyPI 同名）——推理只需 onnxruntime+numpy（~50MB，对比 PyTorch ~2GB）；模型 htdemucs 316MB(fp32)/166MB(fp16)、htdemucs_6s 258MB、htdemucs_ft bag 1.26GB。分阶段：P1 用同一首歌对比 demucs vs demucs-onnx 输出质量 → P2 PyInstaller 冻结 demucs-onnx CLI 放入 resources/engine/（沿用现有发现逻辑）→ P3 应用内模型下载（SHA256 校验+断点续传，缓存 userData/models/，--repo 离线加载）→ P4 附带静态 ffmpeg → P5 签名/notarization + GitHub Actions。备选：PyInstaller 冻结原版 demucs（NumPy 必须锁 1.x，体积含 torch）。参考：github.com/StemSplit/demucs-onnx、huggingface.co/StemSplitio/htdemucs-onnx、Mixxx GSoC 2025 Demucs→ONNX 博文。
4. **UI 微调**：①「导出音轨」标签行与上方模式卡片间距偏小；②队列行「完成」chip 与「打开」按钮建议对调（状态前、操作后）。
5. **环境清理**：`dist/` 里的 v0.1 DMG 是过时旧构建可删；`.git/_to_delete/` 是云端会话产生的 git 锁残留可整体删除。
6. **打包后的 app 读不到 shell 环境变量**：引擎路径必须在应用「设置」里选（用户机器上的 demucs 在 `/Users/haruki/Documents/Codex/2026-07-04/gi/.venv-demucs/bin/demucs`，切勿再硬编码进代码）。
7. 后续产品项：任务历史已做；还可做设置更多项（设备选择、shifts 自定义）、htdemucs_ft 高保真模式、导出命名模板等。

## 六、协作约定（用户偏好）

- 小步迭代：后端、前端交替优化，可适当延伸；**每次迭代 bump 一次 minor 版本并单独 commit**
- 提交信息、UI 文案、代码注释均用中文
- 新纯逻辑放 `src/lib.js` 并补单测；主进程只做编排与 IO

## 七、运行速查

```bash
npm install && npm start                       # 开发运行
STEM_STUDIO_DEMUCS=/path/to/demucs npm start   # 未安装 demucs 时
npm run lint && npm test                       # 检查
npm run package:mac                            # 打包 macOS
bash 安装到应用程序.command                      # 打包并安装到 /Applications（或直接双击）
# 首次打开未签名应用：应用程序里 右键 → 打开
```
