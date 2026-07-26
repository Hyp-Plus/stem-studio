#!/bin/bash
# Stem Studio 一键打包并安装到「应用程序」文件夹
# 双击运行即可；如系统提示无法打开，先在终端执行：chmod +x 安装到应用程序.command
set -e
cd "$(dirname "$0")"

echo "════════════════════════════════════"
echo "  Stem Studio 打包安装"
echo "════════════════════════════════════"

echo ""
echo "▶ 第 1 步：安装依赖（首次较慢）…"
npm install

echo ""
echo "▶ 第 2 步：构建分离引擎（首次需下载 PyTorch，较慢）…"
if [ ! -x "engine-dist/bin/demucs" ]; then
  bash scripts/build-engine-mac.sh
else
  echo "engine-dist/bin 已存在，跳过（如需重建请删除该目录）"
fi

echo ""
echo "▶ 第 3 步：打包 macOS 应用…"
npm run package:mac

echo ""
echo "▶ 第 4 步：安装到 /Applications …"
APP="dist/mac-arm64/Stem Studio.app"
if [ ! -d "$APP" ]; then
  APP=$(ls -d dist/mac*/*.app 2>/dev/null | head -1)
fi
if [ -z "$APP" ] || [ ! -d "$APP" ]; then
  echo "✗ 未找到打包产物，请检查上方 electron-builder 输出。"
  exit 1
fi
rm -rf "/Applications/Stem Studio.app"
cp -R "$APP" "/Applications/Stem Studio.app"

echo ""
echo "✅ 完成！Stem Studio 已安装到「应用程序」。"
echo ""
echo "提示："
echo "· 应用未签名，首次打开请在「应用程序」里右键 → 打开"
echo "· 分离引擎已内置（自动检测即可用）；如需改用其他引擎，"
echo "  在界面底部「设置」里选择路径，选一次永久生效"
echo "· 首次分离会自动下载模型（四轨 80M / 六轨 53M）到 ~/.cache/torch"
open /Applications
