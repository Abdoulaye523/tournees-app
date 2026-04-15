import { useEffect, useState, useRef, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from './supabase'
import { useAuth } from './AuthContext'
import { ArrowLeft, Package, CheckCircle, Wifi, WifiOff, Keyboard } from 'lucide-react'

const POPUP_DURATION = 2500

const SCAN_RESULTS = {
  ok: {
    label: 'Colis conforme',
    sub: 'Présent sur cette tournée',
    cls: 'ok',
    icon: '✓',
    color: '#059669',
  },
  already_scanned: {
    label: 'Colis déjà scanné',
    sub: 'Ce colis a déjà été contrôlé',
    cls: 'already',
    icon: '↺',
    color: '#2563eb',
  },
  unknown: {
    label: 'Colis inconnu',
    sub: 'Ce code-barres n\'est pas reconnu',
    cls: 'unknown',
    icon: '?',
    color: '#d97706',
  },
  wrong_tour: {
    label: 'Anomalie — mauvaise tournée',
    sub: 'Ce colis appartient à une autre tournée',
    cls: 'wrong',
    icon: '⚠',
    color: '#dc2626',
  },
}

export default function ScanPage() {
  const { tourId } = useParams()
  const { profile } = useAuth()
  const navigate = useNavigate()

  const [tour, setTour] = useState(null)
  const [summary, setSummary] = useState(null)
  const [loading, setLoading] = useState(true)
  const [popup, setPopup] = useState(null)
  const [lastScans, setLastScans] = useState([])
  const [scanInput, setScanInput] = useState('')   // input TC51 invisible
  const [manualInput, setManualInput] = useState('') // saisie manuelle
  const [manualMode, setManualMode] = useState(false) // mode saisie manuelle actif
  const [online, setOnline] = useState(navigator.onLine)

  const scanInputRef = useRef(null)
  const manualInputRef = useRef(null)
  const popupTimer = useRef(null)
  const bufferTimer = useRef(null)

  // Connexion réseau
  useEffect(() => {
    const on = () => setOnline(true)
    const off = () => setOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off) }
  }, [])

  // Chargement tournée
  useEffect(() => { fetchTour() }, [tourId])

  // Maintenir focus sur l'input TC51 quand on n'est pas en mode manuel
  useEffect(() => {
    if (manualMode) return
    const keepFocus = () => {
      if (document.activeElement !== scanInputRef.current) {
        scanInputRef.current?.focus()
      }
    }
    const interval = setInterval(keepFocus, 300)
    scanInputRef.current?.focus()
    return () => clearInterval(interval)
  }, [manualMode])

  // Focus sur l'input manuel quand on active le mode
  useEffect(() => {
    if (manualMode) {
      setTimeout(() => manualInputRef.current?.focus(), 50)
    }
  }, [manualMode])

  // Realtime scan events
  useEffect(() => {
    if (!tourId) return
    const channel = supabase
      .channel(`tour-${tourId}`)
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'scan_events',
        filter: `tour_id=eq.${tourId}`,
      }, () => fetchSummary())
      .subscribe()
    return () => supabase.removeChannel(channel)
  }, [tourId])

  async function fetchTour() {
    const { data: tourData } = await supabase
      .from('tours').select('*').eq('id', tourId).single()
    const { data: summaryData } = await supabase
      .from('tour_scan_summary').select('*').eq('tour_id', tourId).single()
    const { data: recentScans } = await supabase
      .from('scan_events')
      .select('*, users(full_name)')
      .eq('tour_id', tourId)
      .order('scanned_at', { ascending: false })
      .limit(10)

    setTour(tourData)
    setSummary(summaryData)
    setLastScans(recentScans || [])
    setLoading(false)
  }

  async function fetchSummary() {
    const { data } = await supabase
      .from('tour_scan_summary').select('*').eq('tour_id', tourId).single()
    setSummary(data)
    const { data: recentScans } = await supabase
      .from('scan_events')
      .select('*, users(full_name)')
      .eq('tour_id', tourId)
      .order('scanned_at', { ascending: false })
      .limit(10)
    setLastScans(recentScans || [])
  }

  // Traitement d'un barcode scanné ou saisi
  const processScan = useCallback(async (barcode) => {
    const bc = barcode.trim()
    if (!bc || bc.length < 5) return

    const { data: parcel } = await supabase
      .from('parcels')
      .select('*, tours(id, name)')
      .eq('barcode', bc)
      .single()

    let resultType
    let parcelId = null

    if (!parcel) {
      resultType = 'unknown'
    } else if (parcel.excluded) {
      resultType = 'unknown'
      parcelId = parcel.id
    } else if (parcel.tour_id !== tourId) {
      resultType = 'wrong_tour'
      parcelId = parcel.id
    } else {
      const { data: existingScan } = await supabase
        .from('scan_events')
        .select('id')
        .eq('tour_id', tourId)
        .eq('parcel_id', parcel.id)
        .in('result_type', ['ok', 'already_scanned'])
        .limit(1)
        .single()

      resultType = existingScan ? 'already_scanned' : 'ok'
      parcelId = parcel.id
    }

    await supabase.from('scan_events').insert({
      tour_id: tourId,
      parcel_id: parcelId,
      user_id: profile.id,
      barcode_scanned: bc,
      result_type: resultType,
    })

    showPopup(resultType, bc)
    fetchSummary()
  }, [tourId, profile])

  function showPopup(type, barcode) {
    if (popupTimer.current) clearTimeout(popupTimer.current)
    setPopup({ type, barcode })
    popupTimer.current = setTimeout(() => setPopup(null), POPUP_DURATION)
  }

  // Gestion input TC51 (auto-détection sans Entrée)
  function handleScanInput(e) {
    const val = e.target.value
    setScanInput(val)

    if (val.includes('\n') || val.includes('\r')) {
      const bc = val.replace(/[\n\r]/g, '').trim()
      if (bc.length >= 5) { processScan(bc); setScanInput('') }
      return
    }

    if (bufferTimer.current) clearTimeout(bufferTimer.current)
    bufferTimer.current = setTimeout(() => {
      const bc = val.trim()
      if (bc.length >= 5) { processScan(bc); setScanInput('') }
    }, 150)
  }

  function handleScanKeyDown(e) {
    if (e.key === 'Enter') {
      e.preventDefault()
      const bc = scanInput.trim()
      if (bc.length >= 5) {
        if (bufferTimer.current) clearTimeout(bufferTimer.current)
        processScan(bc)
        setScanInput('')
      }
    }
  }

  // Gestion saisie manuelle
  function handleManualSubmit(e) {
    e?.preventDefault()
    const bc = manualInput.trim()
    if (bc.length >= 5) {
      processScan(bc)
      setManualInput('')
      // Remettre le focus sur l'input manuel pour enchaîner les saisies
      manualInputRef.current?.focus()
    }
  }

  function handleManualKeyDown(e) {
    if (e.key === 'Enter') handleManualSubmit()
    if (e.key === 'Escape') {
      setManualMode(false)
      setManualInput('')
    }
  }

  function toggleManualMode() {
    setManualMode(m => !m)
    setManualInput('')
  }

  if (loading) return (
    <div className="loading-center" style={{ height: '100%' }}>
      <div className="spinner dark" />
    </div>
  )

  const scanned = summary?.scanned_count || 0
  const total = summary?.total_parcels || 0
  const missing = summary?.missing_count || 0
  const anomalies = (summary?.wrong_tour_count || 0) + (summary?.unknown_count || 0)
  const pct = total > 0 ? Math.round((scanned / total) * 100) : 0

  return (
    <div className="scan-page">

      {/* Input invisible TC51 */}
      <input
        ref={scanInputRef}
        className="scanner-input"
        value={scanInput}
        onChange={handleScanInput}
        onKeyDown={handleScanKeyDown}
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        tabIndex={-1}
        aria-hidden="true"
      />

      {/* Popup résultat */}
      {popup && (
        <div className={`scan-overlay ${SCAN_RESULTS[popup.type].cls}`}>
          <div className="scan-overlay-icon">{SCAN_RESULTS[popup.type].icon}</div>
          <div>
            <div className="scan-overlay-title">{SCAN_RESULTS[popup.type].label}</div>
            <div className="scan-overlay-sub">
              {SCAN_RESULTS[popup.type].sub}
              <span style={{ display: 'block', opacity: 0.7, fontSize: '11px', marginTop: '2px', fontFamily: 'monospace' }}>
                {popup.barcode}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="scan-header">
        <button className="btn btn-ghost btn-sm" onClick={() => navigate('/operator')}>
          <ArrowLeft size={15} /> Retour
        </button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h2 style={{
            fontFamily: 'var(--font-display)', fontSize: 'clamp(16px, 4vw, 22px)',
            fontWeight: 800, color: 'var(--gray-800)', letterSpacing: '-0.3px',
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>
            {tour?.name}
          </h2>
          <p style={{ fontSize: '13px', color: 'var(--gray-400)' }}>Contrôle en cours</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '12px', color: online ? 'var(--green)' : 'var(--red)' }}>
            {online ? <Wifi size={13} /> : <WifiOff size={13} />}
            <span style={{ display: 'none' }}>{online ? 'En ligne' : 'Hors ligne'}</span>
          </div>
          <button
            className={`btn btn-sm ${manualMode ? 'btn-primary' : 'btn-secondary'}`}
            onClick={toggleManualMode}
            title="Saisie manuelle"
          >
            <Keyboard size={14} />
            <span style={{ display: 'none' }}>Manuel</span>
          </button>
        </div>
      </div>

      {/* Compteurs */}
      <div className="scan-counters">

        {/* Scannés */}
        <div className="scan-counter" style={{ borderTop: '3px solid var(--accent)' }}>
          <div>
            <span className="scan-counter-value">{scanned}</span>
            <span className="scan-counter-total"> / {total}</span>
          </div>
          <div className="scan-counter-label">Scannés</div>
          <div style={{ width: '100%', marginTop: '6px' }}>
            <div className="progress-bar">
              <div
                className={`progress-fill ${pct === 100 ? 'green' : ''}`}
                style={{ width: `${pct}%` }}
              />
            </div>
            <div style={{ fontSize: '11px', color: 'var(--gray-400)', marginTop: '3px', textAlign: 'right' }}>
              {pct}%
            </div>
          </div>
        </div>

        {/* Manquants */}
        <div className="scan-counter" style={{ borderTop: `3px solid ${missing > 0 ? 'var(--red)' : 'var(--green)'}` }}>
          <div className="scan-counter-value" style={{ color: missing > 0 ? 'var(--red)' : 'var(--green)' }}>
            {missing}
          </div>
          <div className="scan-counter-label">Manquants</div>
          {missing === 0 && scanned > 0 && <CheckCircle size={14} color="var(--green)" />}
        </div>

        {/* Anomalies */}
        <div className="scan-counter" style={{ borderTop: `3px solid ${anomalies > 0 ? 'var(--orange)' : 'var(--gray-200)'}` }}>
          <div className="scan-counter-value" style={{ color: anomalies > 0 ? 'var(--orange)' : 'var(--gray-300)' }}>
            {anomalies}
          </div>
          <div className="scan-counter-label">Anomalies</div>
          {anomalies > 0 && (
            <div style={{ fontSize: '10px', color: 'var(--gray-400)', textAlign: 'center', lineHeight: 1.3 }}>
              {summary?.wrong_tour_count || 0} tournée · {summary?.unknown_count || 0} inconnus
            </div>
          )}
        </div>
      </div>

      {/* Zone de scan / saisie manuelle */}
      {manualMode ? (
        <div style={{
          background: 'var(--white)',
          borderRadius: 'var(--radius)',
          border: '2px solid var(--accent)',
          padding: '20px',
          display: 'flex',
          flexDirection: 'column',
          gap: '12px',
        }}>
          <div style={{ fontSize: '13px', color: 'var(--accent)', fontWeight: 500, display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Keyboard size={14} /> Saisie manuelle — tapez le numéro de colis et validez
          </div>
          <div className="manual-input-bar">
            <input
              ref={manualInputRef}
              className="form-input"
              value={manualInput}
              onChange={e => setManualInput(e.target.value.replace(/\D/g, ''))}
              onKeyDown={handleManualKeyDown}
              placeholder="Ex: 5090186200001"
              inputMode="numeric"
              pattern="[0-9]*"
              autoComplete="off"
              style={{ fontSize: '18px', fontFamily: 'monospace', letterSpacing: '1px', textAlign: 'center' }}
            />
            <button
              className="btn btn-primary"
              onClick={handleManualSubmit}
              disabled={manualInput.trim().length < 5}
              style={{ flexShrink: 0 }}
            >
              Valider
            </button>
          </div>
          <button
            className="btn btn-ghost btn-sm"
            onClick={toggleManualMode}
            style={{ alignSelf: 'center', color: 'var(--gray-400)' }}
          >
            ← Retour au scan TC51
          </button>
        </div>
      ) : (
        <div
          className="scan-zone"
          style={{ borderColor: popup ? SCAN_RESULTS[popup.type]?.color : undefined }}
          onClick={() => scanInputRef.current?.focus()}
        >
          <Package size={28} color="var(--gray-200)" />
          <p style={{ fontSize: '14px', color: 'var(--gray-400)', fontWeight: 500 }}>
            Zone de scan active
          </p>
          <p style={{ fontSize: '12px', color: 'var(--gray-300)' }}>
            Scannez avec le TC51 ou utilisez le bouton clavier
          </p>
          {scanInput && (
            <div style={{
              marginTop: '8px', fontFamily: 'monospace', fontSize: '20px',
              color: 'var(--accent)', fontWeight: 600, letterSpacing: '2px',
            }}>
              {scanInput}
            </div>
          )}
        </div>
      )}

      {/* Historique */}
      {lastScans.length > 0 && (
        <div className="card scan-history">
          <div className="card-header" style={{ padding: '12px 16px' }}>
            <span className="card-title" style={{ fontSize: '13px' }}>Derniers scans</span>
          </div>
          <div style={{ overflowY: 'auto', maxHeight: '180px' }}>
            <table>
              <tbody>
                {lastScans.map(s => {
                  const r = SCAN_RESULTS[s.result_type]
                  return (
                    <tr key={s.id}>
                      <td style={{ width: 32, paddingLeft: 12 }}>
                        <span style={{
                          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                          width: 22, height: 22, borderRadius: '50%',
                          background: r?.color + '20', color: r?.color,
                          fontSize: '12px', fontWeight: 700,
                        }}>
                          {r?.icon}
                        </span>
                      </td>
                      <td>
                        <code style={{ fontSize: '12px', color: 'var(--gray-600)' }}>
                          {s.barcode_scanned}
                        </code>
                      </td>
                      <td style={{ display: 'none' }}>
                        <span style={{ fontSize: '12px', color: r?.color, fontWeight: 500 }}>{r?.label}</span>
                      </td>
                      <td style={{ fontSize: '11px', color: 'var(--gray-400)', textAlign: 'right', paddingRight: 12 }}>
                        {new Date(s.scanned_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
