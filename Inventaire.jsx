import { useEffect, useState, useRef, useCallback } from 'react'
import { supabase } from './supabase'
import { useAuth } from './AuthContext'
import { Upload, FileText, X, Package, AlertTriangle, CheckCircle, Wifi, WifiOff, Keyboard, RefreshCw } from 'lucide-react'
import toast from 'react-hot-toast'
import * as XLSX from 'xlsx'

const POPUP_DURATION = 2500

const SCAN_RESULTS = {
  ok: { label: 'Colis conforme', sub: 'Présent dans cette zone', cls: 'ok', icon: '✓', color: '#059669' },
  wrong_zone: { label: 'Mauvaise zone', sub: 'Colis dans une autre zone', cls: 'wrong', icon: '⚠', color: '#dc2626' },
  unknown: { label: 'Colis inconnu', sub: 'Non trouvé dans le fichier', cls: 'unknown', icon: '?', color: '#d97706' },
  already_scanned: { label: 'Déjà scanné', sub: 'Ce colis a déjà été contrôlé', cls: 'already', icon: '↺', color: '#2563eb' },
}

export default function Inventaire() {
  const { profile } = useAuth()
  const [step, setStep] = useState('import') // import | zone | scan | results
  const [session, setSession] = useState(null)
  const [zones, setZones] = useState([])
  const [selectedZone, setSelectedZone] = useState(null)
  const [items, setItems] = useState([]) // colis de la zone sélectionnée
  const [scannedBarcodes, setScannedBarcodes] = useState(new Set())
  const [scans, setScans] = useState([])
  const [popup, setPopup] = useState(null)
  const [loading, setLoading] = useState(false)
  const [online, setOnline] = useState(navigator.onLine)
  const [manualMode, setManualMode] = useState(false)
  const [manualInput, setManualInput] = useState('')
  const [scanInput, setScanInput] = useState('')
  const [sessions, setSessions] = useState([])
  const [file, setFile] = useState(null)
  const [dragover, setDragover] = useState(false)

  const inputRef = useRef()
  const scanInputRef = useRef(null)
  const manualInputRef = useRef(null)
  const popupTimer = useRef(null)
  const bufferTimer = useRef(null)

  useEffect(() => {
    const on = () => setOnline(true)
    const off = () => setOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    fetchSessions()
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off) }
  }, [])

  useEffect(() => {
    if (step !== 'scan' || manualMode) return
    const keepFocus = () => {
      if (scanInputRef.current && document.activeElement !== scanInputRef.current) {
        scanInputRef.current.focus()
      }
    }
    const interval = setInterval(keepFocus, 300)
    if (scanInputRef.current) scanInputRef.current.focus()
    return () => clearInterval(interval)
  }, [step, manualMode])

  useEffect(() => {
    if (manualMode && manualInputRef.current) {
      setTimeout(() => manualInputRef.current.focus(), 50)
    }
  }, [manualMode])

  async function fetchSessions() {
    const { data } = await supabase
      .from('inventory_sessions')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(5)
    setSessions(data || [])
  }

  function handleDrop(e) {
    e.preventDefault()
    setDragover(false)
    const f = e.dataTransfer.files[0]
    if (f?.name.endsWith('.xlsx') || f?.name.endsWith('.xls')) setFile(f)
    else toast.error('Veuillez déposer un fichier Excel (.xlsx)')
  }

  async function handleImport() {
    if (!file) return toast.error('Sélectionnez un fichier Excel.')
    setLoading(true)
    try {
      const arrayBuffer = await file.arrayBuffer()
      const wb = XLSX.read(arrayBuffer)
      const ws = wb.Sheets[wb.SheetNames[0]]
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' })

      // Ignorer la ligne de titre (row 0 est le titre, row 1 les headers)
      const dataRows = rows.slice(2).filter(r => r[0] && String(r[0]).trim())

      if (dataRows.length === 0) throw new Error('Aucun colis trouvé dans le fichier.')

      // Créer la session
      const { data: sessionData, error: sessionError } = await supabase
        .from('inventory_sessions')
        .insert({ filename: file.name, created_by: profile?.id, status: 'active' })
        .select().single()
      if (sessionError) throw new Error('Erreur création session : ' + sessionError.message)

      // Insérer les items par batch
      const items = dataRows.map(r => ({
        session_id: sessionData.id,
        barcode: String(r[0]).trim(),
        zone: String(r[11] || '').trim() || null,
        libelle: String(r[4] || '').trim() || null,
      }))

      const batchSize = 500
      for (let i = 0; i < items.length; i += batchSize) {
        const { error } = await supabase.from('inventory_items').insert(items.slice(i, i + batchSize))
        if (error) throw new Error('Erreur insertion colis : ' + error.message)
      }

      // Récupérer les zones distinctes
      const zonesSet = [...new Set(items.map(i => i.zone).filter(Boolean))].sort()

      setSession(sessionData)
      setZones(zonesSet)
      setStep('zone')
      toast.success(`${items.length} colis importés — ${zonesSet.length} zones`)
      fetchSessions()
    } catch (err) {
      toast.error('Erreur : ' + err.message)
    } finally {
      setLoading(false)
    }
  }

  async function selectZone(zone) {
    setSelectedZone(zone)
    setLoading(true)
    const { data } = await supabase
      .from('inventory_items')
      .select('barcode, zone, libelle')
      .eq('session_id', session.id)
      .eq('zone', zone)
    setItems(data || [])

    // Charger les scans déjà faits pour cette zone
    const { data: existingScans } = await supabase
      .from('inventory_scans')
      .select('barcode_scanned, result_type, real_zone, scanned_at')
      .eq('session_id', session.id)
      .eq('zone_selectionnee', zone)
      .order('scanned_at', { ascending: false })

    const okBarcodes = new Set((existingScans || [])
      .filter(s => s.result_type === 'ok' || s.result_type === 'already_scanned')
      .map(s => s.barcode_scanned))

    setScannedBarcodes(okBarcodes)
    setScans(existingScans || [])
    setLoading(false)
    setStep('scan')
  }

  async function resumeSession(s) {
    setSession(s)
    // Récupérer les zones
    const { data: itemsData } = await supabase
      .from('inventory_items')
      .select('zone')
      .eq('session_id', s.id)
    const zonesSet = [...new Set((itemsData || []).map(i => i.zone).filter(Boolean))].sort()
    setZones(zonesSet)
    setStep('zone')
  }

  const processScan = useCallback(async (barcode) => {
    const bc = barcode.trim()
    if (!bc || bc.length < 5) return

    // Chercher dans les items du fichier
    const { data: item } = await supabase
      .from('inventory_items')
      .select('barcode, zone')
      .eq('session_id', session.id)
      .eq('barcode', bc)
      .maybeSingle()

    let resultType, realZone = null

    if (!item) {
      resultType = 'unknown'
    } else if (scannedBarcodes.has(bc)) {
      resultType = 'already_scanned'
    } else if (item.zone !== selectedZone) {
      resultType = 'wrong_zone'
      realZone = item.zone
    } else {
      resultType = 'ok'
    }

    // Insérer le scan
    const { error } = await supabase.from('inventory_scans').insert({
      session_id: session.id,
      barcode_scanned: bc,
      zone_selectionnee: selectedZone,
      result_type: resultType,
      real_zone: realZone,
      user_id: profile?.id,
    })

    if (error) {
      toast.error('Erreur enregistrement scan')
      return
    }

    if (resultType === 'ok') {
      setScannedBarcodes(prev => new Set([...prev, bc]))
    }
    setScans(prev => [{ barcode_scanned: bc, result_type: resultType, real_zone: realZone, scanned_at: new Date().toISOString() }, ...prev])

    if (popupTimer.current) clearTimeout(popupTimer.current)
    setPopup({ type: resultType, barcode: bc, realZone })
    popupTimer.current = setTimeout(() => setPopup(null), POPUP_DURATION)
  }, [session, selectedZone, scannedBarcodes, profile])

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
      if (bc.length >= 5) { if (bufferTimer.current) clearTimeout(bufferTimer.current); processScan(bc); setScanInput('') }
    }
  }

  function handleManualSubmit() {
    const bc = manualInput.trim()
    if (bc.length >= 5) { processScan(bc); setManualInput(''); if (manualInputRef.current) manualInputRef.current.focus() }
  }

  const scanned = scannedBarcodes.size
  const total = items.length
  const missing = items.filter(p => !scannedBarcodes.has(p.barcode))
  const wrongZone = scans.filter(s => s.result_type === 'wrong_zone')
  const unknown = scans.filter(s => s.result_type === 'unknown')
  const pct = total > 0 ? Math.round((scanned / total) * 100) : 0

  // STEP: IMPORT
  if (step === 'import') return (
    <>
      <div className="page-header">
        <h2 className="page-title">Inventaire</h2>
        <p className="page-subtitle">Importez un fichier stock pour démarrer un inventaire</p>
      </div>
      <div className="page-body" style={{ maxWidth: 640 }}>
        <div className="card">
          <div className="card-header"><span className="card-title">Nouveau fichier stock</span></div>
          <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div
              className={`upload-zone${dragover ? ' dragover' : ''}`}
              onClick={() => inputRef.current?.click()}
              onDragOver={e => { e.preventDefault(); setDragover(true) }}
              onDragLeave={() => setDragover(false)}
              onDrop={handleDrop}
            >
              <input ref={inputRef} type="file" accept=".xlsx,.xls" style={{ display: 'none' }} onChange={e => setFile(e.target.files[0])} />
              {file ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, justifyContent: 'center' }}>
                  <FileText size={28} color="var(--accent)" />
                  <div style={{ textAlign: 'left' }}>
                    <div style={{ fontWeight: 600, color: 'var(--gray-700)' }}>{file.name}</div>
                    <div style={{ fontSize: 12, color: 'var(--gray-400)' }}>{(file.size / 1024).toFixed(0)} Ko</div>
                  </div>
                  <button className="btn btn-ghost btn-sm" onClick={e => { e.stopPropagation(); setFile(null) }}><X size={14} /></button>
                </div>
              ) : (
                <>
                  <div className="upload-zone-icon"><Upload size={36} /></div>
                  <div className="upload-zone-title">Déposez votre fichier Excel ici</div>
                  <div className="upload-zone-sub">ou cliquez pour parcourir</div>
                </>
              )}
            </div>
            <button className="btn btn-primary" onClick={handleImport} disabled={loading || !file} style={{ alignSelf: 'flex-start' }}>
              {loading ? <><div className="spinner" /> Import...</> : <><Upload size={15} /> Importer</>}
            </button>
          </div>
        </div>

        {sessions.length > 0 && (
          <div className="card" style={{ marginTop: 16 }}>
            <div className="card-header"><span className="card-title">Sessions récentes</span></div>
            {sessions.map(s => (
              <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px', borderBottom: '1px solid var(--gray-100)' }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>{s.filename}</div>
                  <div style={{ fontSize: 11, color: 'var(--gray-400)' }}>{new Date(s.created_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })}</div>
                </div>
                <button className="btn btn-secondary btn-sm" onClick={() => resumeSession(s)}>Reprendre</button>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  )

  // STEP: ZONE
  if (step === 'zone') return (
    <>
      <div className="page-header">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <h2 className="page-title">Sélectionner une zone</h2>
            <p className="page-subtitle">{session?.filename} — {zones.length} zones</p>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={() => setStep('import')}>← Retour</button>
        </div>
      </div>
      <div className="page-body">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 10 }}>
          {zones.map(zone => (
            <button
              key={zone}
              className="btn btn-secondary"
              style={{ height: 70, fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 18, flexDirection: 'column' }}
              onClick={() => selectZone(zone)}
              disabled={loading}
            >
              {zone}
            </button>
          ))}
        </div>
      </div>
    </>
  )

  // STEP: SCAN
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <input
        ref={scanInputRef}
        style={{ position: 'absolute', opacity: 0, pointerEvents: 'none', width: 1, height: 1 }}
        value={scanInput}
        onChange={handleScanInput}
        onKeyDown={handleScanKeyDown}
        autoComplete="off" autoCorrect="off" spellCheck={false}
        inputMode="none" tabIndex={-1} aria-hidden="true"
      />

      {popup && (
        <div className={`scan-overlay ${SCAN_RESULTS[popup.type].cls}`}>
          <div style={{ fontSize: 24, flexShrink: 0 }}>{SCAN_RESULTS[popup.type].icon}</div>
          <div>
            <div className="scan-overlay-title">{SCAN_RESULTS[popup.type].label}</div>
            <div className="scan-overlay-sub">
              {popup.type === 'wrong_zone' && popup.realZone ? `Zone réelle : ${popup.realZone}` : SCAN_RESULTS[popup.type].sub}
              <span style={{ display: 'block', opacity: 0.7, fontSize: 11, marginTop: 2, fontFamily: 'monospace' }}>{popup.barcode}</span>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', background: 'var(--white)', borderBottom: '1px solid var(--gray-100)', flexShrink: 0 }}>
        <button className="btn btn-ghost btn-sm" style={{ padding: '4px 8px' }} onClick={() => { setStep('zone'); setScans([]); setScannedBarcodes(new Set()) }}>
          ← Zones
        </button>
        <div style={{ flex: 1 }}>
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 18, color: 'var(--gray-800)' }}>Zone {selectedZone}</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {online ? <Wifi size={13} color="var(--green)" /> : <WifiOff size={13} color="var(--red)" />}
          <button className={`btn btn-sm ${manualMode ? 'btn-primary' : 'btn-secondary'}`} style={{ padding: '5px 8px' }} onClick={() => { setManualMode(!manualMode); setManualInput('') }}>
            <Keyboard size={14} />
          </button>
        </div>
      </div>

      {/* Compteurs */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 6, padding: '10px 14px 0', flexShrink: 0 }}>
        {[
          { label: 'Scannés', value: `${scanned}/${total}`, color: 'var(--accent)', border: 'var(--accent)' },
          { label: 'Manquants', value: missing.length, color: missing.length > 0 ? 'var(--red)' : 'var(--green)', border: missing.length > 0 ? 'var(--red)' : 'var(--green)' },
          { label: 'Mauvaise zone', value: wrongZone.length, color: wrongZone.length > 0 ? 'var(--red)' : 'var(--gray-300)', border: wrongZone.length > 0 ? 'var(--red)' : 'var(--gray-200)' },
          { label: 'Inconnus', value: unknown.length, color: unknown.length > 0 ? 'var(--orange)' : 'var(--gray-300)', border: unknown.length > 0 ? 'var(--orange)' : 'var(--gray-200)' },
        ].map(c => (
          <div key={c.label} style={{ background: 'var(--white)', borderRadius: 'var(--radius)', border: `1px solid var(--gray-200)`, borderTop: `3px solid ${c.border}`, padding: '8px 6px', textAlign: 'center', boxShadow: 'var(--shadow-sm)' }}>
            <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 'clamp(16px, 4vw, 26px)', lineHeight: 1, color: c.color }}>{c.value}</div>
            <div style={{ fontSize: 9, color: 'var(--gray-400)', marginTop: 2 }}>{c.label}</div>
          </div>
        ))}
      </div>

      {/* Barre de progression */}
      <div style={{ padding: '8px 14px 0', flexShrink: 0 }}>
        <div className="progress-bar">
          <div className={`progress-fill ${pct === 100 ? 'green' : ''}`} style={{ width: `${pct}%` }} />
        </div>
      </div>

      {/* Zone de scan */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '10px 14px' }}>
        {manualMode ? (
          <div style={{ background: 'var(--white)', borderRadius: 'var(--radius)', border: '2px solid var(--accent)', padding: 14, display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 10 }}>
            <div style={{ fontSize: 12, color: 'var(--accent)', fontWeight: 500, display: 'flex', alignItems: 'center', gap: 6 }}>
              <Keyboard size={13} /> Saisie manuelle
            </div>
            <input
              ref={manualInputRef}
              className="form-input"
              value={manualInput}
              onChange={e => setManualInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleManualSubmit(); if (e.key === 'Escape') { setManualMode(false); setManualInput('') } }}
              placeholder="Numéro de colis"
              autoComplete="off"
              style={{ fontSize: 18, fontFamily: 'monospace', letterSpacing: 1, textAlign: 'center' }}
            />
            <button className="btn btn-primary w-full" onClick={handleManualSubmit} disabled={manualInput.trim().length < 5} style={{ justifyContent: 'center' }}>Valider</button>
            <button className="btn btn-ghost btn-sm" onClick={() => { setManualMode(false); setManualInput('') }} style={{ alignSelf: 'center', color: 'var(--gray-400)', fontSize: 12 }}>← Retour au scan TC51</button>
          </div>
        ) : (
          <div
            style={{ background: 'var(--white)', borderRadius: 'var(--radius)', border: `2px dashed ${popup ? SCAN_RESULTS[popup.type].color : 'var(--gray-200)'}`, padding: '20px 16px', textAlign: 'center', marginBottom: 10, cursor: 'text', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}
            onClick={() => scanInputRef.current?.focus()}
          >
            <Package size={24} color="var(--gray-200)" />
            <p style={{ fontSize: 13, color: 'var(--gray-400)', fontWeight: 500, margin: 0 }}>Zone de scan active — Zone {selectedZone}</p>
            {scanInput && <div style={{ fontFamily: 'monospace', fontSize: 18, color: 'var(--accent)', fontWeight: 600 }}>{scanInput}</div>}
          </div>
        )}

        {/* Manquants */}
        {missing.length > 0 && (
          <div className="card" style={{ overflow: 'hidden', marginBottom: 10 }}>
            <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--gray-100)', background: 'var(--red-light)', display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: '#991b1b' }}>Manquants</span>
              <span style={{ fontSize: 11, color: '#991b1b', fontWeight: 500 }}>{missing.length}</span>
            </div>
            <div style={{ maxHeight: 150, overflowY: 'auto' }}>
              {missing.map(p => (
                <div key={p.barcode} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px', borderBottom: '1px solid var(--gray-100)' }}>
                  <span style={{ color: 'var(--red)', fontSize: 10, fontWeight: 700 }}>✗</span>
                  <code style={{ fontSize: 12, color: 'var(--gray-600)', flex: 1 }}>{p.barcode}</code>
                  {p.libelle && <span style={{ fontSize: 10, color: 'var(--gray-400)' }}>{p.libelle.slice(0, 20)}</span>}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Derniers scans */}
        {scans.length > 0 && (
          <div className="card" style={{ overflow: 'hidden' }}>
            <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--gray-100)', display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--gray-700)' }}>Derniers scans</span>
              <span style={{ fontSize: 11, color: 'var(--gray-400)' }}>{scans.length}</span>
            </div>
            {scans.slice(0, 10).map((s, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px', borderBottom: '1px solid var(--gray-100)', background: s.result_type === 'wrong_zone' ? '#fff5f5' : s.result_type === 'unknown' ? '#fffbeb' : s.result_type === 'ok' ? '#f0fdf4' : undefined }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: s.result_type === 'ok' ? '#059669' : s.result_type === 'wrong_zone' ? 'var(--red)' : s.result_type === 'unknown' ? '#d97706' : '#2563eb' }}>
                  {SCAN_RESULTS[s.result_type]?.icon}
                </span>
                <code style={{ fontSize: 11, color: 'var(--gray-700)', flex: 1 }}>{s.barcode_scanned}</code>
                {s.real_zone && <span style={{ fontSize: 10, color: 'var(--red)' }}>→ {s.real_zone}</span>}
                <span style={{ fontSize: 10, color: 'var(--gray-400)' }}>{new Date(s.scanned_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
