const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron');
const { spawn, execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

let mainWindow;
let activeJob = null; // { proc, cancelled, retriedCpu, log, passes, lastPercent, totalPasses, options, model, format, device }

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
const VIDEO_EXTENSIONS = new Set(['.mp4', '.mov', '.mkv', '.m4v']);
const FORMAT_ARGS = { wav: [], mp3: ['--mp3', '--mp3-bitrate', '320'], flac: ['--flac'] };
const FORMAT_EXT = { wav: '.wav', mp3: '.mp3', flac: '.flac' };
const MIN_FREE_DISK_BYTES = 2 * 1024 * 1024 * 1024; // 2 GB

// ---------- 设置持久化 ----------
const DEFAULT_SETTINGS = { enginePath: '', defaultOutputDir: '', format: 'wav', performance: 'balanced' };

function settingsFile() { return path.join(app.getPath('userData'), 'settings.json'); }

function loadSettings() {
  try {
    const parsed = JSON.parse(fs.readFileSync(settingsFile(), 'utf8'));
    return { ...DEFAULT_SETTINGS, ...parsed };
  } catch { return { ...DEFAULT_SETTINGS }; }
}

function saveSettings(patch) {
  const next = { ...loadSettings(), ...patch };
  fs.mkdirSync(path.dirname(settingsFile()), { recursive: true });
  fs.writeFileSync(settingsFile(), JSON.stringify(next, null, 2));
  return next;
}

// ---------- 引擎发现 ----------
function commandExists(command) {
  try {
    // Demucs 4 does not implement --version; --help is a reliable zero-exit probe.
    execFileSync(command, ['--help'], { stdio: 'ignore', timeout: 4000 });
    return true;
  } catch { return false; }
}

function resolveDemucs() {
  const configured = loadSettings().enginePath;
  if (configured && fs.existsSync(configured)) return configured;

  const fromEnv = process.env.STEM_STUDIO_DEMUCS;
  if (fromEnv && fs.existsSync(fromEnv)) return fromEnv;

  const bundled = process.platform === 'win32'
    ? path.join(process.resourcesPath, 'engine', 'Scripts', 'demucs.exe')
    : path.join(process.resourcesPath, 'engine', 'bin', 'demucs');
  if (fs.existsSync(bundled)) return bundled;

  return commandExists('demucs') ? 'demucs' : null;
}

// ---------- 工具函数 ----------
function send(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
}

function outputRoot(input, selectedDirectory) {
  const settings = loadSettings();
  const root = selectedDirectory || settings.defaultOutputDir || path.join(path.dirname(input), 'Stem Studio Exports');
  fs.mkdirSync(root, { recursive: true });
  return root;
}

function freeDiskBytes(dir) {
  try {
    const stat = fs.statfsSync(dir);
    return stat.bavail * stat.bsize;
  } catch { return null; }
}

function killProcessTree(proc) {
  if (!proc || proc.exitCode !== null) return;
  if (process.platform === 'win32') {
    try { execFileSync('taskkill', ['/pid', String(proc.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* already gone */ }
  } else {
    // spawn() 时使用 detached，使 demucs 成为进程组组长；负号 pid 终止整个进程组
    try { process.kill(-proc.pid, 'SIGTERM'); } catch { try { proc.kill('SIGTERM'); } catch { /* already gone */ } }
    const escalate = setTimeout(() => {
      try { process.kill(-proc.pid, 'SIGKILL'); } catch { /* already gone */ }
    }, 3000);
    if (typeof escalate.unref === 'function') escalate.unref();
  }
}

function friendlyFailure(log, input) {
  const isVideo = VIDEO_EXTENSIONS.has(path.extname(input).toLowerCase());
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

// ---------- 分离任务 ----------
function buildArgs(options, device) {
  const model = options.mode === 'six-stems' ? 'htdemucs_6s' : 'htdemucs';
  const settings = loadSettings();
  const profile = PERFORMANCE_PROFILES[settings.performance] || PERFORMANCE_PROFILES.balanced;
  const format = FORMAT_ARGS[settings.format] ? settings.format : 'wav';

  const args = ['-n', model, '--float32', '--clip-mode', 'rescale', ...FORMAT_ARGS[format]];
  if (profile.shifts > 1) args.push('--shifts', String(profile.shifts), '--overlap', String(profile.overlap));
  if (device) args.push('-d', device);
  args.push('-o', outputRoot(options.input, options.output), options.input);
  return { args, model, shifts: Math.max(1, profile.shifts), format };
}

function finalOutputDir(options, model) {
  return path.join(outputRoot(options.input, options.output), model, path.parse(options.input).name);
}

function pruneUnselectedStems(options, model, format) {
  const selected = Array.isArray(options.stems) && options.stems.length ? options.stems : null;
  const all = MODEL_STEMS[model];
  if (!selected || selected.length >= all.length) return;
  const dir = finalOutputDir(options, model);
  for (const stem of all) {
    if (selected.includes(stem)) continue;
    try { fs.rmSync(path.join(dir, `${stem}${FORMAT_EXT[format]}`), { force: true }); } catch { /* non-fatal */ }
  }
}

function launchDemucs(demucs, options, device) {
  const { args, model, shifts, format } = buildArgs(options, device);
  const proc = spawn(demucs, args, { windowsHide: true, detached: process.platform !== 'win32' });

  const job = {
    proc, options, model, format, device,
    cancelled: false,
    retriedCpu: activeJob ? activeJob.retriedCpu : false,
    log: '',
    passes: 0,
    lastPercent: 0,
    totalPasses: shifts
  };
  activeJob = job;

  const onData = (data) => {
    if (activeJob !== job) return;
    const text = data.toString();
    job.log = (job.log + text).slice(-20000);

    const matches = text.match(/(\d{1,3}(?:\.\d+)?)%/g);
    if (matches) {
      const current = Math.min(100, Number(matches.at(-1).replace('%', '')));
      // 进度大幅回落 → 进入下一个 pass（--shifts 会跑多轮）
      if (current < job.lastPercent - 40) job.passes = Math.min(job.passes + 1, job.totalPasses - 1);
      job.lastPercent = current;
    }
    const overall = Math.round(((job.passes + job.lastPercent / 100) / job.totalPasses) * 96) + 2;

    let message = text.trim().slice(-160) || '正在分离音轨…';
    if (/downloading/i.test(text)) message = '首次使用，正在下载模型文件…';
    send('separation-update', { state: 'running', message, percent: Math.max(2, Math.min(98, overall)) });
  };
  proc.stdout.on('data', onData);
  proc.stderr.on('data', onData);

  proc.on('error', (error) => {
    if (activeJob !== job) return;
    activeJob = null;
    send('separation-update', { state: 'error', message: `无法启动 Demucs：${error.message}`, percent: 0 });
  });

  proc.on('close', (code) => {
    if (activeJob !== job) return;

    if (job.cancelled) {
      activeJob = null;
      send('separation-update', { state: 'cancelled', message: '任务已取消。', percent: 0 });
      return;
    }
    if (code === 0) {
      activeJob = null;
      try { pruneUnselectedStems(options, model, format); } catch { /* non-fatal */ }
      send('separation-update', { state: 'done', message: '分离完成', percent: 100, output: finalOutputDir(options, model) });
      return;
    }
    // macOS：MPS 加速失败时自动回退 CPU 重试一次
    if (device === 'mps' && !job.retriedCpu && /mps/i.test(job.log)) {
      job.retriedCpu = true;
      send('separation-update', { state: 'running', message: 'MPS 加速失败，正在改用 CPU 重试…', percent: 2 });
      launchDemucs(demucs, options, 'cpu');
      return;
    }
    activeJob = null;
    const friendly = friendlyFailure(job.log, options.input);
    const message = friendly || `Demucs 已退出（代码 ${code}）。\n${job.log.slice(-500)}`;
    send('separation-update', { state: 'error', message, percent: 0 });
  });
}

// ---------- IPC ----------
ipcMain.handle('pick-input', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    title: '选择音频或视频文件',
    properties: ['openFile'],
    filters: [{ name: '媒体文件', extensions: ['wav', 'mp3', 'flac', 'm4a', 'aac', 'ogg', 'mp4', 'mov', 'mkv', 'm4v'] }]
  });
  return canceled ? null : filePaths[0];
});

ipcMain.handle('pick-output', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    title: '选择导出位置', properties: ['openDirectory', 'createDirectory']
  });
  return canceled ? null : filePaths[0];
});

ipcMain.handle('pick-engine', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    title: '选择 Demucs 可执行文件', properties: ['openFile', 'showHiddenFiles']
  });
  if (canceled) return null;
  return saveSettings({ enginePath: filePaths[0] }).enginePath;
});

ipcMain.handle('pick-default-output', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    title: '选择默认导出位置', properties: ['openDirectory', 'createDirectory']
  });
  if (canceled) return null;
  return saveSettings({ defaultOutputDir: filePaths[0] }).defaultOutputDir;
});

ipcMain.handle('get-settings', () => loadSettings());

ipcMain.handle('set-settings', (_event, patch) => {
  const allowed = {};
  for (const key of Object.keys(DEFAULT_SETTINGS)) {
    if (patch && Object.prototype.hasOwnProperty.call(patch, key)) allowed[key] = patch[key];
  }
  return saveSettings(allowed);
});

ipcMain.handle('engine-status', () => {
  const executable = resolveDemucs();
  return { available: Boolean(executable), executable: executable || '未找到 Demucs' };
});

ipcMain.handle('stem-options', () => ({ models: MODEL_STEMS, labels: STEM_LABELS }));

ipcMain.handle('start-separation', async (_event, options) => {
  if (activeJob) throw new Error('已有任务正在进行。');
  if (!options || !options.input || !fs.existsSync(options.input)) throw new Error('请选择一个有效的媒体文件。');

  const demucs = resolveDemucs();
  if (!demucs) throw new Error('未找到 Demucs。请在“设置”中选择 Demucs 可执行文件，或在系统中安装 demucs。');

  // 前置检测：视频输入需要 FFmpeg
  if (VIDEO_EXTENSIONS.has(path.extname(options.input).toLowerCase()) && !commandExists('ffmpeg')) {
    throw new Error('处理视频文件需要 FFmpeg。请先安装（macOS：brew install ffmpeg；Windows：winget install ffmpeg），或先将视频转为音频文件。');
  }

  // 前置检测：导出位置剩余磁盘空间
  const free = freeDiskBytes(outputRoot(options.input, options.output));
  if (free !== null && free < MIN_FREE_DISK_BYTES) {
    throw new Error(`导出位置磁盘空间不足（剩余约 ${(free / 1024 / 1024 / 1024).toFixed(1)} GB）。请清理磁盘或更换导出位置。`);
  }

  send('separation-update', { state: 'running', message: '正在加载模型…', percent: 2 });
  launchDemucs(demucs, options, process.platform === 'darwin' ? 'mps' : null);
  return { started: true };
});

ipcMain.handle('cancel-separation', () => {
  if (activeJob) {
    activeJob.cancelled = true;
    killProcessTree(activeJob.proc);
  }
  return true;
});

ipcMain.handle('open-path', (_event, target) => shell.openPath(target));

// ---------- 生命周期 ----------
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1120,
    height: 760,
    minWidth: 900,
    minHeight: 640,
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  mainWindow.loadFile(path.join(__dirname, 'index.html'));
}

function stopActiveJob() {
  if (activeJob) {
    activeJob.cancelled = true;
    killProcessTree(activeJob.proc);
  }
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('before-quit', stopActiveJob);

app.on('window-all-closed', () => {
  stopActiveJob();
  if (process.platform !== 'darwin') app.quit();
});
