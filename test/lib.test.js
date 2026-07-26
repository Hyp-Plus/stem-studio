'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const lib = require('../src/lib');

test('buildDemucsArgs：六轨 + 极致档位包含 shifts/overlap', () => {
  const { args, model, shifts, format } = lib.buildDemucsArgs({
    mode: 'six-stems',
    settings: { format: 'wav', performance: 'best' },
    root: '/out',
    input: '/music/song.mp3',
    device: 'mps'
  });
  assert.equal(model, 'htdemucs_6s');
  assert.equal(shifts, 10);
  assert.equal(format, 'wav');
  assert.ok(args.includes('--shifts') && args.includes('10'));
  assert.ok(args.includes('--overlap') && args.includes('0.75'));
  assert.ok(args.includes('-d') && args.includes('mps'));
  assert.equal(args[args.length - 2], '/out');
  assert.equal(args[args.length - 1], '/music/song.mp3');
});

test('buildDemucsArgs：四轨 + 快速档位不含 shifts，无设备参数', () => {
  const { args, model, shifts } = lib.buildDemucsArgs({
    mode: 'four-stems',
    settings: { format: 'wav', performance: 'fast' },
    root: '/out',
    input: '/a.wav',
    device: null
  });
  assert.equal(model, 'htdemucs');
  assert.equal(shifts, 1);
  assert.ok(!args.includes('--shifts'));
  assert.ok(!args.includes('-d'));
});

test('buildDemucsArgs：mp3 格式带码率参数，未知设置回退默认', () => {
  const mp3 = lib.buildDemucsArgs({
    mode: 'four-stems',
    settings: { format: 'mp3', performance: 'balanced' },
    root: '/out',
    input: '/a.wav',
    device: null
  });
  assert.ok(mp3.args.includes('--mp3') && mp3.args.includes('--mp3-bitrate') && mp3.args.includes('320'));

  const fallback = lib.buildDemucsArgs({
    mode: 'four-stems',
    settings: { format: 'ogg', performance: 'nope' },
    root: '/out',
    input: '/a.wav',
    device: null
  });
  assert.equal(fallback.format, 'wav');
  assert.equal(fallback.shifts, 2); // balanced 兜底
});

test('nextProgress：单轮进度单调映射到 2–98', () => {
  let state = { passes: 0, lastPercent: 0 };
  state = lib.nextProgress(state, ' 10%|██ ', 1);
  assert.equal(state.lastPercent, 10);
  const low = state.overall;
  state = lib.nextProgress(state, ' 90%|█████████ ', 1);
  assert.ok(state.overall > low);
  assert.ok(state.overall <= 98 && state.overall >= 2);
});

test('nextProgress：进度大幅回落识别为下一个 pass，整体不倒退太多', () => {
  let state = { passes: 0, lastPercent: 0 };
  state = lib.nextProgress(state, '100%', 2);
  const afterFirstPass = state.overall;
  state = lib.nextProgress(state, ' 5%', 2);
  assert.equal(state.passes, 1);
  assert.ok(state.overall >= afterFirstPass - 50); // 第二轮从一半起算
  state = lib.nextProgress(state, '100%', 2);
  assert.equal(state.overall, 98);
});

test('nextProgress：识别模型下载提示', () => {
  const state = lib.nextProgress({ passes: 0, lastPercent: 0 }, 'Downloading: "https://..." to /home/.cache', 1);
  assert.equal(state.downloading, true);
});

test('classifyFailure：常见错误归类为中文提示', () => {
  assert.match(lib.classifyFailure('RuntimeError: MPS backend out of memory', false), /内存不足/);
  assert.match(lib.classifyFailure('urllib.error.URLError: could not download model', false), /模型下载失败/);
  assert.match(lib.classifyFailure('ffmpeg not found', true), /FFmpeg/);
  assert.match(lib.classifyFailure('soundfile could not open file: invalid data', false), /无法读取/);
  assert.equal(lib.classifyFailure('some unknown stack trace', false), null);
});

test('isVideoPath：按扩展名判断视频', () => {
  assert.equal(lib.isVideoPath('/a/b/movie.MP4'), true);
  assert.equal(lib.isVideoPath('/a/b/song.flac'), false);
  assert.equal(lib.isVideoPath('/a/b/noext'), false);
});

test('sanitizeSettings：过滤白名单外的键', () => {
  const clean = lib.sanitizeSettings({ format: 'flac', evil: 'x', enginePath: '/usr/bin/demucs' });
  assert.deepEqual(clean, { format: 'flac', enginePath: '/usr/bin/demucs' });
  assert.deepEqual(lib.sanitizeSettings(null), {});
});

test('MODEL_FILES：注册表自洽（文件名内嵌 SHA256 前 8 位、覆盖两种模式）', () => {
  for (const mode of ['four-stems', 'six-stems']) {
    assert.ok(lib.MODEL_FILES[lib.modelForMode(mode)], `${mode} 应有对应模型`);
  }
  for (const [name, entry] of Object.entries(lib.MODEL_FILES)) {
    assert.match(entry.sha256, /^[0-9a-f]{64}$/, `${name} 校验和应为 64 位十六进制`);
    const embedded = entry.file.split('-')[1].slice(0, 8);
    assert.equal(entry.sha256.slice(0, 8), embedded, `${name} 文件名应内嵌校验和前 8 位`);
    assert.ok(entry.url.endsWith(entry.file));
    assert.ok(entry.bytes > 1024 * 1024);
  }
});

test('resumeRange：有部分文件时生成 Range 头，否则 null', () => {
  assert.equal(lib.resumeRange(1024), 'bytes=1024-');
  assert.equal(lib.resumeRange(0), null);
  assert.equal(lib.resumeRange(NaN), null);
  assert.equal(lib.resumeRange(undefined), null);
});

test('downloadPercent：百分比钳制与未知总量', () => {
  assert.equal(lib.downloadPercent(50, 200), 25);
  assert.equal(lib.downloadPercent(300, 200), 100);
  assert.equal(lib.downloadPercent(10, 0), null);
  assert.equal(lib.downloadPercent(10, NaN), null);
});

test('verifyModelDigest：完整校验和匹配注册表', () => {
  const good = lib.MODEL_FILES.htdemucs.sha256;
  assert.equal(lib.verifyModelDigest('htdemucs', good), true);
  assert.equal(lib.verifyModelDigest('htdemucs', good.toUpperCase()), true);
  assert.equal(lib.verifyModelDigest('htdemucs', good.replace(/^./, '0')), good.startsWith('0'));
  assert.equal(lib.verifyModelDigest('nope', good), false);
});

test('classifyDownloadFailure：网络错误归类为中文提示', () => {
  assert.match(lib.classifyDownloadFailure(new Error('getaddrinfo ENOTFOUND dl.fbaipublicfiles.com')), /无法连接/);
  assert.match(lib.classifyDownloadFailure(new Error('read ECONNRESET')), /续传/);
  assert.match(lib.classifyDownloadFailure(new Error('ENOSPC: no space left')), /磁盘空间/);
  assert.match(lib.classifyDownloadFailure(new Error('HTTP 503')), /503/);
  assert.match(lib.classifyDownloadFailure('奇怪的错误'), /下载失败/);
});

test('computeEffectiveGains：无 solo 时静音优先，音量截断到 0–1', () => {
  const gains = lib.computeEffectiveGains([
    { id: 'vocals', volume: 0.8, muted: false, solo: false },
    { id: 'drums', volume: 0.5, muted: true, solo: false },
    { id: 'bass', volume: 1.7, muted: false, solo: false },
    { id: 'other', volume: -0.2, muted: false, solo: false }
  ]);
  assert.equal(gains.vocals, 0.8);
  assert.equal(gains.drums, 0);
  assert.equal(gains.bass, 1);
  assert.equal(gains.other, 0);
});

test('computeEffectiveGains：solo 覆盖一切，未 solo 的轨全部为 0', () => {
  const gains = lib.computeEffectiveGains([
    { id: 'vocals', volume: 0.6, muted: true, solo: true },
    { id: 'drums', volume: 1, muted: false, solo: false }
  ]);
  assert.equal(gains.vocals, 0.6, 'solo 轨即使被标记静音也应出声（solo 优先）');
  assert.equal(gains.drums, 0);
});

test('buildMixArgs：只纳入增益>0 的轨，filter 与输出正确', () => {
  const args = lib.buildMixArgs(
    [{ id: 'vocals', path: '/s/vocals.wav' }, { id: 'drums', path: '/s/drums.wav' }, { id: 'bass', path: '/s/bass.wav' }],
    { vocals: 0.5, drums: 0, bass: 1 },
    '/out/伴奏.mp3'
  );
  assert.ok(args.includes('/s/vocals.wav') && args.includes('/s/bass.wav'));
  assert.ok(!args.includes('/s/drums.wav'), '零增益轨不应进入输入');
  const filter = args[args.indexOf('-filter_complex') + 1];
  assert.ok(filter.includes('volume=0.500') && filter.includes('volume=1.000'));
  assert.ok(filter.includes('amix=inputs=2:duration=longest:normalize=0'));
  assert.ok(args.includes('-b:a') && args.includes('320k'), 'mp3 输出应带码率');
  assert.equal(args[args.length - 1], '/out/伴奏.mp3');
});

test('buildMixArgs：全部增益为 0 返回 null；wav 输出不带 mp3 码率', () => {
  assert.equal(lib.buildMixArgs([{ id: 'a', path: '/a.wav' }], { a: 0 }, '/o.wav'), null);
  const wav = lib.buildMixArgs([{ id: 'a', path: '/a.wav' }], { a: 1 }, '/o.wav');
  assert.ok(!wav.includes('-b:a'));
});

test('buildMixArgs：wav 输出使用 float32 编码保持无损', () => {
  const args = lib.buildMixArgs([{ id: 'a', path: '/a.wav' }], { a: 1 }, '/o.wav');
  assert.ok(args.includes('-c:a') && args.includes('pcm_f32le'));
});
