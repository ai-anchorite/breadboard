// Video Gallery Module — mirrors the image tab architecture
// Controller, viewer overlay with pan/zoom, settings sidebar, folder panel

class VideoApp {
  constructor() {
    this.api = new API({ agent: AGENT })
    this.videos = []
    this.query = ''
    this.sorterCode = 0
    this.zoom = 100
    this.autoHideNav = false
    this.confirmDelete = true
    this.theme = { val: THEME || 'default' }
    this.minimal = { val: 'default' }
    this.style = { aspect_ratio: 100, fit: 'cover' }
    this.volume = 50
    this._zoom = 1
    this._panX = 0
    this._panY = 0
    this._isPanning = false
    this._viewerOpen = false
    this.sorters = [
      { column: 'created_at', direction: -1 },
      { column: 'created_at', direction: 1 },
      { column: 'modified_at', direction: -1 },
      { column: 'modified_at', direction: 1 },
      { column: 'filename', direction: 1 },
      { column: 'filename', direction: -1 },
      { column: 'width', direction: -1 },
      { column: 'width', direction: 1 },
      { column: 'duration', direction: -1 },
      { column: 'duration', direction: 1 },
    ]
    this.bar = new Nanobar({ target: document.querySelector('#bar') })
    this._scanCount = 0
    this.init()
  }

  async init() {
    // Read query from URL params (e.g. /videos?query=tag:favorite)
    const urlParams = new URLSearchParams(window.location.search)
    if (urlParams.has('query')) {
      this.query = urlParams.get('query')
      const searchInput = document.querySelector('.search')
      if (searchInput) searchInput.value = this.query
    }
    await this.initSettings()
    this.attachNavEvents()
    this.initCardListeners()
    this.initFolderPanel()
    this.initTooltips()
    this.initSelection()
    this.initScanProgress()
    await this.loadVideos()
  }

  async initSettings() {
    // Theme is global (shared with image tab via /api/settings/)
    const themeRes = await this.api.getSetting('theme')
    const minimalRes = await this.api.getVideoSetting('minimal')
    const zoomRes = await this.api.getVideoSetting('video_zoom')
    const autoHideRes = await this.api.getVideoSetting('autohide_nav')
    const confirmRes = await this.api.getVideoSetting('confirm_delete')
    const fitRes = await this.api.getVideoSetting('video_fit')
    const volumeRes = await this.api.getVideoSetting('video_volume')
    if (themeRes.val) { this.theme.val = themeRes.val; document.body.className = themeRes.val }
    if (minimalRes.val) this.minimal.val = minimalRes.val
    if (zoomRes.val) this.zoom = parseInt(zoomRes.val)
    this.autoHideNav = autoHideRes.val === 'true' || autoHideRes.val === true
    this.confirmDelete = confirmRes.val != null ? (confirmRes.val === 'true' || confirmRes.val === true) : true
    this.style.fit = fitRes.val || 'cover'
    this.volume = volumeRes.val != null ? parseInt(volumeRes.val) : 50
    document.body.setAttribute('data-minimal', this.minimal.val)
    this.applyAutoHideNav()
    this.applyCardStyle()
    this.applyFit()
  }

  applyCardStyle() {
    const minW = Math.max(120, Math.round(250 * this.zoom / 100))
    document.documentElement.style.setProperty('--video-min-card', minW + 'px')
  }

  applyFit() {
    document.documentElement.style.setProperty('--video-fit', this.style.fit || 'cover')
  }

  applyAutoHideNav() {
    const nav = document.querySelector('nav')
    if (!nav) return
    if (this._navMouseLeave) { nav.removeEventListener('mouseleave', this._navMouseLeave); this._navMouseLeave = null }
    if (this._navTriggerMove) { document.removeEventListener('mousemove', this._navTriggerMove); this._navTriggerMove = null }
    if (this._navHideTimer) { clearTimeout(this._navHideTimer); this._navHideTimer = null }
    const existingDragZone = document.getElementById('autohide-drag-zone')
    if (existingDragZone) existingDragZone.remove()

    if (this.autoHideNav) {
      nav.classList.add('autohide')
      const dragZone = document.createElement('div')
      dragZone.id = 'autohide-drag-zone'
      document.body.appendChild(dragZone)
      this._navTriggerMove = (e) => {
        if (e.clientY <= 8) {
          if (this._navHideTimer) { clearTimeout(this._navHideTimer); this._navHideTimer = null }
          nav.classList.add('force-show')
        }
      }
      document.addEventListener('mousemove', this._navTriggerMove)
      this._navMouseLeave = () => {
        if (this._navHideTimer) clearTimeout(this._navHideTimer)
        this._navHideTimer = setTimeout(() => { nav.classList.remove('force-show'); this._navHideTimer = null }, 600)
      }
      nav.addEventListener('mouseleave', this._navMouseLeave)
      nav.addEventListener('mouseenter', () => { if (this._navHideTimer) { clearTimeout(this._navHideTimer); this._navHideTimer = null } })
      const container = document.querySelector('.container')
      if (container) container.style.paddingTop = '6px'
    } else {
      nav.classList.remove('autohide')
      nav.classList.remove('force-show')
      const container = document.querySelector('.container')
      if (container) container.style.paddingTop = nav.offsetHeight + 'px'
    }
  }

  confirm(message) {
    if (!this.confirmDelete) return Promise.resolve(true)
    return new Promise((resolve) => {
      const overlay = document.createElement('div')
      overlay.className = 'bb-confirm-overlay'
      overlay.innerHTML = `<div class='bb-confirm-box'><div class='bb-confirm-msg'>${message}</div><div class='bb-confirm-actions'><button class='bb-confirm-cancel'>Cancel</button><button class='bb-confirm-ok'>Delete</button></div></div>`
      document.body.appendChild(overlay)
      overlay.querySelector('.bb-confirm-cancel').addEventListener('click', () => { overlay.remove(); resolve(false) })
      overlay.querySelector('.bb-confirm-ok').addEventListener('click', () => { overlay.remove(); resolve(true) })
      overlay.addEventListener('click', (e) => { if (e.target === overlay) { overlay.remove(); resolve(false) } })
      overlay.querySelector('.bb-confirm-cancel').focus()
    })
  }

  // --- Nav Events ---
  attachNavEvents() {
    document.querySelector('#prev')?.addEventListener('click', () => history.back())
    document.querySelector('#next')?.addEventListener('click', () => history.forward())
    document.querySelector('#new-window')?.addEventListener('click', () => window.open('/videos', '_blank', 'popup'))
    document.querySelector('#show-menu')?.addEventListener('click', () => document.querySelectorAll('.nav-child').forEach(el => el.classList.toggle('shown')))
    document.querySelector('#settings-option')?.addEventListener('click', () => this.toggleSettings())
    document.querySelector('#sorter')?.addEventListener('change', async (e) => { this.sorterCode = parseInt(e.target.value); await this.loadVideos() })
    document.querySelector('.search')?.addEventListener('keyup', (e) => { if (e.key === 'Enter') { this.query = e.target.value; this.loadVideos() } })
    document.querySelector('#sync')?.addEventListener('click', async () => await this.scanAllFolders())

    // Bookmark current search
    document.querySelector('#favorite')?.addEventListener('click', async () => {
      const query = document.querySelector('.search').value
      if (!query || !query.length) return
      const favorites = await this.api.getFavorites()
      const exists = favorites.find(f => f.query === query)
      if (exists) {
        await this.api.removeFavorite(exists.id)
        document.querySelector('#favorite').classList.remove('selected')
        document.querySelector('#favorite i').className = 'fa-regular fa-star'
      } else {
        await this.api.addFavorite(query, null, false)
        document.querySelector('#favorite').classList.add('selected')
        document.querySelector('#favorite i').className = 'fa-solid fa-star'
      }
    })
  }

  initTooltips() {
    const buttons = ['#prev', '#next', '#sync', '.content-info', '#favorite', '#bookmarked-filters', '#favorited-items', '#folder-option', '#pin', '#settings-option', '#help-option', '#new-window']
    for (const sel of buttons) {
      const el = document.querySelector(sel)
      if (el) tippy(el, { placement: 'bottom-end', interactive: true, content: el.getAttribute('title') })
    }
  }

  // --- Selection / Multi-select ---
  initSelection() {
    this.selectedEls = []

    // Footer buttons
    document.querySelector('#cancel-selection')?.addEventListener('click', () => { this.clearSelection() })
    document.querySelector('#tag-menu')?.addEventListener('click', () => {
      document.querySelector('.tag-menu-items')?.classList.toggle('hidden')
      document.querySelector('.tag-menu-collapsed')?.classList.toggle('hidden')
      document.querySelector('.tag-menu-expanded')?.classList.toggle('hidden')
    })
    document.querySelector('#save-tags')?.addEventListener('click', async () => {
      const input = document.querySelector('#video-add-tag-field')
      if (!input) return
      const tags = input.value.split(',').map(t => t.trim()).filter(t => t)
      if (tags.length === 0) return
      const fps = this.selectedEls.map(el => el.getAttribute('data-fingerprint')).filter(Boolean)
      if (fps.length > 0) await this.api.addVideoTags(fps, tags)
      input.value = ''
      this.clearSelection()
      await this.loadVideos()
    })
    document.querySelector('#delete-selected')?.addEventListener('click', async () => {
      const fps = this.selectedEls.map(el => el.getAttribute('data-fingerprint')).filter(Boolean)
      if (fps.length === 0) return
      if (!await this.confirm(`Move ${fps.length} video${fps.length > 1 ? 's' : ''} to trash?`)) return
      await this.api.deleteVideos(fps)
      for (const el of this.selectedEls) el.remove()
      this.videos = this.videos.filter(v => !fps.includes(v.fingerprint))
      this.updateCount(this.videos.length)
      this.clearSelection()
    })

    // Keyboard shortcuts
    hotkeys('delete,backspace', async (e) => {
      if (e.target.tagName === 'INPUT') return
      if (this.selectedEls.length > 0) {
        e.preventDefault()
        document.querySelector('#delete-selected')?.click()
      }
    })
    hotkeys('escape', (e) => {
      if (this._viewerOpen) return
      if (this.selectedEls.length > 0) { e.preventDefault(); this.clearSelection() }
    })
    hotkeys('ctrl+a,cmd+a', (e) => {
      if (e.target.tagName === 'INPUT') return
      e.preventDefault()
      const all = Array.from(document.querySelectorAll('.video-card'))
      this.selectedEls = all
      if (this.ds) this.ds.setSelection(all)
      this.updateSelection()
    })
  }

  initDragSelect() {
    if (this.ds) {
      this.ds.setSettings({ selectables: document.querySelectorAll('.video-card'), area: document.querySelector('.content'), draggability: false })
    } else {
      this.ds = new DragSelect({ selectables: document.querySelectorAll('.video-card'), area: document.querySelector('.content'), draggability: false })
      this.ds.subscribe('callback', (e) => {
        if (e.items && e.items.length > 0) { this.selectedEls = e.items; this.updateSelection() }
        else { this.selectedEls = []; this.updateSelection() }
      })
    }
  }

  updateSelection() {
    document.querySelector('.selected-count .counter').innerHTML = this.selectedEls.length
    if (this.selectedEls.length > 0) document.querySelector('footer')?.classList.remove('hidden')
    else document.querySelector('footer')?.classList.add('hidden')
  }

  clearSelection() {
    this.selectedEls = []
    if (this.ds) this.ds.clearSelection()
    this.updateSelection()
    document.querySelector('.tag-menu-items')?.classList.add('hidden')
    document.querySelector('.tag-menu-collapsed')?.classList.remove('hidden')
    document.querySelector('.tag-menu-expanded')?.classList.add('hidden')
  }

  // --- Scan Progress ---
  initScanProgress() {
    if (!window.electronAPI) return
    // Guard against duplicate listeners (page reload, re-init)
    if (this._scanListenersAttached) return
    this._scanListenersAttached = true

    if (window.electronAPI.onVideoScanProgress) {
      window.electronAPI.onVideoScanProgress((progress) => {
        const status = document.querySelector('.status')
        if (progress.type === 'start') {
          this._scanCount = 0
          this._scanning = true
          if (status) status.innerHTML = 'scanning videos...'
          document.querySelector('#sync')?.classList.add('disabled')
          document.querySelector('#sync i')?.classList.add('fa-spin')
          this.bar.go(10)
        } else if (progress.type === 'file') {
          this._scanCount++
          if (status) status.innerHTML = `indexing videos... ${this._scanCount}`
          this.bar.go(10 + Math.min(80, this._scanCount * 0.5))
        } else if (progress.type === 'complete') {
          this._scanning = false
          if (status) status.innerHTML = ''
          document.querySelector('#sync')?.classList.remove('disabled')
          document.querySelector('#sync i')?.classList.remove('fa-spin')
          this.bar.go(100)
          this.loadVideos()
        } else if (progress.type === 'error') {
          console.error('Scan error:', progress.error)
        }
      })
    }

    // Live video additions — debounce to avoid hammering during bulk watcher events
    this._liveReloadTimer = null
    const debouncedReload = () => {
      if (this._scanning) return // Don't reload during active scan
      if (this._liveReloadTimer) clearTimeout(this._liveReloadTimer)
      this._liveReloadTimer = setTimeout(() => { this._liveReloadTimer = null; this.loadVideos() }, 2000)
    }
    window.electronAPI.onVideoAdded?.(debouncedReload)
    window.electronAPI.onVideoRemoved?.(debouncedReload)
  }

  // --- Folder Panel ---
  initFolderPanel() {
    const btn = document.querySelector('#folder-option')
    if (!btn) return
    tippy(btn, {
      interactive: true, placement: 'bottom-end', trigger: 'click', maxWidth: 500, allowHTML: true,
      onShow: async (instance) => {
        const folders = await this.api.getVideoFolders()
        let rows = folders.length > 0
          ? folders.map(f => `<div class='fp-row'><span class='fp-path'>${f.path}</span><button class='fp-btn fp-reindex' data-path='${f.path}' title='Re-scan'><i class="fa-solid fa-rotate"></i></button><button class='fp-btn fp-disconnect' data-path='${f.path}' title='Disconnect'><i class="fa-solid fa-xmark"></i></button></div>`).join('')
          : `<div class='fp-empty'>No video folders connected</div>`
        instance.setContent(`<div class='folder-panel'><div class='fp-header'><h4><i class="fa-solid fa-folder-open"></i> Video Folders</h4></div><div class='fp-list'>${rows}</div><div class='fp-actions'><button class='fp-btn fp-connect'><i class="fa-solid fa-folder-plus"></i> Connect a folder</button></div></div>`)
        setTimeout(() => {
          const popper = instance.popper
          popper.querySelector('.fp-connect')?.addEventListener('click', async () => {
            const paths = await this.api.select()
            if (paths && paths.length > 0) { for (const p of paths) { await this.api.addVideoFolder(p); await this.scanFolder(p) }; instance.hide(); await this.loadVideos() }
          })
          popper.querySelectorAll('.fp-disconnect').forEach(b => b.addEventListener('click', async () => {
            if (window.confirm(`Disconnect "${b.dataset.path}"?`)) { await this.api.removeVideoFolder(b.dataset.path); instance.hide(); await this.loadVideos() }
          }))
          popper.querySelectorAll('.fp-reindex').forEach(b => b.addEventListener('click', async () => { instance.hide(); await this.scanFolder(b.dataset.path); await this.loadVideos() }))
        }, 0)
      }
    })
  }

  async scanFolder(folderPath) {
    if (!window.electronAPI?.scanVideos) return
    try { await window.electronAPI.scanVideos(folderPath, { recursive: true }) } catch (e) { console.error('Scan error:', e) }
  }

  async scanAllFolders() {
    const folders = await this.api.getVideoFolders()
    for (const f of folders) await this.scanFolder(f.path)
    await this.loadVideos()
  }

  // --- Load & Render ---
  async loadVideos() {
    const sorter = this.sorters[this.sorterCode] || this.sorters[0]
    try {
      const result = await this.api.searchVideos(this.query, { sort: sorter.column, direction: sorter.direction, limit: 500 })
      this.videos = result.results || []
      this.renderGrid()
      this.updateCount(result.total || this.videos.length)
    } catch (e) { console.error('Error loading videos:', e); this.videos = []; this.renderGrid() }
  }

  updateCount(count) {
    const el = document.querySelector('.content-info')
    if (el) el.innerHTML = `<i class="fa-solid fa-check"></i> ${count}`
  }

  renderGrid() {
    const content = document.querySelector('.content')
    if (!content) return
    if (this.videos.length === 0) {
      content.innerHTML = `<div class='video-empty'><i class="fa-solid fa-video"></i><h2>No videos loaded</h2><p>Click the <i class="fa-solid fa-folder-open"></i> folder icon to connect a video folder</p></div>`
      return
    }
    content.innerHTML = this.videos.map(v => this.createCard(v)).join('')
    this.attachCardHandlers()
    this.initDragSelect()
  }

  createCard(video) {
    const isFav = video.tags && video.tags.includes('favorite')
    const favClass = isFav ? 'fa-solid fa-heart' : 'fa-regular fa-heart'
    const videoUrl = `/video/${video.fingerprint}`
    const thumbUrl = `/thumb/video/${video.fingerprint}`
    const dur = video.duration ? this.formatDuration(video.duration) : ''
    const hasThumb = !!video.thumbnail_path
    // Render <img> thumbnail by default for performance; <video> loads on hover/play-lock
    const mediaHTML = hasThumb
      ? `<img class='video-thumb' src="${thumbUrl}" loading="lazy" draggable="false"><video class='video-hover' data-src="${videoUrl}" preload="none" muted loop playsinline></video>`
      : `<video class='video-fallback' data-src="${videoUrl}" preload="none" muted loop playsinline></video>`
    return `<div class='card video-card' data-fingerprint='${video.fingerprint}' data-src='${video.file_path}' data-has-thumb='${hasThumb}'><div class='grab'><button title='like this video' data-favorited="${isFav}" data-fingerprint="${video.fingerprint}" class='favorite-btn'><i class="${favClass}"></i></button><button title='open in explorer' data-src="${video.file_path}" class='open-file'><i class="fa-regular fa-folder-open"></i></button><button title='delete' data-fingerprint="${video.fingerprint}" class='trash-btn'><i class="fa-regular fa-trash-can"></i></button><button title='play in grid' data-fingerprint="${video.fingerprint}" class='play-lock-btn grab-right'><i class="fa-solid fa-play"></i></button><button title='pop out' data-fingerprint="${video.fingerprint}" class='popout-btn'><i class="fa-solid fa-up-right-from-square"></i></button></div><div class='video-thumb-wrap'>${mediaHTML}<div class='video-duration'>${dur}</div></div></div>`
  }

  attachCardHandlers() {
    const content = document.querySelector('.content')
    if (!content) return

    // Lazy load: for thumbnail cards, img loads via loading="lazy". For fallback cards (no thumb), load video on intersect.
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const fallback = entry.target.querySelector('video.video-fallback')
          if (fallback && !fallback.src && fallback.dataset.src) { fallback.src = fallback.dataset.src; fallback.load() }
          observer.unobserve(entry.target)
        }
      })
    }, { rootMargin: '100px' })
    content.querySelectorAll('.video-card').forEach(card => observer.observe(card))
  }

  // Attach delegated event listeners ONCE (called from init, not per-render)
  initCardListeners() {
    const content = document.querySelector('.content')
    const container = document.querySelector('.container')
    if (!content || !container) return

    // Prevent DragSelect from selecting when clicking grab buttons
    content.addEventListener('mousedown', (e) => {
      const btn = e.target.closest('.favorite-btn, .open-file, .trash-btn, .play-lock-btn, .popout-btn')
      if (btn) e.stopPropagation()
    }, true)

    // Click handler on .container (parent)
    container.addEventListener('click', async (e) => {
      const card = e.target.closest('.video-card')
      if (!card) return

      const favBtn = e.target.closest('.favorite-btn')
      const openBtn = e.target.closest('.open-file')
      const trashBtn = e.target.closest('.trash-btn')
      const playBtn = e.target.closest('.play-lock-btn')
      const popoutBtn = e.target.closest('.popout-btn')
      const grabArea = e.target.closest('.grab')

      if (favBtn) { e.preventDefault(); e.stopPropagation(); await this.toggleFavorite(favBtn) }
      else if (openBtn) { e.preventDefault(); e.stopPropagation(); this.api.open(openBtn.getAttribute('data-src')) }
      else if (trashBtn) { e.preventDefault(); e.stopPropagation(); await this.trashVideo(trashBtn, card) }
      else if (playBtn) { e.preventDefault(); e.stopPropagation(); this.togglePlayLock(card) }
      else if (popoutBtn) { e.preventDefault(); e.stopPropagation(); this.popoutVideo(card) }
      else if (grabArea) { /* header area — let DragSelect handle selection */ }
      else {
        e.preventDefault(); e.stopPropagation()
        this.openViewer(card)
      }
    })

    // Hover to preview — load and play video on hover, hide thumbnail
    content.addEventListener('mouseenter', (e) => {
      const card = e.target.closest?.('.video-card')
      if (!card || card.classList.contains('playing-locked')) return
      this._startHoverPreview(card)
    }, true)
    content.addEventListener('mouseleave', (e) => {
      const card = e.target.closest?.('.video-card')
      if (!card || card.classList.contains('playing-locked')) return
      this._stopHoverPreview(card)
    }, true)
  }

  _startHoverPreview(card) {
    const hoverVideo = card.querySelector('video.video-hover')
    const fallbackVideo = card.querySelector('video.video-fallback')
    const thumb = card.querySelector('img.video-thumb')
    const video = hoverVideo || fallbackVideo
    if (!video) return
    // Lazy-load the hover video src
    if (!video.src && video.dataset.src) { video.src = video.dataset.src; video.load() }
    if (thumb) thumb.style.display = 'none'
    if (hoverVideo) hoverVideo.style.display = 'block'
    video.play().catch(() => {})
  }

  _stopHoverPreview(card) {
    const hoverVideo = card.querySelector('video.video-hover')
    const fallbackVideo = card.querySelector('video.video-fallback')
    const thumb = card.querySelector('img.video-thumb')
    const video = hoverVideo || fallbackVideo
    if (!video) return
    video.pause()
    video.currentTime = 0
    if (thumb) { thumb.style.display = 'block'; if (hoverVideo) hoverVideo.style.display = 'none' }
  }

  async toggleFavorite(btn) {
    const fp = btn.getAttribute('data-fingerprint')
    const isFav = btn.getAttribute('data-favorited') === 'true'
    if (isFav) await this.api.removeVideoTags([fp], ['favorite'])
    else await this.api.addVideoTags([fp], ['favorite'])
    btn.setAttribute('data-favorited', !isFav)
    const icon = btn.querySelector('i')
    icon.classList.toggle('fa-regular', isFav)
    icon.classList.toggle('fa-solid', !isFav)
  }

  async trashVideo(btn, card) {
    const fp = btn.getAttribute('data-fingerprint')
    if (!fp) return
    if (!await this.confirm('Move this video to trash?')) return
    await this.api.deleteVideos([fp])
    card.remove()
    this.videos = this.videos.filter(v => v.fingerprint !== fp)
    this.updateCount(this.videos.length)
  }

  togglePlayLock(card) {
    const hoverVideo = card.querySelector('video.video-hover')
    const fallbackVideo = card.querySelector('video.video-fallback')
    const thumb = card.querySelector('img.video-thumb')
    const video = hoverVideo || fallbackVideo
    const btn = card.querySelector('.play-lock-btn')
    if (!video) return
    if (card.classList.contains('playing-locked')) {
      card.classList.remove('playing-locked'); video.pause(); video.currentTime = 0; video.muted = true
      if (btn) btn.querySelector('i').className = 'fa-solid fa-play'
      // Restore thumbnail
      if (thumb) { thumb.style.display = 'block'; if (hoverVideo) hoverVideo.style.display = 'none' }
    } else {
      card.classList.add('playing-locked'); video.muted = false
      video.volume = this.volume / 100
      if (!video.src && video.dataset.src) { video.src = video.dataset.src; video.load() }
      if (thumb) thumb.style.display = 'none'
      if (hoverVideo) hoverVideo.style.display = 'block'
      video.play().catch(() => {})
      if (btn) btn.querySelector('i').className = 'fa-solid fa-pause'
    }
  }

  popoutVideo(card) {
    const fp = card.getAttribute('data-fingerprint')
    const video = this.videos.find(v => v.fingerprint === fp)
    if (!video) return
    const w = video.width || 800, h = video.height || 600
    const url = `/video-viewer?fingerprint=${fp}&filename=${encodeURIComponent(video.filename)}&width=${w}&height=${h}`
    window.open(url, '_blank', 'popup')
  }

  // =============================================
  // Fullscreen Video Viewer with Pan/Zoom
  // =============================================

  openViewer(selectedCard) {
    const allCards = Array.from(document.querySelectorAll('.content .video-card'))
    const selectedIndex = allCards.indexOf(selectedCard)
    this._cardData = []
    allCards.forEach(card => {
      const video = card.querySelector('video.video-hover') || card.querySelector('video.video-fallback')
      const videoSrc = video ? (video.src || video.dataset.src) : `/video/${card.getAttribute('data-fingerprint')}`
      this._cardData.push({ fingerprint: card.getAttribute('data-fingerprint'), file_path: card.getAttribute('data-src'), videoSrc })
    })
    this._currentIndex = selectedIndex >= 0 ? selectedIndex : 0
    this._zoom = 1; this._panX = 0; this._panY = 0; this._viewerOpen = true
    // Clear selection so footer hides
    this.clearSelection()
    document.querySelectorAll('.video-card video').forEach(v => { v.pause(); v.currentTime = 0 })
    this._buildViewerOverlay()
    this._showVideo(this._currentIndex)
    const nav = document.querySelector('nav')
    if (nav) { this._navWasAutoHide = nav.classList.contains('autohide'); if (!this._navWasAutoHide) nav.classList.add('autohide'); nav.classList.remove('force-show') }
    this._keyHandler = (e) => {
      if (e.target.tagName === 'INPUT') return
      if (e.key === 'Escape') this._closeViewer()
      else if (e.key === 'ArrowLeft') this._navigateViewer(-1)
      else if (e.key === 'ArrowRight') this._navigateViewer(1)
      else if (e.key === '+' || e.key === '=') this._zoomBy(0.25)
      else if (e.key === '-') this._zoomBy(-0.25)
      else if (e.key === '0') this._resetZoom()
      else if (e.key === ' ') { e.preventDefault(); this._togglePlayback() }
      else if (e.key === 'i') this._togglePanel()
    }
    document.addEventListener('keydown', this._keyHandler)
  }

  _buildViewerOverlay() {
    this._closeViewer(true)
    const overlay = document.createElement('div')
    overlay.id = 'bb-viewer-overlay'
    overlay.innerHTML = `
      <div class='bb-viewer-main'>
        <div class='bb-viewer-image-area'>
          <button class='bb-viewer-nav bb-viewer-prev' title='Previous (←)'><i class="fa-solid fa-chevron-left"></i></button>
          <div class='bb-viewer-img-wrap'><video class='bb-viewer-video' autoplay loop playsinline></video></div>
          <button class='bb-viewer-nav bb-viewer-next' title='Next (→)'><i class="fa-solid fa-chevron-right"></i></button>
        </div>
        <div class='bb-viewer-toolbar'>
          <button class='bb-tb-btn bb-tb-prev' title='Previous'><i class="fa-solid fa-chevron-left"></i></button>
          <span class='bb-viewer-counter'></span>
          <button class='bb-tb-btn bb-tb-next' title='Next'><i class="fa-solid fa-chevron-right"></i></button>
          <span class='bb-tb-sep'></span>
          <button class='bb-tb-btn bb-tb-play' title='Play/Pause (Space)'><i class="fa-solid fa-pause"></i></button>
          <span class='bb-tb-sep'></span>
          <button class='bb-tb-btn bb-tb-zoom-out' title='Zoom out (−)'><i class="fa-solid fa-magnifying-glass-minus"></i></button>
          <button class='bb-tb-btn bb-tb-zoom-reset' title='Fit to view (0)'><i class="fa-solid fa-expand"></i></button>
          <button class='bb-tb-btn bb-tb-zoom-in' title='Zoom in (+)'><i class="fa-solid fa-magnifying-glass-plus"></i></button>
          <span class='bb-tb-zoom-level'>100%</span>
          <span class='bb-tb-sep'></span>
          <button class='bb-tb-btn bb-tb-panel-toggle' title='Toggle info panel (i)'><i class="fa-solid fa-circle-info"></i></button>
          <span class='bb-tb-sep'></span>
          <button class='bb-tb-btn bb-tb-close' title='Close (Esc)'><i class="fa-solid fa-xmark"></i></button>
        </div>
      </div>
      <div class='bb-viewer-panel' id='bb-viewer-panel'>
        <div class='panel-header'><span>Video Info</span><span class='bb-viewer-counter-panel'></span></div>
        <div class='panel-body'></div>
      </div>`
    document.body.appendChild(overlay)
    const $ = (sel) => overlay.querySelector(sel)

    $('.bb-viewer-prev').addEventListener('click', (e) => { e.stopPropagation(); this._navigateViewer(-1) })
    $('.bb-viewer-next').addEventListener('click', (e) => { e.stopPropagation(); this._navigateViewer(1) })
    $('.bb-tb-prev').addEventListener('click', (e) => { e.stopPropagation(); this._navigateViewer(-1) })
    $('.bb-tb-next').addEventListener('click', (e) => { e.stopPropagation(); this._navigateViewer(1) })
    $('.bb-tb-zoom-in').addEventListener('click', (e) => { e.stopPropagation(); this._zoomBy(0.25) })
    $('.bb-tb-zoom-out').addEventListener('click', (e) => { e.stopPropagation(); this._zoomBy(-0.25) })
    $('.bb-tb-zoom-reset').addEventListener('click', (e) => { e.stopPropagation(); this._resetZoom() })
    $('.bb-tb-play').addEventListener('click', (e) => { e.stopPropagation(); this._togglePlayback() })
    $('.bb-tb-panel-toggle').addEventListener('click', (e) => { e.stopPropagation(); this._togglePanel() })
    $('.bb-tb-close').addEventListener('click', (e) => { e.stopPropagation(); this._closeViewer() })

    let clickStartX, clickStartY, didDrag
    $('.bb-viewer-image-area').addEventListener('mousedown', (e) => { clickStartX = e.clientX; clickStartY = e.clientY; didDrag = false })
    $('.bb-viewer-image-area').addEventListener('wheel', (e) => { e.preventDefault(); e.stopPropagation(); this._zoomAtPoint(e.deltaY < 0 ? 0.15 : -0.15, e.clientX, e.clientY) }, { passive: false })

    const vidWrap = $('.bb-viewer-img-wrap')
    let dragStartX, dragStartY, startPanX, startPanY
    vidWrap.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return
      this._isPanning = true; dragStartX = e.clientX; dragStartY = e.clientY; startPanX = this._panX; startPanY = this._panY; vidWrap.style.cursor = 'grabbing'; e.preventDefault()
    })
    document.addEventListener('mousemove', this._onPanMove = (e) => {
      if (!this._isPanning) return
      const dx = e.clientX - dragStartX, dy = e.clientY - dragStartY
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) didDrag = true
      this._panX = startPanX + dx; this._panY = startPanY + dy; this._applyTransform()
    })
    document.addEventListener('mouseup', this._onPanEnd = (e) => {
      if (this._isPanning) { this._isPanning = false; const w = document.querySelector('.bb-viewer-img-wrap'); if (w) w.style.cursor = this._zoom > 1 ? 'grab' : 'default' }
      if (!didDrag && clickStartX !== undefined) {
        if (Math.abs(e.clientX - clickStartX) < 5 && Math.abs(e.clientY - clickStartY) < 5) {
          const t = document.elementFromPoint(e.clientX, e.clientY)
          if (t && (t.classList.contains('bb-viewer-image-area') || t.classList.contains('bb-viewer-img-wrap') || t.classList.contains('bb-viewer-video'))) this._closeViewer()
        }
      }
      clickStartX = undefined
    })
    $('.bb-viewer-panel').addEventListener('click', (e) => e.stopPropagation())
    $('.bb-viewer-toolbar').addEventListener('click', (e) => e.stopPropagation())
  }

  _navigateViewer(dir) {
    const i = this._currentIndex + dir
    if (i >= 0 && i < this._cardData.length) { this._currentIndex = i; this._zoom = 1; this._panX = 0; this._panY = 0; this._showVideo(i) }
  }

  async _showVideo(index) {
    const data = this._cardData[index]
    if (!data) return
    const video = document.querySelector('.bb-viewer-video')
    if (video) { video.src = data.videoSrc; video.volume = this.volume / 100; video.load(); video.play().catch(() => {}); this._applyTransform() }
    const playBtn = document.querySelector('.bb-tb-play i')
    if (playBtn) { playBtn.classList.remove('fa-play'); playBtn.classList.add('fa-pause') }
    const label = `${index + 1} / ${this._cardData.length}`
    const counter = document.querySelector('.bb-viewer-counter')
    const counterPanel = document.querySelector('.bb-viewer-counter-panel')
    if (counter) counter.textContent = label
    if (counterPanel) counterPanel.textContent = label
    const prev = document.querySelector('.bb-viewer-prev')
    const next = document.querySelector('.bb-viewer-next')
    if (prev) prev.style.visibility = index > 0 ? 'visible' : 'hidden'
    if (next) next.style.visibility = index < this._cardData.length - 1 ? 'visible' : 'hidden'
    const wrap = document.querySelector('.bb-viewer-img-wrap')
    if (wrap) wrap.style.cursor = 'default'
    this._updateZoomLabel()
    await this._loadPanel(data)
  }

  // --- Zoom & Pan ---
  _zoomBy(delta) {
    this._zoom = Math.max(0.1, Math.min(20, this._zoom + delta)); this._applyTransform(); this._updateZoomLabel()
    const w = document.querySelector('.bb-viewer-img-wrap'); if (w) w.style.cursor = this._zoom > 1 ? 'grab' : 'default'
  }
  _zoomAtPoint(delta, clientX, clientY) {
    const w = document.querySelector('.bb-viewer-img-wrap'); if (!w) return
    const rect = w.getBoundingClientRect(), cx = clientX - rect.left - rect.width / 2, cy = clientY - rect.top - rect.height / 2
    const oldZoom = this._zoom; this._zoom = Math.max(0.1, Math.min(20, this._zoom + delta)); const scale = this._zoom / oldZoom
    this._panX = cx - scale * (cx - this._panX); this._panY = cy - scale * (cy - this._panY)
    this._applyTransform(); this._updateZoomLabel(); if (w) w.style.cursor = this._zoom > 1 ? 'grab' : 'default'
  }
  _resetZoom() {
    this._zoom = 1; this._panX = 0; this._panY = 0; this._applyTransform(); this._updateZoomLabel()
    const w = document.querySelector('.bb-viewer-img-wrap'); if (w) w.style.cursor = 'default'
  }
  _applyTransform() {
    const v = document.querySelector('.bb-viewer-video')
    if (v) v.style.transform = `translate(${this._panX}px, ${this._panY}px) scale(${this._zoom})`
  }
  _updateZoomLabel() {
    const l = document.querySelector('.bb-tb-zoom-level'); if (l) l.textContent = `${Math.round(this._zoom * 100)}%`
  }

  // --- Playback ---
  _togglePlayback() {
    const v = document.querySelector('.bb-viewer-video'), btn = document.querySelector('.bb-tb-play i')
    if (!v) return
    if (v.paused) { v.play().catch(() => {}); if (btn) { btn.classList.remove('fa-play'); btn.classList.add('fa-pause') } }
    else { v.pause(); if (btn) { btn.classList.remove('fa-pause'); btn.classList.add('fa-play') } }
  }

  // --- Panel ---
  _togglePanel() {
    const p = document.getElementById('bb-viewer-panel'); if (!p) return; p.classList.toggle('collapsed')
    const btn = document.querySelector('.bb-tb-panel-toggle i'); if (btn) btn.style.opacity = p.classList.contains('collapsed') ? '0.4' : '1'
  }
  async _loadPanel(data) {
    const body = document.querySelector('#bb-viewer-panel .panel-body'); if (!body) return
    let meta = {}; try { meta = await this.api.getVideo(data.fingerprint) } catch (e) {}
    body.innerHTML = this._buildPanelHTML(meta); this._attachPanelHandlers(body, meta)
  }
  _buildPanelHTML(meta) {
    let tagsHTML = ''
    if (meta.tags && meta.tags.length > 0) tagsHTML = meta.tags.map(t => `<span class='panel-tag panel-filter' data-filter='tag:${t}'><i class="fa-solid fa-tag"></i> ${t}</span>`).join('')
    const fields = ['filename', 'width', 'height', 'duration', 'size', 'file_path']
    let rows = ''
    for (const key of fields) {
      if (meta[key] == null || meta[key] === '') continue
      let val
      if (key === 'file_path') { const segs = String(meta[key]).split(/[\/\\]/).filter(s => s.length); val = segs.map(s => `<span class='panel-filter' data-filter='file_path:${s}'>${s}</span>`).join('<span class="panel-sep">/</span>') }
      else if (key === 'size') val = this.formatFileSize(meta[key])
      else if (key === 'duration') val = this.formatDuration(meta[key])
      else val = `<span class='panel-filter' data-filter='${key}:${meta[key]}'>${meta[key]}</span>`
      rows += `<tr><td class='panel-key'>${key}</td><td class='panel-val'>${val}</td></tr>`
    }
    return `<div class='panel-tags'>${tagsHTML}<div class='panel-tag-input'><input type='text' placeholder='Add tag...' class='panel-add-tag' data-fingerprint='${meta.fingerprint || ''}'></div></div><div class='panel-meta'><table>${rows}</table></div>`
  }
  _attachPanelHandlers(container, meta) {
    const tagInput = container.querySelector('.panel-add-tag')
    if (tagInput) tagInput.addEventListener('keydown', async (e) => {
      if (e.key !== 'Enter') return; e.preventDefault(); e.stopPropagation()
      const val = tagInput.value.trim(); if (!val) return
      const fp = tagInput.getAttribute('data-fingerprint')
      if (fp) await this.api.addVideoTags([fp], [val])
      tagInput.value = ''; const data = this._cardData[this._currentIndex]; if (data) await this._loadPanel(data)
    })
    container.querySelectorAll('.panel-filter').forEach(el => el.addEventListener('click', (e) => {
      e.stopPropagation(); const filter = el.getAttribute('data-filter')
      if (filter) { this._closeViewer(); this.query = filter; document.querySelector('.search').value = filter; this.loadVideos() }
    }))
  }

  _closeViewer(silent) {
    const vv = document.querySelector('.bb-viewer-video'); if (vv) vv.pause()
    if (this._onPanMove) { document.removeEventListener('mousemove', this._onPanMove); this._onPanMove = null }
    if (this._onPanEnd) { document.removeEventListener('mouseup', this._onPanEnd); this._onPanEnd = null }
    const overlay = document.getElementById('bb-viewer-overlay'); if (overlay) overlay.remove()
    if (this._keyHandler && !silent) { document.removeEventListener('keydown', this._keyHandler); this._keyHandler = null }
    if (!silent) {
      // Restore nav — re-apply the full auto-hide logic to ensure clean state
      this.applyAutoHideNav()
      this._navWasAutoHide = undefined
      this._resetAllPlayLocks()
    }
    this._viewerOpen = false
  }

  _resetAllPlayLocks() {
    document.querySelectorAll('.video-card.playing-locked').forEach(card => {
      card.classList.remove('playing-locked')
      const video = card.querySelector('video.video-hover') || card.querySelector('video.video-fallback')
      if (video) { video.pause(); video.currentTime = 0; video.muted = true }
      const thumb = card.querySelector('img.video-thumb')
      const hoverVideo = card.querySelector('video.video-hover')
      if (thumb) { thumb.style.display = 'block'; if (hoverVideo) hoverVideo.style.display = 'none' }
      const btn = card.querySelector('.play-lock-btn')
      if (btn) btn.querySelector('i').className = 'fa-solid fa-play'
    })
  }

  // =============================================
  // Settings Sidebar
  // =============================================
  async toggleSettings() {
    const sidebar = document.getElementById('settings-sidebar'); if (!sidebar) return
    if (sidebar.classList.contains('hidden')) {
      const nav = document.querySelector('nav'); const navH = nav ? nav.offsetHeight - 1 : 0
      sidebar.style.top = navH + 'px'; sidebar.style.height = `calc(100vh - ${navH}px)`
      await this.renderSettings(sidebar); sidebar.classList.remove('hidden')
    } else { sidebar.classList.add('hidden') }
  }

  async renderSettings(sidebar) {
    const zoom = this.zoom || 100, minimal = this.minimal.val || 'default', theme = this.theme.val || 'default', fit = this.style.fit || 'cover', vol = this.volume != null ? this.volume : 50
    sidebar.innerHTML = `
      <div class='sb-header'><h3><i class="fa-solid fa-gear"></i> Video Settings</h3><button class='sb-close' title='Close'><i class="fa-solid fa-xmark"></i></button></div>
      <div class='sb-body'>
        <div class='sb-section'><h4><i class="fa-solid fa-palette"></i> Theme</h4><div class='sb-row sb-theme-row'><button class='sb-btn ${theme === "dark" ? "active" : ""}' data-theme='dark'><i class="fa-solid fa-moon"></i> Dark</button><button class='sb-btn ${theme === "default" ? "active" : ""}' data-theme='default'><i class="fa-regular fa-sun"></i> Light</button></div></div>
        <div class='sb-section'><h4><i class="fa-solid fa-eye-slash"></i> Auto-hide Nav</h4><div class='sb-row'><label><input type='checkbox' id='sb-autohide-nav' ${this.autoHideNav ? 'checked' : ''}> Hide nav bar until hover</label></div></div>
        <div class='sb-section'><h4><i class="fa-solid fa-id-card"></i> Card Header</h4><div class='sb-row sb-minimal-row'><label><input type='radio' name='sb-minimal' value='default' ${minimal === 'default' ? 'checked' : ''}> Always</label><label><input type='radio' name='sb-minimal' value='minimal' ${minimal === 'minimal' ? 'checked' : ''}> On hover</label><label><input type='radio' name='sb-minimal' value='none' ${minimal === 'none' ? 'checked' : ''}> Hidden</label></div></div>
        <div class='sb-section'><h4><i class="fa-solid fa-magnifying-glass"></i> Card Size</h4><div class='sb-row'><span class='sb-label'>Zoom <span class='sb-val' id='sb-zoom-val'>${zoom}%</span></span><input type='range' id='sb-zoom' min='20' max='600' value='${zoom}' step='1'></div><div class='sb-row sb-fit-row'><label><input type='radio' name='sb-fit' value='contain' ${fit === 'contain' ? 'checked' : ''}> Contain</label><label><input type='radio' name='sb-fit' value='cover' ${fit === 'cover' ? 'checked' : ''}> Cover</label></div></div>
        <div class='sb-section'><h4><i class="fa-solid fa-volume-high"></i> Playback Volume</h4><div class='sb-row'><span class='sb-label'>Volume <span class='sb-val' id='sb-vol-val'>${vol}%</span></span><input type='range' id='sb-volume' min='0' max='100' value='${vol}' step='5'></div></div>
        <div class='sb-section'><h4><i class="fa-solid fa-rotate"></i> Re-index</h4><button class='sb-btn sb-reindex'><i class="fa-solid fa-rotate"></i> Re-index from Scratch</button></div>
        <div class='sb-section'><h4><i class="fa-solid fa-trash-can"></i> Deleted Files</h4><div class='sb-row'><label><input type='checkbox' id='sb-confirm-delete' ${this.confirmDelete ? 'checked' : ''}> Ask before deleting</label></div><div class='sb-row sb-trash-info'><span class='sb-label'>Loading...</span></div><div class='sb-row sb-trash-actions' style='display:none'><button class='sb-btn sb-open-trash'><i class="fa-regular fa-folder-open"></i> Open Folder</button><button class='sb-btn sb-empty-trash' style='color:#e55'><i class="fa-solid fa-trash"></i> Empty Trash</button></div></div>
        ${AGENT === 'electron' ? `<div class='sb-section'><h4><i class="fa-solid fa-terminal"></i> Debug</h4><button class='sb-btn sb-debug'><i class="fa-solid fa-terminal"></i> Open DevTools</button></div>` : ''}
        <div class='sb-section sb-version'><span>Breadboard v${VERSION}</span></div>
        <div class='sb-section sb-bottom-close'><button class='sb-btn sb-close-bottom'><i class="fa-solid fa-xmark"></i> Close Settings</button></div>
      </div>`

    sidebar.querySelector('.sb-close').addEventListener('click', () => this.toggleSettings())
    sidebar.querySelector('.sb-close-bottom').addEventListener('click', () => this.toggleSettings())
    // Theme — write to BOTH shared settings (global) and video settings, so image tab picks it up
    sidebar.querySelectorAll('.sb-theme-row button').forEach(btn => btn.addEventListener('click', async () => {
      await this.api.setSetting('theme', btn.dataset.theme)
      this.theme.val = btn.dataset.theme; document.body.className = btn.dataset.theme; this.api.theme(btn.dataset.theme)
      sidebar.querySelectorAll('.sb-theme-row button').forEach(b => b.classList.remove('active')); btn.classList.add('active')
    }))
    sidebar.querySelector('#sb-autohide-nav')?.addEventListener('change', async (e) => { this.autoHideNav = e.target.checked; await this.api.setVideoSetting('autohide_nav', e.target.checked); this.applyAutoHideNav() })
    sidebar.querySelector('#sb-confirm-delete')?.addEventListener('change', async (e) => { this.confirmDelete = e.target.checked; await this.api.setVideoSetting('confirm_delete', e.target.checked) })
    sidebar.querySelectorAll('[name=sb-minimal]').forEach(el => el.addEventListener('change', async () => { await this.api.setVideoSetting('minimal', el.value); this.minimal.val = el.value; document.body.setAttribute('data-minimal', el.value) }))
    sidebar.querySelector('#sb-zoom')?.addEventListener('input', async (e) => { const val = parseInt(e.target.value); sidebar.querySelector('#sb-zoom-val').textContent = val + '%'; await this.api.setVideoSetting('video_zoom', val); this.zoom = val; this.applyCardStyle() })
    // Fit mode
    sidebar.querySelectorAll('[name=sb-fit]').forEach(el => el.addEventListener('change', async () => { await this.api.setVideoSetting('video_fit', el.value); this.style.fit = el.value; this.applyFit() }))
    // Volume
    sidebar.querySelector('#sb-volume')?.addEventListener('input', async (e) => {
      const val = parseInt(e.target.value); sidebar.querySelector('#sb-vol-val').textContent = val + '%'
      await this.api.setVideoSetting('video_volume', val); this.volume = val
      // Apply to all currently playing videos
      document.querySelectorAll('.video-card.playing-locked video').forEach(v => { v.volume = val / 100 })
    })
    // Re-index
    sidebar.querySelector('.sb-reindex')?.addEventListener('click', async () => { this.toggleSettings(); await this.scanAllFolders() })
    this._loadTrashInfo(sidebar)
    sidebar.querySelector('.sb-debug')?.addEventListener('click', () => this.api.debug())
  }

  async _loadTrashInfo(sidebar) {
    const infoEl = sidebar.querySelector('.sb-trash-info'), actionsEl = sidebar.querySelector('.sb-trash-actions')
    if (!infoEl) return
    try {
      const trash = await this.api.getVideoTrash()
      if (trash.length > 0) {
        infoEl.innerHTML = `<span class='sb-label'>${trash.length} file${trash.length > 1 ? 's' : ''} in trash</span>`; actionsEl.style.display = 'flex'
        sidebar.querySelector('.sb-open-trash')?.addEventListener('click', () => this.api.open(trash[0].trash_path))
        sidebar.querySelector('.sb-empty-trash')?.addEventListener('click', async () => { if (await this.confirm(`Permanently delete ${trash.length} file${trash.length > 1 ? 's' : ''} from trash?`)) { await this.api.emptyVideoTrash(); await this._loadTrashInfo(sidebar) } })
      } else { infoEl.innerHTML = `<span class='sb-label' style='color:#888'>Trash is empty</span>`; actionsEl.style.display = 'none' }
    } catch (e) { infoEl.innerHTML = `<span class='sb-label' style='color:#888'>Could not load trash</span>` }
  }

  // --- Utilities ---
  formatFileSize(bytes) {
    if (!bytes || bytes === 0) return '0 B'; const k = 1024, sizes = ['B', 'KB', 'MB', 'GB'], i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
  }
  formatDuration(seconds) {
    if (!seconds || seconds <= 0) return ''; const m = Math.floor(seconds / 60), s = Math.floor(seconds % 60)
    return m > 0 ? `${m}:${s.toString().padStart(2, '0')}` : `0:${s.toString().padStart(2, '0')}`
  }
}

// Initialize
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => { window.videoApp = new VideoApp() })
else window.videoApp = new VideoApp()
