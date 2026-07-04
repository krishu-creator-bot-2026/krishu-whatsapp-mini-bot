// ============================================
// KRISHU WHATSAPP MINI BOT - CONFIGURATION
// ============================================

const config = {
    // Bot Information
    botName: "KRISHU BOT",
    botVersion: "v2.0",
    ownerNumber: "91Xxxxxxxxxx@s.whatsapp.net", // YOUR NUMBER (will be set via website)
    ownerName: "Krishu",
    
    // Website Settings
    websiteTitle: "KRISHU BOT",
    websiteFooter: "POWERFULL MINI BOT // v2.0",
    serverName: "Server 4",
    
    // Render Settings
    port: process.env.PORT || 3000,
    
    // Session Settings
    sessionName: "krishu-session",
    
    // API Keys (free)
    apiKeys: {
        gemini: "",  // Optional: Google Gemini API
        openai: "",   // Optional
    },
    
    // Default Settings
    prefix: ".",
    adminNumbers: [],
    
    // Media Download Qualities
    videoQualities: [
        { label: "144p (Low)", value: "144" },
        { label: "360p (Medium)", value: "360" },
        { label: "420p (Standard)", value: "420" },
        { label: "720p (HD)", value: "720" },
        { label: "1080p (Full HD)", value: "1080" },
        { label: "1440p (2K)", value: "1440" }
    ],
    
    // Feature Toggles
    features: {
        antilink: true,
        antifake: true,
        antispam: true,
        autoreact: true,
        autostatus: false,
        autobio: false
    }
};

module.exports = config;