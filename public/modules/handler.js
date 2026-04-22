class Handler {
  constructor(app, api) {
    this.app = app
    this.api = api
    this._zoom = 1
    this._panX = 0
    this._panY = 0
    this._isPanning = false
    this._slideshowTimer = null

    // --- Main container click handler ---
    document.querySelector(".container").addEventListener("click", async (e) => {
      e.preventDefault()
      e.stopPropagation()

      let grabTarget = e.target.closest(".grab")
      let popupTarget = e.target.closest(".popup")
      let openFileTarget = e.target.closest(".open-file")
      let favoriteFileTarget = e.target.closest(".favorite-file")
      let trashFileTarget = e.target.closest(".trash-file")
      let imgTarget = e.target.closest("img")
      let card = e.target.closest(".card")

      if (!card) return

      if (openFileTarget) {
        this.api.open(openFileTarget.getAttribute("data-src"))
      } else if (popupTarget) {
        const url = popupTarget.getAttribute("data-src")
        const query = document.querySelector(".search").value
        const fullUrl = query ? `${url}&query=${encodeURIComponent(query)}` : url
        window.open(fullUrl, "_blank", "popup,width=512")
      } else if (favoriteFileTarget) {
        await this._toggleFavorite(favoriteFileTarget)
      } else if (trashFileTarget) {
        await this._trashFile(trashFileTarget, card)
      } else if (grabTarget) {
        // Header area — let selection.js handle it
      } else if (imgTarget) {
        this._openViewer(card)
      }
    })
  }

  // =============================================
  // Fullscreen viewer with pan/zoom and info panel
  // =============================================

  _openViewer(selectedCard) {
    const allCards = Array.from(document.querySelectorAll('.content .card'))
    const selectedIndex = allCards.indexOf(selectedCard)

    this._cardData = []
    allCards.forEach(card => {
      const img = card.querySelector('img')
      if (img) {
        this._cardData.push({
          fingerprint: card.getAttribute('data-fingerprint'),
          file_path: card.getAttribute('data-src'),
          root_path: card.getAttribute('data-root'),
          imgSrc: img.getAttribute('src'),
        })
      }
    })

    this._currentIndex = selectedIndex >= 0 ? selectedIndex : 0
    this._zoom = 1
    this._panX = 0
    this._panY = 0
    this._stopSlideshow()

    // Clear selection so footer hides
    if (this.app.selection) {
      this.app.selection.els = []
      if (this.app.selection.ds) this.app.selection.ds.clearSelection()
      this.app.selection.update([])
    }

    this._buildOverlay()
    this._showImage(this._currentIndex)

    // Force nav into auto-hide while viewer is open
    const nav = document.querySelector('nav')
    if (nav) {
      this._navWasAutoHide = nav.classList.contains('autohide')
      if (!this._navWasAutoHide) {
        nav.classList.add('autohide')
        // Recalculate container padding won't matter since overlay covers it
      }
      nav.classList.remove('force-show')
    }

    this._keyHandler = (e) => {
      // Don't handle keys if typing in tag input
      if (e.target.tagName === 'INPUT') return
      if (e.key === 'Escape') this._closeOverlay()
      else if (e.key === 'ArrowLeft') this._navigate(-1)
      else if (e.key === 'ArrowRight') this._navigate(1)
      else if (e.key === '+' || e.key === '=') this._zoomBy(0.25)
      else if (e.key === '-') this._zoomBy(-0.25)
      else if (e.key === '0') this._resetZoom()
      else if (e.key === ' ') { e.preventDefault(); this._toggleSlideshow() }
      else if (e.key === 'i') this._togglePanel()
    }
    document.addEventListener('keydown', this._keyHandler)
  }

  _buildOverlay() {
    this._closeOverlay(true)

    const overlay = document.createElement('div')
    overlay.id = 'bb-viewer-overlay'
    overlay.innerHTML = `
      <div class='bb-viewer-main'>
        <div class='bb-viewer-image-area'>
          <button class='bb-viewer-nav bb-viewer-prev' title='Previous (←)'><i class="fa-solid fa-chevron-left"></i></button>
          <div class='bb-viewer-img-wrap'>
            <img class='bb-viewer-img' src='' alt='' draggable='false'>
          </div>
          <button class='bb-viewer-nav bb-viewer-next' title='Next (→)'><i class="fa-solid fa-chevron-right"></i></button>
        </div>
        <div class='bb-viewer-toolbar'>
          <button class='bb-tb-btn bb-tb-prev' title='Previous'><i class="fa-solid fa-chevron-left"></i></button>
          <span class='bb-viewer-counter'></span>
          <button class='bb-tb-btn bb-tb-next' title='Next'><i class="fa-solid fa-chevron-right"></i></button>
          <span class='bb-tb-sep'></span>
          <button class='bb-tb-btn bb-tb-zoom-out' title='Zoom out (−)'><i class="fa-solid fa-magnifying-glass-minus"></i></button>
          <button class='bb-tb-btn bb-tb-zoom-reset' title='Fit to view (0)'><i class="fa-solid fa-expand"></i></button>
          <button class='bb-tb-btn bb-tb-zoom-in' title='Zoom in (+)'><i class="fa-solid fa-magnifying-glass-plus"></i></button>
          <span class='bb-tb-zoom-level'>100%</span>
          <span class='bb-tb-sep'></span>
          <button class='bb-tb-btn bb-tb-slideshow' title='Slideshow (Space)'><i class="fa-solid fa-play"></i></button>
          <span class='bb-tb-sep'></span>
          <button class='bb-tb-btn bb-tb-panel-toggle' title='Toggle info panel (i)'><i class="fa-solid fa-circle-info"></i></button>
          <span class='bb-tb-sep'></span>
          <button class='bb-tb-btn bb-tb-close' title='Close (Esc)'><i class="fa-solid fa-xmark"></i></button>
        </div>
      </div>
      <div class='bb-viewer-panel' id='bb-viewer-panel'>
        <div class='panel-header'>
          <span>Image Info</span>
          <span class='bb-viewer-counter-panel'></span>
        </div>
        <div class='panel-body'></div>
      </div>
    `
    document.body.appendChild(overlay)

    const $ = (sel) => overlay.querySelector(sel)

    // Nav buttons
    $('.bb-viewer-prev').addEventListener('click', (e) => { e.stopPropagation(); this._navigate(-1) })
    $('.bb-viewer-next').addEventListener('click', (e) => { e.stopPropagation(); this._navigate(1) })
    $('.bb-tb-prev').addEventListener('click', (e) => { e.stopPropagation(); this._navigate(-1) })
    $('.bb-tb-next').addEventListener('click', (e) => { e.stopPropagation(); this._navigate(1) })

    // Zoom
    $('.bb-tb-zoom-in').addEventListener('click', (e) => { e.stopPropagation(); this._zoomBy(0.25) })
    $('.bb-tb-zoom-out').addEventListener('click', (e) => { e.stopPropagation(); this._zoomBy(-0.25) })
    $('.bb-tb-zoom-reset').addEventListener('click', (e) => { e.stopPropagation(); this._resetZoom() })

    // Slideshow & panel toggle
    $('.bb-tb-slideshow').addEventListener('click', (e) => { e.stopPropagation(); this._toggleSlideshow() })
    $('.bb-tb-panel-toggle').addEventListener('click', (e) => { e.stopPropagation(); this._togglePanel() })
    $('.bb-tb-close').addEventListener('click', (e) => { e.stopPropagation(); this._closeOverlay() })

    // Click background to close — but only if not dragging
    // We track mouse movement to distinguish click from drag
    let clickStartX, clickStartY, didDrag

    $('.bb-viewer-image-area').addEventListener('mousedown', (e) => {
      clickStartX = e.clientX
      clickStartY = e.clientY
      didDrag = false
    })

    // Mouse wheel zoom — zoom toward cursor position
    $('.bb-viewer-image-area').addEventListener('wheel', (e) => {
      e.preventDefault()
      e.stopPropagation()
      const delta = e.deltaY < 0 ? 0.15 : -0.15
      this._zoomAtPoint(delta, e.clientX, e.clientY)
    }, { passive: false })

    // Pan (drag) on the image
    const imgWrap = $('.bb-viewer-img-wrap')
    let dragStartX, dragStartY, startPanX, startPanY

    imgWrap.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return
      this._isPanning = true
      dragStartX = e.clientX
      dragStartY = e.clientY
      startPanX = this._panX
      startPanY = this._panY
      imgWrap.style.cursor = 'grabbing'
      e.preventDefault()
    })

    document.addEventListener('mousemove', this._onPanMove = (e) => {
      if (!this._isPanning) return
      const dx = e.clientX - dragStartX
      const dy = e.clientY - dragStartY
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) didDrag = true
      this._panX = startPanX + dx
      this._panY = startPanY + dy
      this._applyTransform()
    })

    document.addEventListener('mouseup', this._onPanEnd = (e) => {
      if (this._isPanning) {
        this._isPanning = false
        const imgWrap = document.querySelector('.bb-viewer-img-wrap')
        if (imgWrap) imgWrap.style.cursor = this._zoom > 1 ? 'grab' : 'default'
      }
      // Click-to-close: if mouse didn't drag, treat as a click
      if (!didDrag && clickStartX !== undefined) {
        const dx = Math.abs(e.clientX - clickStartX)
        const dy = Math.abs(e.clientY - clickStartY)
        if (dx < 5 && dy < 5) {
          // Only close if clicking the background area or image (not nav buttons or toolbar)
          const target = document.elementFromPoint(e.clientX, e.clientY)
          if (target && (
            target.classList.contains('bb-viewer-image-area') ||
            target.classList.contains('bb-viewer-img-wrap') ||
            target.classList.contains('bb-viewer-img')
          )) {
            this._closeOverlay()
          }
        }
      }
      clickStartX = undefined
    })

    // Panel clicks don't close viewer
    $('.bb-viewer-panel').addEventListener('click', (e) => e.stopPropagation())
    $('.bb-viewer-toolbar').addEventListener('click', (e) => e.stopPropagation())
  }

  // --- Navigation ---

  _navigate(direction) {
    const newIndex = this._currentIndex + direction
    if (newIndex >= 0 && newIndex < this._cardData.length) {
      this._currentIndex = newIndex
      this._zoom = 1
      this._panX = 0
      this._panY = 0
      this._showImage(newIndex)
    }
  }

  async _showImage(index) {
    const data = this._cardData[index]
    if (!data) return

    const img = document.querySelector('.bb-viewer-img')
    if (img) {
      img.src = data.imgSrc
      this._applyTransform()
    }

    const label = `${index + 1} / ${this._cardData.length}`
    const counter = document.querySelector('.bb-viewer-counter')
    const counterPanel = document.querySelector('.bb-viewer-counter-panel')
    if (counter) counter.textContent = label
    if (counterPanel) counterPanel.textContent = label

    const prev = document.querySelector('.bb-viewer-prev')
    const next = document.querySelector('.bb-viewer-next')
    if (prev) prev.style.visibility = index > 0 ? 'visible' : 'hidden'
    if (next) next.style.visibility = index < this._cardData.length - 1 ? 'visible' : 'hidden'

    const imgWrap = document.querySelector('.bb-viewer-img-wrap')
    if (imgWrap) imgWrap.style.cursor = 'default'

    this._updateZoomLabel()
    await this._loadPanel(data)
  }

  // --- Zoom & Pan ---

  _zoomBy(delta) {
    this._zoom = Math.max(0.1, Math.min(20, this._zoom + delta))
    this._applyTransform()
    this._updateZoomLabel()
    const imgWrap = document.querySelector('.bb-viewer-img-wrap')
    if (imgWrap) imgWrap.style.cursor = this._zoom > 1 ? 'grab' : 'default'
  }

  _zoomAtPoint(delta, clientX, clientY) {
    const imgWrap = document.querySelector('.bb-viewer-img-wrap')
    if (!imgWrap) return

    const rect = imgWrap.getBoundingClientRect()
    const cx = clientX - rect.left - rect.width / 2
    const cy = clientY - rect.top - rect.height / 2

    const oldZoom = this._zoom
    this._zoom = Math.max(0.1, Math.min(20, this._zoom + delta))
    const scale = this._zoom / oldZoom

    // Adjust pan so the point under the cursor stays fixed
    this._panX = cx - scale * (cx - this._panX)
    this._panY = cy - scale * (cy - this._panY)

    this._applyTransform()
    this._updateZoomLabel()
    if (imgWrap) imgWrap.style.cursor = this._zoom > 1 ? 'grab' : 'default'
  }

  _resetZoom() {
    this._zoom = 1
    this._panX = 0
    this._panY = 0
    this._applyTransform()
    this._updateZoomLabel()
    const imgWrap = document.querySelector('.bb-viewer-img-wrap')
    if (imgWrap) imgWrap.style.cursor = 'default'
  }

  _applyTransform() {
    const img = document.querySelector('.bb-viewer-img')
    if (img) {
      img.style.transform = `translate(${this._panX}px, ${this._panY}px) scale(${this._zoom})`
    }
  }

  _updateZoomLabel() {
    const label = document.querySelector('.bb-tb-zoom-level')
    if (label) label.textContent = `${Math.round(this._zoom * 100)}%`
  }

  // --- Slideshow ---

  _toggleSlideshow() {
    if (this._slideshowTimer) this._stopSlideshow()
    else this._startSlideshow()
  }

  _startSlideshow() {
    const interval = (this.app.style && this.app.style.slideshow_interval) ? this.app.style.slideshow_interval : 3000
    const btn = document.querySelector('.bb-tb-slideshow i')
    if (btn) { btn.classList.remove('fa-play'); btn.classList.add('fa-pause') }
    this._slideshowTimer = setInterval(() => {
      if (this._currentIndex < this._cardData.length - 1) this._navigate(1)
      else { this._currentIndex = -1; this._navigate(1) }
    }, interval)
  }

  _stopSlideshow() {
    if (this._slideshowTimer) { clearInterval(this._slideshowTimer); this._slideshowTimer = null }
    const btn = document.querySelector('.bb-tb-slideshow i')
    if (btn) { btn.classList.remove('fa-pause'); btn.classList.add('fa-play') }
  }

  // --- Panel ---

  _togglePanel() {
    const panel = document.getElementById('bb-viewer-panel')
    if (!panel) return
    panel.classList.toggle('collapsed')
    const btn = document.querySelector('.bb-tb-panel-toggle i')
    if (btn) btn.style.opacity = panel.classList.contains('collapsed') ? '0.4' : '1'
  }

  async _loadPanel(data) {
    const panelBody = document.querySelector('#bb-viewer-panel .panel-body')
    if (!panelBody) return
    let meta = {}
    try { meta = await this.api.getImage(data.fingerprint) } catch (e) {}
    panelBody.innerHTML = this._buildPanelHTML(meta)
    this._attachPanelHandlers(panelBody, meta)
  }

  _closeOverlay(silent) {
    this._stopSlideshow()
    // Remove pan listeners
    if (this._onPanMove) { document.removeEventListener('mousemove', this._onPanMove); this._onPanMove = null }
    if (this._onPanEnd) { document.removeEventListener('mouseup', this._onPanEnd); this._onPanEnd = null }
    const overlay = document.getElementById('bb-viewer-overlay')
    if (overlay) overlay.remove()
    if (this._keyHandler && !silent) {
      document.removeEventListener('keydown', this._keyHandler)
      this._keyHandler = null
    }
    // Restore nav auto-hide state
    if (!silent) {
      const nav = document.querySelector('nav')
      if (nav && !this._navWasAutoHide) {
        nav.classList.remove('autohide')
        nav.classList.remove('force-show')
      }
    }
    // Clear selection when viewer closes so footer hides
    if (!silent && this.app.selection) {
      this.app.selection.els = []
      if (this.app.selection.ds) this.app.selection.ds.clearSelection()
      this.app.selection.update([])
    }
  }

  // --- Panel content ---

  _buildPanelHTML(meta) {
    let tagsHTML = ''
    if (meta.tags && meta.tags.length > 0) {
      tagsHTML = meta.tags.map(t =>
        `<span class='panel-tag panel-filter' data-filter='tag:${t}'><i class="fa-solid fa-tag"></i> ${t}</span>`
      ).join('')
    }

    let promptHTML = ''
    if (meta.prompt) {
      const words = meta.prompt.split(/\s+/).filter(w => w.length > 0)
      const tokenized = words.map(w => `<span class='panel-token panel-filter' data-filter='${w}'>${w}</span>`).join(' ')
      promptHTML = `<div class='panel-prompt'>${tokenized}</div>`
    }

    const stringFields = ['agent', 'model_name', 'model_hash', 'sampler', 'loras', 'subfolder', 'controlnet_module', 'controlnet_model']
    const numericFields = ['steps', 'cfg_scale', 'seed', 'input_strength', 'width', 'height', 'aesthetic_score', 'controlnet_weight', 'controlnet_guidance_strength']
    const displayFields = [
      'agent', 'model_name', 'model_hash', 'sampler', 'steps', 'cfg_scale',
      'seed', 'input_strength', 'width', 'height', 'aesthetic_score', 'loras',
      'negative_prompt', 'controlnet_module', 'controlnet_model',
      'controlnet_weight', 'controlnet_guidance_strength', 'subfolder', 'file_path'
    ]

    let metaRows = ''
    for (const key of displayFields) {
      if (meta[key] != null && meta[key] !== '') {
        let valHTML
        if (stringFields.includes(key)) {
          valHTML = `<span class='panel-filter' data-filter='${key}:${meta[key]}'>${meta[key]}</span>`
        } else if (numericFields.includes(key)) {
          valHTML = `<span class='panel-filter' data-filter='${key}:${meta[key]}'>${meta[key]}</span>`
        } else if (key === 'file_path') {
          const segments = String(meta[key]).split(/[\/\\]/).filter(s => s.length > 0)
          valHTML = segments.map(s => `<span class='panel-filter' data-filter='file_path:${s}'>${s}</span>`).join('<span class="panel-sep">/</span>')
        } else if (key === 'negative_prompt') {
          valHTML = `<span class='panel-neg-prompt'>${meta[key]}</span>`
        } else {
          valHTML = meta[key]
        }
        metaRows += `<tr><td class='panel-key'>${key}</td><td class='panel-val'>${valHTML}</td></tr>`
      }
    }

    return `
      ${promptHTML}
      <div class='panel-tags'>
        ${tagsHTML}
        <div class='panel-tag-input'>
          <input type='text' placeholder='Add tag...' class='panel-add-tag'
            data-fingerprint='${meta.fingerprint || ''}'
            data-src='${meta.file_path || ''}'
            data-root='${meta.root_path || ''}'>
        </div>
      </div>
      <div class='panel-actions'>
        <button class='panel-btn panel-copy-prompt' data-value="${(meta.prompt || '').replace(/"/g, '&quot;')}"><i class="fa-regular fa-clone"></i> Copy Prompt</button>
      </div>
      <div class='panel-meta'>
        <table>${metaRows}</table>
      </div>`
  }

  _attachPanelHandlers(container, meta) {
    const copyBtn = container.querySelector('.panel-copy-prompt')
    if (copyBtn) {
      copyBtn.addEventListener('click', (e) => {
        e.stopPropagation()
        this.api.copy(copyBtn.getAttribute('data-value'))
        copyBtn.innerHTML = '<i class="fa-solid fa-check"></i> Copied'
        setTimeout(() => { copyBtn.innerHTML = '<i class="fa-regular fa-clone"></i> Copy Prompt' }, 2000)
      })
    }

    const tagInput = container.querySelector('.panel-add-tag')
    if (tagInput) {
      tagInput.addEventListener('keydown', async (e) => {
        if (e.key !== 'Enter') return
        e.preventDefault()
        e.stopPropagation()
        const val = tagInput.value.trim()
        if (!val) return
        const fp = tagInput.getAttribute('data-fingerprint')
        const src = tagInput.getAttribute('data-src')
        const root = tagInput.getAttribute('data-root')
        if (fp) await this.api.addImageTags([fp], [val])
        await this.api.gm({ path: "user", cmd: "set", args: [src, { "dc:subject": [{ val, mode: "merge" }] }] })
        tagInput.value = ''
        const data = this._cardData[this._currentIndex]
        if (data) await this._loadPanel(data)
      })
    }

    container.querySelectorAll('.panel-filter').forEach(el => {
      el.addEventListener('click', (e) => {
        e.stopPropagation()
        const filter = el.getAttribute('data-filter')
        if (filter) { this._closeOverlay(); this.app.search(filter) }
      })
    })
  }

  // --- Favorite toggle ---

  async _toggleFavorite(btn) {
    let is_favorited = btn.getAttribute("data-favorited") === "true"
    let src = btn.getAttribute("data-src")
    let card = btn.closest(".card")
    let root = card.querySelector("img").getAttribute("data-root")
    let fp = card.getAttribute("data-fingerprint")
    if (is_favorited) {
      if (fp) await this.api.removeImageTags([fp], ['favorite'])
      await this.api.gm({ path: "user", cmd: "set", args: [src, { "dc:subject": [{ val: "favorite", mode: "delete" }] }] })
    } else {
      if (fp) await this.api.addImageTags([fp], ['favorite'])
      await this.api.gm({ path: "user", cmd: "set", args: [src, { "dc:subject": [{ val: "favorite", mode: "merge" }] }] })
    }
    const newFav = !is_favorited
    btn.setAttribute("data-favorited", newFav)
    const icon = btn.querySelector("i")
    icon.classList.toggle("fa-regular", !newFav)
    icon.classList.toggle("fa-solid", newFav)
  }

  // --- Trash ---

  async _trashFile(btn, card) {
    const fp = btn.getAttribute("data-fingerprint")
    if (!fp) return
    if (!await this.app.confirm("Move this image to trash?")) return
    await this.api.deleteImages([fp])
    card.remove()
  }
}
