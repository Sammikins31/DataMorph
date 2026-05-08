// ── PALETTES ───────────────────────────────────────────────────────────────
const PALETTES = {
    magma: [[0, 0, 4], [28, 16, 68], [79, 18, 123], [129, 37, 129], [181, 54, 122], [229, 80, 100], [251, 135, 97], [254, 194, 135], [252, 253, 191]],
    inferno: [[0, 0, 4], [31, 12, 72], [85, 15, 109], [136, 34, 106], [186, 54, 89], [227, 89, 51], [249, 149, 10], [253, 211, 99], [252, 255, 164]],
    plasma: [[13, 8, 135], [84, 2, 163], [139, 10, 165], [185, 50, 137], [219, 92, 104], [244, 136, 73], [254, 188, 43], [240, 249, 33], [240, 249, 33]],
    viridis: [[68, 1, 84], [72, 40, 120], [62, 83, 160], [49, 123, 186], [38, 173, 129], [53, 183, 121], [109, 205, 89], [180, 222, 44], [253, 231, 37]],
    cividis: [[0, 32, 77], [0, 60, 100], [0, 91, 110], [57, 121, 113], [116, 150, 107], [168, 178, 88], [213, 210, 69], [250, 243, 138], [255, 255, 180]],
    turbo: [[48, 18, 59], [86, 72, 202], [51, 167, 228], [45, 224, 155], [150, 235, 58], [237, 184, 21], [235, 78, 10], [163, 15, 5], [144, 12, 0]]
};

function samplePalette(pal, t) {
    const stops = PALETTES[pal] || PALETTES.magma;
    t = Math.max(0, Math.min(1, t));
    const idx = t * (stops.length - 1);
    const lo = Math.floor(idx), hi = Math.min(lo + 1, stops.length - 1);
    const f = idx - lo;
    return stops[lo].map((v, i) => Math.round(v + f * (stops[hi][i] - v)));
}

function palColor(pal, t, alpha) {
    const [r, g, b] = samplePalette(pal, t);
    return alpha !== undefined
        ? `rgba(${r},${g},${b},${alpha.toFixed(3)})`
        : `rgb(${r},${g},${b})`;
}

// ── GLOBAL STATE ───────────────────────────────────────────────────────────
let pyodide = null;
let pyodideReady = false;
let rawData = null;
let csvRows = null;
let dataVars = { A: 31, B: 6, has_data: false, filename: '' };
let rendering = false;
let lastRender = null; // saved geometry for zoom re-draws

// ── PYODIDE INIT ───────────────────────────────────────────────────────────
async function initPyodide() {
    const statusEl = document.getElementById('pyStatus');
    const overlayEl = document.getElementById('canvasLoadingOverlay');
    const overlayLabel = document.getElementById('canvasLoadingLabel');
    const uploadArea = document.getElementById('uploadArea');
    const sampleSel = document.getElementById('sampleDatasetSelect');

    // Lock uploads until ready
    uploadArea.style.pointerEvents = 'none';
    uploadArea.style.opacity = '0.4';
    sampleSel.disabled = true;

    try {
        overlayLabel.textContent = '⏳ Loading Python environment…';
        pyodide = await loadPyodide({ indexURL: "https://cdn.jsdelivr.net/pyodide/v0.25.1/full/" });

        overlayLabel.textContent = '⏳ Installing packages…';
        statusEl.textContent = '⏳ Installing packages…';
        await pyodide.loadPackage(['numpy', 'scikit-learn']);

        // Warm-up: ensure numpy C extensions are fully initialised
        await pyodide.runPythonAsync(`import numpy as np; import sklearn; _ = np.array([1.0])`);

        pyodideReady = true;
        statusEl.textContent = '✅ Python ready';
        statusEl.style.color = '#1D9E75';

        // Switch overlay to idle prompt then hide it
        overlayLabel.innerHTML =
            'Welcome to DataMorph! Please Upload a CSV and Enter a Prompt. See the mathematical magic 🪄 <br><br>' +
            'Generate unique algorithmic art from your dataset and prompt using parametric equations.';

        document.getElementById('canvasLoadingBarTrack').style.display = 'none';
        overlayEl.style.background = 'transparent';
        overlayEl.style.gap = '0';

        // Unlock uploads
        uploadArea.style.pointerEvents = '';
        uploadArea.style.opacity = '';
        sampleSel.disabled = false;

        // Sort sample dropdown alphabetically
        const options = Array.from(sampleSel.options);
        const placeholder = options.shift();
        options.sort((a, b) => a.text.toLowerCase().localeCompare(b.text.toLowerCase()));
        sampleSel.innerHTML = '';
        sampleSel.appendChild(placeholder);
        options.forEach(opt => sampleSel.appendChild(opt));

    } catch (e) {
        overlayLabel.textContent = '❌ Failed to load Python';
        statusEl.textContent = '❌ ' + e.message;
        statusEl.style.color = '#e05555';
    }
}

// ── CSV → PCA Logic ────────────────────────────────────────────────────────
async function processCSV(csvText, filename) {
    const status = document.getElementById('statusBox');
    status.textContent = '⏳ Running PCA in Python…';

    // Parse raw rows for the preview table (simple split, handles quoted fields)
    csvRows = null;
    try {
        const lines = csvText.trim().split(/\r?\n/);
        const parsed = lines.map(l => {
            const cols = []; let cur = '', inQ = false;
            for (let ci = 0; ci < l.length; ci++) {
                const ch = l[ci];
                if (ch === '"') { inQ = !inQ; }
                else if (ch === ',' && !inQ) { cols.push(cur.trim()); cur = ''; }
                else { cur += ch; }
            }
            cols.push(cur.trim()); return cols;
        });
        if (parsed.length > 1) csvRows = parsed;
    } catch (_) { }

    pyodide.globals.set('csv_text', csvText);
    try {
        const res = await pyodide.runPythonAsync(`
import numpy as np, io, csv as _csv
from sklearn.decomposition import PCA

reader = _csv.reader(io.StringIO(csv_text))
rows   = list(reader)
if len(rows) < 2:
    raise ValueError("Need at least 2 rows")

numeric_cols = []
for ci in range(len(rows[0])):
    vals = []
    for r in rows[1:]:
        if ci < len(r):
            try: vals.append(float(r[ci]))
            except: pass
    if len(vals) > 2:
        numeric_cols.append(vals)

if not numeric_cols:
    raise ValueError("No numeric columns found")

min_len = min(len(c) for c in numeric_cols)
arr = np.array([c[:min_len] for c in numeric_cols]).T

for ci in range(arr.shape[1]):
    col = arr[:, ci]
    mask = np.isnan(col)
    idx  = np.where(~mask)[0]
    if idx.size:
        arr[:, ci] = np.interp(np.arange(len(col)), idx, col[idx])
arr = np.nan_to_num(arr)

pca  = PCA(n_components=1)
pc1  = arr if arr.shape[1] == 1 else pca.fit_transform(arr)
flat = pc1.flatten()

A_val = float((pc1.mean() % 10) + 25)
B_val = float((pc1.std() % 5) + 4)

[flat.tolist(), A_val, B_val]
`);
        const js = res.toJs();
        const flat = js[0].toJs ? js[0].toJs() : js[0];
        rawData = new Float32Array(flat);
        dataVars = { A: js[1], B: js[2], has_data: true, filename };

        status.innerHTML = `<span style="color:#1D9E75;font-weight:500">✅ Loaded:</span> ${filename}<br>${rawData.length} points → K=${Math.max(2000, Math.min(80000, Math.round(rawData.length * 2 / 100) * 100 || 9830))} geometry steps`;
        document.getElementById('uploadArea').classList.add('loaded');
        document.getElementById('renderBtn').disabled = false;
        document.getElementById('canvasLoadingOverlay').classList.add('hidden');
        drawSidebarCharts();
        buildDataPreview();
    } catch (e) {
        status.textContent = '❌ ' + e.message;
        console.error(e);
    }
}

// ── DATASET PREVIEW TABLE ──────────────────────────────────────────────────
function buildDataPreview() {
    const wrap = document.getElementById('dataPreviewWrap');
    const tableEl = document.getElementById('dataPreviewTable').querySelector('table');
    const meta = document.getElementById('dataPreviewMeta');
    if (!csvRows || csvRows.length < 2) { wrap.style.display = 'none'; return; }

    const headers = csvRows[0];
    const dataRows = csvRows.slice(1);
    const totalRows = dataRows.length;
    const PREVIEW_ROWS = Math.min(200, totalRows); // cap preview at 200 rows

    // Build header
    const thead = tableEl.querySelector('thead');
    thead.innerHTML = '';
    const trH = document.createElement('tr');
    // row-number gutter
    const thN = document.createElement('th');
    thN.textContent = '#';
    thN.style.cssText = 'color:#5a5a7a;min-width:28px;text-align:right;padding-right:10px';
    trH.appendChild(thN);
    headers.forEach(h => {
        const th = document.createElement('th');
        th.textContent = h || '—';
        trH.appendChild(th);
    });
    thead.appendChild(trH);

    // Build body
    const tbody = tableEl.querySelector('tbody');
    tbody.innerHTML = '';
    for (let i = 0; i < PREVIEW_ROWS; i++) {
        const row = dataRows[i];
        const tr = document.createElement('tr');
        // row number
        const tdN = document.createElement('td');
        tdN.textContent = i + 1;
        tdN.style.cssText = 'color:#4a4a6a;text-align:right;padding-right:10px';
        tr.appendChild(tdN);
        headers.forEach((_, ci) => {
            const td = document.createElement('td');
            const val = row[ci] !== undefined ? row[ci] : '';
            td.textContent = val;
            // colour-code numeric vs text cells
            const num = parseFloat(val);
            if (val !== '' && !isNaN(num)) td.style.color = '#a0c8a0';
            tr.appendChild(td);
        });
        tbody.appendChild(tr);
    }

    // Meta line
    meta.textContent = `${headers.length} columns · ${totalRows.toLocaleString()} rows${totalRows > PREVIEW_ROWS ? ` · showing first ${PREVIEW_ROWS}` : ''}`;

    wrap.style.display = 'block';
}

// ── SIDEBAR CHARTS ─────────────────────────────────────────────────────────
function drawSidebarCharts() {
    const pal = document.getElementById('paletteSelect').value;
    const raw = rawData;
    let mn = Infinity, mx = -Infinity;
    for (const v of raw) { if (v < mn) mn = v; if (v > mx) mx = v; }
    const rng = mx - mn || 1;

    const sc = document.getElementById('signalCanvas');
    sc.width = sc.offsetWidth * devicePixelRatio;
    const sW = sc.width, sH = sc.height;
    const sctx = sc.getContext('2d');
    sctx.clearRect(0, 0, sW, sH);
    sctx.strokeStyle = '#cccccc'; sctx.lineWidth = 1; sctx.globalAlpha = 0.4;
    sctx.beginPath();
    for (let i = 0; i < raw.length; i++) {
        const x = (i / (raw.length - 1)) * sW;
        const y = sH - ((raw[i] - mn) / rng) * (sH - 4) - 2;
        i === 0 ? sctx.moveTo(x, y) : sctx.lineTo(x, y);
    }
    sctx.stroke();
    sctx.globalAlpha = 1;
    const dStep = Math.max(1, Math.floor(raw.length / 300));
    for (let i = 0; i < raw.length; i += dStep) {
        const x = (i / (raw.length - 1)) * sW;
        const y = sH - ((raw[i] - mn) / rng) * (sH - 4) - 2;
        sctx.fillStyle = palColor(pal, (raw[i] - mn) / rng);
        sctx.beginPath(); sctx.arc(x, y, 1.5 * devicePixelRatio, 0, Math.PI * 2); sctx.fill();
    }

    const hc = document.getElementById('histCanvas');
    hc.width = hc.offsetWidth * devicePixelRatio;
    const hW = hc.width, hH = hc.height;
    const hctx = hc.getContext('2d');
    hctx.clearRect(0, 0, hW, hH);
    const B = 40, bins = new Float32Array(B);
    for (const v of raw) bins[Math.min(B - 1, Math.floor(((v - mn) / rng) * B))]++;
    const bmax = Math.max(...bins);
    for (let i = 0; i < B; i++) {
        const x = (i / B) * hW, bw = hW / B - 1;
        const bh = (bins[i] / bmax) * (hH - 2);
        hctx.fillStyle = palColor(pal, i / B, 0.85);
        hctx.fillRect(x, hH - bh, bw, bh);
    }

    document.getElementById('cbMax').textContent = mx.toFixed(2);
    document.getElementById('cbMin').textContent = mn.toFixed(2);
    drawColorbar(pal);
}

function drawColorbar(pal) {
    const cb = document.getElementById('colorbar');
    cb.width = 12; cb.height = 130;
    const ctx = cb.getContext('2d');
    for (let i = 0; i < 130; i++) {
        ctx.fillStyle = palColor(pal, 1 - i / 130);
        ctx.fillRect(0, i, 12, 1);
    }
}

// ── GEOMETRY Logic ─────────────────────────────────────────────────────────
function buildGeometry(prompt, density) {
    const { A, B } = dataVars;
    const pi = Math.PI;
    const raw = rawData;
    const N = raw.length; // actual dataset point count

    // K scales with dataset: clamped between 2000 and 80000, nudged to a nice step
    const K = Math.max(2000, Math.min(80000, Math.round(N * 2 / 100) * 100 || 9830));

    // Fish and Butterfly counts also adapt to dataset size
    const FISH_N_dyn = Math.max(200, Math.min(4000, Math.round(N / 5 / 50) * 50 || 1000));
    const BFLY_N_dyn = Math.max(5000, Math.min(120000, Math.round(N * 0.5 / 1000) * 1000 || 40000));

    const interp = new Float32Array(K);
    for (let i = 0; i < K; i++) {
        const t = (i / (K - 1)) * (raw.length - 1);
        const lo = Math.floor(t), hi = Math.min(lo + 1, raw.length - 1);
        interp[i] = raw[lo] + (t - lo) * (raw[hi] - raw[lo]);
    }

    let mn = Infinity, mx = -Infinity;
    for (const v of interp) { if (v < mn) mn = v; if (v > mx) mx = v; }
    const rng = mx - mn + 1e-9;
    const data_norm = new Float32Array(K);
    const morph = new Float32Array(K);
    const morphStrength = 0.02 + (density / 100) * 0.38;
    for (let i = 0; i < K; i++) {
        data_norm[i] = (interp[i] - mn) / rng;
        morph[i] = (data_norm[i] - 0.5) * morphStrength;
    }

    const X = new Float32Array(K), Y = new Float32Array(K), R = new Float32Array(K);
    const p = prompt.toLowerCase().trim();

    for (let i = 0; i < K; i++) {
        const k = i + 1;
        let xb, yb, rb;

        if (p === 'flying bird') {
            xb = (3 * k / 20000) + Math.pow(Math.cos(37 * pi * k / 10000), 6) * Math.sin(Math.pow(k / 10000, 7) * (3 * pi / 5)) + (9 / 7) * Math.pow(Math.cos(37 * pi * k / 10000), 16) * Math.pow(Math.cos(pi * k / 20000), 12) * Math.sin(pi * k / 10000);
            yb = (-5 / 4) * Math.pow(Math.cos(37 * pi * k / 10000), 6) * Math.cos(Math.pow(k / 10000, 7) * (3 * pi / 5)) * (1 + 3 * Math.pow(Math.cos(pi * k / 20000) * Math.cos(3 * pi * k / 20000), 8)) + (2 / 3) * Math.pow(Math.cos(3 * pi * k / 200000) * Math.cos(9 * pi * k / 200000) * Math.cos(9 * pi * k / 100000), 12);
            rb = 0.04;
        } else if (p === 'bird') {
            const s12 = Math.pow(Math.sin(pi * k / 20000), 12);
            xb = s12 * (0.5 * Math.pow(Math.cos(A * pi * k / 10000), 16) * Math.sin(B * pi * k / 10000) + (1 / 6) * Math.pow(Math.sin(A * pi * k / 10000), 20)) + 3 * k / 20000 + Math.pow(Math.cos(A * pi * k / 10000), 6) * Math.sin((pi / 2) * Math.pow((k - 10000) / 10000, 7) - pi / 5);
            yb = -2.25 * Math.pow(Math.cos(A * pi * k / 10000), 6) * Math.cos((pi / 2) * Math.pow((k - 10000) / 10000, 7) - pi / 5) * (2 / 3 + Math.pow(Math.sin(pi * k / 20000) * Math.sin(3 * pi * k / 20000), 6)) + 0.75 * Math.pow(Math.cos(3 * pi * (k - 10000) / 100000), 10) * Math.pow(Math.cos(9 * pi * (k - 10000) / 100000), 10) * Math.pow(Math.cos(36 * pi * (k - 10000) / 100000), 14) + 0.7 * Math.pow((k - 10000) / 10000, 2);
            rb = Math.pow(Math.sin(pi * k / 20000), 10) * (0.25 * Math.pow(Math.cos(A * pi * k / 10000 + 25 * pi / 32), 20) + 0.05 * Math.pow(Math.cos(A * pi * k / 10000), 2)) + (1 / 30) * (1.5 - Math.pow(Math.cos(62 * pi * k / 10000), 2));
        } else if (p === 'rosette') {
            const nv = -154 + 308 * (i / (K - 1));
            xb = (1 + Math.cos(46 + 1353 * nv / 661)) * Math.sin(64 + 41 * nv / 36);
            yb = (41 / 36) * Math.cos(64 + 41 * nv / 36) * Math.cos(46 + 1353 * nv / 661);
            rb = 0.04;
        } else if (p === 'flower') {
            const t = -3 + 6 * (i / (K - 1));
            xb = 7 * Math.pow(Math.cos(Math.cos(1.28 * Math.round(t))), 2) * (1 + Math.pow(Math.cos(1.18 * t), 4));
            yb = 7 * Math.pow(Math.sin(Math.sin(1.28 * t)), 2) * Math.sin(Math.sin(1.18 * t));
            rb = 0.08;
        } else if (p === 'spirograph') {
            const t = (i / (K - 1)) * 20 * pi;
            const Rr = 5, rr = 3, dr = 5;
            xb = (Rr - rr) * Math.cos(t) + dr * Math.cos((Rr - rr) * t / rr);
            yb = (Rr - rr) * Math.sin(t) - dr * Math.sin((Rr - rr) * t / rr);
            rb = 0.06;
        } else if (p === 'lissajous') {
            const t = (i / (K - 1)) * 2 * pi;
            xb = Math.sin(3 * t + pi / 4);
            yb = Math.sin(4 * t);
            rb = 0.03 * (1 + data_norm[i]);
        } else if (p === 'trefoil') {
            const t = (i / (K - 1)) * 2 * pi;
            xb = Math.sin(t) + 2 * Math.sin(2 * t);
            yb = Math.cos(t) - 2 * Math.cos(2 * t);
            rb = 0.05;
        } else if (p === 'starfish') {
            const t = (i / (K - 1)) * 2 * pi;
            const r = 2 + Math.sin(5 * t);
            xb = r * Math.cos(t);
            yb = r * Math.sin(t);
            rb = 0.05 * (1 + 0.5 * data_norm[i]);
        } else if (p === 'harmonograph') {
            const t = (i / (K - 1)) * 60 * pi;
            const d = 0.004;
            xb = Math.sin(2 * t + pi / 4) * Math.exp(-d * t) + Math.sin(3 * t) * Math.exp(-d * t * 0.8);
            yb = Math.sin(3 * t + pi / 3) * Math.exp(-d * t * 0.9) + Math.sin(2 * t) * Math.exp(-d * t);
            rb = 0.035 * (1 + 0.5 * data_norm[i]);
        } else if (p === 'epitrochoid') {
            const t = (i / (K - 1)) * 2 * pi;
            const Rr = 3, rr = 1, dr = 2.5;
            xb = (Rr + rr) * Math.cos(t) - dr * Math.cos((Rr + rr) * t / rr);
            yb = (Rr + rr) * Math.sin(t) - dr * Math.sin((Rr + rr) * t / rr);
            rb = 0.05;
        } else if (p === 'guilloche') {
            const t = (i / (K - 1)) * 2 * pi * 120;
            const r = 6 + Math.sin(121 * t) * 0.5;
            xb = r * Math.cos(t);
            yb = r * Math.sin(t);
            rb = 0.025 * (1 + data_norm[i]);
        } else if (p === 'hypocycloid') {
            const t = (i / (K - 1)) * 2 * pi;
            const Rr = 5, rr = 3;
            xb = (Rr - rr) * Math.cos(t) + rr * Math.cos((Rr - rr) * t / rr);
            yb = (Rr - rr) * Math.sin(t) - rr * Math.sin((Rr - rr) * t / rr);
            rb = 0.06;
        } else {
            xb = Math.cos(k / 1000); yb = Math.sin(k / 1000); rb = 0.05;
        }

        X[i] = xb + morph[i] * Math.sin(k / 500);
        Y[i] = yb + morph[i] * Math.cos(k / 500);
        R[i] = rb;
    }

    // Fish logic
    const FISH_N = FISH_N_dyn;
    const fishX1 = new Float32Array(FISH_N), fishY1 = new Float32Array(FISH_N);
    const fishX2 = new Float32Array(FISH_N), fishY2 = new Float32Array(FISH_N);
    const fishT = new Float32Array(FISH_N);
    if (p === 'fish') {
        for (let i = 0; i < FISH_N; i++) {
            const fi = i + 1;
            const rawT = (i / (FISH_N - 1)) * (raw.length - 1);
            const lo = Math.floor(rawT), hi = Math.min(lo + 1, raw.length - 1);
            const sig = raw[lo] + (rawT - lo) * (raw[hi] - raw[lo]);
            const sigNorm = (sig - mn) / rng;
            const mo = (sigNorm - 0.5) * morphStrength;
            fishX1[i] = 2 * Math.sin(4 * pi * fi / 1000 + pi / 6) + mo * Math.sin(fi / 500);
            fishY1[i] = 0.5 * Math.sin(6 * pi * fi / 1000 + 3 * pi / 2) + mo * Math.cos(fi / 500);
            fishX2[i] = Math.sin(10 * pi * fi / 1000 + pi / 2) + mo * Math.sin(fi / 500);
            fishY2[i] = Math.sin(6 * pi * fi / 1000 + pi / 3) + mo * Math.cos(fi / 500);
            fishT[i] = sigNorm;
        }
    }

    // Butterfly logic
    const BFLY_N = BFLY_N_dyn;
    const bflyX = new Float32Array(BFLY_N), bflyY = new Float32Array(BFLY_N);
    const bflyR = new Float32Array(BFLY_N), bflyT = new Float32Array(BFLY_N);
    if (p === 'butterfly') {
        for (let i = 0; i < BFLY_N; i++) {
            const k = i + 1;
            const rawT = (i / (BFLY_N - 1)) * (raw.length - 1);
            const lo = Math.floor(rawT), hi = Math.min(lo + 1, raw.length - 1);
            const sig = raw[lo] + (rawT - lo) * (raw[hi] - raw[lo]);
            const sigNorm = (sig - mn) / rng;
            const mo = (sigNorm - 0.5) * morphStrength;
            const c141 = Math.cos(141 * pi * k / 40000);
            const s1 = Math.sin(pi * k / 40000);
            const c2 = Math.cos(2 * pi * k / 40000);
            const c32 = Math.cos(32 * pi * k / 40000);
            const s2 = Math.sin(2 * pi * k / 40000);
            const s6 = Math.sin(6 * pi * k / 40000);
            const s18 = Math.sin(18 * pi * k / 40000);
            const c1 = Math.cos(pi * k / 40000);
            const c3 = Math.cos(3 * pi * k / 40000);
            const c21 = Math.cos(21 * pi * k / 40000);
            const s141 = Math.sin(141 * pi * k / 40000);
            const c12 = Math.cos(12 * pi * k / 40000);
            bflyX[i] = (3 / 2) * Math.pow(c141, 9) * (1 - (1 / 2) * s1) * (1 - (1 / 4) * Math.pow(c2, 30) * (1 + Math.pow(c32, 20))) * (1 - (1 / 2) * Math.pow(s2, 30) * Math.pow(s6, 10) * (0.5 + 0.5 * Math.pow(s18, 20))) + mo * Math.sin(k / 500);
            bflyY[i] = Math.cos(2 * pi * k / 40000) * Math.pow(c141, 2) * (1 + (1 / 4) * Math.pow(c1, 24) * Math.pow(c3, 24) * Math.pow(c21, 24)) + mo * Math.cos(k / 500);
            bflyR[i] = Math.max(0, (1 / 100) + (1 / 40) * (Math.pow(c141, 14) + Math.pow(s141, 6)) * (1 - Math.pow(c1, 16) * Math.pow(c3, 16) * Math.pow(c12, 16)));
            bflyT[i] = sigNorm;
        }
    }

    return { X, Y, R, isFish: p === 'fish', fishX1, fishY1, fishX2, fishY2, fishT, FISH_N, isButterfly: p === 'butterfly', bflyX, bflyY, bflyR, bflyT, BFLY_N, interp, mn, mx, rng, K };
}

// ── RENDER Logic ───────────────────────────────────────────────────────────
function renderArt() {
    if (rendering) return;
    const prompt = document.getElementById('promptInput').value;
    const density = parseInt(document.getElementById('densitySlider').value);
    if (!rawData) { alert('Load a CSV first.'); return; }
    if (!prompt.trim()) { alert('Enter a prompt.'); return; }

    rendering = true;
    document.getElementById('renderBtn').disabled = true;
    document.getElementById('artTitle').textContent = prompt.toUpperCase() + ' — rendering…';
    const prog = document.getElementById('progressBar');
    prog.style.transition = 'none';
    prog.style.width = '0%';

    setTimeout(() => {
        const pal = document.getElementById('paletteSelect').value;
        const wrap = document.getElementById('canvasWrap');
        const canvas = document.getElementById('artCanvas');
        const DPR = window.devicePixelRatio || 1;
        const W = wrap.clientWidth, H = wrap.clientHeight;
        canvas.width = W * DPR;
        canvas.height = H * DPR;
        canvas.style.width = W + 'px';
        canvas.style.height = H + 'px';
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        const { X, Y, R, isFish, fishX1, fishY1, fishX2, fishY2, fishT, FISH_N, isButterfly, bflyX, bflyY, bflyR, bflyT, BFLY_N, interp, mn, mx, rng, K } = buildGeometry(prompt, density);

        // Save geometry so zoom can re-render at any scale
        lastRender = {
            X, Y, R, isFish, fishX1, fishY1, fishX2, fishY2, fishT, FISH_N,
            isButterfly, bflyX, bflyY, bflyR, bflyT, BFLY_N, interp, mn, mx, rng, K,
            pal, prompt, density
        };

        let xmn = Infinity, xmx = -Infinity, ymn = Infinity, ymx = -Infinity;
        if (isFish) {
            for (let i = 0; i < FISH_N; i++) {
                if (fishX1[i] < xmn) xmn = fishX1[i]; if (fishX1[i] > xmx) xmx = fishX1[i];
                if (fishY1[i] < ymn) ymn = fishY1[i]; if (fishY1[i] > ymx) ymx = fishY1[i];
                if (fishX2[i] < xmn) xmn = fishX2[i]; if (fishX2[i] > xmx) xmx = fishX2[i];
                if (fishY2[i] < ymn) ymn = fishY2[i]; if (fishY2[i] > ymx) ymx = fishY2[i];
            }
        } else if (isButterfly) {
            for (let i = 0; i < BFLY_N; i++) {
                if (bflyX[i] < xmn) xmn = bflyX[i]; if (bflyX[i] > xmx) xmx = bflyX[i];
                if (bflyY[i] < ymn) ymn = bflyY[i]; if (bflyY[i] > ymx) ymx = bflyY[i];
            }
        } else {
            for (let i = 0; i < K; i++) {
                if (X[i] < xmn) xmn = X[i]; if (X[i] > xmx) xmx = X[i];
                if (Y[i] < ymn) ymn = Y[i]; if (Y[i] > ymx) ymx = Y[i];
            }
        }
        xmn -= 0.1; xmx += 0.1; ymn -= 0.1; ymx += 0.1;

        const pad = 30 * DPR;
        const drawW = canvas.width - pad * 2;
        const drawH = canvas.height - pad * 2;
        const dataW = xmx - xmn, dataH = ymx - ymn;
        const sc = Math.min(drawW / dataW, drawH / dataH);
        const offX = pad + (drawW - sc * dataW) / 2;
        const offY = pad + (drawH - sc * dataH) / 2;
        function cx(x) { return offX + (x - xmn) * sc; }
        function cy(y) { return offY + (ymx - y) * sc; }
        const LW = 0.5 * DPR;

        function finishRender() {
            prog.style.width = '100%';
            document.getElementById('artTitle').textContent = 'DATA-MORPHED: ' + prompt.toUpperCase();
            document.getElementById('renderBtn').disabled = false;
            rendering = false;
            setTimeout(() => { prog.style.width = '0%'; }, 800);
            drawColorbar(pal);
            showEquation(prompt, dataVars.A, dataVars.B, dataVars.filename);
            document.getElementById('exportWrap').classList.add('visible');
            resetZoom();
        }

        if (isFish) {
            let fIdx = 0;
            function drawFishBatch() {
                const end = Math.min(fIdx + 200, FISH_N);
                for (let i = fIdx; i < end; i++) {
                    const [r, g, b] = samplePalette(pal, fishT[i]);
                    ctx.beginPath(); ctx.moveTo(cx(fishX1[i]), cy(fishY1[i])); ctx.lineTo(cx(fishX2[i]), cy(fishY2[i]));
                    ctx.strokeStyle = `rgba(${r},${g},${b},0.7)`; ctx.lineWidth = LW; ctx.stroke();
                }
                fIdx = end; prog.style.width = ((fIdx / FISH_N) * 100).toFixed(1) + '%';
                if (fIdx < FISH_N) requestAnimationFrame(drawFishBatch); else finishRender();
            }
            requestAnimationFrame(drawFishBatch); return;
        }

        if (isButterfly) {
            let bIdx2 = 0;
            function drawBflyBatch() {
                const end = Math.min(bIdx2 + 800, BFLY_N);
                for (let i = bIdx2; i < end; i++) {
                    const [r, g, b] = samplePalette(pal, bflyT[i]);
                    const radius = bflyR[i] * sc; if (radius < 0.15) continue;
                    ctx.beginPath(); ctx.arc(cx(bflyX[i]), cy(bflyY[i]), radius, 0, Math.PI * 2);
                    ctx.strokeStyle = `rgba(${r},${g},${b},0.7)`; ctx.lineWidth = LW; ctx.stroke();
                }
                bIdx2 = end; prog.style.width = ((bIdx2 / BFLY_N) * 100).toFixed(1) + '%';
                if (bIdx2 < BFLY_N) requestAnimationFrame(drawBflyBatch); else finishRender();
            }
            requestAnimationFrame(drawBflyBatch); return;
        }

        const pointFraction = 0.02 + (density / 100) * 0.98;
        const num_points = Math.max(50, Math.round(K * pointFraction));
        const step = Math.max(1, Math.floor(K / num_points));
        const indices = []; for (let j = 0; j < K; j += step) indices.push(j);
        let bIdx = 0;
        prog.style.transition = 'width .08s';
        function drawBatch() {
            const end = Math.min(bIdx + 600, indices.length);
            for (let ci = bIdx; ci < end; ci++) {
                const j = indices[ci];
                const t = (interp[j] - mn) / rng;
                const [r, g, b] = samplePalette(pal, t);
                const radius = R[j] * sc; if (radius < 0.2) continue;
                ctx.beginPath(); ctx.arc(cx(X[j]), cy(Y[j]), radius, 0, Math.PI * 2);
                ctx.strokeStyle = `rgba(${r},${g},${b},0.7)`; ctx.lineWidth = LW; ctx.stroke();
            }
            bIdx = end; prog.style.width = ((bIdx / indices.length) * 100).toFixed(1) + '%';
            if (bIdx < indices.length) requestAnimationFrame(drawBatch); else finishRender();
        }
        requestAnimationFrame(drawBatch);
    }, 20);
}

// ── EQUATION DISPLAY Logic ─────────────────────────────────────────────────
function showEquation(prompt, A, B, filename) {
    const p = prompt.toLowerCase().trim();
    const Af = A.toFixed(4); const Bf = B.toFixed(4);
    const panel = document.getElementById('eqPanel');
    const content = document.getElementById('eqContent');
    document.getElementById('eqDatasetLabel').textContent = filename;
    const N = rawData ? rawData.length : 0;

    // Base structural equations only — no dataset morph terms
    let Xeq = '', Yeq = '', Req = '';
    if (p === 'bird') {
        Xeq = `\\sin^{12}\\!\\left(\\frac{\\pi k}{20000}\\right)\\!\\left[\\frac{1}{2}\\cos^{16}\\!\\left(\\frac{${Af}\\pi k}{10000}\\right)\\sin\\!\\left(\\frac{${Bf}\\pi k}{10000}\\right)+\\frac{1}{6}\\sin^{20}\\!\\left(\\frac{${Af}\\pi k}{10000}\\right)\\right]+\\frac{3k}{20000}+\\cos^{6}\\!\\left(\\frac{${Af}\\pi k}{10000}\\right)\\sin\\!\\left(\\frac{\\pi}{2}\\left(\\frac{k-10000}{10000}\\right)^{7}-\\frac{\\pi}{5}\\right)`;
        Yeq = `-\\frac{9}{4}\\cos^{6}\\!\\left(\\frac{${Af}\\pi k}{10000}\\right)\\cos\\!\\left(\\frac{\\pi}{2}\\!\\left(\\frac{k-10000}{10000}\\right)^{7}\\!-\\frac{\\pi}{5}\\right)\\!\\left[\\frac{2}{3}+\\sin^{6}\\!\\left(\\frac{\\pi k}{20000}\\right)\\sin^{6}\\!\\left(\\frac{3\\pi k}{20000}\\right)\\right]+\\frac{3}{4}\\cos^{10}\\!\\left(\\frac{3\\pi(k-10000)}{100000}\\right)\\cos^{10}\\!\\left(\\frac{9\\pi(k-10000)}{100000}\\right)\\cos^{14}\\!\\left(\\frac{36\\pi(k-10000)}{100000}\\right)+0.7\\!\\left(\\frac{k-10000}{10000}\\right)^{2}`;
        Req = `\\sin^{10}\\!\\left(\\frac{\\pi k}{20000}\\right)\\!\\left[\\frac{1}{4}\\cos^{20}\\!\\left(\\frac{${Af}\\pi k}{10000}+\\frac{25\\pi}{32}\\right)+\\frac{1}{20}\\cos^{2}\\!\\left(\\frac{${Af}\\pi k}{10000}\\right)\\right]+\\frac{1}{30}\\!\\left(\\frac{3}{2}-\\cos^{2}\\!\\left(\\frac{62\\pi k}{10000}\\right)\\right)`;
    } else if (p === 'flying bird') {
        Xeq = `\\frac{3k}{20000}+\\cos^{6}\\!\\left(\\frac{37\\pi k}{10000}\\right)\\sin\\!\\left(\\left(\\frac{k}{10000}\\right)^{7}\\frac{3\\pi}{5}\\right)+\\frac{9}{7}\\cos^{16}\\!\\left(\\frac{37\\pi k}{10000}\\right)\\cos^{12}\\!\\left(\\frac{\\pi k}{20000}\\right)\\sin\\!\\left(\\frac{\\pi k}{10000}\\right)`;
        Yeq = `-\\frac{5}{4}\\cos^{6}\\!\\left(\\frac{37\\pi k}{10000}\\right)\\cos\\!\\left(\\left(\\frac{k}{10000}\\right)^{7}\\frac{3\\pi}{5}\\right)\\!\\left[1+3\\left(\\cos\\frac{\\pi k}{20000}\\cos\\frac{3\\pi k}{20000}\\right)^{8}\\right]+\\frac{2}{3}\\cos^{12}\\!\\left(\\frac{3\\pi k}{200000}\\right)\\cos^{12}\\!\\left(\\frac{9\\pi k}{200000}\\right)\\cos^{12}\\!\\left(\\frac{9\\pi k}{100000}\\right)`;
        Req = `0.04`;
    } else if (p === 'fish') {
        Xeq = `P_{1,i}=\\left(2\\sin\\!\\left(\\frac{4\\pi i}{N}+\\frac{\\pi}{6}\\right),\\; \\frac{1}{2}\\sin\\!\\left(\\frac{6\\pi i}{N}+\\frac{3\\pi}{2}\\right)\\right)`;
        Yeq = `P_{2,i}=\\left(\\sin\\!\\left(\\frac{10\\pi i}{N}+\\frac{\\pi}{2}\\right),\\; \\sin\\!\\left(\\frac{6\\pi i}{N}+\\frac{\\pi}{3}\\right)\\right),\\quad i=1,\\ldots,N`;
        Req = `N = ${N}\\text{ (dataset points)},\\quad \\delta(i) = \\frac{\\hat{S}(i)-0.5}{6.67}`;
    } else if (p === 'rosette') {
        Xeq = `\\bigl(1+\\cos(46+\\tfrac{1353\\,\\nu}{661})\\bigr)\\sin(64+\\tfrac{41\\,\\nu}{36}),\\quad \\nu\\in[-154,\\,154]`;
        Yeq = `\\frac{41}{36}\\cos(64+\\tfrac{41\\,\\nu}{36})\\cos(46+\\tfrac{1353\\,\\nu}{661})`;
        Req = `0.04`;
    } else if (p === 'butterfly') {
        Xeq = `\\tfrac{3}{2}\\cos^{9}\\!\\left(\\tfrac{141\\pi k}{K}\\right)\\left(1-\\tfrac{1}{2}\\sin\\tfrac{\\pi k}{K}\\right)\\left(1-\\tfrac{1}{4}\\cos^{30}\\tfrac{2\\pi k}{K}\\left(1+\\cos^{20}\\tfrac{32\\pi k}{K}\\right)\\right)\\left(1-\\tfrac{1}{2}\\sin^{30}\\tfrac{2\\pi k}{K}\\sin^{10}\\tfrac{6\\pi k}{K}\\left(\\tfrac{1}{2}+\\tfrac{1}{2}\\sin^{20}\\tfrac{18\\pi k}{K}\\right)\\right)`;
        Yeq = `\\cos\\tfrac{2\\pi k}{K}\\cdot\\cos^{2}\\!\\left(\\tfrac{141\\pi k}{K}\\right)\\left(1+\\tfrac{1}{4}\\cos^{24}\\tfrac{\\pi k}{K}\\cos^{24}\\tfrac{3\\pi k}{K}\\cos^{24}\\tfrac{21\\pi k}{K}\\right)`;
        Req = `\\tfrac{1}{100}+\\tfrac{1}{40}\\!\\left(\\cos^{14}\\tfrac{141\\pi k}{K}+\\sin^{6}\\tfrac{141\\pi k}{K}\\right)\\!\\left(1-\\cos^{16}\\tfrac{\\pi k}{K}\\cos^{16}\\tfrac{3\\pi k}{K}\\cos^{16}\\tfrac{12\\pi k}{K}\\right),\\quad K=${Math.max(5000, Math.min(120000, Math.round(N * 0.5 / 1000) * 1000 || 40000))}`;
    } else if (p === 'flower') {
        Xeq = `7\\cos^{2}\\!\\left(\\cos(1.28\\,\\mathrm{round}(t))\\right)\\!\\left(1+\\cos^{4}(1.18t)\\right)`;
        Yeq = `7\\sin^{2}\\!\\left(\\sin(1.28t)\\right)\\sin\\!\\left(\\sin(1.18t)\\right)`;
        Req = `0.08`;
    } else if (p === 'spirograph') {
        Xeq = `(R-r)\\cos t + d\\cos\\tfrac{(R-r)t}{r},\\quad R=5,\\;r=3,\\;d=5`;
        Yeq = `(R-r)\\sin t - d\\sin\\tfrac{(R-r)t}{r}`;
        Req = `0.06`;
    } else if (p === 'lissajous') {
        Xeq = `\\sin(3t + \\tfrac{\\pi}{4})`;
        Yeq = `\\sin(4t)`;
        Req = `0.03`;
    } else if (p === 'trefoil') {
        Xeq = `\\sin t + 2\\sin 2t`;
        Yeq = `\\cos t - 2\\cos 2t`;
        Req = `0.05`;
    } else if (p === 'starfish') {
        Xeq = `r(t)\\cos t,\\quad r(t) = 2 + \\sin(5t)`;
        Yeq = `r(t)\\sin t`;
        Req = `0.05`;
    } else if (p === 'harmonograph') {
        Xeq = `\\sin(2t+\\tfrac{\\pi}{4})e^{-dt}+\\sin(3t)e^{-0.8dt},\\quad d=0.004`;
        Yeq = `\\sin(3t+\\tfrac{\\pi}{3})e^{-0.9dt}+\\sin(2t)e^{-dt}`;
        Req = `0.035`;
    } else if (p === 'epitrochoid') {
        Xeq = `(R+r)\\cos t - d\\cos\\tfrac{(R+r)t}{r},\\quad R=3,\\;r=1,\\;d=2.5`;
        Yeq = `(R+r)\\sin t - d\\sin\\tfrac{(R+r)t}{r}`;
        Req = `0.05`;
    } else if (p === 'guilloche') {
        Xeq = `r(t)\\cos t,\\quad r(t)=6+0.5\\sin(121t),\\quad t\\in[0,\\,240\\pi]`;
        Yeq = `r(t)\\sin t`;
        Req = `0.025`;
    } else if (p === 'hypocycloid') {
        Xeq = `(R-r)\\cos t + r\\cos\\tfrac{(R-r)t}{r},\\quad R=5,\\;r=3`;
        Yeq = `(R-r)\\sin t - r\\sin\\tfrac{(R-r)t}{r}`;
        Req = `0.06`;
    } else {
        Xeq = `\\cos(k/1000)`; Yeq = `\\sin(k/1000)`; Req = `0.05`;
    }

    // Dataset morph line shown separately — reflects actual N
    const K_used = Math.max(2000, Math.min(80000, Math.round(N * 2 / 100) * 100 || 9830));
    const constLine = (p === 'bird')
        ? `\\text{where } A=${Af},\\; B=${Bf} \\text{ (derived from PCA of } \\textit{${filename}}\\text{)},\\; K=${K_used}`
        : `\\text{Dataset: } \\textit{${filename}},\\quad N=${N}\\text{ pts},\\quad K=${K_used},\\quad A=${Af},\\;B=${Bf}`;

    const morphLine = `\\vec{P}(k) = \\vec{P}_{\\text{base}}(k) + \\frac{\\hat{S}(k)-0.5}{6.67}\\begin{pmatrix}\\sin(k/{500})\\\\\\cos(k/{500})\\end{pmatrix},\\quad \\hat{S}=\\mathrm{PC}_1(\\textit{${filename}})`;

    const lab1 = (p === 'fish') ? 'P_{1}(i)' : 'X(k)';
    const lab2 = (p === 'fish') ? 'P_{2}(i)' : 'Y(k)';
    const lab3 = (p === 'fish') ? '\\delta\\text{-morph}' : 'R(k)';
    const latex = `\\[ \\begin{aligned} ${lab1} &= ${Xeq} \\\\[6pt] ${lab2} &= ${Yeq} \\\\[6pt] ${lab3} &= ${Req} \\\\[10pt] &${constLine} \\end{aligned} \\] \\[ \\text{Data morph: } ${morphLine} \\]`;
    panel.style.display = 'block'; content.innerHTML = '';
    const node = document.createElement('div'); node.textContent = latex; content.appendChild(node);
    if (window.MathJax) MathJax.typesetPromise([content]);
}

// ── EVENT LISTENERS ────────────────────────────────────────────────────────
document.getElementById('densitySlider').addEventListener('input', e => {
    document.getElementById('densityVal').textContent = e.target.value;
});
document.getElementById('paletteSelect').addEventListener('change', () => {
    if (rawData) drawSidebarCharts();
});
document.getElementById('renderBtn').addEventListener('click', renderArt);
document.getElementById('promptInput').addEventListener('keydown', e => {
    if (e.key === 'Enter') renderArt();
});
document.getElementById('csvUpload').addEventListener('change', async e => {
    const file = e.target.files[0]; if (!file) return;
    if (!pyodideReady) { alert('Python is still loading, please wait a moment.'); return; }
    await processCSV(await file.text(), file.name);
});

// Dataset Sample Dropdown Listener
document.getElementById('sampleDatasetSelect').addEventListener('change', async e => {
    const filePath = e.target.value; if (!filePath) return;
    const fileName = filePath.split('/').pop();
    if (!pyodideReady) { alert('Python is still loading, please wait a moment.'); return; }
    try {
        const response = await fetch(filePath);
        if (!response.ok) throw new Error("Sample not found.");
        await processCSV(await response.text(), fileName);
    } catch (err) {
        document.getElementById('statusBox').innerText = "❌ Error: " + err.message;
    }
});

// ── EXPORT ────────────────────────────────────────────────────────────────
function toggleExportDropdown() {
    document.getElementById('exportDropdown').classList.toggle('open');
}
document.addEventListener('click', function (e) {
    const wrap = document.getElementById('exportWrap');
    if (wrap && !wrap.contains(e.target)) {
        document.getElementById('exportDropdown').classList.remove('open');
    }
});
function exportArt(format) {
    document.getElementById('exportDropdown').classList.remove('open');
    const canvas = document.getElementById('artCanvas');
    const promptVal = document.getElementById('promptInput').value.trim() || 'artwork';
    const filename = `sm-art_${promptVal.replace(/\s+/g, '-').toLowerCase()}_${Date.now()}`;
    if (format === 'png') {
        const link = document.createElement('a');
        link.download = filename + '.png';
        link.href = canvas.toDataURL('image/png');
        link.click();
    } else if (format === 'jpg') {
        const tmp = document.createElement('canvas');
        tmp.width = canvas.width; tmp.height = canvas.height;
        const tc = tmp.getContext('2d');
        tc.fillStyle = '#ffffff'; tc.fillRect(0, 0, tmp.width, tmp.height);
        tc.drawImage(canvas, 0, 0);
        const link = document.createElement('a');
        link.download = filename + '.jpg';
        link.href = tmp.toDataURL('image/jpeg', 1.0);
        link.click();
    } else if (format === 'svg') {
        const w = canvas.width, h = canvas.height;
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><image href="${canvas.toDataURL('image/png')}" width="${w}" height="${h}"/></svg>`;
        const link = document.createElement('a');
        link.download = filename + '.svg';
        link.href = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
        link.click();
        setTimeout(() => URL.revokeObjectURL(link.href), 5000);
    }
}

// ── ZOOM & PAN (crisp re-render) ───────────────────────────────────────────
let zoomScale = 1, zoomPanX = 0, zoomPanY = 0;
let isPanning = false, panStartX = 0, panStartY = 0;
let zoomDebounceTimer = null, zoomIndicatorTimer = null;
const MIN_ZOOM = 0.5, MAX_ZOOM = 30;

function showZoomIndicator() {
    const ind = document.getElementById('zoomIndicator');
    const rst = document.getElementById('zoomResetBtn');
    ind.textContent = Math.round(zoomScale * 100) + '%';
    if (zoomScale !== 1) {
        rst.style.display = 'block';
        ind.style.display = 'none';
    } else {
        rst.style.display = 'none';
        ind.classList.add('show');
        clearTimeout(zoomIndicatorTimer);
        zoomIndicatorTimer = setTimeout(() => ind.classList.remove('show'), 1200);
    }
}

function resetZoom() {
    zoomScale = 1; zoomPanX = 0; zoomPanY = 0;
    document.getElementById('zoomResetBtn').style.display = 'none';
    document.getElementById('zoomIndicator').classList.remove('show');
    if (lastRender) redrawAtZoom();
}

// Core: re-draw the stored geometry onto the canvas at current zoom+pan
function redrawAtZoom() {
    if (!lastRender) return;
    const { X, Y, R, isFish, fishX1, fishY1, fishX2, fishY2, fishT, FISH_N,
        isButterfly, bflyX, bflyY, bflyR, bflyT, BFLY_N,
        interp, mn, mx, rng, K, pal, density } = lastRender;

    const wrap = document.getElementById('canvasWrap');
    const canvas = document.getElementById('artCanvas');
    const DPR = window.devicePixelRatio || 1;
    // Canvas pixel size stays the same as viewport — zoom is handled by shifting coordinate transform
    const W = wrap.clientWidth, H = wrap.clientHeight;
    canvas.width = W * DPR; canvas.height = H * DPR;
    canvas.style.width = W + 'px'; canvas.style.height = H + 'px';

    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Compute base coordinate transform (same as original render)
    let xmn = Infinity, xmx = -Infinity, ymn = Infinity, ymx = -Infinity;
    if (isFish) {
        for (let i = 0; i < FISH_N; i++) {
            if (fishX1[i] < xmn) xmn = fishX1[i]; if (fishX1[i] > xmx) xmx = fishX1[i];
            if (fishY1[i] < ymn) ymn = fishY1[i]; if (fishY1[i] > ymx) ymx = fishY1[i];
            if (fishX2[i] < xmn) xmn = fishX2[i]; if (fishX2[i] > xmx) xmx = fishX2[i];
            if (fishY2[i] < ymn) ymn = fishY2[i]; if (fishY2[i] > ymx) ymx = fishY2[i];
        }
    } else if (isButterfly) {
        for (let i = 0; i < BFLY_N; i++) {
            if (bflyX[i] < xmn) xmn = bflyX[i]; if (bflyX[i] > xmx) xmx = bflyX[i];
            if (bflyY[i] < ymn) ymn = bflyY[i]; if (bflyY[i] > ymx) ymx = bflyY[i];
        }
    } else {
        for (let i = 0; i < K; i++) {
            if (X[i] < xmn) xmn = X[i]; if (X[i] > xmx) xmx = X[i];
            if (Y[i] < ymn) ymn = Y[i]; if (Y[i] > ymx) ymx = Y[i];
        }
    }
    xmn -= 0.1; xmx += 0.1; ymn -= 0.1; ymx += 0.1;

    const pad = 30 * DPR;
    const baseW = canvas.width - pad * 2, baseH = canvas.height - pad * 2;
    const dataW = xmx - xmn, dataH = ymx - ymn;
    const baseSc = Math.min(baseW / dataW, baseH / dataH);
    const baseOffX = pad + (baseW - baseSc * dataW) / 2;
    const baseOffY = pad + (baseH - baseSc * dataH) / 2;

    // Apply zoom: scale around viewport centre then shift by pan
    const sc = baseSc * zoomScale;
    const offX = zoomPanX * DPR + baseOffX * zoomScale + baseOffX * (1 - zoomScale);
    const offY = zoomPanY * DPR + baseOffY * zoomScale + baseOffY * (1 - zoomScale);

    function cx(x) { return offX + (x - xmn) * sc; }
    function cy(y) { return offY + (ymx - y) * sc; }

    // Thinner lines at high zoom look sharper
    const LW = Math.max(0.3, 0.5 * DPR / Math.sqrt(zoomScale));

    if (isFish) {
        for (let i = 0; i < FISH_N; i++) {
            const [r, g, b] = samplePalette(pal, fishT[i]);
            ctx.beginPath(); ctx.moveTo(cx(fishX1[i]), cy(fishY1[i])); ctx.lineTo(cx(fishX2[i]), cy(fishY2[i]));
            ctx.strokeStyle = `rgba(${r},${g},${b},0.7)`; ctx.lineWidth = LW; ctx.stroke();
        }
    } else if (isButterfly) {
        for (let i = 0; i < BFLY_N; i++) {
            const [r, g, b] = samplePalette(pal, bflyT[i]);
            const radius = bflyR[i] * sc; if (radius < 0.15) continue;
            ctx.beginPath(); ctx.arc(cx(bflyX[i]), cy(bflyY[i]), radius, 0, Math.PI * 2);
            ctx.strokeStyle = `rgba(${r},${g},${b},0.7)`; ctx.lineWidth = LW; ctx.stroke();
        }
    } else {
        const pointFraction = 0.02 + (density / 100) * 0.98;
        const num_points = Math.max(50, Math.round(K * pointFraction));
        const step = Math.max(1, Math.floor(K / num_points));
        for (let j = 0; j < K; j += step) {
            const t = (interp[j] - mn) / rng;
            const [r, g, b] = samplePalette(pal, t);
            const radius = R[j] * sc; if (radius < 0.2) continue;
            ctx.beginPath(); ctx.arc(cx(X[j]), cy(Y[j]), radius, 0, Math.PI * 2);
            ctx.strokeStyle = `rgba(${r},${g},${b},0.7)`; ctx.lineWidth = LW; ctx.stroke();
        }
    }
}

const canvasWrapEl = document.getElementById('canvasWrap');

canvasWrapEl.addEventListener('wheel', function (e) {
    e.preventDefault();
    if (!lastRender) return;
    const rect = canvasWrapEl.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
    const newScale = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoomScale * factor));
    if (newScale === zoomScale) return;
    // Keep point under cursor fixed
    zoomPanX = mouseX - (mouseX - zoomPanX) * (newScale / zoomScale);
    zoomPanY = mouseY - (mouseY - zoomPanY) * (newScale / zoomScale);
    zoomScale = newScale;
    showZoomIndicator();
    // Debounce the re-render so rapid scrolling stays smooth
    clearTimeout(zoomDebounceTimer);
    zoomDebounceTimer = setTimeout(redrawAtZoom, 80);
}, { passive: false });

canvasWrapEl.addEventListener('mousedown', function (e) {
    if (!lastRender || e.button !== 0) return;
    isPanning = true;
    panStartX = e.clientX - zoomPanX;
    panStartY = e.clientY - zoomPanY;
    canvasWrapEl.classList.add('panning');
});
window.addEventListener('mousemove', function (e) {
    if (!isPanning) return;
    zoomPanX = e.clientX - panStartX;
    zoomPanY = e.clientY - panStartY;
    clearTimeout(zoomDebounceTimer);
    zoomDebounceTimer = setTimeout(redrawAtZoom, 40);
});
window.addEventListener('mouseup', function () {
    if (!isPanning) return;
    isPanning = false;
    canvasWrapEl.classList.remove('panning');
});

// Touch support
let lastTouchDist = null;
canvasWrapEl.addEventListener('touchstart', function (e) {
    if (e.touches.length === 2) {
        lastTouchDist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
    } else if (e.touches.length === 1) {
        isPanning = true;
        panStartX = e.touches[0].clientX - zoomPanX;
        panStartY = e.touches[0].clientY - zoomPanY;
    }
}, { passive: true });
canvasWrapEl.addEventListener('touchmove', function (e) {
    e.preventDefault();
    if (e.touches.length === 2 && lastTouchDist) {
        const dist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
        const midX = (e.touches[0].clientX + e.touches[1].clientX) / 2 - canvasWrapEl.getBoundingClientRect().left;
        const midY = (e.touches[0].clientY + e.touches[1].clientY) / 2 - canvasWrapEl.getBoundingClientRect().top;
        const factor = dist / lastTouchDist;
        const newScale = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoomScale * factor));
        zoomPanX = midX - (midX - zoomPanX) * (newScale / zoomScale);
        zoomPanY = midY - (midY - zoomPanY) * (newScale / zoomScale);
        zoomScale = newScale;
        lastTouchDist = dist;
        showZoomIndicator();
        clearTimeout(zoomDebounceTimer);
        zoomDebounceTimer = setTimeout(redrawAtZoom, 80);
    } else if (e.touches.length === 1 && isPanning) {
        zoomPanX = e.touches[0].clientX - panStartX;
        zoomPanY = e.touches[0].clientY - panStartY;
        clearTimeout(zoomDebounceTimer);
        zoomDebounceTimer = setTimeout(redrawAtZoom, 40);
    }
}, { passive: false });
canvasWrapEl.addEventListener('touchend', function () { lastTouchDist = null; isPanning = false; });

canvasWrapEl.addEventListener('dblclick', resetZoom);

// ensure artTitle always exists
if (!document.getElementById('artTitle')) {
    const t = document.createElement('div'); t.id = 'artTitle';
    document.getElementById('canvasWrap').appendChild(t);
}

initPyodide();
drawColorbar('magma');

// ── CHART EXPAND MODAL ─────────────────────────────────────────────────────
function closeChartModal() {
    document.getElementById('chartModal').classList.remove('open');
    // reset both content types for next open
    document.getElementById('chartModalCanvas').style.display = 'block';
    document.getElementById('chartModalTableWrap').style.display = 'none';
}

function openChartModal(chartType) {
    if (!rawData && chartType !== 'table') return;
    if (chartType === 'table' && (!csvRows || csvRows.length < 2)) return;

    const modal = document.getElementById('chartModal');
    const canvas = document.getElementById('chartModalCanvas');
    const tableWrap = document.getElementById('chartModalTableWrap');
    const title = document.getElementById('chartModalTitle');
    const metaEl = document.getElementById('chartModalMeta');
    const descEl = document.getElementById('chartModalDesc');

    // Show correct content element
    if (chartType === 'table') {
        canvas.style.display = 'none';
        tableWrap.style.display = 'block';
    } else {
        canvas.style.display = 'block';
        tableWrap.style.display = 'none';
    }

    if (chartType === 'table') {
        title.textContent = 'Dataset Preview — ' + (dataVars.filename || 'dataset');

        const headers = csvRows[0];
        const dataRows = csvRows.slice(1);
        const totalRows = dataRows.length;
        // Show all rows in expanded view (up to 5000)
        const SHOW = Math.min(5000, totalRows);

        const tbl = tableWrap.querySelector('table');
        const thead = tbl.querySelector('thead');
        const tbody = tbl.querySelector('tbody');
        thead.innerHTML = ''; tbody.innerHTML = '';

        // Header row
        const trH = document.createElement('tr');
        const thN = document.createElement('th');
        thN.textContent = '#';
        thN.style.cssText = 'color:#5a5a7a;min-width:36px;text-align:right;padding-right:14px';
        trH.appendChild(thN);
        headers.forEach(h => {
            const th = document.createElement('th');
            th.textContent = h || '—';
            trH.appendChild(th);
        });
        thead.appendChild(trH);

        // Body rows
        for (let i = 0; i < SHOW; i++) {
            const row = dataRows[i];
            const tr = document.createElement('tr');
            const tdN = document.createElement('td');
            tdN.textContent = i + 1;
            tdN.style.cssText = 'color:#4a4a6a;text-align:right;padding-right:14px';
            tr.appendChild(tdN);
            headers.forEach((_, ci) => {
                const td = document.createElement('td');
                const val = row[ci] !== undefined ? row[ci] : '';
                td.textContent = val;
                if (val !== '' && !isNaN(parseFloat(val))) td.className = 'num';
                tr.appendChild(td);
            });
            tbody.appendChild(tr);
        }

        metaEl.textContent = `${headers.length} columns · ${totalRows.toLocaleString()} rows${totalRows > SHOW ? ` · showing first ${SHOW.toLocaleString()}` : ''}`;
        descEl.innerHTML = `<strong>What this shows:</strong> Every row from your uploaded CSV displayed in full. <strong>Green values</strong> represent numeric columns - these are used to calculate the PCA signal that morphs the artwork. White values represent text or categorical columns, which are ignored in the calculation. Use this view to inspect your data, check for missing values, or verify that the correct columns were detected.<br><br>
                    👾 <i>PCA stands for Principal Component Analysis, a statistical method used in data science to detect patterns and variation in data.</i><br>
                    🤖 <i>Note:</i> This is the base version of the project. Future updates will allow you to choose which numeric columns or rows influence the generated artwork.`;

        modal.classList.add('open');
        return;
    }
    const pal = document.getElementById('paletteSelect').value;
    const raw = rawData;
    let mn = Infinity, mx = -Infinity;
    for (const v of raw) { if (v < mn) mn = v; if (v > mx) mx = v; }
    const rng = mx - mn || 1;

    const vw = Math.min(window.innerWidth * 0.80, 1060);
    const DPR = window.devicePixelRatio || 1;
    const ctx = canvas.getContext('2d');

    if (chartType === 'signal') {
        const H = Math.round(vw * 0.32);
        canvas.width = vw * DPR; canvas.height = H * DPR;
        canvas.style.width = vw + 'px'; canvas.style.height = H + 'px';
        title.textContent = 'Signal Trace — ' + (dataVars.filename || 'dataset');

        ctx.fillStyle = '#1e1e2e'; ctx.fillRect(0, 0, canvas.width, canvas.height);
        const W = canvas.width, CH = canvas.height;
        const pL = 52 * DPR, pR = 18 * DPR, pT = 16 * DPR, pB = 36 * DPR;
        const dW = W - pL - pR, dH = CH - pT - pB;

        ctx.font = `${10 * DPR}px system-ui`; ctx.fillStyle = '#5a5a7a';
        ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
        for (let i = 0; i <= 5; i++) {
            const fy = i / 5, cy = pT + dH * (1 - fy);
            ctx.strokeStyle = 'rgba(255,255,255,0.06)'; ctx.lineWidth = DPR;
            ctx.beginPath(); ctx.moveTo(pL, cy); ctx.lineTo(pL + dW, cy); ctx.stroke();
            ctx.fillText((mn + fy * rng).toFixed(2), pL - 6 * DPR, cy);
        }
        ctx.textAlign = 'center'; ctx.textBaseline = 'top';
        for (let i = 0; i <= 6; i++) {
            const fx = i / 6, cx = pL + dW * fx;
            ctx.fillStyle = '#5a5a7a';
            ctx.fillText(Math.round(fx * (raw.length - 1)), cx, pT + dH + 6 * DPR);
        }
        ctx.strokeStyle = 'rgba(200,200,220,0.22)'; ctx.lineWidth = DPR;
        ctx.beginPath();
        for (let i = 0; i < raw.length; i++) {
            const x = pL + (i / (raw.length - 1)) * dW;
            const y = pT + dH - ((raw[i] - mn) / rng) * dH;
            i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        }
        ctx.stroke();
        const step = Math.max(1, Math.floor(raw.length / 800));
        for (let i = 0; i < raw.length; i += step) {
            const x = pL + (i / (raw.length - 1)) * dW;
            const y = pT + dH - ((raw[i] - mn) / rng) * dH;
            ctx.fillStyle = palColor(pal, (raw[i] - mn) / rng);
            ctx.beginPath(); ctx.arc(x, y, 2 * DPR, 0, Math.PI * 2); ctx.fill();
        }
        ctx.fillStyle = '#7070a0'; ctx.font = `${10 * DPR}px system-ui`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
        ctx.fillText('Row Index', pL + dW / 2, CH - 2 * DPR);
        ctx.save(); ctx.translate(13 * DPR, pT + dH / 2); ctx.rotate(-Math.PI / 2);
        ctx.textBaseline = 'middle'; ctx.fillText('PC1 Value', 0, 0); ctx.restore();

        metaEl.textContent = `${raw.length.toLocaleString()} data points · file: ${dataVars.filename}`;
        descEl.innerHTML = `<strong>What this shows:</strong> Each dot represents one row from your dataset, plotted in the order it appears. The vertical position shows the PC1 value - a single number that captures the strongest variation across all numeric columns combined. The connecting line reveals the overall shape of the data, making it possible to spot <strong>trends</strong> (steady rises or falls), <strong>spikes</strong> (sudden outliers), <strong>cycles</strong> (repeating patterns), or a <strong>flat signal</strong> when the data is relatively uniform. This exact signal is injected into the artwork - its peaks and valleys directly push and pull the geometry of the generated pattern.<br><br>
                    👾 <i>PC1 stands for the First Principal Component, a data analysis technique used to capture the most important variation within a dataset.</i>`;
    } else {
        const H = Math.round(vw * 0.38);
        canvas.width = vw * DPR; canvas.height = H * DPR;
        canvas.style.width = vw + 'px'; canvas.style.height = H + 'px';
        title.textContent = 'Histogram — ' + (dataVars.filename || 'dataset');

        ctx.fillStyle = '#1e1e2e'; ctx.fillRect(0, 0, canvas.width, canvas.height);
        const W = canvas.width, CH = canvas.height;
        const pL = 52 * DPR, pR = 18 * DPR, pT = 16 * DPR, pB = 40 * DPR;
        const dW = W - pL - pR, dH = CH - pT - pB;

        const BINS = 60, bins = new Float32Array(BINS);
        for (const v of raw) bins[Math.min(BINS - 1, Math.floor(((v - mn) / rng) * BINS))]++;
        const bmax = Math.max(...bins);

        ctx.font = `${10 * DPR}px system-ui`; ctx.fillStyle = '#5a5a7a';
        ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
        for (let i = 0; i <= 4; i++) {
            const fy = i / 4, cy = pT + dH * (1 - fy);
            ctx.strokeStyle = 'rgba(255,255,255,0.06)'; ctx.lineWidth = DPR;
            ctx.beginPath(); ctx.moveTo(pL, cy); ctx.lineTo(pL + dW, cy); ctx.stroke();
            ctx.fillText(Math.round(fy * bmax), pL - 6 * DPR, cy);
        }
        ctx.textAlign = 'center'; ctx.textBaseline = 'top';
        for (let i = 0; i <= 6; i++) {
            const fx = i / 6;
            ctx.fillStyle = '#5a5a7a';
            ctx.fillText((mn + fx * rng).toFixed(2), pL + dW * fx, pT + dH + 6 * DPR);
        }
        const bw = dW / BINS;
        for (let i = 0; i < BINS; i++) {
            const bh = (bins[i] / bmax) * dH;
            ctx.fillStyle = palColor(pal, i / BINS, 0.88);
            ctx.fillRect(pL + i * bw + 1, pT + dH - bh, bw - 2, bh);
        }
        ctx.fillStyle = '#7070a0'; ctx.font = `${10 * DPR}px system-ui`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
        ctx.fillText('PC1 Value', pL + dW / 2, CH - 2 * DPR);
        ctx.save(); ctx.translate(13 * DPR, pT + dH / 2); ctx.rotate(-Math.PI / 2);
        ctx.textBaseline = 'middle'; ctx.fillText('Count', 0, 0); ctx.restore();

        metaEl.textContent = `60 bins · ${raw.length.toLocaleString()} values · range: ${mn.toFixed(3)} → ${mx.toFixed(3)}`;
        descEl.innerHTML = `<strong>What this shows:</strong> The histogram splits all PC1 values into 60 ranges (“buckets”) and shows how many data points fall into each range. Taller bars mean many rows share similar values, while shorter bars mean those values are less common.<br><br>
                    <strong>Narrow, tall peak:</strong> Most values are closely grouped together, so the artwork morph will appear smooth, subtle, and consistent.<br>
                    <strong>Wide or flat spread:</strong> Values vary more dramatically, creating stronger contrast and more noticeable changes in the generated pattern.<br>
                    <strong>Multiple peaks:</strong> The data contains distinct clusters or groups, which can produce layered, striped, or banded visual effects in the artwork.<br><br>
                    In short, the histogram reveals how much variation exists within the PC1 values - and that variation directly influences how calm, intense, or structured the final visual output feels.<br>
                    👾 <i>PC1 stands for the First Principal Component, a data analysis technique used to capture the strongest variation within a dataset.</i>`;
    }

    modal.classList.add('open');
}

document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') closeChartModal();
});
