'use strict';

// 与 Electron 无关的纯逻辑，供主进程使用并可被单元测试覆盖。

const MODEL_STEMS = {
  htdemucs: ['vocals', 'drums', 'bass', 'other'],
  htdemucs_6s: ['vocals', 'piano', 'guitar', 'bass', 'drums', 'other']
};
const STEM_LABELS = { vocals: '人声', drums: '鼓', bass: '贝斯', other: '其他', piano: '钢琴', guitar: '吉他' };
const PERFORMANCE_PROFILES = {
  fast: { shifts: 1, overlap: 0.25 },
  balanced: { shifts: 2, overlap: 0.5 },
  best: { shifts: 10, overlap: 0.75 }
};
const VIDEO_EXTENSION_LIST = ['.mp4', '.mov', '.mkv', '.m4v'];
const FORMAT_ARGS = { wav: [], mp3: ['--mp3', '--mp3-bitrate', '320'], flac: ['--flac'] };
const FORMAT_EXT = { wav: '.wav', mp3: '.mp3', flac: '.flac' };
const DEFAULT_SETTINGS = { enginePath: '', defaultOutputDir: '', format: 'wav', performance: 'balanced', lastMode: 'six-stems', windowBounds: null };

function isVideoPath(filePath) {
  const dot = filePath.lastIndexOf('.');
  const extension = dot >= 0 ? filePath.slice(dot).toLowerCase() : '';
  return VIDEO_EXTENSION_LIST.includes(extension);
}

function modelForMode(mode) {
  return mode === 'six-stems' ? 'htdemucs_6s' : 'htdemucs';
}

// 组装 demucs 命令行参数
function buildDemucsArgs({ mode, settings, root, input, device }) {
  const model = modelForMode(mode);
  const profile = PERFORMANCE_PROFILES[settings.performance] || PERFORMANCE_PROFILES.balanced;
  const format = FORMAT_ARGS[settings.format] ? settings.format : 'wav';

  const args = ['-n', model, '--float32', '--clip-mode', 'rescale', ...FORMAT_ARGS[format]];
  if (profile.shifts > 1) args.push('--shifts', String(profile.shifts), '--overlap', String(profile.overlap));
  if (device) args.push('-d', device);
  args.push('-o', root, input);
  return { args, model, shifts: Math.max(1, profile.shifts), format };
}

// 从 demucs 输出片段推进进度状态；--shifts 会跑多轮，进度大幅回落视为进入下一轮
function nextProgress(previous, chunk, shifts) {
  let passes = previous.passes;
  let lastPercent = previous.lastPercent;
  const matches = chunk.match(/(\d{1,3}(?:\.\d+)?)%/g);
  if (matches) {
    const current = Math.min(100, Number(matches[matches.length - 1].replace('%', '')));
    if (current < lastPercent - 40) passes = Math.min(passes + 1, shifts - 1);
    lastPercent = current;
  }
  const overall = Math.max(2, Math.min(98, Math.round(((passes + lastPercent / 100) / shifts) * 96) + 2));
  return { passes, lastPercent, overall, downloading: /downloading/i.test(chunk) };
}

// 把 demucs 失败日志翻译成用户可理解的中文提示；无法归类时返回 null
function classifyFailure(log, isVideo) {
  if (/out of memory|MemoryError/i.test(log)) {
    return '内存不足，分离中断。请关闭其他应用后重试，或在设置中改用“快速”性能档位。';
  }
  if (/(could not|failed to|error).{0,40}download|URLError|ConnectionError|Connection reset/i.test(log)) {
    return '模型下载失败。首次使用需要联网下载模型文件，请检查网络后重试。';
  }
  if (isVideo && /ffmpeg|no backend|could not.{0,30}(decode|load|open)/i.test(log)) {
    return '无法解码该视频文件。处理视频需要 FFmpeg，请先安装（macOS：brew install ffmpeg；Windows：winget install ffmpeg）。';
  }
  if (/could not.{0,30}(decode|load|open)|no backend|invalid data/i.test(log)) {
    return '无法读取该媒体文件，文件可能已损坏或格式不受支持。';
  }
  return null;
}

// 只保留白名单内的设置键
function sanitizeSettings(patch) {
  const allowed = {};
  for (const key of Object.keys(DEFAULT_SETTINGS)) {
    if (patch && Object.prototype.hasOwnProperty.call(patch, key)) allowed[key] = patch[key];
  }
  return allowed;
}

module.exports = {
  MODEL_STEMS,
  STEM_LABELS,
  PERFORMANCE_PROFILES,
  VIDEO_EXTENSION_LIST,
  FORMAT_ARGS,
  FORMAT_EXT,
  DEFAULT_SETTINGS,
  isVideoPath,
  modelForMode,
  buildDemucsArgs,
  nextProgress,
  classifyFailure,
  sanitizeSettings
};
