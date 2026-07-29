#!/usr/bin/env bash
# 构建可再分发的 macOS 媒体组件：仅 FFmpeg LGPL 功能，不启用 GPL/nonfree 或外部编解码库。
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
tag="${1:?请传入 Release 标签，例如 v0.17.0}"
version="8.1.2"
out="$root/media-dist/macos-arm64"
work="$(mktemp -d)"
source_url="https://ffmpeg.org/releases/ffmpeg-${version}.tar.xz"

curl --fail --location --retry 3 --output "$work/ffmpeg.tar.xz" "$source_url"
tar -xf "$work/ffmpeg.tar.xz" -C "$work"
cd "$work/ffmpeg-${version}"
./configure --disable-gpl --disable-nonfree --disable-autodetect --disable-debug --disable-doc \
  --disable-shared --enable-static --enable-small
make -j"$(sysctl -n hw.ncpu)"

mkdir -p "$out"
cp ffmpeg "$out/stem-studio-ffmpeg-macos-arm64"
cp ffprobe "$out/stem-studio-ffprobe-macos-arm64"
cp "$work/ffmpeg.tar.xz" "$out/stem-studio-ffmpeg-${version}-source-macos-arm64.tar.xz"
cp COPYING.LGPLv2.1 "$out/FFMPEG-LGPL-2.1-macos-arm64.txt"
./ffmpeg -L | grep -qi 'nonfree parts' && { echo '错误：构建包含 nonfree 部分'; exit 1; } || true

python3 - "$out" "$tag" "$version" <<'PY'
import hashlib, json, pathlib, sys
out = pathlib.Path(sys.argv[1]); tag, version = sys.argv[2:]
base = f"https://github.com/Hyp-Plus/stem-studio/releases/download/{tag}"
files = []
for name, asset in (("ffmpeg", "stem-studio-ffmpeg-macos-arm64"), ("ffprobe", "stem-studio-ffprobe-macos-arm64")):
    path = out / asset
    files.append({"name": name, "url": f"{base}/{asset}", "sha256": hashlib.sha256(path.read_bytes()).hexdigest(), "bytes": path.stat().st_size})
manifest = {"version": version, "license": "LGPL-2.1-or-later", "source": {"url": f"{base}/stem-studio-ffmpeg-{version}-source-macos-arm64.tar.xz", "configure": "--disable-gpl --disable-nonfree --disable-autodetect --disable-debug --disable-doc --disable-shared --enable-static --enable-small"}, "files": files}
(out / "stem-studio-media-macos-arm64.json").write_text(json.dumps(manifest, indent=2) + "\n")
PY

echo "媒体组件构建完成：$out"
