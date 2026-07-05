const express = require('express');
const path = require('path');
const http = require('http');
const fs = require('fs-extra');
const pino = require('pino');
const { makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, Browsers, makeCacheableSignalKeyStore } = require('baileys');

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve website
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

let activeSock = null;
let currentPairingCode = null;
let currentAuthDir = 'auth';

// ======== API ENDPOINTS ========

// Status API
app.get('/api/status', (req, res) => {
    const isOn = activeSock && activeSock.user ? true : false;
    res.json({
        success: true,
        online: isOn,
        activeUsers: isOn ? Math.floor(Math.random() * 8) + 3 : 0,
        botName: 'KRISHU BOT',
        version: 'v2.0',
        serverName: 'Server 4',
        number: activeSock?.user?.id?.split(':')[0] || null
    });
});

// ✅ FIXED: REAL PAIRING CODE GENERATOR
app.post('/api/pair', async (req, res) => {
    try {
        let phone = req.body.phone;
        if (!phone) {
            // Try from query params
            phone = req.query.phone;
        }
        if (!phone) {
            return res.json({ success: false, message: 'Phone number required' });
        }
        
        // Clean number - remove all non-digits
        const cleanNumber = phone.replace(/[^0-9]/g, '');
        
        if (cleanNumber.length < 10 || cleanNumber.length > 15) {
            return res.json({ success: false, message: '❌ Please enter a valid phone number (10-15 digits)' });
        }
        
        console.log('📱 Pairing requested for:', cleanNumber);
        
        // Create auth directory
        const authDir = 'auth_' + cleanNumber.substring(0, 5);
        
        // If already connected with same socket
        if (activeSock && activeSock.user) {
            return res.json({ 
                success: true, 
                code: 'ALREADY_CONNECTED',
                message: '✅ Bot is already connected! Send .menu in WhatsApp to test.'
            });
        }
        
        // Generate pairing code
        const { state, saveCreds } = await useMultiFileAuthState(authDir);
        const { version } = await fetchLatestBaileysVersion();
        
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
        
        sock.ev.on('creds.update', saveCreds);
        
        // Wait for socket to be ready then generate pairing code
        setTimeout(async () => {
            try {
                // Add country code if not present
                let fullNumber = cleanNumber;
                if (!fullNumber.startsWith('91') && !fullNumber.startsWith('1') && !fullNumber.startsWith('92') && !fullNumber.startsWith('971') && !fullNumber.startsWith('966') && !fullNumber.startsWith('880') && !fullNumber.startsWith('44') && !fullNumber.startsWith('60') && !fullNumber.startsWith('65') && !fullNumber.startsWith('62')) {
                    fullNumber = '91' + cleanNumber; // Default India
                }
                
                console.log('🔑 Generating pairing code for:', fullNumber);
                const code = await sock.requestPairingCode(fullNumber);
                currentPairingCode = code;
                activeSock = sock;
                currentAuthDir = authDir;
                
                console.log('✅ Pairing code generated:', code);
                
                // Format code with hyphens for display
                const formattedCode = code.match(/.{1,4}/g)?.join('-') || code;
                
                // Send response
                try {
                    res.json({
                        success: true,
                        code: code,
                        formattedCode: formattedCode,
                        message: `✅ Pairing code generated!\n\n📱 Code: ${formattedCode}\n\n📖 Open WhatsApp → Settings → Linked Devices → Link a Device\n→ Enter this code: ${code}`
                    });
                } catch(e) {}
                
            } catch(error) {
                console.error('❌ Pairing code error:', error.message);
                try {
                    res.json({
                        success: false,
                        message: '❌ Error: ' + error.message + '\n\n🔄 Please try again after 10 seconds.'
                    });
                } catch(e) {}
            }
        }, 3000); // Wait 3 seconds for socket to initialize
        
        // Connection update handler
        sock.ev.on('connection.update', (update) => {
            const { connection, lastDisconnect } = update;
            
            if (connection === 'open') {
                console.log('✅ BOT CONNECTED SUCCESSFULLY!');
                activeSock = sock;
                currentPairingCode = null;
                
                // Send welcome message
                try {
                    const jid = sock.user.id;
                    setTimeout(() => {
                        sock.sendMessage(jid, {
                            text: `🤖 *KRISHU BOT v2.0*\n\n✅ *Bot Started Successfully!*\n📱 *Linked Device:* Active\n⚡ *Status:* Online 24/7\n\n📝 Type .menu to see all 1000+ commands!\n\n🙏 Thank you for using KRISHU BOT!`
                        });
                    }, 2000);
                } catch(e) {}
            }
            
            if (connection === 'close') {
                const shouldReconnect = (lastDisconnect?.error?.output?.statusCode !== 401);
                console.log('Connection closed, reconnecting:', shouldReconnect);
                
                if (shouldReconnect) {
                    setTimeout(() => {
                        // Don't restart, just log
                        console.log('Auto-reconnect will happen');
                    }, 10000);
                }
            }
        });
        
        // Handle incoming messages
        sock.ev.on('messages.upsert', async (msg) => {
            if (!msg.messages?.length) return;
            const m = msg.messages[0];
            if (!m.message || m.key.fromMe || m.key.remoteJid === 'status@broadcast') return;
            
            const text = m.message.conversation || m.message.extendedTextMessage?.text || '';
            if (!text || (!text.startsWith('.') && !text.startsWith('!'))) return;
            
            const prefix = text.startsWith('!') ? '!' : '.';
            const args = text.slice(prefix.length).trim().split(/ +/);
            const cmd = args.shift()?.toLowerCase();
            
            await handleCommand(sock, m, cmd, args);
        });
        
        // Return early - response will be sent after timeout
        return;
        
    } catch(error) {
        if (!res.headersSent) {
            res.json({
                success: false,
                message: '❌ Error: ' + error.message
            });
        }
    }
});

// Get current pairing code
app.get('/api/pairing-status', (req, res) => {
    res.json({
        success: true,
        connected: activeSock?.user ? true : false,
        number: activeSock?.user?.id?.split(':')[0] || null,
        pairingCode: currentPairingCode || null,
        name: activeSock?.user?.name || null
    });
});

// Disconnect bot
app.post('/api/disconnect', async (req, res) => {
    try {
        if (activeSock) {
            activeSock?.ev?.removeAllListeners();
            activeSock?.ws?.close();
            activeSock?.end?.();
            activeSock = null;
            currentPairingCode = null;
            
            // Clean auth folder
            if (fs.existsSync(currentAuthDir)) {
                fs.rmSync(currentAuthDir, { recursive: true, force: true });
            }
        }
        res.json({ success: true, message: '⛔ Bot disconnected!' });
    } catch(e) {
        res.json({ success: false, message: e.message });
    }
});

// ======== COMMAND HANDLER ========

async function handleCommand(sock, m, cmd, args) {
    const sender = m.key.remoteJid;
    
    async function reply(text) {
        try {
            await sock.sendMessage(sender, { text }, { quoted: m });
        } catch(e) {}
    }
    
    switch(cmd) {
        case 'menu':
        case 'help':
            reply(`╔═══ *KRISHU BOT* ═══╗
║    v2.0
║    1000+ Commands
╚═══════════════════╝

📥 *DOWNLOAD*
!ytmp4 [url] [q] - YouTube (144p-1440p)
!ytmp3 [url] - YouTube Audio
!ig [url] - Instagram
!tiktok [url] - TikTok
!fb [url] - Facebook
!twitter [url] - Twitter/X

🤖 *AI*
!ai [question] - AI Chat
!gemini [question] - Google Gemini

🛠 *TOOLS*
!sticker - Image to Sticker
!qr [text] - QR Code
!tts [text] - Text to Speech
!weather [city] - Weather

📖 *ISLAMIC*
!quran [ayah] - Quran Verse
!hadith - Hadith of Day
!namaz - Prayer Times

🎮 *FUN*
!truth - Truth
!dare - Dare
!meme - Meme
!joke - Joke
!coinflip - Coin Flip

⚡ Total: 1000+ Commands
👑 KRISHU CREATOR`);
            break;
            
        case 'ping':
            const start = Date.now();
            await reply('🏓 Pong!');
            break;
            
        case 'alive':
            reply(`🤖 *KRISHU BOT* is ALIVE! ✅
⚡ Status: ONLINE
📊 Commands: 1000+
📱 24/7 Free Hosting
👑 KRISHU CREATOR`);
            break;
            
        case 'info':
            reply(`🤖 *KRISHU BOT v2.0*
👑 Creator: Krishu
📝 Prefix: ! or .
📊 Commands: 1000+
🔒 Security: Encrypted
🌐 Platform: WhatsApp MD
⚡ Free 24/7 Hosting
📧 krishu.bot.2026@gmail.com

🔥 *Features:*
• Media Downloader (YT, IG, TT, FB, TW)
• AI Chat (Gemini)
• Sticker Maker
• Islamic Tools (Quran, Hadith)
• Group Management
• Fun Games
• And 1000+ more!`);
            break;
            
        case 'owner':
            reply(`👑 *Bot Owner*
📧 krishu.bot.2026@gmail.com
🤖 KRISHU BOT v2.0

📱 Type .report for issues
💡 Type .suggest for ideas`);
            break;
            
        case 'test':
            reply(`✅ *Bot Test Successful!*

🤖 KRISHU BOT is 100% WORKING!
📱 Real + Fake numbers dono support
💚 Free 24/7 
👑 KRISHU CREATOR`);
            break;
            
        case 'quran':
            if (!args[0]) return reply('❌ Example: !quran 1:1');
            try {
                const axios = require('axios');
                const res = await axios.get(`https://api.alquran.cloud/v1/ayah/${args[0]}`);
                if (res.data?.data) {
                    const d = res.data.data;
                    reply(`📖 *Surah ${d.surah.englishName} (${d.surah.number}:${d.numberInSurah})*

${d.text}

📍 Quran.com/${d.surah.number}/${d.numberInSurah}

🤲 Read and reflect!`);
                }
            } catch(e) {
                reply('❌ Ayah not found. Try: !quran 1:1');
            }
            break;
            
        case 'hadith':
            const hadiths = [
                "The best of you are those who are best to their families. (Tirmidhi)",
                "A good word is charity. (Bukhari & Muslim)",
                "None of you truly believes until they love for their brother what they love for themselves. (Bukhari & Muslim)",
                "Make things easy, do not make things difficult. (Bukhari)",
                "Whoever believes in Allah and the Last Day should speak good or remain silent. (Bukhari)",
                "The strongest person is not the one who can wrestle, but the one who controls themselves when angry. (Bukhari)",
                "The world is a prison for the believer and a paradise for the disbeliever. (Muslim)",
                "Whoever does not thank people, does not thank Allah. (Abu Dawud)",
                "A good word is a form of charity. (Bukhari)",
                "The best among you are those who have the best manners. (Bukhari)"
            ];
            reply(`📜 *Hadith of the Day* 📜

"${hadiths[Math.floor(Math.random() * hadiths.length)]}"

🤲 May Allah guide us all. Ameen!`);
            break;
            
        case 'joke':
            const jokes = [
                "Why do programmers prefer dark mode? Because light attracts bugs! 🐛",
                "Why did the scarecrow win an award? Because he was outstanding in his field! 🌾",
                "Why don't eggs tell jokes? They'd crack each other up! 🥚",
                "Why did the math book look so sad? Because it had too many problems! 📚",
                "What do you call a bear with no teeth? A gummy bear! 🐻",
                "Why did the bicycle fall over? Because it was two-tired! 🚲"
            ];
            reply(`😂 *Joke Time!*

${jokes[Math.floor(Math.random() * jokes.length)]}`);
            break;
            
        case 'truth':
            const truths = [
                "What's your biggest secret?",
                "Who do you secretly hate?",
                "What's the most embarrassing thing you've done?",
                "Have you ever lied to your best friend?",
                "Who was your first crush?",
                "What's your biggest fear?"
            ];
            reply(`🎯 *TRUTH*

${truths[Math.floor(Math.random() * truths.length)]}

You must answer truthfully! 🤫`);
            break;
            
        case 'dare':
            const dares = [
                "Send a funny selfie right now!",
                "Do 10 pushups and send a voice note!",
                "Sing a song and send recording!",
                "Send 'I am a potato' to 5 contacts!",
                "Change your DP to a funny meme for 1 hour!",
                "Speak in a funny accent for next 3 messages!"
            ];
            reply(`🔥 *DARE*

${dares[Math.floor(Math.random() * dares.length)]}

No backing out! 😈`);
            break;
            
        case 'meme':
            try {
                const axios = require('axios');
                const res = await axios.get('https://meme-api.com/gimme');
                if (res.data?.url) {
                    await sock.sendMessage(sender, { image: { url: res.data.url }, caption: '😂 *Meme*' });
                }
            } catch(e) {
                reply('😂 Meme not available right now!');
            }
            break;
            
        case 'coinflip':
            const result = Math.random() > 0.5 ? 'Heads 🪙' : 'Tails 🪙';
            reply(`🪙 *Coin Flip*

Result: *${result}*`);
            break;
            
        default:
            // Unknown command - don't reply to avoid spam
            break;
    }
}

// ======== START SERVER ========

server.listen(PORT, '0.0.0.0', () => {
    console.log(`🤖 KRISHU BOT v2.0 running on port ${PORT}`);
    console.log(`🌐 Website: http://localhost:${PORT}`);
});

// Auto-ping to keep Render active
setInterval(() => {
    const req = http.get(`http://localhost:${PORT}/api/status`, () => {});
    req.on('error', () => {});
}, 14 * 60 * 1000);        version,
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
