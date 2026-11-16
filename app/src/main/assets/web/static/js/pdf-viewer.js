/* ==========================================================================
   pdf-viewer.js - In-App PDF Reader Modal Component
   ========================================================================== */

window.PDFViewer = {
    open(path, filename) {
        stopAllMedia();
        FileShare.activeMediaType = 'pdf';

        const container = document.getElementById('media-container');
        if (!container) return;

        const streamUrl = '/api/stream?path=' + encodeURIComponent(path);
        const downloadUrl = '/api/download?path=' + encodeURIComponent(path);

        container.innerHTML = `
            <div class="pdf-modal-container" onclick="event.stopPropagation()">
                <div class="pdf-toolbar">
                    <div class="pdf-title-group">
                        <span class="pdf-icon">📄</span>
                        <span class="pdf-filename" title="${filename}">${filename}</span>
                    </div>
                    <div class="pdf-actions">
                        <a href="${downloadUrl}" class="btn" style="padding: 0.4rem 0.8rem; font-size: 0.85rem;" download="${filename}">⬇️ Download</a>
                        <button class="btn btn-primary" style="padding: 0.4rem 0.8rem; font-size: 0.85rem;" onclick="window.open('${streamUrl}', '_blank')">↗️ Open in New Tab</button>
                    </div>
                </div>
                <div class="pdf-frame-wrapper">
                    <iframe class="pdf-frame" src="${streamUrl}#toolbar=1" type="application/pdf"></iframe>
                </div>
            </div>
        `;

        const modal = document.getElementById('media-modal');
        if (modal) modal.classList.add('active');
    },

    close() {
        // cleanup if needed
    }
};
