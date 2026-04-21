// Image Database Module
// SQLite database for image metadata with fingerprint-based tracking
// Replaces the IndexedDB/Dexie client-side store with server-side SQLite

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const SAMPLE_SIZE = 64 * 1024; // 64KB head + tail sampling

class ImageDatabase {
  constructor(dbPath) {
    this.dbPath = dbPath;
    this.db = null;
    this.init();
  }

  init() {
    const dir = path.dirname(this.dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.db = new Database(this.dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS images (
        fingerprint TEXT PRIMARY KEY,
        file_path TEXT NOT NULL,
        filename TEXT NOT NULL,
        root_path TEXT NOT NULL,
        subfolder TEXT,
        agent TEXT,
        prompt TEXT,
        negative_prompt TEXT,
        sampler TEXT,
        steps INTEGER,
        cfg_scale REAL,
        seed INTEGER,
        input_strength REAL,
        model_name TEXT,
        model_hash TEXT,
        model_url TEXT,
        loras TEXT,
        width INTEGER,
        height INTEGER,
        aesthetic_score REAL,
        controlnet_module TEXT,
        controlnet_model TEXT,
        controlnet_weight REAL,
        controlnet_guidance_strength REAL,
        size INTEGER,
        btime INTEGER NOT NULL,
        mtime INTEGER NOT NULL,
        indexed_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS tags (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE COLLATE NOCASE
      );

      CREATE TABLE IF NOT EXISTS image_tags (
        fingerprint TEXT NOT NULL,
        tag_id INTEGER NOT NULL,
        added_at INTEGER NOT NULL,
        PRIMARY KEY (fingerprint, tag_id),
        FOREIGN KEY (fingerprint) REFERENCES images(fingerprint) ON DELETE CASCADE,
        FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS folders (
        path TEXT PRIMARY KEY,
        added_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS checkpoints (
        root_path TEXT PRIMARY KEY,
        btime INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        val TEXT
      );

      CREATE TABLE IF NOT EXISTS favorites (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        query TEXT NOT NULL,
        label TEXT,
        is_global INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS trash (
        fingerprint TEXT PRIMARY KEY,
        original_path TEXT NOT NULL,
        trash_path TEXT NOT NULL,
        deleted_at INTEGER NOT NULL,
        metadata TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_images_path ON images(file_path);
      CREATE INDEX IF NOT EXISTS idx_images_root ON images(root_path);
      CREATE INDEX IF NOT EXISTS idx_images_agent ON images(agent);
      CREATE INDEX IF NOT EXISTS idx_images_model ON images(model_name);
      CREATE INDEX IF NOT EXISTS idx_images_model_hash ON images(model_hash);
      CREATE INDEX IF NOT EXISTS idx_images_btime ON images(btime);
      CREATE INDEX IF NOT EXISTS idx_images_prompt ON images(prompt);
      CREATE INDEX IF NOT EXISTS idx_image_tags_tag ON image_tags(tag_id);
      CREATE INDEX IF NOT EXISTS idx_trash_deleted ON trash(deleted_at);
    `);

    // Prepare frequently-used statements
    this._stmts = {
      getByFingerprint: this.db.prepare('SELECT * FROM images WHERE fingerprint = ?'),
      getByPath: this.db.prepare('SELECT * FROM images WHERE file_path = ?'),
      getTags: this.db.prepare(`
        SELECT t.name FROM tags t
        INNER JOIN image_tags it ON it.tag_id = t.id
        WHERE it.fingerprint = ?
        ORDER BY t.name COLLATE NOCASE
      `),
      insertTag: this.db.prepare('INSERT OR IGNORE INTO tags (name) VALUES (?)'),
      getTagByName: this.db.prepare('SELECT id FROM tags WHERE name = ? COLLATE NOCASE'),
      insertImageTag: this.db.prepare('INSERT OR IGNORE INTO image_tags (fingerprint, tag_id, added_at) VALUES (?, ?, ?)'),
      deleteImageTag: this.db.prepare('DELETE FROM image_tags WHERE fingerprint = ? AND tag_id = ?'),
      tagUsageCount: this.db.prepare('SELECT COUNT(*) as count FROM image_tags WHERE tag_id = ?'),
      deleteOrphanTag: this.db.prepare('DELETE FROM tags WHERE id = ?'),
      deleteImage: this.db.prepare('DELETE FROM images WHERE fingerprint = ?'),
      count: this.db.prepare('SELECT COUNT(*) as count FROM images'),
    };

    console.log('Image database initialized:', this.dbPath);
  }

  // --- Fingerprinting ---

  async computeFingerprint(filePath, stats) {
    const size = Number(stats.size || 0);
    const createdMs = Math.round(stats.birthtimeMs || stats.ctimeMs || stats.mtimeMs || 0);
    const hash = crypto.createHash('sha256');

    let handle;
    try {
      if (size > 0) {
        handle = await fs.promises.open(filePath, 'r');
        const sampleSize = Math.min(SAMPLE_SIZE, size);

        // Read head
        const headBuf = Buffer.alloc(sampleSize);
        await handle.read(headBuf, 0, sampleSize, 0);
        hash.update(headBuf);

        // Read tail (if file is larger than one sample)
        if (size > sampleSize) {
          const tailBuf = Buffer.alloc(sampleSize);
          await handle.read(tailBuf, 0, sampleSize, Math.max(0, size - sampleSize));
          hash.update(tailBuf);
        } else {
          hash.update(headBuf); // double-hash head for small files
        }
      }
    } catch (err) {
      hash.update(String(err.message || 'error'));
    } finally {
      if (handle) {
        try { await handle.close(); } catch {}
      }
    }

    hash.update(Buffer.from(String(size)));
    hash.update(Buffer.from(String(createdMs)));

    return hash.digest('hex');
  }

  // --- Indexing ---

  async indexImage(filePath, rootPath, metadata, stats) {
    const fingerprint = await this.computeFingerprint(filePath, stats);
    const filename = path.basename(filePath);
    const now = Date.now();

    // Compute subfolder relative to root_path
    const dirName = path.dirname(filePath);
    const relative = path.relative(rootPath, dirName);
    const subfolder = (relative && relative !== '.') ? relative : null;

    const stmt = this.db.prepare(`
      INSERT INTO images (
        fingerprint, file_path, filename, root_path, subfolder,
        agent, prompt, negative_prompt, sampler, steps, cfg_scale, seed,
        input_strength, model_name, model_hash, model_url, loras,
        width, height, aesthetic_score,
        controlnet_module, controlnet_model, controlnet_weight, controlnet_guidance_strength,
        size, btime, mtime, indexed_at
      ) VALUES (
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?
      )
      ON CONFLICT(fingerprint) DO UPDATE SET
        file_path = excluded.file_path,
        filename = excluded.filename,
        subfolder = excluded.subfolder,
        agent = COALESCE(excluded.agent, images.agent),
        prompt = COALESCE(excluded.prompt, images.prompt),
        negative_prompt = COALESCE(excluded.negative_prompt, images.negative_prompt),
        sampler = COALESCE(excluded.sampler, images.sampler),
        steps = COALESCE(excluded.steps, images.steps),
        cfg_scale = COALESCE(excluded.cfg_scale, images.cfg_scale),
        seed = COALESCE(excluded.seed, images.seed),
        input_strength = COALESCE(excluded.input_strength, images.input_strength),
        model_name = COALESCE(excluded.model_name, images.model_name),
        model_hash = COALESCE(excluded.model_hash, images.model_hash),
        model_url = COALESCE(excluded.model_url, images.model_url),
        loras = COALESCE(excluded.loras, images.loras),
        width = COALESCE(excluded.width, images.width),
        height = COALESCE(excluded.height, images.height),
        aesthetic_score = COALESCE(excluded.aesthetic_score, images.aesthetic_score),
        controlnet_module = COALESCE(excluded.controlnet_module, images.controlnet_module),
        controlnet_model = COALESCE(excluded.controlnet_model, images.controlnet_model),
        controlnet_weight = COALESCE(excluded.controlnet_weight, images.controlnet_weight),
        controlnet_guidance_strength = COALESCE(excluded.controlnet_guidance_strength, images.controlnet_guidance_strength),
        mtime = excluded.mtime,
        indexed_at = excluded.indexed_at
    `);

    stmt.run(
      fingerprint, filePath, filename, rootPath, subfolder,
      metadata.agent || null,
      metadata.prompt || null,
      metadata.negative_prompt || null,
      metadata.sampler || null,
      metadata.steps != null ? parseInt(metadata.steps) : null,
      metadata.cfg_scale != null ? parseFloat(metadata.cfg_scale) : null,
      metadata.seed != null ? parseInt(metadata.seed) : null,
      metadata.input_strength != null ? parseFloat(metadata.input_strength) : null,
      metadata.model_name || null,
      metadata.model_hash || null,
      metadata.model_url || null,
      metadata.loras || null,
      metadata.width != null ? parseInt(metadata.width) : null,
      metadata.height != null ? parseInt(metadata.height) : null,
      metadata.aesthetic_score != null ? parseFloat(metadata.aesthetic_score) : null,
      metadata.controlnet_module || null,
      metadata.controlnet_model || null,
      metadata.controlnet_weight != null ? parseFloat(metadata.controlnet_weight) : null,
      metadata.controlnet_guidance_strength != null ? parseFloat(metadata.controlnet_guidance_strength) : null,
      stats.size || 0,
      Math.floor(stats.birthtimeMs || stats.ctimeMs || 0),
      Math.floor(stats.mtimeMs || 0),
      now
    );

    // Index tags from XMP dc:subject if present
    if (metadata.subject && Array.isArray(metadata.subject)) {
      const tagNames = metadata.subject.filter(s => typeof s === 'string' && s.length > 0);
      if (tagNames.length > 0) {
        this.addTags([fingerprint], tagNames);
      }
    }

    return this.getImage(fingerprint);
  }

  // --- Retrieval ---

  getImage(fingerprint) {
    const image = this._stmts.getByFingerprint.get(fingerprint);
    if (!image) return null;
    const tags = this.getImageTags(fingerprint);
    return { ...image, tags, id: image.fingerprint };
  }

  getImageByPath(filePath) {
    const image = this._stmts.getByPath.get(filePath);
    if (!image) return null;
    return this.getImage(image.fingerprint);
  }

  getImageTags(fingerprint) {
    return this._stmts.getTags.all(fingerprint).map(r => r.name);
  }

  getCount() {
    return this._stmts.count.get().count;
  }

  // --- Tags ---

  addTags(fingerprints, tagNames) {
    const now = Date.now();
    const txn = this.db.transaction(() => {
      for (const tagName of tagNames) {
        const trimmed = tagName.trim();
        if (!trimmed) continue;
        this._stmts.insertTag.run(trimmed);
        const tag = this._stmts.getTagByName.get(trimmed);
        if (tag) {
          for (const fp of fingerprints) {
            this._stmts.insertImageTag.run(fp, tag.id, now);
          }
        }
      }
    });
    txn();
  }

  removeTags(fingerprints, tagNames) {
    const txn = this.db.transaction(() => {
      for (const tagName of tagNames) {
        const trimmed = tagName.trim();
        if (!trimmed) continue;
        const tag = this._stmts.getTagByName.get(trimmed);
        if (!tag) continue;
        for (const fp of fingerprints) {
          this._stmts.deleteImageTag.run(fp, tag.id);
        }
        // Clean up orphaned tags
        if (this._stmts.tagUsageCount.get(tag.id).count === 0) {
          this._stmts.deleteOrphanTag.run(tag.id);
        }
      }
    });
    txn();
  }

  getAllTags() {
    return this.db.prepare(`
      SELECT t.name, COUNT(it.fingerprint) as count
      FROM tags t
      LEFT JOIN image_tags it ON it.tag_id = t.id
      GROUP BY t.id
      ORDER BY t.name COLLATE NOCASE
    `).all();
  }

  // --- Soft Delete ---

  softDelete(fingerprints, trashDir) {
    if (!fs.existsSync(trashDir)) {
      fs.mkdirSync(trashDir, { recursive: true });
    }

    const now = Date.now();
    const results = [];

    const txn = this.db.transaction(() => {
      for (const fp of fingerprints) {
        const image = this._stmts.getByFingerprint.get(fp);
        if (!image) continue;

        // Build trash path preserving original structure
        const relativePath = path.relative(image.root_path, image.file_path);
        const trashPath = path.join(trashDir, relativePath);
        const trashSubdir = path.dirname(trashPath);

        // Move file
        try {
          if (!fs.existsSync(trashSubdir)) {
            fs.mkdirSync(trashSubdir, { recursive: true });
          }
          fs.renameSync(image.file_path, trashPath);
        } catch (err) {
          // If rename fails (cross-device), copy + delete
          try {
            if (!fs.existsSync(trashSubdir)) {
              fs.mkdirSync(trashSubdir, { recursive: true });
            }
            fs.copyFileSync(image.file_path, trashPath);
            fs.unlinkSync(image.file_path);
          } catch (copyErr) {
            console.error('Failed to trash file:', image.file_path, copyErr.message);
            continue;
          }
        }

        // Store trash record with full metadata for restore
        const metadata = JSON.stringify(this.getImage(fp));
        this.db.prepare(`
          INSERT OR REPLACE INTO trash (fingerprint, original_path, trash_path, deleted_at, metadata)
          VALUES (?, ?, ?, ?, ?)
        `).run(fp, image.file_path, trashPath, now, metadata);

        // Remove from images table
        this._stmts.deleteImage.run(fp);
        results.push({ fingerprint: fp, trashPath });
      }
    });
    txn();

    return results;
  }

  restoreFromTrash(fingerprints) {
    const results = [];
    const txn = this.db.transaction(() => {
      for (const fp of fingerprints) {
        const trashRecord = this.db.prepare('SELECT * FROM trash WHERE fingerprint = ?').get(fp);
        if (!trashRecord) continue;

        // Move file back
        try {
          const originalDir = path.dirname(trashRecord.original_path);
          if (!fs.existsSync(originalDir)) {
            fs.mkdirSync(originalDir, { recursive: true });
          }
          fs.renameSync(trashRecord.trash_path, trashRecord.original_path);
        } catch (err) {
          try {
            const originalDir = path.dirname(trashRecord.original_path);
            if (!fs.existsSync(originalDir)) {
              fs.mkdirSync(originalDir, { recursive: true });
            }
            fs.copyFileSync(trashRecord.trash_path, trashRecord.original_path);
            fs.unlinkSync(trashRecord.trash_path);
          } catch (copyErr) {
            console.error('Failed to restore file:', trashRecord.original_path, copyErr.message);
            continue;
          }
        }

        // Remove trash record
        this.db.prepare('DELETE FROM trash WHERE fingerprint = ?').run(fp);
        results.push({ fingerprint: fp, restoredTo: trashRecord.original_path });
      }
    });
    txn();

    return results;
  }

  getTrash() {
    return this.db.prepare('SELECT * FROM trash ORDER BY deleted_at DESC').all();
  }

  emptyTrash() {
    const items = this.getTrash();
    for (const item of items) {
      try {
        if (fs.existsSync(item.trash_path)) {
          fs.unlinkSync(item.trash_path);
        }
      } catch (err) {
        console.error('Failed to permanently delete:', item.trash_path, err.message);
      }
    }
    this.db.prepare('DELETE FROM trash').run();
    return items.length;
  }

  purgeOldTrash(maxAgeDays) {
    const cutoff = Date.now() - (maxAgeDays * 24 * 60 * 60 * 1000);
    const old = this.db.prepare('SELECT * FROM trash WHERE deleted_at < ?').all(cutoff);
    for (const item of old) {
      try {
        if (fs.existsSync(item.trash_path)) {
          fs.unlinkSync(item.trash_path);
        }
      } catch (err) {
        console.error('Failed to purge:', item.trash_path, err.message);
      }
    }
    this.db.prepare('DELETE FROM trash WHERE deleted_at < ?').run(cutoff);
    return old.length;
  }

  // --- Search ---
  // Replicates the query syntax from the original Web Worker (worker.js)
  // Same syntax: tokens, tag:x, model_name:x, width:>512, -tag:x, before:date, etc.

  search(queryString, options = {}) {
    const { sort = 'btime', direction = -1, offset = 0, limit = 100 } = options;

    if (!queryString || !queryString.trim()) {
      return this._getAllSorted(sort, direction, offset, limit);
    }

    const parsed = this._parseQuery(queryString);
    const { conditions, params } = this._buildSQL(parsed);

    const orderDir = direction < 0 ? 'DESC' : 'ASC';
    const sortCol = this._sanitizeColumn(sort);

    let sql = `SELECT i.*, GROUP_CONCAT(t.name) as tag_list
      FROM images i
      LEFT JOIN image_tags it ON it.fingerprint = i.fingerprint
      LEFT JOIN tags t ON t.id = it.tag_id`;

    if (conditions.length > 0) {
      sql += ` WHERE ${conditions.join(' AND ')}`;
    }

    sql += ` GROUP BY i.fingerprint`;

    // Handle tag-based HAVING clauses (for tag inclusion/exclusion after GROUP BY)
    const havingClauses = parsed.filter(p => p.type === 'tag' || p.type === '-tag');
    if (havingClauses.length > 0) {
      const havings = [];
      for (const clause of havingClauses) {
        if (clause.type === 'tag') {
          havings.push(`SUM(CASE WHEN t.name = ? COLLATE NOCASE THEN 1 ELSE 0 END) > 0`);
          params.push(clause.value);
        } else if (clause.type === '-tag') {
          havings.push(`SUM(CASE WHEN t.name = ? COLLATE NOCASE THEN 1 ELSE 0 END) = 0`);
          params.push(clause.value);
        }
      }
      sql += ` HAVING ${havings.join(' AND ')}`;
    }

    sql += ` ORDER BY i.${sortCol} ${orderDir}`;

    // Get total count first
    const countSQL = `SELECT COUNT(*) as count FROM (${sql})`;
    const count = this.db.prepare(countSQL).get(...params).count;

    // Then get page
    sql += ` LIMIT ? OFFSET ?`;
    params.push(limit, offset * limit);

    const rows = this.db.prepare(sql).all(...params);

    return {
      results: rows.map(row => ({
        ...row,
        tags: row.tag_list ? row.tag_list.split(',') : [],
        tag_list: undefined,
        id: row.fingerprint,
      })),
      count,
      offset,
      limit,
    };
  }

  _getAllSorted(sort, direction, offset, limit) {
    const orderDir = direction < 0 ? 'DESC' : 'ASC';
    const sortCol = this._sanitizeColumn(sort);
    const count = this.getCount();

    const rows = this.db.prepare(`
      SELECT i.*, GROUP_CONCAT(t.name) as tag_list
      FROM images i
      LEFT JOIN image_tags it ON it.fingerprint = i.fingerprint
      LEFT JOIN tags t ON t.id = it.tag_id
      GROUP BY i.fingerprint
      ORDER BY i.${sortCol} ${orderDir}
      LIMIT ? OFFSET ?
    `).all(limit, offset * limit);

    return {
      results: rows.map(row => ({
        ...row,
        tags: row.tag_list ? row.tag_list.split(',') : [],
        tag_list: undefined,
        id: row.fingerprint,
      })),
      count,
      offset,
      limit,
    };
  }

  _sanitizeColumn(col) {
    const allowed = [
      'btime', 'mtime', 'prompt', 'width', 'height', 'aesthetic_score',
      'indexed_at', 'filename', 'model_name', 'agent', 'steps', 'cfg_scale', 'seed'
    ];
    return allowed.includes(col) ? col : 'btime';
  }

  _parseQuery(queryString) {
    // Handle quoted values: model_name:"some model", file_path:"some/path"
    const tokens = [];
    const re = /(-?(?:[\w]+)?:?)?"([^"]+)"|(\S+)/g;
    let match;
    while ((match = re.exec(queryString)) !== null) {
      if (match[1] && match[2]) {
        tokens.push(match[1] + match[2]);
      } else if (match[3]) {
        tokens.push(match[3]);
      }
    }

    const parsed = [];
    const numericFields = [
      'width', 'height', 'seed', 'cfg_scale', 'input_strength',
      'steps', 'aesthetic_score', 'controlnet_weight', 'controlnet_guidance_strength'
    ];

    for (const token of tokens) {
      // Date filters
      if (token.startsWith('before:')) {
        parsed.push({ type: 'before', value: token.slice(7) });
      } else if (token.startsWith('after:')) {
        parsed.push({ type: 'after', value: token.slice(6) });
      }
      // Negative tag
      else if (token.startsWith('-tag:')) {
        parsed.push({ type: '-tag', value: token.slice(5) });
      }
      // Positive tag
      else if (token.startsWith('tag:')) {
        parsed.push({ type: 'tag', value: token.slice(4) });
      }
      // Negative prompt token
      else if (token.startsWith('-:')) {
        parsed.push({ type: '-prompt', value: token.slice(2) });
      }
      // Negative file_path
      else if (token.startsWith('-file_path:')) {
        parsed.push({ type: '-file_path', value: token.slice(11) });
      }
      // Field filters
      else if (token.startsWith('model_name:')) {
        parsed.push({ type: 'field', field: 'model_name', op: 'LIKE', value: token.slice(11) });
      } else if (token.startsWith('model_hash:')) {
        parsed.push({ type: 'field', field: 'model_hash', op: '=', value: token.slice(11) });
      } else if (token.startsWith('agent:')) {
        parsed.push({ type: 'field', field: 'agent', op: 'LIKE', value: token.slice(6) });
      } else if (token.startsWith('file_path:')) {
        parsed.push({ type: 'field', field: 'file_path', op: 'LIKE', value: token.slice(10) });
      } else if (token.startsWith('subfolder:')) {
        parsed.push({ type: 'field', field: 'subfolder', op: 'LIKE', value: token.slice(10) });
      } else if (token.startsWith('loras:')) {
        parsed.push({ type: 'field', field: 'loras', op: 'LIKE', value: token.slice(6) });
      }
      // Numeric comparisons: +=width:512, -height:1024, width:>512, etc.
      else if (this._parseNumeric(token, numericFields, parsed)) {
        // handled inside _parseNumeric
      }
      // Plain text = prompt token search
      else {
        parsed.push({ type: 'prompt', value: token });
      }
    }

    return parsed;
  }

  _parseNumeric(token, numericFields, parsed) {
    // Support both syntaxes:
    //   Original: +=width:512, -height:1024, width:512
    //   Alternate: width:>512, height:<=1024
    for (const field of numericFields) {
      // Check prefix operators: +=, -=, +, -, or bare
      const prefixOps = [
        { prefix: `+=${field}:`, op: '>=' },
        { prefix: `-=${field}:`, op: '<=' },
        { prefix: `+${field}:`, op: '>' },
        { prefix: `-${field}:`, op: '<' },
        { prefix: `${field}:>=`, op: '>=' },
        { prefix: `${field}:<=`, op: '<=' },
        { prefix: `${field}:>`, op: '>' },
        { prefix: `${field}:<`, op: '<' },
        { prefix: `${field}:`, op: '=' },
      ];

      for (const { prefix, op } of prefixOps) {
        if (token.startsWith(prefix)) {
          const val = token.slice(prefix.length);
          if (val && !isNaN(val)) {
            parsed.push({ type: 'numeric', field, op, value: parseFloat(val) });
            return true;
          }
        }
      }
    }
    return false;
  }

  _buildSQL(parsed) {
    const conditions = [];
    const params = [];

    for (const clause of parsed) {
      switch (clause.type) {
        case 'before':
          conditions.push('i.btime <= ?');
          params.push(new Date(clause.value).getTime());
          break;

        case 'after':
          conditions.push('i.btime >= ?');
          params.push(new Date(clause.value).getTime());
          break;

        case 'prompt':
          conditions.push('i.prompt LIKE ?');
          params.push(`%${clause.value}%`);
          break;

        case '-prompt':
          conditions.push('(i.prompt IS NULL OR i.prompt NOT LIKE ?)');
          params.push(`%${clause.value}%`);
          break;

        case 'field':
          if (clause.op === 'LIKE') {
            conditions.push(`i.${clause.field} LIKE ?`);
            params.push(`%${clause.value}%`);
          } else {
            conditions.push(`i.${clause.field} = ? COLLATE NOCASE`);
            params.push(clause.value);
          }
          break;

        case '-file_path':
          conditions.push('i.file_path NOT LIKE ?');
          params.push(`%${clause.value}%`);
          break;

        case 'numeric':
          conditions.push(`i.${clause.field} ${clause.op} ?`);
          params.push(clause.value);
          break;

        // 'tag' and '-tag' are handled as HAVING clauses in search()
      }
    }

    return { conditions, params };
  }

  // --- Folders ---

  addFolder(folderPath) {
    this.db.prepare('INSERT OR IGNORE INTO folders (path, added_at) VALUES (?, ?)').run(folderPath, Date.now());
  }

  removeFolder(folderPath) {
    this.db.prepare('DELETE FROM folders WHERE path = ?').run(folderPath);
    // Remove all images from this root
    this.db.prepare('DELETE FROM images WHERE root_path = ?').run(folderPath);
  }

  getFolders() {
    return this.db.prepare('SELECT * FROM folders ORDER BY added_at').all();
  }

  // --- Checkpoints ---

  getCheckpoint(rootPath) {
    const row = this.db.prepare('SELECT btime FROM checkpoints WHERE root_path = ?').get(rootPath);
    return row ? row.btime : null;
  }

  setCheckpoint(rootPath, btime) {
    this.db.prepare(`
      INSERT INTO checkpoints (root_path, btime) VALUES (?, ?)
      ON CONFLICT(root_path) DO UPDATE SET btime = excluded.btime
    `).run(rootPath, btime);
  }

  clearCheckpoint(rootPath) {
    this.db.prepare('DELETE FROM checkpoints WHERE root_path = ?').run(rootPath);
  }

  // --- Settings ---

  getSetting(key) {
    const row = this.db.prepare('SELECT val FROM settings WHERE key = ?').get(key);
    return row ? row.val : null;
  }

  setSetting(key, val) {
    this.db.prepare(`
      INSERT INTO settings (key, val) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET val = excluded.val
    `).run(key, String(val));
  }

  // --- Favorites ---

  addFavorite(query, label, isGlobal = false) {
    this.db.prepare(`
      INSERT INTO favorites (query, label, is_global, created_at) VALUES (?, ?, ?, ?)
    `).run(query, label || null, isGlobal ? 1 : 0, Date.now());
  }

  removeFavorite(id) {
    this.db.prepare('DELETE FROM favorites WHERE id = ?').run(id);
  }

  getFavorites() {
    return this.db.prepare('SELECT * FROM favorites ORDER BY created_at').all();
  }

  getGlobalFilters() {
    return this.db.prepare('SELECT * FROM favorites WHERE is_global = 1').all();
  }

  setFavoriteGlobal(id, isGlobal) {
    this.db.prepare('UPDATE favorites SET is_global = ? WHERE id = ?').run(isGlobal ? 1 : 0, id);
  }

  // --- Bulk Operations ---

  getImagesByRoot(rootPath) {
    return this.db.prepare('SELECT fingerprint, file_path FROM images WHERE root_path = ?').all(rootPath);
  }

  clearByRoot(rootPath) {
    this.db.prepare('DELETE FROM images WHERE root_path = ?').run(rootPath);
    this.clearCheckpoint(rootPath);
  }

  clearAll() {
    this.db.prepare('DELETE FROM images').run();
    this.db.prepare('DELETE FROM image_tags').run();
    this.db.prepare('DELETE FROM tags').run();
    this.db.prepare('DELETE FROM checkpoints').run();
  }

  // --- Lifecycle ---

  close() {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }
}

module.exports = ImageDatabase;
