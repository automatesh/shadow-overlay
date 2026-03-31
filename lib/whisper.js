const OpenAI = require('openai');
const fs = require('fs');
const path = require('path');
const os = require('os');

let client = null;

function getClient(config) {
  if (!client) {
    client = new OpenAI({ apiKey: config.apiKey });
  }
  return client;
}

async function transcribe(config, audioBuffer) {
  if (!config.apiKey) {
    return { error: 'Whisper API key not set in config.json' };
  }

  const openai = getClient(config);
  const tmpPath = path.join(os.tmpdir(), `ghost-overlay-${Date.now()}.webm`);

  try {
    fs.writeFileSync(tmpPath, Buffer.from(audioBuffer));

    const file = fs.createReadStream(tmpPath);
    file.path = tmpPath;

    const response = await openai.audio.transcriptions.create({
      file: file,
      model: config.model,
      language: config.language || 'ru',
    });

    return { text: response.text };
  } catch (err) {
    return { error: err.message };
  } finally {
    try { fs.unlinkSync(tmpPath); } catch {}
  }
}

module.exports = { transcribe };
