const { contextBridge, webFrame, ipcRenderer } = require('electron')
contextBridge.exposeInMainWorld('electronAPI', {
  startDrag: (fileNames) => {
    ipcRenderer.invoke('ondragstart', fileNames)
  },
  selectDirectory: () => {
    return ipcRenderer.invoke('select-directory')
  },
  scanVideos: (folderPath, options) => {
    return ipcRenderer.invoke('scan-videos', folderPath, options)
  },
  getAllVideos: () => {
    return ipcRenderer.invoke('get-all-videos')
  },
  videoAddTags: (fingerprints, tags) => {
    return ipcRenderer.invoke('video-add-tags', fingerprints, tags)
  },
  videoRemoveTag: (fingerprints, tag) => {
    return ipcRenderer.invoke('video-remove-tag', fingerprints, tag)
  },
  videoSetRating: (fingerprints, rating) => {
    return ipcRenderer.invoke('video-set-rating', fingerprints, rating)
  },
  videoGetTags: () => {
    return ipcRenderer.invoke('video-get-tags')
  },
  onVideoScanProgress: (callback) => {
    ipcRenderer.on('video-scan-progress', (_event, progress) => callback(progress))
  },
  onVideoAdded: (callback) => {
    ipcRenderer.on('video-added', (_event, video) => callback(video))
  },
  onVideoRemoved: (callback) => {
    ipcRenderer.on('video-removed', (_event, data) => callback(data))
  },
  onVideoChanged: (callback) => {
    ipcRenderer.on('video-changed', (_event, video) => callback(video))
  },
})
