// ============================================
// KRISHU BOT - COMMAND CORE
// ============================================

const fs = require('fs-extra');
const path = require('path');

const commands = new Map();

// Helper to send reply
async function reply(sock, m, text) {
    await sock.sendMessage(m.key.remoteJid, { text }, { quoted: m });
}

// Helper to send media
async function sendMedia(sock, jid, url, caption = '') {
    const isVideo = url.match(/\.(mp4|webm|mov)$/i);
    const isImage = url.match(/\.(jpg|jpeg|png|gif|webp)$/i);
    const isAudio = url.match(/\.(mp3|wav|ogg|m4a)$/i);
    
    if (isVideo) {
        await sock.sendMessage(jid, { video: { url }, caption });
    } else if (isImage) {
        await sock.sendMessage(jid, { image: { url }, caption });
    } else if (isAudio) {
        await sock.sendMessage(jid, { audio: { url }, mimetype: 'audio/mp4' });
    } else {
        await sock.sendMessage(jid, { text: caption || url });
    }
}

// Register command
function register(commandName, execute) {
    commands.set(commandName, { execute });
}

// Get command list
function getCommands() {
    return Array.from(commands.keys());
}

// Load all command files
async function loadAll(sock, config) {
    const dir = path.join(__dirname);
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.js') && f !== '_core.js');
    
    for (const file of files) {
        try {
            const cmd = require(path.join(dir, file));
            if (cmd.register) {
                cmd.register(register);
                console.log(`✅ Loaded: ${file}`);
            }
        } catch (e) {
            console.log(`❌ Failed: ${file} - ${e.message}`);
        }
    }
}

module.exports = { reply, sendMedia, register, getCommands, loadAll, commands };
