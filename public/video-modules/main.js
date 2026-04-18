// Video Module Entry Point
// This will be the main entry for the video gallery functionality

class VideoApp {
  constructor() {
    this.videos = [];
    this.currentFolder = null;
    this.theme = document.body.className || 'default';
    this.isScanning = false;
    this.playingVideos = new Set(); // Track videos playing in grid
    this.settings = {
      theme: this.theme,
      gridColumns: 4,
      cardSize: 250
    };
    this.init();
  }

  init() {
    console.log('Video module initializing...');
    this.loadSettings();
    this.render();
    this.attachEventListeners();
    this.setupVideoWatchers();
    this.loadExistingVideos();
    this.createSettingsPanel();
    this.setupKeyboardNavigation();
  }

  loadSettings() {
    const saved = localStorage.getItem('videoSettings');
    if (saved) {
      this.settings = { ...this.settings, ...JSON.parse(saved) };
    }
    // Apply theme
    if (this.settings.theme) {
      document.body.className = this.settings.theme;
      this.theme = this.settings.theme;
    }
  }

  saveSettings() {
    localStorage.setItem('videoSettings', JSON.stringify(this.settings));
  }

  createSettingsPanel() {
    if (document.getElementById('video-settings-panel')) return;

    const panel = document.createElement('div');
    panel.id = 'video-settings-panel';
    panel.className = 'video-settings-panel';
    panel.innerHTML = `
      <h3>Video Settings</h3>
      
      <div class="video-setting-group">
        <label for="video-theme">Theme</label>
        <select id="video-theme">
          <option value="default">Light</option>
          <option value="dark">Dark</option>
        </select>
        <div class="video-setting-description">Choose light or dark theme</div>
      </div>

      <div class="video-setting-group">
        <label for="video-grid-columns">Grid Columns</label>
        <input type="number" id="video-grid-columns" min="2" max="8" value="${this.settings.gridColumns}">
        <div class="video-setting-description">Number of columns in grid (2-8)</div>
      </div>

      <div class="video-setting-group">
        <label for="video-card-size">Card Size (px)</label>
        <input type="number" id="video-card-size" min="150" max="500" step="50" value="${this.settings.cardSize}">
        <div class="video-setting-description">Minimum card width in pixels</div>
      </div>
    `;

    document.body.appendChild(panel);

    // Set current theme
    document.getElementById('video-theme').value = this.settings.theme;

    // Event listeners
    document.getElementById('video-theme').addEventListener('change', (e) => {
      this.settings.theme = e.target.value;
      document.body.className = e.target.value;
      this.theme = e.target.value;
      this.saveSettings();
    });

    document.getElementById('video-grid-columns').addEventListener('change', (e) => {
      this.settings.gridColumns = parseInt(e.target.value);
      this.saveSettings();
      this.updateGridLayout();
    });

    document.getElementById('video-card-size').addEventListener('change', (e) => {
      this.settings.cardSize = parseInt(e.target.value);
      this.saveSettings();
      this.updateGridLayout();
    });
  }

  updateGridLayout() {
    const grid = document.querySelector('.video-grid');
    if (grid) {
      grid.style.gridTemplateColumns = `repeat(auto-fill, minmax(${this.settings.cardSize}px, 1fr))`;
    }
  }

  setupVideoWatchers() {
    if (!window.electronAPI) return;

    // Listen for scan progress
    window.electronAPI.onVideoScanProgress?.((progress) => {
      this.handleScanProgress(progress);
    });

    // Listen for video file changes
    window.electronAPI.onVideoAdded?.((video) => {
      console.log('Video added:', video);
      this.videos.push(video);
      this.renderVideoGrid();
    });

    window.electronAPI.onVideoRemoved?.((data) => {
      console.log('Video removed:', data);
      this.videos = this.videos.filter(v => v.fingerprint !== data.fingerprint);
      this.renderVideoGrid();
    });

    window.electronAPI.onVideoChanged?.((video) => {
      console.log('Video changed:', video);
      const index = this.videos.findIndex(v => v.fingerprint === video.fingerprint);
      if (index !== -1) {
        this.videos[index] = video;
        this.renderVideoGrid();
      }
    });
  }

  async loadExistingVideos() {
    if (!window.electronAPI?.getAllVideos) {
      console.log('Video API not ready yet');
      return;
    }

    try {
      const result = await window.electronAPI.getAllVideos();
      if (result.success && result.videos) {
        this.videos = result.videos;
        if (this.videos.length > 0) {
          this.renderVideoGrid();
        }
      }
    } catch (error) {
      console.error('Error loading existing videos:', error);
    }
  }

  render() {
    const root = document.getElementById('video-app-root');
    if (!root) return;

    root.innerHTML = `
      <div class="video-container">
        <div class="video-empty">
          <i class="fa-solid fa-video"></i>
          <h2>No videos loaded</h2>
          <p>Click "Select Folder" to browse your video collection</p>
        </div>
      </div>
    `;
  }

  attachEventListeners() {
    // Select folder button
    const selectBtn = document.getElementById('select-folder');
    if (selectBtn) {
      selectBtn.addEventListener('click', () => this.selectFolder());
    }

    // Video settings button
    const settingsBtn = document.getElementById('video-settings');
    if (settingsBtn) {
      settingsBtn.addEventListener('click', () => this.toggleSettings());
    }

    // Navigation buttons
    document.getElementById('prev')?.addEventListener('click', () => history.back());
    document.getElementById('next')?.addEventListener('click', () => history.forward());
  }

  toggleSettings() {
    const panel = document.getElementById('video-settings-panel');
    if (panel) {
      panel.classList.toggle('open');
    }
  }

  setupKeyboardNavigation() {
    document.addEventListener('keydown', (e) => {
      const expandedCard = document.querySelector('.video-card.expanded');
      if (!expandedCard) return;

      const fingerprint = expandedCard.dataset.fingerprint;
      const currentIndex = this.videos.findIndex(v => v.fingerprint === fingerprint);

      if (e.key === 'ArrowLeft' && currentIndex > 0) {
        // Previous video
        e.preventDefault();
        const prevVideo = this.videos[currentIndex - 1];
        this.toggleExpandVideo(fingerprint); // Close current
        setTimeout(() => this.toggleExpandVideo(prevVideo.fingerprint), 100); // Open previous
      } else if (e.key === 'ArrowRight' && currentIndex < this.videos.length - 1) {
        // Next video
        e.preventDefault();
        const nextVideo = this.videos[currentIndex + 1];
        this.toggleExpandVideo(fingerprint); // Close current
        setTimeout(() => this.toggleExpandVideo(nextVideo.fingerprint), 100); // Open next
      } else if (e.key === 'Escape') {
        // Close expanded video
        e.preventDefault();
        this.toggleExpandVideo(fingerprint);
      } else if (e.key === ' ' || e.code === 'Space') {
        // Toggle play/pause
        e.preventDefault();
        const video = expandedCard.querySelector('video');
        if (video.paused) {
          video.play();
        } else {
          video.pause();
        }
      }
    });
  }

  async selectFolder() {
    if (this.isScanning) {
      alert('Already scanning videos...');
      return;
    }

    console.log('Select folder clicked');
    
    // Check if we're in Electron
    if (typeof window.electronAPI !== 'undefined' && window.electronAPI.selectDirectory) {
      try {
        const result = await window.electronAPI.selectDirectory();
        if (result && result.length > 0) {
          this.currentFolder = result[0];
          await this.loadVideos(this.currentFolder);
        }
      } catch (error) {
        console.error('Error selecting folder:', error);
        this.showError('Failed to select folder: ' + error.message);
      }
    } else {
      alert('Folder selection is only available in the desktop app');
    }
  }

  handleScanProgress(progress) {
    const root = document.getElementById('video-app-root');
    if (!root) return;

    if (progress.type === 'start') {
      console.log('Scan started:', progress.path);
    } else if (progress.type === 'file') {
      // Video found and indexed
      if (!this.videos.find(v => v.fingerprint === progress.video.fingerprint)) {
        this.videos.push(progress.video);
      }
      this.updateScanStatus();
    } else if (progress.type === 'complete') {
      console.log('Scan complete:', progress.count, 'videos');
      this.isScanning = false;
      this.renderVideoGrid();
    } else if (progress.type === 'error') {
      console.error('Scan error:', progress.error);
    }
  }

  updateScanStatus() {
    const root = document.getElementById('video-app-root');
    if (!root) return;

    root.innerHTML = `
      <div class="video-container">
        <div class="video-loading">
          <i class="fa-solid fa-circle-notch fa-spin"></i>
          <span style="margin-left: 15px;">Scanning videos... Found ${this.videos.length}</span>
        </div>
      </div>
    `;
  }

  async loadVideos(folderPath) {
    console.log('Loading videos from:', folderPath);
    this.isScanning = true;
    
    const root = document.getElementById('video-app-root');
    if (!root) return;

    root.innerHTML = `
      <div class="video-container">
        <div class="video-loading">
          <i class="fa-solid fa-circle-notch fa-spin"></i>
          <span style="margin-left: 15px;">Scanning videos...</span>
        </div>
      </div>
    `;

    try {
      const result = await window.electronAPI.scanVideos(folderPath, { recursive: true });
      
      if (result.success) {
        this.videos = result.videos || [];
        this.isScanning = false;
        this.renderVideoGrid();
      } else {
        this.isScanning = false;
        this.showError(result.error || 'Failed to scan videos');
      }
    } catch (error) {
      this.isScanning = false;
      console.error('Error scanning videos:', error);
      this.showError('Error scanning videos: ' + error.message);
    }
  }

  renderVideoGrid() {
    const root = document.getElementById('video-app-root');
    if (!root) return;

    if (this.videos.length === 0) {
      this.render();
      return;
    }

    // Update content info
    const contentInfo = document.querySelector('.content-info');
    if (contentInfo) {
      contentInfo.innerHTML = `<i class="fa-solid fa-check"></i> ${this.videos.length}`;
    }

    // Simple grid for now (masonry layout in Phase 3)
    const videoCards = this.videos.map(video => this.createVideoCard(video)).join('');
    
    root.innerHTML = `
      <div class="video-container">
        <div class="video-grid" style="grid-template-columns: repeat(auto-fill, minmax(${this.settings.cardSize}px, 1fr));">
          ${videoCards}
        </div>
      </div>
    `;

    // Attach click handlers to video cards
    this.attachVideoCardHandlers();
    
    // Setup lazy loading with Intersection Observer
    this.setupLazyLoading();
  }

  setupLazyLoading() {
    const options = {
      root: null,
      rootMargin: '50px',
      threshold: 0.01
    };

    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const videoElement = entry.target;
          if (!videoElement.src && videoElement.dataset.src) {
            videoElement.src = videoElement.dataset.src;
            videoElement.load();
          }
          observer.unobserve(videoElement);
        }
      });
    }, options);

    // Observe all video elements
    document.querySelectorAll('.video-card video').forEach(video => {
      observer.observe(video);
    });
  }

  attachVideoCardHandlers() {
    const cards = document.querySelectorAll('.video-card');
    cards.forEach(card => {
      const videoElement = card.querySelector('video');
      const fingerprint = card.dataset.fingerprint;

      // Hover to preview
      card.addEventListener('mouseenter', () => {
        // Only play on hover if not explicitly playing and not expanded
        if (!this.playingVideos.has(fingerprint) && !card.classList.contains('expanded')) {
          if (videoElement.src) {
            videoElement.play().catch(() => {});
          }
        }
      });

      card.addEventListener('mouseleave', () => {
        // Only pause on leave if not explicitly playing and not expanded
        if (!this.playingVideos.has(fingerprint) && !card.classList.contains('expanded')) {
          videoElement.pause();
          videoElement.currentTime = 0;
        }
      });

      // Click on card to expand
      card.addEventListener('click', (e) => {
        // Don't expand if clicking on buttons
        if (e.target.closest('.video-card-btn')) {
          return;
        }
        this.toggleExpandVideo(fingerprint);
      });

      // Play button
      const playBtn = card.querySelector('.play-btn');
      playBtn?.addEventListener('click', (e) => {
        e.stopPropagation();
        
        if (this.playingVideos.has(fingerprint)) {
          // Stop playing
          videoElement.pause();
          videoElement.currentTime = 0;
          this.playingVideos.delete(fingerprint);
          playBtn.classList.remove('playing');
        } else {
          // Start playing
          if (videoElement.src) {
            videoElement.play().catch(() => {});
          }
          this.playingVideos.add(fingerprint);
          playBtn.classList.add('playing');
        }
      });

      // Popout button
      const popoutBtn = card.querySelector('.popout-btn');
      popoutBtn?.addEventListener('click', (e) => {
        e.stopPropagation();
        
        // Always pause and reset grid video when popping out
        videoElement.pause();
        videoElement.currentTime = 0;
        
        // Remove from playing set if it was playing
        if (this.playingVideos.has(fingerprint)) {
          this.playingVideos.delete(fingerprint);
          playBtn?.classList.remove('playing');
        }
        
        // Open in new Electron window with video dimensions
        const video = this.videos.find(v => v.fingerprint === fingerprint);
        if (video) {
          const width = video.width || 800;
          const height = video.height || 600;
          const url = `/video-viewer?fingerprint=${fingerprint}&filename=${encodeURIComponent(video.filename)}&width=${width}&height=${height}`;
          window.open(url, "_blank", "popup");
        }
      });
    });
  }

  toggleExpandVideo(fingerprint) {
    const card = document.querySelector(`.video-card[data-fingerprint="${fingerprint}"]`);
    if (!card) return;

    const isExpanded = card.classList.contains('expanded');
    
    // Close any other expanded cards
    document.querySelectorAll('.video-card.expanded').forEach(c => {
      if (c !== card) {
        c.classList.remove('expanded');
        const v = c.querySelector('video');
        if (v) {
          v.controls = false;
          v.muted = true;
          if (!this.playingVideos.has(c.dataset.fingerprint)) {
            v.pause();
            v.currentTime = 0;
          }
        }
      }
    });

    const videoElement = card.querySelector('video');

    if (isExpanded) {
      // Collapse
      card.classList.remove('expanded');
      videoElement.controls = false;
      videoElement.muted = true;
      if (!this.playingVideos.has(fingerprint)) {
        videoElement.pause();
        videoElement.currentTime = 0;
      }
    } else {
      // Expand
      card.classList.add('expanded');
      videoElement.controls = true;
      videoElement.muted = false;
      if (videoElement.src) {
        videoElement.play().catch(() => {});
      }
      
      // Scroll card into view
      card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }

  createVideoCard(video) {
    const filename = video.filename || 'Unknown';
    const size = this.formatFileSize(video.size);
    const dimensions = video.width && video.height ? `${video.width}×${video.height}` : 'Unknown';
    const videoUrl = `/video/${video.fingerprint}`;
    
    return `
      <div class="video-card" data-fingerprint="${video.fingerprint}">
        <video 
          data-src="${videoUrl}"
          preload="none"
          muted
          loop
        ></video>
        <div class="video-card-controls">
          <button class="video-card-btn play-btn" title="Play/Pause in grid">
            <i class="fa-solid fa-play"></i>
          </button>
          <button class="video-card-btn popout-btn" title="Pop out player">
            <i class="fa-solid fa-up-right-from-square"></i>
          </button>
        </div>
        <div class="video-info">
          <div class="video-filename">${filename}</div>
          <div class="video-meta">${dimensions} • ${size}</div>
        </div>
      </div>
    `;
  }

  formatFileSize(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }

  showError(message) {
    const root = document.getElementById('video-app-root');
    if (!root) return;

    root.innerHTML = `
      <div class="video-container">
        <div class="video-empty">
          <i class="fa-solid fa-exclamation-triangle"></i>
          <h2>Error</h2>
          <p>${message}</p>
        </div>
      </div>
    `;
  }
}

// Initialize the app when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    window.videoApp = new VideoApp();
  });
} else {
  window.videoApp = new VideoApp();
}
