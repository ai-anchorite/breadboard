class Handler {
  constructor(app, api) {
    this.app = app
    this.api = api
    this._zoom = 1
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
  // Custom fullscreen viewer with info panel
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
    this._stopSlideshow()

    this._buildOverlay()
    this._showImage(this._currentIndex)

    this._keyHandler = (e) => {
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

    // Measure nav and footer heights to position overlay between them
    const nav = document.querySelector('nav')
    const footer = document.querySelector('footer')
    const navHeight = nav ? nav.offsetHeight - 1 : 0
    const footerHeight = (footer && !footer.classList.contains('hidden')) ? footer.offsetHeight : 0

    const overlay = document.createElement('div')
    overlay.id = 'bb-viewer-overlay'
    overlay.style.top = navHeight + 'px'
    overlay.style.height = `calc(100vh - ${navHeight}px - ${footerHeight}px)`
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
          <button class='bb-tb-btn bb-tb-zoom-reset' title='Reset zoom (0)'><i class="fa-solid fa-expand"></i></button>
          <button class='bb-tb-btn bb-tb-zoom-in' title='Zoom in (+)'><i class="fa-solid fa-magnifying-glass-plus"></i></button>
          <span class='bb-tb-zoom-level'>100%</span>
          <span class='bb-tb-sep'></span>
          <button class='bb-tb-btn bb-tb-slideshow' title='Slideshow (Space)'><i class="fa-solid fa-play"></i></button>
          <span class='bb-tb-sep'></span>
          <button class='bb-tb-btn bb-tb-panel-toggle' title='Toggle info panel'><i class="fa-solid fa-circle-info"></i></button>
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

    // --- Event wiring ---
    const $ = (sel) => overlay.querySelector(sel)

    // Nav
    $('.bb-viewer-prev').addEventListener('click', (e) => { e.stopPropagation(); this._navigate(-1) })
    $('.bb-viewer-next').addEventListener('click', (e) => { e.stopPropagation(); this._navigate(1) })
    $('.bb-tb-prev').addEventListener('click', (e) => { e.stopPropagation(); this._navigate(-1) })
    $('.bb-tb-next').addEventListener('click', (e) => { e.stopPropagation(); this._navigate(1) })

    // Zoom
    $('.bb-tb-zoom-in').addEventListener('click', (e) => { e.stopPropagation(); this._zoomBy(0.25) })
    $('.bb-tb-zoom-out').addEventListener('click', (e) => { e.stopPropagation(); this._zoomBy(-0.25) })
    $('.bb-tb-zoom-reset').addEventListener('click', (e) => { e.stopPropagation(); this._resetZoom() })

    // Slideshow
    $('.bb-tb-slideshow').addEventListener('click', (e) => { e.stopPropagation(); this._toggleSlideshow() })

    // Panel toggle
    $('.bb-tb-panel-toggle').addEventListener('click', (e) => { e.stopPropagation(); this._togglePanel() })

    // Close
    $('.bb-tb-close').addEventListener('click', (e) => { e.stopPropagation(); this._closeOverlay() })

    // Click background to close
    $('.bb-viewer-image-area').addEventListener('click', (e) => {
      if (e.target.classList.contains('bb-viewer-image-area') || e.target.classList.contains('bb-viewer-img-wrap')) {
        this._closeOverlay()
      }
    })

    // Mouse wheel zoom on image area
    $('.bb-viewer-image-area').addEventListener('wheel', (e) => {
      e.preventDefault()
      e.stopPropagation()
      this._zoomBy(e.deltaY < 0 ? 0.15 : -0.15)
    }, { passive: false })

    // Panel clicks don't close viewer
    $('.bb-viewer-panel').addEventListener('click', (e) => e.stopPropagation())
    // Toolbar clicks don't close viewer
    $('.bb-viewer-toolbar').addEventListener('click', (e) => e.stopPropagation())
  }

  // --- Navigation ---

  _navigate(direction) {
    const newIndex = this._currentIndex + direction
    if (newIndex >= 0 && newIndex < this._cardData.length) {
      this._currentIndex = newIndex
      this._zoom = 1
      this._showImage(newIndex)
    }
  }

  async _showImage(index) {
    const data = this._cardData[index]
    if (!data) return

    const img = document.querySelector('.bb-viewer-img')
    if (img) {
      img.src = data.imgSrc
      img.style.transform = `scale(${this._zoom})`
    }

    // Counters
    const label = `${index + 1} / ${this._cardData.length}`
    const counter = document.querySelector('.bb-viewer-counter')
    const counterPanel = document.querySelector('.bb-viewer-counter-panel')
    if (counter) counter.textContent = label
    if (counterPanel) counterPanel.textContent = label

    // Nav visibility
    const prev = document.querySelector('.bb-viewer-prev')
    const next = document.querySelector('.bb-viewer-next')
    if (prev) prev.style.visibility = index > 0 ? 'visible' : 'hidden'
    if (next) next.style.visibility = index < this._cardData.length - 1 ? 'visible' : 'hidden'

    this._updateZoomLabel()
    await this._loadPanel(data)
  }

  // --- Zoom ---

  _zoomBy(delta) {
    this._zoom = Math.max(0.1, Math.min(10, this._zoom + delta))
    const img = document.querySelector('.bb-viewer-img')
    if (img) img.style.transform = `scale(${this._zoom})`
    this._updateZoomLabel()
  }

  _resetZoom() {
    this._zoom = 1
    const img = document.querySelector('.bb-viewer-img')
    if (img) img.style.transform = `scale(1)`
    this._updateZoomLabel()
  }

  _updateZoomLabel() {
    const label = document.querySelector('.bb-tb-zoom-level')
    if (label) label.textContent = `${Math.round(this._zoom * 100)}%`
  }

  // --- Slideshow ---

  _toggleSlideshow() {
    if (this._slideshowTimer) {
      this._stopSlideshow()
    } else {
      this._startSlideshow()
    }
  }

  _startSlideshow() {
    const interval = (this.app.style && this.app.style.slideshow_interval) ? this.app.style.slideshow_interval : 3000
    const btn = document.querySelector('.bb-tb-slideshow i')
    if (btn) { btn.classList.remove('fa-play'); btn.classList.add('fa-pause') }

    this._slideshowTimer = setInterval(() => {
      if (this._currentIndex < this._cardData.length - 1) {
        this._navigate(1)
      } else {
        // Loop back to start
        this._currentIndex = -1
        this._navigate(1)
      }
    }, interval)
  }

  _stopSlideshow() {
    if (this._slideshowTimer) {
      clearInterval(this._slideshowTimer)
      this._slideshowTimer = null
    }
    const btn = document.querySelector('.bb-tb-slideshow i')
    if (btn) { btn.classList.remove('fa-pause'); btn.classList.add('fa-play') }
  }

  // --- Panel ---

  async _loadPanel(data) {
    const panelBody = document.querySelector('#bb-viewer-panel .panel-body')
    if (!panelBody) return

    let meta = {}
    try {
      meta = await this.api.getImage(data.fingerprint)
    } catch (e) {
      console.error('Failed to load metadata:', e)
    }

    panelBody.innerHTML = this._buildPanelHTML(meta)
    this._attachPanelHandlers(panelBody, meta)
  }

  _closeOverlay(silent) {
    this._stopSlideshow()
    const overlay = document.getElementById('bb-viewer-overlay')
    if (overlay) overlay.remove()
    if (this._keyHandler && !silent) {
      document.removeEventListener('keydown', this._keyHandler)
      this._keyHandler = null
    }
  }

  _togglePanel() {
    const panel = document.getElementById('bb-viewer-panel')
    if (!panel) return
    panel.classList.toggle('collapsed')
    // Update the toggle button icon
    const btn = document.querySelector('.bb-tb-panel-toggle i')
    if (btn) {
      if (panel.classList.contains('collapsed')) {
        btn.classList.remove('fa-circle-info')
        btn.classList.add('fa-circle-info')
        btn.style.opacity = '0.4'
      } else {
        btn.style.opacity = '1'
      }
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
      'controlnet_weight', 'controlnet_guidance_strength',
      'subfolder', 'file_path'
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
        await this.api.gm({
          path: "user", cmd: "set",
          args: [src, { "dc:subject": [{ val, mode: "merge" }] }]
        })
        tagInput.value = ''
        const data = this._cardData[this._currentIndex]
        if (data) await this._loadPanel(data)
      })
    }

    container.querySelectorAll('.panel-filter').forEach(el => {
      el.addEventListener('click', (e) => {
        e.stopPropagation()
        const filter = el.getAttribute('data-filter')
        if (filter) {
          this._closeOverlay()
          this.app.search(filter)
        }
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
    if (!confirm("Move this image to trash?")) return
    await this.api.deleteImages([fp])
    card.remove()
  }
}
