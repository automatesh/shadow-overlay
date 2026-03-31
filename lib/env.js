const fs = require('fs');

function loadEnvFile(envPath) {
  if (!envPath || !fs.existsSync(envPath)) return;

  const content = fs.readFileSync(envPath, 'utf8');
  const lines = content.split(/\r?\n/);

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const eq = line.indexOf('=');
    if (eq <= 0) continue;

    const key = line.slice(0, eq).trim();
    if (!key) continue;

    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    value = value.replace(/\\n/g, '\n');

    // Do not override already defined shell-level vars.
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

function applyEnvOverrides(config) {
  if (!config || typeof config !== 'object') return config;

  config.claude = config.claude || {};
  config.whisper = config.whisper || {};

  if (process.env.CLAUDE_CODE_SETUP_TOKEN) {
    config.claude.apiKey = process.env.CLAUDE_CODE_SETUP_TOKEN;
  }
  if (process.env.CLAUDE_PROXY_BASE_URL) {
    config.claude.baseUrl = process.env.CLAUDE_PROXY_BASE_URL;
  }
  if (process.env.CLAUDE_MODEL) {
    config.claude.model = process.env.CLAUDE_MODEL;
  }
  if (process.env.CLAUDE_SYSTEM_PROMPT) {
    config.claude.systemPrompt = process.env.CLAUDE_SYSTEM_PROMPT;
  }

  if (process.env.WHISPER_API_KEY) {
    config.whisper.apiKey = process.env.WHISPER_API_KEY;
  }
  if (process.env.WHISPER_MODEL) {
    config.whisper.model = process.env.WHISPER_MODEL;
  }
  if (process.env.WHISPER_LANGUAGE) {
    config.whisper.language = process.env.WHISPER_LANGUAGE;
  }
  if (process.env.WHISPER_CHUNK_SECONDS) {
    const n = Number(process.env.WHISPER_CHUNK_SECONDS);
    if (Number.isFinite(n) && n > 0) {
      config.whisper.chunkSeconds = n;
    }
  }

  return config;
}

module.exports = { loadEnvFile, applyEnvOverrides };
