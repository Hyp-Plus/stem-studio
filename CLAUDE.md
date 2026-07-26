# Stem Studio — Claude Code 项目说明

本地离线运行的桌面音频/视频分轨工具。Electron + 本地 Demucs CLI 推理，目标平台 macOS / Windows。全中文 UI，文件不上传网络。当前版本 v0.10.0。

## 常用命令

```bash
npm install        # 安装依赖
npm start          # 开发运行
npm run lint       # node --check 四个 JS 文件
npm test           # node:test 单元测试（test/lib.test.js，14 用例）
npm run package:mac / package:win   # electron-builder 打包（自动先跑 prepare:ffmpeg）
bash scripts/build-engine-mac.sh    # 打包前先构建引擎（产物 engine-dist/，已 gitignore）
powershell -File scripts/build-engine-win.ps1   # Windows 引擎（demucs-onnx+DML）
npm run prepare:ffmpeg              # 整理静态 ffmpeg/ffprobe 到 ffmpeg-dist/（已 gitignore）
```

系统没装 Demucs 时开发运行：`STEM_STUDIO_DEMUCS=/path/to/demucs npm start`

## 架构

- `src/lib.js` — 纯逻辑（无 Electron 依赖，唯一有单测的层）：demucs 参数组装 `buildDemucsArgs`、进度状态机 `nextProgress`、错误归类 `classifyFailure`、设置白名单 `sanitizeSettings`、模型注册表 `MODEL_FILES`（URL/SHA256/大小）与下载辅助（`resumeRange`/`downloadPercent`/`verifyModelDigest`/`classifyDownloadFailure`）
- `src/main.js` — 主进程：任务队列调度（顺序处理，运行中可追加）、引擎发现、进程树终止（win: taskkill /T /F；posix: detached + 负 pid 进程组 + SIGKILL 兜底）、MPS 失败自动回退 CPU 一次、设置/历史持久化（userData/settings.json、history.json 上限 50 条）、系统通知
- `src/preload.js` — contextBridge 暴露 `window.stemStudio`（含 webUtils.getPathForFile 供拖拽取路径）
- `src/renderer.js` — UI 状态、拖拽、队列/历史渲染、ETA 估算、设置面板
- `test/lib.test.js` — lib 的 14 个用例
- `engine/demucs_shim.py` — ONNX 引擎适配层：以原版 demucs CLI 契约驱动 demucs_onnx（Windows 路线用；应用零改动）

引擎发现顺序：设置里的路径 → 环境变量 `STEM_STUDIO_DEMUCS` → 打包资源（mac `resources/engine/bin/demucs`、win `resources/engine/Scripts/demucs.exe`）→ PATH。
输出结构：`<导出位置>/<模型名>/<源文件名>/<stem>.<ext>`。

## 约定

- 每次功能迭代 bump 一次 minor 版本并单独 commit（v0.2.0 → v0.6.1 均如此）
- 提交信息、UI 文案、注释都用中文
- 新的纯逻辑一律放 `src/lib.js` 并补测试；主进程只做编排和 IO

## 当前重要待办（按优先级）

1. Windows 实机验证：跑 `scripts/build-engine-win.ps1`（或 CI 的 build-engine 工作流），验证 DML 执行器在 htdemucs 上可用（mac 的 CoreML 就编译失败，不能想当然）、NSIS 打包接入 `engine-dist/Scripts`；注意 Windows 引擎走 demucs_onnx，模型格式是 .onnx 而非 .th，P3 的模型管理需在 Windows 路线落地时扩展注册表。仓库尚无 GitHub 远程、gh 未登录——用 CI 验证前需先建远程仓库并推送
2. P5 签名/notarization + CI 出正式安装包（本机无 Developer ID 证书）
3. 后续产品项：设置更多项（设备选择、shifts 自定义）、htdemucs_ft 高保真模式、导出命名模板

已完成（2026-07-26/27 第二轮会话）：端到端实测全通过并修复失败原因不展示缺陷（v0.7.0）；UI 微调；引擎分发 P1 质量对比（v0.8.0 前，`docs/引擎分发-P1-质量对比.md`）；P2 冻结引擎接入打包（v0.8.0，`docs/引擎分发-P2-打包接入.md`，macOS 选定冻结原版 demucs 保 MPS，Windows 构建链就绪待实机）；P3 应用内模型下载管理（v0.9.0，SHA256+断点续传+离线导入，全路径实测）；P4 内置静态 FFmpeg（v0.10.0，发布形态 942M 打包版在零环境变量下完成视频分离）。

## 已知环境事实

- 用户开发机 demucs 位置：`/Users/haruki/Documents/Codex/2026-07-04/gi/.venv-demucs/bin/demucs`（勿再硬编码进代码，仅供测试时在设置页选择）
- `安装到应用程序.command`：一键 npm install → package:mac → 复制到 /Applications（已 chmod +x）
- 打包后的 app 读不到 shell 环境变量；引擎/ffmpeg 均已内置，无需用户配置
- 本机网络对 GitHub/PyPI 直连易断；Electron 下载可用 `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/`
