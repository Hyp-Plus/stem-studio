# P1 质量对比：原版 demucs (PyTorch) vs demucs-onnx，逐 stem 数值指标
# 用法: python compare.py <torch_stem_dir> <onnx_stem_dir>
import subprocess
import sys

import numpy as np

STEMS = ["vocals", "drums", "bass", "other"]


def load(path):
    """用 ffmpeg 解码为 44.1k 立体声 float32 raw，再 reshape 成 (n, 2)。"""
    raw = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", path, "-f", "f32le", "-ar", "44100", "-ac", "2", "-"],
        capture_output=True, check=True,
    ).stdout
    return np.frombuffer(raw, dtype=np.float32).reshape(-1, 2).astype(np.float64)


def si_sdr(ref, est):
    """Scale-Invariant SDR（dB），ref 为参考信号。"""
    ref = ref.ravel()
    est = est.ravel()
    alpha = np.dot(est, ref) / np.dot(ref, ref)
    target = alpha * ref
    noise = est - target
    return 10 * np.log10(np.dot(target, target) / max(np.dot(noise, noise), 1e-30))


SILENCE_RMS = 1e-3  # 参考 RMS 低于此视为近静音，SI-SDR 无意义


def main(torch_dir, onnx_dir):
    print(f"{'stem':<8} {'SI-SDR(dB)':>10} {'相关系数':>8} {'最大绝对差':>10} {'差值RMS':>10} {'参考RMS':>10}")
    worst = float("inf")
    active = 0
    for stem in STEMS:
        a = load(f"{torch_dir}/{stem}.wav")
        b = load(f"{onnx_dir}/{stem}.wav")
        n = min(len(a), len(b))
        a, b = a[:n], b[:n]
        rms_ref = np.sqrt((a ** 2).mean())
        max_diff = np.abs(a - b).max()
        rms_diff = np.sqrt(((a - b) ** 2).mean())
        if rms_ref < SILENCE_RMS:
            print(f"{stem:<8} {'N/A(静音)':>10} {'—':>8} {max_diff:>10.6f} {rms_diff:>10.6f} {rms_ref:>10.6f}")
            continue
        sdr = si_sdr(a, b)
        corr = np.corrcoef(a.ravel(), b.ravel())[0, 1]
        worst = min(worst, sdr)
        active += 1
        print(f"{stem:<8} {sdr:>10.2f} {corr:>8.5f} {max_diff:>10.6f} {rms_diff:>10.6f} {rms_ref:>10.6f}")
    print()
    if not active:
        print("结论：所有 stem 均近静音，此素材无法评估。")
    elif worst > 20:
        print(f"结论：{active} 个有效 stem 最差 SI-SDR {worst:.1f} dB —— ONNX 与原版高度一致，听感不可区分级别")
    elif worst > 12:
        print(f"结论：{active} 个有效 stem 最差 SI-SDR {worst:.1f} dB —— 轻微数值差异，建议抽样人耳复核")
    else:
        print(f"结论：{active} 个有效 stem 最差 SI-SDR {worst:.1f} dB —— 差异显著，需逐 stem 排查")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
