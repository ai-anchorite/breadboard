const debounce = (callback, wait) => {
  let timeoutId = null;
  return (...args) => {
    window.clearTimeout(timeoutId);
    timeoutId = window.setTimeout(() => {
      callback.apply(null, args);
    }, wait);
  };
}
class App {
  constructor (query, sorter_code, need_update, sync_mode, sync_folder, api) {
    this.api = api
    this.query = query
    this.sorter_code = sorter_code
    this.sync_mode = sync_mode
    this.sync_folder = sync_folder
    this.selection = new Selection(this, api)
    this.navbar = new Navbar(this);
    if (need_update) {
      this.navbar.notification(need_update)
    }
    this.handler = new Handler(this, api);
    this.zoomer = new Zoomer(this)
    if (!this.bar) {
      this.bar = new Nanobar({
        target: document.querySelector("#bar")
      });
    }
    this.domparser = new DOMParser()
    this.image_limit = 0
    this.grid_mode = 'flex'
    this.viewerPanelHidden = false
    this.showBookmarkBar = true
    this._scanning = false
    hotkeys("ctrl+t,cmd+t,ctrl+n,cmd+n", (e) => {
      window.open("/", "_blank", "popup")
    })
    this.debounced_update = debounce(this.prepend_update.bind(this), 1000)
  }

  async init_live() {
    let liveRes = await this.api.getSetting('live')
    let soundRes = await this.api.getSetting('sound')
    this.live = liveRes.val != null ? (liveRes.val === 'true' || liveRes.val === true) : true
    this.sound = soundRes.val != null ? (soundRes.val === 'true' || soundRes.val === true) : true

    if (this.live) {
      document.querySelector("#live-option i").classList.add("fa-spin")
      document.querySelector("#live-option").classList.add("bold")
      document.querySelector("#live-option").classList.add("active")
    } else {
      document.querySelector("#live-option i").classList.remove("fa-spin")
      document.querySelector("#live-option").classList.remove("bold")
      document.querySelector("#live-option").classList.remove("active")
    }

    tippy(document.querySelector("#live-option"), {
      interactive: true,
      trigger: "click",
      allowHTML: true,
      placement: "bottom-end",
      content: `<div class='menu-popup'>
      <div class='menu-item play-option'><i class="fa-solid ${this.live ? 'fa-pause' : 'fa-play'}"></i><span>${this.live ? 'pause' : 'play'}</span></div>
      <hr>
      <div class='menu-item sound-option'><i class="fa-solid ${this.sound ? 'fa-volume-xmark' : 'fa-volume-high'}"></i><span>${this.sound ? 'turn off sound' : 'turn on sound'}</span></div>
</div>`,
      onHidden: (instance) => {
        instance.popper.querySelector(".play-option").removeEventListener("click", instance.extended_handlers.liveHandler)
        instance.popper.querySelector(".sound-option").removeEventListener("click", instance.extended_handlers.soundHandler)
      },
      onShown: (instance) => {
        const liveHandler = async (e) => {
          this.live = !this.live
          await this.api.setSetting('live', this.live)
          if (this.live) {
            document.querySelector("#live-option i").classList.add("fa-spin")
            document.querySelector("#live-option").classList.add("bold")
            document.querySelector("#live-option").classList.add("active")
            instance.popper.querySelector(".play-option i").classList.remove("fa-play")
            instance.popper.querySelector(".play-option i").classList.add("fa-pause")
            instance.popper.querySelector(".play-option span").innerHTML = "pause"
          } else {
            document.querySelector("#live-option i").classList.remove("fa-spin")
            document.querySelector("#live-option").classList.remove("bold")
            document.querySelector("#live-option").classList.remove("active")
            instance.popper.querySelector(".play-option i").classList.remove("fa-pause")
            instance.popper.querySelector(".play-option i").classList.add("fa-play")
            instance.popper.querySelector(".play-option span").innerHTML = "play"
          }
          await this.subscribe()
        }
        const soundHandler = async (e) => {
          this.sound = !this.sound
          await this.api.setSetting('sound', this.sound)
          if (this.sound) {
            instance.popper.querySelector(".sound-option i").classList.remove("fa-volume-high")
            instance.popper.querySelector(".sound-option i").classList.add("fa-volume-xmark")
            instance.popper.querySelector(".sound-option span").innerHTML = "turn off sound"
          } else {
            instance.popper.querySelector(".sound-option i").classList.remove("fa-volume-xmark")
            instance.popper.querySelector(".sound-option i").classList.add("fa-volume-high")
            instance.popper.querySelector(".sound-option span").innerHTML = "turn on sound"
          }
        }
        instance.popper.querySelector(".play-option").addEventListener("click", liveHandler)
        instance.popper.querySelector(".sound-option").addEventListener("click", soundHandler)
        instance.extended_handlers = { liveHandler, soundHandler }
      }
    });
  }

  async init () {
    console.log("INIT", VERSION)

    const nav = document.querySelector('nav')
    const container = document.querySelector('.container')
    if (nav && container) {
      container.style.paddingTop = nav.offsetHeight + 'px'
    }

    this.selector = new TomSelect("nav select#sorter", {
      onDropdownClose: () => { this.selector.blur() }
    })
    if (this.api.config.agent === "electron") {
      await this.init_pin()
    }
    this.init_rpc()
    this.init_minimize()
    await this.bootstrap()
    await this.initBookmarkBar()
    document.querySelector(".search-box .search").focus()
  }

  async bootstrap () {
    await this.init_theme()
    await this.init_style()
    await this.init_zoom()
    await this.zoomer.init()

    // Determine if we need to sync
    let shouldSync = false
    if (this.sync_mode === "reindex" || this.sync_mode === "reindex_folder" || this.sync_mode === "default") {
      shouldSync = true
    }

    if (shouldSync) {
      await this.synchronize()
    } else {
      this.offset = 0
      await this.draw()
    }
    await this.navbar.view_mode()
    await this.init_live()
    await this.subscribe()
  }

  notify() {
    if (this.sound) {
      if (!this.notify_audio) {
        this.notify_audio = new Audio('pop.mp3');
      }
      this.notify_audio.play();
    }
  }

  prepend_update() {
    // Refresh the current view from the server
    // The server already indexed the new file into SQLite
    this.draw()
  }

  init_rpc() {
    this.api.listen(async (_event, value) => {
      if (value.method) {
        if (value.method === "new") {
          if (this.live) {
            // Server already indexed into SQLite — just refresh the view
            this.debounced_update()
            this.notify()
          }
        }
      } else {
        // Sync progress — server is indexing, just update the progress bar
        this.sync_counter++;
        if (this.sync_counter === value.total) {
          this.sync_complete = true
        }
        this.bar.go(100 * value.progress / value.total);
      }
    })
  }

  init_minimize() {
    document.querySelector("#minimize").addEventListener("click", async (e) => {
      e.target.closest("nav").classList.toggle("minimized")
    })
  }

  async init_pin() {
    if (this.api.config && this.api.config.agent === "electron") {
      let res = await this.api.pinned()
      this.pinned = res.pinned
      if (this.pinned) {
        document.querySelector("#pin").classList.add("active")
      } else {
        document.querySelector("#pin").classList.remove("active")
      }
      document.querySelector("#pin").addEventListener("click", async (e) => {
        await this.api.pin()
        await this.init_pin()
      }, { once: true })
    }
  }

  async init_zoom () {
    let res = await this.api.getSetting('zoom')
    if (res.val) {
      this.zoom = parseInt(res.val)
    }

    let autoHideRes = await this.api.getSetting('autohide_nav')
    this.autoHideNav = autoHideRes.val === 'true' || autoHideRes.val === true
    this.applyAutoHideNav()

    let confirmRes = await this.api.getSetting('confirm_delete')
    this.confirmDelete = confirmRes.val != null ? (confirmRes.val === 'true' || confirmRes.val === true) : true

    let limitRes = await this.api.getSetting('image_limit')
    this.image_limit = limitRes.val != null ? parseInt(limitRes.val) : 0

    let bookmarkBarRes = await this.api.getSetting('show_bookmark_bar')
    this.showBookmarkBar = bookmarkBarRes.val === 'false' || bookmarkBarRes.val === false ? false : true
    const bookmarkToggle = document.querySelector('#show-bookmark-bar')
    if (bookmarkToggle) bookmarkToggle.checked = this.showBookmarkBar

    let viewerPanelRes = await this.api.getSetting('viewer_panel_hidden')
    this.viewerPanelHidden = viewerPanelRes.val === 'true' || viewerPanelRes.val === true
  }

  // Custom themed confirm dialog — returns a Promise<boolean>
  confirm(message) {
    if (!this.confirmDelete) return Promise.resolve(true)

    return new Promise((resolve) => {
      const overlay = document.createElement('div')
      overlay.className = 'bb-confirm-overlay'
      overlay.innerHTML = `
        <div class='bb-confirm-box'>
          <div class='bb-confirm-msg'>${message}</div>
          <div class='bb-confirm-actions'>
            <button class='bb-confirm-cancel'>Cancel</button>
            <button class='bb-confirm-ok'>Delete</button>
          </div>
        </div>
      `
      document.body.appendChild(overlay)

      overlay.querySelector('.bb-confirm-cancel').addEventListener('click', () => {
        overlay.remove()
        resolve(false)
      })
      overlay.querySelector('.bb-confirm-ok').addEventListener('click', () => {
        overlay.remove()
        resolve(true)
      })
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) { overlay.remove(); resolve(false) }
      })
      // Focus the cancel button so Enter doesn't accidentally confirm
      overlay.querySelector('.bb-confirm-cancel').focus()
    })
  }

  applyAutoHideNav() {
    const nav = document.querySelector('nav')
    if (!nav) return

    if (this._navMouseLeave) {
      nav.removeEventListener('mouseleave', this._navMouseLeave)
      this._navMouseLeave = null
    }
    if (this._navTriggerMove) {
      document.removeEventListener('mousemove', this._navTriggerMove)
      this._navTriggerMove = null
    }
    if (this._navHideTimer) {
      clearTimeout(this._navHideTimer)
      this._navHideTimer = null
    }

    const existingDragZone = document.getElementById('autohide-drag-zone')
    if (existingDragZone) existingDragZone.remove()

    if (this.autoHideNav) {
      nav.classList.add('autohide')
      if (this.bookmarkBar) this.bookmarkBar.classList.add('autohide')

      const dragZone = document.createElement('div')
      dragZone.id = 'autohide-drag-zone'
      document.body.appendChild(dragZone)

      this._navTriggerMove = (e) => {
        if (e.clientY <= 8) {
          if (this._navHideTimer) {
            clearTimeout(this._navHideTimer)
            this._navHideTimer = null
          }
          nav.classList.add('force-show')
          if (this.bookmarkBar) this.bookmarkBar.classList.add('force-show')
        }
      }
      document.addEventListener('mousemove', this._navTriggerMove)

      this._navMouseLeave = () => {
        if (this._navHideTimer) clearTimeout(this._navHideTimer)
        this._navHideTimer = setTimeout(() => {
          nav.classList.remove('force-show')
          if (this.bookmarkBar) this.bookmarkBar.classList.remove('force-show')
          this._navHideTimer = null
        }, 600)
      }
      nav.addEventListener('mouseleave', this._navMouseLeave)

      nav.addEventListener('mouseenter', () => {
        if (this._navHideTimer) {
          clearTimeout(this._navHideTimer)
          this._navHideTimer = null
        }
      })

      if (this.bookmarkBar) {
        this.bookmarkBar.addEventListener('mouseenter', () => {
          if (this._navHideTimer) { clearTimeout(this._navHideTimer); this._navHideTimer = null }
          this.bookmarkBar.classList.add('force-show')
        })
        this.bookmarkBar.addEventListener('mouseleave', () => {
          if (this._navHideTimer) clearTimeout(this._navHideTimer)
          this._navHideTimer = setTimeout(() => {
            this.bookmarkBar.classList.remove('force-show')
            this._navHideTimer = null
          }, 600)
        })
      }

      const container = document.querySelector('.container')
      if (container) container.style.paddingTop = '6px'
    } else {
      nav.classList.remove('autohide')
      nav.classList.remove('force-show')
      if (this.bookmarkBar) {
        this.bookmarkBar.classList.remove('autohide')
        this.bookmarkBar.classList.remove('force-show')
      }

      const container = document.querySelector('.container')
      if (container) container.style.paddingTop = nav.offsetHeight + 'px'
    }
  }

  async init_theme () {
    let themeRes = await this.api.getSetting('theme')
    let minimalRes = await this.api.getSetting('minimal')
    this.theme = { val: themeRes.val || "default" }
    this.minimal = { val: minimalRes.val || "default" }
    document.body.className = this.theme.val
    document.body.setAttribute("data-minimal", this.minimal.val)
    document.querySelector("html").className = this.theme.val
    this.api.theme(this.theme.val)
  }

  async init_style () {
    let aspect_ratio = await this.api.getSetting('aspect_ratio')
    let fit = await this.api.getSetting('fit')
    let grid_mode = await this.api.getSetting('image_grid_mode')
    let expanded_width = await this.api.getSetting('expanded_width')
    let slideshow_interval = await this.api.getSetting('slideshow_interval')
    let recycle = await this.api.getSetting('recycle')
    this.style = {
      aspect_ratio: (aspect_ratio.val ? aspect_ratio.val : 100),
      fit: (fit.val ? fit.val : "contain"),
      expanded_width: (expanded_width.val ? expanded_width.val : 33),
      image_width: 100,
      slideshow_interval: (slideshow_interval.val ? slideshow_interval.val : 3000),
      recycle: (recycle.val != null ? (recycle.val === 'true' || recycle.val === true) : true)
    }
    this.grid_mode = (grid_mode.val ? grid_mode.val : 'flex')
    this.applyGridMode()
    this.applyCardStyle()
    document.body.style.setProperty("--expanded-width", `${this.style.expanded_width}%`)
    document.body.style.setProperty("--image-width", `${this.style.image_width}%`)
    this.api.style(this.style)
  }

  applyCardStyle() {
    const minW = Math.max(120, Math.round(200 * (this.zoom || 100) / 100))
    document.documentElement.style.setProperty('--card-width', minW + 'px')
    document.documentElement.style.setProperty('--card-aspect-ratio', String(this.style.aspect_ratio || 100))
    document.documentElement.style.setProperty('--card-fit', this.style.fit || 'contain')
  }

  applyGridMode() {
    const mode = this.grid_mode || 'flex'
    const container = document.querySelector('.container')
    if (container) container.setAttribute('data-grid', mode)
  }

  getGridPresentation() {
    return this.grid_mode === 'masonry' ? 'masonry' : (this.style.fit || 'contain')
  }

  applyGridPresentation(presentation) {
    if (presentation === 'masonry') {
      this.grid_mode = 'masonry'
    } else {
      this.grid_mode = 'flex'
      this.style.fit = presentation
    }
    this.applyGridMode()
    this.applyCardStyle()
  }

  async subscribe() {
    if (this.live) {
      let folders = await this.api.getFolders()
      await this.api.subscribe(folders.map(f => f.path))
    } else {
      await this.api.subscribe([])
    }
  }

  async synchronize (paths, cb) {
    document.querySelector("#sync").classList.add("disabled")
    document.querySelector("#sync").disabled = true
    document.querySelector("#sync i").classList.add("fa-spin")
    if (paths) {
      document.querySelector(".status").innerHTML = "synchronizing..."
      this.sync_counter = 0
      this.sync_complete = false
      await new Promise((resolve, reject) => {
        this.api.sync({ paths })
        let interval = setInterval(() => {
          if (this.sync_complete) {
            clearInterval(interval)
            resolve()
          }
        }, 1000)
      })
      if (cb) await cb()
    } else {
      let folders = await this.api.getFolders()
      if (this.sync_mode === "reindex" || this.sync_mode === "default" || this.sync_mode === "false") {
        for (let folder of folders) {
          let root_path = folder.path
          document.querySelector(".status").innerHTML = "synchronizing from " + root_path
          this.sync_counter = 0
          this.sync_complete = false
          await new Promise((resolve, reject) => {
            const config = { root_path }
            if (this.sync_mode === "reindex") {
              config.force = true
            }
            this.api.sync(config)
            let interval = setInterval(() => {
              if (this.sync_complete) {
                clearInterval(interval)
                resolve()
              }
            }, 1000)
          })
        }
      } else if (this.sync_mode === "reindex_folder" && this.sync_folder && this.sync_folder.length > 0) {
        document.querySelector(".status").innerHTML = "synchronizing from " + this.sync_folder
        this.sync_counter = 0
        this.sync_complete = false
        await new Promise((resolve, reject) => {
          this.api.sync({ root_path: this.sync_folder, force: true })
          let interval = setInterval(() => {
            if (this.sync_complete) {
              clearInterval(interval)
              resolve()
            }
          }, 1000)
        })
      }
      this.sync_counter = 0
      document.querySelector(".status").innerHTML = ""
      this.bar.go(100)
      let query = document.querySelector(".search").value
      if (query && query.length > 0) {
        await this.search(query)
      } else {
        await this.search()
      }
    }
  }

  async fill ({ count, results }) {
    let items = results
    document.querySelector(".content-info").innerHTML = `<i class="fa-solid fa-check"></i> ${count}`

    items = items.map(item => {
      let tokens = []
      if (item.prompt && typeof item.prompt === 'string') {
        tokens = this.stripPunctuation(item.prompt).split(/\s/).filter(t => t.length > 0)
      }
      if (item.tags && item.tags.length > 0) {
        for (let tag of item.tags) {
          tokens.push("tag:" + tag)
        }
      }
      return { ...item, tokens }
    })

    let data = items.map((item) => {
      const ar = item.width && item.height ? (item.width / item.height) : null
      const arStyle = ar ? `--card-ar:${ar};` : ''
      return `<div class='card' data-root="${item.root_path}" data-src="${item.file_path}" data-fingerprint="${item.fingerprint}" style='${arStyle}'>${card(item, this.stripPunctuation)}</div>`
    })

    document.querySelector(".content").innerHTML = data.join("")

    this.selection.init()
    this.zoomer.resized()
    this._updateEndMarker()
  }

  _updateEndMarker() {
    const marker = document.querySelector('.end-marker')
    if (!marker) return
    if (this.images && this.images.length > 0 && !this._scanning) {
      marker.style.display = ''
      const icon = marker.querySelector('.fa-chess-board')
      if (icon) icon.classList.remove('fa-bounce')
    } else if ((!this.images || this.images.length === 0) && !this._scanning) {
      marker.style.display = 'none'
    } else {
      marker.style.display = ''
    }
  }

  async draw () {
    document.querySelector(".search").value = (this.query && this.query.length ? this.query : "")

    if (this.query) {
      let favorites = await this.api.getFavorites()
      let favorited = favorites.find(f => f.query === this.query)
      if (favorited) {
        document.querySelector("nav #favorite").classList.add("selected")
        document.querySelector("nav #favorite i").className = "fa-solid fa-star"
      } else {
        document.querySelector("nav #favorite").classList.remove("selected")
        document.querySelector("nav #favorite i").className = "fa-regular fa-star"
      }
    } else {
      document.querySelector("nav #favorite").classList.remove("selected")
      document.querySelector("nav #favorite i").className = "fa-regular fa-star"
    }

    const result = await this.api.searchImages(this.query || '', {
      sort: this.navbar.sorter.column,
      direction: this.navbar.sorter.direction,
      offset: 0,
      limit: this.image_limit || 50000
    })

    this.images = result.results
    if (result.results.length > 0) {
      await this.fill(result)
      document.querySelector("#sync").classList.remove("disabled")
      document.querySelector("#sync").disabled = false
      document.querySelector("#sync i").classList.remove("fa-spin")
    } else {
      this.images = []
      await this.fill(result)
      if (!this.query) {
        document.querySelector(".content").innerHTML = `<div class='video-empty'><i class="fa-solid fa-image"></i><h2>No images loaded</h2><p>Click the <i class="fa-solid fa-folder-open"></i> folder icon to connect an image folder</p></div>`
        this._updateEndMarker()
      }
    }

    await this.refreshBookmarkBar()
  }

  async search (query, options) {
    let params = new URLSearchParams({ sorter_code: this.sorter_code })
    if (query && query.length > 0) {
      params.set("query", query)
    }
    let newWin = hotkeys.isPressed("ctrl") || hotkeys.isPressed("cmd")
    if (newWin) {
      window.open("/?" + params.toString(), "_blank", "popup")
    } else {
      location.href = "/?" + params.toString()
    }
  }

  // =============================================
  // Bookmark Bar
  // =============================================

  async initBookmarkBar() {
    this.bookmarkBar = document.querySelector('#bookmark-bar')
    if (!this.bookmarkBar) return

    document.querySelector('#show-bookmark-bar')?.addEventListener('change', async (e) => {
      await this.api.setSetting('show_bookmark_bar', e.target.checked)
      this.showBookmarkBar = e.target.checked
      if (e.target.checked) { await this.refreshBookmarkBar() }
      else { this.bookmarkBar.classList.add('hidden'); this.closeBookmarkMenu() }
    })

    await this.refreshBookmarkBar()
  }

  async refreshBookmarkBar() {
    if (!this.bookmarkBar) return

    const nav = document.querySelector('nav')
    if (nav) {
      const navHeight = nav.offsetHeight
      this.bookmarkBar.style.top = `${navHeight}px`
    }

    if (!this.showBookmarkBar) {
      this.bookmarkBar.classList.add('hidden')
      this.closeBookmarkMenu()
      return
    }

    try {
      const folders = await this.api.getImageFolderBookmarks()

      if (!folders || folders.length === 0) {
        this.bookmarkBar.classList.add('hidden')
        this.closeBookmarkMenu()
        return
      }

      this.bookmarkBar.classList.remove('hidden')

      const chips = folders.map((folder, index) => {
        const rootQuery = `root_path:${this.quoteQueryValue(folder.path)}`
        const isActive = this.query && this.query.includes(rootQuery)
        const name = this.escapeHTML(folder.name || folder.path)
        const path = this.escapeHTML(folder.path)
        const subCount = Array.isArray(folder.subfolders) ? folder.subfolders.length : 0
        const menuHint = subCount > 0 ? 'Right-click for subfolders' : 'No indexed subfolders'
        return `<div class='bookmark-chip bookmark-folder-chip ${isActive ? 'active' : ''}' data-folder-index='${index}' title='${path} (${folder.count || 0} images). ${menuHint}'>
          <i class="fa-solid fa-folder"></i>
          <span>${name}</span>
          <span class='count'>(${folder.count || 0})</span>
          ${subCount > 0 ? `<i class="fa-solid fa-caret-down bookmark-menu-caret"></i>` : ''}
        </div>`
      }).join('')

      const allActive = !this.query || (!this.query.includes('subfolder:') && !this.query.includes('root_path:'))
      const allChip = `<div class='bookmark-chip ${allActive ? 'active' : ''}' data-subfolder='__all__' title='Show all images'>
        <i class="fa-solid fa-image"></i>
        <span>All Images</span>
      </div>`

      this.bookmarkBar.innerHTML = allChip + chips
      this._bookmarkFolders = folders

      this.bookmarkBar.querySelectorAll('.bookmark-chip').forEach(chip => {
        chip.addEventListener('click', (e) => {
          e.preventDefault()
          const subfolder = chip.dataset.subfolder

          if (subfolder === '__all__') {
            this.query = ''
            const searchInput = document.querySelector('.search')
            if (searchInput) searchInput.value = ''
          } else {
            const folder = this._bookmarkFolders?.[parseInt(chip.dataset.folderIndex, 10)]
            if (!folder) return
            this.query = `root_path:${this.quoteQueryValue(folder.path)}`
            const searchInput = document.querySelector('.search')
            if (searchInput) searchInput.value = this.query
          }

          this.closeBookmarkMenu()
          this.draw()
        })
        chip.addEventListener('contextmenu', (e) => {
          if (!chip.classList.contains('bookmark-folder-chip')) return
          e.preventDefault()
          const folder = this._bookmarkFolders?.[parseInt(chip.dataset.folderIndex, 10)]
          if (folder) this.openBookmarkMenu(folder, chip)
        })
      })
    } catch (e) {
      console.error('Error loading bookmarks:', e)
      this.bookmarkBar.classList.add('hidden')
    }
  }

  openBookmarkMenu(folder, chip) {
    this.closeBookmarkMenu()
    const subfolders = Array.isArray(folder.subfolders) ? folder.subfolders : []
    if (subfolders.length === 0) return

    const rect = chip.getBoundingClientRect()
    const menu = document.createElement('div')
    menu.className = 'bookmark-folder-menu'
    menu.style.left = `${Math.max(8, rect.left)}px`
    menu.style.top = `${rect.bottom + 6}px`
    menu.innerHTML = subfolders.map((sf) => {
      const leaf = this.escapeHTML(sf.subfolder.split(/[/\\]/).pop() || sf.subfolder)
      const full = this.escapeHTML(sf.subfolder)
      return `<button class='bookmark-folder-menu-item' data-subfolder='${full}' title='${full}'>
        <i class="fa-regular fa-folder"></i>
        <span>${leaf}</span>
        <span class='count'>${sf.count}</span>
      </button>`
    }).join('')

    menu.querySelectorAll('.bookmark-folder-menu-item').forEach(item => {
      item.addEventListener('click', () => {
        const subfolder = item.dataset.subfolder
        this.query = `root_path:${this.quoteQueryValue(folder.path)} subfolder:${this.quoteQueryValue(subfolder)}`
        const searchInput = document.querySelector('.search')
        if (searchInput) searchInput.value = this.query
        this.closeBookmarkMenu()
        this.draw()
      })
    })

    document.body.appendChild(menu)
    this._bookmarkMenu = menu
    this._bookmarkMenuCloser = (e) => {
      if (this._bookmarkMenu && !this._bookmarkMenu.contains(e.target)) this.closeBookmarkMenu()
    }
    setTimeout(() => document.addEventListener('mousedown', this._bookmarkMenuCloser), 0)
  }

  closeBookmarkMenu() {
    if (this._bookmarkMenuCloser) {
      document.removeEventListener('mousedown', this._bookmarkMenuCloser)
      this._bookmarkMenuCloser = null
    }
    if (this._bookmarkMenu) {
      this._bookmarkMenu.remove()
      this._bookmarkMenu = null
    }
  }

  // --- Utilities ---

  quoteQueryValue(val) {
    const str = typeof val === 'string' ? val : String(val)
    if (/\s/.test(str)) return `"${str}"`
    return str
  }

  escapeHTML(str) {
    const el = document.createElement('div')
    el.textContent = str
    return el.innerHTML
  }

  stripPunctuation (str) {
    return str
      .replaceAll("&quot;", " ")
      .replace(/[.,\/#!$%\^&\*;:\[\]{}=\-_`"~()\\\|+]/g, " ")
      .replace(/\s{2,}/g, " ");
  }
}

let QUERY
if (document.querySelector("#query")) {
  QUERY = document.querySelector("#query").getAttribute("data-value")
}

const api = new API({ agent: AGENT });
const app = new App(QUERY, SORTER, NEED_UPDATE, SYNC_MODE, SYNC_FOLDER, api);
(async () => {
  await app.init()
})();
