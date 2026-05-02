import { useState } from 'react'
import { supabase } from './supabase'
import { Search, Package, AlertTriangle, CheckCircle, XCircle, Clock } from 'lucide-react'

export default function SearchParcel() {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(false)
  const [searched, setSearched] = useState(false)

  async function handleSearch(e) {
    e?.preventDefault()
    if (!query.trim()) return
    setLoading(true)
    setSearched(true)
    const { data } = await supabase.rpc('search_parcel', { p_barcode: query.trim() })
    setResults(data || [])
    setLoading(false)
  }

  function resultBadge(type) {
    const map = {
      ok: { label: 'Conforme', cls: 'badge-green' },
      already_scanned: { label: 'Déjà scanné', cls: 'badge-blue' },
      unknown: { label: 'Inconnu', cls: 'badge-orange' },
      wrong_tour: { label: 'Mauvaise tournée', cls: 'badge-red' },
    }
    const s = map[type]
    if (!s) return null
    return <span className={`badge ${s.cls}`}>{s.label}</span>
  }

  return (
    <>
      <div className="page-header">
        <h2 className="page-title">Recherche de colis</h2>
        <p className="page-subtitle">Retrouvez un colis par son numéro de barcode</p>
      </div>

      <div className="page-body">
        <form onSubmit={handleSearch} style={{ display: 'flex', gap: '10px', maxWidth: '500px', marginBottom: '24px' }}>
          <input
            className="form-input"
            placeholder="Numéro de colis (partiel ou complet)"
            value={query}
            onChange={e => setQuery(e.target.value)}
            autoFocus
          />
          <button className="btn btn-primary" type="submit" disabled={loading}>
            <Search size={15} />
            {loading ? 'Recherche...' : 'Chercher'}
          </button>
        </form>

        {loading && <div className="loading-center"><div className="spinner dark" /></div>}

        {!loading && searched && (
          results.length === 0 ? (
            <div className="card">
              <div className="empty-state">
                <Package size={36} className="empty-state-icon" />
                <p className="empty-state-title">Aucun colis trouvé</p>
                <p className="empty-state-sub">Vérifiez le numéro et réessayez.</p>
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {results.map((r, i) => (
                <div key={i} className="card" style={{ overflow: 'hidden' }}>
                  {/* Header */}
                  <div style={{ padding: '12px 16px', background: 'var(--gray-50)', borderBottom: '1px solid var(--gray-100)', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                    <code style={{ fontFamily: 'monospace', fontSize: 14, fontWeight: 700, background: 'var(--gray-200)', padding: '3px 10px', borderRadius: 6 }}>
                      {r.barcode}
                    </code>
                    {r.excluded && <span className="badge badge-gray">Reprise</span>}
                    {r.was_missing && (
                      <span className="badge badge-red" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <XCircle size={11} /> Manquant à l'archivage
                      </span>
                    )}
                    {r.last_scan_result ? resultBadge(r.last_scan_result) : (
                      <span style={{ fontSize: 12, color: 'var(--gray-400)' }}>Non scanné</span>
                    )}
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 0 }}>
                    {/* Tournée */}
                    <div style={{ padding: '12px 16px', borderRight: '1px solid var(--gray-100)', borderBottom: '1px solid var(--gray-100)' }}>
                      <div style={{ fontSize: 11, color: 'var(--gray-400)', marginBottom: 4 }}>Tournée</div>
                      <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 14, color: 'var(--gray-800)' }}>
                        {r.reference_name || r.tour_name}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--gray-400)', marginTop: 2 }}>
                        {r.delivery_date ? new Date(r.delivery_date + 'T12:00:00').toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) : '—'}
                      </div>
                    </div>

                    {/* Dernier scan */}
                    <div style={{ padding: '12px 16px', borderRight: '1px solid var(--gray-100)', borderBottom: '1px solid var(--gray-100)' }}>
                      <div style={{ fontSize: 11, color: 'var(--gray-400)', marginBottom: 4 }}>Dernier scan</div>
                      {r.last_scan_at ? (
                        <>
                          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--gray-800)' }}>
                            {new Date(r.last_scan_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                          </div>
                          <div style={{ fontSize: 11, color: 'var(--gray-400)' }}>
                            {new Date(r.last_scan_at).toLocaleDateString('fr-FR')}
                          </div>
                        </>
                      ) : (
                        <div style={{ fontSize: 13, color: 'var(--gray-300)' }}>—</div>
                      )}
                    </div>

                    {/* Scanné par */}
                    <div style={{ padding: '12px 16px', borderRight: '1px solid var(--gray-100)', borderBottom: '1px solid var(--gray-100)' }}>
                      <div style={{ fontSize: 11, color: 'var(--gray-400)', marginBottom: 4 }}>Scanné par</div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--gray-800)' }}>
                        {r.last_scan_by || <span style={{ color: 'var(--gray-300)' }}>—</span>}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--gray-400)', marginTop: 2 }}>
                        {r.scan_count > 0 ? `${r.scan_count} scan${r.scan_count > 1 ? 's' : ''} au total` : 'Aucun scan'}
                      </div>
                    </div>

                    {/* Mauvaise tournée */}
                    {r.last_scan_result === 'wrong_tour' && r.wrong_tour_name && (
                      <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--gray-100)', background: '#fff5f5' }}>
                        <div style={{ fontSize: 11, color: 'var(--red)', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
                          <AlertTriangle size={11} /> Scanned dans mauvaise tournée
                        </div>
                        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--red)' }}>
                          {r.wrong_tour_name}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )
        )}
      </div>
    </>
  )
}
