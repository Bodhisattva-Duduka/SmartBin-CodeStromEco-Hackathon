// routes/classify.js
const express = require("express");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const { v4: uuidv4 } = require("uuid");
const axios = require("axios");

const router = express.Router();
const upload = multer({ dest: "uploads/", limits: { fileSize: 12 * 1024 * 1024 } }); // 12MB limit

const DB_PATH = path.join(__dirname, "..", "data", "db.json");
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";

function readDB() {
  try {
    if (!fs.existsSync(DB_PATH)) return [];
    return JSON.parse(fs.readFileSync(DB_PATH, "utf8") || "[]");
  } catch (e) {
    console.error("readDB error:", e);
    return [];
  }
}
function writeDB(arr) {
  try {
    fs.writeFileSync(DB_PATH, JSON.stringify(arr, null, 2), "utf8");
  } catch (e) {
    console.error("writeDB error:", e);
  }
}

function toBase64(buffer) {
  return buffer.toString("base64");
}

router.post("/classify", upload.single("image"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ success: false, error: "No file uploaded (field name = image)" });
  }
  if (!GEMINI_API_KEY) {
    return res.status(500).json({ success: false, error: "Missing GEMINI_API_KEY in environment" });
  }

  const imagePath = path.resolve(req.file.path);

  console.log("--- classify request ---");
  console.log("file info:", {
    originalname: req.file.originalname,
    filename: req.file.filename,
    path: req.file.path,
    mimetype: req.file.mimetype,
    size: req.file.size,
  });

  try {
    const buffer = fs.readFileSync(imagePath);
    const b64 = toBase64(buffer);

    const promptText = `Identify this trash (brief): what is it? Also explain:
1) How to safely dispose it
2) How to recycle it (step-by-step, short)`;

    const payload = {
      contents: [
        {
          parts: [
            {
              inline_data: {
                mime_type: req.file.mimetype || "image/jpeg",
                data: b64,
              },
            },
            {
              text: promptText,
            },
          ],
        },
      ],
      // you can add additional generation params here if needed
      // e.g. temperature, maxOutputTokens, safety settings (see docs)
    };

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;

    const geminiResp = await axios.post(url, payload, {
      headers: { "Content-Type": "application/json" },
      timeout: 120000, // 2 minutes
    });

    // parse Gemini response robustly
    const candidate = geminiResp.data?.candidates?.[0] || null;
    let answer = "";
    if (candidate && Array.isArray(candidate.content?.parts)) {
      answer = candidate.content.parts.map(p => p.text || "").join("\n").trim();
    } else if (typeof geminiResp.data === "string") {
      answer = geminiResp.data;
    } else {
      answer = JSON.stringify(geminiResp.data).slice(0, 2000);
    }

    const record = {
      id: uuidv4(),
      timestamp: new Date().toISOString(),
      originalName: req.file.originalname || req.file.filename,
      filename: req.file.filename,
      labelText: answer,
      usedModel: `Gemini(${GEMINI_MODEL})`,
    };

    // persist locally for history (optional)
    const db = readDB();
    db.push(record);
    writeDB(db);

    // remove temp upload
    try { fs.unlinkSync(imagePath); } catch (e) { console.warn("unlink failed:", e.message); }

    return res.json({ success: true, record });
  } catch (err) {
    console.error("Gemini / classify error:", err.response?.data || err.message || err);
    try { fs.unlinkSync(imagePath); } catch (e) {}
    return res.status(500).json({
      success: false,
      error: "Gemini request failed",
      details: err.response?.data || err.message || String(err)
    });
  }
});

router.get("/history", (req, res) => {
  res.json(readDB());
});

module.exports = router;
