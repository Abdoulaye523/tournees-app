import { supabase } from './supabase'
import toast from 'react-hot-toast'
import { X, FileText, Paperclip } from 'lucide-react'

export const MAX_FILES = 5
export const MAX_FILE_SIZE = 20 * 1024 * 1024 // 20 Mo par fichier

const IMAGE_EXT = /\.(jpe?g|png|gif|webp|bmp|avif)$/i

export function isImagePath(path = '') {
  return IMAGE_EXT.test(path)
}

// Nom lisible : on retire le préfixe "<horodatage>-<n>-" ajouté à l'envoi
export function fileLabel(path = '') {
  const base = path.split('/').pop() || path
  const name = base.replace(/^\d+-\d+-?/, '')
  return name && !/^\.\w+$/.test(name) ? name : base
}

// Réduit les photos (max 1600 px, JPEG ~80 %) pour accélérer l'envoi, surtout depuis un téléphone.
function compressImage(file, maxSize = 1600, quality = 0.8) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      const ratio = Math.min(1, maxSize / Math.max(img.width, img.height))
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(img.width * ratio)
      canvas.height = Math.round(img.height * ratio)
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height)
      URL.revokeObjectURL(url)
      canvas.toBlob(blob => (blob ? resolve(blob) : reject(new Error('Compression impossible'))), 'image/jpeg', quality)
    }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Image illisible')) }
    img.src = url
  })
}

// Prépare un fichier choisi : { id, file, preview } (preview = aperçu pour les images, sinon null)
export function makePending(file) {
  const isImg = file.type.startsWith('image/')
  return {
    id: `${file.name}-${file.size}-${Math.random().toString(36).slice(2)}`,
    file,
    preview: isImg ? URL.createObjectURL(file) : null,
  }
}

// Filtre les fichiers choisis : place restante et taille maximale
export function acceptFiles(files, room) {
  if (files.length > room) toast.error(`${MAX_FILES} fichiers maximum`)
  const ok = []
  for (const f of files.slice(0, Math.max(room, 0))) {
    if (f.size > MAX_FILE_SIZE) toast.error(`« ${f.name} » dépasse ${MAX_FILE_SIZE / 1024 / 1024} Mo`)
    else ok.push(f)
  }
  return ok
}

function safeName(name) {
  return name.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9._-]+/g, '_').slice(-80)
}

// Envoie un fichier dans le bucket et renvoie son chemin.
// Les photos sont compressées en JPEG ; les autres fichiers (PDF, Excel, Word…) sont envoyés tels quels.
export async function uploadAttachment(bucket, base, file, i) {
  const ts = Date.now()
  if (file.type.startsWith('image/') && !/gif|svg/.test(file.type)) {
    try {
      const blob = await compressImage(file)
      const path = `${base}/${ts}-${i}.jpg`
      const { error } = await supabase.storage.from(bucket).upload(path, blob, { contentType: 'image/jpeg' })
      if (error) throw error
      return path
    } catch (err) {
      // format non lisible par le navigateur (ex. HEIC) : on envoie l'original
      if (!/illisible|Compression/.test(err.message || '')) throw err
    }
  }
  const path = `${base}/${ts}-${i}-${safeName(file.name)}`
  const { error } = await supabase.storage.from(bucket).upload(path, file, { contentType: file.type || 'application/octet-stream' })
  if (error) throw error
  return path
}

const frame = { borderRadius: 'var(--radius-sm)', border: '1px solid var(--gray-200)' }

// Fichier en cours de saisie (avant envoi)
export function PendingFile({ item, size = 72, onRemove }) {
  return (
    <div style={{ position: 'relative', width: item.preview ? size : 'auto', maxWidth: 190, height: size > 60 ? 72 : 56 }}>
      {item.preview ? (
        <img src={item.preview} alt={item.file.name} style={{ width: '100%', height: '100%', objectFit: 'cover', ...frame }} />
      ) : (
        <div style={{ height: '100%', display: 'flex', alignItems: 'center', gap: 6, padding: '0 12px 0 10px', background: 'var(--gray-50)', fontSize: 12, color: 'var(--gray-700)', ...frame }}>
          <FileText size={16} style={{ flexShrink: 0 }} />
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.file.name}</span>
        </div>
      )}
      <button
        type="button"
        onClick={onRemove}
        title="Retirer ce fichier"
        style={{ position: 'absolute', top: -6, right: -6, width: 20, height: 20, borderRadius: '50%', border: 'none', background: 'var(--gray-700)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', padding: 0 }}
      >
        <X size={12} />
      </button>
    </div>
  )
}

// Fichier déjà enregistré : miniature pour une image, pastille cliquable pour le reste
export function StoredFile({ path, url, size = 96 }) {
  if (!url) return <div style={{ width: size, height: size, background: 'var(--gray-100)', ...frame }} />
  if (isImagePath(path)) {
    return (
      <a href={url} target="_blank" rel="noopener noreferrer" title="Ouvrir en grand">
        <img src={url} alt="Photo jointe" style={{ width: size, height: size, objectFit: 'cover', display: 'block', ...frame }} />
      </a>
    )
  }
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      download={fileLabel(path)}
      title="Ouvrir / télécharger"
      style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 12px', maxWidth: 260, background: 'var(--gray-50)', color: 'var(--gray-700)', fontSize: 12, textDecoration: 'none', ...frame }}
    >
      <Paperclip size={14} style={{ flexShrink: 0 }} />
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{fileLabel(path)}</span>
    </a>
  )
}
