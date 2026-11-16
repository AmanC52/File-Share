/* ==========================================================================
   app.js - FileShare Pro Core Application Bootstrap & State
   ========================================================================== */

// Global State
window.FileShare = {
    currentPath: '',
    viewMode: localStorage.getItem('fileshare_view') || 'grid',
    items: [],
    isReadOnly: false,
    currentMediaIndex: -1,
    activeMediaType: null, // 'video', 'audio', 'image', 'pdf', 'code'
    deferredPrompt: null
};

// PWA Install Prompt Listener
window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    FileShare.deferredPrompt = e;
});

function showInstallPrompt() {
    if (FileShare.deferredPrompt) {
        FileShare.deferredPrompt.prompt();
        FileShare.deferredPrompt.userChoice.then((choiceResult) => {
            if (choiceResult.outcome === 'accepted') {
                console.log('User installed FileShare PWA');
            }
            FileShare.deferredPrompt = null;
        });
    } else {
        const installModal = document.getElementById('install-modal');
        if (installModal) installModal.classList.add('active');
    }
}

// Global Stop Media (Exclusive Playback)
function stopAllMedia() {
    if (window.VLCPlayer && typeof VLCPlayer.close === 'function') {
        VLCPlayer.close();
    }
    if (window.AudioPlayer && typeof AudioPlayer.stop === 'function') {
        AudioPlayer.stop();
    }
    if (window.ImageViewer && typeof ImageViewer.close === 'function') {
        ImageViewer.close();
    }
    if (window.PDFViewer && typeof PDFViewer.close === 'function') {
        PDFViewer.close();
    }
    if (window.CodeEditor && typeof CodeEditor.close === 'function') {
        CodeEditor.close();
    }
    const mediaContainer = document.getElementById('media-container');
    if (mediaContainer) mediaContainer.innerHTML = '';
    const modal = document.getElementById('media-modal');
    if (modal) modal.classList.remove('active');
    FileShare.activeMediaType = null;
}

// Theme Toggle
function toggleTheme() {
    const html = document.documentElement;
    const nextTheme = html.dataset.theme === 'dark' ? 'light' : 'dark';
    html.dataset.theme = nextTheme;
    localStorage.setItem('fileshare_theme', nextTheme);
}

// Storage Info Loader
async function loadStorage() {
    try {
        const res = await fetch('/api/storage');
        const data = await res.json();
        const fill = document.getElementById('storage-fill');
        const used = document.getElementById('storage-used');
        const total = document.getElementById('storage-total');
        if (fill) fill.style.width = data.used_percent + '%';
        if (used) used.innerText = data.used_str;
        if (total) total.innerText = data.total_str;
    } catch (e) {
        console.warn('Storage fetch failed:', e);
    }
}

// Connected Devices Poller
async function loadClients() {
    try {
        const res = await fetch('/api/clients');
        const data = await res.json();
        const list = document.getElementById('clients-list');
        if (!list) return;
        if (!data.clients || data.clients.length === 0) {
            list.innerHTML = '<div style="color: var(--text-muted); text-align: center; padding: 0.5rem;">No devices connected</div>';
            return;
        }
        list.innerHTML = data.clients.map(c => `
            <div style="display: flex; justify-content: space-between; align-items: center; padding: 6px 0; border-bottom: 1px solid var(--border);">
                <span style="font-weight: 500;">${c.device_name}</span>
                <span style="color: var(--text-muted); font-size: 0.8rem; font-family: monospace;">${c.ip}</span>
            </div>
        `).join('');
    } catch (e) {
        console.warn('Clients fetch failed:', e);
    }
}

// Initialize on DOM Ready
document.addEventListener('DOMContentLoaded', () => {
    // Restore Saved Theme (default: light glossy)
    const savedTheme = localStorage.getItem('fileshare_theme') || 'light';
    document.documentElement.dataset.theme = savedTheme;

    // Load initial directory from URL query or root
    const params = new URLSearchParams(window.location.search);
    const initialPath = params.get('path') || '';
    history.replaceState({ path: initialPath }, "", window.location.href);

    if (window.FileManager) {
        FileManager.loadPath(initialPath, false);
        FileManager.setupDragAndDrop();
        FileManager.setupSearch();
    }

    loadStorage();
    loadClients();
    setInterval(loadClients, 6000);

    // Register Service Worker for PWA
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('/static/sw.js').catch((err) => {
            console.log('SW registration note:', err.message);
        });
    }
});

// Browser Back/Forward navigation
window.addEventListener('popstate', (e) => {
    stopAllMedia();
    const path = (e.state && e.state.path !== undefined) ? e.state.path : (new URLSearchParams(window.location.search).get('path') || '');
    if (window.FileManager) {
        FileManager.loadPath(path, false);
    }
});
