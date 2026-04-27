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

const MIME_TYPES = {
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.ogv': 'video/ogg',
  '.avi': 'video/x-msvideo',
  '.mkv': 'video/x-matroska',
  '.flv': 'video/x-flv',
  '.wmv': 'video/x-ms-wmv',
  '.3gp': 'video/3gpp'
};

class VideoScanner {
  constructor(database, thumbnailDir) {
    this.db = database;
    this.thumbnailDir = thumbnailDir;
  }

  isVideoFile(filename) {
    const ext = path.extname(filename).toLowerCase();
    return VIDEO_EXTENSIONS.includes(ext);
  }

  inferPlaybackStrategy(filePath, metadata = {}) {
    const ext = path.extname(filePath).toLowerCase();
    const videoCodec = (metadata.videoCodec || '').toLowerCase();
    const formatName = (metadata.formatName || '').toLowerCase();

    const isMp4Family = ['.mp4', '.m4v', '.mov'].includes(ext) || /(mp4|mov|isom|quicktime)/.test(formatName);
    const isWebm = ext === '.webm' || /webm/.test(formatName);
    const isOgg = ext === '.ogv' || /ogg/.test(formatName);

    if (isMp4Family && ['h264', 'avc1'].includes(videoCodec)) return 'direct';
    if (isWebm && ['vp8', 'vp9', 'av1'].includes(videoCodec)) return 'direct';
    if (isOgg && ['theora'].includes(videoCodec)) return 'direct';

    return 'transcode';
  }

  parseFrameRate(rate) {
    if (!rate || typeof rate !== 'string') return null;
    const parts = rate.split('/');
    if (parts.length === 2) {
      const numerator = parseFloat(parts[0]);
      const denominator = parseFloat(parts[1]);
      if (!isNaN(numerator) && !isNaN(denominator) && denominator !== 0) {
        return numerator / denominator;
      }
    }
    const fallback = parseFloat(rate);
    return isNaN(fallback) ? null : fallback;
  }

  // Get video metadata using ffprobe (if available) or fallback
  async getVideoMetadata(filePath) {
    try {
      const { stdout } = await execAsync(
        `ffprobe -v error -show_entries format=format_name,duration:stream=index,codec_type,codec_name,width,height,duration,r_frame_rate -of json "${filePath}"`,
        { timeout: 30000 }
      );
      const data = JSON.parse(stdout);
      const videoStream = data.streams?.find((stream) => stream.codec_type === 'video');
      const audioStream = data.streams?.find((stream) => stream.codec_type === 'audio');
      
      if (videoStream) {
        const width = parseInt(videoStream.width);
        const height = parseInt(videoStream.height);
        const duration = parseFloat(videoStream.duration || data.format?.duration);
        const formatName = data.format?.format_name || null;
        const mimeType = MIME_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
        const videoCodec = videoStream.codec_name || null;
        const audioCodec = audioStream?.codec_name || null;
        const fps = this.parseFrameRate(videoStream.r_frame_rate);
        
        return {
          width: isNaN(width) ? null : width,
          height: isNaN(height) ? null : height,
          duration: isNaN(duration) ? null : duration,
          fps: fps && !isNaN(fps) ? fps : null,
          aspectRatio: (width && height) ? width / height : null,
          formatName,
          mimeType,
          videoCodec,
          audioCodec,
          playbackStrategy: this.inferPlaybackStrategy(filePath, { videoCodec, formatName })
        };
      }
    } catch (error) {
      console.log('ffprobe failed for:', path.basename(filePath), error.killed ? '(timeout)' : '');
    }
    
    return null;
  }

  // Generate thumbnail using ffmpeg — extract first frame
  async generateThumbnail(filePath, fingerprint) {
    if (!this.thumbnailDir) return null;
    const fsSync = require('fs');
    if (!fsSync.existsSync(this.thumbnailDir)) {
      fsSync.mkdirSync(this.thumbnailDir, { recursive: true });
    }
    const thumbPath = path.join(this.thumbnailDir, `${fingerprint}.jpg`);
    // Skip if thumbnail already exists
    if (fsSync.existsSync(thumbPath)) return thumbPath;
    try {
      // -ss before -i = input seeking (fast, doesn't decode entire file)
      await execAsync(
        `ffmpeg -y -ss 0 -i "${filePath}" -vframes 1 -q:v 4 "${thumbPath}"`,
        { timeout: 30000 }
      );
      if (fsSync.existsSync(thumbPath)) return thumbPath;
    } catch (e) {
      console.log('Thumbnail failed for:', path.basename(filePath), e.killed ? '(timeout)' : '');
    }
    return null;
  }

  // Scan a single file
  async scanFile(filePath, stats, onProgress) {
    try {
      if (!stats) {
        stats = await fs.stat(filePath);
      }
      if (!stats.isFile()) return null;
      if (!this.isVideoFile(filePath)) return null;

      // Check if already indexed with same mtime — skip expensive ffprobe/ffmpeg
      const existingRow = this.db.getVideoStub(filePath);
      const hasPlaybackMetadata = existingRow && existingRow.playback_strategy && existingRow.mime_type && (existingRow.video_codec || existingRow.format_name);
      if (existingRow && existingRow.modified_at === Math.floor(stats.mtimeMs) && hasPlaybackMetadata) {
        // Already indexed and unchanged — just ensure thumbnail exists
        if (!existingRow.thumbnail_path) {
          const thumbPath = await this.generateThumbnail(filePath, existingRow.fingerprint);
          if (thumbPath) this.db.setThumbnail(existingRow.fingerprint, thumbPath);
        }
        const video = this.db.getVideo(existingRow.fingerprint);
        if (onProgress) onProgress({ type: 'file', video });
        return video;
      }

      // Get dimensions
      const dimensions = await this.getVideoMetadata(filePath);

      // Index in database
      const video = await this.db.indexVideo(filePath, stats, dimensions);

      // Generate thumbnail
      if (video && video.fingerprint) {
        const thumbPath = await this.generateThumbnail(filePath, video.fingerprint);
        if (thumbPath) {
          this.db.setThumbnail(video.fingerprint, thumbPath);
          video.thumbnail_path = thumbPath;
        }
      }

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
