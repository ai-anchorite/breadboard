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
        root_path TEXT,
        size INTEGER NOT NULL,
        width INTEGER,
        height INTEGER,
        duration REAL,
        aspect_ratio REAL,
        thumbnail_path TEXT,
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

      CREATE TABLE IF NOT EXISTS folders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        path TEXT NOT NULL UNIQUE,
        added_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        val TEXT
      );

      CREATE TABLE IF NOT EXISTS trash (
        fingerprint TEXT PRIMARY KEY,
        original_path TEXT NOT NULL,
        trash_path TEXT NOT NULL,
        deleted_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_videos_path ON videos(file_path);
      CREATE INDEX IF NOT EXISTS idx_videos_filename ON videos(filename);
      CREATE INDEX IF NOT EXISTS idx_video_tags_tag ON video_tags(tag_id);
      CREATE INDEX IF NOT EXISTS idx_videos_created ON videos(created_at);
    `);

    // Migrate: add columns if they don't exist (for existing databases)
    try { this.db.exec('ALTER TABLE videos ADD COLUMN thumbnail_path TEXT'); } catch (e) { /* already exists */ }
    try { this.db.exec('ALTER TABLE videos ADD COLUMN root_path TEXT'); } catch (e) { /* already exists */ }

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

  // Quick check if a file is already indexed with same mtime (no tag/rating fetch)
  getVideoStub(filePath) {
    return this.db.prepare('SELECT fingerprint, modified_at, thumbnail_path FROM videos WHERE file_path = ?').get(filePath) || null;
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

  setThumbnail(fingerprint, thumbnailPath) {
    this.db.prepare('UPDATE videos SET thumbnail_path = ? WHERE fingerprint = ?').run(thumbnailPath, fingerprint);
  }

  // --- Folders ---

  getFolders() {
    return this.db.prepare('SELECT * FROM folders ORDER BY added_at DESC').all();
  }

  addFolder(folderPath) {
    const now = Date.now();
    this.db.prepare('INSERT OR IGNORE INTO folders (path, added_at) VALUES (?, ?)').run(folderPath, now);
  }

  removeFolder(folderPath) {
    this.db.prepare('DELETE FROM folders WHERE path = ?').run(folderPath);
    // Remove videos from this folder
    this.db.prepare("DELETE FROM videos WHERE file_path LIKE ? || '%'").run(folderPath);
  }

  // --- Settings ---

  getSetting(key) {
    const row = this.db.prepare('SELECT val FROM settings WHERE key = ?').get(key);
    return row ? row.val : null;
  }

  setSetting(key, val) {
    this.db.prepare('INSERT INTO settings (key, val) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET val = excluded.val')
      .run(key, String(val));
  }

  // --- Search ---

  search(query, options = {}) {
    const { sort = 'created_at', direction = -1, offset = 0, limit = 500 } = options;

    let where = [];
    let params = [];

    if (query && query.trim()) {
      const tokens = query.trim().split(/\s+/);
      for (const token of tokens) {
        const negated = token.startsWith('-');
        const clean = negated ? token.slice(1) : token;

        // Field filters
        const fieldMatch = clean.match(/^(\w+):(.+)$/);
        if (fieldMatch) {
          const [, field, value] = fieldMatch;
          const op = negated ? 'NOT LIKE' : 'LIKE';

          if (field === 'tag') {
            const sub = negated
              ? `fingerprint NOT IN (SELECT vt.fingerprint FROM video_tags vt JOIN tags t ON t.id = vt.tag_id WHERE t.name = ?)`
              : `fingerprint IN (SELECT vt.fingerprint FROM video_tags vt JOIN tags t ON t.id = vt.tag_id WHERE t.name = ?)`;
            where.push(sub);
            params.push(value);
          } else if (['filename', 'file_path'].includes(field)) {
            where.push(`${field} ${op} ?`);
            params.push(`%${value}%`);
          } else if (['width', 'height', 'duration', 'size'].includes(field)) {
            const numMatch = value.match(/^([><=!]+)?(\d+\.?\d*)$/);
            if (numMatch) {
              const [, cmp, num] = numMatch;
              const sqlOp = cmp === '>' ? '>' : cmp === '>=' ? '>=' : cmp === '<' ? '<' : cmp === '<=' ? '<=' : '=';
              where.push(`${field} ${sqlOp} ?`);
              params.push(parseFloat(num));
            }
          }
        } else if (clean.startsWith('before:')) {
          const date = clean.slice(7);
          where.push('created_at < ?');
          params.push(new Date(date).getTime());
        } else if (clean.startsWith('after:')) {
          const date = clean.slice(6);
          where.push('created_at > ?');
          params.push(new Date(date).getTime());
        } else {
          // Free text — search filename
          const op = negated ? 'NOT LIKE' : 'LIKE';
          where.push(`filename ${op} ?`);
          params.push(`%${clean}%`);
        }
      }
    }

    const whereClause = where.length > 0 ? 'WHERE ' + where.join(' AND ') : '';

    // Sort mapping
    const sortMap = {
      'created_at': 'created_at', 'created': 'created_at',
      'modified_at': 'modified_at', 'updated': 'modified_at',
      'filename': 'filename', 'size': 'size',
      'width': 'width', 'height': 'height', 'duration': 'duration',
      'btime': 'created_at', 'mtime': 'modified_at',
    };
    const sortCol = sortMap[sort] || 'created_at';
    const dir = direction >= 0 ? 'ASC' : 'DESC';

    const countRow = this.db.prepare(`SELECT COUNT(*) as count FROM videos ${whereClause}`).get(...params);
    const videos = this.db.prepare(
      `SELECT * FROM videos ${whereClause} ORDER BY ${sortCol} ${dir} LIMIT ? OFFSET ?`
    ).all(...params, limit, offset);

    // Attach tags to each video
    const results = videos.map(v => {
      const tags = this.getVideoTags(v.fingerprint);
      return { ...v, tags, id: v.fingerprint };
    });

    return { total: countRow.count, results };
  }

  getCount() {
    const row = this.db.prepare('SELECT COUNT(*) as count FROM videos').get();
    return row.count;
  }

  // --- Soft Delete / Trash ---

  softDelete(fingerprints, trashDir) {
    const fsSync = require('fs');
    if (!fsSync.existsSync(trashDir)) {
      fsSync.mkdirSync(trashDir, { recursive: true });
    }

    const now = Date.now();
    const results = [];

    const transaction = this.db.transaction(() => {
      for (const fp of fingerprints) {
        const video = this.db.prepare('SELECT * FROM videos WHERE fingerprint = ?').get(fp);
        if (!video) { results.push({ fingerprint: fp, success: false, error: 'not found' }); continue; }

        const ext = path.extname(video.file_path);
        const trashName = `${fp}${ext}`;
        const trashPath = path.join(trashDir, trashName);

        try {
          try {
            fsSync.renameSync(video.file_path, trashPath);
          } catch (renameErr) {
            // renameSync fails across drives (EXDEV) — fall back to copy+delete
            fsSync.copyFileSync(video.file_path, trashPath);
            fsSync.unlinkSync(video.file_path);
          }
          this.db.prepare('INSERT OR REPLACE INTO trash (fingerprint, original_path, trash_path, deleted_at) VALUES (?, ?, ?, ?)')
            .run(fp, video.file_path, trashPath, now);
          this.db.prepare('DELETE FROM videos WHERE fingerprint = ?').run(fp);
          results.push({ fingerprint: fp, success: true });
        } catch (e) {
          results.push({ fingerprint: fp, success: false, error: e.message });
        }
      }
    });
    transaction();
    return results;
  }

  getTrash() {
    return this.db.prepare('SELECT * FROM trash ORDER BY deleted_at DESC').all();
  }

  restoreFromTrash(fingerprints) {
    const fsSync = require('fs');
    const results = [];

    const transaction = this.db.transaction(() => {
      for (const fp of fingerprints) {
        const trashed = this.db.prepare('SELECT * FROM trash WHERE fingerprint = ?').get(fp);
        if (!trashed) { results.push({ fingerprint: fp, success: false, error: 'not in trash' }); continue; }

        try {
          try {
            fsSync.renameSync(trashed.trash_path, trashed.original_path);
          } catch (renameErr) {
            fsSync.copyFileSync(trashed.trash_path, trashed.original_path);
            fsSync.unlinkSync(trashed.trash_path);
          }
          this.db.prepare('DELETE FROM trash WHERE fingerprint = ?').run(fp);
          results.push({ fingerprint: fp, success: true });
        } catch (e) {
          results.push({ fingerprint: fp, success: false, error: e.message });
        }
      }
    });
    transaction();
    return results;
  }

  emptyTrash() {
    const fsSync = require('fs');
    const trashed = this.db.prepare('SELECT * FROM trash').all();
    let count = 0;

    for (const item of trashed) {
      try {
        if (fsSync.existsSync(item.trash_path)) {
          fsSync.unlinkSync(item.trash_path);
        }
        count++;
      } catch (e) {
        console.error('Error deleting trash file:', e);
      }
    }

    this.db.prepare('DELETE FROM trash').run();
    return count;
  }

  close() {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }
}

module.exports = VideoDatabase;
