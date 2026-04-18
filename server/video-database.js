// Video Database Module
// SQLite database for video metadata with fingerprint-based tracking

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

class VideoDatabase {
  constructor(dbPath) {
    this.dbPath = dbPath;
    this.db = null;
    this.init();
  }

  init() {
    // Ensure directory exists
    const dir = path.dirname(this.dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.db = new Database(this.dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');

    // Create tables
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS videos (
        fingerprint TEXT PRIMARY KEY,
        file_path TEXT NOT NULL,
        filename TEXT NOT NULL,
        size INTEGER NOT NULL,
        width INTEGER,
        height INTEGER,
        duration REAL,
        aspect_ratio REAL,
        created_at INTEGER NOT NULL,
        modified_at INTEGER NOT NULL,
        indexed_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS tags (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE COLLATE NOCASE
      );

      CREATE TABLE IF NOT EXISTS video_tags (
        fingerprint TEXT NOT NULL,
        tag_id INTEGER NOT NULL,
        added_at INTEGER NOT NULL,
        PRIMARY KEY (fingerprint, tag_id),
        FOREIGN KEY (fingerprint) REFERENCES videos(fingerprint) ON DELETE CASCADE,
        FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS ratings (
        fingerprint TEXT PRIMARY KEY,
        value INTEGER NOT NULL CHECK (value BETWEEN 0 AND 5),
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (fingerprint) REFERENCES videos(fingerprint) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_videos_path ON videos(file_path);
      CREATE INDEX IF NOT EXISTS idx_videos_filename ON videos(filename);
      CREATE INDEX IF NOT EXISTS idx_video_tags_tag ON video_tags(tag_id);
      CREATE INDEX IF NOT EXISTS idx_videos_created ON videos(created_at);
    `);

    console.log('Video database initialized:', this.dbPath);
  }

  // Compute fingerprint from file (first 64KB + size + mtime)
  async computeFingerprint(filePath, stats) {
    return new Promise((resolve, reject) => {
      const hash = crypto.createHash('sha256');
      const stream = fs.createReadStream(filePath, { start: 0, end: 65535 });
      
      stream.on('data', (chunk) => hash.update(chunk));
      stream.on('end', () => {
        hash.update(String(stats.size));
        hash.update(String(stats.mtimeMs));
        resolve(hash.digest('hex'));
      });
      stream.on('error', reject);
    });
  }

  // Index a video file
  async indexVideo(filePath, stats, dimensions = null) {
    const fingerprint = await this.computeFingerprint(filePath, stats);
    const filename = path.basename(filePath);
    const now = Date.now();

    const stmt = this.db.prepare(`
      INSERT INTO videos (
        fingerprint, file_path, filename, size, width, height, 
        duration, aspect_ratio, created_at, modified_at, indexed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(fingerprint) DO UPDATE SET
        file_path = excluded.file_path,
        filename = excluded.filename,
        modified_at = excluded.modified_at,
        indexed_at = excluded.indexed_at,
        width = COALESCE(excluded.width, videos.width),
        height = COALESCE(excluded.height, videos.height),
        duration = COALESCE(excluded.duration, videos.duration),
        aspect_ratio = COALESCE(excluded.aspect_ratio, videos.aspect_ratio)
    `);

    stmt.run(
      fingerprint,
      filePath,
      filename,
      stats.size,
      dimensions?.width || null,
      dimensions?.height || null,
      dimensions?.duration || null,
      dimensions?.aspectRatio || null,
      Math.floor(stats.birthtimeMs || stats.ctimeMs),
      Math.floor(stats.mtimeMs),
      now
    );

    return this.getVideo(fingerprint);
  }

  // Get video by fingerprint
  getVideo(fingerprint) {
    const video = this.db.prepare('SELECT * FROM videos WHERE fingerprint = ?').get(fingerprint);
    if (!video) return null;

    const tags = this.getVideoTags(fingerprint);
    const rating = this.getVideoRating(fingerprint);

    return {
      ...video,
      tags,
      rating,
      id: video.fingerprint
    };
  }

  // Get video by file path
  getVideoByPath(filePath) {
    const video = this.db.prepare('SELECT * FROM videos WHERE file_path = ?').get(filePath);
    if (!video) return null;
    return this.getVideo(video.fingerprint);
  }

  // Get all videos
  getAllVideos() {
    const videos = this.db.prepare('SELECT * FROM videos ORDER BY created_at DESC').all();
    return videos.map(v => this.getVideo(v.fingerprint));
  }

  // Get video tags
  getVideoTags(fingerprint) {
    const rows = this.db.prepare(`
      SELECT t.name 
      FROM tags t
      INNER JOIN video_tags vt ON vt.tag_id = t.id
      WHERE vt.fingerprint = ?
      ORDER BY t.name COLLATE NOCASE
    `).all(fingerprint);
    return rows.map(r => r.name);
  }

  // Get video rating
  getVideoRating(fingerprint) {
    const row = this.db.prepare('SELECT value FROM ratings WHERE fingerprint = ?').get(fingerprint);
    return row ? row.value : null;
  }

  // Add tags to videos
  addTags(fingerprints, tagNames) {
    const now = Date.now();
    const transaction = this.db.transaction(() => {
      for (const tagName of tagNames) {
        const trimmed = tagName.trim();
        if (!trimmed) continue;

        // Insert tag if not exists
        this.db.prepare('INSERT OR IGNORE INTO tags (name) VALUES (?)').run(trimmed);
        const tag = this.db.prepare('SELECT id FROM tags WHERE name = ? COLLATE NOCASE').get(trimmed);
        
        if (tag) {
          for (const fingerprint of fingerprints) {
            this.db.prepare(`
              INSERT OR IGNORE INTO video_tags (fingerprint, tag_id, added_at)
              VALUES (?, ?, ?)
            `).run(fingerprint, tag.id, now);
          }
        }
      }
    });
    transaction();
  }

  // Remove tag from videos
  removeTag(fingerprints, tagName) {
    const trimmed = tagName.trim();
    if (!trimmed) return;

    const tag = this.db.prepare('SELECT id FROM tags WHERE name = ? COLLATE NOCASE').get(trimmed);
    if (!tag) return;

    const transaction = this.db.transaction(() => {
      for (const fingerprint of fingerprints) {
        this.db.prepare('DELETE FROM video_tags WHERE fingerprint = ? AND tag_id = ?')
          .run(fingerprint, tag.id);
      }

      // Clean up unused tags
      const usage = this.db.prepare('SELECT COUNT(*) as count FROM video_tags WHERE tag_id = ?')
        .get(tag.id);
      if (usage.count === 0) {
        this.db.prepare('DELETE FROM tags WHERE id = ?').run(tag.id);
      }
    });
    transaction();
  }

  // Set rating for videos
  setRating(fingerprints, rating) {
    const now = Date.now();
    const transaction = this.db.transaction(() => {
      for (const fingerprint of fingerprints) {
        if (rating === null || rating === undefined) {
          this.db.prepare('DELETE FROM ratings WHERE fingerprint = ?').run(fingerprint);
        } else {
          const safeRating = Math.max(0, Math.min(5, Math.round(rating)));
          this.db.prepare(`
            INSERT INTO ratings (fingerprint, value, updated_at)
            VALUES (?, ?, ?)
            ON CONFLICT(fingerprint) DO UPDATE SET
              value = excluded.value,
              updated_at = excluded.updated_at
          `).run(fingerprint, safeRating, now);
        }
      }
    });
    transaction();
  }

  // Get all tags with usage count
  getAllTags() {
    return this.db.prepare(`
      SELECT t.name, COUNT(vt.fingerprint) as count
      FROM tags t
      LEFT JOIN video_tags vt ON vt.tag_id = t.id
      GROUP BY t.id
      ORDER BY t.name COLLATE NOCASE
    `).all();
  }

  // Delete video
  deleteVideo(fingerprint) {
    this.db.prepare('DELETE FROM videos WHERE fingerprint = ?').run(fingerprint);
  }

  // Update video dimensions
  updateDimensions(fingerprint, dimensions) {
    this.db.prepare(`
      UPDATE videos 
      SET width = ?, height = ?, duration = ?, aspect_ratio = ?
      WHERE fingerprint = ?
    `).run(
      dimensions.width || null,
      dimensions.height || null,
      dimensions.duration || null,
      dimensions.aspectRatio || null,
      fingerprint
    );
  }

  close() {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }
}

module.exports = VideoDatabase;
