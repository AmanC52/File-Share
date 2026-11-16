/* ==========================================================================
   video-player.js - VLC Media Player Inspired Video Player Component
   ========================================================================== */

window.VLCPlayer = {
    currentIndex: -1,
    audioCtx: null,
    gainNode: null,
    audioSource: null,
    isTimeRemaining: false, // toggle elapsed vs remaining
    aspectModes: ['default', '16-9', '4-3', 'fill'],
    aspectIndex: 0,
    speedList: [0.5, 0.75, 1.0, 1.25, 1.5, 2.0, 3.0],
    speedIndex: 2, // default 1.0x

    open(index) {
        stopAllMedia();
        this.currentIndex = index;
        FileShare.currentMediaIndex = index;
        FileShare.activeMediaType = 'video';

        const item = FileShare.items[index];
        if (!item) return;

        const container = document.getElementById('media-container');
        if (!container) return;

        container.innerHTML = `
            <div class="video-container active" id="vlc-video-container" onclick="event.stopPropagation()">
                <div class="snapshot-flash" id="vlc-snapshot-flash"></div>
                
                <!-- VLC Header with Title and Close Button -->
                <div class="vlc-player-header">
                    <div style="display: flex; align-items: center; gap: 10px; overflow: hidden; flex: 1;">
                        <span class="vlc-cone-icon">🔶</span>
                        <span class="vlc-title-text" title="${item.name}">${item.name}</span>
                    </div>
                    <button class="vlc-header-close-btn" onclick="stopAllMedia()" title="Close Player (Esc)">✖</button>
                </div>

                <video id="vlc-active-video" class="media-viewer" src="/api/stream?path=${encodeURIComponent(item.path)}" playsinline preload="auto"></video>
                <div id="vlc-skip-hint" class="skip-hint"></div>

                <!-- VLC Custom Controls Overlay -->
                <div class="video-controls" id="vlc-controls-bar" onclick="event.stopPropagation()">
                    <div class="progress-bar-container" id="vlc-progress-container" onclick="VLCPlayer.seek(event)">
                        <div class="progress-bar-fill" id="vlc-progress-fill"></div>
                    </div>

                    <div class="controls-row">
                        <div class="controls-left">
                            <button class="vlc-btn" onclick="VLCPlayer.togglePlay()" id="vlc-play-btn" title="Play / Pause (Space)">▶</button>
                            <button class="vlc-btn" onclick="VLCPlayer.stopPlayback()" title="Stop (S)">⏹</button>
                            <button class="vlc-btn" onclick="VLCPlayer.prevVideo()" title="Previous Video">⏮</button>
                            <button class="vlc-btn" onclick="VLCPlayer.nextVideo()" title="Next Video">⏭</button>
                            
                            <!-- Volume with 200% Overdrive -->
                            <div class="volume-group">
                                <button class="vlc-btn" onclick="VLCPlayer.toggleMute()" id="vlc-mute-btn" title="Mute / Unmute (M)">🔊</button>
                                <input type="range" min="0" max="2" step="0.05" value="1" class="vlc-volume-slider" id="vlc-volume-slider" oninput="VLCPlayer.onVolumeInput(this.value)" title="Volume Boost up to 200%">
                                <span class="vlc-volume-boost-label" id="vlc-volume-label">100%</span>
                            </div>

                            <span class="vlc-time-badge" id="vlc-time-display" onclick="VLCPlayer.toggleTimeMode()" title="Click to switch Elapsed / Remaining">00:00 / 00:00</span>
                        </div>

                        <div class="controls-right">
                            <button class="vlc-speed-btn" onclick="VLCPlayer.cycleSpeed()" id="vlc-speed-btn" title="Playback Speed">1.0x</button>
                            <button class="vlc-btn" onclick="VLCPlayer.cycleAspectRatio()" id="vlc-aspect-btn" title="Aspect Ratio (Default, 16:9, 4:3, Fill)">📐</button>
                            <button class="vlc-btn" onclick="VLCPlayer.takeSnapshot()" title="VLC Snapshot (Capture Frame to PNG)">📸</button>
                            <button class="vlc-btn" onclick="VLCPlayer.togglePiP()" title="Picture in Picture (PiP)">📺</button>
                            <button class="vlc-btn" onclick="VLCPlayer.toggleFullscreen()" title="Fullscreen (F)">🔲</button>
                        </div>
                    </div>
                </div>
            </div>
        `;

        const modal = document.getElementById('media-modal');
        if (modal) modal.classList.add('active');

        this.initPlayer(item);
    },

    initPlayer(item) {
        const vid = document.getElementById('vlc-active-video');
        const container = document.getElementById('vlc-video-container');
        const progFill = document.getElementById('vlc-progress-fill');
        const playBtn = document.getElementById('vlc-play-btn');

        if (!vid) return;

        // Restore saved position
        const savedTime = localStorage.getItem('vlc_pos_' + item.path);
        if (savedTime) {
            vid.currentTime = parseFloat(savedTime);
        }

        // Web Audio API for 200% Volume Boost
        this.setupAudioOverdrive(vid);

        // Auto play
        vid.play().then(() => {
            if (playBtn) playBtn.innerText = '⏸';
        }).catch(() => {});

        // Time updates
        vid.addEventListener('timeupdate', () => {
            if (vid.duration) {
                const percent = (vid.currentTime / vid.duration) * 100;
                if (progFill) progFill.style.width = percent + '%';
                this.updateTimeDisplay(vid.currentTime, vid.duration);

                // Auto save progress every 5 seconds
                if (Math.floor(vid.currentTime) % 5 === 0) {
                    localStorage.setItem('vlc_pos_' + item.path, vid.currentTime);
                }
            }
        });

        // Play/Pause State sync
        vid.addEventListener('play', () => { if (playBtn) playBtn.innerText = '⏸'; });
        vid.addEventListener('pause', () => { if (playBtn) playBtn.innerText = '▶'; });

        // Auto-play Next on finish
        vid.addEventListener('ended', () => {
            localStorage.removeItem('vlc_pos_' + item.path);
            this.nextVideo();
        });

        // Hide controls on mouse idle
        let idleTimer;
        container.addEventListener('mousemove', () => {
            container.classList.add('active');
            clearTimeout(idleTimer);
            idleTimer = setTimeout(() => container.classList.remove('active'), 3200);
        });

        // Double-tap on mobile/touch to skip 10s
        this.setupDoubleTap(vid);

        // Error fallback for unsupported codecs / formats (AVI, FLV, WMV, HEVC, AC-3)
        vid.addEventListener('error', () => {
            console.warn('Video playback error:', vid.error);
            const downloadUrl = `/api/download?path=${encodeURIComponent(item.path)}`;
            const streamUrl = `/api/stream?path=${encodeURIComponent(item.path)}`;
            const ext = (item.name.split('.').pop() || '').toUpperCase();

            let fallback = document.getElementById('vlc-error-fallback');
            if (!fallback) {
                fallback = document.createElement('div');
                fallback.id = 'vlc-error-fallback';
                fallback.className = 'vlc-error-card';
                fallback.innerHTML = `
                    <div style="font-size: 2.8rem; margin-bottom: 0.6rem;">🔶</div>
                    <h3 style="color: #f8fafc; font-size: 1.15rem; margin-bottom: 0.4rem;">Browser Cannot Decode This Video</h3>
                    <p style="color: #94a3b8; font-size: 0.85rem; max-width: 400px; margin-bottom: 1.2rem; line-height: 1.45;">
                        This video (.${ext}) uses a codec (e.g. HEVC/H.265, AC-3, AVI, or FLV) not natively supported by web browsers. You can download or play it directly in VLC Player.
                    </p>
                    <div style="display: flex; gap: 0.6rem; justify-content: center; flex-wrap: wrap;">
                        <a href="${downloadUrl}" class="btn btn-primary" style="padding: 0.5rem 1rem; font-size: 0.88rem;" download="${item.name}">⬇️ Download Video</a>
                        <a href="${streamUrl}" target="_blank" class="btn" style="padding: 0.5rem 1rem; font-size: 0.88rem;">↗️ Direct Link</a>
                        <button class="btn" style="padding: 0.5rem 1rem; font-size: 0.88rem;" onclick="VLCPlayer.nextVideo()">⏭ Next Video</button>
                    </div>
                `;
                container.appendChild(fallback);
            }
        });
    },

    setupAudioOverdrive(vid) {
        try {
            const AudioContext = window.AudioContext || window.webkitAudioContext;
            if (!this.audioCtx) {
                this.audioCtx = new AudioContext();
            }
            if (this.audioCtx.state === 'suspended') {
                this.audioCtx.resume();
            }
            this.gainNode = this.audioCtx.createGain();
            this.audioSource = this.audioCtx.createMediaElementSource(vid);
            this.audioSource.connect(this.gainNode);
            this.gainNode.connect(this.audioCtx.destination);
            this.gainNode.gain.value = 1.0; // 100%
        } catch (e) {
            // Already connected or browser restricted
            console.log('AudioContext ready:', e.message);
        }
    },

    onVolumeInput(val) {
        const floatVal = parseFloat(val);
        const vid = document.getElementById('vlc-active-video');
        const label = document.getElementById('vlc-volume-label');
        const muteBtn = document.getElementById('vlc-mute-btn');

        const percent = Math.round(floatVal * 100);
        if (label) label.innerText = percent + '%';

        if (this.gainNode) {
            this.gainNode.gain.value = floatVal; // up to 2.0x (200%)
        } else if (vid) {
            vid.volume = Math.min(1.0, floatVal);
        }

        if (vid) vid.muted = (floatVal === 0);
        if (muteBtn) muteBtn.innerText = (floatVal === 0 ? '🔇' : (floatVal > 1.0 ? '📢' : '🔊'));
    },

    togglePlay() {
        const vid = document.getElementById('vlc-active-video');
        if (!vid) return;
        if (vid.paused) {
            vid.play();
            this.showHint('▶ Play');
        } else {
            vid.pause();
            this.showHint('⏸ Pause');
        }
    },

    stopPlayback() {
        const vid = document.getElementById('vlc-active-video');
        if (!vid) return;
        vid.pause();
        vid.currentTime = 0;
        this.showHint('⏹ Stopped');
    },

    seek(e) {
        const vid = document.getElementById('vlc-active-video');
        if (!vid || !vid.duration) return;
        const rect = e.currentTarget.getBoundingClientRect();
        const pos = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        vid.currentTime = pos * vid.duration;
    },

    toggleMute() {
        const vid = document.getElementById('vlc-active-video');
        const slider = document.getElementById('vlc-volume-slider');
        if (!vid) return;
        vid.muted = !vid.muted;
        if (vid.muted) {
            this.showHint('🔇 Muted');
            if (slider) slider.value = 0;
            this.onVolumeInput(0);
        } else {
            this.showHint('🔊 Unmuted');
            if (slider) slider.value = 1;
            this.onVolumeInput(1);
        }
    },

    cycleSpeed() {
        const vid = document.getElementById('vlc-active-video');
        const btn = document.getElementById('vlc-speed-btn');
        if (!vid) return;
        this.speedIndex = (this.speedIndex + 1) % this.speedList.length;
        const spd = this.speedList[this.speedIndex];
        vid.playbackRate = spd;
        if (btn) btn.innerText = spd + 'x';
        this.showHint(`Speed: ${spd}x`);
    },

    cycleAspectRatio() {
        const vid = document.getElementById('vlc-active-video');
        if (!vid) return;
        this.aspectIndex = (this.aspectIndex + 1) % this.aspectModes.length;
        const mode = this.aspectModes[this.aspectIndex];
        vid.className = 'media-viewer';
        if (mode === '16-9') vid.classList.add('aspect-16-9');
        else if (mode === '4-3') vid.classList.add('aspect-4-3');
        else if (mode === 'fill') vid.classList.add('aspect-fill');
        this.showHint(`Aspect: ${mode.toUpperCase()}`);
    },

    takeSnapshot() {
        const vid = document.getElementById('vlc-active-video');
        const flash = document.getElementById('vlc-snapshot-flash');
        if (!vid || vid.readyState < 2) return;

        // Flash animation
        if (flash) {
            flash.classList.add('flash');
            setTimeout(() => flash.classList.remove('flash'), 120);
        }

        // Draw video frame to offscreen canvas
        const canvas = document.createElement('canvas');
        canvas.width = vid.videoWidth || 1920;
        canvas.height = vid.videoHeight || 1080;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(vid, 0, 0, canvas.width, canvas.height);

        // Download PNG snapshot
        const dataURL = canvas.toDataURL('image/png');
        const a = document.createElement('a');
        const filename = `snapshot_${Math.floor(vid.currentTime)}s.png`;
        a.href = dataURL;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);

        this.showHint('📸 Snapshot Saved');
    },

    togglePiP() {
        const vid = document.getElementById('vlc-active-video');
        if (!vid) return;
        if (document.pictureInPictureElement) {
            document.exitPictureInPicture().catch(() => {});
        } else {
            vid.requestPictureInPicture().catch(() => {});
        }
    },

    toggleFullscreen() {
        const container = document.getElementById('vlc-video-container');
        if (!container) return;
        if (!document.fullscreenElement) {
            container.requestFullscreen().catch(() => {});
        } else {
            document.exitFullscreen().catch(() => {});
        }
    },

    toggleTimeMode() {
        this.isTimeRemaining = !this.isTimeRemaining;
        const vid = document.getElementById('vlc-active-video');
        if (vid && vid.duration) {
            this.updateTimeDisplay(vid.currentTime, vid.duration);
        }
    },

    updateTimeDisplay(cur, dur) {
        const display = document.getElementById('vlc-time-display');
        if (!display) return;
        const curStr = this.formatSeconds(cur);
        if (this.isTimeRemaining) {
            const remStr = '-' + this.formatSeconds(Math.max(0, dur - cur));
            display.innerText = `${curStr} / ${remStr}`;
        } else {
            display.innerText = `${curStr} / ${this.formatSeconds(dur)}`;
        }
    },

    formatSeconds(sec) {
        if (isNaN(sec) || sec < 0) return '00:00';
        const h = Math.floor(sec / 3600);
        const m = Math.floor((sec % 3600) / 60);
        const s = Math.floor(sec % 60);
        const pad = (n) => (n < 10 ? '0' + n : n);
        if (h > 0) return `${h}:${pad(m)}:${pad(s)}`;
        return `${pad(m)}:${pad(s)}`;
    },

    showHint(text) {
        const hint = document.getElementById('vlc-skip-hint');
        if (!hint) return;
        hint.innerText = text;
        hint.classList.add('active');
        clearTimeout(this._hintTimer);
        this._hintTimer = setTimeout(() => hint.classList.remove('active'), 600);
    },

    setupDoubleTap(vid) {
        let lastTap = 0;
        let tapTimer = null;
        const container = document.getElementById('vlc-video-container');

        vid.addEventListener('click', (e) => {
            e.stopPropagation(); // Prevent closing video player!
            const now = Date.now();

            // Double Tap check (within 320ms)
            if (now - lastTap < 320 && now - lastTap > 0) {
                clearTimeout(tapTimer);
                const rect = vid.getBoundingClientRect();
                const isRight = e.clientX > (rect.left + rect.width / 2);
                if (isRight) {
                    vid.currentTime = Math.min(vid.duration, vid.currentTime + 10);
                    this.showHint('⏭ +10s');
                } else {
                    vid.currentTime = Math.max(0, vid.currentTime - 10);
                    this.showHint('⏮ -10s');
                }
                lastTap = 0;
            } else {
                lastTap = now;
                // Single Click: Show controls bar + Toggle Play/Pause
                tapTimer = setTimeout(() => {
                    if (container) {
                        container.classList.add('active');
                        clearTimeout(this._idleTimer);
                        this._idleTimer = setTimeout(() => container.classList.remove('active'), 3500);
                    }
                    this.togglePlay();
                }, 320);
            }
        });
    },

    nextVideo() {
        this.navigateVideo(1);
    },

    prevVideo() {
        this.navigateVideo(-1);
    },

    navigateVideo(dir) {
        let idx = this.currentIndex;
        while (true) {
            idx += dir;
            if (idx < 0 || idx >= FileShare.items.length) return;
            if (FileShare.items[idx].type === 'video') {
                this.open(idx);
                break;
            }
        }
    },

    stepFrame() {
        const vid = document.getElementById('vlc-active-video');
        if (!vid) return;
        vid.pause();
        vid.currentTime += (1 / 30); // ~1 frame at 30fps
        this.showHint('Frame Step ⏯');
    },

    close() {
        const vid = document.getElementById('vlc-active-video');
        if (vid) {
            vid.pause();
            vid.src = '';
        }
    }
};

// Global Keyboard Listener for VLC Controls
document.addEventListener('keydown', (e) => {
    if (FileShare.activeMediaType !== 'video') return;
    const vid = document.getElementById('vlc-active-video');
    if (!vid) return;

    switch (e.key.toLowerCase()) {
        case ' ':
            e.preventDefault();
            VLCPlayer.togglePlay();
            break;
        case 'arrowright':
            e.preventDefault();
            vid.currentTime = Math.min(vid.duration, vid.currentTime + 10);
            VLCPlayer.showHint('⏭ +10s');
            break;
        case 'arrowleft':
            e.preventDefault();
            vid.currentTime = Math.max(0, vid.currentTime - 10);
            VLCPlayer.showHint('⏮ -10s');
            break;
        case 'arrowup': {
            e.preventDefault();
            const slider = document.getElementById('vlc-volume-slider');
            const newVol = Math.min(2.0, (parseFloat(slider ? slider.value : 1.0) + 0.1));
            if (slider) slider.value = newVol;
            VLCPlayer.onVolumeInput(newVol);
            VLCPlayer.showHint(`Volume: ${Math.round(newVol * 100)}%`);
            break;
        }
        case 'arrowdown': {
            e.preventDefault();
            const slider = document.getElementById('vlc-volume-slider');
            const newVol = Math.max(0, (parseFloat(slider ? slider.value : 1.0) - 0.1));
            if (slider) slider.value = newVol;
            VLCPlayer.onVolumeInput(newVol);
            VLCPlayer.showHint(`Volume: ${Math.round(newVol * 100)}%`);
            break;
        }
        case 'm':
            VLCPlayer.toggleMute();
            break;
        case 'f':
            VLCPlayer.toggleFullscreen();
            break;
        case 's':
            VLCPlayer.stopPlayback();
            break;
        case 'e':
            VLCPlayer.stepFrame();
            break;
        case 'p':
            VLCPlayer.takeSnapshot();
            break;
        case 'a':
            VLCPlayer.cycleAspectRatio();
            break;
    }
});
