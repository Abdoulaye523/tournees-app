import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { supabase } from './supabase'
import { useAuth } from './AuthContext'
import toast from 'react-hot-toast'
import {
  Plus, X, Package, ShieldAlert, PackagePlus, Search, MessageSquare,
  CheckCircle2, Send, ClipboardList,
} from 'lucide-react'

const TYPES = {
  securisation: { label: 'Sécurisation', badge: 'badge-red', icon: ShieldAlert },
  ajout_non_planifie: { label: 'Ajout non planifié dans une tournée', badge: 'badge-orange', icon: PackagePlus },
  recherche_colis: { label: 'Recherche de colis', badge: 'badge-blue', icon: Search },
  autre: { label: 'Autres demandes', badge: 'badge-gray', icon: MessageSquare },
}

const BP_REQUIRED_TYPES = ['securisation', 'ajout_non_planifie', 'recherche_colis']

export default function Demandes() {
  const { profile } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()
  const basePath = profile?.role === 'admin' ? '/admin' : profile?.role === 'operator' ? '/operator' : '/partner'

  const canCreate = profile?.role === 'admin' || profile?.role === 'operator'
  const canValidate = profile?.role === 'admin' || profile?.role === 'operator'
  const canLinkToSearch = profile?.role === 'admin' || profile?.role === 'operator'

  const [demandes, setDemandes] = useState([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState('ouverte')
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [selected, setSelected] = useState(null)

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
        <div style={{ display: 'flex', gap: '8px', marginBottom: '20px' }}>
          {[
            { value: 'ouverte', label: 'Ouvertes' },
            { value: 'resolue', label: 'Résolues' },
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
        </div>

        <div className="card">
          {loading ? (
            <div className="loading-center"><div className="spinner dark" /></div>
          ) : demandes.length === 0 ? (
            <div className="empty-state">
              <ClipboardList size={36} className="empty-state-icon" />
              <p className="empty-state-title">Aucune demande</p>
              <p className="empty-state-sub">Les demandes créées apparaîtront ici.</p>
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
                  {demandes.map(d => {
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
                        </td>
                        <td>
                          <span className={`badge ${d.status === 'resolue' ? 'badge-green' : 'badge-orange'}`}>
                            {d.status === 'resolue' ? 'Résolue' : 'Ouverte'}
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
  const [saving, setSaving] = useState(false)

  const bpRequired = BP_REQUIRED_TYPES.includes(type)

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
    const { error } = await supabase.from('demandes').insert({
      type,
      bp: bpList,
      commentaire: commentaire.trim() || null,
      status: 'ouverte',
      created_by: user.id,
    })
    setSaving(false)
    if (error) {
      toast.error('Erreur : ' + error.message)
      return
    }
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
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose}>Annuler</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? <><div className="spinner" /> Création...</> : 'Créer la demande'}
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

  const t = TYPES[demande.type] || TYPES.autre

  useEffect(() => { fetchReponses() }, [demande.id])

  async function fetchReponses() {
    setLoading(true)
    const { data } = await supabase
      .from('demande_reponses')
      .select('*, author:author_id(full_name, email, role)')
      .eq('demande_id', demande.id)
      .order('created_at', { ascending: true })
    setReponses(data || [])
    setLoading(false)
  }

  async function handleSendMessage(e) {
    e.preventDefault()
    if (!message.trim()) return
    setSending(true)
    const { error } = await supabase.from('demande_reponses').insert({
      demande_id: demande.id,
      author_id: user.id,
      message: message.trim(),
    })
    setSending(false)
    if (error) return toast.error('Erreur : ' + error.message)
    setMessage('')
    fetchReponses()
  }

  async function handleValidate() {
    setResolving(true)
    const { error } = await supabase
      .from('demandes')
      .update({ status: 'resolue', resolved_by: user.id, resolved_at: new Date().toISOString() })
      .eq('id', demande.id)
    setResolving(false)
    if (error) return toast.error('Erreur : ' + error.message)
    toast.success('Demande marquée comme réalisée')
    setStatus('resolue')
    onChanged()
  }

  async function handleReopen() {
    setResolving(true)
    const { error } = await supabase
      .from('demandes')
      .update({ status: 'ouverte', resolved_by: null, resolved_at: null })
      .eq('id', demande.id)
    setResolving(false)
    if (error) return toast.error('Erreur : ' + error.message)
    toast.success('Demande rouverte')
    setStatus('ouverte')
    onChanged()
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: '560px' }}>
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span className={`badge ${t.badge}`}>{t.label}</span>
              <span className={`badge ${status === 'resolue' ? 'badge-green' : 'badge-orange'}`}>
                {status === 'resolue' ? 'Résolue' : 'Ouverte'}
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

          <div style={{ fontSize: '12px', color: 'var(--gray-400)' }}>
            Créée par {demande.created_by_user?.full_name || demande.created_by_user?.email || '—'} le{' '}
            {new Date(demande.created_at).toLocaleString('fr-FR')}
            {status === 'resolue' && demande.resolved_at && (
              <> · Résolue par {demande.resolved_by_user?.full_name || demande.resolved_by_user?.email || '—'} le {new Date(demande.resolved_at).toLocaleString('fr-FR')}</>
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
                    <p style={{ fontSize: '13px', color: 'var(--gray-700)', whiteSpace: 'pre-wrap' }}>{r.message}</p>
                  </div>
                ))}
              </div>
            )}

            <form onSubmit={handleSendMessage} style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
              <input
                className="form-input"
                placeholder="Écrire une réponse..."
                value={message}
                onChange={e => setMessage(e.target.value)}
              />
              <button type="submit" className="btn btn-secondary" disabled={sending || !message.trim()}>
                <Send size={14} />
              </button>
            </form>
          </div>
        </div>

        {canValidate && (
          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose}>Fermer</button>
            {status === 'ouverte' ? (
              <button type="button" className="btn btn-primary" onClick={handleValidate} disabled={resolving}>
                {resolving ? <><div className="spinner" /> ...</> : <><CheckCircle2 size={15} /> Marquer comme réalisée</>}
              </button>
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
