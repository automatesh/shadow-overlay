const input = document.getElementById('input');
const response = document.getElementById('response');
const transcript = document.getElementById('transcript');
const transcriptArea = document.getElementById('transcript-area');
const status = document.getElementById('status');
const sttBtn = document.getElementById('stt-btn');
const screenshotBtn = document.getElementById('screenshot-btn');

let isRecording = false;
let mediaRecorder = null;
let audioChunks = [];
let recordingInterval = null;
let audioCtxRef = null;
let checkLevelRef = null;
let conversationHistory = [];
let pendingScreenshot = null;
let isStreaming = false;
let fullResponse = '';
let showHistory = false;

// --- Init ---

(async () => {
  const config = await api.getConfig();
  showHistory = config.ui?.showHistory || false;
})();

// --- Claude streaming listeners (register once) ---

api.onClaudeChunk((chunk) => {
  fullResponse += chunk;
  renderResponse();
});

api.onClaudeDone(() => {
  isStreaming = false;
  status.textContent = 'Ready';
  conversationHistory.push({ role: 'assistant', content: fullResponse });
  if (conversationHistory.length > 20) {
    conversationHistory = conversationHistory.slice(-16);
  }
  if (showHistory) renderHistory();
});

function renderResponse() {
  if (showHistory) {
    renderHistory();
  } else {
    response.textContent = fullResponse;
  }
  response.scrollTop = response.scrollHeight;
}

function renderHistory() {
  let html = '';
  for (const msg of conversationHistory) {
    const prefix = msg.role === 'user' ? '> ' : '';
    const text = typeof msg.content === 'string' ? msg.content : '[media]';
    html += prefix + text + '\n\n';
  }
  if (isStreaming) {
    html += fullResponse;
  }
  response.textContent = html;
  response.scrollTop = response.scrollHeight;
}

// --- Send to Claude ---

async function sendToClaude(text, screenshotDataUrl) {
  if (isStreaming) return;

  fullResponse = '';
  if (!showHistory) response.textContent = '';
  status.textContent = 'Thinking...';
  isStreaming = true;

  const messages = buildMessages(text, screenshotDataUrl);
  conversationHistory.push({ role: 'user', content: text });

  await api.claudeStream(messages);
}

// --- Text Input ---

input.addEventListener('keydown', async (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;

    input.value = '';
    const screenshot = pendingScreenshot;
    pendingScreenshot = null;

    await sendToClaude(text, screenshot);
  }

  if (e.key === 'Escape') {
    input.value = '';
    if (!showHistory) response.textContent = '';
    pendingScreenshot = null;
    status.textContent = 'Ready';
  }
});

function buildMessages(text, screenshotDataUrl) {
  const msgs = conversationHistory.map(m => ({
    role: m.role,
    content: m.content,
  }));

  // Include transcript as context if available
  const transcriptText = transcript.textContent.trim();
  let userContent = text;
  if (transcriptText) {
    userContent = `[Транскрипция разговора]\n${transcriptText}\n\n[Мой вопрос]\n${text}`;
  }

  if (screenshotDataUrl) {
    const base64 = screenshotDataUrl.replace(/^data:image\/\w+;base64,/, '');
    msgs.push({
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: 'image/png', data: base64 } },
        { type: 'text', text: userContent },
      ],
    });
  } else {
    msgs.push({ role: 'user', content: userContent });
  }

  return msgs;
}

// --- Screenshot (manual — attach to next message) ---

screenshotBtn.addEventListener('click', async () => {
  status.textContent = 'Taking screenshot...';
  await api.requestScreenshot();
});

api.onScreenshot((dataUrl) => {
  pendingScreenshot = dataUrl;
  status.textContent = 'Screenshot ready. Type question.';
  input.focus();
});

// --- Send transcript without typing (Ctrl+Shift+T) ---

api.onSendTranscript(async () => {
  const transcriptText = transcript.textContent.trim();
  if (!transcriptText) {
    status.textContent = 'No transcript to send';
    return;
  }
  const config = await api.getConfig();
  const prompt = config.claude.transcriptAutoPrompt || 'Ответь на последний вопрос из транскрипции.';
  await sendToClaude(prompt, null);
});

// --- Auto screenshot + send (Ctrl+Shift+G) ---

api.onAutoScreenshot(async (dataUrl) => {
  const config = await api.getConfig();
  const prompt = config.claude.screenshotAutoPrompt || 'Ответь на вопрос на экране.';

  fullResponse = '';
  if (!showHistory) response.textContent = '';
  status.textContent = 'Analyzing screenshot...';
  isStreaming = true;

  const base64 = dataUrl.replace(/^data:image\/\w+;base64,/, '');
  const transcriptText = transcript.textContent.trim();
  let textContent = prompt;
  if (transcriptText) {
    textContent = `[Транскрипция разговора]\n${transcriptText}\n\n${prompt}`;
  }

  const msgs = conversationHistory.map(m => ({ role: m.role, content: m.content }));
  msgs.push({
    role: 'user',
    content: [
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: base64 } },
      { type: 'text', text: textContent },
    ],
  });

  conversationHistory.push({ role: 'user', content: '[screenshot] ' + prompt });

  await api.claudeStream(msgs);
});

// --- STT ---

sttBtn.addEventListener('click', () => toggleSTT());
api.onSttToggle(() => toggleSTT());

async function toggleSTT() {
  if (isRecording) {
    stopRecording();
  } else {
    await startRecording();
  }
}

async function startRecording() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

    const audioCtx = new AudioContext();
    const source = audioCtx.createMediaStreamSource(stream);
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);
    const dataArray = new Uint8Array(analyser.frequencyBinCount);
    let hadSound = false;

    audioCtxRef = audioCtx;
    checkLevelRef = setInterval(() => {
      analyser.getByteFrequencyData(dataArray);
      const avg = dataArray.reduce((a, b) => a + b, 0) / dataArray.length;
      if (avg > 10) hadSound = true;
    }, 200);

    mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
    audioChunks = [];

    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) audioChunks.push(e.data);
    };

    mediaRecorder.onstop = async () => {
      if (!hadSound) {
        audioChunks = [];
        hadSound = false;
        return;
      }
      hadSound = false;

      const blob = new Blob(audioChunks, { type: 'audio/webm' });
      const arrayBuffer = await blob.arrayBuffer();
      const buffer = new Uint8Array(arrayBuffer);

      if (buffer.length < 1000) {
        audioChunks = [];
        return;
      }

      status.textContent = 'Transcribing...';
      const result = await api.whisperTranscribe(Array.from(buffer));

      if (result.text) {
        transcript.textContent += (transcript.textContent ? '\n' : '') + result.text;
        transcript.scrollTop = transcript.scrollHeight;
        status.textContent = 'Transcribed';
      } else if (result.error) {
        status.textContent = 'STT Error: ' + result.error;
      }

      audioChunks = [];
    };

    mediaRecorder.start();
    isRecording = true;
    sttBtn.classList.add('active');
    transcriptArea.classList.add('visible');
    status.textContent = 'Recording...';

    const config = await api.getConfig();
    const chunkMs = (config.whisper.chunkSeconds || 15) * 1000;

    recordingInterval = setInterval(() => {
      if (mediaRecorder && mediaRecorder.state === 'recording') {
        mediaRecorder.stop();
        mediaRecorder.start();
      }
    }, chunkMs);

  } catch (err) {
    status.textContent = 'Mic error: ' + err.message;
  }
}

function stopRecording() {
  if (mediaRecorder && mediaRecorder.state === 'recording') {
    mediaRecorder.stop();
  }
  if (recordingInterval) {
    clearInterval(recordingInterval);
    recordingInterval = null;
  }
  if (checkLevelRef) {
    clearInterval(checkLevelRef);
    checkLevelRef = null;
  }
  if (audioCtxRef) {
    audioCtxRef.close();
    audioCtxRef = null;
  }
  if (mediaRecorder) {
    mediaRecorder.stream.getTracks().forEach(t => t.stop());
  }
  isRecording = false;
  sttBtn.classList.remove('active');
  status.textContent = 'Recording stopped';
}
