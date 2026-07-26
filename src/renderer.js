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
      ? `<button class="row-open" data-dir="${escapeHtml(job.outputDir)}">打开</button>` : '';
    return `<div class="row"><span class="row-name">${escapeHtml(job.name)}</span>${open}<span class="chip ${job.status}">${STATUS_LABELS[job.status] || job.status}${percent}</span></div>`;
  }).join('');
  list.querySelectorAll('.row-open').forEach((button) => button.addEventListener('click', () => window.stemStudio.openPath(button.dataset.dir)));
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

$('input-button').addEventListener('click', async () => {
  const files = await window.stemStudio.pickInput();
  if (files && files.length) addFiles(files);
});
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

document.querySelectorAll('input[name="mode"]').forEach((radio) => radio.addEventListener('change', renderStems));

// ---------- 导出位置 ----------
$('output-button').addEventListener('click', async () => {
  const folder = await window.stemStudio.pickOutput();
  if (folder) { state.output = folder; $('output-name').textContent = folder; }
});

// ---------- 开始 / 取消 / 打开 ----------
$('start-button').addEventListener('click', async () => {
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
});
$('cancel-button').addEventListener('click', () => window.stemStudio.cancel());
$('open-button').addEventListener('click', () => window.stemStudio.openPath(state.lastOutput));

// ---------- 主进程事件 ----------
window.stemStudio.onQueueUpdate((snapshot) => {
  state.jobs = snapshot.jobs;
  state.queueMode = true;
  renderQueue();
  const runningJob = snapshot.jobs.find((job) => job.status === 'running');
  if (runningJob) {
    const position = snapshot.jobs.filter((job) => ['done', 'error', 'cancelled'].includes(job.status)).length + 1;
    $('progress-message').textContent = `（${position}/${snapshot.jobs.length}）${runningJob.name}`;
  }
});

window.stemStudio.onUpdate((update) => {
  const job = state.jobs.find((item) => item.id === update.id);
  if (job) { job.percent = update.percent; job.message = update.message; }
  $('progress-value').textContent = `${update.percent || 0}%`;
  $('progress-bar').style.width = `${update.percent || 0}%`;
  renderQueue();
});

window.stemStudio.onQueueFinished((summary) => {
  setRunning(false);
  state.lastOutput = summary.lastOutput;
  $('open-button').hidden = !summary.lastOutput;
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
      ? `<button class="row-open" data-dir="${escapeHtml(entry.outputDir)}">打开</button>` : '';
    return `<div class="row"><span class="row-name" title="${escapeHtml(entry.input || '')}">${escapeHtml(entry.name || '')}</span>${open}<span class="chip ${entry.status}">${status}${duration}</span></div>`;
  }).join('');
  list.querySelectorAll('.row-open').forEach((button) => button.addEventListener('click', () => window.stemStudio.openPath(button.dataset.dir)));
}

$('clear-history-button').addEventListener('click', async () => {
  await window.stemStudio.clearHistory();
  refreshHistory();
});

// ---------- 设置 ----------
function applySettings(settings) {
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
  await window.stemStudio.setSettings({ enginePath: '' });
  $('engine-path').textContent = '自动检测';
  checkEngine();
});
$('default-output-button').addEventListener('click', async () => {
  const dir = await window.stemStudio.pickDefaultOutput();
  if (dir) $('default-output-path').textContent = dir;
});
$('default-output-clear-button').addEventListener('click', async () => {
  await window.stemStudio.setSettings({ defaultOutputDir: '' });
  $('default-output-path').textContent = '与源文件同目录';
});
$('format-select').addEventListener('change', () => window.stemStudio.setSettings({ format: $('format-select').value }));
$('performance-select').addEventListener('change', () => window.stemStudio.setSettings({ performance: $('performance-select').value }));

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
    refreshHistory();
  } catch { /* 初始化失败不阻塞界面 */ }
  checkEngine();
})();
