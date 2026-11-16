/* ==========================================================================
   file-manager.js - File Explorer, Navigation, Uploads & ZIP Downloads
   ========================================================================== */

window.FileManager = {
    iconMap: {
        'folder': '📁',
        'video': '🎬',
        'audio': '🎵',
        'image': '🖼️',
        'pdf': '📄',
        'archive': '📦',
        'code': '💻',
        'text': '📝',
        'file': '📄'
    },

    colorMap: {
        'folder': '#94a3b8',
        'video': '#ef4444',
        'audio': '#8b5cf6',
        'image': '#10b981',
        'pdf': '#f97316',
        'archive': '#eab308',
        'code': '#3b82f6',
        'text': '#38bdf8',
        'file': '#64748b'
    },

    async loadPath(path, pushHistory = true) {
        FileShare.currentPath = path;
        if (pushHistory) {
            const url = path ? `?path=${encodeURIComponent(path)}` : window.location.pathname;
            history.pushState({ path: path }, "", url);
        }

        try {
            const res = await fetch('/api/browse?path=' + encodeURIComponent(path));
            const data = await res.json();
            if (data.error) throw new Error(data.error);

            FileShare.items = data.items;
            FileShare.isReadOnly = data.read_only;

            this.renderBreadcrumb(data.breadcrumb);
            this.renderFiles(FileShare.items);
        } catch (err) {
            alert('Navigation Error: ' + err.message);
        }
    },

    renderBreadcrumb(crumbs) {
        const container = document.getElementById('breadcrumb');
        if (!container) return;

        let html = `<span class="crumb" onclick="FileManager.loadPath('')">🏠 Home</span>`;
        crumbs.forEach(crumb => {
            const safePath = crumb.path.replace(/'/g, "\\'");
            html += ` <span style="color:var(--border)">/</span> <span class="crumb" onclick="FileManager.loadPath('${safePath}')">${crumb.name}</span>`;
        });
        container.innerHTML = html;
    },

    renderFiles(fileList) {
        const container = document.getElementById('file-container');
        if (!container) return;

        container.className = FileShare.viewMode === 'grid' ? 'file-grid' : 'file-list';
        container.innerHTML = '';

        const countBadge = document.getElementById('file-count');
        if (countBadge) countBadge.innerText = `${fileList.length} items`;

        // Folders first, then alphabetically
        fileList.sort((a, b) => b.is_dir - a.is_dir || a.name.localeCompare(b.name));

        fileList.forEach((item, index) => {
            const card = document.createElement('div');
            card.className = 'card';
            const icon = this.iconMap[item.type] || this.iconMap['file'];
            const color = this.colorMap[item.type] || this.colorMap['file'];
            const safePath = item.path.replace(/'/g, "\\'");

            // Click Router
            card.onclick = () => {
                if (item.is_dir) {
                    FileManager.loadPath(item.path);
                } else if (item.type === 'video') {
                    if (window.VLCPlayer) VLCPlayer.open(index);
                } else if (item.type === 'image') {
                    if (window.ImageViewer) ImageViewer.open(index);
                } else if (item.type === 'audio') {
                    if (window.AudioPlayer) AudioPlayer.play(index);
                } else if (item.type === 'pdf') {
                    if (window.PDFViewer) PDFViewer.open(item.path, item.name);
                } else if (item.type === 'code' || item.type === 'text') {
                    if (window.CodeEditor) CodeEditor.open(item.path, item.name);
                } else {
                    FileManager.downloadFile(item.path);
                }
            };

            // Thumbnail / Icon Visual
            let visual = `<div class="icon-wrapper" style="color: ${color}">${icon}</div>`;
            if (item.type === 'image' && FileShare.viewMode === 'grid') {
                visual = `<img class="thumbnail-preview" src="/api/thumbnail?path=${encodeURIComponent(item.path)}" onerror="this.outerHTML='<div class=\\'icon-wrapper\\' style=\\'color:${color}\\'>${icon}</div>'">`;
            }

            card.innerHTML = `
                ${visual}
                <div class="card-details">
                    <div class="card-name" title="${item.name}">${item.name}</div>
                    <div class="card-meta">${item.is_dir ? 'Folder' : item.size_str}</div>
                </div>
                <div class="card-actions" onclick="event.stopPropagation()">
                    <button class="action-btn" title="Download" onclick="FileManager.downloadFile('${safePath}')">⬇️</button>
                </div>
            `;
            container.appendChild(card);
        });
    },

    downloadFile(path) {
        window.location.href = '/api/download?path=' + encodeURIComponent(path);
    },

    downloadCurrentFolderZip() {
        window.location.href = '/api/zip?path=' + encodeURIComponent(FileShare.currentPath);
    },

    toggleView() {
        FileShare.viewMode = FileShare.viewMode === 'grid' ? 'list' : 'grid';
        localStorage.setItem('fileshare_view', FileShare.viewMode);
        this.renderFiles(FileShare.items);
    },

    async createFolder() {
        const name = prompt("Enter folder name:");
        if (!name) return;
        try {
            const res = await fetch('/api/mkdir', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path: FileShare.currentPath, name })
            });
            const data = await res.json();
            if (data.error) throw new Error(data.error);
            this.loadPath(FileShare.currentPath);
        } catch (e) {
            alert('Folder creation failed: ' + e.message);
        }
    },

    setupSearch() {
        const searchInput = document.getElementById('search-input');
        if (!searchInput) return;
        searchInput.addEventListener('input', (e) => {
            const query = e.target.value.toLowerCase().trim();
            if (query.length === 0) {
                this.renderFiles(FileShare.items);
            } else {
                const filtered = FileShare.items.filter(i => i.name.toLowerCase().includes(query));
                this.renderFiles(filtered);
            }
        });
    },

    setupDragAndDrop() {
        const dropZone = document.getElementById('drop-zone');
        if (!dropZone) return;

        window.addEventListener('dragover', e => {
            e.preventDefault();
            dropZone.classList.add('active');
        });

        window.addEventListener('dragleave', e => {
            if (!e.relatedTarget || e.target.nodeName === 'HTML') {
                dropZone.classList.remove('active');
            }
        });

        window.addEventListener('drop', e => {
            e.preventDefault();
            dropZone.classList.remove('active');
            if (e.dataTransfer && e.dataTransfer.files.length) {
                this.uploadFiles(e.dataTransfer.files);
            }
        });
    },

    handleFileInput(e) {
        if (e.target.files && e.target.files.length) {
            this.uploadFiles(e.target.files);
        }
        e.target.value = ''; // prevent duplicate upload triggers
    },

    formatBytes(bytes) {
        if (!bytes || bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    },

    uploadFiles(files) {
        if (FileShare.isReadOnly) return alert("Server is in read-only mode!");
        if (!files || files.length === 0) return;

        const fileArray = Array.from(files);
        const totalFiles = fileArray.length;
        let totalBytes = 0;
        fileArray.forEach(f => totalBytes += f.size);

        // Build Queue Objects
        const queue = fileArray.map((f, i) => ({
            id: i,
            file: f,
            name: f.name,
            size: f.size,
            sizeStr: this.formatBytes(f.size),
            status: 'pending' // 'pending', 'uploading', 'completed', 'error'
        }));

        // Render Upload Queue Shell ONCE (No Flicker, Preserves Scroll)
        let pContainer = document.getElementById('upload-progress-container');
        if (!pContainer) {
            pContainer = document.createElement('div');
            pContainer.id = 'upload-progress-container';
            const fileContainer = document.getElementById('file-container');
            if (fileContainer) fileContainer.insertAdjacentElement('beforebegin', pContainer);
        }
        pContainer.style.display = 'block';

        const itemsHtml = queue.map(item => `
            <div class="upload-queue-item" id="upload-item-${item.id}">
                <div class="upload-item-info">
                    <span style="font-size: 1.2rem;">📄</span>
                    <div style="min-width: 0; flex: 1;">
                        <div class="upload-item-name" title="${item.name}">${item.name}</div>
                        <div class="upload-item-size">${item.sizeStr}</div>
                    </div>
                </div>
                <div id="upload-badge-${item.id}">
                    <span class="upload-badge badge-pending">⏸ Pending</span>
                </div>
            </div>
        `).join('');

        pContainer.innerHTML = `
            <div class="upload-header">
                <div style="display: flex; align-items: center; gap: 0.5rem;">
                    <span id="upload-status-title" style="font-weight: 600; font-size: 0.95rem;">
                        Uploading (1 of ${totalFiles})
                    </span>
                    <span class="upload-count-badge" id="upload-count-badge">1/${totalFiles}</span>
                </div>
                <div class="upload-stats-group">
                    <span class="upload-speed-badge" id="upload-speed-badge">0.00 MB/s</span>
                    <button class="btn" style="padding: 0.2rem 0.5rem; font-size: 0.75rem; border-radius: 4px;" onclick="document.getElementById('upload-progress-container').style.display='none'">✖</button>
                </div>
            </div>
            <div class="storage-bar" style="height: 8px; margin-bottom: 0.5rem;">
                <div id="upload-progress-bar" class="storage-fill" style="width: 0%; background: var(--success); transition: width 0.15s ease;"></div>
            </div>
            <div style="display: flex; justify-content: space-between; font-size: 0.78rem; color: var(--text-muted); margin-bottom: 0.5rem;">
                <span id="upload-overall-text">Overall Progress: 0%</span>
                <span>Total: ${this.formatBytes(totalBytes)}</span>
            </div>
            <div class="upload-queue-list" id="upload-queue-list">
                ${itemsHtml}
            </div>
        `;

        // Targeted DOM Elements for Zero-Flicker Updates
        const statusTitleEl = document.getElementById('upload-status-title');
        const countBadgeEl = document.getElementById('upload-count-badge');
        const speedBadgeEl = document.getElementById('upload-speed-badge');
        const progressBarEl = document.getElementById('upload-progress-bar');
        const overallTextEl = document.getElementById('upload-overall-text');

        const updateQueueStats = (currentFileIndex, currentFilePercent, currentSpeedMB, overallPercent) => {
            if (statusTitleEl) {
                statusTitleEl.innerText = currentFileIndex < totalFiles ? `Uploading (${currentFileIndex + 1} of ${totalFiles})` : '🎉 Upload Complete!';
            }
            if (countBadgeEl) {
                countBadgeEl.innerText = currentFileIndex < totalFiles ? `${currentFileIndex + 1}/${totalFiles}` : `${totalFiles} Files`;
            }
            if (speedBadgeEl) {
                speedBadgeEl.innerText = `${currentSpeedMB} MB/s`;
            }
            if (progressBarEl) {
                progressBarEl.style.width = `${overallPercent}%`;
            }
            if (overallTextEl) {
                overallTextEl.innerText = `Overall Progress: ${overallPercent}%`;
            }

            // Update only current item's badge without rebuilding the list
            if (currentFileIndex < totalFiles) {
                const currentBadge = document.getElementById(`upload-badge-${currentFileIndex}`);
                if (currentBadge) {
                    currentBadge.innerHTML = `<span class="upload-badge badge-uploading">⏳ ${currentFilePercent}% • ${currentSpeedMB} MB/s</span>`;
                }
            }
        };

        // Sequential Upload Processor
        let currentIndex = 0;
        let completedBytesPrevious = 0;

        const uploadNext = () => {
            if (currentIndex >= totalFiles) {
                // All finished
                updateQueueStats(totalFiles, 100, '0.00', 100);
                this.loadPath(FileShare.currentPath, false);
                loadStorage();
                setTimeout(() => {
                    if (statusTitleEl) statusTitleEl.innerText = `✅ All ${totalFiles} files uploaded successfully!`;
                }, 300);
                return;
            }

            const currentItem = queue[currentIndex];
            currentItem.status = 'uploading';
            const currentBadge = document.getElementById(`upload-badge-${currentIndex}`);
            if (currentBadge) {
                currentBadge.innerHTML = `<span class="upload-badge badge-uploading">⏳ 0% • 0.00 MB/s</span>`;
            }

            const fd = new FormData();
            fd.append('files', currentItem.file);
            if (currentItem.file.webkitRelativePath) {
                const relDir = currentItem.file.webkitRelativePath.split('/').slice(0, -1).join('/');
                fd.append('path_' + currentItem.file.name, relDir);
            }

            const xhr = new XMLHttpRequest();
            const startTime = Date.now();
            let lastLoaded = 0;
            let lastTime = startTime;
            let currentSpeedMB = '0.00';

            xhr.upload.onprogress = (e) => {
                if (e.lengthComputable) {
                    const filePercent = Math.round((e.loaded / e.total) * 100);
                    const now = Date.now();
                    const timeDiff = (now - lastTime) / 1000;

                    if (timeDiff > 0.3) {
                        const speed = (e.loaded - lastLoaded) / timeDiff; // bytes/sec
                        currentSpeedMB = (speed / (1024 * 1024)).toFixed(2);
                        lastLoaded = e.loaded;
                        lastTime = now;
                    }

                    const overallBytes = completedBytesPrevious + e.loaded;
                    const overallPercent = totalBytes > 0 ? Math.round((overallBytes / totalBytes) * 100) : filePercent;

                    updateQueueStats(currentIndex, filePercent, currentSpeedMB, overallPercent);
                }
            };

            xhr.onload = () => {
                const badge = document.getElementById(`upload-badge-${currentIndex}`);
                if (xhr.status >= 200 && xhr.status < 300) {
                    currentItem.status = 'completed';
                    completedBytesPrevious += currentItem.size;
                    if (badge) badge.innerHTML = '<span class="upload-badge badge-completed">✅ Done</span>';
                } else {
                    currentItem.status = 'error';
                    if (badge) badge.innerHTML = '<span class="upload-badge badge-error">❌ Failed</span>';
                }
                currentIndex++;
                uploadNext();
            };

            xhr.onerror = () => {
                currentItem.status = 'error';
                const badge = document.getElementById(`upload-badge-${currentIndex}`);
                if (badge) badge.innerHTML = '<span class="upload-badge badge-error">❌ Failed</span>';
                currentIndex++;
                uploadNext();
            };

            xhr.open('POST', '/api/upload?path=' + encodeURIComponent(FileShare.currentPath));
            xhr.send(fd);
        };

        uploadNext();
    }
};
