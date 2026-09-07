const { app, BrowserWindow, ipcMain, globalShortcut, clipboard } = require('electron');
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');
const https = require('https');
const { autoUpdater } = require('electron-updater');

let mainWindow;
let setupWindow;
let wss;

let savedMainChannelId = null;
let activeChannelId = null; 
let currentSettings = null;

const configPath = path.join(app.getPath('userData'), 'roblox_overlay_config.json');

function installBDPlugin() {
    const appData = process.env.APPDATA || (process.platform === 'darwin' ? process.env.HOME + '/Library/Application Support' : process.env.HOME + '/.config');
    const pluginDir = path.join(appData, 'BetterDiscord', 'plugins');
    const pluginPath = path.join(pluginDir, 'RobloxChatOverlay.plugin.js');
    const pluginUrl = 'https://raw.githubusercontent.com/kaip0v/RobloxDiscordChat/main/resource/RobloxChatOverlay.plugin.js?t=' + Date.now();

    if (!fs.existsSync(pluginDir)) {
        try { fs.mkdirSync(pluginDir, { recursive: true }); } 
        catch (err) { return; }
    }

    if (fs.existsSync(pluginPath)) {
        return;
    }

    const file = fs.createWriteStream(pluginPath);
    const options = { headers: { 'User-Agent': 'RobloxChatOverlay-Updater' } };

    https.get(pluginUrl, options, (response) => {
        if (response.statusCode !== 200) return;
        response.pipe(file);
        file.on('finish', () => file.close());
    }).on('error', () => fs.unlink(pluginPath, () => {}));
}

function loadSavedConfig() {
    try {
        if (fs.existsSync(configPath)) {
            const data = JSON.parse(fs.readFileSync(configPath, 'utf8'));
            if ((data.savedMainChannelId || data.targetChannelId) && data.settings) {
                savedMainChannelId = data.savedMainChannelId || data.targetChannelId;
                activeChannelId = savedMainChannelId;
                currentSettings = data.settings;
                return true;
            }
        }
    } catch (err) {}
    return false;
}

function saveCurrentConfig() {
    try {
        fs.writeFileSync(configPath, JSON.stringify({ 
            savedMainChannelId, 
            settings: currentSettings 
        }));
    } catch (err) {}
}

function createSetupWindow() {
    if (setupWindow) {
        setupWindow.focus();
        return;
    }
    setupWindow = new BrowserWindow({
        width: 450,
        height: 480,
        resizable: false,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        },
        autoHideMenuBar: true
    });
    setupWindow.loadFile('setup.html');
    setupWindow.on('closed', () => { setupWindow = null; });
}

function createOverlayWindow() {
    if (mainWindow) return;
    
    mainWindow = new BrowserWindow({
        width: 474, 
        height: 459, 
        x: 8,
        y: 62,
        transparent: true,
        frame: false,
        alwaysOnTop: true,
        skipTaskbar: true,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        }
    });
    
    mainWindow.setAlwaysOnTop(true, 'screen-saver');
    mainWindow.setVisibleOnAllWorkspaces(true);
    mainWindow.setIgnoreMouseEvents(true, { forward: true });
    mainWindow.loadFile('index.html');

    mainWindow.webContents.once('did-finish-load', () => {
        if (currentSettings) {
            mainWindow.webContents.send('apply-settings', currentSettings, savedMainChannelId);
        }
    });

    mainWindow.on('closed', () => { mainWindow = null; });
    registerShortcuts();
}

function registerShortcuts() {
    globalShortcut.unregisterAll();
    const shortcut = currentSettings?.shortcut || 'Alt+/';

    const activate = () => {
        if (mainWindow) {
            mainWindow.setIgnoreMouseEvents(false);
            mainWindow.show();
            mainWindow.focus();
            mainWindow.webContents.send('focus-input');
        }
    };

    if (shortcut === 'Alt+/') {
        globalShortcut.register('Alt+/', activate);
        globalShortcut.register('Alt+.', activate);
    } else if (shortcut === '/') {
        globalShortcut.register('/', activate);
    }
}

function startWebSocketServer() {
    if (wss) return; 
    wss = new WebSocket.Server({ host: '127.0.0.1', port: 37485 }); 
    
    wss.on('connection', (ws) => {
        ws.on('message', (data) => {
            const message = JSON.parse(data);
            
            if (message.action !== "TYPING_START") {
                console.log(`[WS] Discord -> Оверлей | Действие: ${message.action} | Текст: ${message.text || '[Без текста]'}`);
            }

            if (mainWindow) {
                mainWindow.webContents.send('new-message', message);
            }
        });
    });
}

app.whenReady().then(() => {
    installBDPlugin();
    autoUpdater.checkForUpdatesAndNotify();
    startWebSocketServer();
    if (loadSavedConfig()) {
        createOverlayWindow();
    } else {
        createSetupWindow();
    }
});

ipcMain.on('set-channel', (event, data) => {
    savedMainChannelId = String(data.id).trim();
    activeChannelId = savedMainChannelId;
    currentSettings = data.settings;
    saveCurrentConfig();
    if (setupWindow) setupWindow.close();
    createOverlayWindow();
});

ipcMain.on('set-active-channel', (event, channelId) => {
    activeChannelId = channelId;
});

ipcMain.on('send-message', (event, text) => {
    if (wss && activeChannelId) {
        const payload = JSON.stringify({
            action: "SEND_MESSAGE",
            channelId: activeChannelId,
            text: text
        });
        wss.clients.forEach(client => {
            if (client.readyState === 1) client.send(payload);
        });
    }
});

ipcMain.on('open-dm', (event, userId) => {
    if (wss) {
        const payload = JSON.stringify({
            action: "OPEN_DM",
            userId: userId
        });
        wss.clients.forEach(client => {
            if (client.readyState === 1) client.send(payload);
        });
    }
});

ipcMain.on('close-app', () => app.quit());

ipcMain.on('open-setup', () => {
    if (mainWindow) mainWindow.close();
    createSetupWindow();
});

ipcMain.on('add-tab', (event) => {
    const text = clipboard.readText().trim();
    if (/^\d{7,}$/.test(text)) {
        event.reply('tab-added', text);
    } else {
        event.reply('add-tab-error', 'У вас не скопирован ID диалога');
    }
});

ipcMain.on('set-ignore-mouse', (event, ignore) => {
    if (mainWindow) mainWindow.setIgnoreMouseEvents(ignore, { forward: ignore });
});

ipcMain.on('defocus', () => {
    if (mainWindow) {
        mainWindow.blur();
        mainWindow.setIgnoreMouseEvents(true, { forward: true });
    }
});

app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });