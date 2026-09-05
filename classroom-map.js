const STORAGE_KEY = 'magnetic-classroom-map-v1';
const state = { records: [], mode: 'magnitude', selectedKey: null };

const $ = (id) => document.getElementById(id);
const canvas = $('map-canvas');
const ctx = canvas.getContext('2d');

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function magnitude(record) {
  return Math.hypot(record.bx, record.by, record.bz);
}

function keyOf(record) {
  return `${record.row}-${record.col}`;
}

function analysis() {
  if (!state.records.length) return { baseline: [0, 0, 0], residuals: [], threshold: Infinity, anomalies: new Set() };
  const baseline = [
    median(state.records.map((r) => r.bx)),
    median(state.records.map((r) => r.by)),
    median(state.records.map((r) => r.bz)),
  ];
  const residuals = state.records.map((r) => Math.hypot(r.bx - baseline[0], r.by - baseline[1], r.bz - baseline[2]));
  const center = median(residuals);
  const mad = median(residuals.map((v) => Math.abs(v - center)));
  const threshold = Math.max(5, center + 3 * 1.4826 * mad);
  const anomalies = new Set(state.records.filter((_, i) => residuals[i] > threshold).map(keyOf));
  return { baseline, residuals, threshold, anomalies };
}

function persist() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.records));
}

function restore() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    if (Array.isArray(saved)) state.records = saved.filter(validRecord);
  } catch {
    state.records = [];
  }
}

function validRecord(record) {
  return Number.isInteger(record?.row) && Number.isInteger(record?.col)
    && [record.bx, record.by, record.bz].every(Number.isFinite);
}

function toast(message) {
  const el = $('toast');
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove('show'), 1800);
}

function colorAt(t, alpha = 1) {
  const stops = [
    [0, [37, 99, 166]],
    [0.38, [21, 160, 140]],
    [0.7, [227, 179, 65]],
    [1, [189, 62, 66]],
  ];
  const x = Math.max(0, Math.min(1, t));
  let a = stops[0], b = stops.at(-1);
  for (let i = 1; i < stops.length; i++) {
    if (x <= stops[i][0]) { a = stops[i - 1]; b = stops[i]; break; }
  }
  const f = (x - a[0]) / Math.max(1e-9, b[0] - a[0]);
  const rgb = a[1].map((v, i) => Math.round(v + (b[1][i] - v) * f));
  return `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${alpha})`;
}

function canvasMetrics() {
  const dpr = Math.min(devicePixelRatio || 1, 2);
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(320, Math.round(rect.width * dpr));
  const height = Math.max(300, Math.round(rect.height * dpr));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { width: rect.width, height: rect.height };
}

function draw() {
  const { width, height } = canvasMetrics();
  ctx.clearRect(0, 0, width, height);
  $('empty-state').style.display = state.records.length ? 'none' : 'grid';
  if (!state.records.length) return;

  const rows = Math.max(...state.records.map((r) => r.row), 1);
  const cols = Math.max(...state.records.map((r) => r.col), 1);
  const pad = { left: 54, right: 30, top: 32, bottom: 46 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const cellW = plotW / cols;
  const cellH = plotH / rows;
  const values = state.records.map(magnitude);
  const min = Math.min(...values), max = Math.max(...values);
  const range = Math.max(1e-9, max - min);
  const lookup = new Map(state.records.map((r) => [keyOf(r), r]));
  const info = analysis();

  ctx.fillStyle = '#fbfcfd';
  ctx.fillRect(pad.left, pad.top, plotW, plotH);
  for (let row = 1; row <= rows; row++) {
    for (let col = 1; col <= cols; col++) {
      const record = lookup.get(`${row}-${col}`);
      const x = pad.left + (col - 1) * cellW;
      const y = pad.top + (row - 1) * cellH;
      if (state.mode === 'magnitude' && record) {
        const t = (magnitude(record) - min) / range;
        ctx.fillStyle = colorAt(t, 0.84);
        ctx.fillRect(x + 1, y + 1, Math.max(0, cellW - 2), Math.max(0, cellH - 2));
      }
      ctx.strokeStyle = '#d5dfe4';
      ctx.lineWidth = 1;
      ctx.strokeRect(x, y, cellW, cellH);
    }
  }

  ctx.font = '12px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#53646e';
  for (let col = 1; col <= cols; col++) ctx.fillText(`${col}列`, pad.left + (col - 0.5) * cellW, pad.top - 15);
  ctx.textAlign = 'right';
  for (let row = 1; row <= rows; row++) ctx.fillText(`${row}排`, pad.left - 9, pad.top + (row - 0.5) * cellH);

  for (const record of state.records) {
    const x = pad.left + (record.col - 0.5) * cellW;
    const y = pad.top + (record.row - 0.5) * cellH;
    const selected = keyOf(record) === state.selectedKey;
    if (state.mode === 'vector') drawVector(x, y, record, info.baseline, Math.min(cellW, cellH) * 0.36);
    if (state.mode === 'magnitude') {
      ctx.fillStyle = magnitude(record) > (min + max) / 2 ? '#fff' : '#18313d';
      ctx.font = `${Math.max(10, Math.min(14, cellW * 0.16))}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText(magnitude(record).toFixed(1), x, y);
    }
    if (info.anomalies.has(keyOf(record))) {
      ctx.strokeStyle = '#b42318';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(x, y, Math.max(8, Math.min(cellW, cellH) * 0.24), 0, Math.PI * 2);
      ctx.stroke();
    }
    if (selected) {
      ctx.strokeStyle = '#111827';
      ctx.lineWidth = 2;
      ctx.strokeRect(pad.left + (record.col - 1) * cellW + 3, pad.top + (record.row - 1) * cellH + 3, cellW - 6, cellH - 6);
    }
  }

  ctx.fillStyle = '#53646e';
  ctx.font = '11px system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(state.mode === 'magnitude' ? `|B| 范围 ${min.toFixed(1)} 至 ${max.toFixed(1)} μT` : '箭头方向表示 (Bx, By)，长度按相对水平分量缩放', pad.left, height - 18);
}

function drawVector(x, y, record, baseline, maxLength) {
  const dx = record.bx, dy = -record.by;
  const horizontal = Math.hypot(dx, dy);
  const baseHorizontal = Math.max(1, Math.hypot(baseline[0], baseline[1]));
  const length = Math.max(8, Math.min(maxLength, maxLength * horizontal / baseHorizontal));
  const ux = horizontal ? dx / horizontal : 0;
  const uy = horizontal ? dy / horizontal : 0;
  const x2 = x + ux * length, y2 = y + uy * length;
  ctx.strokeStyle = '#0f766e';
  ctx.fillStyle = '#0f766e';
  ctx.lineWidth = 2.2;
  ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x2, y2); ctx.stroke();
  const head = 6;
  ctx.beginPath();
  ctx.moveTo(x2, y2);
  ctx.lineTo(x2 - ux * head - uy * head * 0.65, y2 - uy * head + ux * head * 0.65);
  ctx.lineTo(x2 - ux * head + uy * head * 0.65, y2 - uy * head - ux * head * 0.65);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.beginPath(); ctx.arc(x, y, 2.5, 0, Math.PI * 2); ctx.fill();
}

function updateStats() {
  const info = analysis();
  const count = state.records.length;
  $('stat-count').textContent = count;
  $('stat-mean').textContent = count ? `${(state.records.reduce((s, r) => s + magnitude(r), 0) / count).toFixed(1)} μT` : '--';
  $('stat-base').textContent = count ? `${info.baseline.map((v) => v.toFixed(1)).join(', ')}` : '--';
  $('stat-anomaly').textContent = info.anomalies.size;
}

function renderTable() {
  const body = $('records-body');
  body.innerHTML = '';
  const info = analysis();
  for (const record of [...state.records].sort((a, b) => a.row - b.row || a.col - b.col)) {
    const tr = document.createElement('tr');
    if (keyOf(record) === state.selectedKey) tr.classList.add('selected');
    if (info.anomalies.has(keyOf(record))) tr.title = '异常候选，请现场复核';
    tr.innerHTML = `<td>${record.row}-${record.col}</td><td>${record.bx.toFixed(1)}</td><td>${record.by.toFixed(1)}</td><td>${record.bz.toFixed(1)}</td><td>${magnitude(record).toFixed(1)}</td><td class="note" title="${escapeHtml(record.note)}">${escapeHtml(record.note || '')}</td><td><button class="row-delete" type="button" aria-label="删除 ${record.row} 排 ${record.col} 列">×</button></td>`;
    tr.onclick = (event) => {
      if (event.target.closest('.row-delete')) return;
      selectRecord(record);
    };
    tr.querySelector('.row-delete').onclick = () => removeRecord(record);
    body.appendChild(tr);
  }
}

function escapeHtml(value) {
  return String(value || '').replace(/[&<>"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[char]));
}

function render() {
  updateStats();
  renderTable();
  draw();
  document.body.dataset.records = String(state.records.length);
  document.body.dataset.anomalies = String(analysis().anomalies.size);
  document.body.dataset.mode = state.mode;
}

function selectRecord(record) {
  state.selectedKey = keyOf(record);
  $('row').value = record.row;
  $('col').value = record.col;
  $('bx').value = record.bx;
  $('by').value = record.by;
  $('bz').value = record.bz;
  $('note').value = record.note || '';
  render();
}

function resetForm() {
  state.selectedKey = null;
  $('entry-form').reset();
  $('row').value = 1;
  $('col').value = 1;
  render();
}

function removeRecord(record) {
  state.records = state.records.filter((item) => keyOf(item) !== keyOf(record));
  if (state.selectedKey === keyOf(record)) state.selectedKey = null;
  persist();
  render();
  toast('已删除该采样点');
}

function parseCsv(text) {
  const rows = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter((line) => line.trim());
  if (!rows.length) return [];
  const split = (line) => line.split(',').map((v) => v.trim().replace(/^"|"$/g, '').replace(/""/g, '"'));
  const header = split(rows[0]).map((x) => x.toLowerCase());
  const index = (names) => names.map((name) => header.indexOf(name)).find((i) => i >= 0);
  const cols = { row: index(['row', '排']), col: index(['col', 'column', '列']), bx: index(['bx']), by: index(['by']), bz: index(['bz']), note: index(['note', '备注']) };
  if ([cols.row, cols.col, cols.bx, cols.by, cols.bz].some((i) => i == null || i < 0)) throw new Error('CSV 表头需包含 row,col,bx,by,bz');
  return rows.slice(1).map(split).map((values) => ({
    row: parseInt(values[cols.row], 10), col: parseInt(values[cols.col], 10),
    bx: parseFloat(values[cols.bx]), by: parseFloat(values[cols.by]), bz: parseFloat(values[cols.bz]),
    note: cols.note >= 0 ? values[cols.note] || '' : '',
  })).filter(validRecord);
}

function csvEscape(value) {
  const text = String(value ?? '');
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function exportCsv() {
  if (!state.records.length) { toast('暂无可导出的数据'); return; }
  const lines = ['row,col,bx,by,bz,note', ...[...state.records].sort((a, b) => a.row - b.row || a.col - b.col)
    .map((r) => [r.row, r.col, r.bx, r.by, r.bz, csvEscape(r.note)].join(','))];
  const blob = new Blob([`\uFEFF${lines.join('\n')}`], { type: 'text/csv;charset=utf-8' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = '教室磁场数据.csv';
  link.click();
  URL.revokeObjectURL(link.href);
  toast('CSV 已导出');
}

function demoRecords() {
  const out = [];
  for (let row = 1; row <= 6; row++) {
    for (let col = 1; col <= 8; col++) {
      const bx = 2.2 + 0.22 * col - 0.11 * row;
      const by = 24.8 + 0.18 * row + 0.08 * col;
      const bz = -37.4 + 0.16 * col - 0.12 * row;
      out.push({ row, col, bx, by, bz, note: '' });
    }
  }
  Object.assign(out.find((r) => r.row === 3 && r.col === 5), { bx: 16.5, by: 31.2, bz: -50.8, note: '示例：靠近铁磁物体' });
  Object.assign(out.find((r) => r.row === 5 && r.col === 2), { bx: -9.4, by: 19.1, bz: -25.2, note: '示例：待现场复核' });
  return out;
}

$('entry-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const record = {
    row: parseInt($('row').value, 10), col: parseInt($('col').value, 10),
    bx: parseFloat($('bx').value), by: parseFloat($('by').value), bz: parseFloat($('bz').value),
    note: $('note').value.trim(),
  };
  if (!validRecord(record)) { toast('请填写有效的座位与三分量数据'); return; }
  const existing = state.records.findIndex((r) => keyOf(r) === keyOf(record));
  if (existing >= 0) state.records[existing] = record;
  else state.records.push(record);
  state.selectedKey = keyOf(record);
  persist();
  render();
  toast(existing >= 0 ? '采样点已更新' : '采样点已添加');
});

$('reset-form').onclick = resetForm;
$('export-csv').onclick = exportCsv;
$('load-demo').onclick = () => {
  state.records = demoRecords();
  state.selectedKey = null;
  persist();
  render();
  toast('已加载 48 个示例点');
};
$('clear-all').onclick = () => {
  if (!state.records.length) return;
  if (!confirm('确定清空本机保存的全部测量数据吗？')) return;
  state.records = [];
  state.selectedKey = null;
  persist();
  resetForm();
  toast('全部数据已清空');
};
$('csv-input').onchange = async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    const imported = parseCsv(await file.text());
    const merged = new Map(state.records.map((r) => [keyOf(r), r]));
    imported.forEach((r) => merged.set(keyOf(r), r));
    state.records = [...merged.values()];
    persist();
    render();
    toast(`已导入 ${imported.length} 个采样点`);
  } catch (error) {
    toast(error.message || 'CSV 导入失败');
  } finally {
    event.target.value = '';
  }
};

document.querySelectorAll('.mode-switch button').forEach((button) => {
  button.onclick = () => {
    state.mode = button.dataset.mode;
    document.querySelectorAll('.mode-switch button').forEach((item) => {
      const active = item === button;
      item.classList.toggle('active', active);
      item.setAttribute('aria-selected', String(active));
    });
    $('canvas-caption').textContent = state.mode === 'magnitude'
      ? '热力图按当前样本的磁场大小范围着色；红圈仅表示偏离班级基线较大的候选点，需要回到现场检查。'
      : '箭头显示手机坐标中的水平分量 (Bx, By)。只有所有手机姿态一致时，箭头方向才可比较。';
    render();
  };
});

canvas.addEventListener('click', (event) => {
  if (!state.records.length) return;
  const rect = canvas.getBoundingClientRect();
  const rows = Math.max(...state.records.map((r) => r.row));
  const cols = Math.max(...state.records.map((r) => r.col));
  const pad = { left: 54, right: 30, top: 32, bottom: 46 };
  const col = Math.floor((event.clientX - rect.left - pad.left) / ((rect.width - pad.left - pad.right) / cols)) + 1;
  const row = Math.floor((event.clientY - rect.top - pad.top) / ((rect.height - pad.top - pad.bottom) / rows)) + 1;
  const record = state.records.find((r) => r.row === row && r.col === col);
  if (record) selectRecord(record);
});

window.addEventListener('resize', draw);
restore();
render();

window.__CLASSROOM_MAP__ = { analysis, parseCsv, demoRecords, magnitude };
