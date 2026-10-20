import { useEffect, useRef, useState } from 'react'
import { supabase } from './supabase'
import { X, ZoomIn, ZoomOut, MapPin } from 'lucide-react'

// Mêmes dimensions que la page « Plan entrepôt » (WarehousePlan.jsx)
const CANVAS_W = 1200
const CANVAS_H = 800

// Charge le plan à partir des mêmes tables que « Plan entrepôt » :
// zones (warehouse_zones), tournée affectée à chaque zone (zone_assignments), image de fond (warehouse_settings).
async function loadWarehousePlan() {
  const [zonesRes, assignRes, settingsRes] = await Promise.all([
    supabase.from('warehouse_zones').select('*').order('order_index').order('id'),
    supabase.from('zone_assignments').select('zone_id, tours_references(name)'),
    supabase.from('warehouse_settings').select('bg_url').limit(1).maybeSingle(),
  ])
  if (zonesRes.error) throw zonesRes.error

  const assignments = {}
  for (const a of assignRes.data || []) {
    if (a.tours_references) assignments[a.zone_id] = a.tours_references.name
  }
  return { zones: zonesRes.data || [], assignments, bgUrl: settingsRes.data?.bg_url || null }
}

// Libellé mémorisé avec la défaillance : numéro de la zone sur le plan (#N, comme sur « Plan entrepôt »)
// + tournée affectée à cet instant. Il reste lisible même si le plan change ensuite.
function buildZoneLabel(plan, zoneId) {
  const idx = plan.zones.findIndex(z => z.id === zoneId)
  if (idx < 0) return null
  const name = plan.assignments[zoneId]
  return `#${idx + 1}${name ? ` — ${name}` : ''}`
}

/**
 * Plan de l'entrepôt en fenêtre plein écran pour choisir (ou simplement visualiser) une zone.
 *  - selectedId : id de la zone déjà choisie
 *  - readOnly   : true pour seulement afficher la zone (fiche d'une défaillance)
 *  - onSelect(zoneId | null, label | null) : appelé à la validation
 */
export default function ZonePicker({ selectedId = null, readOnly = false, onSelect, onClose }) {
  const [plan, setPlan] = useState(null)
  const [error, setError] = useState(null)
  const [temp, setTemp] = useState(selectedId)
  const [zoom, setZoom] = useState(1)
  const [fit, setFit] = useState(0.5)
  const containerRef = useRef(null)

  useEffect(() => {
    loadWarehousePlan().then(setPlan).catch(err => setError(err.message || 'Plan indisponible'))
  }, [])

  // Ajuste le plan à la largeur disponible (téléphone compris)
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const measure = () => setFit(Math.max(0.2, Math.min(1.5, el.clientWidth / CANVAS_W)))
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const scale = fit * zoom
  const tempLabel = plan && temp != null ? buildZoneLabel(plan, temp) : null

  function validate() {
    onSelect?.(temp, tempLabel)
  }

  return (
    <div className="modal-backdrop" style={{ zIndex: 200 }} onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 'min(1240px, 96vw)' }}>
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <div>
              <h3 className="modal-title">{readOnly ? 'Emplacement sur le plan' : 'Placer sur le plan de l\'entrepôt'}</h3>
              {!readOnly && (
                <p style={{ fontSize: 12, color: 'var(--gray-400)', marginTop: 2 }}>
                  Touchez une zone pour y placer la défaillance. Touchez-la à nouveau pour la retirer.
                </p>
              )}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setZoom(z => Math.min(z + 0.5, 3))} title="Agrandir"><ZoomIn size={14} /></button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setZoom(z => Math.max(z - 0.5, 1))} title="Réduire"><ZoomOut size={14} /></button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}><X size={16} /></button>
            </div>
          </div>
        </div>

        <div style={{ padding: '16px 24px' }}>
          <div
            ref={containerRef}
            style={{ overflow: 'auto', maxHeight: 'calc(100vh - 260px)', border: '1px solid var(--gray-200)', borderRadius: 'var(--radius)', background: 'var(--gray-50)' }}
          >
            {error ? (
              <div style={{ padding: 32, textAlign: 'center', fontSize: 13, color: 'var(--red)' }}>
                Impossible de charger le plan : {error}
                <div style={{ color: 'var(--gray-400)', marginTop: 6 }}>
                  Vérifiez que ce compte a le droit de lire les tables du plan (voir le fichier SQL).
                </div>
              </div>
            ) : !plan ? (
              <div className="loading-center" style={{ padding: 40 }}><div className="spinner dark" /></div>
            ) : plan.zones.length === 0 ? (
              <div style={{ padding: 32, textAlign: 'center', fontSize: 13, color: 'var(--gray-400)' }}>
                Aucune zone n'est définie sur le plan de l'entrepôt.
              </div>
            ) : (
              // Conteneur à la taille réelle (le « transform » ne modifie pas la mise en page)
              <div style={{ width: CANVAS_W * scale, height: CANVAS_H * scale }}>
                <div
                  style={{
                    position: 'relative',
                    width: CANVAS_W,
                    height: CANVAS_H,
                    transform: `scale(${scale})`,
                    transformOrigin: 'top left',
                    userSelect: 'none',
                    backgroundImage: plan.bgUrl
                      ? `url(${plan.bgUrl})`
                      : 'repeating-linear-gradient(0deg, transparent, transparent 39px, #e5e7eb 39px, #e5e7eb 40px), repeating-linear-gradient(90deg, transparent, transparent 39px, #e5e7eb 39px, #e5e7eb 40px)',
                    backgroundSize: plan.bgUrl ? '100% 100%' : 'auto',
                  }}
                >
                  {plan.zones.map((zone, idx) => {
                    const name = plan.assignments[zone.id]
                    const isSelected = temp === zone.id
                    return (
                      <div
                        key={zone.id}
                        role={readOnly ? undefined : 'button'}
                        onClick={() => { if (!readOnly) setTemp(isSelected ? null : zone.id) }}
                        style={{
                          position: 'absolute',
                          left: zone.x, top: zone.y,
                          width: zone.width, height: zone.height,
                          border: `${isSelected ? 4 : 2}px solid ${isSelected ? '#f59e0b' : name ? '#059669' : 'var(--gray-300)'}`,
                          borderRadius: 4,
                          background: isSelected ? 'rgba(245,158,11,0.3)' : name ? 'rgba(5,150,105,0.12)' : 'rgba(255,255,255,0.6)',
                          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                          cursor: readOnly ? 'default' : 'pointer',
                          boxSizing: 'border-box',
                          overflow: 'hidden',
                          transition: 'border-color 0.15s, background 0.15s',
                        }}
                      >
                        <span style={{ position: 'absolute', top: 2, left: 4, fontSize: 9, fontWeight: 700, color: 'var(--gray-500)', fontFamily: 'monospace' }}>
                          #{idx + 1}
                        </span>
                        {name ? (
                          <span style={{
                            fontSize: Math.max(9, Math.min(14, zone.width / 7)),
                            fontFamily: 'var(--font-display)', fontWeight: 700,
                            color: '#065f46', textAlign: 'center', padding: '0 4px', lineHeight: 1.2, wordBreak: 'break-word',
                          }}>
                            {name}
                          </span>
                        ) : (
                          <span style={{ fontSize: 10, color: 'var(--gray-300)' }}>vide</span>
                        )}
                        {isSelected && (
                          <MapPin size={Math.max(14, Math.min(28, zone.width / 4))} color="#b45309" style={{ position: 'absolute', bottom: 2, right: 2 }} />
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </div>

          {readOnly && selectedId != null && plan && !plan.zones.some(z => z.id === selectedId) && (
            <p style={{ fontSize: 12, color: 'var(--orange)', marginTop: 8 }}>
              Cette zone n'existe plus sur le plan (elle a été supprimée ou redessinée).
            </p>
          )}
        </div>

        <div className="modal-footer" style={{ alignItems: 'center', flexWrap: 'wrap' }}>
          {!readOnly && (
            <span style={{ marginRight: 'auto', fontSize: 13, color: temp != null ? 'var(--gray-700)' : 'var(--gray-400)' }}>
              {temp != null ? <>Zone choisie : <strong>{tempLabel || `#${temp}`}</strong></> : 'Aucune zone choisie'}
            </span>
          )}
          <button type="button" className="btn btn-secondary" onClick={onClose}>{readOnly ? 'Fermer' : 'Annuler'}</button>
          {!readOnly && (
            <button type="button" className="btn btn-primary" onClick={validate}>
              {temp != null ? 'Valider cette zone' : 'Valider sans zone'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

export { buildZoneLabel }
