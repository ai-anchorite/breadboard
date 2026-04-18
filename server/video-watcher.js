// Video Watcher Module
// Monitors video directories for changes using Chokidar

const chokidar = require('chokidar');
const path = require('path');

const VIDEO_EXTENSIONS = [
  '.mp4', '.mov', '.avi', '.mkv', '.webm', 
  '.m4v', '.flv', '.wmv', '.3gp', '.ogv'
];

class VideoWatcher {
  constructor(database, scanner) {
    this.db = database;
    this.scanner = scanner;
    this.watcher = null;
    this.currentPath = null;
  }

  isVideoFile(filename) {
    const ext = path.extname(filename).toLowerCase();
    return VIDEO_EXTENSIONS.includes(ext);
  }

  start(folderPath, options = {}, callbacks = {}) {
    const { recursive = true } = options;
    const { onAdded, onRemoved, onChanged, onReady, onError } = callbacks;

    // Stop existing watcher
    this.stop();

    this.currentPath = folderPath;

    this.watcher = chokidar.watch(folderPath, {
      ignored: [
        /(^|[\/\\])\../,  // ignore dot files
        '**/node_modules/**',
        '**/.git/**',
      ],
      persistent: true,
      ignoreInitial: true,
      depth: recursive ? 10 : 0,
      usePolling: false,
      awaitWriteFinish: {
        stabilityThreshold: 500,
        pollInterval: 100
      },
      atomic: true,
      followSymlinks: false,
      ignorePermissionErrors: true,
    });

    this.watcher.on('ready', () => {
      console.log('Video watcher ready for:', folderPath);
      if (onReady) onReady();
    });

    this.watcher.on('add', async (filePath) => {
      if (!this.isVideoFile(filePath)) return;
      
      console.log('Video added:', filePath);
      try {
        const fs = require('fs').promises;
        const stats = await fs.stat(filePath);
        const video = await this.scanner.scanFile(filePath, stats);
        if (video && onAdded) {
          onAdded(video);
        }
      } catch (error) {
        console.error('Error processing added video:', error);
        if (onError) onError(error);
      }
    });

    this.watcher.on('unlink', (filePath) => {
      if (!this.isVideoFile(filePath)) return;
      
      console.log('Video removed:', filePath);
      const video = this.db.getVideoByPath(filePath);
      if (video) {
        this.db.deleteVideo(video.fingerprint);
        if (onRemoved) {
          onRemoved(filePath, video.fingerprint);
        }
      }
    });

    this.watcher.on('change', async (filePath) => {
      if (!this.isVideoFile(filePath)) return;
      
      console.log('Video changed:', filePath);
      try {
        const fs = require('fs').promises;
        const stats = await fs.stat(filePath);
        const video = await this.scanner.scanFile(filePath, stats);
        if (video && onChanged) {
          onChanged(video);
        }
      } catch (error) {
        console.error('Error processing changed video:', error);
        if (onError) onError(error);
      }
    });

    this.watcher.on('error', (error) => {
      console.error('Video watcher error:', error);
      if (onError) onError(error);
    });

    return this.watcher;
  }

  stop() {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
      this.currentPath = null;
      console.log('Video watcher stopped');
    }
  }

  isWatching() {
    return this.watcher !== null;
  }

  getCurrentPath() {
    return this.currentPath;
  }
}

module.exports = VideoWatcher;
