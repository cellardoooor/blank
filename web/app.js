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

// Favicon switching for unread messages
const ORIGINAL_FAVICON = '/favicon.ico';
const UNREAD_FAVICON = '/unread.ico';

const API_URL = '/api';
const DATA_REFRESH_THROTTLE = 30000;

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
        
        const authSection = document.getElementById('auth-section');
        if (authSection) authSection.remove();
        
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
        
        const authSection = document.getElementById('auth-section');
        if (authSection) authSection.remove();
        
        await initApp();
    } catch (e) {
        errorEl.textContent = 'Network error: ' + e.message;
    }
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
        if ('ontouchstart' in window || navigator.maxTouchPoints > 0) return;
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
            refreshDebounceTimer = setTimeout(refreshAllData, 500);
            
            // Reset favicon when tab becomes visible
            setOriginalFavicon();
        }
    });
    
    // Refresh on page restore from bfcache
    window.addEventListener('pageshow', function(e) {
        if (e.persisted && token) {
            refreshAllData();
        }
    });
    
    // Refresh on network reconnect
    window.addEventListener('online', refreshAllData);
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setupEventListeners);
} else {
    setupEventListeners();
}
