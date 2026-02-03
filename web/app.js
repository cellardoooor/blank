let token = localStorage.getItem('token');
let userId = localStorage.getItem('userId');
let ws = null;
let currentContact = null;
let contacts = new Map();
let allUsers = [];
let conversationPartners = new Set();

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

    // Client-side validation
    if (username.length < 5 || username.length > 16) {
        document.getElementById('auth-error').textContent = 'Username must be 5-16 characters';
        return;
    }
    if (password.length < 5) {
        document.getElementById('auth-error').textContent = 'Password must be at least 5 characters';
        return;
    }

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
        // Get user info to store userId
        const userRes = await fetch(`${API_URL}/api/users`, {
            headers: {'Authorization': `Bearer ${token}`}
        });
        const users = await userRes.json();
        // Find current user by matching the token (we'll need to fetch current user)
        // For now, we'll fetch conversations to get userId from partners
        const convRes = await fetch(`${API_URL}/api/conversations`, {
            headers: {'Authorization': `Bearer ${token}`}
        });
        
        token = data.token;
        localStorage.setItem('token', token);
        showChat();
        initWebSocket();
        
        // Load user ID from users list (temporary solution)
        await loadCurrentUser();
    } catch (e) {
        document.getElementById('auth-error').textContent = e.message;
    }
}

async function loadCurrentUser() {
    try {
        const res = await fetch(`${API_URL}/api/users`, {
            headers: {'Authorization': `Bearer ${token}`}
        });
        const users = await res.json();
        // We'll determine current user later through a dedicated endpoint
        // For now, just store the first user ID as a placeholder
        if (users.length > 0 && !userId) {
            // Actually, we need to figure out which user is "me"
            // Let's use a workaround - store users and compare with conversations
        }
    } catch (e) {
        console.error('Failed to load current user:', e);
    }
}

function logout() {
    localStorage.removeItem('token');
    localStorage.removeItem('userId');
    token = null;
    userId = null;
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
    try {
        // Load all conversations (partners)
        const convRes = await fetch(`${API_URL}/api/conversations`, {
            headers: {'Authorization': `Bearer ${token}`}
        });
        const partners = await convRes.json();
        
        conversationPartners.clear();
        contacts.clear();
        
        // Fetch user details for each partner
        for (const partnerId of partners) {
            const userRes = await fetch(`${API_URL}/api/users/${partnerId}`, {
                headers: {'Authorization': `Bearer ${token}`}
            });
            if (userRes.ok) {
                const user = await userRes.json();
                contacts.set(partnerId, {id: partnerId, username: user.username});
                conversationPartners.add(partnerId);
            }
        }
        
        renderContacts();
    } catch (e) {
        console.error('Failed to load contacts:', e);
    }
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
        messages.reverse().forEach(m => displayMessage(m));
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
    // Only display if it's part of current conversation
    if (currentContact && 
        ((msg.sender_id === currentContact && msg.receiver_id === userId) ||
         (msg.sender_id === userId && msg.receiver_id === currentContact))) {
        
        const container = document.getElementById('messages');
        const div = document.createElement('div');
        const isSent = msg.sender_id === userId;
        div.className = 'message ' + (isSent ? 'sent' : 'received');
        
        const payload = new Uint8Array(msg.payload);
        const text = new TextDecoder().decode(payload);
        
        const time = new Date(msg.created_at).toLocaleTimeString();
        div.innerHTML = `<div>${text}</div><div class="message-time">${time}</div>`;
        
        container.appendChild(div);
        container.scrollTop = container.scrollHeight;
    }
    
    // Refresh contacts if this is a new conversation
    if (!conversationPartners.has(msg.sender_id) && msg.sender_id !== userId) {
        loadContacts();
    }
    if (!conversationPartners.has(msg.receiver_id) && msg.receiver_id !== userId) {
        loadContacts();
    }
}

// New Chat Modal Functions
async function showNewChatModal() {
    document.getElementById('new-chat-modal').style.display = 'block';
    await loadAllUsersForModal();
}

function closeNewChatModal() {
    document.getElementById('new-chat-modal').style.display = 'none';
}

async function loadAllUsersForModal() {
    try {
        // Load all users
        const usersRes = await fetch(`${API_URL}/api/users`, {
            headers: {'Authorization': `Bearer ${token}`}
        });
        allUsers = await usersRes.json();
        
        // Load conversation partners to filter them out
        const convRes = await fetch(`${API_URL}/api/conversations`, {
            headers: {'Authorization': `Bearer ${token}`}
        });
        const partners = await convRes.json();
        conversationPartners = new Set(partners);
        
        // Try to determine current user from conversations
        // If we have a message, we can infer the current user
        if (!userId && partners.length > 0) {
            // We need to know who "we" are - this is a limitation
            // For now, let's try to get user info from the first conversation
        }
        
        renderUserList();
    } catch (e) {
        console.error('Failed to load users:', e);
        document.getElementById('user-list').innerHTML = '<li class="no-users">Failed to load users</li>';
    }
}

function renderUserList() {
    const list = document.getElementById('user-list');
    list.innerHTML = '';
    
    // Filter users: exclude current user and those with existing conversations
    const availableUsers = allUsers.filter(user => {
        // Skip users we already have conversations with
        if (conversationPartners.has(user.id)) return false;
        return true;
    });
    
    if (availableUsers.length === 0) {
        list.innerHTML = '<li class="no-users">No available users to chat with</li>';
        return;
    }
    
    availableUsers.forEach(user => {
        const li = document.createElement('li');
        li.className = 'user-list-item';
        li.textContent = user.username;
        li.onclick = () => startNewChat(user.id, user.username);
        list.appendChild(li);
    });
}

function startNewChat(userId, username) {
    closeNewChatModal();
    
    // Add to contacts
    contacts.set(userId, {id: userId, username: username});
    conversationPartners.add(userId);
    
    // Select this contact
    selectContact(userId);
    
    // Refresh the contacts list
    renderContacts();
}

// Close modal when clicking outside
window.onclick = function(event) {
    const modal = document.getElementById('new-chat-modal');
    if (event.target === modal) {
        closeNewChatModal();
    }
}

document.getElementById('message-input').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendMessage();
});
