// server.js
require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();

// make sure uploads and data exist
const uploadsDir = path.join(__dirname, 'uploads');
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
const dbPath = path.join(dataDir, 'db.json');
if (!fs.existsSync(dbPath)) fs.writeFileSync(dbPath, '[]', 'utf8');

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// serve static frontend
app.use(express.static(path.join(__dirname, 'public')));

// routes (mounted under /api)
app.use('/api', require('./routes/classify')); // POST /api/classify, GET /api/history
app.use('/api', require('./routes/ask'));      // POST /api/ask  (Gemini)

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running: http://localhost:${PORT}`));
