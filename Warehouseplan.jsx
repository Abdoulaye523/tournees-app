import { useEffect, useState, useRef, useCallback } from 'react'
import { supabase } from './supabase'
import { Edit3, Eye, Trash2, Save, ZoomIn, ZoomOut, RotateCcw, Upload } from 'lucide-react'
import toast from 'react-hot-toast'

const CANVAS_W = 1200
const CANVAS_H = 800
const MIN_ZONE_SIZE = 30

export default function WarehousePlan() {
  const canvasRef = useRef(null)
  const fileRef = useRef(null)
  const [mode, setMode] = useState('view') // 'view' | 'edit'
  const [zones, setZones] = useState([])
  const [assignments, setAssignments] = useState({}) // zoneId -> reference
  const [todayTours, setTodayTours] = useState([])
  const [unassigned, setUnassigned] = useState([])
  const [bgImage, setBgImage] = useState(null)
  const [bgDataUrl, setBgDataUrl] = useState(null)
  const [drawing, setDrawing] = useState(false)
  const [startPos, setStartPos] = useState(null)
  const [currentRect, setCurrentRect] = useState(null)
  const [dragging, setDragging] = useState(null) // { zoneId, tourName, startX, startY }
  const [dragOver, setDragOver] = useState(null)
  const [selectedZone, setSelectedZone] = useState(null)
  const [scale, setScale] = useState(1)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadAll()
  }, [])

  async function loadAll() {
    setLoading(true)
    await Promise.all([loadZones(), loadTodayTours()])
    setLoading(false)
  }

  async function loadZones() {
    const { data: zonesData } = await supabase.from('warehouse_zones').select('*').order('id')
    const { data: assignData } = await supabase.from('zone_assignments').select('*, tours_references(id, name)')

    const zonesArr = zonesData || []
    const assignMap = {}
    for (const a of (assignData || [])) {
      if (a.tours_references) assignMap[a.zone_id] = a.tours_references
    }
    setZones(zonesArr)
    setAssignments(assignMap)
  }

  async function loadTodayTours() {
    // Récupérer la dernière date de livraison
    const { data: dates } = await supabase
      .from('delivery_dates')
      .select('id')
      .order('delivery_date', { ascending: false })
      .limit(1)

    if (!dates || dates.length === 0) return

    const { data: tours } = await supabase
      .from('tours')
      .select('name, reference_id, tours_references(id, name)')
      .eq('delivery_date_id', dates[0].id)

    setTodayTours(tours || [])
  }

  // Calcul des tournées non assignées
  useEffect(() => {
    const assignedRefIds = new Set(Object.values(assignments).map(r => r.id))
    const unassignedTours = todayTours.filter(t =>
      t.tours_references && !assignedRefIds.has(t.tours_references.id)
    )
    // Dédupliquer par reference_id
    const seen = new Set()
    const deduped = []
    for (const t of unassignedTours) {
      if (t.tours_references && !seen.has(t.tours_references.id)) {
        seen.add(t.tours_references.id)
        deduped.push(t.tours_references)
      }
    }
    setUnassigned(deduped)
  }, [assignments, todayTours])

  // Auto-assign: les nouvelles tournées vont dans les zones libres
  async function autoAssign() {
    const freeZones = zones.filter(z => !assignments[z.id])
    const toAssign = [...unassigned]
    const newAssignments = {}

    for (let i = 0; i < Math.min(freeZones.length, toAssign.length); i++) {
      const zone = freeZones[i]
      const ref = toAssign[i]
      const { error } = await supabase.from('zone_assignments').upsert({
        zone_id: zone.id,
        reference_id: ref.id,
      }, { onConflict: 'zone_id' })
      if (!error) newAssignments[zone.id] = ref
    }

    setAssignments(prev => ({ ...prev, ...newAssignments }))
    toast.success(`${Object.keys(newAssignments).length} tournées assignées automatiquement`)
  }

  // ── DESSIN DE ZONES ──────────────────────────────────────────────────────────
  function getCanvasPos(e) {
    const rect = canvasRef.current.getBoundingClientRect()
    return {
      x: (e.clientX - rect.left) / scale,
      y: (e.clientY - rect.top) / scale,
    }
  }

  function handleMouseDown(e) {
    if (mode !== 'edit') return
    const pos = getCanvasPos(e)
    setDrawing(true)
    setStartPos(pos)
    setCurrentRect({ x: pos.x, y: pos.y, width: 0, height: 0 })
  }

  function handleMouseMove(e) {
    if (!drawing || mode !== 'edit') return
    const pos = getCanvasPos(e)
    setCurrentRect({
      x: Math.min(startPos.x, pos.x),
      y: Math.min(startPos.y, pos.y),
      width: Math.abs(pos.x - startPos.x),
      height: Math.abs(pos.y - startPos.y),
    })
  }

  async function handleMouseUp(e) {
    if (!drawing || mode !== 'edit') return
    setDrawing(false)
    if (currentRect && currentRect.width > MIN_ZONE_SIZE && currentRect.height > MIN_ZONE_SIZE) {
      const { data, error } = await supabase.from('warehouse_zones').insert({
        x: Math.round(currentRect.x),
        y: Math.round(currentRect.y),
        width: Math.round(currentRect.width),
        height: Math.round(currentRect.height),
      }).select().single()
      if (!error && data) {
        setZones(prev => [...prev, data])
        toast.success('Zone créée')
      }
    }
    setCurrentRect(null)
    setStartPos(null)
  }

  async function deleteZone(zoneId) {
    await supabase.from('zone_assignments').delete().eq('zone_id', zoneId)
    await supabase.from('warehouse_zones').delete().eq('id', zoneId)
    setZones(prev => prev.filter(z => z.id !== zoneId))
    setAssignments(prev => { const n = { ...prev }; delete n[zoneId]; return n })
    setSelectedZone(null)
    toast.success('Zone supprimée')
  }

  // ── DRAG & DROP ASSIGNATION ──────────────────────────────────────────────────
  async function handleDropOnZone(zoneId, ref) {
    // Retirer l'ancienne assignation de cette ref si elle existe ailleurs
    const oldZoneId = Object.keys(assignments).find(k => assignments[k].id === ref.id)

    if (oldZoneId && parseInt(oldZoneId) !== zoneId) {
      await supabase.from('zone_assignments').delete().eq('zone_id', oldZoneId)
    }

    const { error } = await supabase.from('zone_assignments').upsert({
      zone_id: zoneId,
      reference_id: ref.id,
    }, { onConflict: 'zone_id' })

    if (!error) {
      setAssignments(prev => {
        const n = { ...prev }
        if (oldZoneId) delete n[oldZoneId]
        n[zoneId] = ref
        return n
      })
    }
  }

  async function removeAssignment(zoneId) {
    await supabase.from('zone_assignments').delete().eq('zone_id', zoneId)
    setAssignments(prev => { const n = { ...prev }; delete n[zoneId]; return n })
  }

  function handleBgUpload(e) {
    const file = e.target.files[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = ev => setBgDataUrl(ev.target.result)
    reader.readAsDataURL(file)
  }

  const assignedRefIds = new Set(Object.values(assignments).map(r => r.id))
  const todayRefIds = new Set(todayTours.filter(t => t.tours_references).map(t => t.tours_references.id))

  return (
    <>
      <div className="page-header">
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <div>
            <h2 className="page-title">Plan de l'entrepôt</h2>
            <p className="page-subtitle">Assignez les tournées aux zones de stockage</p>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', paddingTop: 4 }}>
            {mode === 'view' && unassigned.length > 0 && (
              <button className="btn btn-secondary btn-sm" onClick={autoAssign}>
                <RotateCcw size={13} /> Auto-assigner ({unassigned.length})
              </button>
            )}
            <button
              className={'btn btn-sm ' + (mode === 'edit' ? 'btn-primary' : 'btn-secondary')}
              onClick={() => setMode(mode === 'edit' ? 'view' : 'edit')}
            >
              {mode === 'edit' ? <><Eye size={13} /> Mode vue</> : <><Edit3 size={13} /> Mode édition</>}
            </button>
          </div>
        </div>
      </div>

      <div className="page-body" style={{ display: 'flex', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>

        {/* Canvas */}
        <div style={{ flex: 1, minWidth: 0 }}>

          {/* Toolbar */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            {mode === 'edit' && (
              <>
                <button className="btn btn-ghost btn-sm" onClick={() => fileRef.current?.click()}>
                  <Upload size={13} /> Image de fond
                </button>
                <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleBgUpload} />
                <span style={{ fontSize: 12, color: 'var(--gray-400)' }}>Cliquez-glissez pour créer une zone</span>
              </>
            )}
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
              <button className="btn btn-ghost btn-sm" onClick={() => setScale(s => Math.min(s + 0.1, 2))}>
                <ZoomIn size={13} />
              </button>
              <button className="btn btn-ghost btn-sm" onClick={() => setScale(s => Math.max(s - 0.1, 0.4))}>
                <ZoomOut size={13} />
              </button>
              <span style={{ fontSize: 12, color: 'var(--gray-400)', alignSelf: 'center' }}>{Math.round(scale * 100)}%</span>
            </div>
          </div>

          {/* Canvas zone */}
          <div style={{ overflow: 'auto', border: '1px solid var(--gray-200)', borderRadius: 'var(--radius)', background: 'var(--gray-50)' }}>
            <div
              ref={canvasRef}
              style={{
                position: 'relative',
                width: CANVAS_W * scale,
                height: CANVAS_H * scale,
                cursor: mode === 'edit' ? 'crosshair' : 'default',
                userSelect: 'none',
                backgroundImage: bgDataUrl ? `url(${bgDataUrl})` : 'none',
                backgroundSize: '100% 100%',
                backgroundRepeat: 'no-repeat',
                backgroundColor: bgDataUrl ? 'transparent' : '#f8f9fa',
                transform: `scale(${scale})`,
                transformOrigin: 'top left',
                backgroundImage: bgDataUrl
                  ? `url(${bgDataUrl})`
                  : 'repeating-linear-gradient(0deg, transparent, transparent 39px, #e5e7eb 39px, #e5e7eb 40px), repeating-linear-gradient(90deg, transparent, transparent 39px, #e5e7eb 39px, #e5e7eb 40px)',
              }}
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onMouseLeave={() => { if (drawing) { setDrawing(false); setCurrentRect(null) } }}
            >
              {/* Zones existantes */}
              {zones.map(zone => {
                const ref = assignments[zone.id]
                const isToday = ref && todayRefIds.has(ref.id)
                const isSelected = selectedZone === zone.id
                const isDragTarget = dragOver === zone.id

                return (
                  <div
                    key={zone.id}
                    style={{
                      position: 'absolute',
                      left: zone.x,
                      top: zone.y,
                      width: zone.width,
                      height: zone.height,
                      border: `2px solid ${isDragTarget ? 'var(--accent)' : isSelected ? '#f59e0b' : ref ? (isToday ? '#059669' : '#94a3b8') : 'var(--gray-300)'}`,
                      borderRadius: 4,
                      background: isDragTarget
                        ? 'rgba(99,102,241,0.15)'
                        : ref
                          ? isToday ? 'rgba(5,150,105,0.12)' : 'rgba(148,163,184,0.15)'
                          : 'rgba(255,255,255,0.6)',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      justifyContent: 'center',
                      cursor: mode === 'edit' ? 'default' : 'pointer',
                      boxSizing: 'border-box',
                      transition: 'border-color 0.15s, background 0.15s',
                    }}
                    onClick={e => {
                      e.stopPropagation()
                      if (mode === 'edit') setSelectedZone(isSelected ? null : zone.id)
                    }}
                    onDragOver={e => { e.preventDefault(); setDragOver(zone.id) }}
                    onDragLeave={() => setDragOver(null)}
                    onDrop={e => {
                      e.preventDefault()
                      setDragOver(null)
                      const data = JSON.parse(e.dataTransfer.getData('text/plain'))
                      handleDropOnZone(zone.id, data)
                    }}
                  >
                    {ref ? (
                      <>
                        <span style={{
                          fontSize: Math.max(10, Math.min(14, zone.width / 7)),
                          fontFamily: 'var(--font-display)',
                          fontWeight: 700,
                          color: isToday ? '#065f46' : '#64748b',
                          textAlign: 'center',
                          padding: '0 4px',
                          lineHeight: 1.2,
                          wordBreak: 'break-word',
                        }}>
                          {ref.name}
                        </span>
                        {!isToday && (
                          <span style={{ fontSize: 9, color: '#94a3b8', marginTop: 2 }}>absent aujourd'hui</span>
                        )}
                        {mode === 'view' && (
                          <button
                            style={{ position: 'absolute', top: 2, right: 2, background: 'none', border: 'none', cursor: 'pointer', opacity: 0.4, padding: 2 }}
                            onClick={e => { e.stopPropagation(); removeAssignment(zone.id) }}
                          >
                            <X size={10} color="#dc2626" />
                          </button>
                        )}
                      </>
                    ) : (
                      <span style={{ fontSize: 10, color: 'var(--gray-300)' }}>vide</span>
                    )}

                    {/* Bouton supprimer en mode édition */}
                    {mode === 'edit' && isSelected && (
                      <button
                        style={{ position: 'absolute', top: -10, right: -10, background: '#dc2626', border: 'none', borderRadius: '50%', width: 20, height: 20, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10 }}
                        onClick={e => { e.stopPropagation(); deleteZone(zone.id) }}
                      >
                        <Trash2 size={10} color="white" />
                      </button>
                    )}
                  </div>
                )
              })}

              {/* Zone en cours de dessin */}
              {currentRect && currentRect.width > 5 && (
                <div style={{
                  position: 'absolute',
                  left: currentRect.x,
                  top: currentRect.y,
                  width: currentRect.width,
                  height: currentRect.height,
                  border: '2px dashed var(--accent)',
                  background: 'rgba(99,102,241,0.1)',
                  borderRadius: 4,
                  pointerEvents: 'none',
                }} />
              )}
            </div>
          </div>

          <div style={{ marginTop: 8, display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--gray-500)' }}>
              <span style={{ width: 12, height: 12, background: 'rgba(5,150,105,0.12)', border: '2px solid #059669', borderRadius: 2, display: 'inline-block' }} />
              Tournée du jour
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--gray-500)' }}>
              <span style={{ width: 12, height: 12, background: 'rgba(148,163,184,0.15)', border: '2px solid #94a3b8', borderRadius: 2, display: 'inline-block' }} />
              Absent aujourd'hui
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--gray-500)' }}>
              <span style={{ width: 12, height: 12, background: 'rgba(255,255,255,0.6)', border: '2px solid var(--gray-300)', borderRadius: 2, display: 'inline-block' }} />
              Zone vide
            </div>
            <span style={{ fontSize: 11, color: 'var(--gray-400)', marginLeft: 'auto' }}>{zones.length} zones · {Object.keys(assignments).length} assignées</span>
          </div>
        </div>

        {/* Panneau tournées non assignées */}
        <div style={{ width: 220, flexShrink: 0 }}>
          <div className="card" style={{ overflow: 'hidden' }}>
            <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--gray-100)', background: 'var(--gray-50)' }}>
              <span style={{ fontFamily: 'var(--font-display)', fontSize: 12, fontWeight: 700, color: 'var(--gray-700)' }}>
                Tournées à placer
              </span>
              <span className="badge badge-gray" style={{ marginLeft: 8 }}>{unassigned.length}</span>
            </div>

            {unassigned.length === 0 ? (
              <div style={{ padding: '20px 14px', textAlign: 'center', color: 'var(--gray-400)', fontSize: 12 }}>
                ✓ Toutes assignées
              </div>
            ) : (
              <div style={{ padding: '8px' }}>
                {unassigned.map(ref => (
                  <div
                    key={ref.id}
                    draggable
                    onDragStart={e => e.dataTransfer.setData('text/plain', JSON.stringify(ref))}
                    style={{
                      padding: '8px 10px',
                      marginBottom: 6,
                      background: 'var(--accent-light)',
                      border: '1px solid var(--accent)',
                      borderRadius: 'var(--radius-sm)',
                      cursor: 'grab',
                      fontFamily: 'var(--font-display)',
                      fontWeight: 600,
                      fontSize: 13,
                      color: 'var(--accent)',
                    }}
                  >
                    ⠿ {ref.name}
                  </div>
                ))}
                <p style={{ fontSize: 11, color: 'var(--gray-400)', marginTop: 8, textAlign: 'center' }}>
                  Glissez vers une zone
                </p>
              </div>
            )}
          </div>

          {/* Zones avec tournées absentes */}
          {Object.entries(assignments).some(([zoneId, ref]) => !todayRefIds.has(ref.id)) && (
            <div className="card" style={{ overflow: 'hidden', marginTop: 12 }}>
              <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--gray-100)', background: '#fff7ed' }}>
                <span style={{ fontFamily: 'var(--font-display)', fontSize: 12, fontWeight: 700, color: '#92400e' }}>
                  Absentes aujourd'hui
                </span>
              </div>
              <div style={{ padding: '8px' }}>
                {Object.entries(assignments)
                  .filter(([_, ref]) => !todayRefIds.has(ref.id))
                  .map(([zoneId, ref]) => (
                    <div key={zoneId} style={{ padding: '6px 10px', marginBottom: 4, background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: 'var(--radius-sm)', fontSize: 12, color: '#92400e', fontWeight: 600, fontFamily: 'var(--font-display)' }}>
                      {ref.name}
                    </div>
                  ))
                }
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  )
}

function X({ size, color }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2">
      <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  )
}
