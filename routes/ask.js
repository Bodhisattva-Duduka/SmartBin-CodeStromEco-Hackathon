// routes/ask.js
const express = require('express');
const axios = require('axios');
const router = express.Router();

const GEMINI_KEY = process.env.GEMINI_API_KEY || '';

router.post('/ask', async (req, res) => {
  try {
    const { question, input } = req.body;
    const prompt = question || input;
    if (!prompt) return res.status(400).json({ error: 'No question provided' });

    // Basic Gemini call (adjust model name if needed)
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${encodeURIComponent(GEMINI_KEY)}`;

    const body = { contents: [{ parts: [{ text: prompt }] }] };

    const r = await axios.post(url, body, { headers: { 'Content-Type': 'application/json' } });
    const answer = r.data?.candidates?.[0]?.content?.parts?.[0]?.text || 'No answer';
    res.json({ answer });
  } catch (err) {
    console.error('ask error:', err.response?.data || err.message);
    res.status(500).json({ error: 'AI request failed' });
  }
});

module.exports = router;
