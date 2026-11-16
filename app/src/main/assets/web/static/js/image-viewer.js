/* ==========================================================================
   image-viewer.js - Advanced Image Gallery, Zoom, Rotate & Lightbox
   ========================================================================== */

window.ImageViewer = {
    currentIndex: -1,
    zoomScale: 1,
    rotation: 0,
    flipH: 1,
    isDragging: false,
    startX: 0,
    startY: 0,
    translateX: 0,
    translateY: 0,
    slideshowTimer: null,
    imageList: [],

    open(index) {
        stopAllMedia();
        this.currentIndex = index;
        FileShare.currentMediaIndex = index;
        FileShare.activeMediaType = 'image';

        // Reset transforms
        this.zoomScale = 1;
        this.rotation = 0;
        this.flipH = 1;
        this.translateX = 0;
        this.translateY = 0;

        // Collect all images in current folder
        this.imageList = FileShare.items
            .map((item, idx) => ({ ...item, originalIndex: idx }))
            .filter(item => item.type === 'image');

        const item = FileShare.items[index];
        if (!item) return;

        const container = document.getElementById('media-container');
        if (!container) return;

        // Build Filmstrip items
        const filmstripHtml = this.imageList.map((img) => `
            <img class="filmstrip-thumb ${img.originalIndex === index ? 'active' : ''}" 
                 src="/api/thumbnail?path=${encodeURIComponent(img.path)}" 
                 onclick="ImageViewer.open(${img.originalIndex})" 
                 alt="${img.name}">
        `).join('');

        container.innerHTML = `
            <div class="image-lightbox-container" id="img-lightbox">
                <!-- Top Floating Toolbar -->
                <div class="image-toolbar" onclick="event.stopPropagation()">
                    <button class="image-tool-btn" onclick="ImageViewer.zoom(-0.25)" title="Zoom Out (Scroll Down)">➖</button>
                    <span class="image-zoom-badge" id="img-zoom-label">100%</span>
                    <button class="image-tool-btn" onclick="ImageViewer.zoom(0.25)" title="Zoom In (Scroll Up)">➕</button>
                    <button class="image-tool-btn" onclick="ImageViewer.resetZoom()" title="Reset Zoom">🔄</button>
                    <button class="image-tool-btn" onclick="ImageViewer.rotate(90)" title="Rotate 90° Clockwise">↷</button>
                    <button class="image-tool-btn" onclick="ImageViewer.flip()" title="Flip Horizontal">↔️</button>
                    <button class="image-tool-btn" onclick="ImageViewer.toggleSlideshow()" id="img-slideshow-btn" title="Auto Slideshow (3s)">▶ Slideshow</button>
                    <button class="image-tool-btn" onclick="FileManager.downloadFile('${item.path.replace(/'/g, "\\'")}')" title="Download Image">⬇️</button>
                </div>

                <!-- Navigation Arrows -->
                <button class="gallery-btn gallery-prev" onclick="ImageViewer.prev(event)">❮</button>
                <button class="gallery-btn gallery-next" onclick="ImageViewer.next(event)">❯</button>

                <!-- Zoomable / Draggable Stage -->
                <div class="image-stage" id="img-stage">
                    <img id="active-lightbox-img" src="/api/stream?path=${encodeURIComponent(item.path)}" draggable="false">
                </div>

                <!-- Bottom Filmstrip -->
                <div class="image-filmstrip" onclick="event.stopPropagation()">
                    ${filmstripHtml}
                </div>
            </div>
        `;

        const modal = document.getElementById('media-modal');
        if (modal) modal.classList.add('active');

        this.initStageInteractions();
    },

    initStageInteractions() {
        const stage = document.getElementById('img-stage');
        const img = document.getElementById('active-lightbox-img');
        if (!stage || !img) return;

        // Mouse Wheel Zoom
        stage.addEventListener('wheel', (e) => {
            e.preventDefault();
            const delta = e.deltaY < 0 ? 0.2 : -0.2;
            this.zoom(delta);
        }, { passive: false });

        // Mouse Drag to Pan
        stage.addEventListener('mousedown', (e) => {
            if (this.zoomScale <= 1) return;
            this.isDragging = true;
            stage.classList.add('dragging');
            this.startX = e.clientX - this.translateX;
            this.startY = e.clientY - this.translateY;
        });

        window.addEventListener('mousemove', (e) => {
            if (!this.isDragging) return;
            this.translateX = e.clientX - this.startX;
            this.translateY = e.clientY - this.startY;
            this.applyTransforms();
        });

        window.addEventListener('mouseup', () => {
            this.isDragging = false;
            if (stage) stage.classList.remove('dragging');
        });

        // Touch Swipe
        let touchStartX = 0;
        stage.addEventListener('touchstart', (e) => {
            if (e.touches.length === 1) {
                touchStartX = e.touches[0].screenX;
            }
        });

        stage.addEventListener('touchend', (e) => {
            if (e.changedTouches.length === 1 && this.zoomScale === 1) {
                const touchEndX = e.changedTouches[0].screenX;
                if (touchEndX < touchStartX - 50) this.next();
                if (touchEndX > touchStartX + 50) this.prev();
            }
        });
    },

    zoom(delta) {
        this.zoomScale = Math.max(0.5, Math.min(5.0, this.zoomScale + delta));
        if (this.zoomScale === 1) {
            this.translateX = 0;
            this.translateY = 0;
        }
        const label = document.getElementById('img-zoom-label');
        if (label) label.innerText = Math.round(this.zoomScale * 100) + '%';
        this.applyTransforms();
    },

    resetZoom() {
        this.zoomScale = 1;
        this.translateX = 0;
        this.translateY = 0;
        const label = document.getElementById('img-zoom-label');
        if (label) label.innerText = '100%';
        this.applyTransforms();
    },

    rotate(deg) {
        this.rotation = (this.rotation + deg) % 360;
        this.applyTransforms();
    },

    flip() {
        this.flipH = this.flipH === 1 ? -1 : 1;
        this.applyTransforms();
    },

    applyTransforms() {
        const img = document.getElementById('active-lightbox-img');
        if (!img) return;
        img.style.transform = `translate(${this.translateX}px, ${this.translateY}px) scale(${this.zoomScale}) rotate(${this.rotation}deg) scaleX(${this.flipH})`;
    },

    next(e) {
        if (e) e.stopPropagation();
        this.navigate(1);
    },

    prev(e) {
        if (e) e.stopPropagation();
        this.navigate(-1);
    },

    navigate(dir) {
        let idx = this.currentIndex;
        while (true) {
            idx += dir;
            if (idx < 0 || idx >= FileShare.items.length) return;
            if (FileShare.items[idx].type === 'image') {
                this.open(idx);
                break;
            }
        }
    },

    toggleSlideshow() {
        const btn = document.getElementById('img-slideshow-btn');
        if (this.slideshowTimer) {
            clearInterval(this.slideshowTimer);
            this.slideshowTimer = null;
            if (btn) btn.innerText = '▶ Slideshow';
        } else {
            if (btn) btn.innerText = '⏸ Pause';
            this.slideshowTimer = setInterval(() => {
                this.next();
            }, 3000);
        }
    },

    close() {
        if (this.slideshowTimer) {
            clearInterval(this.slideshowTimer);
            this.slideshowTimer = null;
        }
    }
};

// Keyboard Arrow Listener for Image Lightbox
document.addEventListener('keydown', (e) => {
    if (FileShare.activeMediaType !== 'image') return;
    if (e.key === 'ArrowRight') ImageViewer.next();
    if (e.key === 'ArrowLeft') ImageViewer.prev();
    if (e.key === 'r' || e.key === 'R') ImageViewer.rotate(90);
    if (e.key === 'Escape') stopAllMedia();
});
