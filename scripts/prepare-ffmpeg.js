'use strict';

// 打包前把 ffmpeg-static / ffprobe-static 的静态二进制整理到 ffmpeg-dist/，
// electron-builder 再将其复制为 resources/ffmpeg（见 package.json extraResources）。
// 用法：node scripts/prepare-ffmpeg.js

const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const dist = path.join(root, 'ffmpeg-dist');

const ffmpegSource = require('ffmpeg-static');
const ffprobeSource = require('ffprobe-static').path;

const suffix = process.platform === 'win32' ? '.exe' : '';

fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(dist, { recursive: true });
for (const [source, name] of [[ffmpegSource, `ffmpeg${suffix}`], [ffprobeSource, `ffprobe${suffix}`]]) {
  if (!source || !fs.existsSync(source)) {
    console.error(`未找到 ${name} 静态二进制（${source}），请先 npm install。`);
    process.exit(1);
  }
  const target = path.join(dist, name);
  fs.copyFileSync(source, target);
  fs.chmodSync(target, 0o755);
  console.log(`已放入 ${target}（${(fs.statSync(target).size / 1024 / 1024).toFixed(0)} MB）`);
}
console.log('ffmpeg-dist 准备完成。');
