<p align="center">
  <img src="assets/icon-512.png" width="128" alt="Stem Studio 图标" />
</p>

<h1 align="center">Stem Studio</h1>

<p align="center">把声音拆开，听见每一层。<br/>本地运行的 Demucs 音频/视频分轨桌面应用（macOS / Windows）——所有文件在本机处理，不上传网络。</p>

<p align="center">
  <img src="assets/screenshot.png" width="720" alt="应用界面" />
</p>

## 下载

前往 **[Releases](https://github.com/Hyp-Plus/stem-studio/releases)** 下载最新版：

- **macOS**（Apple Silicon，macOS 12+）：`Stem Studio-<版本>-mac-arm64.dmg`
- **Windows**（x64）：`Stem Studio-<版本>-win-x64.exe` — ⚠️ 构建已通过 CI，但尚未在实机验证，遇到问题欢迎提 issue

应用未签名（个人开发者，无 Apple Developer 证书），macOS 首次打开：

1. 打开 dmg，把 Stem Studio 拖入「应用程序」
2. 在「应用程序」里**右键 → 打开**（只需一次；直接双击会被 Gatekeeper 拦下）
3. 如仍提示已损坏，在终端执行：`xattr -dr com.apple.quarantine "/Applications/Stem Studio.app"`

## 功能

- 标准四轨（`htdemucs`）与高质量六轨（`htdemucs_6s`）两种分离模式，可勾选只导出需要的音轨（人声、鼓、贝斯、钢琴、吉他、其他）
- **开箱即用**：分离引擎与 FFmpeg 均已内置，音频、视频文件直接拖入即可
- **批量任务队列**：多选/多文件拖拽，顺序处理；任务进行中拖入的文件自动加入队列
- **模型管理**：设置页可预下载模型、断点续传、离线导入，全部经 SHA256 完整校验
- **任务历史**：最近 50 条记录持久化，失败原因留档，可从历史直接打开导出目录
- 导出格式 WAV / FLAC / MP3 320kbps；性能档位 快速（1 遍）/ 均衡（2 遍）/ 极致（10 遍）
- 进度显示已用时与预计剩余；多文件显示总进度；完成后系统通知（窗口不在前台时）
- macOS 自动使用 MPS（Apple Silicon GPU）加速，失败自动回退 CPU 重试
- 任务取消终止整个引擎进程树；启动前检测磁盘空间；常见失败均有中文提示

## 安装（macOS）

```bash
bash 安装到应用程序.command
```

一键完成依赖安装 → 引擎构建 → 打包 → 安装到「应用程序」。应用未签名，首次打开请右键 → 打开。

## 开发

```bash
npm install
npm start                # 开发运行（无内置引擎时：STEM_STUDIO_DEMUCS=/path/to/demucs npm start）
npm run lint && npm test # 语法检查 + 单元测试（node:test，覆盖 src/lib.js 纯逻辑）
```

CI：`.github/workflows/ci.yml` 三平台 lint + 测试；`build-engine.yml`（手动触发）冻结双平台分离引擎并上传 artifact。

### 引擎与 FFmpeg 发现顺序

引擎：设置页配置的路径 → 环境变量 `STEM_STUDIO_DEMUCS` → 打包资源 `resources/engine/`（mac `bin/demucs`、win `Scripts/demucs.exe`）→ 系统 PATH。
FFmpeg：打包资源 `resources/ffmpeg/` → 环境变量 `STEM_STUDIO_FFMPEG` → 系统 PATH（spawn 引擎时前置注入，引擎无需感知）。

## 打包发布

```bash
bash scripts/build-engine-mac.sh                 # ① 冻结分离引擎（macOS：原版 demucs，保 MPS）
npm run package:mac                              # ② 打包 DMG（自动整理静态 ffmpeg/ffprobe）
# Windows 对应：scripts/build-engine-win.ps1（demucs-onnx + DirectML）+ npm run package:win
```

模型不随包分发（四轨 80 MB / 六轨 52 MB），首次分离自动下载，或在设置页「模型管理」预下载/离线导入。
引擎分发的技术决策与实测数据见 `docs/引擎分发-P1-质量对比.md` 与 `docs/引擎分发-P2-打包接入.md`。

## 输出目录结构

```
<导出位置>/<模型名>/<源文件名>/vocals.wav …
```

导出位置默认为源文件同级的 `Stem Studio Exports`，可在设置中改为固定目录。
