import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { supabase } from './supabase'
import { useAuth } from './AuthContext'
import toast from 'react-hot-toast'
import { CheckCircle2, ListChecks, ExternalLink } from 'lucide-react'
import { CHECKLIST_ITEMS } from './checklistItems'

// Date du jour en heure locale (et non UTC, qui décale la journée autour de minuit)
const localToday = () => new Date().toLocaleDateString('en-CA')

const fmtDate = d => new Date(d + 'T12:00:00').toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })

export default function Checklist() {
  const { user } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()
  const [dates, setDates] = useState([]) // [{ id, delivery_date }]
  const [date, setDate] = useState(searchParams.get('date'))
  const [checks, setChecks] = useState({}) // key -> { checked_at, who }
  const [importDone, setImportDone] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(null)

  useEffect(() => { loadDates() }, [])
  useEffect(() => { if (date) loadChecks(date) }, [date, dates])

  async function loadDates() {
    const { data, error } = await supabase
      .from('delivery_dates')
      .select('id, delivery_date')
      .lte('delivery_date', localToday()) // jamais la journée du lendemain
      .order('delivery_date', { ascending: false })
      .limit(30)
    if (error) { toast.error('Erreur de chargement : ' + error.message); setLoading(false); return }
    setDates(data || [])
    if (!date && data?.length) {
      // journée du jour si elle existe, sinon la plus récente avant aujourd'hui
      setDate(data[0].delivery_date)
    }
    if (!data?.length) setLoading(false)
  }

  async function loadChecks(d) {
    setLoading(true)
    const { data, error } = await supabase
      .from('checklist_checks')
      .select('item_key, checked_at, checked_by_user:checked_by(full_name, email)')
      .eq('delivery_date', d)
    if (error) toast.error('Erreur de chargement : ' + error.message)
    const map = {}
    ;(data || []).forEach(r => {
      map[r.item_key] = { at: r.checked_at, who: r.checked_by_user?.full_name || r.checked_by_user?.email }
    })
    setChecks(map)

    // Étape 1 automatique : l'import est fait dès que des tournées existent pour cette date
    const row = dates.find(x => x.delivery_date === d)
    if (row) {
      const { count } = await supabase.from('tours').select('id', { count: 'exact', head: true }).eq('delivery_date_id', row.id)
      setImportDone((count || 0) > 0)
    }
    setLoading(false)
  }

  function chooseDate(d) {
    setDate(d)
    setSearchParams({ date: d })
  }

  async function toggle(item) {
    if (item.auto) return
    setSaving(item.key)
    const wasChecked = !!checks[item.key]
    const { error } = wasChecked
      ? await supabase.from('checklist_checks').delete().eq('delivery_date', date).eq('item_key', item.key)
      : await supabase.from('checklist_checks').insert({ delivery_date: date, item_key: item.key, checked_by: user.id })
    setSaving(null)
    if (error) return toast.error('Erreur : ' + error.message)
    loadChecks(date)
  }

  const isDone = item => item.auto ? importDone : !!checks[item.key]
  const doneCount = CHECKLIST_ITEMS.filter(isDone).length
  const total = CHECKLIST_ITEMS.length
  const complete = doneCount === total

  return (
    <>
      <div className="page-header">
        <h2 className="page-title">Checklist</h2>
        <p className="page-subtitle">À compléter avant de valider le contrôle et d'envoyer le rapport par email</p>
      </div>

      <div className="page-body">
        {dates.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
            <select className="form-input" style={{ maxWidth: 320 }} value={date || ''} onChange={e => chooseDate(e.target.value)}>
              {dates.map(d => <option key={d.id} value={d.delivery_date}>{fmtDate(d.delivery_date)}</option>)}
            </select>
            <span className={`badge ${complete ? 'badge-green' : 'badge-orange'}`}>{doneCount}/{total}</span>
            {complete && <span style={{ fontSize: 13, color: 'var(--green)' }}>Checklist complète : le contrôle peut être validé.</span>}
          </div>
        )}

        <div className="card">
          {loading ? (
            <div className="loading-center"><div className="spinner dark" /></div>
          ) : dates.length === 0 ? (
            <div className="empty-state">
              <ListChecks size={36} className="empty-state-icon" />
              <p className="empty-state-title">Aucune journée</p>
              <p className="empty-state-sub">Importez un PDF de tournées pour créer une journée.</p>
            </div>
          ) : (
            <div>
              {CHECKLIST_ITEMS.map((item, idx) => {
                const done = isDone(item)
                const meta = checks[item.key]
                return (
                  <label
                    key={item.key}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 12, padding: '14px 18px',
                      borderTop: idx ? '1px solid var(--gray-100)' : 'none',
                      cursor: item.auto ? 'default' : 'pointer',
                      background: done ? 'rgba(5,150,105,0.05)' : 'transparent',
                      opacity: saving === item.key ? 0.6 : 1,
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={done}
                      disabled={item.auto || saving === item.key}
                      onChange={() => toggle(item)}
                      style={{ width: 20, height: 20, flexShrink: 0 }}
                    />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 14, color: done ? 'var(--gray-500)' : 'var(--gray-800)', textDecoration: done ? 'line-through' : 'none' }}>
                        {item.label}
                      </div>
                      {item.auto && (
                        <div style={{ fontSize: 12, color: 'var(--gray-400)', marginTop: 2 }}>
                          {importDone ? 'Coché automatiquement : des tournées ont été importées pour cette journée.' : 'Se coche automatiquement dès que le PDF est importé.'}
                        </div>
                      )}
                      {meta && (
                        <div style={{ fontSize: 12, color: 'var(--gray-400)', marginTop: 2 }}>
                          {meta.who || '—'} · {new Date(meta.at).toLocaleString('fr-FR')}
                        </div>
                      )}
                    </div>
                    {item.link && (
                      <Link to={item.link} onClick={e => e.stopPropagation()} className="btn btn-ghost btn-sm" title="Ouvrir la page">
                        <ExternalLink size={14} />
                      </Link>
                    )}
                    {done && <CheckCircle2 size={16} color="#059669" />}
                  </label>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </>
  )
}
