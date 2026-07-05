// ============================================
// KRISHU BOT - FRONTEND SCRIPT
// ============================================

const API_BASE = '';

async function generatePairingCode() {
    const phoneInput = document.getElementById('phoneNumber');
    const countryCode = document.getElementById('countryCode').value;
    const phone = phoneInput.value.replace(/[^0-9]/g, '');
    
    if (!phone || phone.length < 7) {
        showResult('❌ Please enter a valid phone number', 'error');
        return;
    }
    
    const fullNumber = countryCode + phone;
    
    document.getElementById('loading').classList.remove('hidden');
    document.getElementById('pairBtn').disabled = true;
    document.getElementById('result').classList.add('hidden');
    
    try {
        const res = await fetch(`${API_BASE}/api/pair`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ phone: fullNumber })
        });
        
        const data = await res.json();
        document.getElementById('loading').classList.add('hidden');
        
        if (data.success && data.code) {
            showResult(`
                ✅ <span class="success">Pairing Code Generated!</span><br><br>
                <div class="code">${data.code}</div><br>
                <div style="font-size: 0.9rem; color: #bbb;">
                    📱 Open WhatsApp → Settings → Linked Devices<br>
                    → Link a Device → Enter this code
                </div>
            `, 'success');
        } else {
            showResult(`❌ <span class="error">${data.message || 'Failed to generate code'}</span>`, 'error');
        }
    } catch (error) {
        document.getElementById('loading').classList.add('hidden');
        showResult('❌ <span class="error">Connection error. Please try again.</span>', 'error');
    }
    
    document.getElementById('pairBtn').disabled = false;
}

function showResult(html, type) {
    const result = document.getElementById('result');
    result.innerHTML = html;
    result.className = '';
    result.classList.remove('hidden');
}

// Auto-refresh status
async function refreshStatus() {
    try {
        const res = await fetch(`${API_BASE}/api/status`);
        const data = await res.json();
        
        document.getElementById('serverName').textContent = data.serverName || 'Server 4';
        document.getElementById('systemStatus').textContent = data.online ? 'ONLINE' : 'OFFLINE';
        document.getElementById('systemStatus').className = 'status-value ' + (data.online ? 'online' : 'offline');
        document.getElementById('activeUsers').textContent = (data.activeUsers || 0) + ' ONLINE';
        document.getElementById('selectedServer').textContent = data.serverName || 'Auto';
    } catch (e) {
        document.getElementById('systemStatus').textContent = 'OFFLINE';
        document.getElementById('systemStatus').className = 'status-value offline';
    }
}

// Refresh every 10 seconds
refreshStatus();
setInterval(refreshStatus, 10000);

// Enter key to submit
document.getElementById('phoneNumber').addEventListener('keypress', function(e) {
    if (e.key === 'Enter') generatePairingCode();
});
