const state = {
  files: [],          // 开始前的本地待处理列表
  queueMode: false,   // true = 显示主进程队列
  running: false,
  output: null,
  lastOutput: null,
  stemOptions: null,
  jobs: []
};
const $ = (id) => document.getElementById(id);
const MEDIA_EXTENSIONS = ['wav', 'mp3', 'flac', 'm4a', 'aac', 'ogg', 'mp4', 'mov', 'mkv', 'm4v'];
const STATUS_LABELS = { pending: '等待中', running: '处理中', done: '完成', error: '失败', cancelled: '已取消' };

function mode() { return document.querySelector('input[name="mode"]:checked').value; }
function currentModel() { return mode() === 'six-stems' ? 'htdemucs_6s' : 'htdemucs'; }
function setNotice(message, isError = false) { $('notice').textContent = message; $('notice').classList.toggle('error', isError); }
function escapeHtml(text) { return text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

function setRunning(running) {
  state.running = running;
  $('start-button').disabled = running;
  $('cancel-button').hidden = !running;
  $('output-button').disabled = running;
}

function updateFirstRunHint() {
  const sixStems = mode() === 'six-stems';
  $('first-run-hint').textContent = sixStems
    ? '高质量六轨会占用更多时间和内存；首次使用会下载约 52 MB 模型。'
    : '标准四轨适合首次体验；首次使用会下载约 80 MB 模型。';
}

// ---------- 文件列表 ----------
function renderPendingFiles() {
  const list = $('file-list');
  $('clear-files-button').hidden = state.files.length === 0;
  if (!state.files.length) {
    list.innerHTML = '<p class="file-list-empty">还没有文件，点击下方“添加文件”或直接拖入。</p>';
    return;
  }
  list.innerHTML = state.files.map((file, index) => {
    const name = escapeHtml(file.split(/[\\/]/).at(-1));
    return `<div class="row"><span class="row-name" title="${escapeHtml(file)}">${name}</span><button class="row-remove" data-index="${index}">移除</button></div>`;
  }).join('');
  list.querySelectorAll('.row-remove').forEach((button) => button.addEventListener('click', () => {
    state.files.splice(Number(button.dataset.index), 1);
    renderPendingFiles();
  }));
}

function renderQueue() {
  const list = $('file-list');
  $('clear-files-button').hidden = true;
  if (!state.jobs.length) return renderPendingFiles();
  list.innerHTML = state.jobs.map((job) => {
    const percent = job.status === 'running' ? ` ${job.percent || 0}%` : '';
    const open = job.status === 'done' && job.outputDir
      ? `<button class="row-bench" data-dir="${escapeHtml(job.outputDir)}" data-name="${escapeHtml(job.name)}">工作台</button><button class="row-open" data-dir="${escapeHtml(job.outputDir)}">打开</button>` : '';
    const controls = ['pending', 'running'].includes(job.status)
      ? `<button class="row-cancel" data-id="${job.id}">取消</button>`
      : ['error', 'cancelled'].includes(job.status)
        ? `<button class="row-retry" data-id="${job.id}">重试</button>` : '';
    // 失败时把中文错误原因展示在行内，否则用户只能看到"失败"二字
    const detail = job.status === 'error' && job.message
      ? `<span class="row-detail" title="${escapeHtml(job.message)}">${escapeHtml(job.message)}</span>` : '';
    return `<div class="row"><span class="row-name">${escapeHtml(job.name)}</span><span class="chip ${job.status}">${STATUS_LABELS[job.status] || job.status}${percent}</span>${controls}${open}${detail}</div>`;
  }).join('');
  list.querySelectorAll('.row-open').forEach((button) => button.addEventListener('click', () => window.stemStudio.openPath(button.dataset.dir)));
  list.querySelectorAll('.row-bench').forEach((button) => button.addEventListener('click', () => openWorkbench(button.dataset.dir, button.dataset.name)));
  list.querySelectorAll('.row-cancel').forEach((button) => button.addEventListener('click', () => window.stemStudio.cancelJob(button.dataset.id)));
  list.querySelectorAll('.row-retry').forEach((button) => button.addEventListener('click', async () => {
    try { await window.stemStudio.retryJob(button.dataset.id); } catch (error) { setNotice(error.message, true); }
  }));
}

async function addFiles(paths) {
  const fresh = paths.filter((file) => {
    const extension = file.split('.').at(-1).toLowerCase();
    return MEDIA_EXTENSIONS.includes(extension);
  });
  if (!fresh.length) return setNotice('没有可用的媒体文件（支持音频与常见视频格式）。', true);

  if (state.running) {
    // 任务进行中：直接加入主进程队列
    try {
      await window.stemStudio.start({ inputs: fresh, output: state.output, mode: mode(), stems: selectedStems() });
      setNotice(`已加入队列：${fresh.length} 个文件。`);
    } catch (error) { setNotice(error.message, true); }
    return;
  }
  if (state.queueMode) { state.queueMode = false; state.jobs = []; state.files = []; }
  const existing = new Set(state.files);
  state.files.push(...fresh.filter((file) => !existing.has(file)));
  renderPendingFiles();
  setNotice(`列表中共 ${state.files.length} 个文件。`);
}

async function chooseInput() {
  const files = await window.stemStudio.pickInput();
  if (files && files.length) addFiles(files);
}
$('input-button').addEventListener('click', chooseInput);
$('input-button-copy').addEventListener('click', chooseInput);
$('clear-files-button').addEventListener('click', () => { state.files = []; renderPendingFiles(); });

// ---------- 拖拽导入 ----------
let dragDepth = 0;
document.addEventListener('dragover', (event) => event.preventDefault());
document.addEventListener('dragenter', (event) => {
  event.preventDefault();
  dragDepth += 1;
  $('drop-overlay').hidden = false;
});
document.addEventListener('dragleave', (event) => {
  event.preventDefault();
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) $('drop-overlay').hidden = true;
});
document.addEventListener('drop', (event) => {
  event.preventDefault();
  dragDepth = 0;
  $('drop-overlay').hidden = true;
  const files = Array.from(event.dataTransfer.files || []).map((file) => window.stemStudio.pathForFile(file));
  if (files.length) addFiles(files);
});

// ---------- 导出音轨选择 ----------
function renderStems() {
  if (!state.stemOptions) return;
  const { models, labels } = state.stemOptions;
  const stems = models[currentModel()];
  $('stems').innerHTML = stems.map((stem) =>
    `<label class="stem"><input type="checkbox" value="${stem}" checked />${labels[stem] || stem}</label>`
  ).join('');
}

function selectedStems() {
  return Array.from(document.querySelectorAll('#stems input:checked')).map((box) => box.value);
}

document.querySelectorAll('input[name="mode"]').forEach((radio) => radio.addEventListener('change', () => {
  renderStems();
  updateFirstRunHint();
}));

$('stems-toggle').addEventListener('click', () => {
  const boxes = Array.from(document.querySelectorAll('#stems input'));
  const allChecked = boxes.every((box) => box.checked);
  boxes.forEach((box) => { box.checked = !allChecked; });
});

// ---------- 导出位置 ----------
$('output-button').addEventListener('click', async () => {
  const folder = await window.stemStudio.pickOutput();
  if (folder) { state.output = folder; $('output-name').textContent = folder; }
});

// ---------- 开始 / 取消 / 打开 ----------
async function startSeparation() {
  if (!state.files.length) return setNotice('请先添加至少一个音频或视频文件。', true);
  const stems = selectedStems();
  if (!stems.length) return setNotice('请至少选择一条要导出的音轨。', true);
  try {
    $('progress-area').hidden = false; $('open-button').hidden = true;
    setRunning(true);
    state.queueMode = true;
    await window.stemStudio.start({ inputs: state.files, output: state.output, mode: mode(), stems });
    state.files = [];
  } catch (error) { setRunning(false); state.queueMode = false; setNotice(error.message, true); }
}

$('start-button').addEventListener('click', startSeparation);
$('quick-start-button').addEventListener('click', async () => {
  document.querySelector('input[name="mode"][value="four-stems"]').checked = true;
  $('format-select').value = 'wav';
  $('performance-select').value = 'balanced';
  await window.stemStudio.setSettings({ format: 'wav', performance: 'balanced', lastMode: 'four-stems' });
  renderStems();
  updateFirstRunHint();
  if (!state.files.length) {
    const files = await window.stemStudio.pickInput();
    if (!files || !files.length) return;
    await addFiles(files);
  }
  startSeparation();
});
$('cancel-button').addEventListener('click', () => window.stemStudio.cancel());
$('open-button').addEventListener('click', () => window.stemStudio.openPath(state.lastOutput));
$('bench-button').addEventListener('click', () => openWorkbench(state.lastOutput, '最新分离结果'));

// ---------- 进度、用时与预计剩余 ----------
const progress = { jobId: null, startedAt: 0 };

function formatClock(ms) {
  const seconds = Math.max(0, Math.round(ms / 1000));
  return seconds >= 60 ? `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒` : `${seconds} 秒`;
}

function updateEta(percent) {
  if (!progress.startedAt) return;
  const elapsed = Date.now() - progress.startedAt;
  let text = `已用 ${formatClock(elapsed)}`;
  if (percent > 5 && percent < 98) {
    text += ` · 预计剩余 ${formatClock(elapsed * (100 - percent) / percent)}`;
  }
  $('progress-eta').textContent = text;
}

function overallPercent() {
  if (!state.jobs.length) return 0;
  const finished = state.jobs.filter((job) => ['done', 'error', 'cancelled'].includes(job.status)).length;
  const runningJob = state.jobs.find((job) => job.status === 'running');
  const currentPart = runningJob ? (runningJob.percent || 0) / 100 : 0;
  return Math.min(100, Math.round(((finished + currentPart) / state.jobs.length) * 100));
}

// ---------- 主进程事件 ----------
window.stemStudio.onQueueUpdate((snapshot) => {
  state.jobs = snapshot.jobs;
  state.queueMode = true;
  renderQueue();
  const runningJob = snapshot.jobs.find((job) => job.status === 'running');
  if (runningJob) {
    if (progress.jobId !== runningJob.id) { progress.jobId = runningJob.id; progress.startedAt = Date.now(); $('progress-eta').textContent = ''; }
    const position = snapshot.jobs.filter((job) => ['done', 'error', 'cancelled'].includes(job.status)).length + 1;
    $('progress-message').textContent = `（${position}/${snapshot.jobs.length}）${runningJob.name}`;
  }
  $('progress-bar').style.width = `${overallPercent()}%`;
});

window.stemStudio.onUpdate((update) => {
  const job = state.jobs.find((item) => item.id === update.id);
  if (job) { job.percent = update.percent; job.message = update.message; }
  const overall = overallPercent();
  $('progress-value').textContent = state.jobs.length > 1
    ? `当前 ${update.percent || 0}% · 总 ${overall}%`
    : `${update.percent || 0}%`;
  $('progress-bar').style.width = `${overall}%`;
  updateEta(update.percent || 0);
  renderQueue();
});

window.stemStudio.onQueueFinished((summary) => {
  setRunning(false);
  progress.jobId = null;
  progress.startedAt = 0;
  $('progress-eta').textContent = '';
  state.lastOutput = summary.lastOutput;
  $('open-button').hidden = !summary.lastOutput;
  $('bench-button').hidden = !summary.lastOutput;
  $('progress-area').hidden = true;
  const failed = summary.total - summary.doneCount;
  setNotice(failed === 0
    ? `全部完成：${summary.doneCount} 个文件的音轨已导出。`
    : `完成 ${summary.doneCount}/${summary.total} 个，${failed} 个未完成（详见列表）。`, failed !== 0);
  refreshHistory();
});

// ---------- 任务历史 ----------
function formatDuration(ms) {
  if (!ms || ms < 0) return '';
  const seconds = Math.round(ms / 1000);
  return seconds >= 60 ? `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒` : `${seconds} 秒`;
}

async function refreshHistory() {
  const history = await window.stemStudio.getHistory();
  const list = $('history-list');
  if (!history.length) {
    list.innerHTML = '<p class="file-list-empty">暂无历史记录。</p>';
    return;
  }
  list.innerHTML = history.slice(0, 20).map((entry) => {
    const status = STATUS_LABELS[entry.status] || entry.status;
    const duration = entry.durationMs ? ` · ${formatDuration(entry.durationMs)}` : '';
    const open = entry.status === 'done' && entry.outputDir
      ? `<button class="row-bench" data-dir="${escapeHtml(entry.outputDir)}" data-name="${escapeHtml(entry.name || '')}">工作台</button><button class="row-open" data-dir="${escapeHtml(entry.outputDir)}">打开</button>` : '';
    const detail = entry.status === 'error' && entry.message
      ? `<span class="row-detail" title="${escapeHtml(entry.message)}">${escapeHtml(entry.message)}</span>` : '';
    return `<div class="row"><span class="row-name" title="${escapeHtml(entry.input || '')}">${escapeHtml(entry.name || '')}</span><span class="chip ${entry.status}">${status}${duration}</span>${open}${detail}</div>`;
  }).join('');
  list.querySelectorAll('.row-open').forEach((button) => button.addEventListener('click', () => window.stemStudio.openPath(button.dataset.dir)));
  list.querySelectorAll('.row-bench').forEach((button) => button.addEventListener('click', () => openWorkbench(button.dataset.dir, button.dataset.name)));
}

$('clear-history-button').addEventListener('click', async () => {
  await window.stemStudio.clearHistory();
  refreshHistory();
});

// ---------- 设置 ----------
function applySettings(settings) {
  const lastMode = document.querySelector(`input[name="mode"][value="${settings.lastMode}"]`);
  if (lastMode) lastMode.checked = true;
  $('engine-path').textContent = settings.enginePath || '自动检测';
  $('default-output-path').textContent = settings.defaultOutputDir || '与源文件同目录';
  $('format-select').value = settings.format || 'wav';
  $('performance-select').value = settings.performance || 'balanced';
}

$('engine-button').addEventListener('click', async () => {
  const enginePath = await window.stemStudio.pickEngine();
  if (enginePath) { $('engine-path').textContent = enginePath; checkEngine(); }
});
$('engine-clear-button').addEventListener('click', async () => {
  await window.stemStudio.clearEngine();
  $('engine-path').textContent = '自动检测';
  checkEngine();
});
$('default-output-button').addEventListener('click', async () => {
  const dir = await window.stemStudio.pickDefaultOutput();
  if (dir) $('default-output-path').textContent = dir;
});
$('default-output-clear-button').addEventListener('click', async () => {
  await window.stemStudio.clearDefaultOutput();
  $('default-output-path').textContent = '与源文件同目录';
});
$('format-select').addEventListener('change', () => window.stemStudio.setSettings({ format: $('format-select').value }));
$('performance-select').addEventListener('change', () => window.stemStudio.setSettings({ performance: $('performance-select').value }));
function renderMedia(status) {
  const button = $('media-install-button');
  if (status.unsupported) {
    $('media-status').textContent = '当前平台暂不提供一键媒体组件';
    button.hidden = true;
    return;
  }
  if (status.ready) {
    $('media-status').textContent = `已就绪（v${status.version}）`;
    button.hidden = true;
    return;
  }
  button.hidden = false;
  button.disabled = Boolean(status.downloading);
  button.textContent = status.downloading ? `下载中 ${status.percent || 0}%` : '安装并继续';
  $('media-status').textContent = status.error || (status.downloading ? '正在下载并校验媒体组件…' : '未安装（视频与混音导出需要）');
}
async function refreshMedia() {
  try { renderMedia(await window.stemStudio.mediaStatus()); } catch { $('media-status').textContent = '媒体组件状态读取失败'; }
}
$('media-install-button').addEventListener('click', () => window.stemStudio.mediaInstall().catch((error) => {
  renderMedia({ error: error.message });
}));
window.stemStudio.onMediaProgress(renderMedia);
$('update-button').addEventListener('click', async () => {
  const button = $('update-button');
  button.disabled = true;
  $('update-status').textContent = '正在检查更新…';
  try {
    const update = await window.stemStudio.checkForUpdate();
    if (update.error) $('update-status').textContent = update.error;
    else if (!update.available) $('update-status').textContent = `已是最新版本（v${await window.stemStudio.appVersion()}）。`;
    else {
      $('update-status').textContent = `发现 v${update.latest.replace(/^v/, '')}，已打开下载页面。`;
      await window.stemStudio.openExternal(update.url);
    }
  } catch { $('update-status').textContent = '检查更新失败，请稍后重试。'; }
  button.disabled = false;
});

// ---------- 模型管理 ----------
const modelState = new Map(); // name → 最新状态

function formatMb(bytes) { return `${Math.round(bytes / 1024 / 1024)} MB`; }

function modelStatusText(status) {
  if (status.unsupported) return '由 Windows 引擎自动管理';
  if (status.ready) return '已就绪';
  if (status.downloading) return `下载中 ${status.percent == null ? '' : status.percent + '%'}`;
  if (status.partBytes) return `已暂停 ${status.percent}%`;
  return '未下载';
}

function renderModels() {
  const list = $('model-list');
  if (!modelState.size) { list.innerHTML = '<p class="file-list-empty">正在读取模型状态…</p>'; return; }
  list.innerHTML = Array.from(modelState.values()).map((status) => {
    const chipClass = status.unsupported ? 'pending' : (status.ready ? 'done' : (status.downloading ? 'running' : 'pending'));
    const buttons = status.unsupported || status.ready
      ? ''
      : status.downloading
        ? `<button class="model-cancel" data-model="${status.name}">暂停</button>`
        : `<button class="model-download" data-model="${status.name}">${status.partBytes ? '继续下载' : '下载'}</button><button class="model-import" data-model="${status.name}">离线导入</button>`;
    const note = status.error
      ? `<span class="row-detail" title="${escapeHtml(status.error)}">${escapeHtml(status.error)}</span>` : '';
    return `<div class="row"><span class="row-name">${escapeHtml(status.label)} · ${formatMb(status.totalBytes)}</span><span class="chip ${chipClass}">${modelStatusText(status)}</span>${buttons}${note}</div>`;
  }).join('');
  list.querySelectorAll('.model-download').forEach((button) => button.addEventListener('click', () =>
    window.stemStudio.modelDownload(button.dataset.model).catch((error) => setNotice(error.message, true))));
  list.querySelectorAll('.model-cancel').forEach((button) => button.addEventListener('click', () =>
    window.stemStudio.modelDownloadCancel(button.dataset.model)));
  list.querySelectorAll('.model-import').forEach((button) => button.addEventListener('click', async () => {
    const status = await window.stemStudio.modelImport(button.dataset.model);
    if (status && status.error) { modelState.set(status.name, status); renderModels(); }
  }));
}

async function refreshModels() {
  try {
    const statuses = await window.stemStudio.modelsStatus();
    statuses.forEach((status) => modelState.set(status.name, status));
    renderModels();
  } catch { /* 模型状态读取失败不影响主流程 */ }
}

window.stemStudio.onModelProgress((status) => {
  modelState.set(status.name, status);
  renderModels();
  if (status.error) setNotice(`模型下载：${status.error}`, true);
  else if (status.info) setNotice(`${status.label}：${status.info}`);
});

// ---------- 分离工作台 ----------
// Web Audio 多轨同步播放：每轨一个 AudioBuffer + GainNode，同一时钟起播保证相位对齐；
// solo/静音/音量的实际增益由 lib.computeEffectiveGains 同款规则计算（此处内联同步实现）。
const wb = {
  ctx: null, tracks: [], sources: [], duration: 0,
  playing: false, startedAt: 0, offset: 0, raf: 0, dir: null, title: ''
};

function wbEffectiveGains() {
  const anySolo = wb.tracks.some((track) => track.solo);
  const gains = {};
  for (const track of wb.tracks) {
    const audible = anySolo ? track.solo : !track.muted;
    gains[track.id] = audible ? Math.min(1, Math.max(0, track.volume)) : 0;
  }
  return gains;
}

function wbApplyGains() {
  const gains = wbEffectiveGains();
  for (const track of wb.tracks) {
    if (track.gainNode) track.gainNode.gain.value = gains[track.id];
    track.element.classList.toggle('inaudible', gains[track.id] === 0);
  }
}

function wbFormatTime(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function wbPosition() {
  if (!wb.playing) return wb.offset;
  return Math.min(wb.duration, wb.offset + wb.ctx.currentTime - wb.startedAt);
}

function wbDrawWave(track) {
  const canvas = track.canvas;
  const width = canvas.clientWidth || 600;
  const height = canvas.clientHeight || 44;
  canvas.width = width * devicePixelRatio;
  canvas.height = height * devicePixelRatio;
  const g = canvas.getContext('2d');
  g.scale(devicePixelRatio, devicePixelRatio);
  const data = track.buffer.getChannelData(0);
  const step = Math.max(1, Math.floor(data.length / width));
  g.fillStyle = '#3d3f4b';
  for (let x = 0; x < width; x++) {
    let peak = 0;
    const start = x * step;
    for (let i = start; i < Math.min(start + step, data.length); i += 16) {
      const value = Math.abs(data[i]);
      if (value > peak) peak = value;
    }
    const bar = Math.max(1, peak * height);
    g.fillRect(x, (height - bar) / 2, 1, bar);
  }
}

function wbTick() {
  const position = wbPosition();
  $('wb-time').textContent = `${wbFormatTime(position)} / ${wbFormatTime(wb.duration)}`;
  const ratio = wb.duration ? position / wb.duration : 0;
  $('wb-seek-bar').style.width = `${ratio * 100}%`;
  for (const track of wb.tracks) track.playhead.style.left = `${ratio * 100}%`;
  if (wb.playing && position >= wb.duration) { wbPause(); wb.offset = 0; wbTick(); return; }
  if (wb.playing) wb.raf = requestAnimationFrame(wbTick);
}

function wbPlay() {
  if (!wb.tracks.length || wb.playing) return;
  if (wb.offset >= wb.duration) wb.offset = 0;
  wb.ctx.resume();
  wb.startedAt = wb.ctx.currentTime + 0.05; // 统一起播时刻，保证多轨相位一致
  wb.sources = wb.tracks.map((track) => {
    const source = wb.ctx.createBufferSource();
    source.buffer = track.buffer;
    source.connect(track.gainNode);
    source.start(wb.startedAt, wb.offset);
    return source;
  });
  wb.playing = true;
  $('wb-play').textContent = '暂停';
  wb.raf = requestAnimationFrame(wbTick);
}

function wbPause() {
  if (!wb.playing) return;
  wb.offset = wbPosition();
  wb.sources.forEach((source) => { try { source.stop(); } catch { /* 已停 */ } });
  wb.sources = [];
  wb.playing = false;
  $('wb-play').textContent = '播放';
  cancelAnimationFrame(wb.raf);
}

function wbSeek(ratio) {
  const wasPlaying = wb.playing;
  wbPause();
  wb.offset = Math.min(wb.duration, Math.max(0, ratio * wb.duration));
  wbTick();
  if (wasPlaying) wbPlay();
}

function wbSetNotice(message, isError = false) {
  $('wb-notice').textContent = message;
  $('wb-notice').classList.toggle('error', isError);
}

function wbRenderTracks() {
  const list = $('wb-tracks');
  list.innerHTML = wb.tracks.map((track, index) => `
    <div class="wb-track" data-index="${index}">
      <span class="wb-track-name">${escapeHtml(track.label)}</span>
      <div class="wb-wave-wrap"><canvas class="wb-wave"></canvas><div class="wb-playhead"></div></div>
      <div class="wb-track-controls">
        <button class="wb-toggle wb-solo" title="独奏">S</button>
        <button class="wb-toggle wb-mute" title="静音">M</button>
        <input class="wb-volume" type="range" min="0" max="100" value="${Math.round(track.volume * 100)}" />
      </div>
    </div>`).join('');
  list.querySelectorAll('.wb-track').forEach((element, index) => {
    const track = wb.tracks[index];
    track.element = element;
    track.canvas = element.querySelector('.wb-wave');
    track.playhead = element.querySelector('.wb-playhead');
    element.querySelector('.wb-solo').addEventListener('click', (event) => {
      track.solo = !track.solo;
      event.target.classList.toggle('on-solo', track.solo);
      wbApplyGains();
    });
    element.querySelector('.wb-mute').addEventListener('click', (event) => {
      track.muted = !track.muted;
      event.target.classList.toggle('on-mute', track.muted);
      wbApplyGains();
    });
    element.querySelector('.wb-volume').addEventListener('input', (event) => {
      track.volume = Number(event.target.value) / 100;
      wbApplyGains();
    });
    element.querySelector('.wb-wave-wrap').addEventListener('click', (event) => {
      const rect = event.currentTarget.getBoundingClientRect();
      wbSeek((event.clientX - rect.left) / rect.width);
    });
    wbDrawWave(track);
  });
  wbApplyGains();
}

function wbPreset(kind) {
  for (const track of wb.tracks) {
    track.solo = false;
    track.muted = kind === 'karaoke' ? track.id === 'vocals'
      : kind === 'vocals' ? track.id !== 'vocals' : false;
    track.volume = 1;
    track.element.querySelector('.wb-solo').classList.remove('on-solo');
    track.element.querySelector('.wb-mute').classList.toggle('on-mute', track.muted);
    track.element.querySelector('.wb-volume').value = 100;
  }
  wbApplyGains();
}

function setWorkbenchReady(ready) {
  $('wb-empty-state').hidden = ready;
  $('wb-preset-all').disabled = !ready;
  $('wb-preset-karaoke').disabled = !ready;
  $('wb-preset-vocals').disabled = !ready;
  $('wb-export').disabled = !ready;
}

async function openWorkbench(dir, title) {
  // 同一目录的会话还在：中央画布已经是工作台，无需切换页面。
  if (wb.dir === dir && wb.tracks.length) return;
  const stems = await window.stemStudio.listStems(dir);
  if (!stems.length) return setNotice('该目录里没有找到可加载的音轨文件。', true);
  // 换了目录：释放上一个会话
  wbPause();
  wb.tracks.forEach((track) => track.gainNode && track.gainNode.disconnect());
  wb.tracks = [];
  wb.dir = dir; wb.title = title || dir.split(/[\\/]/).at(-1);
  $('wb-title').textContent = `分离工作台 · ${wb.title}`;
  $('wb-subtitle').textContent = dir;
  setWorkbenchReady(false);
  $('wb-loading').hidden = false;
  $('wb-tracks').innerHTML = '';
  $('wb-play').disabled = true;
  wbSetNotice('');
  try {
    wb.ctx = wb.ctx || new AudioContext();
    const loaded = [];
    for (const stem of stems) {
      $('wb-loading').textContent = `正在加载音轨：${stem.label}…`;
      const bytes = await window.stemStudio.readAudioFile(stem.path);
      const buffer = await wb.ctx.decodeAudioData(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
      const gainNode = wb.ctx.createGain();
      gainNode.connect(wb.ctx.destination);
      loaded.push({ ...stem, buffer, gainNode, volume: 1, muted: false, solo: false });
    }
    wb.tracks = loaded;
    wb.duration = Math.max(...loaded.map((track) => track.buffer.duration));
    wb.offset = 0;
    $('wb-loading').hidden = true;
    $('wb-play').disabled = false;
    wbRenderTracks();
    setWorkbenchReady(true);
    wbTick();
  } catch (error) {
    $('wb-loading').textContent = `音轨加载失败：${error.message}`;
  }
}

$('wb-play').addEventListener('click', () => (wb.playing ? wbPause() : wbPlay()));
$('wb-seek').addEventListener('click', (event) => {
  const rect = $('wb-seek').getBoundingClientRect();
  wbSeek((event.clientX - rect.left) / rect.width);
});
$('wb-preset-all').addEventListener('click', () => wbPreset('all'));
$('wb-preset-karaoke').addEventListener('click', () => wbPreset('karaoke'));
$('wb-preset-vocals').addEventListener('click', () => wbPreset('vocals'));
$('wb-export').addEventListener('click', async () => {
  const gains = wbEffectiveGains();
  const anyVocal = (gains.vocals || 0) > 0;
  const suffix = !anyVocal ? '伴奏' : Object.values(gains).filter((gain) => gain > 0).length === 1 ? '独奏' : '混音';
  const format = $('format-select').value === 'flac' ? 'flac' : $('format-select').value === 'mp3' ? 'mp3' : 'wav';
  wbSetNotice('正在导出混音…');
  const result = await window.stemStudio.exportMix({
    stems: wb.tracks.map((track) => ({ id: track.id, path: track.path })),
    gains,
    defaultName: `${wb.title}-${suffix}.${format}`
  });
  if (result.cancelled) return wbSetNotice('');
  if (result.error) return wbSetNotice(result.error, true);
  wbSetNotice(`已导出：${result.outPath}`);
});
document.addEventListener('keydown', (event) => {
  if (event.key === ' ' && wb.tracks.length && !['BUTTON', 'SELECT', 'INPUT', 'TEXTAREA'].includes((event.target && event.target.tagName) || '')) {
    event.preventDefault();
    (wb.playing ? wbPause() : wbPlay());
  }
});

// ---------- 快捷键 ----------
document.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter' || state.running) return;
  const tag = (event.target && event.target.tagName) || '';
  if (['BUTTON', 'SELECT', 'INPUT', 'TEXTAREA'].includes(tag)) return;
  $('start-button').click();
});

// ---------- 引擎检测 ----------
async function checkEngine() {
  const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('检测超时')), 4000));
  try {
    const engine = await Promise.race([window.stemStudio.engineStatus(), timeout]);
    $('engine').textContent = engine.available ? '● 引擎已就绪' : '● 未找到引擎';
    $('engine').classList.toggle('offline', !engine.available);
    if (!engine.available) setNotice('尚未找到 Demucs。请在下方“设置”中选择 Demucs 可执行文件，或安装后重启应用。', true);
  } catch {
    $('engine').textContent = '● 引擎检测失败';
    $('engine').classList.add('offline');
    setNotice('Demucs 检测在 4 秒内未完成。请退出后重新打开应用；若仍发生，请检查安装日志。', true);
  }
}

// ---------- 初始化 ----------
(async () => {
  try {
    const [settings, stemOptions] = await Promise.all([
      window.stemStudio.getSettings(),
      window.stemStudio.stemOptions()
    ]);
    applySettings(settings);
    state.stemOptions = stemOptions;
    renderStems();
    updateFirstRunHint();
    refreshHistory();
    refreshModels();
    refreshMedia();
    window.stemStudio.appVersion().then((version) => { $('app-version').textContent = `v${version}`; }).catch(() => {});
  } catch { /* 初始化失败不阻塞界面 */ }
  checkEngine();
})();
