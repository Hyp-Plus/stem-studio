# Stem Studio — Claude Code 项目说明

本地离线运行的桌面音频/视频分轨工具。Electron + 本地 Demucs CLI 推理，目标平台 macOS / Windows。全中文 UI，文件不上传网络。当前版本 v0.7.0。

## 常用命令

```bash
npm install        # 安装依赖
npm start          # 开发运行
npm run lint       # node --check 四个 JS 文件
npm test           # node:test 单元测试（test/lib.test.js，9 用例）
npm run package:mac / package:win   # electron-builder 打包
```

系统没装 Demucs 时开发运行：`STEM_STUDIO_DEMUCS=/path/to/demucs npm start`

## 架构

- `src/lib.js` — 纯逻辑（无 Electron 依赖，唯一有单测的层）：demucs 参数组装 `buildDemucsArgs`、进度状态机 `nextProgress`、错误归类 `classifyFailure`、设置白名单 `sanitizeSettings`
- `src/main.js` — 主进程：任务队列调度（顺序处理，运行中可追加）、引擎发现、进程树终止（win: taskkill /T /F；posix: detached + 负 pid 进程组 + SIGKILL 兜底）、MPS 失败自动回退 CPU 一次、设置/历史持久化（userData/settings.json、history.json 上限 50 条）、系统通知
- `src/preload.js` — contextBridge 暴露 `window.stemStudio`（含 webUtils.getPathForFile 供拖拽取路径）
- `src/renderer.js` — UI 状态、拖拽、队列/历史渲染、ETA 估算、设置面板
- `test/lib.test.js` — lib 的 9 个用例

引擎发现顺序：设置里的路径 → 环境变量 `STEM_STUDIO_DEMUCS` → 打包资源（mac `resources/engine/bin/demucs`、win `resources/engine/Scripts/demucs.exe`）→ PATH。
输出结构：`<导出位置>/<模型名>/<源文件名>/<stem>.<ext>`。

## 约定

- 每次功能迭代 bump 一次 minor 版本并单独 commit（v0.2.0 → v0.6.1 均如此）
- 提交信息、UI 文案、注释都用中文
- 新的纯逻辑一律放 `src/lib.js` 并补测试；主进程只做编排和 IO

## 当前重要待办（按优先级）

1. 引擎分发 P2：按平台拆分路线并打包验证——Windows 用 ONNX+DML（需实机验证 DML），macOS 在「冻结原版 demucs（保 MPS，~510M）」与「ONNX+CPU（~320M 但慢 2–3 倍）」间决断。P1 质量对比已完成：质量达标，macOS CoreML 编译失败，详见 `docs/引擎分发-P1-质量对比.md`
2. P2 后续：P3 应用内模型下载（SHA256+断点续传）→ P4 附带静态 ffmpeg → P5 签名/notarization
3. 后续产品项：设置更多项（设备选择、shifts 自定义）、htdemucs_ft 高保真模式、导出命名模板、代码签名/notarization、内置 ffmpeg

已完成（2026-07-26 第二轮会话）：ci.yml 已移入 `.github/workflows/`；真实媒体端到端实测通过（批量队列、运行中追加、取消与进程树终止、六轨勾选过滤、视频输入、损坏文件错误归类；MPS 回退因无法构造 MPS 故障未覆盖）；实测发现失败原因不展示的缺陷已修（v0.7.0）；UI 间距与行内顺序微调已做；package-lock.json 已入库。

## 已知环境事实

- 用户开发机 demucs 位置：`/Users/haruki/Documents/Codex/2026-07-04/gi/.venv-demucs/bin/demucs`（勿再硬编码进代码，仅供测试时在设置页选择）
- `安装到应用程序.command`：一键 npm install → package:mac → 复制到 /Applications（已 chmod +x）
- `dist/` 里的 v0.1 DMG 是过时旧构建，可删；`.git/_to_delete/` 是云端会话残留的 git 锁文件，可整体删除
- 打包后的 app 读不到 shell 环境变量，引擎路径必须走设置页
