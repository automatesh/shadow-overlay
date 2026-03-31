const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  claudeStream: (messages) => ipcRenderer.invoke('claude-stream', messages),
  claudeMessage: (messages) => ipcRenderer.invoke('claude-message', messages),
  whisperTranscribe: (audioBuffer) => ipcRenderer.invoke('whisper-transcribe', audioBuffer),
  getConfig: () => ipcRenderer.invoke('get-config'),
  setOpacity: (value) => ipcRenderer.invoke('set-opacity', value),
  requestScreenshot: () => ipcRenderer.invoke('request-screenshot'),

  onScreenshot: (callback) => ipcRenderer.on('screenshot-taken', (_, data) => callback(data)),
  onSttToggle: (callback) => ipcRenderer.on('stt-toggle', () => callback()),
  onClaudeChunk: (callback) => ipcRenderer.on('claude-chunk', (_, chunk) => callback(chunk)),
  onClaudeDone: (callback) => ipcRenderer.on('claude-done', () => callback()),
  onSendTranscript: (callback) => ipcRenderer.on('send-transcript', () => callback()),
  onAutoScreenshot: (callback) => ipcRenderer.on('auto-screenshot', (_, data) => callback(data)),
});
