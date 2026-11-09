import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { supabase } from './supabase'
import { useAuth } from './AuthContext'
import toast from 'react-hot-toast'
import { CheckCircle2, ExternalLink } from 'lucide-react'
import { CHECKLIST_ITEMS, localToday, getNextPreparation } from './checklistItems'

const fmtDate = d => new Date(d + 'T12:00:00').toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })

export default function Checklist() {
  const { user } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()
  const today = localToday()
  const date = searchParams.get('date') && searchParams.get('date') <= today ? searchParams.get('date') : today
  const [checks, setChecks] = useState({}) // key -> { at, who }
  const [prep, setPrep] = useState(null) // préparation du prochain jour de livraison
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(null)

  useEffect(() => { loadChecks(date) }, [date])

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

    // Point automatique : une préparation existe pour le prochain jour de livraison (J+1, ou J+3 avant un week-end)
    try { setPrep(await getNextPreparation(d)) } catch { setPrep(null) }
    setLoading(false)
  }

  function chooseDate(d) {
    setSearchParams(d && d !== today ? { date: d } : {})
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

  const isDone = item => item.auto ? !!prep : !!checks[item.key]
  const doneCount = CHECKLIST_ITEMS.filter(isDone).length
  const total = CHECKLIST_ITEMS.length
  const complete = doneCount === total

  return (
    <>
      <div className="page-header">
        <h2 className="page-title">Checklist</h2>
        <p className="page-subtitle">Tâches de fin de journée, à cocher chaque jour. Le rapport par email ne peut être envoyé que lorsque la checklist du jour est complète.</p>
      </div>

      <div className="page-body">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
          <input
            type="date"
            className="form-input"
            style={{ maxWidth: 190 }}
            value={date}
            max={today}
            onChange={e => chooseDate(e.target.value)}
          />
          <span style={{ fontSize: 14, color: 'var(--gray-600)', textTransform: 'capitalize' }}>{fmtDate(date)}{date === today ? ' (aujourd\'hui)' : ''}</span>
          <span className={`badge ${complete ? 'badge-green' : 'badge-orange'}`}>{doneCount}/{total}</span>
          {complete && <span style={{ fontSize: 13, color: 'var(--green)' }}>Checklist complète : le rapport peut être envoyé.</span>}
        </div>

        <div className="card">
          {loading ? (
            <div className="loading-center"><div className="spinner dark" /></div>
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
                          {prep ? `Coché automatiquement : préparation trouvée pour ${fmtDate(prep.date)} (${prep.tours} tournées).` : 'Se coche automatiquement dès que le PDF du prochain jour de livraison est importé.'}
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
