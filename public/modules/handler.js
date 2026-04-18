class Handler {
  view(selectedCard) {
    // Get all cards currently displayed in the content area
    const allCards = Array.from(document.querySelectorAll('.content .card'));
    const selectedIndex = allCards.indexOf(selectedCard);
    
    // Create a container with all images for the viewer
    const container = document.createElement('div');
    container.style.display = 'none';
    allCards.forEach(card => {
      const img = card.querySelector('img');
      if (img) {
        const clonedImg = img.cloneNode();
        container.appendChild(clonedImg);
      }
    });
    document.body.appendChild(container);
    
    if (this.viewer) this.viewer.destroy();
    let self = this;
    this.viewer = new Viewer(container, {
      inline: false,
      initialViewIndex: selectedIndex >= 0 ? selectedIndex : 0,
      transition: false,
      interval: this.app.style.slideshow_interval,  // Use setting from app
      toolbar: {
        'zoomIn': true,
        'zoomOut': true,
        'reset': true,
        'prev': true,
        'play': true,
        'next': true,
        'oneToOne': true,
        'rotateLeft': true,
        'rotateRight': true,
        'flipHorizontal': true,
        'flipVertical': true
      },
      zoomed(e) {
        self.zoomRatio = e.detail.ratio
      },
      viewed() {
        // Reset zoom ratio for auto-fit on each image
        self.zoomRatio = null;
        
        const img = self.viewer.image;
        if (img && img.naturalWidth && img.naturalHeight) {
          // Account for toolbar (50px) and navbar (50px) in height calculation
          const availableHeight = window.innerHeight - 100;
          const scaleFactor = Math.min(
            window.innerWidth / img.naturalWidth, 
            availableHeight / img.naturalHeight
          );
          self.viewer.zoomTo(scaleFactor);
        }
      },
      hidden() {
        this.viewer.destroy();
        // Clean up the container
        if (container.parentNode) {
          container.parentNode.removeChild(container);
        }
      }
    });
    this.viewer.show()
  }
  unview() {
    this.viewer.destroy()
  }
  constructor (app, api) {
    this.app = app
    this.api = api

    document.querySelector(".container").addEventListener("click", async (e) => {
      e.preventDefault()
      e.stopPropagation()
      let colTarget = (e.target.classList.contains(".col") ? e.target : e.target.closest(".col"))
      let fullscreenTarget = (e.target.classList.contains(".gofullscreen") ? e.target : e.target.closest(".gofullscreen"))
      let popupTarget = (e.target.classList.contains(".popup") ? e.target : e.target.closest(".popup"))
      let clipboardTarget = (e.target.classList.contains(".copy-text") ? e.target : e.target.closest(".copy-text")) || (e.target.classList.contains(".copy-prompt-btn") ? e.target : e.target.closest(".copy-prompt-btn"))
      let tokenTarget = (e.target.classList.contains(".token") ? e.target : e.target.closest(".token"))
      let tokenPopupTarget = (e.target.classList.contains(".popup-link") ? e.target : e.target.closest(".popup-link"))
      let grabTarget = (e.target.classList.contains(".grab") ? e.target : e.target.closest(".grab"))
      let openFileTarget = (e.target.classList.contains(".open-file") ? e.target : e.target.closest(".open-file"))
      let favoriteFileTarget = (e.target.classList.contains(".favorite-file") ? e.target : e.target.closest(".favorite-file"))
      let clearTagsTarget = (e.target.classList.contains(".clear-tags-btn") ? e.target : e.target.closest(".clear-tags-btn"))
      let card = (e.target.classList.contains("card") ? e.target : e.target.closest(".card"))
      if (card) card.classList.remove("fullscreen")
      if (fullscreenTarget) {
        //let img = fullscreenTarget.closest(".card").querySelector("img").cloneNode()
        //let img = fullscreenTarget.closest(".card").querySelector("img")
        let selectedCard = fullscreenTarget.closest(".card")
        this.view(selectedCard)
      } else if (openFileTarget) {
        this.api.open(openFileTarget.getAttribute("data-src"))
      } else if (popupTarget) {
        const url = popupTarget.getAttribute("data-src")
        const query = document.querySelector(".search").value
        const fullUrl = query ? `${url}&query=${encodeURIComponent(query)}` : url
        window.open(fullUrl, "_blank", "popup,width=512")
      } else if (favoriteFileTarget) {
        let data_favorited = favoriteFileTarget.getAttribute("data-favorited")
        let is_favorited = (data_favorited === "true" ? true : false)
        let src = favoriteFileTarget.getAttribute("data-src")
        let root = favoriteFileTarget.closest(".card").querySelector("img").getAttribute("data-root")
        
        if (is_favorited) {
          // unfavorite
          await this.api.gm({
            path: "user",
            cmd: "set",
            args: [
              src,
              {
                "dc:subject": [{
                  val: "favorite",
                  mode: "delete"
                }]
              }
            ]
          })
        } else {
          // favorite
          await this.api.gm({
            path: "user",
            cmd: "set",
            args: [
              src,
              {
                "dc:subject": [{
                  val: "favorite",
                  mode: "merge"
                }]
              }
            ]
          })
        }

        // Update UI in-place without refresh
        const newFavorited = !is_favorited
        favoriteFileTarget.setAttribute("data-favorited", newFavorited)
        const icon = favoriteFileTarget.querySelector("i")
        if (newFavorited) {
          icon.classList.remove("fa-regular")
          icon.classList.add("fa-solid")
        } else {
          icon.classList.remove("fa-solid")
          icon.classList.add("fa-regular")
        }
        
        // Update the database in background
        await this.app.synchronize([{ file_path: src, root_path: root }], async () => {
          // Silent update - no UI refresh
        })
      } else if (clearTagsTarget) {
        const src = clearTagsTarget.getAttribute("data-src")
        const root = clearTagsTarget.getAttribute("data-root")
        const card = clearTagsTarget.closest(".card")
        
        // Confirm before clearing
        if (!confirm("Clear all tags from this image?")) {
          return
        }
        
        // Clear all tags via API
        await this.api.gm({
          path: "user",
          cmd: "set",
          args: [
            src,
            {
              "dc:subject": []
            }
          ]
        })
        
        // Update UI in-place - remove tags row
        const tagsRow = card.querySelector(".tags-row")
        if (tagsRow) {
          tagsRow.remove()
        }
        
        // Update favorite button if it was favorited
        const favoriteBtn = card.querySelector(".favorite-file")
        if (favoriteBtn && favoriteBtn.getAttribute("data-favorited") === "true") {
          favoriteBtn.setAttribute("data-favorited", "false")
          const icon = favoriteBtn.querySelector("i")
          icon.classList.remove("fa-solid")
          icon.classList.add("fa-regular")
        }
        
        // Update database in background
        await this.app.synchronize([{ file_path: src, root_path: root }], async () => {
          // Silent update - no UI refresh
        })
      } else if (grabTarget) {
      } else if (tokenTarget && e.target.closest(".card.expanded")) {
        let key = tokenTarget.closest("tr").getAttribute("data-key")
        let val = tokenTarget.getAttribute("data-value")
        let popup_items = []
        if (key === "file_path" || key === "model_name" || key === "agent" || key === "controlnet_model" || key === "controlnet_module" ) {
          if (val.split(" ").length > 1) {
            val = `"${val}"`
          }
          if (key === "file_path") {
            popup_items = [
              `<span class='popup-link' data-key='${key}' data-value='${val}'>${val}</span>`,
              `<span class='popup-link' data-key='-${key}' data-value='${val}'><i class="fa-solid fa-not-equal"></i> ${val}</span>`
            ]
          }
        }

        if (key === "prompt") {
          popup_items = [
            `<span class='popup-link' data-key='${key}' data-value='${val}'>${val}</span>`,
            `<span class='popup-link' data-key='-${key}' data-value='${val}'><i class="fa-solid fa-not-equal"></i> ${val}</span>`
          ]
        }

        if (key === "tags") {
          if (val.split(" ").length > 1) {
            val = val.replace(/^tag:(.+)/, 'tag:"$1"')
          }
          popup_items = [
            `<span class='popup-link' data-key='prompt' data-value='${val}'>${val}</span>`,
            `<span class='popup-link' data-key='-prompt' data-value='-${val}'><i class="fa-solid fa-not-equal"></i> ${val}</span>`
          ]
        }

        if (key === "width" || key === "height" || key === "seed" || key === "cfg_scale" || key === "steps" || key === "aesthetic_score" || key === "controlnet_weight" || key === "controlnet_guidance_strength" || key === "input_strength") {
          popup_items = [
            `<span class='popup-link' data-key='-${key}' data-value='${val}'>&lt;</span>`,
            `<span class='popup-link' data-key='-=${key}' data-value='${val}'>&lt;=</span>`,
            `<span class='popup-link' data-key='${key}' data-value='${val}'>${val}</span>`,
            `<span class='popup-link' data-key='+=${key}' data-value='${val}'>=&gt;</span>`,
            `<span class='popup-link' data-key='+${key}' data-value='${val}'>&gt;</span>`
          ]
        }

        if (popup_items.length > 0) {
          tippy(tokenTarget, {
            interactive: true,
  //          placement: "bottom-end",
            trigger: 'click',
            content: `<div class='token-popup'>${popup_items.join("")}</div>`,
            allowHTML: true,
          }).show();
        } else {
          this.app.navbar.input(key, val)
        }
      } else if (tokenPopupTarget) {
        let key = tokenPopupTarget.getAttribute("data-key")
        let val = tokenPopupTarget.getAttribute("data-value")
        this.app.navbar.input(key, val)
      } else if (e.target.closest(".toggle-metadata")) {
        // Handle metadata details toggle
        let button = e.target.closest(".toggle-metadata")
        let card = button.closest(".card")
        let details = card.querySelector(".metadata-details")
        let icon = button.querySelector("i")
        
        details.classList.toggle("hidden")
        
        if (details.classList.contains("hidden")) {
          icon.classList.remove("fa-chevron-up")
          icon.classList.add("fa-chevron-down")
          button.innerHTML = '<i class="fa-solid fa-chevron-down"></i> Show Details'
        } else {
          icon.classList.remove("fa-chevron-down")
          icon.classList.add("fa-chevron-up")
          button.innerHTML = '<i class="fa-solid fa-chevron-up"></i> Hide Details'
        }
      } else if (colTarget && e.target.closest(".card.expanded")) {
        // if clicked inside the .col section when NOT expanded, don't do anything.
        // except the clipboard button
        // if the clicked element is the delete button, delete
        if (clipboardTarget) {
          this.api.copy(clipboardTarget.getAttribute("data-value"))
          clipboardTarget.querySelector("i").classList.remove("fa-regular")
          clipboardTarget.querySelector("i").classList.remove("fa-clone")
          clipboardTarget.querySelector("i").classList.add("fa-solid")
          clipboardTarget.querySelector("i").classList.add("fa-check")
          
          // Update text (handle both span and direct text)
          const textSpan = clipboardTarget.querySelector("span")
          const originalText = clipboardTarget.textContent.trim()
          if (textSpan) {
            textSpan.innerHTML = "copied"
          } else {
            clipboardTarget.innerHTML = '<i class="fa-solid fa-check"></i> Copied'
          }

          setTimeout(() => {
            clipboardTarget.querySelector("i").classList.remove("fa-solid")
            clipboardTarget.querySelector("i").classList.remove("fa-check")
            clipboardTarget.querySelector("i").classList.add("fa-regular")
            clipboardTarget.querySelector("i").classList.add("fa-clone")
            if (textSpan) {
              textSpan.innerHTML = ""
            } else {
              clipboardTarget.innerHTML = '<i class="fa-regular fa-clone"></i> Copy Prompt'
            }
          }, 3000)
        }
      } else {
        let target = (e.target.classList.contains("card") ? e.target : e.target.closest(".card"))
        if (target) {
          // don't make popup cards expandable
          if (target.classList.contains("popup-card")) {
            window.close()
            return
          }
          
          // Close any other expanded cards first
          const wasExpanded = target.classList.contains("expanded")
          document.querySelectorAll('.card.expanded').forEach(card => {
            if (card !== target) {
              card.classList.remove('expanded')
            }
          })
          
          // Toggle the clicked card
          if (wasExpanded) {
            target.classList.remove("expanded")
          } else {
            target.classList.add("expanded")
          }
          
          if (target.classList.contains("expanded")) {
            //let img = target.querySelector("img").cloneNode()
            //let scaleFactor = Math.min(window.innerWidth / img.naturalWidth, window.innerHeight / img.naturalHeight)
            //if (this.viewer) this.viewer.destroy()
            //this.viewer = new Viewer(img, {
            //  transition: false,
            //  viewed() {
            //    this.viewer.zoomTo(scaleFactor)
            //  },
            //});

            // h4 truncate
            let h4 = target.querySelector("h4")
            target.addEventListener('transitionend', () => {
              let more = h4.parentNode.querySelector(".more")

              // clone node to remove any previously attached event listeners

              if (h4.offsetHeight < h4.scrollHeight || h4.offsetWidth < h4.scrollWidth) {

                more.classList.remove("hidden") 

                let new_more= more.cloneNode(true);
                more.parentNode.replaceChild(new_more, more)

                new_more.addEventListener("click", (e) => {
                  h4.classList.toggle("expanded")
                  if (h4.classList.contains("expanded")) {
                    new_more.innerHTML = `<i class="fa-solid fa-angles-up"></i> view less`
                  } else {
                    new_more.innerHTML = `<i class="fa-solid fa-angles-down"></i> view more`
                  }
                })
              }

              // content-text truncate
              let contentTexts = target.querySelectorAll("[data-key$=prompt] .content-text")
              for(let contentText of contentTexts) {
                let more = contentText.parentNode.querySelector(".more")
                if (contentText.offsetHeight < contentText.scrollHeight || contentText.offsetWidth < contentText.scrollWidth) {
                  more.classList.remove("hidden") 

                  // clone node to remove any previously attached event listeners
                  let new_more= more.cloneNode(true);
                  more.parentNode.replaceChild(new_more, more)

                  new_more.addEventListener("click", (e) => {
                    contentText.classList.toggle("expanded")
                    if (contentText.classList.contains("expanded")) {
                      new_more.innerHTML = `<i class="fa-solid fa-angles-up"></i> view less`
                    } else {
                      new_more.innerHTML = `<i class="fa-solid fa-angles-down"></i> view more`
                    }
                  })
                }
                
              }
            })

          }
        }
      }
    })
    
    // Tag input handler - inline tagging without navigation
    document.querySelector(".container").addEventListener("keydown", async (e) => {
      if (e.target.classList.contains("tag-input") && e.key === "Enter") {
        e.preventDefault()
        e.stopPropagation()
        
        const input = e.target
        const tagValue = input.value.trim()
        
        if (!tagValue) return
        
        const src = input.getAttribute("data-src")
        const root = input.getAttribute("data-root")
        const card = input.closest(".card")
        
        // Add tag via API
        await this.api.gm({
          path: "user",
          cmd: "set",
          args: [
            src,
            {
              "dc:subject": [{
                val: tagValue,
                mode: "merge"
              }]
            }
          ]
        })
        
        // Update UI in-place
        let tagsRow = card.querySelector(".tags-row")
        if (!tagsRow) {
          tagsRow = document.createElement("div")
          tagsRow.className = "tags-row"
          input.parentNode.parentNode.insertBefore(tagsRow, input.parentNode)
        }
        
        const tagSpan = document.createElement("span")
        tagSpan.setAttribute("data-tag", `tag:${tagValue}`)
        tagSpan.innerHTML = `<button data-value="tag:${tagValue}" class='token tag-item'><i class="fa-solid fa-tag"></i> ${tagValue}</button>`
        tagsRow.appendChild(tagSpan)
        
        // Clear input
        input.value = ""
        
        // Update database in background
        await this.app.synchronize([{ file_path: src, root_path: root }], async () => {
          // Silent update - no UI refresh
        })
      }
    })
  }
}
