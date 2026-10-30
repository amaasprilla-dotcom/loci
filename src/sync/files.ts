// Attached files arriving from another device (SPEC-v4-sync.md, "Attachments
// (files)"). A file's record can arrive before its bytes have downloaded; until
// then attachments show "Downloading…", and they listen here to show the file
// once it's in.

const EVENT = 'loci:file-arrived'

export function announceFile(blobId: string): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(EVENT, { detail: blobId }))
}

// Returns unsubscribe.
export function onFileArrived(listener: (blobId: string) => void): () => void {
  const handler = (e: Event) => listener((e as CustomEvent<string>).detail)
  window.addEventListener(EVENT, handler)
  return () => window.removeEventListener(EVENT, handler)
}
