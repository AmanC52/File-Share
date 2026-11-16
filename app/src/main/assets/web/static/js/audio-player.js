/* ==========================================================================
   audio-player.js - Modern Music Player with Real-time Canvas Visualizer
   ========================================================================== */

window.AudioPlayer = {
    currentIndex: -1,
    audioList: [],
    isShuffle: false,
    repeatMode: 'all', // 'all', 'one', 'off'
    audioCtx: null,
    analyser: null,
    animFrameId: null,

    play(index) {
        stopAllMedia();
        this.currentIndex = index;
        FileShare.currentMediaIndex = index;
        FileShare.activeMediaType = 'audio';

        // Extract all audio files in the current directory for playlist queue
        this.audioList = FileShare.items
            .map((item, idx) => ({ ...item, originalIndex: idx }))
            .filter(item => item.type === 'audio');

        const item = FileShare.items[index];
        if (!item) return;

        const player = document.getElementById('music-player');
        const audio = document.getElementById('audio-element');
        const title = document.getElementById('audio-title');
        const disc = document.getElementById('music-disc');

        if (!player || !audio) return;

        if (title) title.innerText = item.name;
        audio.src = '/api/stream?path=' + encodeURIComponent(item.path);
        player.classList.add('active');

        // Web Audio API Visualizer Setup
        this.setupVisualizer(audio);

        audio.play().then(() => {
            if (disc) disc.classList.remove('paused');
        }).catch(() => {});

        audio.onplay = () => { if (disc) disc.classList.remove('paused'); };
        audio.onpause = () => { if (disc) disc.classList.add('paused'); };

        audio.onended = () => {
            if (this.repeatMode === 'one') {
                audio.currentTime = 0;
                audio.play();
            } else {
                this.next();
            }
        };
    },

    setupVisualizer(audio) {
        try {
            const canvas = document.getElementById('audio-visualizer-canvas');
            if (!canvas) return;
            const ctx = canvas.getContext('2d');

            const AudioContext = window.AudioContext || window.webkitAudioContext;
            if (!this.audioCtx) {
                this.audioCtx = new AudioContext();
            }
            if (this.audioCtx.state === 'suspended') {
                this.audioCtx.resume();
            }

            if (!this.analyser) {
                this.analyser = this.audioCtx.createAnalyser();
                this.analyser.fftSize = 64;
                const src = this.audioCtx.createMediaElementSource(audio);
                src.connect(this.analyser);
                this.analyser.connect(this.audioCtx.destination);
            }

            const bufferLength = this.analyser.frequencyBinCount;
            const dataArray = new Uint8Array(bufferLength);

            const draw = () => {
                this.animFrameId = requestAnimationFrame(draw);
                this.analyser.getByteFrequencyData(dataArray);

                ctx.clearRect(0, 0, canvas.width, canvas.height);
                const barWidth = (canvas.width / bufferLength) * 1.5;
                let x = 0;

                for (let i = 0; i < bufferLength; i++) {
                    const barHeight = (dataArray[i] / 255) * canvas.height;
                    ctx.fillStyle = `rgb(99, 102, ${Math.min(255, 180 + dataArray[i])})`;
                    ctx.fillRect(x, canvas.height - barHeight, barWidth - 1, barHeight);
                    x += barWidth;
                }
            };

            cancelAnimationFrame(this.animFrameId);
            draw();
        } catch (e) {
            console.log('Visualizer setup info:', e.message);
        }
    },

    next() {
        if (this.audioList.length === 0) return;
        let currentPos = this.audioList.findIndex(a => a.originalIndex === this.currentIndex);
        if (currentPos === -1) currentPos = 0;

        let nextPos;
        if (this.isShuffle) {
            nextPos = Math.floor(Math.random() * this.audioList.length);
        } else {
            nextPos = (currentPos + 1) % this.audioList.length;
        }

        const nextSong = this.audioList[nextPos];
        if (nextSong) this.play(nextSong.originalIndex);
    },

    prev() {
        if (this.audioList.length === 0) return;
        let currentPos = this.audioList.findIndex(a => a.originalIndex === this.currentIndex);
        if (currentPos === -1) currentPos = 0;

        let prevPos = (currentPos - 1 + this.audioList.length) % this.audioList.length;
        const prevSong = this.audioList[prevPos];
        if (prevSong) this.play(prevSong.originalIndex);
    },

    stop() {
        const player = document.getElementById('music-player');
        const audio = document.getElementById('audio-element');
        if (audio) {
            audio.pause();
            audio.src = '';
        }
        if (player) player.classList.remove('active');
        if (this.animFrameId) cancelAnimationFrame(this.animFrameId);
    }
};
