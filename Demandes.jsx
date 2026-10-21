import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { supabase } from './supabase'
import { useAuth } from './AuthContext'
import toast from 'react-hot-toast'
import {
  Plus, X, Package, ShieldAlert, PackagePlus, Search, MessageSquare,
  CheckCircle2, Send, ClipboardList, Camera,
} from 'lucide-react'

const PHOTO_BUCKET = 'demandes-photos'
const MAX_PHOTOS = 5

// Réduit la photo (max 1600 px, JPEG ~80 %) pour accélérer l'envoi, surtout depuis un téléphone.
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

const TYPES = {
  securisation: { label: 'Sécurisation', badge: 'badge-red', icon: ShieldAlert },
  ajout_non_planifie: { label: 'Ajout non planifié dans une tournée', badge: 'badge-orange', icon: PackagePlus },
  ajout_non_planifie_retour: { label: 'Ajout non planifié en retour', badge: 'badge-purple', icon: PackagePlus },
  recherche_colis: { label: 'Recherche de colis', badge: 'badge-blue', icon: Search },
  autre: { label: 'Autres demandes', badge: 'badge-gray', icon: MessageSquare },
}

const BP_REQUIRED_TYPES = ['securisation', 'ajout_non_planifie', 'ajout_non_planifie_retour', 'recherche_colis']

const STATUS_META = {
  ouverte: { label: 'Ouverte', badge: 'badge-orange' },
  resolue: { label: 'Résolue', badge: 'badge-green' },
  annulee: { label: 'Annulée', badge: 'badge-red' },
  cloturee: { label: 'Clôturée', badge: 'badge-gray' },
}

export default function Demandes() {
  const { profile } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()
  const basePath = profile?.role === 'admin' ? '/admin' : profile?.role === 'operator' ? '/operator' : '/partner'

  const canCreate = true
  const canValidate = profile?.role === 'admin' || profile?.role === 'partner'
  const canLinkToSearch = profile?.role !== 'partner'

  const [demandes, setDemandes] = useState([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState('ouverte')
  const [bpSearch, setBpSearch] = useState('')
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [selected, setSelected] = useState(null)

  const filteredDemandes = bpSearch.trim()
    ? demandes.filter(d => (d.bp || []).some(bp => bp.toLowerCase().includes(bpSearch.trim().toLowerCase())))
    : demandes

  useEffect(() => { fetchDemandes() }, [statusFilter])

  // Ouvrir automatiquement une demande si ?open=<id> est présent (venant de la recherche colis)
  useEffect(() => {
    const openId = searchParams.get('open')
    if (openId && demandes.length > 0) {
      const d = demandes.find(d => d.id === openId)
      if (d) setSelected(d)
    }
  }, [searchParams, demandes])

  async function fetchDemandes() {
    setLoading(true)
    let query = supabase
      .from('demandes')
      .select('*, created_by_user:created_by(full_name, email), resolved_by_user:resolved_by(full_name, email)')
      .order('created_at', { ascending: false })

    if (statusFilter !== 'all') query = query.eq('status', statusFilter)

    const { data, error } = await query
    if (error) {
      toast.error('Erreur de chargement : ' + error.message)
      setDemandes([])
    } else {
      setDemandes(data || [])
    }
    setLoading(false)
  }

  function openDetail(d) {
    setSelected(d)
    setSearchParams(prev => {
      const p = new URLSearchParams(prev)
      p.set('open', d.id)
      return p
    })
  }

  function closeDetail() {
    setSelected(null)
    setSearchParams(prev => {
      const p = new URLSearchParams(prev)
      p.delete('open')
      return p
    })
  }

  return (
    <>
      <div className="page-header">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="page-title">Suivi des tâches</h2>
            <p className="page-subtitle">Sécurisation, ajouts non planifiés, recherches de colis et autres demandes</p>
          </div>
          {canCreate && (
            <button className="btn btn-primary" onClick={() => setShowCreateModal(true)}>
              <Plus size={15} /> Nouvelle demande
            </button>
          )}
        </div>
      </div>

      <div className="page-body">
        <div style={{ display: 'flex', gap: '8px', marginBottom: '20px', flexWrap: 'wrap', alignItems: 'center' }}>
          {[
            { value: 'ouverte', label: 'Ouvertes' },
            { value: 'resolue', label: 'Résolues' },
            { value: 'annulee', label: 'Annulées' },
            { value: 'cloturee', label: 'Clôturées' },
            { value: 'all', label: 'Toutes' },
          ].map(f => (
            <button
              key={f.value}
              className={`btn btn-sm ${statusFilter === f.value ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setStatusFilter(f.value)}
            >
              {f.label}
            </button>
          ))}

          <div style={{ position: 'relative', marginLeft: 'auto', width: '260px' }}>
            <Search size={14} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: 'var(--gray-300)' }} />
            <input
              className="form-input"
              style={{ paddingLeft: '32px' }}
              placeholder="Rechercher par numéro de BP"
              value={bpSearch}
              onChange={e => setBpSearch(e.target.value)}
            />
          </div>
        </div>

        {bpSearch.trim() && (
          <p style={{ fontSize: '13px', color: 'var(--gray-500)', marginTop: '-12px', marginBottom: '16px' }}>
            {filteredDemandes.length} tâche{filteredDemandes.length > 1 ? 's' : ''} rattachée{filteredDemandes.length > 1 ? 's' : ''} au BP « {bpSearch.trim()} »
          </p>
        )}

        <div className="card">
          {loading ? (
            <div className="loading-center"><div className="spinner dark" /></div>
          ) : filteredDemandes.length === 0 ? (
            <div className="empty-state">
              <ClipboardList size={36} className="empty-state-icon" />
              <p className="empty-state-title">{bpSearch.trim() ? 'Aucune tâche pour ce BP' : 'Aucune demande'}</p>
              <p className="empty-state-sub">
                {bpSearch.trim() ? 'Vérifiez le numéro et réessayez.' : 'Les demandes créées apparaîtront ici.'}
              </p>
            </div>
          ) : (
            <div className="table-wrapper">
              <table>
                <thead>
                  <tr>
                    <th>Type</th>
                    <th>BP</th>
                    <th>Commentaire</th>
                    <th>Statut</th>
                    <th>Créée par</th>
                    <th>Date</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {filteredDemandes.map(d => {
                    const t = TYPES[d.type] || TYPES.autre
                    return (
                      <tr key={d.id} style={{ cursor: 'pointer' }} onClick={() => openDetail(d)}>
                        <td><span className={`badge ${t.badge}`}>{t.label}</span></td>
                        <td>
                          {(d.bp || []).length === 0 ? (
                            <span style={{ color: 'var(--gray-300)' }}>—</span>
                          ) : (
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                              {d.bp.map(bp => canLinkToSearch ? (
                                <Link
                                  key={bp}
                                  to={`${basePath}/search-parcel?barcode=${encodeURIComponent(bp)}`}
                                  onClick={e => e.stopPropagation()}
                                  style={{ textDecoration: 'none' }}
                                >
                                  <code style={{
                                    fontFamily: 'monospace', fontSize: '12px', background: 'var(--blue-light)',
                                    color: '#1e40af', padding: '2px 8px', borderRadius: '4px',
                                  }}>
                                    {bp}
                                  </code>
                                </Link>
                              ) : (
                                <code key={bp} style={{
                                  fontFamily: 'monospace', fontSize: '12px', background: 'var(--gray-100)',
                                  padding: '2px 8px', borderRadius: '4px',
                                }}>
                                  {bp}
                                </code>
                              ))}
                            </div>
                          )}
                        </td>
                        <td style={{ maxWidth: '260px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--gray-600)' }}>
                          {d.commentaire || <span style={{ color: 'var(--gray-300)' }}>—</span>}
                          {(d.photos || []).length > 0 && (
                            <span title={`${d.photos.length} photo(s)`} style={{ marginLeft: 8, color: 'var(--gray-400)', display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 12 }}>
                              <Camera size={12} /> {d.photos.length}
                            </span>
                          )}
                        </td>
                        <td>
                          <span className={`badge ${(STATUS_META[d.status] || STATUS_META.ouverte).badge}`}>
                            {(STATUS_META[d.status] || STATUS_META.ouverte).label}
                          </span>
                        </td>
                        <td style={{ fontSize: '13px' }}>{d.created_by_user?.full_name || d.created_by_user?.email || '—'}</td>
                        <td style={{ fontSize: '13px', color: 'var(--gray-500)' }}>
                          {new Date(d.created_at).toLocaleString('fr-FR')}
                        </td>
                        <td style={{ color: 'var(--gray-300)' }}>›</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {showCreateModal && (
        <CreateDemandeModal
          onClose={() => setShowCreateModal(false)}
          onCreated={() => { setShowCreateModal(false); fetchDemandes() }}
        />
      )}

      {selected && (
        <DemandeDetailModal
          demande={selected}
          basePath={basePath}
          canValidate={canValidate}
          canLinkToSearch={canLinkToSearch}
          onClose={closeDetail}
          onChanged={() => { fetchDemandes() }}
        />
      )}
    </>
  )
}

// ─────────────────────────────────────────────────────────────
// Modale de création
// ─────────────────────────────────────────────────────────────
function CreateDemandeModal({ onClose, onCreated }) {
  const { user } = useAuth()
  const [type, setType] = useState('securisation')
  const [bpInput, setBpInput] = useState('')
  const [bpList, setBpList] = useState([])
  const [commentaire, setCommentaire] = useState('')
  const [photos, setPhotos] = useState([]) // [{ file, preview }]
  const [saving, setSaving] = useState(false)

  const bpRequired = BP_REQUIRED_TYPES.includes(type)

  function handlePhotoChange(e) {
    const files = Array.from(e.target.files || [])
    e.target.value = '' // permet de re-sélectionner la même photo
    if (files.length === 0) return
    const room = MAX_PHOTOS - photos.length
    if (files.length > room) toast.error(`${MAX_PHOTOS} photos maximum par demande`)
    const accepted = files.filter(f => f.type.startsWith('image/')).slice(0, Math.max(room, 0))
    setPhotos(prev => [...prev, ...accepted.map(file => ({ file, preview: URL.createObjectURL(file) }))])
  }

  function removePhoto(index) {
    setPhotos(prev => {
      URL.revokeObjectURL(prev[index].preview)
      return prev.filter((_, i) => i !== index)
    })
  }

  function addBp() {
    const value = bpInput.trim()
    if (!value) return
    if (!bpList.includes(value)) setBpList(list => [...list, value])
    setBpInput('')
  }

  function removeBp(value) {
    setBpList(list => list.filter(v => v !== value))
  }

  function handleBpKeyDown(e) {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      addBp()
    }
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (bpRequired && bpList.length === 0) {
      toast.error('Au moins un numéro de colis (BP) est requis pour ce type de demande')
      return
    }
    setSaving(true)

    // L'id est généré ici pour ranger les photos dans un dossier à son nom
    // et n'insérer la demande qu'une fois les photos envoyées (pas de demande orpheline).
    const demandeId = crypto.randomUUID()
    const photoPaths = []
    try {
      for (let i = 0; i < photos.length; i++) {
        const blob = await compressImage(photos[i].file)
        const path = `${demandeId}/${Date.now()}-${i}.jpg`
        const { error: upErr } = await supabase.storage.from(PHOTO_BUCKET).upload(path, blob, { contentType: 'image/jpeg' })
        if (upErr) throw upErr
        photoPaths.push(path)
      }
    } catch (err) {
      setSaving(false)
      toast.error('Erreur lors de l\'envoi des photos : ' + (err.message || err))
      return
    }

    const { error } = await supabase.from('demandes').insert({
      id: demandeId,
      type,
      bp: bpList,
      commentaire: commentaire.trim() || null,
      photos: photoPaths,
      status: 'ouverte',
      created_by: user.id,
    })
    setSaving(false)
    if (error) {
      toast.error('Erreur : ' + error.message)
      return
    }
    photos.forEach(p => URL.revokeObjectURL(p.preview))
    toast.success('Demande créée')
    onCreated()
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <h3 className="modal-title">Nouvelle demande</h3>
            <button className="btn btn-ghost btn-sm" onClick={onClose}><X size={16} /></button>
          </div>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            <div className="form-group">
              <label className="form-label">Type de demande</label>
              <select className="form-input" value={type} onChange={e => setType(e.target.value)}>
                {Object.entries(TYPES).map(([key, t]) => (
                  <option key={key} value={key}>{t.label}</option>
                ))}
              </select>
            </div>

            <div className="form-group">
              <label className="form-label">
                BP (numéro{bpList.length > 1 ? 's' : ''} de colis){bpRequired && <span style={{ color: 'var(--red)' }}> *</span>}
              </label>
              <div style={{ display: 'flex', gap: '8px' }}>
                <input
                  className="form-input"
                  placeholder="Scanner ou saisir un numéro puis Entrée"
                  value={bpInput}
                  onChange={e => setBpInput(e.target.value)}
                  onKeyDown={handleBpKeyDown}
                />
                <button type="button" className="btn btn-secondary" onClick={addBp}>Ajouter</button>
              </div>
              {bpList.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '8px' }}>
                  {bpList.map(bp => (
                    <span key={bp} className="badge badge-blue" style={{ gap: '6px' }}>
                      <code style={{ fontFamily: 'monospace' }}>{bp}</code>
                      <X size={12} style={{ cursor: 'pointer' }} onClick={() => removeBp(bp)} />
                    </span>
                  ))}
                </div>
              )}
              {bpRequired && (
                <p style={{ fontSize: '12px', color: 'var(--gray-400)' }}>
                  Obligatoire pour ce type de demande.
                </p>
              )}
            </div>

            <div className="form-group">
              <label className="form-label">Commentaire</label>
              <textarea
                className="form-input"
                rows={4}
                placeholder="Détails de la demande..."
                value={commentaire}
                onChange={e => setCommentaire(e.target.value)}
              />
            </div>

            <div className="form-group">
              <label className="form-label">Photos (facultatif)</label>
              {photos.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '8px' }}>
                  {photos.map((p, i) => (
                    <div key={p.preview} style={{ position: 'relative', width: 72, height: 72 }}>
                      <img
                        src={p.preview}
                        alt={`Photo ${i + 1}`}
                        style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 'var(--radius-sm)', border: '1px solid var(--gray-200)' }}
                      />
                      <button
                        type="button"
                        onClick={() => removePhoto(i)}
                        title="Retirer cette photo"
                        style={{ position: 'absolute', top: -6, right: -6, width: 20, height: 20, borderRadius: '50%', border: 'none', background: 'var(--gray-700)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', padding: 0 }}
                      >
                        <X size={12} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              {photos.length < MAX_PHOTOS && (
                <label className="btn btn-secondary btn-sm" style={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <Camera size={14} /> Ajouter une photo
                  <input type="file" accept="image/*" multiple onChange={handlePhotoChange} style={{ display: 'none' }} />
                </label>
              )}
              <p style={{ fontSize: '12px', color: 'var(--gray-400)', marginTop: 6 }}>
                {photos.length}/{MAX_PHOTOS} — sur téléphone, vous pouvez prendre la photo directement.
              </p>
            </div>
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose}>Annuler</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? <><div className="spinner" /> {photos.length > 0 ? 'Envoi des photos...' : 'Création...'}</> : 'Créer la demande'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// Modale de détail (réponses + validation)
// ─────────────────────────────────────────────────────────────
function DemandeDetailModal({ demande, basePath, canValidate, canLinkToSearch, onClose, onChanged }) {
  const { user, profile } = useAuth()
  const [reponses, setReponses] = useState([])
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState('')
  const [sending, setSending] = useState(false)
  const [resolving, setResolving] = useState(false)
  const [status, setStatus] = useState(demande.status)
  const [photoUrls, setPhotoUrls] = useState([])
  const [replyPhotos, setReplyPhotos] = useState([]) // photos en cours de saisie : [{ file, preview }]
  const [replyPhotoUrls, setReplyPhotoUrls] = useState({}) // chemin -> lien temporaire, pour les réponses déjà envoyées

  const t = TYPES[demande.type] || TYPES.autre

  useEffect(() => { fetchReponses() }, [demande.id])

  // Le bucket est privé : on génère des liens temporaires (1 h) pour afficher les photos.
  useEffect(() => {
    const paths = demande.photos || []
    if (paths.length === 0) { setPhotoUrls([]); return }
    supabase.storage.from(PHOTO_BUCKET).createSignedUrls(paths, 3600).then(({ data, error }) => {
      if (error) return toast.error('Photos indisponibles : ' + error.message)
      setPhotoUrls((data || []).map(d => d.signedUrl).filter(Boolean))
    })
  }, [demande.id])

  async function fetchReponses() {
    setLoading(true)
    const { data } = await supabase
      .from('demande_reponses')
      .select('*, author:author_id(full_name, email, role)')
      .eq('demande_id', demande.id)
      .order('created_at', { ascending: true })
    setReponses(data || [])
    setLoading(false)

    // Liens temporaires (1 h) pour les photos jointes aux réponses
    const paths = (data || []).flatMap(r => r.photos || [])
    if (paths.length > 0) {
      const { data: signed } = await supabase.storage.from(PHOTO_BUCKET).createSignedUrls(paths, 3600)
      const map = {}
      ;(signed || []).forEach(s => { if (s.path && s.signedUrl) map[s.path] = s.signedUrl })
      setReplyPhotoUrls(map)
    }
  }

  function handleReplyPhotoChange(e) {
    const files = Array.from(e.target.files || [])
    e.target.value = ''
    if (files.length === 0) return
    const room = MAX_PHOTOS - replyPhotos.length
    if (files.length > room) toast.error(`${MAX_PHOTOS} photos maximum par réponse`)
    const accepted = files.filter(f => f.type.startsWith('image/')).slice(0, Math.max(room, 0))
    setReplyPhotos(prev => [...prev, ...accepted.map(file => ({ file, preview: URL.createObjectURL(file) }))])
  }

  function removeReplyPhoto(index) {
    setReplyPhotos(prev => {
      URL.revokeObjectURL(prev[index].preview)
      return prev.filter((_, i) => i !== index)
    })
  }

  async function handleSendMessage(e) {
    e.preventDefault()
    if (!message.trim() && replyPhotos.length === 0) return
    setSending(true)

    const photoPaths = []
    try {
      for (let i = 0; i < replyPhotos.length; i++) {
        const blob = await compressImage(replyPhotos[i].file)
        const path = `${demande.id}/reponses/${Date.now()}-${i}.jpg`
        const { error: upErr } = await supabase.storage.from(PHOTO_BUCKET).upload(path, blob, { contentType: 'image/jpeg' })
        if (upErr) throw upErr
        photoPaths.push(path)
      }
    } catch (err) {
      setSending(false)
      return toast.error('Erreur lors de l\'envoi des photos : ' + (err.message || err))
    }

    const { error } = await supabase.from('demande_reponses').insert({
      demande_id: demande.id,
      author_id: user.id,
      message: message.trim(), // peut être vide si la réponse ne contient que des photos
      photos: photoPaths,
    })
    setSending(false)
    if (error) return toast.error('Erreur : ' + error.message)
    replyPhotos.forEach(p => URL.revokeObjectURL(p.preview))
    setReplyPhotos([])
    setMessage('')
    fetchReponses()
  }

  async function setDemandeStatus(newStatus, successMessage, { clearResolved = false } = {}) {
    setResolving(true)
    const payload = clearResolved
      ? { status: newStatus, resolved_by: null, resolved_at: null }
      : { status: newStatus, resolved_by: user.id, resolved_at: new Date().toISOString() }
    const { error } = await supabase.from('demandes').update(payload).eq('id', demande.id)
    setResolving(false)
    if (error) return toast.error('Erreur : ' + error.message)
    toast.success(successMessage)
    setStatus(newStatus)
    onChanged()
  }

  const handleValidate = () => setDemandeStatus('resolue', 'Demande marquée comme réalisée')
  const handleCancel = () => setDemandeStatus('annulee', 'Demande annulée')
  const handleClose = () => setDemandeStatus('cloturee', 'Demande clôturée')
  const handleReopen = () => setDemandeStatus('ouverte', 'Demande rouverte', { clearResolved: true })

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: '560px' }}>
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span className={`badge ${t.badge}`}>{t.label}</span>
              <span className={`badge ${(STATUS_META[status] || STATUS_META.ouverte).badge}`}>
                {(STATUS_META[status] || STATUS_META.ouverte).label}
              </span>
            </div>
            <button className="btn btn-ghost btn-sm" onClick={onClose}><X size={16} /></button>
          </div>
        </div>

        <div className="modal-body">
          {demande.bp?.length > 0 && (
            <div>
              <label className="form-label">BP concernés</label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '6px' }}>
                {demande.bp.map(bp => canLinkToSearch ? (
                  <Link key={bp} to={`${basePath}/search-parcel?barcode=${encodeURIComponent(bp)}`} style={{ textDecoration: 'none' }}>
                    <code style={{
                      fontFamily: 'monospace', fontSize: '13px', background: 'var(--blue-light)',
                      color: '#1e40af', padding: '3px 10px', borderRadius: '4px', display: 'inline-flex',
                      alignItems: 'center', gap: '4px',
                    }}>
                      <Package size={12} /> {bp}
                    </code>
                  </Link>
                ) : (
                  <code key={bp} style={{ fontFamily: 'monospace', fontSize: '13px', background: 'var(--gray-100)', padding: '3px 10px', borderRadius: '4px' }}>
                    {bp}
                  </code>
                ))}
              </div>
            </div>
          )}

          {demande.commentaire && (
            <div>
              <label className="form-label">Commentaire</label>
              <p style={{ fontSize: '14px', color: 'var(--gray-700)', marginTop: '4px', whiteSpace: 'pre-wrap' }}>
                {demande.commentaire}
              </p>
            </div>
          )}

          {photoUrls.length > 0 && (
            <div>
              <label className="form-label">Photos ({photoUrls.length})</label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '6px' }}>
                {photoUrls.map((url, i) => (
                  <a key={url} href={url} target="_blank" rel="noopener noreferrer" title="Ouvrir en grand">
                    <img
                      src={url}
                      alt={`Photo ${i + 1}`}
                      style={{ width: 96, height: 96, objectFit: 'cover', borderRadius: 'var(--radius-sm)', border: '1px solid var(--gray-200)' }}
                    />
                  </a>
                ))}
              </div>
            </div>
          )}

          <div style={{ fontSize: '12px', color: 'var(--gray-400)' }}>
            Créée par {demande.created_by_user?.full_name || demande.created_by_user?.email || '—'} le{' '}
            {new Date(demande.created_at).toLocaleString('fr-FR')}
            {status !== 'ouverte' && demande.resolved_at && (
              <> · {STATUS_META[status]?.label || 'Mise à jour'} par {demande.resolved_by_user?.full_name || demande.resolved_by_user?.email || '—'} le {new Date(demande.resolved_at).toLocaleString('fr-FR')}</>
            )}
          </div>

          <div style={{ borderTop: '1px solid var(--gray-100)', paddingTop: '14px' }}>
            <label className="form-label">Réponses</label>
            {loading ? (
              <div className="loading-center" style={{ padding: '12px 0' }}><div className="spinner dark" /></div>
            ) : reponses.length === 0 ? (
              <p style={{ fontSize: '13px', color: 'var(--gray-400)', marginTop: '6px' }}>Aucune réponse pour le moment.</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '10px', maxHeight: '220px', overflowY: 'auto' }}>
                {reponses.map(r => (
                  <div key={r.id} style={{ background: 'var(--gray-50)', borderRadius: 'var(--radius-sm)', padding: '10px 12px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                      <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--gray-700)' }}>
                        {r.author?.full_name || r.author?.email || 'Utilisateur'}
                        {r.author?.role === 'partner' && <span className="badge badge-purple" style={{ marginLeft: '6px', fontSize: '10px' }}>Partenaire</span>}
                      </span>
                      <span style={{ fontSize: '11px', color: 'var(--gray-400)' }}>
                        {new Date(r.created_at).toLocaleString('fr-FR')}
                      </span>
                    </div>
                    {r.message && (
                      <p style={{ fontSize: '13px', color: 'var(--gray-700)', whiteSpace: 'pre-wrap' }}>{r.message}</p>
                    )}
                    {(r.photos || []).length > 0 && (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: r.message ? 8 : 0 }}>
                        {r.photos.map(path => replyPhotoUrls[path] ? (
                          <a key={path} href={replyPhotoUrls[path]} target="_blank" rel="noopener noreferrer" title="Ouvrir en grand">
                            <img
                              src={replyPhotoUrls[path]}
                              alt="Photo jointe"
                              style={{ width: 72, height: 72, objectFit: 'cover', borderRadius: 'var(--radius-sm)', border: '1px solid var(--gray-200)' }}
                            />
                          </a>
                        ) : (
                          <div key={path} style={{ width: 72, height: 72, borderRadius: 'var(--radius-sm)', background: 'var(--gray-100)' }} />
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            <form onSubmit={handleSendMessage} style={{ marginTop: '12px' }}>
              {replyPhotos.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '8px' }}>
                  {replyPhotos.map((p, i) => (
                    <div key={p.preview} style={{ position: 'relative', width: 56, height: 56 }}>
                      <img
                        src={p.preview}
                        alt={`Photo ${i + 1}`}
                        style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 'var(--radius-sm)', border: '1px solid var(--gray-200)' }}
                      />
                      <button
                        type="button"
                        onClick={() => removeReplyPhoto(i)}
                        title="Retirer cette photo"
                        style={{ position: 'absolute', top: -6, right: -6, width: 18, height: 18, borderRadius: '50%', border: 'none', background: 'var(--gray-700)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', padding: 0 }}
                      >
                        <X size={11} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <div style={{ display: 'flex', gap: '8px' }}>
                <input
                  className="form-input"
                  placeholder="Écrire une réponse..."
                  value={message}
                  onChange={e => setMessage(e.target.value)}
                />
                {replyPhotos.length < MAX_PHOTOS && (
                  <label className="btn btn-secondary" style={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center' }} title="Joindre une photo">
                    <Camera size={14} />
                    <input type="file" accept="image/*" multiple onChange={handleReplyPhotoChange} style={{ display: 'none' }} />
                  </label>
                )}
                <button type="submit" className="btn btn-secondary" disabled={sending || (!message.trim() && replyPhotos.length === 0)}>
                  {sending ? <div className="spinner dark" /> : <Send size={14} />}
                </button>
              </div>
            </form>
          </div>
        </div>

        {canValidate && (
          <div className="modal-footer" style={{ flexWrap: 'wrap', gap: '8px' }}>
            <button type="button" className="btn btn-secondary" onClick={onClose}>Fermer</button>
            {status === 'ouverte' ? (
              <>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => { if (confirm('Annuler cette demande ?')) handleCancel() }}
                  disabled={resolving}
                  style={{ color: 'var(--red)' }}
                >
                  Annuler
                </button>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => { if (confirm('Clôturer cette demande ?')) handleClose() }}
                  disabled={resolving}
                >
                  Clôturer
                </button>
                <button type="button" className="btn btn-primary" onClick={handleValidate} disabled={resolving}>
                  {resolving ? <><div className="spinner" /> ...</> : <><CheckCircle2 size={15} /> Marquer comme réalisée</>}
                </button>
              </>
            ) : (
              <button type="button" className="btn btn-secondary" onClick={handleReopen} disabled={resolving}>
                {resolving ? '...' : 'Rouvrir la demande'}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
