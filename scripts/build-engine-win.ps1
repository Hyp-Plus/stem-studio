# Stem Studio Windows 引擎构建脚本（demucs-onnx + DirectML 路线）
# 产物：engine-dist/Scripts/demucs.exe（+ _internal/），符合主进程引擎发现
# 布局 resources/engine/Scripts/demucs.exe。在 Windows 上运行：
#   powershell -ExecutionPolicy Bypass -File scripts/build-engine-win.ps1
# 依赖：Python >= 3.11（py 启动器可用）
$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$venv = Join-Path $root ".venv-engine"
$dist = Join-Path $root "engine-dist"

# 1. 独立虚拟环境
if (-not (Test-Path $venv)) {
    py -3.12 -m venv $venv
}
$pip = Join-Path $venv "Scripts\pip.exe"
$python = Join-Path $venv "Scripts\python.exe"

# 2. 安装依赖：demucs-onnx（含 mp3 编码）+ DirectML 版 onnxruntime + PyInstaller
& $pip install --upgrade pip
& $pip install "demucs-onnx[mp3]" pyinstaller
# onnxruntime-directml 与 onnxruntime 同名冲突，先卸载 CPU 版再装 DML 版
& $pip uninstall -y onnxruntime
& $pip install onnxruntime-directml

# 3. 冻结适配层为 demucs.exe（应用以原版 demucs CLI 契约调用它）
Push-Location $root
try {
    & (Join-Path $venv "Scripts\pyinstaller.exe") --noconfirm --onedir --name demucs `
        --distpath $dist --workpath (Join-Path $env:TEMP "stem-studio-build") `
        --collect-all onnxruntime --collect-all demucs_onnx `
        --collect-submodules huggingface_hub `
        (Join-Path $root "engine\demucs_shim.py")
}
finally {
    Pop-Location
}

# 4. 整理为主进程期望的布局：engine-dist/Scripts/demucs.exe
$scripts = Join-Path $dist "Scripts"
if (Test-Path $scripts) { Remove-Item -Recurse -Force $scripts }
Move-Item (Join-Path $dist "demucs") $scripts

# 5. 冒烟自检 + DirectML 可用性报告（DML 需要 Windows 实机验证）
& (Join-Path $scripts "demucs.exe") --help | Out-Null
& $python -c "import onnxruntime; print('可用执行器:', onnxruntime.get_available_providers())"
Write-Host "引擎构建完成：$scripts（打包时复制为 resources/engine/Scripts）"
Write-Host "注意：模型文件不含在内，由应用首次运行时下载（P3），或手动放入缓存。"
