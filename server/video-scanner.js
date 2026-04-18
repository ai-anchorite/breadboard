// Video Scanner Module
// Scans directories for video files and extracts metadata

const fs = require('fs').promises;
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);

const VIDEO_EXTENSIONS = [
  '.mp4', '.mov', '.avi', '.mkv', '.webm', 
  '.m4v', '.flv', '.wmv', '.3gp', '.ogv'
];

class VideoScanner {
  constructor(database) {
    this.db = database;
  }

  isVideoFile(filename) {
    const ext = path.extname(filename).toLowerCase();
    return VIDEO_EXTENSIONS.includes(ext);
  }

  // Get video dimensions using ffprobe (if available) or fallback
  async getVideoDimensions(filePath) {
    try {
      // Try ffprobe first (most accurate)
      const { stdout } = await execAsync(
        `ffprobe -v error -select_streams v:0 -show_entries stream=width,height,duration -of json "${filePath}"`
      );
      const data = JSON.parse(stdout);
      const stream = data.streams?.[0];
      
      if (stream) {
        const width = parseInt(stream.width);
        const height = parseInt(stream.height);
        const duration = parseFloat(stream.duration);
        
        return {
          width,
          height,
          duration,
          aspectRatio: width / height
        };
      }
    } catch (error) {
      // ffprobe not available or failed, return null
      // Dimensions will be extracted when video loads in browser
      console.log('ffprobe not available for:', path.basename(filePath));
    }
    
    return null;
  }

  // Scan a single file
  async scanFile(filePath, stats, onProgress) {
    try {
      // Get stats if not provided
      if (!stats) {
        stats = await fs.stat(filePath);
      }
      
      if (!stats.isFile()) {
        return null;
      }

      if (!this.isVideoFile(filePath)) {
        return null;
      }

      // Get dimensions (optional, can be slow)
      const dimensions = await this.getVideoDimensions(filePath);

      // Index in database
      const video = await this.db.indexVideo(filePath, stats, dimensions);

      if (onProgress) {
        onProgress({ type: 'file', video });
      }

      return video;
    } catch (error) {
      console.error('Error scanning file:', filePath, error.message);
      if (onProgress) {
        onProgress({ type: 'error', filePath, error: error.message });
      }
      return null;
    }
  }

  // Scan directory recursively
  async scanDirectory(dirPath, options = {}, onProgress) {
    const { recursive = true, maxDepth = 10 } = options;
    const videos = [];
    const self = this; // Capture 'this' context

    async function scan(currentPath, depth = 0) {
      if (!recursive && depth > 0) return;
      if (depth > maxDepth) return;

      try {
        const entries = await fs.readdir(currentPath, { withFileTypes: true });

        for (const entry of entries) {
          const fullPath = path.join(currentPath, entry.name);

          // Skip hidden files/folders
          if (entry.name.startsWith('.')) continue;

          if (entry.isDirectory()) {
            if (recursive) {
              await scan(fullPath, depth + 1);
            }
          } else if (entry.isFile()) {
            const video = await self.scanFile(fullPath, null, onProgress);
            if (video) {
              videos.push(video);
            }
          }
        }
      } catch (error) {
        console.error('Error scanning directory:', currentPath, error.message);
        if (onProgress) {
          onProgress({ type: 'error', path: currentPath, error: error.message });
        }
      }
    }

    if (onProgress) {
      onProgress({ type: 'start', path: dirPath });
    }

    await scan(dirPath);

    if (onProgress) {
      onProgress({ type: 'complete', count: videos.length });
    }

    return videos;
  }

  // Quick scan (just list files, no metadata extraction)
  async quickScan(dirPath, options = {}) {
    const { recursive = true } = options;
    const files = [];

    async function scan(currentPath, depth = 0) {
      if (!recursive && depth > 0) return;
      if (depth > 10) return;

      try {
        const entries = await fs.readdir(currentPath, { withFileTypes: true });

        for (const entry of entries) {
          const fullPath = path.join(currentPath, entry.name);

          if (entry.name.startsWith('.')) continue;

          if (entry.isDirectory() && recursive) {
            await scan(fullPath, depth + 1);
          } else if (entry.isFile()) {
            const ext = path.extname(entry.name).toLowerCase();
            if (VIDEO_EXTENSIONS.includes(ext)) {
              files.push(fullPath);
            }
          }
        }
      } catch (error) {
        console.error('Error in quick scan:', currentPath, error.message);
      }
    }

    await scan(dirPath);
    return files;
  }
}

module.exports = VideoScanner;
