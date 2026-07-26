const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron');
const { spawn, execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

let mainWindow;
let queue = [];        // 任务队列（保留终态项用于展示，开始新一批时清空）
let current = null;    // 正在运行的队列项
let currentProc = null;
let jobCounter = 0;

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

// ---------- 任务历史 ----------
function historyFile() { return path.join(app.getPath('userData'), 'history.json'); }

function loadHistory() {
  try {
    const parsed = JSON.parse(fs.readFileSync(historyFile(), 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}

function appendHistory(entry) {
  try {
    const next = [entry, ...loadHistory()].slice(0, 50);
    fs.mkdirSync(path.dirname(historyFile()), { recursive: true });
    fs.writeFileSync(historyFile(), JSON.stringify(next, null, 2));
  } catch { /* 历史记录失败不影响主流程 */ }
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

// ---------- 任务队列 ----------
function queueSnapshot() {
  return {
    running: Boolean(current),
    jobs: queue.map((job) => ({
      id: job.id,
      name: path.basename(job.input),
      status: job.status,
      percent: job.percent,
      message: job.message,
      outputDir: job.outputDir || null
    }))
  };
}

function broadcastQueue() { send('queue-update', queueSnapshot()); }

function buildArgs(job, device) {
  const model = job.mode === 'six-stems' ? 'htdemucs_6s' : 'htdemucs';
  const settings = loadSettings();
  const profile = PERFORMANCE_PROFILES[settings.performance] || PERFORMANCE_PROFILES.balanced;
  const format = FORMAT_ARGS[settings.format] ? settings.format : 'wav';

  const args = ['-n', model, '--float32', '--clip-mode', 'rescale', ...FORMAT_ARGS[format]];
  if (profile.shifts > 1) args.push('--shifts', String(profile.shifts), '--overlap', String(profile.overlap));
  if (device) args.push('-d', device);
  args.push('-o', outputRoot(job.input, job.output), job.input);
  return { args, model, shifts: Math.max(1, profile.shifts), format };
}

function finalOutputDir(job, model) {
  return path.join(outputRoot(job.input, job.output), model, path.parse(job.input).name);
}

function pruneUnselectedStems(job, model, format) {
  const selected = Array.isArray(job.stems) && job.stems.length ? job.stems : null;
  const all = MODEL_STEMS[model];
  if (!selected || selected.length >= all.length) return;
  const dir = finalOutputDir(job, model);
  for (const stem of all) {
    if (selected.includes(stem)) continue;
    try { fs.rmSync(path.join(dir, `${stem}${FORMAT_EXT[format]}`), { force: true }); } catch { /* non-fatal */ }
  }
}

function finishJob(job, status, message, outputDir) {
  job.status = status;
  job.message = message;
  job.finishedAt = Date.now();
  if (outputDir) job.outputDir = outputDir;
  if (status === 'done') job.percent = 100;
  appendHistory({
    name: path.basename(job.input),
    input: job.input,
    mode: job.mode,
    status,
    outputDir: job.outputDir || null,
    startedAt: job.startedAt || null,
    finishedAt: job.finishedAt,
    durationMs: job.startedAt ? job.finishedAt - job.startedAt : null
  });
  current = null;
  currentProc = null;
  broadcastQueue();
  processQueue();
}

function processQueue() {
  if (current) return;
  const next = queue.find((job) => job.status === 'pending');
  if (!next) {
    const doneJobs = queue.filter((job) => job.status === 'done');
    if (queue.length) {
      send('queue-finished', {
        doneCount: doneJobs.length,
        total: queue.length,
        lastOutput: doneJobs.length ? doneJobs[doneJobs.length - 1].outputDir : null
      });
    }
    return;
  }
  runJob(next, process.platform === 'darwin' ? 'mps' : null, false);
}

function runJob(job, device, isRetry) {
  current = job;
  job.status = 'running';
  if (!isRetry) job.startedAt = Date.now();
  job.percent = 2;
  job.message = '正在加载模型…';
  broadcastQueue();

  const demucs = resolveDemucs();
  if (!demucs) return finishJob(job, 'error', '未找到 Demucs。请在“设置”中选择 Demucs 可执行文件。');

  const { args, model, shifts, format } = buildArgs(job, device);
  const proc = spawn(demucs, args, { windowsHide: true, detached: process.platform !== 'win32' });
  currentProc = proc;

  let log = '';
  let passes = 0;
  let lastPercent = 0;
  let settled = false;

  const onData = (data) => {
    if (settled || job.cancelled) return;
    const text = data.toString();
    log = (log + text).slice(-20000);

    const matches = text.match(/(\d{1,3}(?:\.\d+)?)%/g);
    if (matches) {
      const currentPercent = Math.min(100, Number(matches.at(-1).replace('%', '')));
      // 进度大幅回落 → 进入下一个 pass（--shifts 会跑多轮）
      if (currentPercent < lastPercent - 40) passes = Math.min(passes + 1, shifts - 1);
      lastPercent = currentPercent;
    }
    const overall = Math.round(((passes + lastPercent / 100) / shifts) * 96) + 2;

    let message = text.trim().slice(-160) || '正在分离音轨…';
    if (/downloading/i.test(text)) message = '首次使用，正在下载模型文件…';
    job.percent = Math.max(2, Math.min(98, overall));
    job.message = message;
    send('separation-update', { id: job.id, percent: job.percent, message });
  };
  proc.stdout.on('data', onData);
  proc.stderr.on('data', onData);

  proc.on('error', (error) => {
    if (settled) return;
    settled = true;
    finishJob(job, 'error', `无法启动 Demucs：${error.message}`);
  });

  proc.on('close', (code) => {
    if (settled) return;
    settled = true;

    if (job.cancelled) return finishJob(job, 'cancelled', '已取消');
    if (code === 0) {
      try { pruneUnselectedStems(job, model, format); } catch { /* non-fatal */ }
      return finishJob(job, 'done', '分离完成', finalOutputDir(job, model));
    }
    // macOS：MPS 加速失败时自动回退 CPU 重试一次
    if (device === 'mps' && !job.retriedCpu && /mps/i.test(log)) {
      job.retriedCpu = true;
      job.message = 'MPS 加速失败，正在改用 CPU 重试…';
      send('separation-update', { id: job.id, percent: 2, message: job.message });
      return runJob(job, 'cpu', true);
    }
    finishJob(job, 'error', friendlyFailure(log, job.input) || `Demucs 已退出（代码 ${code}）。\n${log.slice(-500)}`);
  });
}

// ---------- IPC ----------
ipcMain.handle('pick-input', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    title: '选择音频或视频文件',
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: '媒体文件', extensions: ['wav', 'mp3', 'flac', 'm4a', 'aac', 'ogg', 'mp4', 'mov', 'mkv', 'm4v'] }]
  });
  return canceled ? [] : filePaths;
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

ipcMain.handle('get-history', () => loadHistory());

ipcMain.handle('clear-history', () => {
  try { fs.writeFileSync(historyFile(), '[]'); } catch { /* non-fatal */ }
  return [];
});

ipcMain.handle('get-queue', () => queueSnapshot());

ipcMain.handle('start-separation', async (_event, options) => {
  const inputs = Array.isArray(options && options.inputs)
    ? options.inputs.filter((file) => file && fs.existsSync(file))
    : [];
  if (!inputs.length) throw new Error('请先选择有效的媒体文件。');

  if (!resolveDemucs()) throw new Error('未找到 Demucs。请在“设置”中选择 Demucs 可执行文件，或在系统中安装 demucs。');

  // 前置检测：视频输入需要 FFmpeg
  const hasVideo = inputs.some((file) => VIDEO_EXTENSIONS.has(path.extname(file).toLowerCase()));
  if (hasVideo && !commandExists('ffmpeg')) {
    throw new Error('处理视频文件需要 FFmpeg。请先安装（macOS：brew install ffmpeg；Windows：winget install ffmpeg），或先将视频转为音频文件。');
  }

  // 前置检测：导出位置剩余磁盘空间
  const free = freeDiskBytes(outputRoot(inputs[0], options.output));
  if (free !== null && free < MIN_FREE_DISK_BYTES * inputs.length) {
    throw new Error(`导出位置磁盘空间可能不足（剩余约 ${(free / 1024 / 1024 / 1024).toFixed(1)} GB，队列 ${inputs.length} 个文件）。请清理磁盘或更换导出位置。`);
  }

  // 空闲且没有待处理任务时，视为开始新一批，清掉上一批的展示项
  if (!current && !queue.some((job) => job.status === 'pending')) queue = [];

  for (const input of inputs) {
    queue.push({
      id: ++jobCounter,
      input,
      output: (options && options.output) || null,
      mode: (options && options.mode) || 'four-stems',
      stems: (options && options.stems) || null,
      status: 'pending',
      percent: 0,
      message: '等待中',
      cancelled: false,
      retriedCpu: false
    });
  }
  broadcastQueue();
  processQueue();
  return { queued: inputs.length };
});

ipcMain.handle('cancel-separation', () => {
  for (const job of queue) {
    if (job.status === 'pending') { job.status = 'cancelled'; job.message = '已取消'; }
  }
  if (current) {
    current.cancelled = true;
    killProcessTree(currentProc);
  } else {
    broadcastQueue();
    processQueue();
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

function stopEverything() {
  for (const job of queue) {
    if (job.status === 'pending') { job.status = 'cancelled'; job.message = '已取消'; }
  }
  if (current) {
    current.cancelled = true;
    killProcessTree(currentProc);
  }
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('before-quit', stopEverything);

app.on('window-all-closed', () => {
  stopEverything();
  if (process.platform !== 'darwin') app.quit();
});
