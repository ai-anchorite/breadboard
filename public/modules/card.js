const card = (meta, stripPunctuation) => {
  let tags = []
  if (meta.tokens && meta.tokens.length > 0) {
    tags = meta.tokens.filter(x => x.startsWith("tag:"))
  }
  let is_favorited = tags.includes("tag:favorite")
  let favClass = is_favorited ? "fa-solid fa-heart" : "fa-regular fa-heart"

  return `<div class='grab' draggable='true'>
<button title='like this item' data-favorited="${is_favorited}" data-src="${meta.file_path}" class='favorite-file'><i class="${favClass}"></i></button>
<button title='open in explorer' data-src="${meta.file_path}" class='open-file'><i class="fa-regular fa-folder-open"></i></button>
<button title='delete' data-fingerprint="${meta.fingerprint}" data-src="${meta.file_path}" class='trash-file'><i class="fa-regular fa-trash-can"></i></button>
<button title='pop out' class='popup grab-right' data-src="/viewer?file=${encodeURIComponent(meta.file_path)}"><i class="fa-solid fa-up-right-from-square"></i></button>
</div>
<img loading='lazy' data-root="${meta.root_path}" data-src="${meta.file_path}" data-fingerprint="${meta.fingerprint}" src="/file?file=${encodeURIComponent(meta.file_path)}">`
}
