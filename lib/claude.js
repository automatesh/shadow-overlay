const Anthropic = require('@anthropic-ai/sdk');
const fs = require('fs');
const path = require('path');

let client = null;
let profileContext = null;

function getClient(config) {
  if (!client) {
    client = new Anthropic({
      apiKey: config.apiKey,
      baseURL: config.baseUrl,
    });
  }
  return client;
}

function loadProfile(config) {
  if (profileContext !== null) return profileContext;

  const profileDir = config.profileDir;
  if (!profileDir) {
    profileContext = '';
    return profileContext;
  }

  const fullPath = path.isAbsolute(profileDir)
    ? profileDir
    : path.join(__dirname, '..', profileDir);

  if (!fs.existsSync(fullPath)) {
    profileContext = '';
    return profileContext;
  }

  const files = fs.readdirSync(fullPath).filter(f =>
    f.endsWith('.md') || f.endsWith('.txt')
  );

  if (files.length === 0) {
    profileContext = '';
    return profileContext;
  }

  const docs = files.map(f => {
    const content = fs.readFileSync(path.join(fullPath, f), 'utf8');
    return `--- ${f} ---\n${content}`;
  });

  profileContext = docs.join('\n\n');
  console.log(`[Claude] Loaded ${files.length} profile documents: ${files.join(', ')}`);
  return profileContext;
}

function buildSystemPrompt(config) {
  const profile = loadProfile(config);
  let prompt = config.systemPrompt;
  if (profile) {
    prompt += `\n\n[Загруженные документы]\n${profile}`;
  }
  return prompt;
}

async function claudeMessage(config, messages) {
  const anthropic = getClient(config);
  const response = await anthropic.messages.create({
    model: config.model,
    max_tokens: 1024,
    system: buildSystemPrompt(config),
    messages,
  });
  return response.content[0].text;
}

async function claudeStream(config, messages, onChunk) {
  const anthropic = getClient(config);
  const stream = await anthropic.messages.stream({
    model: config.model,
    max_tokens: 1024,
    system: buildSystemPrompt(config),
    messages,
  });

  for await (const event of stream) {
    if (event.type === 'content_block_delta' && event.delta?.text) {
      onChunk(event.delta.text);
    }
  }
}

module.exports = { claudeMessage, claudeStream };
