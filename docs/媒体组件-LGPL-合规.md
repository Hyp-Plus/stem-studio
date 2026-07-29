# 一键媒体组件：构建与合规

Stem Studio 的安装包不携带 FFmpeg。需要视频输入或混音导出时，用户可在应用内主动下载媒体组件。

## 发布物

每个版本的 GitHub Release 必须同时提供：

- 各平台 `ffmpeg` / `ffprobe` 可执行文件；
- 对应的 `stem-studio-media-*.json` 文件（URL、字节数、SHA-256、构建参数）；
- 对应的 FFmpeg 官方源码压缩包；
- 对应平台的 LGPL 2.1 文本（`FFMPEG-LGPL-2.1-macos-arm64.txt` 或 `FFMPEG-LGPL-2.1-windows-x64.txt`）。

应用仅接受当前版本 Release、`github.com` / `githubusercontent.com` HTTPS 地址、固定文件名和 64 位 SHA-256 的清单；下载后逐文件校验。

## 构建约束

构建脚本显式使用：

```text
--disable-gpl --disable-nonfree --disable-autodetect --disable-debug --disable-doc --disable-shared --enable-static --enable-small
```

不得加入 `--enable-gpl`、`--enable-nonfree`，也不得启用 GPL 外部库（例如 x264/x265）。构建脚本会拒绝 FFmpeg 自报包含 nonfree 部分的产物。

这套流程用于满足开源许可证的分发要求，不构成对音视频编解码专利或任一司法辖区法律风险的法律意见。
