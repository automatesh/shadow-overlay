const { app, BrowserWindow, globalShortcut, ipcMain, desktopCapturer, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const { loadEnvFile, applyEnvOverrides } = require('./lib/env');

loadEnvFile(path.join(__dirname, '.env'));

const config = applyEnvOverrides(
  JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'))
);

let mainWindow = null;
let isVisible = true;

function createWindow() {
  const { width, height, opacity } = config.window;
  const display = screen.getPrimaryDisplay();
  const x = display.bounds.width - width - 20;
  const y = 20;

  mainWindow = new BrowserWindow({
    width,
    height,
    x,
    y,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: true,
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.setContentProtection(true);
  mainWindow.setOpacity(opacity);
  mainWindow.setAlwaysOnTop(true, 'screen-saver');
  mainWindow.setVisibleOnAllWorkspaces(true);

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

function registerShortcuts() {
  globalShortcut.register(config.hotkeys.toggle, () => {
    if (isVisible) {
      mainWindow.hide();
    } else {
      mainWindow.show();
    }
    isVisible = !isVisible;
  });

  globalShortcut.register(config.hotkeys.screenshot, async () => {
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: 1920, height: 1080 },
    });
    if (sources.length > 0) {
      const screenshot = sources[0].thumbnail.toDataURL();
      mainWindow.webContents.send('screenshot-taken', screenshot);
    }
  });

  globalShortcut.register(config.hotkeys.sttToggle, () => {
    mainWindow.webContents.send('stt-toggle');
  });

  // Send transcript without typing
  if (config.hotkeys.sendTranscript) {
    globalShortcut.register(config.hotkeys.sendTranscript, () => {
      mainWindow.webContents.send('send-transcript');
    });
  }

  // Screenshot + auto-send to Claude
  if (config.hotkeys.sendScreenshot) {
    globalShortcut.register(config.hotkeys.sendScreenshot, async () => {
      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: { width: 1920, height: 1080 },
      });
      if (sources.length > 0) {
        const screenshot = sources[0].thumbnail.toDataURL();
        mainWindow.webContents.send('auto-screenshot', screenshot);
      }
    });
  }
}

// IPC: send message to Claude
ipcMain.handle('claude-message', async (_, messages) => {
  const { claudeMessage } = require('./lib/claude');
  return await claudeMessage(config.claude, messages);
});

// IPC: stream message to Claude
ipcMain.handle('claude-stream', async (event, messages) => {
  const { claudeStream } = require('./lib/claude');
  await claudeStream(config.claude, messages, (chunk) => {
    mainWindow.webContents.send('claude-chunk', chunk);
  });
  mainWindow.webContents.send('claude-done');
});

// IPC: transcribe audio
ipcMain.handle('whisper-transcribe', async (_, audioBuffer) => {
  const { transcribe } = require('./lib/whisper');
  return await transcribe(config.whisper, audioBuffer);
});

// IPC: request screenshot from renderer
ipcMain.handle('request-screenshot', async () => {
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: 1920, height: 1080 },
  });
  if (sources.length > 0) {
    const screenshot = sources[0].thumbnail.toDataURL();
    mainWindow.webContents.send('screenshot-taken', screenshot);
  }
});

// IPC: get config
ipcMain.handle('get-config', () => config);

// IPC: set opacity
ipcMain.handle('set-opacity', (_, value) => {
  mainWindow.setOpacity(value);
});

app.whenReady().then(() => {
  createWindow();
  registerShortcuts();
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

app.on('window-all-closed', () => {
  app.quit();
});
