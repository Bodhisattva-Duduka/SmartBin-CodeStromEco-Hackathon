// routes/classify.js (retry + clearer logging)
const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');

const router = express.Router();
const upload = multer({ dest: 'uploads/', limits: { fileSize: 5 * 1024 * 1024 } });

const HF_API_KEY = process.env.HF_API_KEY || '';
// primary model (your preferred). If it returns 404, we will try fallback models.
const HF_MODEL_CANDIDATES = [
  'prithivMLmods/Recycling-Net-11',       // your chosen model (may be private)
  'ysfad/mae-waste-classifier',          // fallback waste model (public)
  'google/vit-base-patch16-224'          // generic public image-classification (test)
];

const DB_PATH = path.join(__dirname, '..', 'data', 'db.json');

const TIP_MAP = {
  plastic: 'Remove caps & rinse before recycling if required.',
  paper: 'Keep dry and flatten before recycling.',
  glass: 'Rinse and separate lids; handle with care.',
  metal: 'Empty & rinse; recycle with other metals.',
  organic: 'Compost if possible; do not mix with plastics.',
  battery: 'Do not dispose in regular trash — take to hazardous collection.',
  unknown: 'Check local disposal guidelines.'
};

function readDB() {
  try {
    if (!fs.existsSync(DB_PATH)) return [];
    const raw = fs.readFileSync(DB_PATH, 'utf8');
    return JSON.parse(raw || '[]');
  } catch (e) {
    console.error('readDB error:', e);
    return [];
  }
}
function writeDB(arr) {
  try {
    fs.writeFileSync(DB_PATH, JSON.stringify(arr, null, 2), 'utf8');
  } catch (e) {
    console.error('writeDB error:', e);
    throw e;
  }
}

router.post('/classify', upload.single('image'), async (req, res) => {
  if (!req.file) return res.status(400).json({ success: false, error: 'No file uploaded (field name must be "image")' });
  if (!HF_API_KEY) return res.status(500).json({ success: false, error: 'Server missing HF_API_KEY. Add it to .env and restart server.' });

  console.log('--- classify request ---');
  console.log('file info:', {
    originalname: req.file.originalname,
    filename: req.file.filename,
    path: req.file.path,
    mimetype: req.file.mimetype,
    size: req.file.size
  });
  console.log('HF API key present?', !!HF_API_KEY);

  const imagePath = path.resolve(req.file.path);
  const imageBuffer = fs.readFileSync(imagePath);

  let lastError = null;
  let hfData = null;
  let usedModel = null;

  for (const modelSlug of HF_MODEL_CANDIDATES) {
    const url = `https://api-inference.huggingface.co/models/${modelSlug}`;
    console.log('Trying HF model:', modelSlug);
    try {
      const hfResp = await axios.post(url, imageBuffer, {
        headers: {
          Authorization: `Bearer ${HF_API_KEY}`,
          'Content-Type': 'application/octet-stream'
        },
        timeout: 60000
      });
      // success
      console.log('HF success:', modelSlug, 'status', hfResp.status);
      hfData = hfResp.data;
      usedModel = modelSlug;
      break;
    } catch (err) {
      lastError = err;
      if (err.response) {
        console.warn(`HF model ${modelSlug} responded with status ${err.response.status}`);
        console.warn('HF response data:', err.response.data);
        // if 404 -> try next model; otherwise for 401/403/429/500 you might want to stop or try next depending on policy
        if (err.response.status === 404) {
          // try next candidate
          continue;
        } else {
          // for other statuses, break and report
          break;
        }
      } else {
        console.error('HF request error (no response):', err.message);
        break;
      }
    }
  }

  try {
    if (!hfData) {
      // no model returned successful prediction
      // give informative error including last HF response if available
      if (lastError && lastError.response) {
        const status = lastError.response.status;
        const hfDetails = lastError.response.data;
        return res.status(500).json({ success: false, error: `Hugging Face returned status ${status}`, details: hfDetails, triedModels: HF_MODEL_CANDIDATES });
      } else {
        return res.status(500).json({ success: false, error: 'No response from Hugging Face', triedModels: HF_MODEL_CANDIDATES });
      }
    }

    // parse HF output (typical: array of {label,score})
    let top = { label: 'unknown', score: 0 };
    if (Array.isArray(hfData) && hfData.length) top = hfData.sort((a, b) => b.score - a.score)[0];
    else if (hfData && hfData.error) throw new Error('HF error: ' + JSON.stringify(hfData));

    const record = {
      id: uuidv4(),
      timestamp: new Date().toISOString(),
      originalName: req.file.originalname || req.file.filename,
      filename: req.file.filename,
      label: top.label || 'unknown',
      confidence: typeof top.score === 'number' ? (top.score * 100).toFixed(2) : null,
      tip: TIP_MAP[(top.label || '').toLowerCase()] || TIP_MAP.unknown,
      usedModel
    };

    const db = readDB();
    db.push(record);
    writeDB(db);

    try { fs.unlinkSync(imagePath); } catch (e) { console.warn('could not delete temp file:', e.message); }

    return res.json({ success: true, record });

  } catch (err) {
    console.error('final parse/save error:', err.response?.data || err.message || err);
    return res.status(500).json({ success: false, error: err.message || 'Processing failed', details: err.response?.data || null });
  } finally {
    console.log('--- classify request finished ---');
  }
});

router.get('/history', (req, res) => {
  const db = readDB();
  res.json(db);
});

module.exports = router;
