<p align="center">
  <img src="assets/icon-512.png" width="128" alt="Stem Studio 图标" />
</p>

<h1 align="center">Stem Studio：开源音频分离器</h1>

<p align="center">本地离线分离人声、鼓、贝斯、钢琴、吉他等音轨。<br/>Demucs 驱动，macOS / Windows 可用；文件仅在本机处理，不上传网络。</p>

<p align="center">
  <img src="assets/stem-studio-v0.14.jpg" width="720" alt="Stem Studio v0.14 主界面：快速分离与标准四轨推荐" />
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
- **一键媒体支持**：音频可直接处理；首次使用视频输入或混音导出时，可在应用内一键安装并校验 LGPL-only 媒体组件
- **批量任务队列**：多选/多文件拖拽，顺序处理；任务进行中拖入的文件自动加入队列
- **更顺的首次体验**：标准四轨推荐、快速分离入口，以及首次模型下载提示
- **模型管理**：设置页可预下载模型、断点续传、离线导入，全部经 SHA256 完整校验
- **任务历史**：最近 50 条记录持久化，失败原因留档，可从历史直接打开导出目录
- 单项任务可取消或重试；同名文件输出冲突会在开始前拦截，避免覆盖结果
- 分离完成后可直接进入工作台试听、静音/solo 各轨并导出混音；设置中可检查新版本
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
FFmpeg：安装包本体不携带 FFmpeg。首次使用视频输入或工作台混音导出时，可在「设置 → 媒体组件」一键下载 Stem Studio CI 构建的 LGPL-only 组件；下载过程会校验 SHA256。高级用户也可用 `STEM_STUDIO_FFMPEG` 指向自行安装的版本。

## 打包发布

```bash
bash scripts/build-engine-mac.sh                 # ① 冻结分离引擎（macOS：原版 demucs，保 MPS）
npm run package:mac                              # ② 打包 DMG（不分发 FFmpeg 二进制）
# Windows 对应：scripts/build-engine-win.ps1（demucs-onnx + DirectML）+ npm run package:win
```

模型不随包分发（四轨 80 MB / 六轨 52 MB），首次分离自动下载，或在设置页「模型管理」预下载/离线导入。
引擎分发的技术决策与实测数据见 `docs/引擎分发-P1-质量对比.md` 与 `docs/引擎分发-P2-打包接入.md`。

## 版权与第三方许可

- 请仅处理拥有版权或已获授权的音频、视频；本项目不授予任何音乐作品、录音或视频的使用权。
- 分离引擎基于 Demucs；模型权重由其上游官方地址按需下载，不随安装包分发。使用模型前请确认其上游许可适合您的用途，特别是商业用途。
- 媒体组件由 CI 从 FFmpeg 官方源码构建，显式关闭 GPL 与 nonfree 选项；同一 Release 提供对应源码、构建参数和 LGPL 文本。编解码专利与当地法律要求仍需自行评估。
- 随包提供的第三方组件、版权归属与许可证见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。Stem Studio 与 Meta、Demucs 或 FFmpeg 项目没有隶属或官方关联。

## 输出目录结构

```
<导出位置>/<模型名>/<源文件名>/vocals.wav …
```

导出位置默认为源文件同级的 `Stem Studio Exports`，可在设置中改为固定目录。
