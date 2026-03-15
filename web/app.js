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
let viewMode = 'sidebar'; // 'sidebar' | 'chat' - for mobile
let lastDataRefresh = 0;
let refreshDebounceTimer = null;
let messagesAbortController = null;
let pingInterval = null;
let pongTimeout = null;
let reconnectAttempts = 0;
const MAX_RECONNECT_DELAY = 30000;
const PING_INTERVAL = 30000;
const PONG_TIMEOUT = 10000;

// Typing status variables
let typingDebounceTimer = null;
let typingHideTimer = null;
let currentTypingPreview = null;
const TYPING_DEBOUNCE = 2000;
const TYPING_HIDE_DELAY = 5000;

// Scroll state management
let scrollState = {
    isUserScrolling: false,
    lastScrollPosition: 0,
    shouldPreservePosition: false,
    autoScrollTimeout: null
};

// Call state variables
let callManager = null;
let mediaUtils = null;
let activeCall = null;
let incomingCall = null;  // Store incoming call data
let callTimerInterval = null;
let callStartTime = null;

// Favicon switching for unread messages
const ORIGINAL_FAVICON = '/favicon.ico';
const UNREAD_FAVICON = '/unread.ico';

function setUnreadFavicon() {
    const link = document.querySelector('link[rel="icon"]');
    if (link && link.href !== UNREAD_FAVICON) {
        link.href = UNREAD_FAVICON;
    }
}

function setOriginalFavicon() {
    const link = document.querySelector('link[rel="icon"]');
    if (link && link.href !== ORIGINAL_FAVICON) {
        link.href = ORIGINAL_FAVICON;
    }
}

function updateDocumentTitle() {
    let totalUnread = 0;
    chats.forEach(chat => {
        totalUnread += chat.unreadCount || 0;
    });

    if (totalUnread > 0) {
        document.title = `(${totalUnread}) Blank`;
    } else {
        document.title = 'Blank';
    }
}

const API_URL = '/api';
const DATA_REFRESH_THROTTLE = 30000;

function isValidUsername(username) {
    const usernameRegex = /^[a-zA-Z0-9]+$/;
    return usernameRegex.test(username);
}

function getCsrfToken() {
    const meta = document.querySelector('meta[name="csrf-token"]');
    return meta ? meta.content : '';
}

async function apiRequest(endpoint, options = {}) {
    try {
        const res = await fetch(`${API_URL}${endpoint}`, {
            ...options,
            headers: {
                'Authorization': `Bearer ${token}`,
                'X-CSRF-Token': getCsrfToken(),
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

function logout() {
    // Clear localStorage
    localStorage.removeItem('token');
    localStorage.removeItem('userId');
    
    // Close WebSocket
    if (ws) {
        ws.close();
        ws = null;
    }
    
    // Clear intervals
    clearInterval(pingInterval);
    clearTimeout(pongTimeout);
    clearTimeout(refreshDebounceTimer);
    
    // Reset state
    token = null;
    userId = null;
    currentUser = null;
    currentChat = null;
    chats.clear();
    messagesMap.clear();
    messageStatus.clear();
    conversationPartners.clear();
    reconnectAttempts = 0;
    
    // Hide loading and show auth
    hideLoading();
    showAuth();
}

function showLoading() {
    document.getElementById('loading-screen').classList.remove('hidden');
    document.getElementById('auth-section').classList.add('hidden');
    document.getElementById('chat-section').classList.add('hidden');
}

function hideLoading() {
    document.getElementById('loading-screen').classList.add('hidden');
}

// Initialize application
if (token) {
    showLoading();
    initApp();
} else {
    hideLoading();
    showAuth();
}

// ==================== AUTHENTICATION ====================

function showAuth() {
    document.getElementById('auth-section').style.display = 'flex';
    document.getElementById('chat-section').classList.add('hidden');
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

    if (password.length < 5) {
        errorEl.textContent = 'Password must be at least 5 characters';
        return;
    }

    try {
        const res = await fetch(`${API_URL}/auth/login`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRF-Token': getCsrfToken()
            },
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

        document.getElementById('auth-section').style.display = 'none';

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

    if (password.length < 5) {
        errorEl.textContent = 'Password must be at least 5 characters';
        return;
    }

    try {
        const res = await fetch(`${API_URL}/auth/register`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRF-Token': getCsrfToken()
            },
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

        document.getElementById('auth-section').style.display = 'none';

        await initApp();
    } catch (e) {
        errorEl.textContent = 'Network error: ' + e.message;
    }
}

// ==================== APP INITIALIZATION ====================

async function initApp() {
    try {
        document.getElementById('auth-section').classList.add('hidden');
        document.getElementById('chat-section').classList.remove('hidden');
        hideLoading();
        
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
        hideLoading();
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
        reconnectAttempts = 0;
        setupPing();
    };

    ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        if (msg.type === 'pong') {
            clearTimeout(pongTimeout);
            return;
        }
        handleIncomingMessage(msg);
    };

    ws.onclose = () => {
        console.log('WebSocket disconnected');
        clearInterval(pingInterval);
        clearTimeout(pongTimeout);
        
        const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), MAX_RECONNECT_DELAY);
        console.log(`Reconnecting in ${delay}ms...`);
        setTimeout(initWebSocket, delay);
        reconnectAttempts++;
    };

    ws.onerror = (err) => {
        console.error('WebSocket error:', err);
    };
}

function setupPing() {
    clearInterval(pingInterval);
    clearTimeout(pongTimeout);
    
    pingInterval = setInterval(() => {
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'ping' }));
            
            pongTimeout = setTimeout(() => {
                console.warn('Pong not received, closing connection...');
                ws.close();
            }, PONG_TIMEOUT);
        }
    }, PING_INTERVAL);
}

function handleIncomingMessage(msg) {
    // Handle call messages first
    if (['call_start', 'call_offer', 'call_answer', 'call_ice_candidate', 
         'call_join', 'call_leave', 'call_end', 'call_reject'].includes(msg.type)) {
        handleCallMessage(msg);
        return;
    }
    
    if (msg.type === 'read') {
        handleReadStatus(msg);
        return;
    }

    if (msg.type === 'delivered') {
        handleDeliveryStatus(msg);
        return;
    }

    if (msg.type === 'typing') {
        handleTypingStatus(msg);
        return;
    }

    const partnerId = msg.sender_id === userId ? msg.receiver_id : msg.sender_id;
    const isIncoming = msg.sender_id !== userId;

    // Add to messages map
    if (!messagesMap.has(partnerId)) {
        messagesMap.set(partnerId, []);
    }
    messagesMap.get(partnerId).push(msg);

    // Update chat list (includes unread count increment for non-active chats)
    updateChatFromMessage(partnerId, msg, isIncoming && currentChat !== partnerId);

    // Show push notification for incoming messages
    if (isIncoming) {
        const text = decodePayload(msg.payload);
        const chat = chats.get(partnerId);
        const senderName = chat ? chat.username : 'User';
        showNotification(senderName, text, partnerId);
        
        // Send delivery confirmation
        sendDeliveryStatus(msg.id);
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
            displayMessage(msg, '', '');
            
            // Auto-scroll only if user was at bottom
            if (isUserAtBottom()) {
                smartScrollToBottom(200);
            }

            // Send read status for incoming message in active chat
            sendReadStatus(partnerId);
        }
    } else if (isIncoming) {
        // Incoming message in non-active chat - update UI
        updateDocumentTitle();
        setUnreadFavicon();
    }
}

function handleTypingStatus(msg) {
    if (!currentChat || currentChat !== msg.sender_id) {
        return;
    }

    clearTimeout(typingHideTimer);

    if (currentTypingPreview) {
        updateTypingPreview(msg.text);
    } else {
        showTypingPreview(msg.text);
    }

    typingHideTimer = setTimeout(() => {
        hideTypingPreview();
    }, TYPING_HIDE_DELAY);
}

function showTypingPreview(text) {
    const container = document.getElementById('messages');
    if (!container) return;

    currentTypingPreview = document.createElement('div');
    currentTypingPreview.className = 'typing-preview';
    currentTypingPreview.innerHTML = `<div class="typing-preview-text">${escapeHtml(text)}</div>`;
    
    container.appendChild(currentTypingPreview);
    smartScrollToBottom(100);
}

function updateTypingPreview(text) {
    if (!currentTypingPreview) return;
    
    const textEl = currentTypingPreview.querySelector('.typing-preview-text');
    if (textEl) {
        textEl.textContent = text;
    }
}

function hideTypingPreview() {
    if (currentTypingPreview && currentTypingPreview.parentNode) {
        currentTypingPreview.remove();
        currentTypingPreview = null;
    }
}

function handleDeliveryStatus(msg) {
    const selector = `.message.outgoing[data-message-id="${msg.message_id}"]`;
    document.querySelectorAll(selector).forEach(msgDiv => {
        if (msgDiv.classList.contains('sending')) {
            msgDiv.classList.remove('sending');
            msgDiv.classList.add('delivered');
        }
    });
}

function handleReadStatus(msg) {
    if (msg.partner_id === userId) {
        markOutgoingAsRead(msg.reader_id);
    }
}

function markOutgoingAsRead(readerId) {
    const selector = `.message.outgoing[data-receiver-id="${readerId}"]`;
    document.querySelectorAll(selector).forEach(msgDiv => {
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
                lastMessageTime: chat.last_message_time ? new Date(chat.last_message_time) : new Date(0),
                unreadCount: chat.unread_count || 0
            });
            conversationPartners.add(chat.user_id);
        });
        
        renderChatList();
        updateDocumentTitle();
        
    } catch (e) {
        console.error('Failed to load chats:', e);
    }
}

async function refreshAllData(options = {}) {
    const { preserveScroll = true } = options;
    if (!token) return;
    
    const now = Date.now();
    if (now - lastDataRefresh < DATA_REFRESH_THROTTLE) return;
    
    lastDataRefresh = now;
    await loadChats();
    
    if (currentChat) {
        await loadMessages(currentChat, preserveScroll);
    }
    
    if (!ws || ws.readyState !== WebSocket.OPEN) {
        initWebSocket();
    }
}

function updateChatFromMessage(partnerId, msg, incrementUnread = false) {
    const text = decodePayload(msg.payload);
    const chat = chats.get(partnerId);

    if (chat) {
        chat.lastMessage = text;
        chat.lastMessageTime = new Date(msg.created_at);
        if (incrementUnread) {
            chat.unreadCount = (chat.unreadCount || 0) + 1;
        }
    } else {
        // New chat - need to fetch user info
        fetchUserInfo(partnerId).then(user => {
            if (user) {
                chats.set(partnerId, {
                    userId: partnerId,
                    username: user.username,
                    lastMessage: text,
                    lastMessageTime: new Date(msg.created_at),
                    unreadCount: incrementUnread ? 1 : 0
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
        // Handle invalid dates - push them to the bottom
        if (!a.lastMessageTime || isNaN(a.lastMessageTime.getTime())) return 1;
        if (!b.lastMessageTime || isNaN(b.lastMessageTime.getTime())) return -1;
        return b.lastMessageTime - a.lastMessageTime;
    });

    // Remove only chat items, keep empty state container
    const chatItems = container.querySelectorAll('.chat-item');
    chatItems.forEach(item => item.remove());

    if (sortedChats.length === 0) {
        // No chats - show empty state
        if (emptyContainer) {
            emptyContainer.classList.remove('hidden');
        }
        return;
    }

    // Hide empty state when there are chats
    if (emptyContainer) {
        emptyContainer.classList.add('hidden');
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
    hideTypingPreview();
    clearTimeout(typingDebounceTimer);
    
    currentChat = chatUserId;
    const chat = chats.get(chatUserId);
    
    if (!chat) return;
    
    if (window.innerWidth <= 600) {
        viewMode = 'chat';
        document.getElementById('chat-window').classList.add('active');
        document.getElementById('sidebar').classList.add('hidden-mobile');
    }
    
    document.getElementById('empty-state').style.display = 'none';
    document.getElementById('active-chat').classList.remove('hidden');
    
    document.getElementById('chat-username').textContent = chat.username;
    document.getElementById('chat-status').textContent = '';
    
    chat.unreadCount = 0;
    renderChatList();
    updateDocumentTitle();
    
    // Reset favicon when opening chat with unread messages
    setOriginalFavicon();
    
    await loadMessages(chatUserId, false);
    
    sendReadStatus(chatUserId);
    
    document.getElementById('message-input').focus();
}

function goToSidebar() {
    hideTypingPreview();
    clearTimeout(typingDebounceTimer);
    
    viewMode = 'sidebar';
    currentChat = null;
    
    document.getElementById('chat-window').classList.remove('active');
    document.getElementById('sidebar').classList.remove('hidden-mobile');
    
    document.getElementById('active-chat').classList.add('hidden');
    document.getElementById('empty-state').style.display = 'flex';
    
    renderChatList();
}

function sendReadStatus(partnerId) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
            type: 'read',
            partner_id: partnerId
        }));
    }
}

function sendDeliveryStatus(messageId) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
            type: 'delivered',
            message_id: messageId
        }));
    }
}

async function loadMessages(chatUserId, preserveScroll = false) {
    messagesAbortController?.abort();
    messagesAbortController = new AbortController();
    
    const container = document.getElementById('messages');
    const messagesContainer = document.getElementById('messages-container');
    
    // Save scroll position before clearing container
    saveScrollPosition();
    
    // Clear container
    container.innerHTML = '';
    
    // Scroll to bottom immediately when clearing (before messages load)
    if (!preserveScroll) {
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }
    
    try {
        const res = await apiRequest(`/messages/${chatUserId}`, {
            signal: messagesAbortController.signal
        });
        
        if (!res.ok) {
            throw new Error('Failed to load messages: ' + res.statusText);
        }
        
        const messages = await res.json();
        
        messagesMap.set(chatUserId, messages);
        
        messages.reverse().forEach(msg => {
            const isOutgoing = msg.sender_id === userId;
            if (isOutgoing) {
                let status = 'sending';
                if (msg.is_read) {
                    status = 'read';
                } else if (msg.is_delivered) {
                    status = 'delivered';
                }
                displayMessage(msg, '', status);
            } else {
                displayMessage(msg, '', '');
            }
        });
        
        // Restore scroll position after messages are rendered
        requestAnimationFrame(() => {
            if (preserveScroll) {
                restoreScrollPosition();
            } else {
                smartScrollToBottom(100, true); // Small delay to ensure DOM is updated
            }
        });
        
    } catch (e) {
        if (e.name === 'AbortError') return;
        console.error('Failed to load messages:', e);
    }
}

function displayMessage(msg, status = '', forcedStatus = '') {
    const container = document.getElementById('messages');
    const isOutgoing = msg.sender_id === userId;
    
    const actualStatus = forcedStatus || status || (isOutgoing ? 'sending' : '');
    
    const div = document.createElement('div');
    div.className = `message ${isOutgoing ? 'outgoing' : 'incoming'} ${actualStatus}`;
    div.dataset.messageId = msg.id;
    if (isOutgoing) {
        div.dataset.receiverId = msg.receiver_id;
    }
    
    const text = decodePayload(msg.payload);
    const time = formatMessageTime(new Date(msg.created_at));
    
    div.innerHTML = `
        <div class="message-text">${escapeHtml(text)}</div>
        <div class="message-time">${time}</div>
    `;
    
    container.appendChild(div);
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
    
    input.value = '';
    input.style.height = 'auto';
    
    hideTypingPreview();
    clearTimeout(typingDebounceTimer);
    sendTypingStopped();
    
    const optimisticMsg = {
        id: 'temp-' + Date.now(),
        sender_id: userId,
        receiver_id: currentChat,
        payload: text,
        created_at: new Date().toISOString()
    };
    
    displayMessage(optimisticMsg, 'sending');
    
    updateChatFromMessage(currentChat, optimisticMsg);
    
    // Auto-scroll to bottom
    smartScrollToBottom(500);
    
    input.focus();
}

// ==================== NEW CHAT MODAL ====================

let userSearchDebounceTimer = null;
const USER_SEARCH_DEBOUNCE = 300;

function showNewChatModal() {
    const modal = document.getElementById('new-chat-modal');
    const input = document.getElementById('new-chat-username');
    modal.classList.add('active');
    input.value = '';
    document.getElementById('new-chat-error').textContent = '';
    input.focus();

    // Add input event listener for autocomplete
    input.addEventListener('input', handleUserSearchInput);
    // Hide dropdown when clicking outside
    document.addEventListener('click', handleClickOutsideDropdown);

    // Load all users immediately
    searchUsers('');
}

function closeNewChatModal() {
    const modal = document.getElementById('new-chat-modal');
    const input = document.getElementById('new-chat-username');
    const dropdown = document.getElementById('user-search-results');
    modal.classList.remove('active');
    dropdown.classList.add('hidden');

    // Remove event listeners
    input.removeEventListener('input', handleUserSearchInput);
    document.removeEventListener('click', handleClickOutsideDropdown);

    // Clear debounce timer
    clearTimeout(userSearchDebounceTimer);
}

function handleUserSearchInput(e) {
    const query = e.target.value.trim();

    clearTimeout(userSearchDebounceTimer);

    userSearchDebounceTimer = setTimeout(() => {
        searchUsers(query);
    }, USER_SEARCH_DEBOUNCE);
}

async function searchUsers(query) {
    const dropdown = document.getElementById('user-search-results');

    try {
        const res = await apiRequest(`/users/search?q=${encodeURIComponent(query)}`);

        if (!res.ok) {
            hideUserSearchDropdown();
            return;
        }

        const users = await res.json();
        displayUserSearchResults(users);
    } catch (e) {
        console.error('Failed to search users:', e);
        hideUserSearchDropdown();
    }
}

function displayUserSearchResults(users) {
    const dropdown = document.getElementById('user-search-results');
    const input = document.getElementById('new-chat-username');

    if (users.length === 0) {
        hideUserSearchDropdown();
        return;
    }

    dropdown.innerHTML = '';

    users.forEach(user => {
        const div = document.createElement('div');
        div.className = 'dropdown-item';
        div.textContent = user.username;
        div.dataset.userId = user.id;
        div.dataset.username = user.username;
        div.onclick = () => selectUserFromDropdown(user.id, user.username);
        dropdown.appendChild(div);
    });

    dropdown.classList.remove('hidden');
}

function hideUserSearchDropdown() {
    const dropdown = document.getElementById('user-search-results');
    dropdown.classList.add('hidden');
}

function selectUserFromDropdown(userId, username) {
    const input = document.getElementById('new-chat-username');
    input.value = username;
    input.dataset.selectedUserId = userId;
    hideUserSearchDropdown();
}

function handleClickOutsideDropdown(e) {
    const dropdown = document.getElementById('user-search-results');
    const input = document.getElementById('new-chat-username');

    if (!dropdown.contains(e.target) && e.target !== input) {
        hideUserSearchDropdown();
    }
}

async function createChatByUsername() {
    const input = document.getElementById('new-chat-username');
    const username = input.value.trim();
    const errorEl = document.getElementById('new-chat-error');
    errorEl.textContent = '';
    
    if (!username) {
        errorEl.textContent = 'Username required';
        return;
    }
    
    // Check if a user was selected from dropdown
    const selectedUserId = input.dataset.selectedUserId;
    if (selectedUserId) {
        startNewChat(selectedUserId, username);
        delete input.dataset.selectedUserId;
        return;
    }
    
    // Otherwise, search by exact username
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
    const oldPass = document.getElementById('old-password');
    const newPass = document.getElementById('new-password');
    const confirmPass = document.getElementById('confirm-password');

    modal.classList.add('active');
    oldPass.value = '';
    newPass.value = '';
    confirmPass.value = '';
    document.getElementById('change-password-error').textContent = '';
    document.getElementById('change-password-success').textContent = '';
    oldPass.focus();
}

function closeChangePasswordModal() {
    const modal = document.getElementById('change-password-modal');
    modal.classList.remove('active');
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
    if (container) {
        container.scrollTop = container.scrollHeight;
    }
}

function isUserAtBottom() {
    const container = document.getElementById('messages-container');
    if (!container) return false;
    
    const threshold = 50; // pixels from bottom
    return container.scrollHeight - container.scrollTop - container.clientHeight <= threshold;
}

function saveScrollPosition() {
    const container = document.getElementById('messages-container');
    if (container) {
        scrollState.lastScrollPosition = container.scrollTop;
        scrollState.shouldPreservePosition = !isUserAtBottom();
    }
}

function restoreScrollPosition() {
    const container = document.getElementById('messages-container');
    if (container && scrollState.shouldPreservePosition) {
        container.scrollTop = scrollState.lastScrollPosition;
        scrollState.shouldPreservePosition = false;
    }
}

function setupScrollListeners() {
    const container = document.getElementById('messages-container');
    if (container) {
        container.addEventListener('scroll', function() {
            scrollState.isUserScrolling = true;
            
            // Clear auto-scroll timeout if user scrolls manually
            if (scrollState.autoScrollTimeout) {
                clearTimeout(scrollState.autoScrollTimeout);
                scrollState.autoScrollTimeout = null;
            }
            
            // Save scroll position after user stops scrolling
            clearTimeout(this.scrollTimeout);
            this.scrollTimeout = setTimeout(() => {
                scrollState.isUserScrolling = false;
                saveScrollPosition();
            }, 100);
        });
    }
}

function smartScrollToBottom(delay = 0, force = false) {
    if (!force && scrollState.isUserScrolling) {
        // User is scrolling manually, don't interrupt
        return;
    }
    
    if (delay > 0) {
        scrollState.autoScrollTimeout = setTimeout(() => {
            scrollToBottom();
            scrollState.autoScrollTimeout = null;
        }, delay);
    } else {
        scrollToBottom();
    }
}

function resetScrollState() {
    scrollState = {
        isUserScrolling: false,
        lastScrollPosition: 0,
        shouldPreservePosition: false,
        autoScrollTimeout: null
    };
}

function setupInputResize() {
    const input = document.getElementById('message-input');
    
    input.addEventListener('input', function() {
        this.style.height = 'auto';
        this.style.height = Math.min(this.scrollHeight, 120) + 'px';
        
        if (currentChat) {
            handleTypingInput(this.value);
        }
    });
    
    input.addEventListener('keydown', function(e) {
        if ('ontouchstart' in window || navigator.maxTouchPoints > 0) return;
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });
}

function handleTypingInput(text) {
    clearTimeout(typingDebounceTimer);
    
    if (text.trim()) {
        typingDebounceTimer = setTimeout(() => {
            sendTypingStatus(text);
        }, TYPING_DEBOUNCE);
    } else {
        sendTypingStopped();
    }
}

function sendTypingStatus(text) {
    if (!ws || ws.readyState !== WebSocket.OPEN || !currentChat) return;
    
    ws.send(JSON.stringify({
        type: 'typing',
        receiver_id: currentChat,
        text: text
    }));
}

function sendTypingStopped() {
    if (!ws || ws.readyState !== WebSocket.OPEN || !currentChat) return;
    
    ws.send(JSON.stringify({
        type: 'typing',
        receiver_id: currentChat,
        text: ''
    }));
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
    
    // Swipe to go back on mobile
    let touchStartX = 0;
    document.addEventListener('touchstart', function(e) {
        touchStartX = e.touches[0].clientX;
    });
    
    document.addEventListener('touchend', function(e) {
        if (window.innerWidth > 600) return;
        
        const touchEndX = e.changedTouches[0].clientX;
        const diff = touchEndX - touchStartX;
        
        // Swipe right on chat → go to sidebar
        if (diff > 100 && viewMode === 'chat') {
            goToSidebar();
        }
    });
    
// Refresh on tab visibility change (debounced)
document.addEventListener('visibilitychange', function() {
    if (document.visibilityState === 'visible' && token) {
        clearTimeout(refreshDebounceTimer);
        refreshDebounceTimer = setTimeout(() => {
            refreshAllData({ preserveScroll: false });
        }, 500);

        // Reset favicon when tab becomes visible
        setOriginalFavicon();

        // Clear unread count for active chat when returning to tab
        if (currentChat) {
            const chat = chats.get(currentChat);
            if (chat && chat.unreadCount > 0) {
                chat.unreadCount = 0;
                renderChatList();
                updateDocumentTitle();
                sendReadStatus(currentChat);
            }
        }
    }
});

// Refresh on page restore from bfcache
window.addEventListener('pageshow', function(e) {
    if (e.persisted && token) {
        refreshAllData(true); // preserve scroll position
    }
});

// Refresh on network reconnect
window.addEventListener('online', refreshAllData);

// Setup scroll listeners when DOM is ready
document.addEventListener('DOMContentLoaded', setupScrollListeners);
}

// ==================== CALL FUNCTIONS ====================

// Initialize call manager and media utils
// Returns true if initialization was successful, false otherwise
function initCallManager() {
    if (!ws) {
        console.error('Cannot initialize call manager: WebSocket not connected');
        return false;
    }
    
    if (!callManager) {
        try {
            callManager = new CallManager(ws, userId);
        } catch (err) {
            console.error('Failed to create CallManager:', err);
            return false;
        }
    }
    
    if (!mediaUtils) {
        try {
            mediaUtils = new MediaUtils();
        } catch (err) {
            console.error('Failed to create MediaUtils:', err);
            return false;
        }
    }
    
    return true;
}

// Start audio call
async function startAudioCall() {
    if (!currentChat) return;
    
    try {
        if (!initCallManager()) {
            alert('Unable to start call - please check your connection and refresh the page');
            return;
        }
        
        // Get local stream FIRST before creating call
        const stream = await mediaUtils.getLocalStream('audio');
        
        // Attach local stream to video element
        const localVideo = document.getElementById('local-video');
        if (localVideo && stream) {
            localVideo.srcObject = stream;
        }
        
        // Start call with the acquired stream
        const call = await callManager.startCall([currentChat], 'audio', stream);
        activeCall = call;
        
        // Show call modal
        showCallModal(currentChat, 'audio');
        
        // Start timer
        startCallTimer();
        
    } catch (err) {
        console.error('Failed to start audio call:', err);
        alert('Failed to start call: ' + err.message);
    }
}

// Start video call
async function startVideoCall() {
    if (!currentChat) return;
    
    try {
        if (!initCallManager()) {
            alert('Unable to start call - please check your connection and refresh the page');
            return;
        }
        
        // Get local stream FIRST before creating call
        const stream = await mediaUtils.getLocalStream('video');
        
        // Attach local stream to video element
        const localVideo = document.getElementById('local-video');
        if (localVideo && stream) {
            localVideo.srcObject = stream;
        }
        
        // Start call with the acquired stream
        const call = await callManager.startCall([currentChat], 'video', stream);
        activeCall = call;
        
        // Show call modal
        showCallModal(currentChat, 'video');
        
        // Start timer
        startCallTimer();
        
    } catch (err) {
        console.error('Failed to start video call:', err);
        alert('Failed to start call: ' + err.message);
    }
}

// Show call modal
function showCallModal(participantId, callType) {
    const modal = document.getElementById('call-modal');
    const participantName = chats.get(participantId)?.username || 'User';
    const videoContainer = document.getElementById('video-container');
    
    document.getElementById('call-header-title').textContent = callType === 'video' ? 'Video Call' : 'Audio Call';
    document.getElementById('call-participant-name').textContent = participantName;
    
    // Show video container only for video calls
    if (videoContainer) {
        if (callType === 'video') {
            videoContainer.classList.add('active');
        } else {
            videoContainer.classList.remove('active');
        }
    }
    
    modal.classList.add('active');
    document.getElementById('active-chat').classList.add('hidden');
}

// Show call invite modal
function showCallInviteModal(callerId, callType) {
    const modal = document.getElementById('call-invite-modal');
    const callerName = chats.get(callerId)?.username || 'User';
    
    document.getElementById('invite-header-title').textContent = callType === 'video' ? 'Incoming Video Call' : 'Incoming Audio Call';
    document.getElementById('invite-participant-name').textContent = callerName;
    
    modal.classList.add('active');
}

// End call
function endCall() {
    if (activeCall && callManager) {
        callManager.endCall();
        activeCall = null;
    }
    
    // Close modal
    document.getElementById('call-modal').classList.remove('active');
    document.getElementById('call-invite-modal').classList.remove('active');
    
    // Stop timer
    stopCallTimer();
    
    // Stop local stream
    if (mediaUtils) {
        mediaUtils.stopLocalStream();
    }
    
    // Show chat
    if (currentChat) {
        document.getElementById('active-chat').classList.remove('hidden');
    }
}

// Accept call
async function acceptCall() {
    if (!incomingCall || !callManager) {
        return;
    }
    
    try {
        // Initialize media utils if needed
        if (!mediaUtils) {
            mediaUtils = new MediaUtils();
        }
        
        // Get local stream BEFORE joining the call
        // This ensures we have media available when the offer arrives
        const stream = await mediaUtils.getLocalStream(incomingCall.callType);
        
        // Attach local stream to video element
        const localVideo = document.getElementById('local-video');
        if (localVideo && stream) {
            localVideo.srcObject = stream;
        }
        
        // Join the call
        await callManager.joinCall(incomingCall.callId);
        activeCall = incomingCall;
        
        // Clear incoming call
        incomingCall = null;
        
        // Close modal
        document.getElementById('call-invite-modal').classList.remove('active');
        
        // Show call modal
        showCallModal(activeCall.callerId, activeCall.callType);
        startCallTimer();
    } catch (err) {
        console.error('Failed to join call:', err);
        alert('Failed to join call: ' + err.message);
        incomingCall = null;
        document.getElementById('call-invite-modal').classList.remove('active');
    }
}

// Reject call
function rejectCall() {
    if (incomingCall && callManager) {
        callManager.rejectCall(incomingCall.callId);
        incomingCall = null;
    }
    
    // Close modal
    document.getElementById('call-invite-modal').classList.remove('active');
}

// Toggle audio
function toggleAudio() {
    if (mediaUtils) {
        const enabled = mediaUtils.toggleAudio();
        const btn = document.getElementById('mute-btn');
        btn.textContent = enabled ? '🔇' : '🔊';
        btn.title = enabled ? 'Mute' : 'Unmute';
    }
}

// Toggle video
function toggleVideo() {
    if (mediaUtils) {
        const enabled = mediaUtils.toggleVideo();
        const btn = document.getElementById('camera-btn');
        btn.textContent = enabled ? '📹' : '📷';
        btn.title = enabled ? 'Camera On' : 'Camera Off';
    }
}

// Toggle screen share
function toggleScreenShare() {
    // Screen share implementation
    console.log('Screen share toggle');
}

// Start call timer
function startCallTimer() {
    stopCallTimer();
    callStartTime = Date.now();
    callTimerInterval = setInterval(updateCallTimer, 1000);
}

// Update call timer display
function updateCallTimer() {
    if (!callStartTime) return;
    
    const elapsed = Math.floor((Date.now() - callStartTime) / 1000);
    const minutes = Math.floor(elapsed / 60).toString().padStart(2, '0');
    const seconds = (elapsed % 60).toString().padStart(2, '0');
    
    document.getElementById('call-timer').textContent = `${minutes}:${seconds}`;
}

// Stop call timer
function stopCallTimer() {
    if (callTimerInterval) {
        clearInterval(callTimerInterval);
        callTimerInterval = null;
    }
    callStartTime = null;
    document.getElementById('call-timer').textContent = '00:00';
}

// Handle incoming call messages
function handleCallMessage(msg) {
    // Initialize CallManager if not already done
    if (!callManager) {
        initCallManager();
    }
    if (!callManager) {
        console.error('WebRTC not supported or WebSocket not connected');
        // Show user-friendly error for all call message types
        const isIncomingCall = msg.type === 'call_start' && msg.caller_id !== userId;
        const isCallResponse = ['call_offer', 'call_answer', 'call_ice_candidate'].includes(msg.type);
        if (isIncomingCall || isCallResponse) {
            alert('Unable to handle call - please check your connection and refresh the page');
        }
        return;
    }
    
    switch (msg.type) {
        case 'call_start':
            // Handle call_start - update call ID for caller, show invite for callee
            callManager.handleCallStart(msg);
            // Only show invite modal if we're not the caller
            if (msg.caller_id !== userId) {
                incomingCall = {
                    callId: msg.call_id,
                    callerId: msg.caller_id,
                    callType: msg.call_type
                };
                showCallInviteModal(msg.caller_id, msg.call_type);
            }
            break;
        case 'call_offer':
            if (!incomingCall) {
                incomingCall = {
                    callId: msg.call_id,
                    callerId: msg.caller_id,
                    callType: msg.call_type
                };
            }
            callManager.handleOffer(msg);
            break;
        case 'call_answer':
            callManager.handleAnswer(msg);
            break;
        case 'call_ice_candidate':
            callManager.handleIceCandidate(msg);
            break;
        case 'call_join':
            // Handle call join - another participant joined the call
            console.log('User joined call:', msg.user_id);
            // Update UI to show participant joined (could show a notification)
            if (activeCall && callManager) {
                // Add participant to active call tracking
                const participantName = chats.get(msg.user_id)?.username || 'User';
                console.log(`${participantName} joined the call`);
            }
            break;
        case 'call_leave':
            // Handle call leave - another participant left the call
            console.log('User left call:', msg.user_id);
            if (activeCall && callManager && callManager.peerConnections) {
                const participantName = chats.get(msg.user_id)?.username || 'User';
                console.log(`${participantName} left the call`);
                // Close peer connection for this participant
                callManager.peerConnections.delete(msg.user_id);
            }
            break;
        case 'call_end':
            endCall();
            break;
        case 'call_reject':
            endCall();
            break;
        default:
            console.warn('Unknown call message type:', msg.type);
    }
}

// Setup call event listeners
function setupCallEventListeners() {
    // Listen for ICE candidates
    window.addEventListener('iceCandidate', (e) => {
        if (callManager) {
            callManager.sendIceCandidate(e.detail.userId, e.detail.candidate);
        }
    });
    
    // Listen for remote streams
    window.addEventListener('remoteStream', (e) => {
        console.log('Remote stream received:', e.detail);
        const videoEl = document.getElementById('remote-video');
        if (videoEl) {
            videoEl.srcObject = e.detail.stream;
            console.log('Remote video element updated');
        } else {
            console.error('Remote video element not found');
        }
    });
    
    // Listen for connection state changes
    window.addEventListener('connectionState', (e) => {
        console.log('Connection state:', e.detail.state);
    });
}

// Setup call event listeners when DOM is ready
document.addEventListener('DOMContentLoaded', setupCallEventListeners);

// Cleanup call state on page unload
window.addEventListener('beforeunload', () => {
    if (activeCall && callManager) {
        callManager.endCall();
    }
    if (mediaUtils) {
        mediaUtils.stopLocalStream();
    }
    incomingCall = null;
});

// Initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setupEventListeners);
} else {
    setupEventListeners();
}
