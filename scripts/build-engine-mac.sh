#!/usr/bin/env bash
# Stem Studio macOS 引擎构建脚本（原版 demucs + MPS 路线）
# 产物：engine-dist/bin/demucs（+ _internal/），符合主进程引擎发现
# 布局 resources/engine/bin/demucs。用法：bash scripts/build-engine-mac.sh
# 依赖：python3 >= 3.10（brew install python@3.12）
#
# 路线依据（详见 docs/引擎分发-P1-质量对比.md）：mac 版 torch 无 CUDA 库，
# 冻结产物 ~511M 但保留 MPS 加速（比 ONNX+CPU 快 2–3 倍），模型仅 80M。
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
venv="$root/.venv-engine"
dist="$root/engine-dist"
python_bin="${STEM_STUDIO_PYTHON:-$(command -v python3.12 || command -v python3)}"

# 1. 独立虚拟环境
if [ ! -x "$venv/bin/pyinstaller" ]; then
  "$python_bin" -m venv "$venv"
  # demucs 依赖 NumPy 1.x（2.x 会崩，见 HANDOFF.md）
  "$venv/bin/pip" install --quiet --upgrade pip
  "$venv/bin/pip" install --quiet --retries 10 --timeout 60 "numpy<2" demucs pyinstaller
fi
if [ ! -x "$venv/bin/pip-licenses" ]; then
  "$venv/bin/pip" install --quiet pip-licenses
fi

# 2. 冻结入口：freeze_support 必须最先执行，否则 demucs 的 multiprocessing
#    子进程会带 -B -S -I -c 重新执行本二进制并报参数错误
workdir="$(mktemp -d)"
cat > "$workdir/entry.py" <<'EOF'
import multiprocessing
import sys
from demucs.separate import main
if __name__ == "__main__":
    multiprocessing.freeze_support()
    sys.exit(main())
EOF

# 3. 冻结（--collect-data demucs 带上模型清单 yaml；torch 钩子由
#    pyinstaller-hooks-contrib 自动处理）
(cd "$workdir" && "$venv/bin/pyinstaller" --noconfirm --onedir --name demucs \
  --collect-data demucs --collect-submodules demucs \
  --collect-all torchaudio --collect-submodules dora \
  entry.py)

# 4. 整理为主进程期望的布局：engine-dist/bin/demucs
rm -rf "$dist/bin"
mkdir -p "$dist"
mv "$workdir/dist/demucs" "$dist/bin"
rm -rf "$workdir"

# 4.1 生成此构建实际包含的依赖与许可证清单；随 engine 资源一同进入安装包。
"$venv/bin/pip-licenses" --format=json --with-license-file --with-notice-file \
  --output-file "$dist/THIRD_PARTY_ENGINE_NOTICES.json"

# 5. 冒烟自检
"$dist/bin/demucs" --help >/dev/null
du -sh "$dist/bin"
echo "引擎构建完成：$dist/bin（打包时复制为 resources/engine/bin）"
echo "许可证清单：$dist/THIRD_PARTY_ENGINE_NOTICES.json"
echo "注意：模型文件不含在内（htdemucs 80M / htdemucs_6s 53M），首次分离时自动下载到 ~/.cache/torch。"
