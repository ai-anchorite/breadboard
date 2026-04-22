class Navbar {
  constructor(app) {
    this.app = app
    this.sorters = [
      { direction: -1, column: "btime", compare: 0 },
      { direction: 1, column: "btime", compare: 0 },
      { direction: -1, column: "mtime", compare: 0 },
      { direction: 1, column: "mtime", compare: 0 },
      { direction: 1, column: "prompt", compare: 1 },
      { direction: -1, column: "prompt", compare: 1 },
      { direction: -1, column: "width", compare: 0 },
      { direction: 1, column: "width", compare: 0 },
      { direction: -1, column: "height", compare: 0 },
      { direction: 1, column: "height", compare: 0 },
      { direction: -1, column: "aesthetic_score", compare: 0 },
      { direction: 1, column: "aesthetic_score", compare: 0 },
    ]
    this.sorter = this.sorters[this.app.sorter_code]
    this.sorter_code = parseInt(this.app.sorter_code)

    // --- Nav button events ---
    document.querySelector("#new-window").addEventListener("click", () => window.open("/", "_blank", "popup"))
    document.querySelector("#prev").addEventListener("click", () => history.back())
    document.querySelector("#next").addEventListener("click", () => history.forward())

    document.querySelector("#favorite").addEventListener("click", async () => {
      let query = document.querySelector(".search").value
      if (!query || !query.length) return
      let favorites = await this.app.api.getFavorites()
      let exists = favorites.find(f => f.query === query)
      if (exists) {
        await this.app.api.removeFavorite(exists.id)
        document.querySelector("nav #favorite").classList.remove("selected")
        document.querySelector("nav #favorite i").className = "fa-regular fa-star"
      } else {
        await this.app.api.addFavorite(query, null, false)
        document.querySelector("nav #favorite").classList.add("selected")
        document.querySelector("nav #favorite i").className = "fa-solid fa-star"
      }
    })

    document.querySelector("nav select#sorter").addEventListener("change", async (e) => {
      this.sorter_code = parseInt(e.target.value)
      this.app.sorter_code = this.sorter_code
      this.sorter = this.sorters[this.sorter_code]
      let query = document.querySelector(".search").value
      await this.app.search(query && query.length > 0 ? query : undefined)
    })

    document.querySelector("#sync").addEventListener('click', async () => await this.app.synchronize())
    document.querySelector(".search").addEventListener("keyup", (e) => {
      if (e.key === "Enter") this.app.search(e.target.value)
    })
    document.querySelector("#show-menu").addEventListener('click', () => {
      document.querySelectorAll(".nav-child").forEach(el => el.classList.toggle("shown"))
    })

    // Settings sidebar toggle
    document.querySelector("#settings-option").addEventListener("click", () => this.toggleSettings())

    // Tooltips
    let buttons = ["#prev", "#next", "#sync", ".content-info", "#favorite", "#bookmarked-filters", "#favorited-items", "#folder-option", "#live-option", "#pin", "#notification", "#settings-option", "#help-option", "#new-window"]
    for (let sel of buttons) {
      let el = document.querySelector(sel)
      if (el) {
        tippy(el, { placement: "bottom-end", interactive: true, content: el.getAttribute("title") })
      }
    }
  }

  // =============================================
  // Settings Sidebar (slide-out from right)
  // =============================================

  async toggleSettings() {
    const sidebar = document.getElementById('settings-sidebar')
    if (!sidebar) return
    if (sidebar.classList.contains('hidden')) {
      // Position between nav and footer — overlap by 1px to eliminate gap
      const nav = document.querySelector('nav')
      const footer = document.querySelector('footer')
      const navH = nav ? nav.offsetHeight - 1 : 0
      const footerH = (footer && !footer.classList.contains('hidden')) ? footer.offsetHeight : 0
      sidebar.style.top = navH + 'px'
      sidebar.style.height = `calc(100vh - ${navH}px - ${footerH}px)`

      await this.renderSettings(sidebar)
      sidebar.classList.remove('hidden')
    } else {
      sidebar.classList.add('hidden')
    }
  }

  async renderSettings(sidebar) {
    const zoom = this.app.zoom || 100
    const style = this.app.style || {}
    const aspect = style.aspect_ratio || 100
    const fit = style.fit || 'contain'
    const expWidth = style.expanded_width || 33
    const ssInterval = style.slideshow_interval || 3000
    const minimal = this.app.minimal ? this.app.minimal.val : 'default'
    const theme = this.app.theme ? this.app.theme.val : 'default'

    sidebar.innerHTML = `
      <div class='sb-header'>
        <h3><i class="fa-solid fa-gear"></i> Settings</h3>
        <button class='sb-close' title='Close'><i class="fa-solid fa-xmark"></i></button>
      </div>
      <div class='sb-body'>

        <div class='sb-section'>
          <h4><i class="fa-solid fa-palette"></i> Theme</h4>
          <div class='sb-row sb-theme-row'>
            <button class='sb-btn ${theme === "dark" ? "active" : ""}' data-theme='dark'><i class="fa-solid fa-moon"></i> Dark</button>
            <button class='sb-btn ${theme === "default" ? "active" : ""}' data-theme='default'><i class="fa-regular fa-sun"></i> Light</button>
          </div>
        </div>

        <div class='sb-section'>
          <h4><i class="fa-solid fa-eye-slash"></i> Auto-hide Nav</h4>
          <div class='sb-row'>
            <label><input type='checkbox' id='sb-autohide-nav' ${this.app.autoHideNav ? 'checked' : ''}> Hide nav bar until hover</label>
          </div>
        </div>

        <div class='sb-section'>
          <h4><i class="fa-solid fa-id-card"></i> Card Header</h4>
          <div class='sb-row sb-minimal-row'>
            <label><input type='radio' name='sb-minimal' value='default' ${minimal === 'default' ? 'checked' : ''}> Always</label>
            <label><input type='radio' name='sb-minimal' value='minimal' ${minimal === 'minimal' ? 'checked' : ''}> On hover</label>
            <label><input type='radio' name='sb-minimal' value='none' ${minimal === 'none' ? 'checked' : ''}> Hidden</label>
          </div>
        </div>

        <div class='sb-section'>
          <h4><i class="fa-solid fa-magnifying-glass"></i> Card Size</h4>
          <div class='sb-row'>
            <span class='sb-label'>Zoom <span class='sb-val' id='sb-zoom-val'>${zoom}%</span></span>
            <input type='range' id='sb-zoom' min='20' max='600' value='${zoom}' step='1'>
          </div>
          <div class='sb-row'>
            <span class='sb-label'>Aspect ratio <span class='sb-val' id='sb-aspect-val'>${aspect}%</span></span>
            <input type='range' id='sb-aspect' min='20' max='300' value='${aspect}' step='1'>
          </div>
          <div class='sb-row sb-fit-row'>
            <label><input type='radio' name='sb-fit' value='contain' ${fit === 'contain' ? 'checked' : ''}> Contain</label>
            <label><input type='radio' name='sb-fit' value='cover' ${fit === 'cover' ? 'checked' : ''}> Cover</label>
            <label><input type='radio' name='sb-fit' value='stretch' ${fit === 'stretch' ? 'checked' : ''}> Stretch</label>
          </div>
        </div>

        <div class='sb-section'>
          <h4><i class="fa-solid fa-play"></i> Slideshow</h4>
          <div class='sb-row'>
            <span class='sb-label'>Interval <span class='sb-val' id='sb-ss-val'>${ssInterval / 1000}s</span></span>
            <input type='range' id='sb-slideshow' min='1' max='10' value='${ssInterval / 1000}' step='0.5'>
          </div>
        </div>

        <div class='sb-section'>
          <h4><i class="fa-solid fa-rotate"></i> Re-index</h4>
          <button class='sb-btn sb-reindex'><i class="fa-solid fa-rotate"></i> Re-index from Scratch</button>
        </div>

        ${AGENT === 'electron' ? `
        <div class='sb-section'>
          <h4><i class="fa-solid fa-terminal"></i> Debug</h4>
          <button class='sb-btn sb-debug'><i class="fa-solid fa-terminal"></i> Open DevTools</button>
        </div>
        ` : ''}

        <div class='sb-section sb-version'>
          <span>Breadboard v${VERSION}</span>
        </div>

        <div class='sb-section sb-bottom-close'>
          <button class='sb-btn sb-close-bottom'><i class="fa-solid fa-xmark"></i> Close Settings</button>
        </div>
      </div>
    `

    // --- Wire up events ---
    sidebar.querySelector('.sb-close').addEventListener('click', () => this.toggleSettings())
    sidebar.querySelector('.sb-close-bottom').addEventListener('click', () => this.toggleSettings())

    // Theme
    sidebar.querySelectorAll('.sb-theme-row button').forEach(btn => {
      btn.addEventListener('click', async () => {
        await this.app.api.setSetting('theme', btn.dataset.theme)
        await this.app.init_theme()
        sidebar.querySelectorAll('.sb-theme-row button').forEach(b => b.classList.remove('active'))
        btn.classList.add('active')
      })
    })

    // Auto-hide nav
    const autoHideCheck = sidebar.querySelector('#sb-autohide-nav')
    if (autoHideCheck) {
      autoHideCheck.addEventListener('change', async () => {
        this.app.autoHideNav = autoHideCheck.checked
        await this.app.api.setSetting('autohide_nav', autoHideCheck.checked)
        this.app.applyAutoHideNav()
      })
    }

    // Card header
    sidebar.querySelectorAll('[name=sb-minimal]').forEach(el => {
      el.addEventListener('change', async () => {
        await this.app.api.setSetting('minimal', el.value)
        await this.app.init_theme()
      })
    })

    // Zoom
    sidebar.querySelector('#sb-zoom').addEventListener('input', async (e) => {
      const val = parseInt(e.target.value)
      sidebar.querySelector('#sb-zoom-val').textContent = val + '%'
      await this.app.api.setSetting('zoom', val)
      this.app.zoom = val
      this.app.zoomer.resized()
    })

    // Aspect ratio
    sidebar.querySelector('#sb-aspect').addEventListener('input', async (e) => {
      const val = parseInt(e.target.value)
      sidebar.querySelector('#sb-aspect-val').textContent = val + '%'
      await this.app.api.setSetting('aspect_ratio', val)
      await this.app.init_style()
    })

    // Fit mode
    sidebar.querySelectorAll('[name=sb-fit]').forEach(el => {
      el.addEventListener('change', async () => {
        await this.app.api.setSetting('fit', el.value)
        await this.app.init_style()
      })
    })

    // Slideshow interval
    sidebar.querySelector('#sb-slideshow').addEventListener('input', async (e) => {
      const val = parseFloat(e.target.value) * 1000
      sidebar.querySelector('#sb-ss-val').textContent = e.target.value + 's'
      await this.app.api.setSetting('slideshow_interval', val)
      await this.app.init_style()
    })

    // Re-index
    sidebar.querySelector('.sb-reindex').addEventListener('click', () => {
      location.href = "/?synchronize=reindex"
    })

    // Debug
    const debugBtn = sidebar.querySelector('.sb-debug')
    if (debugBtn) {
      debugBtn.addEventListener('click', () => this.app.api.debug())
    }
  }

  // =============================================
  // Folder Management Panel (dropdown from nav)
  // =============================================

  folder_panel() {
    const btn = document.querySelector("#folder-option")
    if (!btn) return

    tippy(btn, {
      interactive: true,
      placement: "bottom-end",
      trigger: 'click',
      maxWidth: 500,
      allowHTML: true,
      onShow: async (instance) => {
        const folders = await this.app.api.getFolders()
        let rows = ''
        if (folders.length > 0) {
          rows = folders.map(f => `
            <div class='fp-row'>
              <span class='fp-path'>${f.path}</span>
              <button class='fp-btn fp-reindex' data-path='${f.path}' title='Re-index'><i class="fa-solid fa-rotate"></i></button>
              <button class='fp-btn fp-disconnect' data-path='${f.path}' title='Disconnect'><i class="fa-solid fa-xmark"></i></button>
            </div>
          `).join('')
        } else {
          rows = `<div class='fp-empty'>No folders connected</div>`
        }

        instance.setContent(`
          <div class='folder-panel'>
            <div class='fp-header'>
              <h4><i class="fa-solid fa-folder-open"></i> Connected Folders</h4>
            </div>
            <div class='fp-list'>${rows}</div>
            <div class='fp-actions'>
              <button class='fp-btn fp-connect'><i class="fa-solid fa-folder-plus"></i> Connect a folder</button>
            </div>
          </div>
        `)

        // Wire events after content is set
        setTimeout(() => {
          const popper = instance.popper

          // Connect folder
          const connectBtn = popper.querySelector('.fp-connect')
          if (connectBtn) {
            connectBtn.addEventListener('click', async () => {
              const paths = await this.app.api.select()
              if (paths && paths.length > 0) {
                for (const p of paths) {
                  await this.app.api.addFolder(p)
                }
                instance.hide()
                // Trigger sync for new folders
                location.href = "/?synchronize=default"
              }
            })
          }

          // Disconnect
          popper.querySelectorAll('.fp-disconnect').forEach(btn => {
            btn.addEventListener('click', async () => {
              const folderPath = btn.dataset.path
              if (confirm(`Disconnect "${folderPath}"?`)) {
                await this.app.api.removeFolder(folderPath)
                instance.hide()
                await this.app.draw()
              }
            })
          })

          // Re-index per folder
          popper.querySelectorAll('.fp-reindex').forEach(btn => {
            btn.addEventListener('click', () => {
              const folderPath = btn.dataset.path
              instance.hide()
              location.href = "/?synchronize=reindex_folder&sync_folder=" + encodeURIComponent(folderPath)
            })
          })
        }, 0)
      },
    })
  }

  // =============================================
  // Hyperfilter input (used by handler.js)
  // =============================================

  preprocess_query(phrase) {
    let complex_re = /(-?(file_path|tag)?:?)?"([^"]+)"/g
    let complex_re2 = /-?(file_path|tag)?:?"([^"]+)"/
    let mn_re = /model_name:"([^"]+)"/g
    let agent_re = /agent:"([^"]+)"/g

    let mn_placeholder = "model_name:" + Date.now()
    let agent_placeholder = "agent:" + Date.now()

    let mn_test = mn_re.exec(phrase)
    let mn_captured
    if (mn_test && mn_test.length > 1) {
      phrase = phrase.replace(mn_re, mn_placeholder)
      mn_captured = mn_test[1]
    }

    let agent_test = agent_re.exec(phrase)
    let agent_captured
    if (agent_test && agent_test.length > 1) {
      phrase = phrase.replace(agent_re, agent_placeholder)
      agent_captured = agent_test[1]
    }

    let complex_captured = {}
    let to_replace = []
    while (true) {
      let test = complex_re.exec(phrase)
      if (test) {
        let captured = test[3]
        let placeholder = test[1] + Math.floor(Math.random() * 100000)
        to_replace.push(placeholder)
        complex_captured[placeholder] = captured
      } else break
    }
    for (let placeholder of to_replace) {
      phrase = phrase.replace(complex_re2, placeholder)
    }

    let prefixes = phrase.split(" ").filter(x => x && x.length > 0)
    const converted = []
    for (let prefix of prefixes) {
      if (prefix.startsWith("model_name:") && mn_captured) {
        converted.push("model_name:" + prefix.replace(/model_name:[0-9]+/, mn_captured))
      } else if (prefix.startsWith("agent:") && agent_captured) {
        converted.push("agent:" + prefix.replace(/agent:[0-9]+/, agent_captured))
      } else if (complex_captured[prefix]) {
        let key = prefix.match(/^[^:]+:/)?.[0] || ''
        converted.push(key + complex_captured[prefix])
      } else {
        converted.push(prefix)
      }
    }
    return converted
  }

  input(key, val) {
    let query = document.querySelector(".search").value
    let t = this.preprocess_query(query)
    let existingPromptTokens = []
    let existingAdvancedTokens = []

    for (let token of t) {
      if (/[^:]+:/.test(token)) existingAdvancedTokens.push(token)
      else existingPromptTokens.push(token)
    }

    let existingPrompts = JSON.stringify(existingPromptTokens)
    let existingAdvanced = JSON.stringify(existingAdvancedTokens)

    if (key === "prompt" || key === "-prompt") {
      let istag = /^-?tag:/.test(val)
      let cleaned = istag ? val : this.app.stripPunctuation(val)
      if (key === "-prompt") {
        existingPromptTokens.push(istag ? cleaned : "-:" + cleaned)
      } else {
        existingPromptTokens.push(cleaned)
      }
    } else {
      let exists = false
      for (let i = 0; i < existingAdvancedTokens.length; i++) {
        if (existingAdvancedTokens[i].startsWith(key + ":")) {
          existingAdvancedTokens[i] = key + ":" + val
          exists = true
        }
      }
      if (!exists) existingAdvancedTokens.push(key + ":" + val)
    }

    if (existingPrompts !== JSON.stringify(existingPromptTokens) || existingAdvanced !== JSON.stringify(existingAdvancedTokens)) {
      let newQuery = [...existingPromptTokens, ...existingAdvancedTokens].join(" ")
      this.app.search(newQuery)
    }
  }

  notification(value) {
    let el = document.querySelector("#notification")
    if (!el) return
    el.classList.remove("hidden")
    tippy(el, {
      interactive: true,
      placement: "bottom-end",
      trigger: 'click',
      maxWidth: 500,
      content: `<div class='notification-popup'>
  <div><a href='${value.$url}' id='get-update' target="_blank">Get update</a></div>
  <h2>${value.latest.title}</h2>
  <div>${value.latest.content}</div>
</div>`,
      allowHTML: true,
    })
  }

  // Called from app.js bootstrap
  async view_mode() {
    this.folder_panel()
  }
}
