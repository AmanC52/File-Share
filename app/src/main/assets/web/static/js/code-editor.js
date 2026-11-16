/* ==========================================================================
   code-editor.js - In-App Code & Text Editor Modal Component
   ========================================================================== */

window.CodeEditor = {
    currentPath: '',
    currentFilename: '',

    async open(path, filename) {
        stopAllMedia();
        FileShare.activeMediaType = 'code';
        this.currentPath = path;
        this.currentFilename = filename;

        const container = document.getElementById('media-container');
        if (!container) return;

        container.innerHTML = `
            <div class="editor-modal-container" onclick="event.stopPropagation()">
                <div class="editor-header">
                    <div class="editor-title-group">
                        <span>📝</span>
                        <span class="editor-filename">${filename}</span>
                        <span class="editor-badge" id="editor-char-count">Loading...</span>
                    </div>
                    <div class="editor-actions">
                        <button class="btn" onclick="CodeEditor.copyContent()" style="padding: 0.4rem 0.8rem; font-size: 0.85rem;">📋 Copy</button>
                        <button class="btn btn-primary" id="editor-save-btn" onclick="CodeEditor.save()" style="padding: 0.4rem 0.8rem; font-size: 0.85rem;">💾 Save</button>
                    </div>
                </div>
                <div class="editor-body">
                    <textarea class="editor-textarea" id="editor-textarea" spellcheck="false" placeholder="Loading content..."></textarea>
                </div>
                <div class="editor-status-bar">
                    <span>Path: ${path}</span>
                    <span id="editor-status-text">Ready</span>
                </div>
            </div>
        `;

        const modal = document.getElementById('media-modal');
        if (modal) modal.classList.add('active');

        try {
            const res = await fetch('/api/preview?path=' + encodeURIComponent(path));
            const data = await res.json();
            if (data.error) throw new Error(data.error);

            const textarea = document.getElementById('editor-textarea');
            const charCount = document.getElementById('editor-char-count');
            if (textarea) textarea.value = data.content || '';
            if (charCount) charCount.innerText = `${(data.content || '').length} chars`;

            if (textarea) {
                textarea.addEventListener('input', () => {
                    if (charCount) charCount.innerText = `${textarea.value.length} chars`;
                    const status = document.getElementById('editor-status-text');
                    if (status) status.innerText = 'Unsaved changes';
                });
            }
        } catch (e) {
            alert('Failed to load text file: ' + e.message);
        }
    },

    async save() {
        if (FileShare.isReadOnly) return alert('Server is in read-only mode!');
        const textarea = document.getElementById('editor-textarea');
        const saveBtn = document.getElementById('editor-save-btn');
        const status = document.getElementById('editor-status-text');
        if (!textarea) return;

        const content = textarea.value;
        if (saveBtn) saveBtn.innerText = 'Saving...';
        if (status) status.innerText = 'Saving to server...';

        try {
            const res = await fetch('/api/edit', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    path: this.currentPath,
                    content: content
                })
            });
            const data = await res.json();
            if (data.error) throw new Error(data.error);

            if (saveBtn) saveBtn.innerText = '✅ Saved';
            if (status) status.innerText = `Saved successfully (${data.size_str || 'updated'})`;
            setTimeout(() => {
                if (saveBtn) saveBtn.innerText = '💾 Save';
            }, 2000);
        } catch (e) {
            alert('Save failed: ' + e.message);
            if (saveBtn) saveBtn.innerText = '💾 Save';
            if (status) status.innerText = 'Save error';
        }
    },

    copyContent() {
        const textarea = document.getElementById('editor-textarea');
        if (!textarea) return;
        navigator.clipboard.writeText(textarea.value).then(() => {
            const status = document.getElementById('editor-status-text');
            if (status) status.innerText = 'Copied to clipboard!';
            setTimeout(() => { if (status) status.innerText = 'Ready'; }, 2000);
        }).catch(() => {});
    },

    close() {
        // cleanup if needed
    }
};
