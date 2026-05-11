// PALETTES SECTION
// stores predefined colour palletes as RGB triplets
// Each palette is an array of colours used for gradients in the artwork.

// Using Perceptually uniform sequential colourmap palette as it is designed for ordered data, mapping numerical values to colours used in scientific visualisation.
    // "magma" palette:
    // dark purple → orange → pale yellow
const PALETTES = {
    // "magma" palette:
    // dark purple → orange → pale yellow
    magma: [
        [0, 0, 4], 
        [28, 16, 68], 
        [79, 18, 123], 
        [129, 37, 129], 
        [181, 54, 122], 
        [229, 80, 100], 
        [251, 135, 97], 
        [254, 194, 135], 
        [252, 253, 191]
    ],
    // "inferno" palette
    // black → purple → orange → yellow
    inferno: [
        [0, 0, 4], 
        [31, 12, 72], 
        [85, 15, 109], 
        [136, 34, 106], 
        [186, 54, 89], 
        [227, 89, 51], 
        [249, 149, 10], 
        [253, 211, 99], 
        [252, 255, 164]
    ],
     // "plasma" palette:
    // deep blue → pink → yellow
    plasma: [
        [13, 8, 135], 
        [84, 2, 163], 
        [139, 10, 165], 
        [185, 50, 137], 
        [219, 92, 104], 
        [244, 136, 73], 
        [254, 188, 43], 
        [240, 249, 33], 
        [240, 249, 33]
    ],
    // "viridis" palette:
    // purple → blue → green → yellow
    viridis: [
        [68, 1, 84], 
        [72, 40, 120], 
        [62, 83, 160], 
        [49, 123, 186], 
        [38, 173, 129], 
        [53, 183, 121], 
        [109, 205, 89], 
        [180, 222, 44], 
        [253, 231, 37]
    ],
     // "cividis" palette:
    // blue → olive → pale yellow
    cividis: [
        [0, 32, 77], 
        [0, 60, 100], 
        [0, 91, 110], 
        [57, 121, 113], 
        [116, 150, 107], 
        [168, 178, 88], 
        [213, 210, 69], 
        [250, 243, 138], 
        [255, 255, 180]
    ],
    // "turbo" palette:
    // rainbow-style vivid palette
    turbo: [
        [48, 18, 59], 
        [86, 72, 202], 
        [51, 167, 228], 
        [45, 224, 155], 
        [150, 235, 58], 
        [237, 184, 21], 
        [235, 78, 10], 
        [163, 15, 5], 
        [144, 12, 0]
    ]
};

// samplePalette()
// Returns an interpolated RGB colour from a palette.
//
// PARAMETERS:
// pal = palette name (e.g. "magma")
// t   = value between 0 and 1
//
// Example:
// t = 0   → first colour
// t = 1   → last colour
// t = 0.5 → middle blended colour

function samplePalette(pal, t) {
     // Get selected palette.
    // If palette name doesn't exist, default to magma
    const stops = PALETTES[pal] || PALETTES.magma;

    // Clamp t so it always stays between 0 and 1
    t = Math.max(0, Math.min(1, t));

    // Convert t into an index across palette stops
        // Example: if there are 9 colors and t=0.5 → idx=4
    const idx = t * (stops.length - 1);
     // Lower and Upper colour index
    const lo = Math.floor(idx), hi = Math.min(lo + 1, stops.length - 1);

    // Fraction between lower and upper colour
        // Example: idx=3.2 → f=0.2
    const f = idx - lo;

     // Interpolate each RGB channel
    // This blends smoothly between colours
    // v = lower channel value
        // stops[hi][i] = upper channel value
        // Linear interpolation formula:
        // lower + fraction * difference
    return stops[lo].map((v, i) => Math.round(v + f * (stops[hi][i] - v)));
}

// palColor()
// Converts RGB array into CSS rgb()/rgba() string.
//
// PARAMETERS:
// pal   = palette name
// t     = normalised value between 0 and 1
// alpha = optional transparency
//
// RETURNS:
// "rgb(r,g,b)"
// or
// "rgba(r,g,b,a)"

function palColor(pal, t, alpha) {
    // Get interpolated RGB colour from palette
    const [r, g, b] = samplePalette(pal, t);

     // If alpha was supplied:
    // return rgba string with transparency
    return alpha !== undefined
        ? `rgba(${r},${g},${b},${alpha.toFixed(3)})`

        // Otherwise return solid rgb color
        : `rgb(${r},${g},${b})`;
}

// GLOBAL STATE
// These variables store application-wide data that multiple functions use

// Will later hold the Pyodide Python runtime object
// Starts as null because it hasn't loaded yet
let pyodide = null;

// Boolean flag:
// false = Python environment still loading
// true  = Python environment ready to use
let pyodideReady = false;

// Stores processed numeric PCA data
// Later becomes a Float32Array of values
let rawData = null;

// Stores raw CSV rows for the preview table
let csvRows = null;

// Stores dataset-derived variables used in artwork generation
//
// A and B are parameters derived from PCA statistics
// has_data tells whether a CSV has been loaded
// filename stores uploaded file name
let dataVars = { A: 31, B: 6, has_data: false, filename: '' };

// Prevents multiple renders from running at once
let rendering = false;

// Stores previous render geometry
// Used when zooming/panning so the artwork can redraw
// without recalculating everything
let lastRender = null; 


// PYODIDE INITIALIZATION
// Loads Python into the browser using Pyodide
// Also installs numpy + scikit-learn
async function initPyodide() {
     // Get references to UI elements
    const statusEl = document.getElementById('pyStatus');
    const overlayEl = document.getElementById('canvasLoadingOverlay');
    const overlayLabel = document.getElementById('canvasLoadingLabel');
    const uploadArea = document.getElementById('uploadArea');
    const sampleSel = document.getElementById('sampleDatasetSelect');

// Disable uploads while Python is loading

     // Prevent mouse interaction
    uploadArea.style.pointerEvents = 'none';
    // Make upload area visually faded
    uploadArea.style.opacity = '0.4';
    // Disable sample dataset dropdown
    sampleSel.disabled = true;

    // Try loading Python runtime
    try {
        // Update loading message
        overlayLabel.textContent = '⏳ Loading Python environment…';

         // Load Pyodide from CDN (content delivery network - closer to end-users to speed up website loading times)
        // await pauses execution until Pyodide finishes loading
        pyodide = await loadPyodide({ indexURL: "https://cdn.jsdelivr.net/pyodide/v0.25.1/full/" });

        // Update UI text
        overlayLabel.textContent = '⏳ Installing packages…';
        statusEl.textContent = '⏳ Installing packages…';

        // Install required Python libraries
        // numpy         = numerical computing
        // scikit-learn  = PCA analysis
        await pyodide.loadPackage(['numpy', 'scikit-learn']);

        // This forces NumPy and sklearn to fully initialise now,
        // instead of freezing later during first CSV processing.
        // Ensure numpy C extensions are fully initialised
        await pyodide.runPythonAsync(`import numpy as np; import sklearn; _ = np.array([1.0])`);

        // Mark Python as ready when it is ready
        pyodideReady = true;
        // Update status text
        statusEl.textContent = '✅ Python ready';
        // Make status green
        statusEl.style.color = '#1D9E75';

        // Replace loading overlay text with intro message
        overlayLabel.innerHTML =
            'Welcome to DataMorph! Please Upload a CSV and Enter a Prompt. See the mathematical magic 🪄 <br><br>' +
            'Generate unique algorithmic art from your dataset and prompt using parametric equations.';

        // Hide loading progress bar
        document.getElementById('canvasLoadingBarTrack').style.display = 'none';
        // Make overlay transparent
        overlayEl.style.background = 'transparent';
        // Remove spacing between overlay elements
        overlayEl.style.gap = '0';

        // Re-enable uploads now that Python is ready
        // Restore mouse interaction
        uploadArea.style.pointerEvents = '';
        // Restore opacity
        uploadArea.style.opacity = '';
        // Enable sample dropdown
        sampleSel.disabled = false;

        // Sort sample datasets alphabetically
        // Convert dropdown options into array
        const options = Array.from(sampleSel.options);
        // Remove first option (placeholder)
        const placeholder = options.shift();

        // Sort remaining options alphabetically
        options.sort((a, b) => a.text.toLowerCase().localeCompare(b.text.toLowerCase()));
         // Clear dropdown
        sampleSel.innerHTML = '';
        // Re-add placeholder first
        sampleSel.appendChild(placeholder);
        // Add sorted options
        options.forEach(opt => sampleSel.appendChild(opt));

    // If anything fails:
    } catch (e) {
         // Show failure message
        overlayLabel.textContent = '❌ Failed to load Python';
        // Show actual error message
        statusEl.textContent = '❌ ' + e.message;
        // Make text red
        statusEl.style.color = '#e05555';
    }
}

// CSV → PCA LOGIC
// Reads uploaded CSV file
// Extracts numeric columns
// Runs PCA in Python
// Converts result into signal data for artwork

// ── CSV → PCA Logic ────────────────────────────────────────────────────────
async function processCSV(csvText, filename) {

    // Get status UI element
    const status = document.getElementById('statusBox');
    // Show loading text
    status.textContent = '⏳ Running PCA in Python…';

    // Reset previous rows
    csvRows = null;
    try {
        // Split CSV into lines
        //
        // Handles both:
        // \n
        // \r\n
        const lines = csvText.trim().split(/\r?\n/);

        // Convert each line into column array
        const parsed = lines.map(l => {

            // Final column list for this row
            const cols = []; 
            // Current text being built
            let cur = '', 
            // Tracks whether parser is inside quotes
            inQ = false;

            // Read each character in line
            for (let ci = 0; ci < l.length; ci++) {
                const ch = l[ci];

                // Toggle quote state
                if (ch === '"') { inQ = !inQ; }

                // Comma outside quotes = new column
                else if (ch === ',' && !inQ) { 
                    // Save completed column
                    cols.push(cur.trim()); 
                    // Reset current value
                    cur = ''; 
                }
                 // Otherwise append character
                else { cur += ch; }
            }
            // Push final column and return row array
            cols.push(cur.trim()); 
            return cols;
        });
        // Only save if dataset has rows
        if (parsed.length > 1) csvRows = parsed;
        // Ignore parsing errors silently
    } catch (_) { }

    // Send CSV text into Python environment
    pyodide.globals.set('csv_text', csvText);
    try {
        // Run Python code asynchronously
        const res = await pyodide.runPythonAsync(`

# Import libraries
import numpy as np, io, csv as _csv

# PCA algorithm
from sklearn.decomposition import PCA

# Read CSV from string
reader = _csv.reader(io.StringIO(csv_text))

# Convert into list of rows
rows   = list(reader)

# Require at least header + 1 row
if len(rows) < 2:
    raise ValueError("Need at least 2 rows")

# Store numeric columns here
numeric_cols = []

# Loop through every column index
for ci in range(len(rows[0])):

    # Store numeric values for this column
    vals = []

    # Loop through data rows (skip header)
    for r in rows[1:]:

        # Ensure column exists
        if ci < len(r):
            # Convert value to float
            try: vals.append(float(r[ci]))
            # Ignore non-numeric values
            except: pass
    
    # Keep column only if it has enough numbers
    if len(vals) > 2:
        numeric_cols.append(vals)

# If no numeric data found → error
if not numeric_cols:
    raise ValueError("No numeric columns found")

# Find shortest numeric column length
min_len = min(len(c) for c in numeric_cols)

# Build 2D NumPy array
# .T transposes rows/columns
arr = np.array([c[:min_len] for c in numeric_cols]).T

# Fill missing values using interpolation
for ci in range(arr.shape[1]):

    # Current column
    col = arr[:, ci]

    # Find NaN values
    mask = np.isnan(col)

    # Indices of valid values
    idx  = np.where(~mask)[0]

    # If valid data exists
    if idx.size:

        # Interpolate missing values
        arr[:, ci] = np.interp(np.arange(len(col)), idx, col[idx])

# Replace remaining NaNs with 0
arr = np.nan_to_num(arr)

# PCA ANALYSIS
# Create PCA model with 1 component
pca  = PCA(n_components=1)

# If only one numeric column exists use raw data directly
# Otherwise compute PCA transform
pc1  = arr if arr.shape[1] == 1 else pca.fit_transform(arr)

# Flatten into 1D array
flat = pc1.flatten()


# Generate artwork parameters from PCA statistics
# mean() controls A
# std() controls B
A_val = float((pc1.mean() % 10) + 25)
B_val = float((pc1.std() % 5) + 4)

# Return results to JavaScript
[flat.tolist(), A_val, B_val]
`);
        // Convert Python result into JS object
        const js = res.toJs();

        // Convert Pyodide array into regular JS array
        const flat = js[0].toJs ? js[0].toJs() : js[0];

        // Store PCA signal as Float32Array
        rawData = new Float32Array(flat);

        // Save dataset-derived parameters
        dataVars = { A: js[1], B: js[2], has_data: true, filename };

         // Update success status text
        status.innerHTML = `<span style="color:#1D9E75;font-weight:500">✅ Loaded:</span> ${filename}<br>${rawData.length} points → K=${Math.max(2000, Math.min(80000, Math.round(rawData.length * 2 / 100) * 100 || 9830))} geometry steps`;
        
        // Add CSS class to upload area
        document.getElementById('uploadArea').classList.add('loaded');

        // Enable render button
        document.getElementById('renderBtn').disabled = false;

        // Hide loading overlay
        document.getElementById('canvasLoadingOverlay').classList.add('hidden');

        // Draw sidebar charts
        drawSidebarCharts();

        // Build preview table
        buildDataPreview();

    } catch (e) {
        // Display PCA error message
        status.textContent = '❌ ' + e.message;
        // Log full error in browser console
        console.error(e);
    }
}

// DATASET PREVIEW TABLE 
// Function that builds an HTML preview table from parsed CSV data
function buildDataPreview() {

    // Get wrapper element that holds the preview table
    const wrap = document.getElementById('dataPreviewWrap');

    // Get actual table element inside a container
    const tableEl = document.getElementById('dataPreviewTable').querySelector('table');

    // Element used for metadata text (rows, columns, etc.)
    const meta = document.getElementById('dataPreviewMeta');

    // If no CSV loaded or not enough rows, hide preview and exit
    if (!csvRows || csvRows.length < 2) { wrap.style.display = 'none'; return; }

    // First row = headers (column names)
    const headers = csvRows[0];

    // Remaining rows = actual dataset
    const dataRows = csvRows.slice(1);

    // Total number of rows in dataset
    const totalRows = dataRows.length;

    // Limit preview to max 200 rows for performance
    const PREVIEW_ROWS = Math.min(200, totalRows); 

    // BUILD TABLE HEADER
    // Get table header section
    const thead = tableEl.querySelector('thead');
    // clear old header
    thead.innerHTML = '';

    // Create header row
    const trH = document.createElement('tr');

    // Add row index column header ("#")
    const thN = document.createElement('th');
    thN.textContent = '#';
    thN.style.cssText = 'color:#5a5a7a;min-width:28px;text-align:right;padding-right:10px';
    trH.appendChild(thN);

    // Add one column header per CSV column
    headers.forEach(h => {
        const th = document.createElement('th');
        // fallback if empty header
        th.textContent = h || '—';
        trH.appendChild(th);
    });
    // Attach header row to table
    thead.appendChild(trH);

    // BUILD TABLE BODY
    const tbody = tableEl.querySelector('tbody');
    // clear previous rows
    tbody.innerHTML = '';

    // Loop through preview rows only
    for (let i = 0; i < PREVIEW_ROWS; i++) {
        const row = dataRows[i];

        // Create table row
        const tr = document.createElement('tr');

        // Add row number column
        const tdN = document.createElement('td');
        tdN.textContent = i + 1;
        tdN.style.cssText = 'color:#4a4a6a;text-align:right;padding-right:10px';
        tr.appendChild(tdN);

        // Loop through each column in row
        headers.forEach((_, ci) => {
            const td = document.createElement('td');
            // Get cell value safely (empty if missing)
            const val = row[ci] !== undefined ? row[ci] : '';
            td.textContent = val;
            // Try parsing number to detect numeric columns
            const num = parseFloat(val);
            // If numeric, colour it 
            if (val !== '' && !isNaN(num)) td.style.color = '#a0c8a0';
            tr.appendChild(td);
        });
         // Add row to table
        tbody.appendChild(tr);
    }

    // META INFO LINE
    meta.textContent = `${headers.length} columns · ${totalRows.toLocaleString()} rows${totalRows > PREVIEW_ROWS ? ` · showing first ${PREVIEW_ROWS}` : ''}`;

    // Show preview container
    wrap.style.display = 'block';
}

// SIDEBAR CHARTS
// Draws signal + histogram visualisations from dataset
function drawSidebarCharts() {
    // Selected colour palette
    const pal = document.getElementById('paletteSelect').value;

    // Raw numeric dataset
    const raw = rawData;
    // Compute min/max for normalisation
    let mn = Infinity, mx = -Infinity;
    for (const v of raw) { if (v < mn) mn = v; if (v > mx) mx = v; }
    // avoid divide-by-zero
    const rng = mx - mn || 1;

    // SIGNAL WAVEFORM CANVAS
    const sc = document.getElementById('signalCanvas');

    // Scale for retina displays
    sc.width = sc.offsetWidth * devicePixelRatio;

    const sW = sc.width, sH = sc.height;
    const sctx = sc.getContext('2d');

    // Clear canvas
    sctx.clearRect(0, 0, sW, sH);

    // Draw faint line waveform
    sctx.strokeStyle = '#cccccc'; sctx.lineWidth = 1; sctx.globalAlpha = 0.4;
    sctx.beginPath();
    for (let i = 0; i < raw.length; i++) {
        const x = (i / (raw.length - 1)) * sW;
        const y = sH - ((raw[i] - mn) / rng) * (sH - 4) - 2;
        i === 0 ? sctx.moveTo(x, y) : sctx.lineTo(x, y);
    }
    sctx.stroke();

    // Restore opacity for next drawing
    sctx.globalAlpha = 1;

    // Draw sampled coloured points (performance optimisation)
    const dStep = Math.max(1, Math.floor(raw.length / 300));
    for (let i = 0; i < raw.length; i += dStep) {
        const x = (i / (raw.length - 1)) * sW;
        const y = sH - ((raw[i] - mn) / rng) * (sH - 4) - 2;

        // Colour depends on normalised value
        sctx.fillStyle = palColor(pal, (raw[i] - mn) / rng);
        sctx.beginPath(); sctx.arc(x, y, 1.5 * devicePixelRatio, 0, Math.PI * 2); sctx.fill();
    }

    // HISTOGRAM CANVAS
    const hc = document.getElementById('histCanvas');
    hc.width = hc.offsetWidth * devicePixelRatio;
    const hW = hc.width, hH = hc.height;
    const hctx = hc.getContext('2d');
    hctx.clearRect(0, 0, hW, hH);

    // number of histogram bins
    const B = 40, 
    bins = new Float32Array(B);

    // Fill histogram bins
    for (const v of raw) bins[Math.min(B - 1, Math.floor(((v - mn) / rng) * B))]++;
    const bmax = Math.max(...bins);
    // Draw histogram bars
    for (let i = 0; i < B; i++) {
        const x = (i / B) * hW, bw = hW / B - 1;
        const bh = (bins[i] / bmax) * (hH - 2);
        hctx.fillStyle = palColor(pal, i / B, 0.85);
        hctx.fillRect(x, hH - bh, bw, bh);
    }

    // Update UI min/max labels
    document.getElementById('cbMax').textContent = mx.toFixed(2);
    document.getElementById('cbMin').textContent = mn.toFixed(2);
    drawColorbar(pal);
}

// COLOURBAR
function drawColorbar(pal) {
    const cb = document.getElementById('colorbar');
    cb.width = 12; cb.height = 130;
    const ctx = cb.getContext('2d');
     // Vertical gradient-like strip
    for (let i = 0; i < 130; i++) {
        ctx.fillStyle = palColor(pal, 1 - i / 130);
        ctx.fillRect(0, i, 12, 1);
    }
}

// GEOMETRY GENERATION LOGIC
// Builds parametric art geometry from dataset + prompt
function buildGeometry(prompt, density) {
    const { A, B } = dataVars;
    const pi = Math.PI;
    const raw = rawData;
    // actual dataset point count 
    const N = raw.length; 

    // Geometry resolution depends on dataset size
    // K scales with dataset: clamped between 2000 and 80000, nudged to a nice step
    const K = Math.max(2000, Math.min(80000, Math.round(N * 2 / 100) * 100 || 9830));

    // Extra dynamic counts (not always used later)
    const FISH_N_dyn = Math.max(200, Math.min(4000, Math.round(N / 5 / 50) * 50 || 1000));
    const BFLY_N_dyn = Math.max(5000, Math.min(120000, Math.round(N * 0.5 / 1000) * 1000 || 40000));

    // Interpolate dataset to smooth curve
    const interp = new Float32Array(K);

    for (let i = 0; i < K; i++) {
        const t = (i / (K - 1)) * (raw.length - 1);
        const lo = Math.floor(t), hi = Math.min(lo + 1, raw.length - 1);
        interp[i] = raw[lo] + (t - lo) * (raw[hi] - raw[lo]);
    }

    // Normalise interpolated values
    let mn = Infinity, mx = -Infinity;
    for (const v of interp) { if (v < mn) mn = v; if (v > mx) mx = v; }
    const rng = mx - mn + 1e-9;
    const data_norm = new Float32Array(K);
    const morph = new Float32Array(K);

    // how strongly data affects geometry deformation
    const morphStrength = 0.02 + (density / 100) * 0.38;
    for (let i = 0; i < K; i++) {
        data_norm[i] = (interp[i] - mn) / rng;

        // center around 0, scale deformation
        morph[i] = (data_norm[i] - 0.5) * morphStrength;
    }

    // Output geometry arrays
    const X = new Float32Array(K), 
    Y = new Float32Array(K), 
    R = new Float32Array(K);

    const p = prompt.toLowerCase().trim();

    for (let i = 0; i < K; i++) {
        const k = i + 1;
        let xb, yb, rb;

        //  Different Parametric Shape Presets

        if (p === 'flying bird') {
            // complex bird-inspired parametric curve
            xb = (3 * k / 20000) + Math.pow(Math.cos(37 * pi * k / 10000), 6) * Math.sin(Math.pow(k / 10000, 7) * (3 * pi / 5)) + (9 / 7) * Math.pow(Math.cos(37 * pi * k / 10000), 16) * Math.pow(Math.cos(pi * k / 20000), 12) * Math.sin(pi * k / 10000);
            yb = (-5 / 4) * Math.pow(Math.cos(37 * pi * k / 10000), 6) * Math.cos(Math.pow(k / 10000, 7) * (3 * pi / 5)) * (1 + 3 * Math.pow(Math.cos(pi * k / 20000) * Math.cos(3 * pi * k / 20000), 8)) + (2 / 3) * Math.pow(Math.cos(3 * pi * k / 200000) * Math.cos(9 * pi * k / 200000) * Math.cos(9 * pi * k / 100000), 12);
            rb = 0.04;
        } else if (p === 'bird') {
            // dataset-driven bird deformation
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
            // fallback circle-like motion
            const t = -3 + 6 * (i / (K - 1));
            xb = 7 * Math.pow(Math.cos(Math.cos(1.28 * Math.round(t))), 2) * (1 + Math.pow(Math.cos(1.18 * t), 4));
            yb = 7 * Math.pow(Math.sin(Math.sin(1.28 * t)), 2) * Math.sin(Math.sin(1.18 * t));
            rb = 0.08;
        
        } else {
            // fallback circle-like motion
            xb = Math.cos(k / 1000); yb = Math.sin(k / 1000); rb = 0.05;
        }

        // apply dataset-driven morphing distortion
        X[i] = xb + morph[i] * Math.sin(k / 500);
        Y[i] = yb + morph[i] * Math.cos(k / 500);
        R[i] = rb;
    }

    // FISH SHAPE GENERATION - INSPIRED BY HAMID NADERI YEGANEH'S EQUATION
    //  number of fish segments based on dataset size
    const FISH_N = FISH_N_dyn;

    // arrays for two endpoints of each fish line segment
    const fishX1 = new Float32Array(FISH_N), fishY1 = new Float32Array(FISH_N);
    const fishX2 = new Float32Array(FISH_N), fishY2 = new Float32Array(FISH_N);

    // time/value arrays
    const fishT = new Float32Array(FISH_N);

    // only run fish model if prompt is "fish"
    if (p === 'fish') {
        for (let i = 0; i < FISH_N; i++) {
            // 1-based index for math formulas
            const fi = i + 1;
            // map i into dataset index range
            const rawT = (i / (FISH_N - 1)) * (raw.length - 1);

            // lower dataset index
            const lo = Math.floor(rawT), 
            // upper index safely clamped
            hi = Math.min(lo + 1, raw.length - 1);

            // linear interpolation of dataset signal
            const sig = raw[lo] + (rawT - lo) * (raw[hi] - raw[lo]);

            // normalise signal to 0–1 range
            const sigNorm = (sig - mn) / rng;

            // morph strength centered around 0
            const mo = (sigNorm - 0.5) * morphStrength;

            // fish body segment start point (wave-based shape + dataset distortion)
            fishX1[i] = 2 * Math.sin(4 * pi * fi / 1000 + pi / 6) + mo * Math.sin(fi / 500);
            fishY1[i] = 0.5 * Math.sin(6 * pi * fi / 1000 + 3 * pi / 2) + mo * Math.cos(fi / 500);
            
            // fish body segment end point (different wave to create shape width)
            fishX2[i] = Math.sin(10 * pi * fi / 1000 + pi / 2) + mo * Math.sin(fi / 500);
            fishY2[i] = Math.sin(6 * pi * fi / 1000 + pi / 3) + mo * Math.cos(fi / 500);
            fishT[i] = sigNorm;
        }
    }

    // BUTTERFLY SHAPE GENERATION - INSPIRED BY HAMID NADERI YEGANEH'S EQUATION
    const BFLY_N = BFLY_N_dyn;
    // radius (size of points)
    const bflyX = new Float32Array(BFLY_N), bflyY = new Float32Array(BFLY_N);
    // colour/texture parameter
    const bflyR = new Float32Array(BFLY_N), bflyT = new Float32Array(BFLY_N);

    if (p === 'butterfly') {
        for (let i = 0; i < BFLY_N; i++) {
            const k = i + 1;

             // map into dataset signal
            const rawT = (i / (BFLY_N - 1)) * (raw.length - 1);
            const lo = Math.floor(rawT), hi = Math.min(lo + 1, raw.length - 1);
            const sig = raw[lo] + (rawT - lo) * (raw[hi] - raw[lo]);

            // normalise dataset value
            const sigNorm = (sig - mn) / rng;

            // dataset-driven distortion
            const mo = (sigNorm - 0.5) * morphStrength;

            // precomputed trig values (performance + shape complexity)
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

            // butterfly X coordinate (highly layered trigonometric structure) with dataset morph overlay
            bflyX[i] = (3 / 2) * Math.pow(c141, 9) * (1 - (1 / 2) * s1) * (1 - (1 / 4) * Math.pow(c2, 30) * (1 + Math.pow(c32, 20))) * (1 - (1 / 2) * Math.pow(s2, 30) * Math.pow(s6, 10) * (0.5 + 0.5 * Math.pow(s18, 20))) + mo * Math.sin(k / 500);
            
            // butterfly Y coordinate (similar complexity pattern)
            bflyY[i] = Math.cos(2 * pi * k / 40000) * Math.pow(c141, 2) * (1 + (1 / 4) * Math.pow(c1, 24) * Math.pow(c3, 24) * Math.pow(c21, 24)) + mo * Math.cos(k / 500);
            
            // radius (controls point size)
            bflyR[i] = Math.max(0, (1 / 100) + (1 / 40) * (Math.pow(c141, 14) + Math.pow(s141, 6)) * (1 - Math.pow(c1, 16) * Math.pow(c3, 16) * Math.pow(c12, 16)));
            
            // normalised dataset value (for colour mapping)
            bflyT[i] = sigNorm;
        }
    }
    // Returned all generated geometry and metadata
    return {
    // main generic geometry (used for most shapes)
    X, Y, R,

    // flags telling renderer what mode to use
    isFish: p === 'fish',            // true if fish mode is active
    isButterfly: p === 'butterfly',  // true if butterfly mode is active

    // ── FISH-SPECIFIC DATA ───────────────────────────────────────────────
    fishX1, fishY1,  // first endpoint of fish line segments
    fishX2, fishY2,  // second endpoint of fish line segments
    fishT,           // normalized signal used for coloring fish
    FISH_N,          // number of fish segments generated

    // ── BUTTERFLY-SPECIFIC DATA ──────────────────────────────────────────
    bflyX, bflyY,    // butterfly point positions
    bflyR,           // butterfly point radii (size)
    bflyT,           // normalized signal for color mapping
    BFLY_N,          // number of butterfly points

    // ── DATASET + INTERPOLATION METADATA ────────────────────────────────
    interp, // resampled dataset signal used for smooth geometry
    mn,     // minimum value in dataset (for normalization)
    mx,     // maximum value in dataset
    rng,    // range (mx - mn) used for scaling
    K       // final geometry resolution (number of generated points)
};
}

// RENDER LOGIC
function renderArt() {
    // prevent double renders (locks function if already running)
    if (rendering) return;

    // get user text prompt from input box
    const prompt = document.getElementById('promptInput').value;

    // read density slider (controls number of rendered points)
    const density = parseInt(document.getElementById('densitySlider').value);

    // block execution if dataset is missing
    if (!rawData) { alert('Load a CSV first.'); return; }

    // block empty prompts
    if (!prompt.trim()) { alert('Enter a prompt.'); return; }

    // set global lock flag
    rendering = true;

    // disable render button to prevent spam clicks
    document.getElementById('renderBtn').disabled = true;

    // update UI title to show rendering state
    document.getElementById('artTitle').textContent = prompt.toUpperCase() + ' — rendering…';
    
    // get progress bar element
    const prog = document.getElementById('progressBar');

    // disable animation so it resets instantly
    prog.style.transition = 'none';

    // reset progress bar
    prog.style.width = '0%';

    // delay ensures UI updates before heavy canvas work starts
    setTimeout(() => {
        const pal = document.getElementById('paletteSelect').value;
        const wrap = document.getElementById('canvasWrap');
        const canvas = document.getElementById('artCanvas');

        // device pixel ratio for retina scaling
        const DPR = window.devicePixelRatio || 1;
        const W = wrap.clientWidth, H = wrap.clientHeight;

        // internal resolution scaled for sharp rendering
        canvas.width = W * DPR;
        canvas.height = H * DPR;

        canvas.style.width = W + 'px';
        canvas.style.height = H + 'px';
        const ctx = canvas.getContext('2d');

        // clear previous frame
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        const { X, Y, R, isFish, fishX1, fishY1, fishX2, fishY2, fishT, FISH_N, isButterfly, bflyX, bflyY, bflyR, bflyT, BFLY_N, interp, mn, mx, rng, K } = buildGeometry(prompt, density);

        // stores everything needed to redraw without recomputing geometry
        lastRender = {
            X, Y, R, isFish, fishX1, fishY1, fishX2, fishY2, fishT, FISH_N,
            isButterfly, bflyX, bflyY, bflyR, bflyT, BFLY_N, interp, mn, mx, rng, K,
            pal, prompt, density
        };

        // initialise min/max bounds
        let xmn = Infinity, xmx = -Infinity, ymn = Infinity, ymx = -Infinity;

        // scans all fish segments to find full spatial bounds
        if (isFish) {
            for (let i = 0; i < FISH_N; i++) {
                if (fishX1[i] < xmn) xmn = fishX1[i]; if (fishX1[i] > xmx) xmx = fishX1[i];
                if (fishY1[i] < ymn) ymn = fishY1[i]; if (fishY1[i] > ymx) ymx = fishY1[i];
                if (fishX2[i] < xmn) xmn = fishX2[i]; if (fishX2[i] > xmx) xmx = fishX2[i];
                if (fishY2[i] < ymn) ymn = fishY2[i]; if (fishY2[i] > ymx) ymx = fishY2[i];
            }

        // finds bounds of butterfly point cloud
        } else if (isButterfly) {
            for (let i = 0; i < BFLY_N; i++) {
                if (bflyX[i] < xmn) xmn = bflyX[i]; if (bflyX[i] > xmx) xmx = bflyX[i];
                if (bflyY[i] < ymn) ymn = bflyY[i]; if (bflyY[i] > ymx) ymx = bflyY[i];
            }

        // scans dataset points for bounding box
        } else {
            for (let i = 0; i < K; i++) {
                if (X[i] < xmn) xmn = X[i]; if (X[i] > xmx) xmx = X[i];
                if (Y[i] < ymn) ymn = Y[i]; if (Y[i] > ymx) ymx = Y[i];
            }
        }
        // small margin so points don't touch edges
        xmn -= 0.1; xmx += 0.1; ymn -= 0.1; ymx += 0.1;

        // CANVAS SCAILING SYSTEM
        // outer margin
        const pad = 30 * DPR;

        // usable drawing area
        const drawW = canvas.width - pad * 2;
        const drawH = canvas.height - pad * 2;

        // size of dataset in coordinate space
        const dataW = xmx - xmn, dataH = ymx - ymn;

        // uniform scale factor (keeps aspect ratio)
        const sc = Math.min(drawW / dataW, drawH / dataH);

        // center alignment offsets
        const offX = pad + (drawW - sc * dataW) / 2;
        const offY = pad + (drawH - sc * dataH) / 2;

        // COORDINATE MAPPING HELPERS
        // converts data X → canvas X
        function cx(x) { return offX + (x - xmn) * sc; }

        // converts data Y → canvas Y (flipped vertically)
        function cy(y) { return offY + (ymx - y) * sc; }

        // base stroke thickness adjusted for screen density
        const LW = 0.5 * DPR;

        // FINISH RENDER FUNCTION
        function finishRender() {
            // fill progress bar
            prog.style.width = '100%';

            // final title update
            document.getElementById('artTitle').textContent = 'DATA-MORPHED: ' + prompt.toUpperCase();
            
            // re-enable render button
            document.getElementById('renderBtn').disabled = false;
            
            // unlock renderer
            rendering = false;

            // reset progress bar after delay
            setTimeout(() => { prog.style.width = '0%'; }, 800);

            // update palette UI
            drawColorbar(pal);

             // display math representation
            showEquation(prompt, dataVars.A, dataVars.B, dataVars.filename);

            // show export UI
            document.getElementById('exportWrap').classList.add('visible');

            // reset zoom state
            resetZoom();
        }

        // FISH RENDERING 
        if (isFish) {
            // index tracking how many segments have been drawn
            let fIdx = 0;

             // batch renderer (draws chunks each frame for smooth animation)
            function drawFishBatch() {

                // draw up to 200 segments per frame (or until end)
                const end = Math.min(fIdx + 200, FISH_N);
                for (let i = fIdx; i < end; i++) {

                    // get RGB color from palette based on fishT value (0–1)
                    const [r, g, b] = samplePalette(pal, fishT[i]);

                    // start new line segment
                    ctx.beginPath(); 
                    
                    // move to start point of segment (converted to canvas coords)
                    ctx.moveTo(cx(fishX1[i]), cy(fishY1[i])); 
                    // draw line to end point
                    ctx.lineTo(cx(fishX2[i]), cy(fishY2[i]));                   
                    // set color with transparency
                    ctx.strokeStyle = `rgba(${r},${g},${b},0.7)`; 
                    // line thickness
                    ctx.lineWidth = LW; 
                    // render stroke
                    ctx.stroke();
                }

                // update progress counter
                fIdx = end; 
                 // update UI progress bar
                prog.style.width = ((fIdx / FISH_N) * 100).toFixed(1) + '%';

                // continue animation if not finished
                if (fIdx < FISH_N) requestAnimationFrame(drawFishBatch); else finishRender();
            }
            // start animation loop
            requestAnimationFrame(drawFishBatch); 
            
            // exit main render function (fish mode is exclusive)
            return;
        }

        // BUTTERFLY RENDERING 
        if (isButterfly) {
            // progress index
            let bIdx2 = 0;
            function drawBflyBatch() {

                // draw up to 800 points per frame (denser than fish)
                const end = Math.min(bIdx2 + 800, BFLY_N);
                for (let i = bIdx2; i < end; i++) {

                    // colour per point
                    const [r, g, b] = samplePalette(pal, bflyT[i]);

                    // scale radius based on zoom/geometry
                    const radius = bflyR[i] * sc; 
                    
                    // skip tiny points (performance and visual cleanup)
                    if (radius < 0.15) continue;

                    ctx.beginPath(); 
                    // draw circle point
                    ctx.arc(cx(bflyX[i]), cy(bflyY[i]), radius, 0, Math.PI * 2);
                     // stroke styling
                    ctx.strokeStyle = `rgba(${r},${g},${b},0.7)`; ctx.lineWidth = LW; ctx.stroke();
                }

                // update progress
                bIdx2 = end; prog.style.width = ((bIdx2 / BFLY_N) * 100).toFixed(1) + '%';
                
                // continue or finish
                if (bIdx2 < BFLY_N) requestAnimationFrame(drawBflyBatch); 
                else finishRender();
            }
            // start butterfly rendering
            requestAnimationFrame(drawBflyBatch); 
            return;
        }

        // GENERIC DATASET RENDERING

        // how much of dataset to sample based on slider (density control)
        const pointFraction = 0.02 + (density / 100) * 0.98;

        // number of points to actually draw
        const num_points = Math.max(50, Math.round(K * pointFraction));

        // sampling step size (skip points to reduce workload)
        const step = Math.max(1, Math.floor(K / num_points));

        // build index list of points to render
        const indices = []; for (let j = 0; j < K; j += step) indices.push(j);
        let bIdx = 0;

        // smooth progress bar animation
        prog.style.transition = 'width .08s';
        function drawBatch() {
            // draw up to 600 points per frame
            const end = Math.min(bIdx + 600, indices.length);
            for (let ci = bIdx; ci < end; ci++) {

                // dataset index
                const j = indices[ci];

                // normaliSe value for color mapping (0–1)
                const t = (interp[j] - mn) / rng;

                // get colour
                const [r, g, b] = samplePalette(pal, t);

                // scale radius
                const radius = R[j] * sc; 
                // skip tiny points
                if (radius < 0.2) continue;
                
                ctx.beginPath(); 
                // draw circular point
                ctx.arc(cx(X[j]), cy(Y[j]), radius, 0, Math.PI * 2);
                ctx.strokeStyle = `rgba(${r},${g},${b},0.7)`; 
                ctx.lineWidth = LW; 
                ctx.stroke();
            }

            // update progress
            bIdx = end; prog.style.width = ((bIdx / indices.length) * 100).toFixed(1) + '%';
            
            // continue animation or finish
            if (bIdx < indices.length) requestAnimationFrame(drawBatch); 
            else finishRender();
        }

        // start rendering loop
        requestAnimationFrame(drawBatch);
    }, 20);
}

// EQUATION DISPLAY LOGIC
function showEquation(prompt, A, B, filename) {
    // normalise prompt for matching
    const p = prompt.toLowerCase().trim();

    // format numeric parameters for display
    const Af = A.toFixed(4); 
    const Bf = B.toFixed(4);

    // UI elements for equation panel
    const panel = document.getElementById('eqPanel');
    const content = document.getElementById('eqContent');

    // show dataset name
    document.getElementById('eqDatasetLabel').textContent = filename;

    // dataset size
    const N = rawData ? rawData.length : 0;

    // placeholders for equations
    let Xeq = '', Yeq = '', Req = '';

    // SHAPE SELECTION SYSTEM (PROMPT → EQUATION SET )
    // assigns parametric equations (LaTeX)
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
    } else {
        // fallback shape if unknown prompt
        Xeq = `\\cos(k/1000)`; Yeq = `\\sin(k/1000)`; Req = `0.05`;
    }

    // Dataset morph line shown separately — reflects actual N
    const K_used = Math.max(2000, Math.min(80000, Math.round(N * 2 / 100) * 100 || 9830));
    
     // builds descriptive string about dataset + PCA parameters
    const constLine = (p === 'bird')
        ? `\\text{where } A=${Af},\\; B=${Bf} \\text{ (derived from PCA of } \\textit{${filename}}\\text{)},\\; K=${K_used}`
        : `\\text{Dataset: } \\textit{${filename}},\\quad N=${N}\\text{ pts},\\quad K=${K_used},\\quad A=${Af},\\;B=${Bf}`;

     // morphing equation (how dataset distorts base geometry)
    const morphLine = `\\vec{P}(k) = \\vec{P}_{\\text{base}}(k) + \\frac{\\hat{S}(k)-0.5}{6.67}\\begin{pmatrix}\\sin(k/{500})\\\\\\cos(k/{500})\\end{pmatrix},\\quad \\hat{S}=\\mathrm{PC}_1(\\textit{${filename}})`;

     // labels change depending on shape type
    const lab1 = (p === 'fish') ? 'P_{1}(i)' : 'X(k)';
    const lab2 = (p === 'fish') ? 'P_{2}(i)' : 'Y(k)';
    const lab3 = (p === 'fish') ? '\\delta\\text{-morph}' : 'R(k)';

    // final LaTeX assembly
    const latex = `\\[ \\begin{aligned} ${lab1} &= ${Xeq} \\\\[6pt] ${lab2} &= ${Yeq} \\\\[6pt] ${lab3} &= ${Req} \\\\[10pt] &${constLine} \\end{aligned} \\] \\[ \\text{Data morph: } ${morphLine} \\]`;
    
    // display panel
    panel.style.display = 'block'; 
    
    // inject LaTeX text
    content.innerHTML = '';
    const node = document.createElement('div'); node.textContent = latex; content.appendChild(node);
    
    // render math via MathJax
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

// EXPORT
function toggleExportDropdown() {
    // toggle dropdown open/close
    document.getElementById('exportDropdown').classList.toggle('open');
}
// close export dropdown when clicking outside
document.addEventListener('click', function (e) {
    // container of export UI
    const wrap = document.getElementById('exportWrap');
    // if click is outside export area
    if (wrap && !wrap.contains(e.target)) {
        // close dropdown
        document.getElementById('exportDropdown').classList.remove('open');
    }
});

// export canvas as PNG / JPG / SVG
function exportArt(format) {
    document.getElementById('exportDropdown').classList.remove('open');
    const canvas = document.getElementById('artCanvas');
    const promptVal = document.getElementById('promptInput').value.trim() || 'artwork';
    
    // build safe filename
    const filename = `sm-art_${promptVal.replace(/\s+/g, '-').toLowerCase()}_${Date.now()}`;
    if (format === 'png') {
        // temp download link
        const link = document.createElement('a');
        // file name
        link.download = filename + '.png';
        // export canvas as PNG
        link.href = canvas.toDataURL('image/png');
        // trigger download
        link.click();

    } else if (format === 'jpg') {
        // temp canvas for white background
        const tmp = document.createElement('canvas');
        tmp.width = canvas.width; tmp.height = canvas.height;

        // temp context
        const tc = tmp.getContext('2d');
        // white background (JPEG has no alpha) and fill background
        tc.fillStyle = '#ffffff'; tc.fillRect(0, 0, tmp.width, tmp.height);
        tc.drawImage(canvas, 0, 0);


        const link = document.createElement('a');
        link.download = filename + '.jpg';
        // export JPEG
        link.href = tmp.toDataURL('image/jpeg', 1.0);
        link.click();

    } else if (format === 'svg') {
        const w = canvas.width, h = canvas.height;
        // embed PNG inside SVG wrapper
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><image href="${canvas.toDataURL('image/png')}" width="${w}" height="${h}"/></svg>`;
        const link = document.createElement('a');
        link.download = filename + '.svg';
        // blob URL - Binary Large Object: a temporary link to that file
        link.href = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
        link.click();
        // cleanup memory
        setTimeout(() => URL.revokeObjectURL(link.href), 5000);
    }
}

// ZOOM & PAN
// zoom level + pan offsets
let zoomScale = 1, zoomPanX = 0, zoomPanY = 0;
// drag state
let isPanning = false, panStartX = 0, panStartY = 0;
// performance timers
let zoomDebounceTimer = null, zoomIndicatorTimer = null;
// zoom limits
const MIN_ZOOM = 0.5, MAX_ZOOM = 30;

// show zoom percentage UI
function showZoomIndicator() {
    const ind = document.getElementById('zoomIndicator');
    const rst = document.getElementById('zoomResetBtn');
    // update % text
    ind.textContent = Math.round(zoomScale * 100) + '%';


    if (zoomScale !== 1) {
        // show reset button
        rst.style.display = 'block';
        // hide indicator
        ind.style.display = 'none';
    } else {
        rst.style.display = 'none';
        // animate indicator
        ind.classList.add('show');


        clearTimeout(zoomIndicatorTimer);
        // auto-hide
        zoomIndicatorTimer = setTimeout(() => ind.classList.remove('show'), 1200);
    }
}

// reset zoom to default state
function resetZoom() {
    zoomScale = 1; zoomPanX = 0; zoomPanY = 0;
    document.getElementById('zoomResetBtn').style.display = 'none';
    document.getElementById('zoomIndicator').classList.remove('show');
    // re-render artwork
    if (lastRender) redrawAtZoom();
}

// re-render canvas using zoom + pan transforms
// Core: re-draw the stored geometry onto the canvas at current zoom+pan
function redrawAtZoom() {
    // nothing to draw yet
    if (!lastRender) return;

    const { X, Y, R, isFish, fishX1, fishY1, fishX2, fishY2, fishT, FISH_N,
        isButterfly, bflyX, bflyY, bflyR, bflyT, BFLY_N,
        interp, mn, mx, rng, K, pal, density } = lastRender;

    const wrap = document.getElementById('canvasWrap');
    const canvas = document.getElementById('artCanvas');
    // retina scaling
    const DPR = window.devicePixelRatio || 1;


    // Canvas pixel size stays the same as viewport — zoom is handled by shifting coordinate transform
    const W = wrap.clientWidth, H = wrap.clientHeight;
    canvas.width = W * DPR; canvas.height = H * DPR;
    canvas.style.width = W + 'px'; canvas.style.height = H + 'px';

    const ctx = canvas.getContext('2d');
    // clear frame
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Compute base coordinate transform (same as original render)
    let xmn = Infinity, xmx = -Infinity, ymn = Infinity, ymx = -Infinity;
    if (isFish) {
        // scan fish line endpoints
        for (let i = 0; i < FISH_N; i++) {
            if (fishX1[i] < xmn) xmn = fishX1[i]; if (fishX1[i] > xmx) xmx = fishX1[i];
            if (fishY1[i] < ymn) ymn = fishY1[i]; if (fishY1[i] > ymx) ymx = fishY1[i];
            if (fishX2[i] < xmn) xmn = fishX2[i]; if (fishX2[i] > xmx) xmx = fishX2[i];
            if (fishY2[i] < ymn) ymn = fishY2[i]; if (fishY2[i] > ymx) ymx = fishY2[i];
        }

    } else if (isButterfly) {
        // scan butterfly points
        for (let i = 0; i < BFLY_N; i++) {
            if (bflyX[i] < xmn) xmn = bflyX[i]; if (bflyX[i] > xmx) xmx = bflyX[i];
            if (bflyY[i] < ymn) ymn = bflyY[i]; if (bflyY[i] > ymx) ymx = bflyY[i];
        }

    } else {
        // general dataset points
        for (let i = 0; i < K; i++) {
            if (X[i] < xmn) xmn = X[i]; if (X[i] > xmx) xmx = X[i];
            if (Y[i] < ymn) ymn = Y[i]; if (Y[i] > ymx) ymx = Y[i];
        }
    }
    xmn -= 0.1; xmx += 0.1; ymn -= 0.1; ymx += 0.1;

    // padding around drawing
    const pad = 30 * DPR;

    const baseW = canvas.width - pad * 2, baseH = canvas.height - pad * 2;
    const dataW = xmx - xmn, dataH = ymx - ymn;

    // base scaling to fit canvas
    const baseSc = Math.min(baseW / dataW, baseH / dataH);

    const baseOffX = pad + (baseW - baseSc * dataW) / 2;
    const baseOffY = pad + (baseH - baseSc * dataH) / 2;

    // Apply zoom: scale around viewport centre then shift by pan
    const sc = baseSc * zoomScale;
    const offX = zoomPanX * DPR + baseOffX * zoomScale + baseOffX * (1 - zoomScale);
    const offY = zoomPanY * DPR + baseOffY * zoomScale + baseOffY * (1 - zoomScale);

    // coordinate transforms
    function cx(x) { return offX + (x - xmn) * sc; }
    function cy(y) { return offY + (ymx - y) * sc; }

    // Thinner lines at high zoom look sharper
    const LW = Math.max(0.3, 0.5 * DPR / Math.sqrt(zoomScale));

    // render fish / butterfly / generic dataset
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

// main container for the canvas interaction area
const canvasWrapEl = document.getElementById('canvasWrap');

// MOUSE WHEEL ZOOM
canvasWrapEl.addEventListener('wheel', function (e) {
    // stop page scrolling while zooming canvas
    e.preventDefault();
    // ignore if nothing is rendered yet
    if (!lastRender) return;

    // get canvas position on screen
    const rect = canvasWrapEl.getBoundingClientRect();
    // mouse X relative to canvas
    const mouseX = e.clientX - rect.left;
    // mouse Y relative to canvas
    const mouseY = e.clientY - rect.top;

    // zoom in or out depending on scroll direction
    const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;

    // clamp zoom range
    const newScale = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoomScale * factor));
    // skip if no change
    if (newScale === zoomScale) return;

    // keep the point under cursor fixed while zooming
    zoomPanX = mouseX - (mouseX - zoomPanX) * (newScale / zoomScale);
    zoomPanY = mouseY - (mouseY - zoomPanY) * (newScale / zoomScale);

    // apply zoom
    zoomScale = newScale;

    // update UI zoom % display
    showZoomIndicator();

    // debounce redraw for performance during fast scrolling
    clearTimeout(zoomDebounceTimer);
    zoomDebounceTimer = setTimeout(redrawAtZoom, 80);
}, { passive: false });

// MOUSE DRAG PAN
canvasWrapEl.addEventListener('mousedown', function (e) {
    // only left-click and if rendered
    if (!lastRender || e.button !== 0) return;

    // start panning mode
    isPanning = true;
    // store initial offset X
    panStartX = e.clientX - zoomPanX;
    // store initial offset Y
    panStartY = e.clientY - zoomPanY;

    // optional cursor styling
    canvasWrapEl.classList.add('panning');
});

// track mouse movement for panning
window.addEventListener('mousemove', function (e) {
    // only run if dragging
    if (!isPanning) return;

    // update horizontal pan
    zoomPanX = e.clientX - panStartX;
    // update vertical pan
    zoomPanY = e.clientY - panStartY;

    // debounce redraw for smoother dragging
    clearTimeout(zoomDebounceTimer);
    zoomDebounceTimer = setTimeout(redrawAtZoom, 40);
});

// stop panning when mouse released
window.addEventListener('mouseup', function () {
    if (!isPanning) return;
    // stop dragging
    isPanning = false;
    // reset UI state
    canvasWrapEl.classList.remove('panning');
});

// TOUCH SUPPORT
// used for pinch zoom distance tracking
let lastTouchDist = null;
canvasWrapEl.addEventListener('touchstart', function (e) {
    if (e.touches.length === 2) {
        // pinch start: measure distance between two fingers
        lastTouchDist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
    
    } else if (e.touches.length === 1) {
        isPanning = true;
        panStartX = e.touches[0].clientX - zoomPanX;
        panStartY = e.touches[0].clientY - zoomPanY;
    }
}, { passive: true });

// touch move handler (pan or pinch zoom)
canvasWrapEl.addEventListener('touchmove', function (e) {
    // prevent page scroll
    e.preventDefault();

    if (e.touches.length === 2 && lastTouchDist) {
        // PINCH ZOOM
        const dist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
        
        // midpoint of pinch
        const midX = (e.touches[0].clientX + e.touches[1].clientX) / 2 - canvasWrapEl.getBoundingClientRect().left;
        const midY = (e.touches[0].clientY + e.touches[1].clientY) / 2 - canvasWrapEl.getBoundingClientRect().top;
        
        // zoom ratio
        const factor = dist / lastTouchDist;
        const newScale = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoomScale * factor));
        
        // keep pinch center stable
        zoomPanX = midX - (midX - zoomPanX) * (newScale / zoomScale);
        zoomPanY = midY - (midY - zoomPanY) * (newScale / zoomScale);

        // apply zoom
        zoomScale = newScale;

        // update distance
        lastTouchDist = dist;

        showZoomIndicator();

        clearTimeout(zoomDebounceTimer);
        zoomDebounceTimer = setTimeout(redrawAtZoom, 80);

    } else if (e.touches.length === 1 && isPanning) {
        // TOUCH PAN
        zoomPanX = e.touches[0].clientX - panStartX;
        zoomPanY = e.touches[0].clientY - panStartY;
        clearTimeout(zoomDebounceTimer);
        zoomDebounceTimer = setTimeout(redrawAtZoom, 40);
    }
}, { passive: false });

// stop touch interaction
canvasWrapEl.addEventListener('touchend', function () { 
    // reset pinch tracking
    lastTouchDist = null; 
    // stop pan
    isPanning = false; 
});

// DOUBLE CLICK RESET ZOOM
// reset view on double click
canvasWrapEl.addEventListener('dblclick', resetZoom);

// ENSURE TITLE ELEMENT EXISTS
if (!document.getElementById('artTitle')) {
    // create title element
    const t = document.createElement('div'); t.id = 'artTitle';
    // attach to canvas container
    document.getElementById('canvasWrap').appendChild(t);
}

// initialise systems
// load python environment (for data processing)
initPyodide();
// draw default colour palette bar
drawColorbar('magma');

// CHART EXPAND MODAL 
function closeChartModal() {
    // hide modal
    document.getElementById('chartModal').classList.remove('open');


    // reset views for next open
    document.getElementById('chartModalCanvas').style.display = 'block';
    document.getElementById('chartModalTableWrap').style.display = 'none';
}

// CHART MODAL OPEN
function openChartModal(chartType) {

    // safety checks (data must exist)
    if (!rawData && chartType !== 'table') return;
    if (chartType === 'table' && (!csvRows || csvRows.length < 2)) return;

    const modal = document.getElementById('chartModal');
    const canvas = document.getElementById('chartModalCanvas');
    const tableWrap = document.getElementById('chartModalTableWrap');
    const title = document.getElementById('chartModalTitle');
    const metaEl = document.getElementById('chartModalMeta');
    const descEl = document.getElementById('chartModalDesc');

     // toggle correct view
    if (chartType === 'table') {
        canvas.style.display = 'none';
        tableWrap.style.display = 'block';
    } else {
        canvas.style.display = 'block';
        tableWrap.style.display = 'none';
    }

    // TABLE VIEW
    if (chartType === 'table') {
        title.textContent = 'Dataset Preview — ' + (dataVars.filename || 'dataset');

        // column names
        const headers = csvRows[0];
        // data only
        const dataRows = csvRows.slice(1);
        const totalRows = dataRows.length;

        // limit display size
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

    // GRAPH MODES (SIGNAL / HISTOGRAM)
    // Colour palette
    const pal = document.getElementById('paletteSelect').value;
    // Numeric signal
    const raw = rawData;

    // min/max calculation
    let mn = Infinity, mx = -Infinity;
    for (const v of raw) { if (v < mn) mn = v; if (v > mx) mx = v; }
    // avoid divide by zero
    const rng = mx - mn || 1;

    // modal width
    const vw = Math.min(window.innerWidth * 0.80, 1060);
    // retina scaling
    const DPR = window.devicePixelRatio || 1;
    // drawing context
    const ctx = canvas.getContext('2d');

    // SIGNAL PLOT
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


        // HISTOGRAM MODE
        const BINS = 60, bins = new Float32Array(BINS);
        for (const v of raw) bins[Math.min(BINS - 1, Math.floor(((v - mn) / rng) * BINS))]++;
        const bmax = Math.max(...bins);

        ctx.font = `${10 * DPR}px system-ui`; ctx.fillStyle = '#5a5a7a';
        ctx.textAlign = 'right'; ctx.textBaseline = 'middle';

         // draw bars
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

// ESC CLOSE MODAL
document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') closeChartModal();
});
