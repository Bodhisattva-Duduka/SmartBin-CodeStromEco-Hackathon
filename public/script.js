const app = document.querySelector('.app');
const previewImg = document.getElementById('previewImg');
const placeholderText = document.getElementById('placeholderText');
const uploadInput = document.getElementById('uploadInput');
const uploadBtn = document.getElementById('uploadBtn');
const scanBtn = document.getElementById('scanBtn');
const clearBtn = document.getElementById('clearBtn');
const cameraModal = document.getElementById('cameraModal');
const cameraStream = document.getElementById('cameraStream');
const captureBtn = document.getElementById('captureBtn');
const camCloseBtn = document.getElementById('camCloseBtn');
const uploadProgress = document.getElementById('uploadProgress');
const progressText = document.getElementById('progressText');
const progressBar = uploadProgress.querySelector('i');

const adviceBox = document.getElementById('adviceBox');
const confBox = document.getElementById('confBox');
const confBar = document.getElementById('confBar');
const confPct = document.getElementById('confPct');
const fileMeta = document.getElementById('fileMeta');
const modelBadge = document.getElementById('modelBadge');

const recentList = document.getElementById('recentList');
const toastWrap = document.getElementById('toast');
const copyBtn = document.getElementById('copyBtn');
const rescanBtn = document.getElementById('rescanBtn');
const saveLocalBtn = document.getElementById('saveLocalBtn');
const historyBtn = document.getElementById('historyBtn');
const loginBtn = document.getElementById('loginBtn');
const processingOverlay = document.getElementById('processingOverlay');

let localStream = null;

/* ===== utilities ===== */
function toast(text, opts = { type: 'ok', timeout: 3000 }) {
    const el = document.createElement('div');
    el.className = 'toast' + (opts.type === 'error' ? ' error' : '');
    el.textContent = text;
    toastWrap.appendChild(el);
    if (opts.timeout) setTimeout(() => el.remove(), opts.timeout);
}
function esc(s) { return (s || '').toString().replace(/[&<>"'`]/g, m => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;", "`": "&#96;" })[m]); }

function showProcessingOverlay(on = true) {
    processingOverlay.style.display = on ? 'flex' : 'none';
    processingOverlay.setAttribute('aria-hidden', on ? 'false' : 'true');
}

/* ===== camera ===== */
scanBtn.addEventListener('click', async () => {
    cameraModal.style.display = 'flex';
    cameraModal.setAttribute('aria-hidden', 'false');
    try {
        localStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
        cameraStream.srcObject = localStream;
    } catch (err) {
        toast('Camera permission denied or not available', { type: 'error' });
        closeCamera();
    }
});
camCloseBtn.addEventListener('click', closeCamera);
function closeCamera() {
    cameraModal.style.display = 'none';
    cameraModal.setAttribute('aria-hidden', 'true');
    if (localStream) {
        localStream.getTracks().forEach(t => t.stop());
        localStream = null;
    }
}
captureBtn.addEventListener('click', () => {
    const video = cameraStream;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth || 1280;
    canvas.height = video.videoHeight || 720;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(blob => {
        if (blob) {
            closeCamera();
            handleFileBlob(blob);
        }
    }, 'image/jpeg', 0.85);
});

/* ===== upload handlers ===== */
uploadBtn.addEventListener('click', () => uploadInput.click());
uploadInput.addEventListener('change', (e) => {
    const f = e.target.files && e.target.files[0];
    if (f) handleFileBlob(f);
});
clearBtn.addEventListener('click', () => {
    previewImg.style.display = 'none';
    placeholderText.style.display = 'block';
    adviceBox.textContent = 'No advice yet. Upload or scan an image to get step-by-step recycling & disposal instructions.';
    fileMeta.textContent = 'No image analyzed yet';
    confBox.style.display = 'none';
    uploadInput.value = '';
});

/* rescan/save/copy/history */
rescanBtn.addEventListener('click', () => {
    if (previewImg.src) {
        fetch(previewImg.src).then(r => r.blob()).then(blob => handleFileBlob(blob));
    } else toast('There is no image to rescan', { type: 'error' });
});
saveLocalBtn.addEventListener('click', () => {
    const advice = adviceBox.textContent || '';
    if (!advice || advice.includes('No advice yet')) return toast('Nothing to save', { type: 'error' });
    const label = fileMeta.textContent || 'scan';
    const stored = JSON.parse(localStorage.getItem('smartbin_history') || '[]');
    stored.unshift({ id: Date.now(), label, advice, ts: new Date().toISOString(), thumb: previewImg.src });
    localStorage.setItem('smartbin_history', JSON.stringify(stored.slice(0, 50)));
    toast('Saved locally');
    renderRecentFromLocal();
});
copyBtn.addEventListener('click', async () => {
    const text = adviceBox.innerText || '';
    if (!text) return toast('No advice to copy', { type: 'error' });
    try { await navigator.clipboard.writeText(text); toast('Advice copied to clipboard'); }
    catch (e) { toast('Copy failed', { type: 'error' }); }
});
historyBtn.addEventListener('click', () => recentList.scrollIntoView({ behavior: 'smooth' }));

/* ===== progress UI ===== */
function showUploadProgress(pct) {
    uploadProgress.style.display = pct >= 0 && pct < 100 ? 'block' : 'none';
    progressText.style.display = pct >= 0 && pct < 100 ? 'block' : 'none';
    const w = Math.min(100, Math.round(pct));
    progressBar.style.width = w + '%';
    progressText.textContent = `Uploading… ${w}%`;
}

/* ===== network helpers (post with upload progress) ===== */
function postWithProgress(url, formData, onProgress) {
    return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', url);
        xhr.timeout = 120000;
        xhr.upload.onprogress = (ev) => {
            if (ev.lengthComputable && onProgress) onProgress(ev.loaded / ev.total);
        };
        xhr.onload = () => {
            try { const data = JSON.parse(xhr.responseText || '{}'); resolve({ ok: xhr.status >= 200 && xhr.status < 300, status: xhr.status, data }); }
            catch (e) { reject(e); }
        };
        xhr.onerror = () => reject(new Error('Network error'));
        xhr.ontimeout = () => reject(new Error('Timeout'));
        xhr.send(formData);
    });
}

/* ===== downscale helper (uses OffscreenCanvas where available) ===== */
async function downscaleFile(file, maxWidth = 1200, quality = 0.8) {
    try {
        if (!file.type.startsWith('image/')) return file;
        if (file.size < 500 * 1024) return file;
        // prefer ImageBitmap/offscreen
        const img = await createImageBitmap(file);
        const ratio = Math.min(1, maxWidth / img.width);
        const w = Math.round(img.width * ratio);
        const h = Math.round(img.height * ratio);
        // OffscreenCanvas in supported browsers; fallback to regular canvas
        let canvas;
        if (typeof OffscreenCanvas !== 'undefined') canvas = new OffscreenCanvas(w, h);
        else { canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h; }
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality });
        // attach name for formData
        Object.defineProperty(blob, 'name', { value: file.name || 'upload.jpg' });
        return blob;
    } catch (e) {
        return file;
    }
}

/* ===== main handler - toggles processing overlay ===== */
async function handleFileBlob(file) {
    // downscale if large
    let toSend = file;
    try { toSend = await downscaleFile(file, 1200, 0.8); } catch (e) { toSend = file; }

    // preview
    previewImg.src = URL.createObjectURL(toSend);
    previewImg.style.display = 'block';
    placeholderText.style.display = 'none';
    adviceBox.textContent = '';
    fileMeta.textContent = `File: ${(toSend.name || 'camera.jpg')} • ${(Math.round((toSend.size / 1024)))} KB`;
    confBox.style.display = 'none';
    showUploadProgress(0);

    // show overlay
    showProcessingOverlay(true);

    const fd = new FormData();
    fd.append('image', toSend, (toSend.name || 'upload.jpg'));

    try {
        const result = await postWithProgress('/api/classify', fd, (p) => showUploadProgress(p * 100));
        showUploadProgress(100);

        if (!result.ok || !result.data || !result.data.success) {
            console.error('classify error payload:', result);
            toast('Classification failed', { type: 'error', timeout: 4000 });
            adviceBox.textContent = result.data?.error || `HTTP ${result.status}`;
            // show details in recent area
            modelBadge.textContent = `Model: Error`;
            return;
        }

        const rec = result.data.record || {};
        displayResult(rec);
        await fetchAndRenderHistory();
        toast('Classification complete');

    } catch (err) {
        console.error(err);
        toast('Upload failed or server error', { type: 'error', timeout: 4000 });
        adviceBox.textContent = 'Failed to contact server. Check logs.';
    } finally {
        setTimeout(() => { showUploadProgress(-1); }, 700);
        // Hide overlay after small delay so user can perceive success
        setTimeout(() => showProcessingOverlay(false), 400);
    }
}

/* ===== render results ===== */
function displayResult(rec) {
    if (!rec) return;
    modelBadge.textContent = `Model: ${rec.usedModel || 'Gemini'}`;
    fileMeta.textContent = `File: ${rec.originalName || rec.filename || 'scan'} • ${new Date(rec.timestamp || Date.now()).toLocaleString()}`;
    const advice = rec.labelText || rec.advice || rec.label || 'No text returned';
    adviceBox.innerHTML = esc(advice);
    if (rec.confidence) {
        confBox.style.display = 'flex';
        confBar.style.width = (Math.min(100, Number(rec.confidence) || 0)) + '%';
        confPct.textContent = (Number(rec.confidence) || 0) + '%';
    } else confBox.style.display = 'none';
    addRecentLocalEntry({
        id: rec.id || Date.now(),
        label: rec.label || (advice.split('\n')[0] || 'result'),
        advice,
        ts: rec.timestamp || Date.now(),
        thumb: previewImg.src
    });
}

/* recent helpers */
function createItemEl(item) {
    const el = document.createElement('div');
    el.className = 'recent-item';
    el.title = item.label || 'scan';
    el.innerHTML = `<img src="${esc(item.thumb || '')}" alt="thumb"><div class="info"><div style="font-weight:600">${esc(item.label || 'scan')}</div><div class="tiny muted">${new Date(item.ts || Date.now()).toLocaleString()}</div></div>`;
    el.addEventListener('click', () => {
        previewImg.src = item.thumb;
        previewImg.style.display = 'block';
        placeholderText.style.display = 'none';
        fileMeta.textContent = item.label;
        adviceBox.innerHTML = esc(item.advice || '');
        toast('Loaded from recent');
    });
    return el;
}
function renderRecentFromLocal() {
    const stored = JSON.parse(localStorage.getItem('smartbin_history') || '[]');
    recentList.innerHTML = '';
    if (!stored || !stored.length) { recentList.innerHTML = '<div class="tiny muted">No recent scans yet.</div>'; return; }
    stored.slice(0, 25).forEach(s => recentList.appendChild(createItemEl(s)));
}
function addRecentLocalEntry(item) {
    const stored = JSON.parse(localStorage.getItem('smartbin_history') || '[]');
    stored.unshift(item);
    localStorage.setItem('smartbin_history', JSON.stringify(stored.slice(0, 50)));
    renderRecentFromLocal();
}

/* server history fetch */
async function fetchAndRenderHistory() {
    try {
        const r = await fetch('/api/history');
        if (!r.ok) { renderRecentFromLocal(); return; }
        const arr = await r.json();
        if (!Array.isArray(arr) || !arr.length) { renderRecentFromLocal(); return; }
        recentList.innerHTML = '';
        arr.slice().reverse().slice(0, 30).forEach(it => {
            const thumb = it.thumb || it.thumbnail || '';
            const label = it.label || (it.labelText ? it.labelText.split('\n')[0] : it.originalName) || 'scan';
            recentList.appendChild(createItemEl({ thumb, label, advice: it.labelText || it.advice || '', ts: it.timestamp || Date.now() }));
        });
    } catch (e) {
        console.warn('history fetch failed', e);
        renderRecentFromLocal();
    }
}

/* initial render */
renderRecentFromLocal();
fetchAndRenderHistory();

/* keyboard escape to close camera */
window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeCamera();
});