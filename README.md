# Stem Studio

本地运行的 Demucs 音频分离桌面应用，面向 macOS 和 Windows。所有文件在本机处理，不上传网络。

## 功能

- 标准四轨（`htdemucs`）与高质量六轨（`htdemucs_6s`）两种分离模式
- **批量任务队列**：多选/多文件拖拽，顺序处理；任务进行中拖入的文件自动加入队列
- **任务历史**：最近 50 条记录持久化，可从历史直接打开导出目录
- 可勾选只导出需要的音轨（人声、鼓、贝斯、钢琴、吉他、其他）
- 导出格式：WAV / FLAC / MP3 320kbps；性能档位：快速（1 遍）/ 均衡（2 遍）/ 极致（10 遍）
- 进度显示已用时与预计剩余时间；多文件时显示总进度；完成后系统通知（窗口不在前台时）
- 设置页：自定义 Demucs 引擎路径、默认导出位置（持久化保存）
- macOS 自动使用 MPS 加速，失败时自动回退 CPU 重试
- 任务取消会终止整个 Demucs 进程树；关闭窗口时自动清理运行中任务
- 启动前检测磁盘剩余空间与 FFmpeg 依赖，常见失败（内存不足、模型下载失败、解码失败）有友好提示

## 开发运行

```bash
npm install
npm start
npm run lint   # 语法检查
npm test       # 单元测试（node:test，覆盖 src/lib.js 纯逻辑）
```

CI：`.github/workflows/ci.yml` 在 macOS / Windows / Ubuntu 上跑 lint + 测试。

### Demucs 引擎发现顺序

1. 应用设置中配置的引擎路径（界面“设置”里选择，存于 userData/settings.json）
2. 环境变量 `STEM_STUDIO_DEMUCS`
3. 打包资源内的 `resources/engine/`（macOS：`bin/demucs`；Windows：`Scripts/demucs.exe`）
4. 系统 PATH 中的 `demucs`

开发时如系统未安装 Demucs：

```bash
STEM_STUDIO_DEMUCS=/绝对路径/到/demucs npm start
```

## 输出目录结构

```
<导出位置>/<模型名>/<源文件名>/vocals.wav …
```

导出位置默认为源文件同级的 `Stem Studio Exports`，可在设置中改为固定目录。

## 打包

```bash
npm run package:mac  # 生成 DMG
npm run package:win  # 生成 Windows 安装 EXE
```

Windows 应在 Windows CI/机器上打包。发布版需要为每个平台附带对应 Python + PyTorch + Demucs 运行时；本项目当前先使用系统/开发环境内已有的 Demucs，避免把数 GB 的推理引擎直接纳入原型包。引擎分发方案见项目文档《引擎分发方案》。
