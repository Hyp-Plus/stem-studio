#!/usr/bin/env bash
# 在 GitHub Actions 的 MSYS2/MINGW64 环境中构建 Windows x64 LGPL-only FFmpeg 组件。
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
tag="${1:?请传入 Release 标签，例如 v0.17.0}"
version="8.1.2"
out="$root/media-dist/windows-x64"
work="$(mktemp -d)"
source_url="https://ffmpeg.org/releases/ffmpeg-${version}.tar.xz"

curl --fail --location --retry 3 --output "$work/ffmpeg.tar.xz" "$source_url"
tar -xf "$work/ffmpeg.tar.xz" -C "$work"
cd "$work/ffmpeg-${version}"
# MINGW64 shell 已经提供目标平台的 gcc/ar/ranlib，无需再指定交叉编译前缀。
./configure --target-os=mingw32 --arch=x86_64 \
  --disable-gpl --disable-nonfree --disable-autodetect --disable-debug --disable-doc \
  --disable-shared --enable-static --enable-small
make -j"$(nproc)"

mkdir -p "$out"
cp ffmpeg.exe "$out/stem-studio-ffmpeg-windows-x64.exe"
cp ffprobe.exe "$out/stem-studio-ffprobe-windows-x64.exe"
cp "$work/ffmpeg.tar.xz" "$out/stem-studio-ffmpeg-${version}-source-windows-x64.tar.xz"
cp COPYING.LGPLv2.1 "$out/FFMPEG-LGPL-2.1.txt"
./ffmpeg.exe -L | grep -qi 'nonfree parts' && { echo '错误：构建包含 nonfree 部分'; exit 1; } || true

python - "$out" "$tag" "$version" <<'PY'
import hashlib, json, pathlib, sys
out = pathlib.Path(sys.argv[1]); tag, version = sys.argv[2:]
base = f"https://github.com/Hyp-Plus/stem-studio/releases/download/{tag}"
files = []
for name, asset in (("ffmpeg.exe", "stem-studio-ffmpeg-windows-x64.exe"), ("ffprobe.exe", "stem-studio-ffprobe-windows-x64.exe")):
    path = out / asset
    files.append({"name": name, "url": f"{base}/{asset}", "sha256": hashlib.sha256(path.read_bytes()).hexdigest(), "bytes": path.stat().st_size})
manifest = {"version": version, "license": "LGPL-2.1-or-later", "source": {"url": f"{base}/stem-studio-ffmpeg-{version}-source-windows-x64.tar.xz", "configure": "--disable-gpl --disable-nonfree --disable-autodetect --disable-debug --disable-doc --disable-shared --enable-static --enable-small"}, "files": files}
(out / "stem-studio-media-windows-x64.json").write_text(json.dumps(manifest, indent=2) + "\n")
PY

echo "媒体组件构建完成：$out"
