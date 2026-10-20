// An image inside a note. The picture itself is a stored file (an inline
// attachment); the node only keeps its blob id, and shows it from IndexedDB.

import { Node } from '@tiptap/core'
import { getBlob } from '../../store/attachments'

export const NoteImage = Node.create({
  name: 'noteImage',
  group: 'block',
  atom: true,
  draggable: true,

  addAttributes() {
    return {
      blobId: { default: null },
      alt: { default: '' },
    }
  },

  parseHTML() {
    return [{ tag: 'img[data-blob-id]', getAttrs: (el) => ({ blobId: el.getAttribute('data-blob-id'), alt: el.getAttribute('alt') ?? '' }) }]
  },

  renderHTML({ node }) {
    return ['img', { 'data-blob-id': node.attrs.blobId, alt: node.attrs.alt }]
  },

  addNodeView() {
    return ({ node }) => {
      const img = document.createElement('img')
      img.className = 'note-image'
      img.alt = node.attrs.alt
      let url: string | null = null
      let gone = false
      void getBlob(node.attrs.blobId).then((blob) => {
        if (!blob || gone) return
        url = URL.createObjectURL(blob)
        img.src = url
      })
      return {
        dom: img,
        destroy() {
          gone = true
          if (url) URL.revokeObjectURL(url)
        },
      }
    }
  },
})
