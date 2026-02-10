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
let messageStatus = new Map(); // messageId -> 'sending' | 'delivered' | 'read'

const API_URL = '/api';

function isValidUsername(username) {
    const usernameRegex = /^[a-zA-Z0-9]+$/;
    return usernameRegex.test(username);
}

async function apiRequest(endpoint, options = {}) {
    try {
        const res = await fetch(`${API_URL}${endpoint}`, {
            ...options,
            headers: {
                'Authorization': `Bearer ${token}`,
                ...options.headers
            },
            signal: options.signal || AbortSignal.timeout(10000)
        });
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

    if (!isValidUsername(username)) {
        errorEl.textContent = 'Username must contain only latin letters and digits';
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

    if (!isValidUsername(username)) {
        errorEl.textContent = 'Username must contain only latin letters and digits';
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
        
        await initApp();
    } catch (e) {
        errorEl.textContent = 'Network error: ' + e.message;
    }
}

function logout() {
    localStorage.clear();
    token = null;
    userId = null;
    currentUser = null;
    currentChat = null;
    chats.clear();
    messagesMap.clear();
    
    document.getElementById('messages').innerHTML = '';
    document.getElementById('empty-state').style.display = 'flex';
    document.getElementById('active-chat').style.display = 'none';
    
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
        
        // Load current user info
        const meRes = await apiRequest('/me');
        if (meRes.status === 401) {
            logout();
            return;
        }
        if (meRes.ok) {
            const me = await meRes.json();
            currentUser = me;
            userId = me.id;
            localStorage.setItem('userId', userId);
            document.getElementById('current-user').textContent = me.username;
        }
        
        // Load chats
        await loadChats();
        
        // Initialize WebSocket
        initWebSocket();
        
        // Setup message input auto-resize
        setupInputResize();
        
        // Request notification permission
        requestNotificationPermission();
        
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
    if (msg.type === 'read') {
        handleReadStatus(msg);
        return;
    }

    const partnerId = msg.sender_id === userId ? msg.receiver_id : msg.sender_id;
    
    // Add to messages map
    if (!messagesMap.has(partnerId)) {
        messagesMap.set(partnerId, []);
    }
    messagesMap.get(partnerId).push(msg);
    
    // Update chat list
    updateChatFromMessage(partnerId, msg);
    
    
    // Show push notification for incoming messages
    if (msg.sender_id !== userId) {
        const text = decodePayload(msg.payload);
        const chat = chats.get(partnerId);
        const senderName = chat ? chat.username : 'User';
        showNotification(senderName, text, partnerId);
    }

    // If this is the active chat, display it (or replace optimistic)
    if (currentChat === partnerId) {
        // Try to replace optimistic message first
        if (msg.sender_id === userId) {
            const replaced = replaceOptimisticMessage(msg);
            if (!replaced) {
                // If no optimistic found, display as new
                displayMessage(msg, '', 'delivered');
            }
        } else {
            displayMessage(msg, '', 'delivered');
        }
    }
}

function handleReadStatus(msg) {
    if (msg.reader_id && msg.partner_id === userId) {
        markOutgoingAsRead(msg.reader_id);
    }
}

function markOutgoingAsRead(partnerId) {
    const container = document.getElementById('messages');
    const outgoingMessages = container.querySelectorAll('.message.outgoing');
    outgoingMessages.forEach(msgDiv => {
        msgDiv.classList.remove('sending', 'delivered');
        msgDiv.classList.add('read');
    });
}

// ==================== CHAT LIST ====================

async function loadChats() {
    try {
        const res = await apiRequest('/chats');
        
        if (res.status === 401) {
            logout();
            return;
        }
        
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
                lastMessageTime: new Date(chat.last_message_time),
                unreadCount: chat.unread_count || 0
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
    const emptyContainer = document.getElementById('empty-state-container');
    
    // Sort chats by last message time (newest first)
    const sortedChats = Array.from(chats.values()).sort((a, b) => {
        return b.lastMessageTime - a.lastMessageTime;
    });
    
    // Clear container (but keep empty state container)
    container.innerHTML = '';
    
    if (sortedChats.length === 0) {
        if (emptyContainer) {
            emptyContainer.style.display = 'flex';
            container.appendChild(emptyContainer);
        }
        return;
    }
    
    // Hide empty state when there are chats
    if (emptyContainer) {
        emptyContainer.style.display = 'none';
    }
    
    sortedChats.forEach(chat => {
        const div = document.createElement('div');
        div.className = 'chat-item' + (currentChat === chat.userId ? ' active' : '');
        div.onclick = () => selectChat(chat.userId);
        
        const timeStr = formatChatListTime(chat.lastMessageTime);
        const preview = chat.lastMessage ? truncateText(chat.lastMessage, 30) : 'No messages yet';
        
        const unreadBadge = chat.unreadCount > 0 
            ? `<div class="unread-badge">${chat.unreadCount}</div>` 
            : '';
        
        div.innerHTML = `
            <div class="chat-content">
                <div class="chat-header-row">
                    <div class="chat-username">${escapeHtml(chat.username)}</div>
                    <div class="chat-time">${timeStr}</div>
                </div>
                <div class="chat-preview-row">
                    <div class="chat-preview">${escapeHtml(preview)}</div>
                    ${unreadBadge}
                </div>
            </div>
        `;
        
        container.appendChild(div);
    });
}

async function selectChat(chatUserId) {
    currentChat = chatUserId;
    const chat = chats.get(chatUserId);
    
    if (!chat) return;
    
    // Update UI
    document.getElementById('empty-state').style.display = 'none';
    document.getElementById('active-chat').style.display = 'flex';
    
    // Update chat header
    document.getElementById('chat-username').textContent = chat.username;
    document.getElementById('chat-status').textContent = '';
    
    // Clear unread count and re-render sidebar
    chat.unreadCount = 0;
    renderChatList();
    
    // Load messages
    await loadMessages(chatUserId);
    
    // Send read status via WebSocket
    sendReadStatus(chatUserId);
    
    // Focus input
    document.getElementById('message-input').focus();
}

function sendReadStatus(partnerId) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
            type: 'read',
            partner_id: partnerId
        }));
    }
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
        
        messages.reverse().forEach(msg => {
            const isOutgoing = msg.sender_id === userId;
            displayMessage(msg, '', isOutgoing ? 'delivered' : 'delivered');
        });
        
    } catch (e) {
        console.error('Failed to load messages:', e);
    }
    
    scrollToBottom();
}

function displayMessage(msg, status = '', forcedStatus = '') {
    const container = document.getElementById('messages');
    const isOutgoing = msg.sender_id === userId;
    
    const actualStatus = forcedStatus || (status || (isOutgoing ? 'sending' : 'delivered'));
    
    const div = document.createElement('div');
    div.className = `message ${isOutgoing ? 'outgoing' : 'incoming'} ${actualStatus}`;
    div.dataset.messageId = msg.id;
    
    const text = decodePayload(msg.payload);
    const time = formatMessageTime(new Date(msg.created_at));
    
    div.innerHTML = `
        <div class="message-text">${escapeHtml(text)}</div>
        <div class="message-time">${time}</div>
    `;
    
    container.appendChild(div);
    scrollToBottom();
}

function replaceOptimisticMessage(serverMsg) {
    const container = document.getElementById('messages');
    const text = decodePayload(serverMsg.payload);
    
    // Find optimistic message by content (sent by current user)
    const sendingMsgs = container.querySelectorAll('.message.sending');
    for (const msgDiv of sendingMsgs) {
        const msgText = msgDiv.querySelector('.message-text').textContent;
        if (msgText === text && serverMsg.sender_id === userId) {
            // Replace with confirmed message (delivered status)
            msgDiv.classList.remove('sending');
            msgDiv.classList.add('delivered');
            msgDiv.dataset.messageId = serverMsg.id;
            return true;
        }
    }
    return false;
}

function decodePayload(payload) {
    // Payload is now a string directly from server
    return String(payload);
}

// ==================== PUSH NOTIFICATIONS ====================

function requestNotificationPermission() {
    if (!('Notification' in window)) {
        console.log('Browser does not support notifications');
        return;
    }
    
    if (Notification.permission === 'default') {
        Notification.requestPermission().then(permission => {
            console.log('Notification permission:', permission);
        });
    }
}

function showNotification(title, body, chatUserId) {
    if (!('Notification' in window)) {
        return;
    }
    
    if (Notification.permission !== 'granted') {
        return;
    }
    
    // Don't show notification if the chat is currently active and window is focused
    if (currentChat === chatUserId && document.hasFocus()) {
        return;
    }
    
    const notification = new Notification(title, {
        body: body,
        icon: '/favicon.ico',
        tag: 'chat-' + chatUserId // Group notifications by chat
    });
    
    notification.onclick = function() {
        window.focus();
        if (chats.has(chatUserId)) {
            selectChat(chatUserId);
        }
        notification.close();
    };
    
    // Auto-close after 5 seconds
    setTimeout(() => notification.close(), 5000);
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
    
    // Optimistically add to UI with sending status
    const optimisticMsg = {
        id: 'temp-' + Date.now(),
        sender_id: userId,
        receiver_id: currentChat,
        payload: text,
        created_at: new Date().toISOString()
    };
    
    displayMessage(optimisticMsg, 'sending');
    
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

async function startNewChat(userId, username) {
    // Check if chat already exists
    if (conversationPartners.has(userId)) {
        document.getElementById('new-chat-error').textContent = 
            `A chat with ${username} already exists.`;
        
        // Highlight existing chat
        const chat = chats.get(userId);
        if (chat) {
            await selectChat(userId);
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
    await selectChat(userId);
    
    // Re-render chat list
    renderChatList();
}

// ==================== CHANGE PASSWORD MODAL ====================

function showChangePasswordModal() {
    const modal = document.getElementById('change-password-modal');
    modal.classList.add('active');
    document.getElementById('old-password').value = '';
    document.getElementById('new-password').value = '';
    document.getElementById('confirm-password').value = '';
    document.getElementById('change-password-error').textContent = '';
    document.getElementById('change-password-success').textContent = '';
    document.getElementById('old-password').focus();
}

function closeChangePasswordModal() {
    document.getElementById('change-password-modal').classList.remove('active');
}

async function changePassword() {
    const oldPassword = document.getElementById('old-password').value;
    const newPassword = document.getElementById('new-password').value;
    const confirmPassword = document.getElementById('confirm-password').value;
    const errorEl = document.getElementById('change-password-error');
    const successEl = document.getElementById('change-password-success');
    
    errorEl.textContent = '';
    successEl.textContent = '';
    
    // Validation
    if (!oldPassword) {
        errorEl.textContent = 'Current password is required';
        return;
    }
    
    if (!newPassword) {
        errorEl.textContent = 'New password is required';
        return;
    }
    
    if (newPassword.length < 5) {
        errorEl.textContent = 'New password must be at least 5 characters';
        return;
    }
    
    if (newPassword !== confirmPassword) {
        errorEl.textContent = 'Passwords do not match';
        return;
    }
    
    try {
        const res = await apiRequest('/auth/change-password', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                old_password: oldPassword,
                new_password: newPassword
            })
        });
        
        if (res.status === 401) {
            errorEl.textContent = 'Session expired. Please login again.';
            setTimeout(() => logout(), 2000);
            return;
        }
        
        if (!res.ok) {
            const data = await res.json();
            errorEl.textContent = data.error || 'Failed to change password';
            return;
        }
        
        successEl.textContent = 'Password changed successfully';
        
        // Clear fields
        document.getElementById('old-password').value = '';
        document.getElementById('new-password').value = '';
        document.getElementById('confirm-password').value = '';
        
        // Close modal after 1.5 seconds
        setTimeout(() => {
            closeChangePasswordModal();
        }, 1500);
        
    } catch (e) {
        errorEl.textContent = 'Network error: ' + e.message;
    }
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

// Setup all event listeners when DOM is ready
function setupEventListeners() {
    // Enter key listener for login inputs
    const usernameInput = document.getElementById('username');
    const passwordInput = document.getElementById('password');
    
    [usernameInput, passwordInput].forEach(input => {
        if (input) {
            input.addEventListener('keydown', function(e) {
                if (e.key === 'Enter') {
                    login();
                }
            });
        }
    });
    
    // Enter key listener for new chat username input
    const newChatInput = document.getElementById('new-chat-username');
    if (newChatInput) {
        newChatInput.addEventListener('keydown', function(e) {
            if (e.key === 'Enter') {
                createChatByUsername();
            }
        });
    }
    
    // Enter key listener for change password inputs
    const oldPasswordInput = document.getElementById('old-password');
    const newPasswordInput = document.getElementById('new-password');
    const confirmPasswordInput = document.getElementById('confirm-password');
    
    [oldPasswordInput, newPasswordInput, confirmPasswordInput].forEach(input => {
        if (input) {
            input.addEventListener('keydown', function(e) {
                if (e.key === 'Enter') {
                    changePassword();
                }
            });
        }
    });
    
    // Close modals on outside click
    const newChatModal = document.getElementById('new-chat-modal');
    if (newChatModal) {
        newChatModal.addEventListener('click', function(e) {
            if (e.target === this) {
                closeNewChatModal();
            }
        });
    }
    
    const changePasswordModal = document.getElementById('change-password-modal');
    if (changePasswordModal) {
        changePasswordModal.addEventListener('click', function(e) {
            if (e.target === this) {
                closeChangePasswordModal();
            }
        });
    }
    
    // Keyboard shortcuts
    document.addEventListener('keydown', function(e) {
        // Escape to close modals
        if (e.key === 'Escape') {
            closeNewChatModal();
            closeChangePasswordModal();
        }
    });
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setupEventListeners);
} else {
    setupEventListeners();
}
