import { useEffect, useState } from 'react'
import { supabase } from './supabase'
import { RefreshCw, Package, AlertTriangle } from 'lucide-react'

export default function AnomaliesPreparation() {
  const [data, setData] = useState([]) // [{ tour, parcels: [{ barcode, lastWrongTour }] }]
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('')

  useEffect(() => { fetchData() }, [])

  async function fetchData() {
    setLoading(true)

    // Récupérer les tournées non archivées
    const { data: tours } = await supabase
      .from('tours')
      .select('id, name, reference_id, delivery_date_id, tours_references(name), delivery_dates(delivery_date)')
      .eq('archived', false)
      .eq('status', 'pending')
      .order('delivery_date_id', { ascending: false })

    if (!tours || tours.length === 0) { setData([]); setLoading(false); return }

    const results = []

    for (const tour of tours) {
      // Colis actifs de la tournée
      const { data: parcels } = await supabase
        .from('parcels')
        .select('id, barcode')
        .eq('tour_id', tour.id)
        .eq('excluded', false)

      if (!parcels || parcels.length === 0) continue

      // Barcodes scannés ok
      const { data: scans } = await supabase
        .from('scan_events')
        .select('barcode_scanned')
        .eq('tour_id', tour.id)
        .in('result_type', ['ok', 'already_scanned'])

      const scannedBarcodes = new Set((scans || []).map(s => s.barcode_scanned))
      const missingParcels = parcels.filter(p => !scannedBarcodes.has(p.barcode))

      if (missingParcels.length === 0) continue

      // Pour chaque colis manquant, chercher la dernière anomalie
      const parcelsWithInfo = await Promise.all(missingParcels.map(async (p) => {
        const { data: wrongScan } = await supabase
          .from('scan_events')
          .select('tour_id, tours(name, tours_references(name))')
          .eq('barcode_scanned', p.barcode)
          .eq('result_type', 'wrong_tour')
          .order('scanned_at', { ascending: false })
          .limit(1)
          .maybeSingle()

        const wrongTourName = wrongScan?.tours?.tours_references?.name || wrongScan?.tours?.name || null

        return { barcode: p.barcode, wrongTourName }
      }))

      results.push({ tour, parcels: parcelsWithInfo })
    }

    setData(results)
    setLoading(false)
  }

  const filtered = data.filter(({ tour }) => {
    const refName = tour.tours_references?.name || tour.name
    return !filter || refName.toLowerCase().includes(filter.toLowerCase())
  })

  const totalMissing = filtered.reduce((acc, d) => acc + d.parcels.length, 0)

  return (
    <>
      <div className="page-header">
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <div>
            <h2 className="page-title">Anomalies préparation</h2>
            <p className="page-subtitle">Colis manquants dans les tournées non validées</p>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={fetchData} style={{ paddingTop: 4 }}>
            <RefreshCw size={14} /> Actualiser
          </button>
        </div>
      </div>

      <div className="page-body">
        {/* Résumé */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 12, marginBottom: 20 }}>
          <div style={{ background: 'var(--white)', borderRadius: 'var(--radius)', border: '1px solid var(--gray-200)', borderTop: '3px solid var(--red)', padding: '14px 16px', boxShadow: 'var(--shadow-sm)' }}>
            <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 28, color: 'var(--red)' }}>{totalMissing}</div>
            <div style={{ fontSize: 12, color: 'var(--gray-400)', marginTop: 2 }}>Colis manquants</div>
          </div>
          <div style={{ background: 'var(--white)', borderRadius: 'var(--radius)', border: '1px solid var(--gray-200)', borderTop: '3px solid var(--accent)', padding: '14px 16px', boxShadow: 'var(--shadow-sm)' }}>
            <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 28, color: 'var(--accent)' }}>{filtered.length}</div>
            <div style={{ fontSize: 12, color: 'var(--gray-400)', marginTop: 2 }}>Tournées concernées</div>
          </div>
        </div>

        {/* Filtre */}
        <div style={{ marginBottom: 16 }}>
          <input
            className="form-input"
            placeholder="Rechercher une tournée..."
            value={filter}
            onChange={e => setFilter(e.target.value)}
            style={{ maxWidth: 320 }}
          />
        </div>

        {loading ? (
          <div className="loading-center"><div className="spinner dark" /></div>
        ) : filtered.length === 0 ? (
          <div className="card">
            <div className="empty-state">
              <Package size={40} className="empty-state-icon" style={{ color: 'var(--green)' }} />
              <p className="empty-state-title">Aucun colis manquant !</p>
              <p className="empty-state-sub">Toutes les tournées non validées sont complètes.</p>
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {filtered.map(({ tour, parcels }) => {
              const refName = tour.tours_references?.name || tour.name
              const dateLabel = tour.delivery_dates?.delivery_date
                ? new Date(tour.delivery_dates.delivery_date + 'T12:00:00').toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' })
                : ''
              const withAnomaly = parcels.filter(p => p.wrongTourName)

              return (
                <div key={tour.id} className="card" style={{ overflow: 'hidden' }}>
                  {/* Header tournée */}
                  <div style={{ padding: '10px 16px', background: 'var(--gray-50)', borderBottom: '1px solid var(--gray-100)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 15, color: 'var(--gray-800)' }}>{refName}</span>
                      {dateLabel && <span style={{ fontSize: 12, color: 'var(--gray-400)' }}>{dateLabel}</span>}
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <span className="badge badge-red">{parcels.length} manquant{parcels.length > 1 ? 's' : ''}</span>
                      {withAnomaly.length > 0 && (
                        <span className="badge badge-orange">{withAnomaly.length} en anomalie</span>
                      )}
                    </div>
                  </div>

                  {/* Liste colis */}
                  <div style={{ maxHeight: 300, overflowY: 'auto' }}>
                    {parcels.map(p => (
                      <div key={p.barcode} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 16px', borderBottom: '1px solid var(--gray-100)', background: p.wrongTourName ? '#fff7ed' : undefined }}>
                        <span style={{ width: 18, height: 18, borderRadius: '50%', flexShrink: 0, background: p.wrongTourName ? '#fff7ed' : 'var(--red-light)', color: p.wrongTourName ? '#d97706' : 'var(--red)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700 }}>
                          {p.wrongTourName ? '⚠' : '✗'}
                        </span>
                        <code style={{ fontSize: 12, color: 'var(--gray-700)', flex: 1 }}>{p.barcode}</code>
                        {p.wrongTourName && (
                          <span style={{ fontSize: 11, color: '#d97706', display: 'flex', alignItems: 'center', gap: 4 }}>
                            <AlertTriangle size={11} />
                            Scanné dans <strong style={{ marginLeft: 3 }}>{p.wrongTourName}</strong>
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </>
  )
}
