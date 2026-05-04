import { useEffect, useState } from 'react'
import { supabase } from './supabase'
import { useAuth } from './AuthContext'
import { Plus, Trash2, AlertTriangle } from 'lucide-react'
import toast from 'react-hot-toast'

const TYPES_ANOMALIE = [
  'Comportement chauffeur',
  'Difficultés de déchargement',
  'Retard',
  'Remorque décrochée',
  'Réception informatique manquante',
]

export default function AnomaliesReception() {
  const { profile } = useAuth()
  const [anomalies, setAnomalies] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ numero_groupage: '', type_anomalie: '', commentaire: '' })
  const [saving, setSaving] = useState(false)

  const today = new Date().toISOString().split('T')[0]
  const todayLabel = new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })

  useEffect(() => { fetchAnomalies() }, [])

  async function fetchAnomalies() {
    setLoading(true)
    const { data } = await supabase
      .from('anomalies_reception')
      .select('*, users(full_name)')
      .eq('date_saisie', today)
      .order('created_at', { ascending: false })
    setAnomalies(data || [])
    setLoading(false)
  }

  function isToday(dateStr) {
    return dateStr?.startsWith(today)
  }

  async function handleSubmit() {
    if (!form.numero_groupage.trim()) return toast.error('Saisissez un numéro de groupage.')
    if (!form.type_anomalie) return toast.error('Sélectionnez un type d\'anomalie.')
    setSaving(true)
    const { error } = await supabase.from('anomalies_reception').insert({
      numero_groupage: form.numero_groupage.trim(),
      type_anomalie: form.type_anomalie,
      commentaire: form.commentaire.trim() || null,
      created_by: profile?.id,
      date_saisie: today,
    })
    if (error) {
      toast.error('Erreur lors de la création.')
    } else {
      toast.success('Anomalie enregistrée.')
      setForm({ numero_groupage: '', type_anomalie: '', commentaire: '' })
      setShowForm(false)
      fetchAnomalies()
    }
    setSaving(false)
  }

  async function handleDelete(id) {
    if (!confirm('Supprimer cette anomalie ?')) return
    const { error } = await supabase.from('anomalies_reception').delete().eq('id', id)
    if (error) toast.error('Erreur lors de la suppression.')
    else { toast.success('Anomalie supprimée.'); fetchAnomalies() }
  }

  function typeBadgeColor(type) {
    const map = {
      'Comportement chauffeur': '#7c3aed',
      'Difficultés de déchargement': '#d97706',
      'Retard': '#dc2626',
      'Remorque décrochée': '#0284c7',
      'Réception informatique manquante': '#059669',
    }
    return map[type] || '#6b7280'
  }

  // Grouper par numéro de groupage
  const byGroupage = anomalies.reduce((acc, a) => {
    if (!acc[a.numero_groupage]) acc[a.numero_groupage] = []
    acc[a.numero_groupage].push(a)
    return acc
  }, {})

  return (
    <>
      <div className="page-header">
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <div>
            <h2 className="page-title">Anomalies réception</h2>
            <p className="page-subtitle" style={{ textTransform: 'capitalize' }}>{todayLabel}</p>
          </div>
          <button className="btn btn-primary btn-sm" onClick={() => setShowForm(!showForm)} style={{ paddingTop: 4 }}>
            <Plus size={14} /> Nouvelle anomalie
          </button>
        </div>
      </div>

      <div className="page-body">

        {/* Formulaire */}
        {showForm && (
          <div className="card" style={{ marginBottom: 20, overflow: 'hidden' }}>
            <div className="card-header">
              <span className="card-title">Signaler une anomalie</span>
            </div>
            <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div className="form-group">
                <label className="form-label">Numéro de groupage *</label>
                <input
                  className="form-input"
                  placeholder="Ex: GRP-2026-001"
                  value={form.numero_groupage}
                  onChange={e => setForm(f => ({ ...f, numero_groupage: e.target.value }))}
                />
              </div>
              <div className="form-group">
                <label className="form-label">Type d'anomalie *</label>
                <select
                  className="form-input"
                  value={form.type_anomalie}
                  onChange={e => setForm(f => ({ ...f, type_anomalie: e.target.value }))}
                >
                  <option value="">Sélectionner...</option>
                  {TYPES_ANOMALIE.map(t => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Commentaire</label>
                <textarea
                  className="form-input"
                  placeholder="Détails supplémentaires..."
                  value={form.commentaire}
                  onChange={e => setForm(f => ({ ...f, commentaire: e.target.value }))}
                  rows={3}
                  style={{ resize: 'vertical' }}
                />
              </div>
              <div style={{ display: 'flex', gap: 10 }}>
                <button className="btn btn-primary" onClick={handleSubmit} disabled={saving}>
                  {saving ? <><div className="spinner" /> Enregistrement...</> : <><Plus size={14} /> Enregistrer</>}
                </button>
                <button className="btn btn-ghost" onClick={() => { setShowForm(false); setForm({ numero_groupage: '', type_anomalie: '', commentaire: '' }) }}>
                  Annuler
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Liste */}
        {loading ? (
          <div className="loading-center"><div className="spinner dark" /></div>
        ) : Object.keys(byGroupage).length === 0 ? (
          <div className="card">
            <div className="empty-state">
              <AlertTriangle size={40} className="empty-state-icon" />
              <p className="empty-state-title">Aucune anomalie aujourd'hui</p>
              <p className="empty-state-sub">Cliquez sur "Nouvelle anomalie" pour en signaler une.</p>
            </div>
          </div>
        ) : (
          Object.entries(byGroupage).map(([groupage, items]) => (
            <div key={groupage} className="card" style={{ marginBottom: 16, overflow: 'hidden' }}>
              {/* Header groupage */}
              <div style={{ padding: '10px 16px', background: 'var(--gray-50)', borderBottom: '1px solid var(--gray-100)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 14, color: 'var(--gray-800)' }}>
                    Groupage #{groupage}
                  </span>
                  <span className="badge badge-gray">{items.length} anomalie{items.length > 1 ? 's' : ''}</span>
                </div>
              </div>

              {/* Anomalies du groupage */}
              {items.map(a => (
                <div key={a.id} style={{ padding: '12px 16px', borderBottom: '1px solid var(--gray-100)', display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
                      <span style={{
                        fontSize: 12, fontWeight: 600, padding: '2px 10px', borderRadius: 100,
                        background: typeBadgeColor(a.type_anomalie) + '20',
                        color: typeBadgeColor(a.type_anomalie),
                        border: `1px solid ${typeBadgeColor(a.type_anomalie)}40`,
                      }}>
                        {a.type_anomalie}
                      </span>
                      <span style={{ fontSize: 11, color: 'var(--gray-400)' }}>
                        {new Date(a.created_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                        {a.users?.full_name && ` · ${a.users.full_name}`}
                      </span>
                    </div>
                    {a.commentaire && (
                      <p style={{ fontSize: 13, color: 'var(--gray-600)', margin: 0 }}>{a.commentaire}</p>
                    )}
                  </div>
                  {isToday(a.created_at) && (
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={() => handleDelete(a.id)}
                      style={{ color: 'var(--red)', flexShrink: 0 }}
                    >
                      <Trash2 size={13} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          ))
        )}
      </div>
    </>
  )
}
