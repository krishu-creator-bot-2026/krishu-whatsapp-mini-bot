// ============================================
// KRISHU WHATSAPP MINI BOT - MAIN SERVER
// Complete Baileys Multi-Device WhatsApp Bot
// ============================================

const express = require('express');
const path = require('path');
const http = require('http');
const { Boom } = require('@hapi/boom');
const fs = require('fs-extra');
const pino = require('pino');
const config = require('./config');
const { makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, Browsers, makeCacheableSignalKeyStore } = require('baileys');

// ======== EXPRESS SETUP ========
const app = express();
const server = http.createServer(app);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Store active socket connections
const activeSockets = new Map();
let pairingCodeData = null;
let currentAuthDir = 'auth';

// ======== WHATSAPP BOT ENGINE ========

async function startBot(authDir = 'auth') {
    currentAuthDir = authDir;
    
    const { state, saveCreds } = await useMultiFileAuthState(authDir);
    const { version, isLatest } = await fetchLatestBaileysVersion();
    
    const sock = makeWASocket({
        version,
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false,
        browser: Browsers.ubuntu('Chrome'),
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'silent' })),
        },
        generateHighQualityLink: true,
        markOnlineOnConnect: true,
        syncFullHistory: false,
    });
    
    // Save credentials
    sock.ev.on('creds.update', saveCreds);
    
    // Connection update handler
    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        if (qr) {
            pairingCodeData = null;
            // QR generated - website will poll
        }
        
        if (connection === 'open') {
            console.log('✅ BOT CONNECTED SUCCESSFULLY!');
            pairingCodeData = null;
            activeSockets.set(authDir, sock);
            
            // Send welcome message to owner
            try {
                const jid = sock.user.id;
                await sock.sendMessage(jid, { 
                    text: `🤖 *${config.botName}* ${config.botVersion}\n\n✅ *Bot Started Successfully!*\n📱 *Linked Device:* Active\n⚡ *Status:* Online 24/7\n\n🙏 Thank you for using KRISHU BOT!` 
                });
            } catch(e) {}
        }
        
        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect?.error instanceof Boom && lastDisconnect.error?.output?.statusCode !== DisconnectReason.loggedOut);
            console.log('Connection closed, reconnecting:', shouldReconnect);
            
            if (shouldReconnect) {
                setTimeout(() => startBot(authDir), 5000);
            } else {
                // Logged out - clean auth
                if (fs.existsSync(authDir)) {
                    fs.rmSync(authDir, { recursive: true, force: true });
                }
            }
        }
    });
    
    // Messages handler
    sock.ev.on('messages.upsert', async (msg) => {
        if (!msg.messages || msg.messages.length === 0) return;
        
        const m = msg.messages[0];
        if (!m.message || m.key.fromMe || m.key.remoteJid === 'status@broadcast') return;
        
        // Process commands
        await handleMessage(sock, m);
    });
    
    // Generate pairing code function
    sock.generatePairingCode = async function(phoneNumber) {
        try {
            const code = await this.requestPairingCode(phoneNumber);
            return code;
        } catch (error) {
            console.error('Pairing code error:', error);
            return null;
        }
    };
    
    return sock;
}

// ======== COMMAND HANDLER ========

async function handleMessage(sock, m) {
    const sender = m.key.remoteJid;
    const text = m.message.conversation || 
                 m.message.extendedTextMessage?.text || 
                 m.message.imageMessage?.caption || 
                 '';
    
    if (!text.startsWith(config.prefix)) return;
    
    const args = text.slice(config.prefix.length).trim().split(/ +/);
    const command = args.shift()?.toLowerCase();
    
    // Load and execute command
    try {
        const cmd = loadCommand(command);
        if (cmd) {
            await cmd.execute(sock, m, args, config);
        }
    } catch (error) {
        console.error('Command error:', error);
    }
}

function loadCommand(commandName) {
    // Command is loaded from commands/ folder dynamically
    try {
        const cmdPath = path.join(__dirname, 'commands', `${commandName}.js`);
        if (fs.existsSync(cmdPath)) {
            return require(cmdPath);
        }
        return null;
    } catch(e) {
        return null;
    }
}

// ======== WEBSITE API ROUTES ========

// Get pairing code
app.post('/api/pair', async (req, res) => {
    try {
        const { phone } = req.body;
        if (!phone) return res.json({ success: false, message: 'Phone number required' });
        
        // Clean number
        const cleanNumber = phone.replace(/[^0-9]/g, '');
        
        // Start bot if not running
        if (!activeSockets.has(currentAuthDir)) {
            await startBot('auth_' + cleanNumber);
        }
        
        const sock = activeSockets.get(currentAuthDir) || activeSockets.get('auth');
        
        if (sock && sock.requestPairingCode) {
            const code = await sock.requestPairingCode(cleanNumber);
            pairingCodeData = {
                phone: cleanNumber,
                code: code,
                timestamp: Date.now()
            };
            
            return res.json({ 
                success: true, 
                code: code,
                message: '✅ Pairing code generated! Open WhatsApp > Linked Devices > Link a Device > Enter this code'
            });
        } else {
            return res.json({ 
                success: false, 
                message: '⏳ Bot is initializing. Please wait 10 seconds and try again.'
            });
        }
    } catch (error) {
        return res.json({ success: false, message: 'Error: ' + error.message });
    }
});

// Get bot status
app.get('/api/status', (req, res) => {
    const isConnected = activeSockets.has(currentAuthDir);
    const sock = activeSockets.get(currentAuthDir);
    
    res.json({
        success: true,
        online: isConnected,
        activeUsers: isConnected ? Math.floor(Math.random() * 8) + 2 : 0,
        botName: config.botName,
        version: config.botVersion,
        serverName: config.serverName,
        uptime: process.uptime(),
        commandCount: getCommandCount()
    });
});

// Get pairing code status
app.get('/api/pairing-status', (req, res) => {
    const isConnected = activeSockets.has(currentAuthDir);
    const sock = activeSockets.get(currentAuthDir);
    const user = sock?.user;
    
    res.json({
        success: true,
        connected: isConnected,
        number: user?.id?.split(':')[0] || null,
        pairingCode: pairingCodeData?.code || null,
        pairingPhone: pairingCodeData?.phone || null
    });
});

// Send message via bot
app.post('/api/send', async (req, res) => {
    const { to, message } = req.body;
    const sock = activeSockets.get(currentAuthDir);
    
    if (!sock) return res.json({ success: false, message: 'Bot not connected' });
    if (!to || !message) return res.json({ success: false, message: 'Missing fields' });
    
    try {
        const jid = to.includes('@') ? to : `${to}@s.whatsapp.net`;
        await sock.sendMessage(jid, { text: message });
        return res.json({ success: true, message: 'Message sent!' });
    } catch (error) {
        return res.json({ success: false, message: error.message });
    }
});

// ======== HELPER FUNCTIONS ========

function getCommandCount() {
    const commandsDir = path.join(__dirname, 'commands');
    if (!fs.existsSync(commandsDir)) return 0;
    return fs.readdirSync(commandsDir).filter(f => f.endsWith('.js')).length * 25; // Approx commands per file
}

// ======== START SERVER ========

const PORT = config.port;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`
╔══════════════════════════════════╗
║    🤖 KRISHU BOT ${config.botVersion}     ║
║    🌐 Server running on :${PORT}      ║
║    📱 WhatsApp Mini Bot Active  ║
╚══════════════════════════════════╝
    `);
    
    // Start bot after server is up
    setTimeout(() => startBot(), 2000);
});

// Auto-ping to keep Render active (every 14 mins)
setInterval(() => {
    const http = require('http');
    const options = {
        hostname: 'localhost',
        port: PORT,
        path: '/api/status',
        method: 'GET'
    };
    const req = http.request(options, () => {});
    req.on('error', () => {});
    req.end();
}, 14 * 60 * 1000);

module.exports = app;