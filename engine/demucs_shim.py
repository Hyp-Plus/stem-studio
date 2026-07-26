#!/usr/bin/env python3
"""引擎适配层：以原版 demucs CLI 的参数子集驱动 demucs-onnx。

应用主进程按原版 demucs 的契约调用引擎（参数、NN% 进度行、
<root>/<模型>/<曲目>/<stem>.<扩展名> 输出布局）。本适配层把这套契约
翻译成 demucs_onnx 的 Python API，使 ONNX 引擎可以无缝替换原版。

进度：demucs_onnx 在 verbose 模式逐块打印 "chunk i/N"，这里在进程内
拦截并换算成 "NN%" 行输出到 stderr，供主进程 nextProgress 解析。
错误：解码失败时输出含 "could not decode" 的行，命中 classifyFailure
现有的中文归类规则。
"""
from __future__ import annotations

import argparse
import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path

VIDEO_EXTENSIONS = {".mp4", ".mov", ".mkv", ".m4v"}
CHUNK_LINE = re.compile(r"chunk\s+(\d+)\s*/\s*(\d+)")


class _ProgressFilter:
    """替身输出流：把 demucs_onnx 的 chunk 行换算成 NN% 打到真实 stderr。"""

    def __init__(self, real):
        self._real = real

    def write(self, text):
        match = CHUNK_LINE.search(text)
        if match:
            done, total = int(match.group(1)), int(match.group(2))
            self._real.write(f"{min(100, round(done * 100 / total))}%\n")
            self._real.flush()
        return len(text)

    def flush(self):
        self._real.flush()


def _pick_providers(device: str | None) -> str:
    """把原版 -d 参数映射为 onnxruntime 执行器。

    可用 STEM_STUDIO_ONNX_EP 环境变量强制指定。macOS 上 auto 会选
    CoreML，但 htdemucs 模型目前编译失败（见 docs/引擎分发-P1-质量对比.md），
    故 darwin 默认降到 cpu；Windows 上 auto 会选 DirectML。
    """
    forced = os.environ.get("STEM_STUDIO_ONNX_EP")
    if forced:
        return forced
    if device == "cpu":
        return "cpu"
    if sys.platform == "darwin":
        return "cpu"
    return "auto"


def _extract_audio(input_path: Path) -> Path:
    """视频输入先用 ffmpeg 抽出音轨（soundfile 不能读视频容器）。"""
    temp = Path(tempfile.mkdtemp(prefix="stem-studio-")) / (input_path.stem + ".wav")
    result = subprocess.run(
        ["ffmpeg", "-v", "error", "-y", "-i", str(input_path),
         "-vn", "-ac", "2", "-ar", "44100", str(temp)],
        capture_output=True, text=True,
    )
    if result.returncode != 0:
        print(f"error: could not decode video input (ffmpeg): {result.stderr.strip()}",
              file=sys.stderr)
        raise SystemExit(1)
    return temp


def main() -> int:
    parser = argparse.ArgumentParser(prog="demucs", description="Stem Studio ONNX 引擎适配层")
    parser.add_argument("-n", "--name", default="htdemucs")
    parser.add_argument("--float32", action="store_true")
    parser.add_argument("--clip-mode", default="rescale")
    parser.add_argument("--mp3", action="store_true")
    parser.add_argument("--mp3-bitrate", type=int, default=320)
    parser.add_argument("--flac", action="store_true")
    parser.add_argument("--shifts", type=int, default=1)
    parser.add_argument("--overlap", type=float, default=0.25)
    parser.add_argument("-d", "--device", default=None)
    parser.add_argument("-o", "--out", required=True)
    parser.add_argument("tracks", nargs="+")
    args = parser.parse_args()

    from demucs_onnx import separate  # 延迟导入，让 --help 保持轻快

    exit_code = 0
    for track in args.tracks:
        input_path = Path(track)
        source = input_path
        if input_path.suffix.lower() in VIDEO_EXTENSIONS:
            source = _extract_audio(input_path)

        out_dir = Path(args.out) / args.name / input_path.stem
        out_dir.mkdir(parents=True, exist_ok=True)

        real_stderr = sys.stderr
        try:
            # 拦截库的 verbose 输出并换算为 NN% 进度行
            sys.stdout = _ProgressFilter(real_stderr)  # type: ignore[assignment]
            sys.stderr = _ProgressFilter(real_stderr)  # type: ignore[assignment]
            stems = separate(
                str(source), None,
                model=args.name,
                providers=_pick_providers(args.device),
                progress=False, verbose=True,
            )
        except SystemExit:
            raise
        except Exception as error:  # noqa: BLE001 — 归类为应用可识别的错误行
            sys.stdout, sys.stderr = sys.__stdout__, real_stderr
            print(f"error: could not decode or separate {input_path.name}: {error}",
                  file=sys.stderr)
            exit_code = 1
            continue
        finally:
            sys.stdout, sys.stderr = sys.__stdout__, real_stderr

        sample_rate = 44100
        if args.mp3:
            from demucs_onnx import write_mp3
            for stem, audio in stems.items():
                write_mp3(out_dir / f"{stem}.mp3", audio, sample_rate,
                          bitrate_kbps=args.mp3_bitrate)
        elif args.flac:
            import soundfile
            for stem, audio in stems.items():
                soundfile.write(out_dir / f"{stem}.flac", audio.T, sample_rate)
        else:
            from demucs_onnx import write_wav
            for stem, audio in stems.items():
                write_wav(out_dir / f"{stem}.wav", audio, sample_rate)
        print("100%", file=sys.stderr)

    return exit_code


if __name__ == "__main__":
    sys.exit(main())
