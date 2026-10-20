// Attachments (SPEC-v2.md, "Attachments (shared)"): links and files on notes,
// to-dos and goals. Files are stored as Blobs in IndexedDB; images are scaled
// down to 2048px on the long edge first. Links keep a URL and an editable title;
// nothing is fetched from other sites (the browser blocks that without a server).

import type { Attachment, AttachmentKind, AttachmentOwner } from '../types'
import { db } from './db'

export const LARGE_FILE_BYTES = 25 * 1024 * 1024 // above this, ask before saving
export const MAX_IMAGE_EDGE = 2048

export interface Owner {
  type: AttachmentOwner
  id: string
}

export function kindOf(mime: string): AttachmentKind {
  if (mime.startsWith('image/')) return 'image'
  if (mime.startsWith('audio/')) return 'audio'
  if (mime.startsWith('video/')) return 'video'
  if (mime === 'application/pdf') return 'pdf'
  return 'file'
}

// A web address as typed ("example.com/page") made into a full one, or null if it
// isn't one we'll open. Only http(s) and mailto: never javascript: or data: links.
export function normalizeUrl(input: string): string | null {
  const text = input.trim()
  if (!text) return null
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text}`
  try {
    const url = new URL(withScheme)
    if (!['http:', 'https:', 'mailto:'].includes(url.protocol)) return null
    if (url.protocol !== 'mailto:' && !url.hostname.includes('.') && url.hostname !== 'localhost') return null
    return url.href
  } catch {
    return null
  }
}

// What a link shows when it has no title: its domain.
export function linkLabel(a: Pick<Attachment, 'name' | 'url'>): string {
  if (a.name) return a.name
  try {
    return new URL(a.url!).hostname.replace(/^www\./, '')
  } catch {
    return a.url ?? ''
  }
}

export async function listAttachments(owner: Owner): Promise<Attachment[]> {
  const rows = await db.attachments.where('[ownerType+ownerId]').equals([owner.type, owner.id]).toArray()
  return rows.sort((a, b) => a.createdAt - b.createdAt)
}

export async function addLinkAttachment(owner: Owner, url: string, title = ''): Promise<Attachment> {
  const href = normalizeUrl(url)
  if (!href) throw new Error('That isn’t a web address.')
  const now = Date.now()
  const attachment: Attachment = { id: crypto.randomUUID(), ownerType: owner.type, ownerId: owner.id, kind: 'link', name: title.trim(), url: href, createdAt: now, updatedAt: now }
  await db.attachments.add(attachment)
  return attachment
}

export async function addFileAttachment(owner: Owner, file: File): Promise<Attachment> {
  const mime = file.type || 'application/octet-stream'
  const data = kindOf(mime) === 'image' ? await downscaleImage(file) : file
  const now = Date.now()
  const blobId = crypto.randomUUID()
  const attachment: Attachment = {
    id: crypto.randomUUID(),
    ownerType: owner.type,
    ownerId: owner.id,
    kind: kindOf(mime),
    name: file.name || 'file',
    blobId,
    mime: data.type || mime,
    size: data.size,
    createdAt: now,
    updatedAt: now,
  }
  await db.transaction('rw', db.attachments, db.blobs, async () => {
    await db.blobs.add({ id: blobId, data, mime: attachment.mime!, size: data.size, updatedAt: now })
    await db.attachments.add(attachment)
  })
  return attachment
}

export async function renameAttachment(id: string, name: string): Promise<void> {
  await db.attachments.update(id, { name: name.trim(), updatedAt: Date.now() })
}

export async function deleteAttachment(id: string): Promise<void> {
  await db.transaction('rw', db.attachments, db.blobs, async () => {
    const a = await db.attachments.get(id)
    await db.attachments.delete(id)
    if (a?.blobId) await deleteBlobIfOrphaned(a.blobId)
  })
}

// When a note, to-do or goal is deleted: its attachments, and their files if
// nothing else uses them. Call inside a transaction that includes both tables.
export async function deleteAttachmentsFor(owner: Owner): Promise<void> {
  const rows = await listAttachments(owner)
  await db.attachments.bulkDelete(rows.map((a) => a.id))
  for (const a of rows) if (a.blobId) await deleteBlobIfOrphaned(a.blobId)
}

async function deleteBlobIfOrphaned(blobId: string) {
  const stillUsed = await db.attachments.filter((a) => a.blobId === blobId).count()
  if (stillUsed === 0) await db.blobs.delete(blobId)
}

export async function getBlob(blobId: string): Promise<Blob | null> {
  return (await db.blobs.get(blobId))?.data ?? null
}

// Total size of stored files, for Settings.
export async function blobBytes(): Promise<{ count: number; bytes: number }> {
  let bytes = 0
  let count = 0
  await db.blobs.each((b) => {
    bytes += b.size
    count++
  })
  return { count, bytes }
}

// Scales a photo down so its long edge is at most 2048px, keeping its format
// (PNG, JPEG or WebP). Animated GIFs, SVGs and anything the browser can't read
// are kept as they are.
export async function downscaleImage(file: Blob): Promise<Blob> {
  const type = file.type
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(type) || typeof createImageBitmap !== 'function') return file
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    return file
  }
  const scale = MAX_IMAGE_EDGE / Math.max(bitmap.width, bitmap.height)
  if (scale >= 1) {
    bitmap.close()
    return file
  }
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()
  const scaled = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, 0.9))
  return scaled ?? file
}
