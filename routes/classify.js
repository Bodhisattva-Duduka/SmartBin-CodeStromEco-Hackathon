// routes/classify.js
const express = require("express");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const { v4: uuidv4 } = require("uuid");
const { Client } = require("@gradio/client"); // ✅ use gradio client

const router = express.Router();
const upload = multer({ dest: "uploads/", limits: { fileSize: 5 * 1024 * 1024 } });

const DB_PATH = path.join(__dirname, "..", "data", "db.json");

const TIP_MAP = {
  plastic: "Remove caps & rinse before recycling if required.",
  paper: "Keep dry and flatten before recycling.",
  glass: "Rinse and separate lids; handle with care.",
  metal: "Empty & rinse; recycle with other metals.",
  organic: "Compost if possible; do not mix with plastics.",
  battery: "Do not dispose in regular trash — take to hazardous collection.",
  unknown: "Check local disposal guidelines.",
};

function readDB() {
  try {
    if (!fs.existsSync(DB_PATH)) return [];
    const raw = fs.readFileSync(DB_PATH, "utf8");
    return JSON.parse(raw || "[]");
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
    throw e;
  }
}

router.post("/classify", upload.single("image"), async (req, res) => {
  if (!req.file)
    return res
      .status(400)
      .json({ success: false, error: 'No file uploaded (field name must be "image")' });

  console.log("--- classify request ---");
  console.log("file info:", {
    originalname: req.file.originalname,
    filename: req.file.filename,
    path: req.file.path,
    mimetype: req.file.mimetype,
    size: req.file.size,
  });

  const imagePath = path.resolve(req.file.path);
  const imageBuffer = fs.readFileSync(imagePath);

  try {
    // ✅ Connect to your HF Space
    const client = await Client.connect("Bodhisattva-Duduka/RecyclingNetSpace");

    // Call the Gradio /predict endpoint
    const result = await client.predict("/predict", {
      image: new Blob([imageBuffer]),
    });

    console.log("Space response:", result.data);

    let label = "unknown";
    let confidence = null;

    if (Array.isArray(result.data) && result.data.length > 0) {
      // If model returns array of {label, confidence}
      const top = result.data[0];
      label = top.label || "unknown";
      confidence = top.confidence
        ? (top.confidence * 100).toFixed(2)
        : null;
    } else if (typeof result.data === "string") {
      // If model returns just a string label
      label = result.data;
    }

    const record = {
      id: uuidv4(),
      timestamp: new Date().toISOString(),
      originalName: req.file.originalname || req.file.filename,
      filename: req.file.filename,
      label,
      confidence,
      tip: TIP_MAP[label.toLowerCase()] || TIP_MAP.unknown,
      usedModel: "Bodhisattva-Duduka/RecyclingNetSpace",
    };

    const db = readDB();
    db.push(record);
    writeDB(db);

    try {
      fs.unlinkSync(imagePath);
    } catch (e) {
      console.warn("could not delete temp file:", e.message);
    }

    return res.json({ success: true, record });
  } catch (err) {
    console.error("Error calling Space:", err.message || err);
    return res.status(500).json({
      success: false,
      error: err.message || "Processing failed",
    });
  } finally {
    console.log("--- classify request finished ---");
  }
});

router.get("/history", (req, res) => {
  const db = readDB();
  res.json(db);
});

module.exports = router;
