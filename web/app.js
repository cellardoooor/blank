/**
 * Messenger Application - Telegram-like Interface
 * 
 * Features:
 * - Two-panel layout: Chat list (left) + Chat window (right)
 * - Real-time messaging via WebSocket
 * - Local time conversion for all timestamps
 * - New chat modal with filtering
 * - Auto-reconnect on disconnect
 */

// Global State
let token = localStorage.getItem('token');
let userId = localStorage.getItem('userId');
let currentUser = null;
let ws = null;
let currentChat = null;
let chats = new Map(); // userId -> chat data
let allUsers = [];
let conversationPartners = new Set();
let messagesMap = new Map(); // userId -> messages array

const API_URL = '/api';

async function apiRequest(endpoint, options = {}) {
    const defaultOptions = {
        headers: {
            'Authorization': `Bearer ${token}`,
            ...options.headers
        },
        signal: AbortSignal.timeout(10000)
    };

    try {
        const res = await fetch(`${API_URL}${endpoint}`, { ...defaultOptions, ...options });

        if (res.status === 401) {
            logout();
            throw new Error('Unauthorized');
        }

        return res;
    } catch (e) {
        if (e.name === 'AbortError') {
            throw new Error('Request timeout');
        }
        throw e;
    }
}

// Initialize application
if (token) {
    initApp();
} else {
    showAuth();
}

// ==================== AUTHENTICATION ====================

function showAuth() {
    document.getElementById('auth-section').style.display = 'flex';
    document.getElementById('chat-section').style.display = 'none';
    document.getElementById('username').value = '';
    document.getElementById('password').value = '';
    document.getElementById('auth-error').textContent = '';
}

async function login() {
    const username = document.getElementById('username').value.trim();
    const password = document.getElementById('password').value;
    const errorEl = document.getElementById('auth-error');

    if (!username || !password) {
        errorEl.textContent = 'Please enter username and password';
        return;
    }

    try {
        const res = await fetch(`${API_URL}/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });

        if (!res.ok) {
            const errorData = await res.json();
            errorEl.textContent = errorData.error || 'Login failed';
            return;
        }

        const data = await res.json();
        token = data.token;
        localStorage.setItem('token', token);
        
        const meRes = await apiRequest('/me');
        if (meRes.ok) {
            const me = await meRes.json();
            userId = me.id;
            localStorage.setItem('userId', userId);
        }
        
        await initApp();
    } catch (e) {
        errorEl.textContent = 'Network error: ' + e.message;
    }
}

async function register() {
    const username = document.getElementById('username').value.trim();
    const password = document.getElementById('password').value;
    const errorEl = document.getElementById('auth-error');

    if (!username || !password) {
        errorEl.textContent = 'Please enter username and password';
        return;
    }

    try {
        const res = await fetch(`${API_URL}/auth/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });

        if (!res.ok) {
            const errorData = await res.json();
            errorEl.textContent = errorData.error || 'Registration failed';
            return;
        }

        const data = await res.json();
        token = data.token;
        localStorage.setItem('token', token);
        
        const meRes = await apiRequest('/me');
        if (meRes.ok) {
            const me = await meRes.json();
            userId = me.id;
            localStorage.setItem('userId', userId);
        }
        
        await initApp();
    } catch (e) {
        errorEl.textContent = 'Network error: ' + e.message;
    }
}

function logout() {
    localStorage.removeItem('token');
    localStorage.removeItem('userId');
    token = null;
    userId = null;
    currentUser = null;
    currentChat = null;
    chats.clear();
    messagesMap.clear();
    
    if (ws) {
        ws.close();
        ws = null;
    }
    
    showAuth();
}

// ==================== APP INITIALIZATION ====================

async function initApp() {
    try {
        document.getElementById('auth-section').style.display = 'none';
        document.getElementById('chat-section').style.display = 'flex';
        
        // Load chats
        await loadChats();
        
        // Initialize WebSocket
        initWebSocket();
        
        // Setup message input auto-resize
        setupInputResize();
        
    } catch (e) {
        console.error('Failed to initialize app:', e);
        showAuth();
    }
}

// ==================== WEBSOCKET ====================

function initWebSocket() {
    if (ws) {
        ws.close();
    }
    
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(`${protocol}//${window.location.host}/ws?token=${token}`);

    ws.onopen = () => {
        console.log('WebSocket connected');
    };

    ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        handleIncomingMessage(msg);
    };

    ws.onclose = () => {
        console.log('WebSocket disconnected, reconnecting in 3s...');
        setTimeout(initWebSocket, 3000);
    };

    ws.onerror = (err) => {
        console.error('WebSocket error:', err);
    };
}

function handleIncomingMessage(msg) {
    const partnerId = msg.sender_id === userId ? msg.receiver_id : msg.sender_id;
    
    // Add to messages map
    if (!messagesMap.has(partnerId)) {
        messagesMap.set(partnerId, []);
    }
    messagesMap.get(partnerId).push(msg);
    
    // Update chat list
    updateChatFromMessage(partnerId, msg);
    
    // If this is the active chat, display it
    if (currentChat === partnerId) {
        displayMessage(msg);
    }
}

// ==================== CHAT LIST ====================

async function loadChats() {
    try {
        const res = await apiRequest('/chats');
        
        if (!res.ok) {
            throw new Error('Failed to load chats: ' + res.statusText);
        }
        
        const chatList = await res.json();
        
        chats.clear();
        conversationPartners.clear();
        
        chatList.forEach(chat => {
            chats.set(chat.user_id, {
                userId: chat.user_id,
                username: chat.username || chat.user_id,
                lastMessage: chat.last_message,
                lastMessageTime: new Date(chat.last_message_time)
            });
            conversationPartners.add(chat.user_id);
        });
        
        renderChatList();
        
    } catch (e) {
        console.error('Failed to load chats:', e);
    }
}

function updateChatFromMessage(partnerId, msg) {
    const text = decodePayload(msg.payload);
    const chat = chats.get(partnerId);
    
    if (chat) {
        chat.lastMessage = text;
        chat.lastMessageTime = new Date(msg.created_at);
    } else {
        // New chat - need to fetch user info
        fetchUserInfo(partnerId).then(user => {
            if (user) {
                chats.set(partnerId, {
                    userId: partnerId,
                    username: user.username,
                    lastMessage: text,
                    lastMessageTime: new Date(msg.created_at)
                });
                conversationPartners.add(partnerId);
                renderChatList();
            }
        });
        return;
    }
    
    // Move chat to top by re-rendering
    renderChatList();
}

async function fetchUserInfo(userId) {
    try {
        const res = await apiRequest(`/users/${userId}`);
        if (res.ok) {
            return await res.json();
        }
    } catch (e) {
        console.error('Failed to fetch user:', e);
    }
    return null;
}

function renderChatList() {
    const container = document.getElementById('contacts-list');
    const btnContainer = document.getElementById('empty-chat-btn-container');
    
    // Get button element if btnContainer exists
    const btn = btnContainer ? btnContainer.querySelector('button') : null;
    
    // Sort chats by last message time (newest first)
    const sortedChats = Array.from(chats.values()).sort((a, b) => {
        return b.lastMessageTime - a.lastMessageTime;
    });
    
    // Clear container
    container.innerHTML = '';
    
    if (sortedChats.length === 0) {
        if (btnContainer) {
            btnContainer.style.display = 'flex';
            container.appendChild(btnContainer);
        }
        return;
    }
    
    // Hide button when there are chats
    if (btnContainer) {
        btnContainer.style.display = 'none';
    }
    
    sortedChats.forEach(chat => {
        const div = document.createElement('div');
        div.className = 'chat-item' + (currentChat === chat.userId ? ' active' : '');
        div.onclick = () => selectChat(chat.userId);
        
        const initial = chat.username.charAt(0).toUpperCase();
        const timeStr = formatChatListTime(chat.lastMessageTime);
        const preview = chat.lastMessage ? truncateText(chat.lastMessage, 30) : 'No messages yet';
        
        div.innerHTML = `
            <div class="chat-avatar">${initial}</div>
            <div class="chat-content">
                <div class="chat-header-row">
                    <div class="chat-username">${escapeHtml(chat.username)}</div>
                    <div class="chat-time">${timeStr}</div>
                </div>
                <div class="chat-preview">${escapeHtml(preview)}</div>
            </div>
        `;
        
        container.appendChild(div);
    });
}

function selectChat(chatUserId) {
    currentChat = chatUserId;
    const chat = chats.get(chatUserId);
    
    if (!chat) return;
    
    // Update UI
    document.getElementById('empty-state').style.display = 'none';
    document.getElementById('active-chat').style.display = 'flex';
    
    // Update chat header
    document.getElementById('chat-username').textContent = chat.username;
    document.getElementById('chat-status').textContent = '';
    document.getElementById('chat-avatar').textContent = chat.username.charAt(0).toUpperCase();
    
    // Update sidebar selection
    renderChatList();
    
    // Load messages
    loadMessages(chatUserId);
    
    // Focus input
    document.getElementById('message-input').focus();
}

async function loadMessages(chatUserId) {
    const container = document.getElementById('messages');
    container.innerHTML = '';
    
    try {
        const res = await apiRequest(`/messages/${chatUserId}`);
        
        if (!res.ok) {
            throw new Error('Failed to load messages: ' + res.statusText);
        }
        
        const messages = await res.json();
        
        messagesMap.set(chatUserId, messages);
        
        messages.reverse().forEach(msg => displayMessage(msg));
        
        scrollToBottom();
        
    } catch (e) {
        console.error('Failed to load messages:', e);
    }
}

function displayMessage(msg) {
    const container = document.getElementById('messages');
    const isOutgoing = msg.sender_id === userId;
    
    const div = document.createElement('div');
    div.className = `message ${isOutgoing ? 'outgoing' : 'incoming'}`;
    
    const text = decodePayload(msg.payload);
    const time = formatMessageTime(new Date(msg.created_at));
    
    div.innerHTML = `
        <div class="message-text">${escapeHtml(text)}</div>
        <div class="message-time">${time}</div>
    `;
    
    container.appendChild(div);
    scrollToBottom();
}

function decodePayload(payload) {
    // Payload is now a string directly from server
    return String(payload);
}

function sendMessage() {
    const input = document.getElementById('message-input');
    const text = input.value.trim();
    
    if (!text || !currentChat) return;
    
    // Send payload as string directly
    const msg = {
        receiver_id: currentChat,
        payload: text
    };
    
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(msg));
    } else {
        console.warn('WebSocket not connected, message not sent');
        return;
    }
    
    // Clear input and resize
    input.value = '';
    input.style.height = 'auto';
    
    // Optimistically add to UI (will be replaced by server response)
    const optimisticMsg = {
        id: 'temp-' + Date.now(),
        sender_id: userId,
        receiver_id: currentChat,
        payload: text,
        created_at: new Date().toISOString()
    };
    
    displayMessage(optimisticMsg);
    
    // Update chat list
    updateChatFromMessage(currentChat, optimisticMsg);
}

// ==================== NEW CHAT MODAL ====================

function showNewChatModal() {
    const modal = document.getElementById('new-chat-modal');
    modal.classList.add('active');
    document.getElementById('new-chat-username').value = '';
    document.getElementById('new-chat-error').textContent = '';
    document.getElementById('new-chat-username').focus();
}

function closeNewChatModal() {
    document.getElementById('new-chat-modal').classList.remove('active');
}

async function createChatByUsername() {
    const username = document.getElementById('new-chat-username').value.trim();
    const errorEl = document.getElementById('new-chat-error');
    errorEl.textContent = '';
    
    if (!username) {
        errorEl.textContent = 'Username required';
        return;
    }
    
    try {
        const res = await apiRequest(`/users?username=${encodeURIComponent(username)}`);
        if (res.status === 404) {
            errorEl.textContent = 'User not found';
            return;
        }
        if (!res.ok) {
            throw new Error('Failed to find user: ' + res.statusText);
        }
        
        const user = await res.json();
        startNewChat(user.id, user.username);
    } catch (e) {
        errorEl.textContent = e.message;
    }
}

function startNewChat(userId, username) {
    // Check if chat already exists
    if (conversationPartners.has(userId)) {
        document.getElementById('new-chat-error').textContent = 
            `A chat with ${username} already exists.`;
        
        // Highlight existing chat
        const chat = chats.get(userId);
        if (chat) {
            selectChat(userId);
        }
        
        closeNewChatModal();
        return;
    }
    
    // Add to chats
    chats.set(userId, {
        userId: userId,
        username: username,
        lastMessage: '',
        lastMessageTime: new Date()
    });
    conversationPartners.add(userId);
    
    // Close modal
    closeNewChatModal();
    
    // Select the new chat
    selectChat(userId);
    
    // Re-render chat list
    renderChatList();
}

// ==================== UTILITY FUNCTIONS ====================

function formatChatListTime(date) {
    if (!date) return '';
    
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const messageDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    
    if (messageDate.getTime() === today.getTime()) {
        // Today: show time
        return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
    } else if (messageDate.getTime() === yesterday.getTime()) {
        // Yesterday
        return 'Yesterday';
    } else {
        // Older: show date
        return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    }
}

function formatMessageTime(date) {
    if (!date) return '';
    
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const messageDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    
    if (messageDate.getTime() === today.getTime()) {
        // Same day: show time only
        return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
    } else {
        // Different day: show date and time
        return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ', ' +
               date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
    }
}

function truncateText(text, maxLength) {
    if (!text) return '';
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength) + '...';
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function scrollToBottom() {
    const container = document.getElementById('messages-container');
    container.scrollTop = container.scrollHeight;
}

function setupInputResize() {
    const input = document.getElementById('message-input');
    
    input.addEventListener('input', function() {
        this.style.height = 'auto';
        this.style.height = Math.min(this.scrollHeight, 120) + 'px';
    });
    
    input.addEventListener('keydown', function(e) {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });
}

// Enter key listener for new chat username input
document.getElementById('new-chat-username')?.addEventListener('keydown', function(e) {
    if (e.key === 'Enter') {
        createChatByUsername();
    }
});

// Close modal on outside click
document.getElementById('new-chat-modal')?.addEventListener('click', function(e) {
    if (e.target === this) {
        closeNewChatModal();
    }
});

// Keyboard shortcuts
document.addEventListener('keydown', function(e) {
    // Escape to close modal
    if (e.key === 'Escape') {
        closeNewChatModal();
    }
});
