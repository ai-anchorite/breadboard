class API {
  constructor(config) {
    this.socket = io()
    this.config = config || {}
  }

  // --- Legacy IPC (still used for theme, style, pin, open, debug, gm, xmp, subscribe, sync, del, select) ---

  request(name, ...args) {
    return fetch("/ipc", {
      method: "post",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, args })
    }).then(r => r.json())
  }

  sync(rpc) { return this.request('sync', rpc) }
  subscribe(folderpaths) { return this.request('subscribe', folderpaths) }
  pin() { return this.request("pin") }
  pinned() { return this.request("pinned") }
  gm(rpc) { return this.request("gm", rpc) }
  xmp(file_path) { return this.request("xmp", file_path) }
  theme(val) { return this.request("theme", val) }
  style(val) { return this.request("style", val) }
  debug() { this.request("debug") }

  select() { return this.request("select") }
  open(file_path) {
    if (this.config && this.config.agent === "web") {
      window.open(`/file?file=${encodeURIComponent(file_path)}`, "_blank")
    } else {
      return this.request("open", file_path)
    }
  }

  // --- New REST API (SQLite-backed) ---

  _get(url) {
    return fetch(url).then(r => r.json())
  }
  _post(url, body) {
    return fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    }).then(r => r.json())
  }
  _put(url, body) {
    return fetch(url, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    }).then(r => r.json())
  }
  _delete(url, body) {
    return fetch(url, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    }).then(r => r.json())
  }

  // Images
  searchImages(query, options = {}) {
    const params = new URLSearchParams()
    if (query) params.set('q', query)
    if (options.sort) params.set('sort', options.sort)
    if (options.direction != null) params.set('direction', options.direction)
    if (options.offset != null) params.set('offset', options.offset)
    if (options.limit != null) params.set('limit', options.limit)
    return this._get(`/api/images/search?${params}`)
  }
  getImage(fingerprint) { return this._get(`/api/images/${fingerprint}`) }
  getImageCount() { return this._get('/api/images/count') }
  getImageXmp(fingerprint) { return this._get(`/api/images/xmp/${fingerprint}`) }

  // Tags
  addImageTags(fingerprints, tags) { return this._post('/api/images/tags/add', { fingerprints, tags }) }
  removeImageTags(fingerprints, tags) { return this._post('/api/images/tags/remove', { fingerprints, tags }) }
  getAllImageTags() { return this._get('/api/images/tags/all') }

  // Delete / Trash
  deleteImages(fingerprints) { return this._post('/api/images/delete', { fingerprints }) }
  restoreImages(fingerprints) { return this._post('/api/images/restore', { fingerprints }) }
  getTrash() { return this._get('/api/images/trash') }
  emptyTrash() { return this._post('/api/images/trash/empty', {}) }

  // Folders
  getFolders() { return this._get('/api/folders') }
  addFolder(path) { return this._post('/api/folders', { path }) }
  removeFolder(path) { return this._delete('/api/folders', { path }) }

  // Settings
  getSetting(key) { return this._get(`/api/settings/${key}`) }
  setSetting(key, val) { return this._put(`/api/settings/${key}`, { val }) }

  // Favorites
  getFavorites() { return this._get('/api/favorites') }
  addFavorite(query, label, is_global) { return this._post('/api/favorites', { query, label, is_global }) }
  removeFavorite(id) { return this._delete(`/api/favorites/${id}`, {}) }
  setFavoriteGlobal(id, is_global) { return this._put(`/api/favorites/${id}/global`, { is_global }) }

  // Status
  getStatus() { return this._get('/api/status') }

  // --- Video REST API ---

  searchVideos(query, options = {}) {
    const params = new URLSearchParams()
    if (query) params.set('q', query)
    if (options.sort) params.set('sort', options.sort)
    if (options.direction != null) params.set('direction', options.direction)
    if (options.offset != null) params.set('offset', options.offset)
    if (options.limit != null) params.set('limit', options.limit)
    return this._get(`/api/videos/search?${params}`)
  }
  getVideo(fingerprint) { return this._get(`/api/videos/${fingerprint}`) }
  getVideoCount() { return this._get('/api/videos/count') }

  addVideoTags(fingerprints, tags) { return this._post('/api/videos/tags/add', { fingerprints, tags }) }
  removeVideoTags(fingerprints, tags) { return this._post('/api/videos/tags/remove', { fingerprints, tags }) }
  getAllVideoTags() { return this._get('/api/videos/tags/all') }

  deleteVideos(fingerprints) { return this._post('/api/videos/delete', { fingerprints }) }
  restoreVideos(fingerprints) { return this._post('/api/videos/restore', { fingerprints }) }
  getVideoTrash() { return this._get('/api/videos/trash') }
  emptyVideoTrash() { return this._post('/api/videos/trash/empty', {}) }

  getVideoFolders() { return this._get('/api/video-folders') }
  addVideoFolder(path) { return this._post('/api/video-folders', { path }) }
  removeVideoFolder(path) { return this._delete('/api/video-folders', { path }) }

  getVideoSetting(key) { return this._get(`/api/video-settings/${key}`) }
  setVideoSetting(key, val) { return this._put(`/api/video-settings/${key}`, { val }) }

  // --- Utilities ---

  listen(callback) {
    this.socket.offAny()
    this.socket.on("msg", (msg) => { callback(msg, msg) })
    this.socket.on("debug", (msg) => { console.log("debug", JSON.stringify(msg, null, 2)) })
  }
  startDrag(fileNames) {
    if (window.electronAPI) {
      window.electronAPI.startDrag(fileNames)
    }
  }
  copy(str) {
    const element = document.createElement('textarea')
    element.value = str
    element.setAttribute('readonly', '')
    element.style.contain = 'strict'
    element.style.position = 'absolute'
    element.style.left = '-9999px'
    element.style.fontSize = '12pt'
    const selection = document.getSelection()
    const originalRange = selection.rangeCount > 0 && selection.getRangeAt(0)
    document.body.append(element)
    element.select()
    element.selectionStart = 0
    element.selectionEnd = str.length
    let isSuccess = false
    try { isSuccess = document.execCommand('copy') } catch {}
    element.remove()
    if (originalRange) {
      selection.removeAllRanges()
      selection.addRange(originalRange)
    }
    return isSuccess
  }
}
