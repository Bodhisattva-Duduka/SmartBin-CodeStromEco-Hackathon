/* script.js - improved AI formatting, stable downscale, static recent thumb */
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
const processingOverlay = document.getElementById('processingOverlay');

let localStream = null;

/* ---------------- utilities ---------------- */
function toast(text, opts = { type: 'ok', timeout: 3000 }) {
  const el = document.createElement('div');
  el.className = 'toast' + (opts.type === 'error' ? ' error' : '');
  el.textContent = text;
  toastWrap.appendChild(el);
  if (opts.timeout) setTimeout(() => el.remove(), opts.timeout);
}
function esc(s) {
  return (s || '').toString().replace(/[&<>"'`]/g, m =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;", "`": "&#96;" })[m]
  );
}
function applyMarkdownFormatting(s) {
    // Bold: **text**
    s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    // Italic: _text_ (optional)
    s = s.replace(/_(.+?)_/g, '<em>$1</em>');
    return s;
  }
function showProcessingOverlay(on = true) {
  processingOverlay.style.display = on ? 'flex' : 'none';
  processingOverlay.setAttribute('aria-hidden', on ? 'false' : 'true');
}

/* ---------------- camera ---------------- */
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

/* ---------------- upload handlers ---------------- */
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

/* ---------------- recent / copy / save ---------------- */
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
  stored.unshift({ id: Date.now(), label, advice, ts: new Date().toISOString(), thumb: 'trashimage.png' });
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

/* ---------------- progress UI ---------------- */
function showUploadProgress(pct) {
  uploadProgress.style.display = pct >= 0 && pct < 100 ? 'block' : 'none';
  progressText.style.display = pct >= 0 && pct < 100 ? 'block' : 'none';
  const w = Math.min(100, Math.round(pct));
  progressBar.style.width = w + '%';
  progressText.textContent = `Uploading… ${w}%`;
}

/* ---------------- network helper ---------------- */
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

/* ---------------- downscale helper (robust) ---------------- */
async function downscaleFile(file, maxWidth = 1200, quality = 0.8) {
  try {
    if (!file.type || !file.type.startsWith('image/')) return file;
    if (file.size < 500 * 1024) return file;

    // create image bitmap where available
    let imgBitmap;
    try {
      imgBitmap = await createImageBitmap(file);
    } catch (e) {
      // fallback to Image element if createImageBitmap is unavailable
      const img = await new Promise((resolve, reject) => {
        const i = new Image();
        i.onload = () => resolve(i);
        i.onerror = reject;
        i.src = URL.createObjectURL(file);
      });
      // draw this image to canvas below
      const ratio = Math.min(1, maxWidth / img.width);
      const w = Math.round(img.width * ratio);
      const h = Math.round(img.height * ratio);
      // create canvas
      let canvas;
      if (typeof OffscreenCanvas !== 'undefined') canvas = new OffscreenCanvas(w, h);
      else { canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h; }
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, w, h);
      if (canvas.convertToBlob) return await canvas.convertToBlob({ type: 'image/jpeg', quality });
      return await new Promise((res) => canvas.toBlob(res, 'image/jpeg', quality));
    }

    const ratio = Math.min(1, maxWidth / imgBitmap.width);
    const w = Math.round(imgBitmap.width * ratio);
    const h = Math.round(imgBitmap.height * ratio);

    let canvas;
    if (typeof OffscreenCanvas !== 'undefined') canvas = new OffscreenCanvas(w, h);
    else { canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h; }
    const ctx = canvas.getContext('2d');
    ctx.drawImage(imgBitmap, 0, 0, w, h);

    if (canvas.convertToBlob) {
      return await canvas.convertToBlob({ type: 'image/jpeg', quality });
    } else {
      return await new Promise((res) => canvas.toBlob(res, 'image/jpeg', quality));
    }
  } catch (e) {
    return file;
  }
}

/* ---------------- AI formatting utils ---------------- */

/* keywords -> emoji helper */
const KEYWORDS = [
  { re: /\b(dispose|disposal|throw away|trash)\b/gi, emoji: '🗑️' },
  { re: /\b(recycle|recycling|recyclable)\b/gi, emoji: '♻️' },
  { re: /\b(step|steps|how to|procedure)\b/gi, emoji: '➡️' },
  { re: /\b(warn|warning|danger|hazard)\b/gi, emoji: '⚠️' },
  { re: /\b(tip|tips|suggestion)\b/gi, emoji: '💡' },
];

/* highlight keywords inside an already escaped string */
function highlightKeywordsEscaped(escapedText) {
    let s = applyMarkdownFormatting(escapedText); // <-- add this line
    KEYWORDS.forEach(k => {
      s = s.replace(k.re, (m) => `${k.emoji} <strong>${m}</strong>`);
    });
    return s;
  }

/* parse raw text into structured blocks */
function parseToBlocks(rawText) {
  if (!rawText) return [];
  const text = rawText.replace(/\r\n/g, '\n').trim();
  const lines = text.split('\n');
  const blocks = [];
  let i = 0;

  while (i < lines.length) {
    let line = lines[i].trim();
    if (!line) { i++; continue; }

    // Markdown heading: "# " or "## ", etc.
    const mdh = line.match(/^#{1,6}\s+(.*)/);
    if (mdh) {
      blocks.push({ type: 'heading', text: mdh[1].trim() });
      i++; continue;
    }

    // Section title terminating with ":" (e.g., "How to recycle:")
    if (/^[A-Za-z0-9 \-]{1,80}:$/.test(line)) {
      blocks.push({ type: 'sectionTitle', text: line.replace(/:$/, '').trim() });
      i++; continue;
    }

    // List detection (ordered or unordered)
    const listMatch = line.match(/^(\d+[\.\)]|\-|\*|•)\s+(.*)/);
    if (listMatch) {
      const items = [];
      const ordered = /^\d+[\.\)]/.test(listMatch[1]);
      while (i < lines.length) {
        const ln = lines[i].trim();
        const m = ln.match(/^(\d+[\.\)]|\-|\*|•)\s+(.*)/);
        if (!m) break;
        let itemText = m[2].trim();
        // gather continuation lines for this item
        let j = i + 1;
        while (j < lines.length) {
          const next = lines[j].trim();
          if (!next) { j++; break; }
          if (next.match(/^(\d+[\.\)]|\-|\*|•)\s+/)) break;
          if (next.match(/^[A-Za-z0-9 \-]{1,80}:$/)) break;
          if (next.match(/^#{1,6}\s+/)) break;
          // continuation line
          itemText += ' ' + next;
          j++;
        }
        items.push(itemText.trim());
        i = j;
      }
      blocks.push({ type: 'list', ordered, items });
      continue;
    }

    // Otherwise paragraph (collect contiguous lines)
    let para = line;
    let j = i + 1;
    while (j < lines.length) {
      const nxt = lines[j].trim();
      if (!nxt) break;
      if (nxt.match(/^(\d+[\.\)]|\-|\*|•)\s+/)) break;
      if (nxt.match(/^[A-Za-z0-9 \-]{1,80}:$/)) break;
      if (nxt.match(/^#{1,6}\s+/)) break;
      para += ' ' + nxt;
      j++;
    }
    blocks.push({ type: 'para', text: para.trim() });
    i = j;
  }

  return blocks;
}

/* render parsed blocks to HTML (uses esc + keyword highlighting) */
function renderBlocks(blocks) {
  if (!blocks || !blocks.length) return '<p>No advice given.</p>';
  const html = [];

  for (const b of blocks) {
    if (b.type === 'heading') {
      const t = highlightKeywordsEscaped(esc(b.text));
      html.push(`<h4>${t}</h4>`);
      continue;
    }
    if (b.type === 'sectionTitle') {
      // choose emoji based on keywords
      let emoji = '';
      if (/\b(recycle|recycling|recyclable)\b/i.test(b.text)) emoji = '♻️';
      else if (/\b(dispose|trash|dispose)\b/i.test(b.text)) emoji = '🗑️';
      else if (/\b(tip|tips)\b/i.test(b.text)) emoji = '💡';
      const t = highlightKeywordsEscaped(esc(b.text));
      html.push(`<div class="section">${emoji} <strong>${t}</strong></div>`);
      continue;
    }
    if (b.type === 'list') {
      const tag = b.ordered ? 'ol' : 'ul';
      const items = b.items.map(it => `<li>${highlightKeywordsEscaped(esc(it))}</li>`).join('');
      html.push(`<${tag}>${items}</${tag}>`);
      continue;
    }
    if (b.type === 'para') {
      // small heuristic: if para is short and looks like a title, render as heading
      if (b.text.length < 70 && /^[A-Z][A-Za-z0-9 ,\-]{0,60}$/.test(b.text) && !/\.$/.test(b.text)) {
        html.push(`<h4>${highlightKeywordsEscaped(esc(b.text))}</h4>`);
      } else {
        html.push(`<p>${highlightKeywordsEscaped(esc(b.text))}</p>`);
      }
      continue;
    }
  }

  return html.join('');
}

/* top-level formatter used by displayResult */
function formatAdvice(text) {
  if (!text) return '<p>No advice provided.</p>';
  // If the text looks like JSON with newline-encoded lists (rare), keep simple fallback
  try {
    // remove repeated blank lines, normalize spacing
    const normalized = text.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
    const blocks = parseToBlocks(normalized);
    return renderBlocks(blocks);
  } catch (e) {
    // fallback plain escape
    return `<p>${esc(text)}</p>`;
  }
}

/* ---------------- main upload/classify handler ---------------- */
async function handleFileBlob(file) {
  let toSend = file;
  try { toSend = await downscaleFile(file, 1200, 0.8); } catch (e) { toSend = file; }

  previewImg.src = URL.createObjectURL(toSend);
  previewImg.style.display = 'block';
  placeholderText.style.display = 'none';
  adviceBox.textContent = '';
  fileMeta.textContent = `File: ${(toSend.name || 'camera.jpg')} • ${(Math.round((toSend.size / 1024)))} KB`;
  confBox.style.display = 'none';
  showUploadProgress(0);

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
    setTimeout(() => showProcessingOverlay(false), 400);
  }
}

/* ---------------- render results ---------------- */
function displayResult(rec) {
  if (!rec) return;
  modelBadge.textContent = `Model: ${rec.usedModel || 'Gemini'}`;
  fileMeta.textContent = `File: ${rec.originalName || rec.filename || 'scan'} • ${new Date(rec.timestamp || Date.now()).toLocaleString()}`;

  // prefer labelText (Gemini-style), else rec.advice or rec.label
  const adviceRaw = rec.labelText || rec.advice || rec.label || 'No text returned';

  // format & inject
  adviceBox.innerHTML = formatAdvice(adviceRaw);

  if (rec.confidence) {
    confBox.style.display = 'flex';
    confBar.style.width = (Math.min(100, Number(rec.confidence) || 0)) + '%';
    confPct.textContent = (Number(rec.confidence) || 0) + '%';
  } else confBox.style.display = 'none';

  addRecentLocalEntry({
    id: rec.id || Date.now(),
    label: rec.label || (adviceRaw.split('\n')[0] || 'result'),
    advice: adviceRaw,
    ts: rec.timestamp || Date.now(),
    thumb: 'trashimage.png' // static thumbnail for all recents
  });
}

/* ---------------- recent helpers (static thumb) ---------------- */
function createItemEl(item) {
  const el = document.createElement('div');
  el.className = 'recent-item';
  el.title = item.label || 'scan';
  el.innerHTML = `<img src="trashimage.png" alt="thumb" class="thumb"><div class="info"><div style="font-weight:600">${esc(item.label || 'scan')}</div><div class="tiny muted">${new Date(item.ts || Date.now()).toLocaleString()}</div></div>`;
  el.addEventListener('click', () => {
    // show saved advice and static preview
    previewImg.src = 'trashimage.png';
    previewImg.style.display = 'block';
    placeholderText.style.display = 'none';
    fileMeta.textContent = item.label || 'scan';
    adviceBox.innerHTML = formatAdvice(item.advice || '');
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

/* ---------------- server history fetch ---------------- */
async function fetchAndRenderHistory() {
  try {
    const r = await fetch('/api/history');
    if (!r.ok) { renderRecentFromLocal(); return; }
    const arr = await r.json();
    if (!Array.isArray(arr) || !arr.length) { renderRecentFromLocal(); return; }
    recentList.innerHTML = '';
    arr.slice().reverse().slice(0, 30).forEach(it => {
      const label = it.label || (it.labelText ? it.labelText.split('\n')[0] : it.originalName) || 'scan';
      recentList.appendChild(createItemEl({ label, advice: it.labelText || it.advice || '', ts: it.timestamp || Date.now(), thumb: 'trashimage.png' }));
    });
  } catch (e) {
    console.warn('history fetch failed', e);
    renderRecentFromLocal();
  }
}

/* ---------------- init ---------------- */
renderRecentFromLocal();
fetchAndRenderHistory();
window.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeCamera(); });
