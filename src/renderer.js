const state = { input: null, output: null, lastOutput: null, stemOptions: null };
const $ = (id) => document.getElementById(id);
const MEDIA_EXTENSIONS = ['wav', 'mp3', 'flac', 'm4a', 'aac', 'ogg', 'mp4', 'mov', 'mkv', 'm4v'];

function mode() { return document.querySelector('input[name="mode"]:checked').value; }
function currentModel() { return mode() === 'six-stems' ? 'htdemucs_6s' : 'htdemucs'; }
function setNotice(message, isError = false) { $('notice').textContent = message; $('notice').classList.toggle('error', isError); }
function setRunning(running) {
  $('start-button').disabled = running; $('cancel-button').hidden = !running;
  $('input-button').disabled = running; $('output-button').disabled = running;
}

// ---------- 源文件 ----------
function setInput(file) {
  state.input = file;
  $('input-name').textContent = file.split(/[\\/]/).at(-1);
  setNotice('已选择源文件。');
}

$('input-button').addEventListener('click', async () => {
  const file = await window.stemStudio.pickInput();
  if (file) setInput(file);
});

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
  if ($('start-button').disabled) return; // 任务进行中不接受拖入
  const file = event.dataTransfer.files && event.dataTransfer.files[0];
  if (!file) return;
  const filePath = window.stemStudio.pathForFile(file);
  const extension = filePath.split('.').at(-1).toLowerCase();
  if (!MEDIA_EXTENSIONS.includes(extension)) return setNotice(`不支持的文件类型：.${extension}`, true);
  setInput(filePath);
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
  if (!state.input) return setNotice('请先选择一个音频或视频文件。', true);
  const stems = selectedStems();
  if (!stems.length) return setNotice('请至少选择一条要导出的音轨。', true);
  try {
    $('progress-area').hidden = false; $('open-button').hidden = true; setRunning(true);
    await window.stemStudio.start({ input: state.input, output: state.output, mode: mode(), stems });
  } catch (error) { setRunning(false); setNotice(error.message, true); }
});
$('cancel-button').addEventListener('click', () => window.stemStudio.cancel());
$('open-button').addEventListener('click', () => window.stemStudio.openPath(state.lastOutput));

window.stemStudio.onUpdate((update) => {
  $('progress-message').textContent = update.message;
  $('progress-value').textContent = `${update.percent || 0}%`;
  $('progress-bar').style.width = `${update.percent || 0}%`;
  if (update.state === 'done') { state.lastOutput = update.output; setRunning(false); $('open-button').hidden = false; setNotice('已完成。各个音轨保存在导出文件夹中。'); }
  if (update.state === 'cancelled') { setRunning(false); $('progress-area').hidden = true; setNotice('任务已取消。'); }
  if (update.state === 'error') { setRunning(false); setNotice(update.message, true); }
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
  } catch { /* 初始化失败不阻塞界面 */ }
  checkEngine();
})();
