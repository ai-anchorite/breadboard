class Handler {
  constructor(app, api) {
    this.app = app
    this.api = api
    this.viewer = null
    this.viewerContainer = null

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

  // --- Custom fullscreen viewer with integrated info panel ---

  _openViewer(selectedCard) {
    const allCards = Array.from(document.querySelectorAll('.content .card'))
    const selectedIndex = allCards.indexOf(selectedCard)

    // Collect card data
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

    // Build the overlay
    this._buildOverlay()
    this._showImage(this._currentIndex)

    // Keyboard navigation
    this._keyHandler = (e) => {
      if (e.key === 'Escape') this._closeOverlay()
      else if (e.key === 'ArrowLeft') this._navigate(-1)
      else if (e.key === 'ArrowRight') this._navigate(1)
    }
    document.addEventListener('keydown', this._keyHandler)
  }

  _buildOverlay() {
    // Remove existing
    this._closeOverlay(true)

    const overlay = document.createElement('div')
    overlay.id = 'bb-viewer-overlay'
    overlay.innerHTML = `
      <div class='bb-viewer-image-area'>
        <button class='bb-viewer-nav bb-viewer-prev' title='Previous'><i class="fa-solid fa-chevron-left"></i></button>
        <div class='bb-viewer-img-wrap'>
          <img class='bb-viewer-img' src='' alt=''>
        </div>
        <button class='bb-viewer-nav bb-viewer-next' title='Next'><i class="fa-solid fa-chevron-right"></i></button>
      </div>
      <div class='bb-viewer-panel' id='bb-viewer-panel'>
        <div class='panel-header'>
          <span>Image Info</span>
          <span class='bb-viewer-counter'></span>
        </div>
        <div class='panel-body'></div>
      </div>
    `
    document.body.appendChild(overlay)

    // Event handlers
    overlay.querySelector('.bb-viewer-prev').addEventListener('click', (e) => {
      e.stopPropagation()
      this._navigate(-1)
    })
    overlay.querySelector('.bb-viewer-next').addEventListener('click', (e) => {
      e.stopPropagation()
      this._navigate(1)
    })

    // Click on image area background closes viewer
    overlay.querySelector('.bb-viewer-image-area').addEventListener('click', (e) => {
      // Only close if clicking the background, not the image or nav buttons
      if (e.target.classList.contains('bb-viewer-image-area') || e.target.classList.contains('bb-viewer-img-wrap')) {
        this._closeOverlay()
      }
    })

    // Clicks inside the panel do NOT close the viewer
    overlay.querySelector('.bb-viewer-panel').addEventListener('click', (e) => {
      e.stopPropagation()
    })
  }

  _navigate(direction) {
    const newIndex = this._currentIndex + direction
    if (newIndex >= 0 && newIndex < this._cardData.length) {
      this._currentIndex = newIndex
      this._showImage(newIndex)
    }
  }

  async _showImage(index) {
    const data = this._cardData[index]
    if (!data) return

    const img = document.querySelector('.bb-viewer-img')
    if (img) {
      img.src = data.imgSrc
    }

    // Update counter
    const counter = document.querySelector('.bb-viewer-counter')
    if (counter) {
      counter.textContent = `${index + 1} / ${this._cardData.length}`
    }

    // Update nav button visibility
    const prev = document.querySelector('.bb-viewer-prev')
    const next = document.querySelector('.bb-viewer-next')
    if (prev) prev.style.visibility = index > 0 ? 'visible' : 'hidden'
    if (next) next.style.visibility = index < this._cardData.length - 1 ? 'visible' : 'hidden'

    // Load metadata into panel
    await this._loadPanel(data)
  }

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
    const overlay = document.getElementById('bb-viewer-overlay')
    if (overlay) overlay.remove()
    if (this._keyHandler && !silent) {
      document.removeEventListener('keydown', this._keyHandler)
      this._keyHandler = null
    }
  }

  // --- Panel content ---

  _buildPanelHTML(meta) {
    // Tags
    let tagsHTML = ''
    if (meta.tags && meta.tags.length > 0) {
      tagsHTML = meta.tags.map(t =>
        `<span class='panel-tag panel-filter' data-filter='tag:${t}'><i class="fa-solid fa-tag"></i> ${t}</span>`
      ).join('')
    }

    // Prompt with clickable tokens
    let promptHTML = ''
    if (meta.prompt) {
      const words = meta.prompt.split(/\s+/).filter(w => w.length > 0)
      const tokenized = words.map(w => `<span class='panel-token panel-filter' data-filter='${w}'>${w}</span>`).join(' ')
      promptHTML = `<div class='panel-prompt'>${tokenized}</div>`
    }

    // Metadata rows with clickable values (hyperfilters)
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
          // Split path into clickable segments
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
    // Copy prompt
    const copyBtn = container.querySelector('.panel-copy-prompt')
    if (copyBtn) {
      copyBtn.addEventListener('click', (e) => {
        e.stopPropagation()
        this.api.copy(copyBtn.getAttribute('data-value'))
        copyBtn.innerHTML = '<i class="fa-solid fa-check"></i> Copied'
        setTimeout(() => {
          copyBtn.innerHTML = '<i class="fa-regular fa-clone"></i> Copy Prompt'
        }, 2000)
      })
    }

    // Tag input
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
        // Reload panel
        const data = this._cardData[this._currentIndex]
        if (data) await this._loadPanel(data)
      })
    }

    // Clickable filters (hyperfilters) — navigate to search
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
      await this.api.gm({
        path: "user", cmd: "set",
        args: [src, { "dc:subject": [{ val: "favorite", mode: "delete" }] }]
      })
    } else {
      if (fp) await this.api.addImageTags([fp], ['favorite'])
      await this.api.gm({
        path: "user", cmd: "set",
        args: [src, { "dc:subject": [{ val: "favorite", mode: "merge" }] }]
      })
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
