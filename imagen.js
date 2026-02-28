const fs = require('fs');
const path = require('path');

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const MODEL = 'gemini-2.5-flash-image';
const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

async function generateImage(prompt, outputPath) {
  if (!GEMINI_API_KEY) throw new Error('GEMINI_API_KEY not set in .env');

  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'x-goog-api-key': GEMINI_API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        responseModalities: ['TEXT', 'IMAGE'],
      },
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gemini API error ${res.status}: ${err}`);
  }

  const data = await res.json();
  const parts = data.candidates?.[0]?.content?.parts || [];

  let imagePath = null;
  let textResponse = '';

  for (const part of parts) {
    if (part.inlineData) {
      const ext = part.inlineData.mimeType === 'image/png' ? 'png' : 'jpg';
      const filePath = outputPath || path.join(__dirname, `generated_${Date.now()}.${ext}`);
      fs.writeFileSync(filePath, Buffer.from(part.inlineData.data, 'base64'));
      imagePath = filePath;
    }
    if (part.text) {
      textResponse += part.text;
    }
  }

  return { imagePath, textResponse };
}

module.exports = { generateImage };
