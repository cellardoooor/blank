let token = localStorage.getItem('token');
let userId = localStorage.getItem('userId');
let ws = null;
let currentContact = null;
let contacts = new Map();

const API_URL = '';

if (token) {
    showChat();
    initWebSocket();
} else {
    showAuth();
}

function showAuth() {
    document.getElementById('auth-section').style.display = 'flex';
    document.getElementById('chat-section').style.display = 'none';
}

function showChat() {
    document.getElementById('auth-section').style.display = 'none';
    document.getElementById('chat-section').style.display = 'flex';
    document.getElementById('user-info').textContent = 'Connected';
    loadContacts();
}

async function register() {
    const username = document.getElementById('username').value;
    const password = document.getElementById('password').value;

    try {
        const res = await fetch(`${API_URL}/api/auth/register`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({username, password})
        });

        const data = await res.json();
        if (!res.ok) throw new Error(data.error);

        token = data.token;
        userId = data.user.id;
        localStorage.setItem('token', token);
        localStorage.setItem('userId', userId);
        showChat();
        initWebSocket();
    } catch (e) {
        document.getElementById('auth-error').textContent = e.message;
    }
}

async function login() {
    const username = document.getElementById('username').value;
    const password = document.getElementById('password').value;

    try {
        const res = await fetch(`${API_URL}/api/auth/login`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({username, password})
        });

        const data = await res.json();
        if (!res.ok) throw new Error(data.error);

        token = data.token;
        localStorage.setItem('token', token);
        showChat();
        initWebSocket();
    } catch (e) {
        document.getElementById('auth-error').textContent = e.message;
    }
}

function logout() {
    localStorage.removeItem('token');
    localStorage.removeItem('userId');
    if (ws) ws.close();
    showAuth();
}

function initWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(`${protocol}//${window.location.host}/ws?token=${token}`);

    ws.onopen = () => {
        console.log('WebSocket connected');
    };

    ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        displayMessage(msg);
    };

    ws.onclose = () => {
        console.log('WebSocket disconnected');
        setTimeout(initWebSocket, 3000);
    };

    ws.onerror = (err) => {
        console.error('WebSocket error:', err);
    };
}

async function loadContacts() {
    // For demo, we use a hardcoded contact. In production, fetch from API
    contacts.set('demo-user-1', {id: 'demo-user-1', username: 'Demo User'});
    renderContacts();
}

function renderContacts() {
    const container = document.getElementById('contacts');
    container.innerHTML = '';
    contacts.forEach((contact, id) => {
        const div = document.createElement('div');
        div.className = 'contact' + (id === currentContact ? ' active' : '');
        div.textContent = contact.username;
        div.onclick = () => selectContact(id);
        container.appendChild(div);
    });
}

function selectContact(contactId) {
    currentContact = contactId;
    renderContacts();
    loadMessages(contactId);
}

async function loadMessages(contactId) {
    try {
        const res = await fetch(`${API_URL}/api/messages/${contactId}`, {
            headers: {'Authorization': `Bearer ${token}`}
        });
        const messages = await res.json();
        document.getElementById('messages').innerHTML = '';
        messages.forEach(m => displayMessage(m));
    } catch (e) {
        console.error('Failed to load messages:', e);
    }
}

function sendMessage() {
    const input = document.getElementById('message-input');
    const text = input.value.trim();
    if (!text || !currentContact) return;

    const payload = new TextEncoder().encode(text);
    const msg = {
        receiver_id: currentContact,
        payload: Array.from(payload)
    };

    ws.send(JSON.stringify(msg));
    input.value = '';
}

function displayMessage(msg) {
    const container = document.getElementById('messages');
    const div = document.createElement('div');
    const isSent = msg.sender_id === userId;
    div.className = 'message ' + (isSent ? 'sent' : 'received');
    
    const payload = new Uint8Array(msg.payload);
    const text = new TextDecoder().decode(payload);
    
    const time = new Date(msg.timestamp * 1000).toLocaleTimeString();
    div.innerHTML = `<div>${text}</div><div class="message-time">${time}</div>`;
    
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
}

document.getElementById('message-input').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendMessage();
});
