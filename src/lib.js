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
const DEFAULT_SETTINGS = { enginePath: '', defaultOutputDir: '', format: 'wav', performance: 'balanced', lastMode: 'four-stems', windowBounds: null };
const MEDIA_COMPONENTS = {
  'darwin-arm64': {
    label: 'macOS Apple Silicon 媒体组件',
    manifestUrl: 'https://github.com/Hyp-Plus/stem-studio/releases/download/v0.2.0/stem-studio-media-macos-arm64.json'
  },
  'win32-x64': {
    label: 'Windows x64 媒体组件',
    manifestUrl: 'https://github.com/Hyp-Plus/stem-studio/releases/download/v0.2.0/stem-studio-media-windows-x64.json'
  }
};

// 分离模型注册表：文件名第二段即官方 SHA256 前 8 位，完整校验和用于下载与导入验证
const MODEL_FILES = {
  htdemucs: {
    file: '955717e8-8726e21a.th',
    url: 'https://dl.fbaipublicfiles.com/demucs/hybrid_transformer/955717e8-8726e21a.th',
    sha256: '8726e21a993978c7ba086d3872e7608d7d5bfca646ca4aca459ffda844faa8b4',
    bytes: 84141911,
    label: '标准四轨模型'
  },
  htdemucs_6s: {
    file: '5c90dfd2-34c22ccb.th',
    url: 'https://dl.fbaipublicfiles.com/demucs/hybrid_transformer/5c90dfd2-34c22ccb.th',
    sha256: '34c22ccb381c6f9fdbf324f04e1e2fe21aaaf293f5ded163a162697ff9a02ddd',
    bytes: 54996327,
    label: '高质量六轨模型'
  }
};

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
    return '无法解码该视频文件。请在“设置”中点击“安装并继续”安装媒体组件后重试。';
  }
  if (/could not.{0,30}(decode|load|open)|no backend|invalid data/i.test(log)) {
    return '无法读取该媒体文件，文件可能已损坏或格式不受支持。';
  }
  return null;
}

// 断点续传：已有部分文件时生成 HTTP Range 头；从头下载返回 null
function resumeRange(partBytes) {
  return Number.isFinite(partBytes) && partBytes > 0 ? `bytes=${partBytes}-` : null;
}

// 下载进度百分比（0–100，总大小未知时返回 null）
function downloadPercent(receivedBytes, totalBytes) {
  if (!Number.isFinite(totalBytes) || totalBytes <= 0) return null;
  return Math.max(0, Math.min(100, Math.round((receivedBytes / totalBytes) * 100)));
}

// 校验下载/导入文件的完整 SHA256 是否与注册表一致
function verifyModelDigest(model, hexDigest) {
  const entry = MODEL_FILES[model];
  return Boolean(entry && typeof hexDigest === 'string' && hexDigest.toLowerCase() === entry.sha256);
}

// 一键媒体组件的远端清单只允许下载当前版本 Release 中的 ffmpeg / ffprobe。
function validateMediaManifest(manifest, expectedUrl) {
  if (!manifest || typeof manifest !== 'object' || !/^\d+\.\d+\.\d+$/.test(String(manifest.version || ''))) return null;
  if (!Array.isArray(manifest.files) || manifest.files.length !== 2) return null;
  const expectedBase = new URL(expectedUrl).href.replace(/[^/]+$/, '');
  const seen = new Set();
  const files = [];
  for (const file of manifest.files) {
    if (!file || typeof file.name !== 'string' || !['ffmpeg', 'ffmpeg.exe', 'ffprobe', 'ffprobe.exe'].includes(file.name)) return null;
    if (seen.has(file.name) || !/^[a-f0-9]{64}$/i.test(String(file.sha256 || '')) || !Number.isFinite(file.bytes) || file.bytes < 1024) return null;
    const url = String(file.url || '');
    if (!url.startsWith(expectedBase) || !/\/stem-studio-ff(?:mpeg|probe)-/.test(url)) return null;
    seen.add(file.name);
    files.push({ name: file.name, url, sha256: file.sha256.toLowerCase(), bytes: file.bytes });
  }
  const macosPair = seen.has('ffmpeg') && seen.has('ffprobe');
  const windowsPair = seen.has('ffmpeg.exe') && seen.has('ffprobe.exe');
  return macosPair || windowsPair ? files : null;
}

// 把模型下载失败翻译成中文提示
function classifyDownloadFailure(reason) {
  const text = String(reason && reason.message ? reason.message : reason || '');
  if (/ENOTFOUND|EAI_AGAIN|getaddrinfo/i.test(text)) return '无法连接下载服务器，请检查网络后重试。';
  if (/ETIMEDOUT|ECONNRESET|ECONNREFUSED|socket hang up|EPIPE|aborted/i.test(text)) return '网络连接中断，已保留进度，可点击“继续下载”续传。';
  if (/ENOSPC/i.test(text)) return '磁盘空间不足，请清理后重试。';
  if (/416/.test(text)) return '服务器不支持续传，已重新开始下载。';
  if (/HTTP (\d{3})/.test(text)) return `下载服务器返回错误（${text.match(/HTTP (\d{3})/)[1]}），请稍后重试。`;
  return `下载失败：${text.slice(0, 120) || '未知错误'}`;
}

// 工作台：由各轨的 solo/静音/音量算出实际增益。
// 规则：有任一轨 solo 时只出 solo 轨；静音优先于音量；音量范围 0–1。
function computeEffectiveGains(tracks) {
  const anySolo = tracks.some((track) => track.solo);
  const gains = {};
  for (const track of tracks) {
    const audible = anySolo ? track.solo : !track.muted;
    const volume = Math.min(1, Math.max(0, Number(track.volume ?? 1)));
    gains[track.id] = audible ? volume : 0;
  }
  return gains;
}

// 工作台：按增益混合各 stem 的 ffmpeg 参数。
// 增益为 0 的轨直接不进输入，全 0 时返回 null（没有可导出的声音）。
function buildMixArgs(stems, gains, outPath) {
  const active = stems.filter((stem) => (gains[stem.id] || 0) > 0);
  if (!active.length) return null;
  const args = ['-y'];
  for (const stem of active) args.push('-i', stem.path);
  const chains = active.map((stem, index) => `[${index}]volume=${(gains[stem.id]).toFixed(3)}[a${index}]`);
  const joined = active.map((_, index) => `[a${index}]`).join('');
  args.push(
    '-filter_complex',
    `${chains.join(';')};${joined}amix=inputs=${active.length}:duration=longest:normalize=0[out]`,
    '-map', '[out]'
  );
  const lower = outPath.toLowerCase();
  if (lower.endsWith('.mp3')) args.push('-b:a', '320k');
  if (lower.endsWith('.wav')) args.push('-c:a', 'pcm_f32le'); // stem 本身是 float32，导出保持无损
  args.push(outPath);
  return args;
}

// 只保留白名单内的设置键
function sanitizeSettings(patch) {
  const allowed = {};
  for (const key of Object.keys(DEFAULT_SETTINGS)) {
    if (patch && Object.prototype.hasOwnProperty.call(patch, key)) allowed[key] = patch[key];
  }
  return allowed;
}

// 给“检查更新”使用：只比较 v主版本.次版本.修订号，不把预发布版本当作稳定更新。
function isNewerVersion(candidate, current) {
  const parts = (value) => String(value || '').replace(/^v/, '').split('.').map((part) => Number(part));
  const [aMajor = 0, aMinor = 0, aPatch = 0] = parts(candidate);
  const [bMajor = 0, bMinor = 0, bPatch = 0] = parts(current);
  if (![aMajor, aMinor, aPatch, bMajor, bMinor, bPatch].every(Number.isFinite)) return false;
  return aMajor !== bMajor ? aMajor > bMajor : aMinor !== bMinor ? aMinor > bMinor : aPatch > bPatch;
}

module.exports = {
  MODEL_STEMS,
  STEM_LABELS,
  PERFORMANCE_PROFILES,
  VIDEO_EXTENSION_LIST,
  FORMAT_ARGS,
  FORMAT_EXT,
  DEFAULT_SETTINGS,
  MODEL_FILES,
  MEDIA_COMPONENTS,
  isVideoPath,
  modelForMode,
  buildDemucsArgs,
  nextProgress,
  classifyFailure,
  sanitizeSettings,
  resumeRange,
  downloadPercent,
  verifyModelDigest,
  validateMediaManifest,
  classifyDownloadFailure,
  computeEffectiveGains,
  buildMixArgs,
  isNewerVersion
};
