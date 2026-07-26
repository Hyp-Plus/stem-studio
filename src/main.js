const { app, BrowserWindow, dialog, ipcMain, shell, Notification } = require('electron');
const { spawn, execFileSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const https = require('node:https');
const os = require('node:os');
const path = require('node:path');

let mainWindow;
let queue = [];        // 任务队列（保留终态项用于展示，开始新一批时清空）
let current = null;    // 正在运行的队列项
let currentProc = null;
let jobCounter = 0;

const lib = require('./lib');
const { MODEL_STEMS, STEM_LABELS, FORMAT_EXT, DEFAULT_SETTINGS, MODEL_FILES } = lib;
const MIN_FREE_DISK_BYTES = 2 * 1024 * 1024 * 1024; // 2 GB

// ---------- 设置持久化 ----------

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

// ---------- FFmpeg 发现 ----------
// demucs 按名字（ffmpeg/ffprobe）在 PATH 里找，所以这里解析出目录、
// spawn 引擎时把目录前置到 PATH 即可，engine 与 shim 都无需感知
function resolveFfmpegDir() {
  const bundled = path.join(process.resourcesPath, 'ffmpeg');
  const binary = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
  if (fs.existsSync(path.join(bundled, binary))) return bundled;

  const fromEnv = process.env.STEM_STUDIO_FFMPEG;
  if (fromEnv && fs.existsSync(fromEnv)) return path.dirname(fromEnv);

  return null;
}

function engineEnv() {
  const dir = resolveFfmpegDir();
  if (!dir) return process.env;
  return { ...process.env, PATH: `${dir}${path.delimiter}${process.env.PATH || ''}` };
}

function ffmpegReady() {
  return Boolean(resolveFfmpegDir()) || commandExists('ffmpeg');
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

// ---------- 模型下载管理 ----------
// 模型直接放进 torch 缓存目录（引擎从这里读取），路径规则与 torch.hub.get_dir() 一致
function modelCacheDir() {
  const cacheRoot = process.env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache');
  return path.join(cacheRoot, 'torch', 'hub', 'checkpoints');
}

const modelDownloads = new Map(); // name → { request, received, total, cancelled }

function modelPaths(name) {
  const entry = MODEL_FILES[name];
  return {
    final: path.join(modelCacheDir(), entry.file),
    part: path.join(modelCacheDir(), `${entry.file}.part`)
  };
}

function fileSize(filePath) {
  try { return fs.statSync(filePath).size; } catch { return 0; }
}

function modelStatus(name) {
  const entry = MODEL_FILES[name];
  const { final, part } = modelPaths(name);
  const finalBytes = fileSize(final);
  const partBytes = fileSize(part);
  const active = modelDownloads.get(name);
  return {
    name,
    label: entry.label,
    totalBytes: entry.bytes,
    ready: finalBytes === entry.bytes,
    partBytes,
    downloading: Boolean(active),
    percent: active
      ? lib.downloadPercent(active.received, entry.bytes)
      : (partBytes ? lib.downloadPercent(partBytes, entry.bytes) : (finalBytes === entry.bytes ? 100 : 0))
  };
}

function broadcastModel(name, extra) {
  send('model-progress', { ...modelStatus(name), ...extra });
}

// 对已有文件流式计算 SHA256（续传时需先吃掉 .part 的已有内容）
function hashFile(filePath, hash) {
  return new Promise((resolve, reject) => {
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', resolve);
    stream.on('error', reject);
  });
}

async function startModelDownload(name) {
  const entry = MODEL_FILES[name];
  if (!entry) throw new Error('未知模型');
  if (modelDownloads.has(name)) return modelStatus(name);
  const { final, part } = modelPaths(name);
  if (fileSize(final) === entry.bytes) return modelStatus(name);
  fs.mkdirSync(modelCacheDir(), { recursive: true });

  // 大小异常的 .part（比如注册表升级后残留）直接作废重下
  let partBytes = fileSize(part);
  if (partBytes >= entry.bytes) { try { fs.rmSync(part, { force: true }); } catch { /* non-fatal */ } partBytes = 0; }

  const hash = crypto.createHash('sha256');
  if (partBytes) await hashFile(part, hash);

  const state = { request: null, received: partBytes, total: entry.bytes, cancelled: false };
  modelDownloads.set(name, state);

  const range = lib.resumeRange(partBytes);
  const request = https.get(entry.url, { headers: range ? { Range: range } : {}, timeout: 30000 }, (response) => {
    // 416 = 服务器认为范围无效；作废 .part 从头再来
    if (response.statusCode === 416 || (range && response.statusCode === 200)) {
      response.resume();
      modelDownloads.delete(name);
      try { fs.rmSync(part, { force: true }); } catch { /* non-fatal */ }
      startModelDownload(name).catch((error) => broadcastModel(name, { error: lib.classifyDownloadFailure(error) }));
      return;
    }
    if (response.statusCode !== 200 && response.statusCode !== 206) {
      response.resume();
      modelDownloads.delete(name);
      broadcastModel(name, { error: lib.classifyDownloadFailure(`HTTP ${response.statusCode}`) });
      return;
    }

    const sink = fs.createWriteStream(part, { flags: partBytes ? 'a' : 'w' });
    let lastSent = 0;
    response.on('data', (chunk) => {
      hash.update(chunk);
      state.received += chunk.length;
      const now = Date.now();
      if (now - lastSent > 400) { lastSent = now; broadcastModel(name); }
    });
    response.pipe(sink);

    sink.on('finish', () => {
      modelDownloads.delete(name);
      if (state.cancelled) return broadcastModel(name, { info: '已暂停，可继续下载' });
      const digest = hash.digest('hex');
      if (fileSize(part) !== entry.bytes || !lib.verifyModelDigest(name, digest)) {
        try { fs.rmSync(part, { force: true }); } catch { /* non-fatal */ }
        broadcastModel(name, { error: '文件校验失败，已删除损坏文件，请重新下载。' });
        return;
      }
      fs.renameSync(part, final);
      broadcastModel(name, { info: '下载完成，校验通过' });
    });

    response.on('error', (error) => {
      modelDownloads.delete(name);
      try { sink.close(); } catch { /* non-fatal */ }
      broadcastModel(name, state.cancelled ? { info: '已暂停，可继续下载' } : { error: lib.classifyDownloadFailure(error) });
    });
  });

  state.request = request;
  request.on('timeout', () => request.destroy(new Error('ETIMEDOUT')));
  request.on('error', (error) => {
    modelDownloads.delete(name);
    broadcastModel(name, state.cancelled ? { info: '已暂停，可继续下载' } : { error: lib.classifyDownloadFailure(error) });
  });
  broadcastModel(name);
  return modelStatus(name);
}

function cancelModelDownload(name) {
  const active = modelDownloads.get(name);
  if (active) {
    active.cancelled = true;
    try { active.request.destroy(new Error('aborted')); } catch { /* non-fatal */ }
    modelDownloads.delete(name);
  }
  broadcastModel(name, { info: '已暂停，可继续下载' });
  return modelStatus(name);
}

// 离线导入：校验后放入缓存目录（filePath 为空时弹出选择框）
async function importModel(name, filePath) {
  const entry = MODEL_FILES[name];
  if (!entry) throw new Error('未知模型');
  let source = filePath;
  if (!source) {
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
      title: `选择${entry.label}文件（${entry.file}）`,
      properties: ['openFile'],
      filters: [{ name: '模型文件', extensions: ['th'] }]
    });
    if (canceled) return modelStatus(name);
    source = filePaths[0];
  }
  if (fileSize(source) !== entry.bytes) {
    return { ...modelStatus(name), error: `文件大小不符（应为 ${(entry.bytes / 1024 / 1024).toFixed(0)} MB），请确认选择的是 ${entry.file}。` };
  }
  const hash = crypto.createHash('sha256');
  await hashFile(source, hash);
  if (!lib.verifyModelDigest(name, hash.digest('hex'))) {
    return { ...modelStatus(name), error: '文件校验失败，内容与官方模型不一致。' };
  }
  fs.mkdirSync(modelCacheDir(), { recursive: true });
  fs.copyFileSync(source, modelPaths(name).final);
  broadcastModel(name, { info: '导入成功，校验通过' });
  return modelStatus(name);
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
  return lib.buildDemucsArgs({
    mode: job.mode,
    settings: loadSettings(),
    root: outputRoot(job.input, job.output),
    input: job.input,
    device
  });
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
    // 保存失败原因，供历史列表展示
    message: status === 'error' ? message : null,
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
      // 窗口不在前台时发系统通知
      if (Notification.isSupported() && mainWindow && !mainWindow.isDestroyed() && !mainWindow.isFocused()) {
        const failed = queue.length - doneJobs.length;
        new Notification({
          title: 'Stem Studio',
          body: failed === 0 ? `分离完成：${doneJobs.length} 个文件已导出。` : `完成 ${doneJobs.length}/${queue.length} 个文件，${failed} 个未完成。`
        }).show();
      }
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
  const proc = spawn(demucs, args, { windowsHide: true, detached: process.platform !== 'win32', env: engineEnv() });
  currentProc = proc;

  let log = '';
  let progressState = { passes: 0, lastPercent: 0 };
  let settled = false;

  const onData = (data) => {
    if (settled || job.cancelled) return;
    const text = data.toString();
    log = (log + text).slice(-20000);

    progressState = lib.nextProgress(progressState, text, shifts);
    const message = progressState.downloading
      ? '首次使用，正在下载模型文件…'
      : (text.trim().slice(-160) || '正在分离音轨…');
    job.percent = progressState.overall;
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
    finishJob(job, 'error', lib.classifyFailure(log, lib.isVideoPath(job.input)) || `Demucs 已退出（代码 ${code}）。\n${log.slice(-500)}`);
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

ipcMain.handle('set-settings', (_event, patch) => saveSettings(lib.sanitizeSettings(patch)));

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

  // 前置检测：视频输入需要 FFmpeg（打包版已内置；开发/异常环境才会触发）
  const hasVideo = inputs.some((file) => lib.isVideoPath(file));
  if (hasVideo && !ffmpegReady()) {
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
  try { saveSettings({ lastMode: (options && options.mode) || 'six-stems' }); } catch { /* non-fatal */ }
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

ipcMain.handle('models-status', () => Object.keys(MODEL_FILES).map((name) => modelStatus(name)));

ipcMain.handle('model-download', (_event, name) => startModelDownload(name));

ipcMain.handle('model-download-cancel', (_event, name) => cancelModelDownload(name));

ipcMain.handle('model-import', (_event, name, filePath) => importModel(name, filePath || null));

ipcMain.handle('app-version', () => app.getVersion());

// ---------- 分离工作台 ----------
const STEM_ORDER = ['vocals', 'piano', 'guitar', 'bass', 'drums', 'other'];
const STEM_AUDIO_EXTS = ['.wav', '.flac', '.mp3'];

// 列出输出目录里可加载进工作台的 stem 文件
ipcMain.handle('list-stems', (_event, dir) => {
  if (!dir || !fs.existsSync(dir)) return [];
  const found = [];
  for (const file of fs.readdirSync(dir)) {
    const ext = path.extname(file).toLowerCase();
    const stem = path.basename(file, ext);
    if (STEM_AUDIO_EXTS.includes(ext) && STEM_ORDER.includes(stem)) {
      found.push({ id: stem, label: STEM_LABELS[stem] || stem, path: path.join(dir, file) });
    }
  }
  return found.sort((a, b) => STEM_ORDER.indexOf(a.id) - STEM_ORDER.indexOf(b.id));
});

// 读音频文件字节流给 decodeAudioData（限制在已知 stem 扩展名内）
ipcMain.handle('read-audio-file', async (_event, filePath) => {
  if (!STEM_AUDIO_EXTS.includes(path.extname(filePath || '').toLowerCase())) {
    throw new Error('不支持的音频文件类型。');
  }
  return fs.promises.readFile(filePath);
});

// 按工作台当前增益混音导出（弹保存对话框；ffmpeg 已内置）
ipcMain.handle('export-mix', async (_event, payload) => {
  const { stems, gains, defaultName } = payload || {};
  if (!Array.isArray(stems) || !stems.length) return { error: '没有可导出的音轨。' };
  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    title: '导出混音',
    defaultPath: path.join(path.dirname(stems[0].path), defaultName || '混音.wav'),
    filters: [
      { name: 'WAV 无损', extensions: ['wav'] },
      { name: 'MP3 320kbps', extensions: ['mp3'] },
      { name: 'FLAC 无损压缩', extensions: ['flac'] }
    ]
  });
  if (canceled || !filePath) return { cancelled: true };
  const args = lib.buildMixArgs(stems, gains || {}, filePath);
  if (!args) return { error: '所有音轨都是静音，没有可导出的声音。' };

  const dir = resolveFfmpegDir();
  const binary = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
  const ffmpeg = dir ? path.join(dir, binary) : 'ffmpeg';
  return new Promise((resolve) => {
    let log = '';
    const child = spawn(ffmpeg, args, { env: engineEnv() });
    child.stderr.on('data', (chunk) => { log += chunk; });
    child.on('error', (error) => resolve({ error: `无法启动 FFmpeg：${error.message}` }));
    child.on('close', (code) => {
      if (code === 0) resolve({ outPath: filePath });
      else resolve({ error: `混音导出失败（FFmpeg 退出码 ${code}）：${log.slice(-200)}` });
    });
  });
});

// ---------- 生命周期 ----------
function createWindow() {
  const saved = loadSettings().windowBounds;
  const bounds = saved && Number.isFinite(saved.width) && Number.isFinite(saved.height)
    ? { width: Math.max(900, saved.width), height: Math.max(640, saved.height), x: saved.x, y: saved.y }
    : { width: 1120, height: 760 };
  mainWindow = new BrowserWindow({
    ...bounds,
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
  mainWindow.on('close', () => {
    try { saveSettings({ windowBounds: mainWindow.getBounds() }); } catch { /* non-fatal */ }
  });
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
