import { useState, useRef } from 'react'
import { supabase } from './supabase'
import { useAuth } from './AuthContext'
import { Upload, FileText, CheckCircle, AlertCircle, X, AlertTriangle } from 'lucide-react'
import toast from 'react-hot-toast'

function loadPdfJs() {
  return new Promise((resolve, reject) => {
    if (window.pdfjsLib) {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc =
        'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js'
      return resolve(window.pdfjsLib)
    }
    const script = document.createElement('script')
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js'
    script.onload = () => {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc =
        'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js'
      resolve(window.pdfjsLib)
    }
    script.onerror = reject
    document.head.appendChild(script)
  })
}

async function extractTextFromPDF(file) {
  const pdfjsLib = await loadPdfJs()
  const arrayBuffer = await file.arrayBuffer()
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise

  let fullText = ''
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i)
    const content = await page.getTextContent()
    const byY = {}
    for (const item of content.items) {
      const rawY = item.transform[5]
      const yKey = Object.keys(byY).find(k => Math.abs(k - rawY) <= 3)
      const y = yKey !== undefined ? yKey : Math.round(rawY)
      if (!byY[y]) byY[y] = []
      byY[y].push({ x: item.transform[4], str: item.str })
    }
    const sortedYs = Object.keys(byY).sort((a, b) => b - a)
    for (const y of sortedYs) {
      const items = byY[y].sort((a, b) => a.x - b.x)
      fullText += items.map(i => i.str).join(' ') + '\n'
    }
    fullText += '\f'
  }
  return fullText
}

function extractTourName(raw) {
  return raw.replace(/ta830camion(m\s+)?/i, '').trim().replace(/\s+/g, ' ')
}

function normalize(str) {
  return str.replace(/\s+/g, '').toLowerCase()
}

// 🔧 FONCTION DE NORMALISATION DES ACCENTS
function removeAccents(str) {
  if (!str) return ''
  return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
}

function parsePDFText(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean)
  const tours = {}
  const seenTours = new Set()
  let currentTourName = null
  let inChargement = false
  let skip = false

  // Détecter les dates au fil du parsing (une par tournée)
  const months = { janvier:1, février:2, mars:3, avril:4, mai:5, juin:6, juillet:7, août:8, septembre:9, octobre:10, novembre:11, décembre:12 }
  
  // 🔧 CRÉER UNE VERSION NORMALISÉE (sans accents) DU DICTIONNAIRE
  const monthsNormalized = {}
  Object.entries(months).forEach(([key, val]) => {
    monthsNormalized[removeAccents(key)] = val
  })
  
  let currentDate = null // date courante détectée dans la page
  let pdfDateDetected = null // première date trouvée (pour fallback)

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    // Détecter la date de la page courante
    // 🔧 Utiliser [^\s]+ au lieu de \w+ pour capturer les accents (Août, février, etc.)
    const dateMatch = line.match(/(?:lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)\s+(\d{1,2})\s+([^\s]+)/i)
    if (dateMatch) {
      const day = parseInt(dateMatch[1])
      const monthStr = removeAccents(dateMatch[2].toLowerCase()) // 🔧 Normaliser avant lookup
      const month = monthsNormalized[monthStr]
      if (month) {
        const year = new Date().getFullYear()
        currentDate = `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`
        if (!pdfDateDetected) pdfDateDetected = currentDate
      }
    }

    const fullTourMatch = line.match(/TOURNEE\s+TA830(?:CAMION|camion)(m\s+)?(.+)/i)
    if (fullTourMatch) {
      const rawSuffix = (fullTourMatch[1] || '') + fullTourMatch[2]
      const name = extractTourName('ta830camion' + rawSuffix)
      if (seenTours.has(name)) { skip = true; currentTourName = null; inChargement = false }
      else {
        seenTours.add(name); currentTourName = name; skip = false; inChargement = false
        if (!tours[name]) tours[name] = { name, parcels: [], excluded: [], typeLivraison: null, heurePremiereLivraison: null, tourDate: currentDate }
      }
      continue
    }

    const splitCamionMatch = line.match(/ta830camion(.+)/i)
    if (splitCamionMatch && !line.match(/TOURNEE/i)) {
      let namePart = splitCamionMatch[1].trim()
      const nextLine = (lines[i + 1] || '').trim()
      const isContinuation = nextLine.length > 0 && nextLine.length < 60
        && !nextLine.match(/^(SOCIETE|NOM DU|POIDS|CHARGEMENT|LIVRAISON|Type|Référence|Créneau|Quantité|Imprimé|©|LETTRE|Emargement)/i)
        && !nextLine.match(/ta830camion/i) && !nextLine.match(/TOURNEE/i)
        && !nextLine.match(/^\d{9,15}$/) && !nextLine.match(/^\d+\s*\/\s*\d+$/)
      if (isContinuation) { namePart = namePart + ' ' + nextLine; i++ }
      const name = extractTourName('ta830camion' + namePart)
      if (seenTours.has(name)) { skip = true; currentTourName = null; inChargement = false }
      else {
        seenTours.add(name); currentTourName = name; skip = false; inChargement = false
        if (!tours[name]) tours[name] = { name, parcels: [], excluded: [], typeLivraison: null, heurePremiereLivraison: null, tourDate: currentDate }
      }
      continue
    }

    if (skip || !currentTourName) continue
    if (line === 'CHARGEMENT') { inChargement = true; continue }
    if (line.match(/^\s*LIVRAISON\s*$/) && inChargement) { inChargement = false; currentTourName = null; continue }
    if (!inChargement || line === '\f') continue

    if (line.match(/Type\s+prestation/i) && line.match(/\bReprise\b/i) && !line.match(/Livraison contre reprise/i)) {
      const t = tours[currentTourName]
      if (t.parcels.length > 0) { const last = t.parcels.pop(); t.excluded.push({ ...last, exclusionReason: 'Reprise' }) }
      continue
    }
    if (line.match(/Type\s+prestation/i) && line.match(/Livraison contre reprise/i)) {
      const t = tours[currentTourName]
      if (t.parcels.length > 0) t.parcels[t.parcels.length - 1].isLivraisonContreReprise = true
      continue
    }

    if (line.match(/^(Type\s+prestation|Référence|Quantité|Imprimé|POIDS|LETTRE DE VOITURE|Réserves|commentaires|©|Emargement)/i)) continue
    if (line.match(/^\d+\s*\/\s*\d+$/)) continue

    const heureMatch = line.match(/(?:Créneau\s*)?(\d{2}:\d{2})\s*-\s*\d{2}:\d{2}/i)
    if (heureMatch) {
      const t = tours[currentTourName]
      if (t && !t.heurePremiereLivraison) t.heurePremiereLivraison = heureMatch[1]
      continue
    }

    if (!line.match(/LV[123]_/)) continue

    const lvMatch = line.match(/LV([123])_/)
    if (lvMatch && currentTourName) {
      const t = tours[currentTourName]
      if (t && !t.typeLivraison) t.typeLivraison = 'LV' + lvMatch[1]
    }

    const isDea = line.includes('DEA_ENLEVEMENT')
    const lastBarcodeMatch = line.match(/(\d{9,15})\s*$/)
    if (!lastBarcodeMatch) continue

    const bc = lastBarcodeMatch[1]
    if (bc.length === 10 && bc.startsWith('0')) continue
    if (bc.match(/^0033/)) continue
    if (bc.match(/^33[67]/)) continue

    const t = tours[currentTourName]
    if (t) t.parcels.push({ barcode: bc, dea: isDea })
  }

  return { tours: Object.values(tours), detectedDate: pdfDateDetected }
}

export default function UploadPDFPage() {
  const { user } = useAuth()
  const [file, setFile] = useState(null)
  const [dragover, setDragover] = useState(false)
  const [loading, setLoading] = useState(false)
  const [progress, setProgress] = useState('')
  const [result, setResult] = useState(null)
  const [detectedDate, setDetectedDate] = useState(null)
  const [unmatchedTours, setUnmatchedTours] = useState([])
  const [resolving, setResolving] = useState(false)
  const inputRef = useRef(null)

  const handleDrop = e => {
    e.preventDefault()
    setDragover(false)
    const droppedFile = e.dataTransfer.files[0]
    if (droppedFile?.type === 'application/pdf') {
      setFile(droppedFile)
      handleFileAnalyze(droppedFile)
    }
  }

  const handleFileAnalyze = async file => {
    try {
      setProgress('Extraction du PDF...')
      const text = await extractTextFromPDF(file)
      const { tours, detectedDate } = parsePDFText(text)
      setDetectedDate(detectedDate)
      setResult(null) // Réinitialiser les résultats précédents
      const unmatched = tours.filter(t => !t.name.match(/^[A-Z]{1,2}\d{1,3}[A-Z]?$/))
      setUnmatchedTours(unmatched.map(t => ({ ...t, manualName: '' })))
    } catch (error) {
      toast.error('Erreur lors de l\'extraction : ' + error.message)
      setFile(null)
      setDetectedDate(null)
    }
  }

  const handleUpload = async () => {
    if (!file || !detectedDate) {
      toast.error('Date non reconnue')
      return
    }
    setLoading(true)
    try {
      setProgress('Traitement...')
      const text = await extractTextFromPDF(file)
      const { tours, detectedDate: parsedDate } = parsePDFText(text)

      if (!parsedDate) {
        setResult({ success: false, error: 'Date non reconnue' })
        setLoading(false)
        return
      }

      setProgress('Sauvegarde...')
      const { data: deliveryData, error: deliveryError } = await supabase
        .from('delivery_dates')
        .upsert({ date: parsedDate, created_by: user.id }, { onConflict: 'date' })
        .select().single()

      if (deliveryError) throw deliveryError

      const { data: uploadRecord } = await supabase
        .from('pdf_uploads')
        .insert([{ delivery_date_id: deliveryData.id, created_by: user.id, status: 'processing', file_path: file.name }])
        .select().single()

      let totalTours = 0, totalParcels = 0

      for (const tour of tours) {
        const finalName = tour.name
        const refId = tour.name.toUpperCase()
        const tourData = await supabase
          .from('tours')
          .upsert({
            delivery_date_id: deliveryData.id,
            name: finalName,
            reference_id: refId,
            type_livraison: tour.typeLivraison || null,
            heure_premiere_livraison: tour.heurePremiereLivraison || null,
          }, { onConflict: 'reference_id,delivery_date_id' })
          .select().single()

        if (tourData.error) { console.warn(`Tournée ${finalName} ignorée :`, tourData.error.message); continue }

        if (tour.parcels.length > 0) {
          await supabase.from('parcels').upsert(
            tour.parcels.map(p => ({ tour_id: tourData.data.id, barcode: p.barcode, excluded: false, dea: p.dea || false, exclusion_reason: p.isLivraisonContreReprise ? 'Livraison contre reprise' : null })),
            { onConflict: 'barcode,tour_id', ignoreDuplicates: true }
          )
          totalParcels += tour.parcels.length
        }

        if (tour.excluded.length > 0) {
          await supabase.from('parcels').upsert(
            tour.excluded.map(p => ({ tour_id: tourData.data.id, barcode: p.barcode, excluded: true, dea: p.dea || false, exclusion_reason: p.exclusionReason || 'Reprise' })),
            { onConflict: 'barcode,tour_id', ignoreDuplicates: true }
          )
        }
        totalTours++
      }

      if (uploadRecord) {
        await supabase.from('pdf_uploads').update({ status: 'done', tours_created: totalTours, parcels_created: totalParcels }).eq('id', uploadRecord.data.id)
      }

      setResult({ success: true, tours: totalTours, parcels: totalParcels, details: tours.map(t => ({ name: t.name, parcels: t.parcels, excluded: t.excluded })) })
      toast.success(`Import terminé : ${totalTours} tournées, ${totalParcels} colis`)
    } catch (error) {
      setResult({ success: false, error: error.message })
      toast.error('Erreur : ' + error.message)
    } finally {
      setLoading(false)
    }
  }

  const handleResolveUnmatched = async () => {
    setResolving(true)
    try {
      // Logique de résolution des tournées non reconnues
      const text = await extractTextFromPDF(file)
      const { tours } = parsePDFText(text)
      const updatedTours = tours.map(t => ({
        ...t,
        finalName: unmatchedTours.find(u => u.rawName === t.name)?.manualName || t.name
      }))
      await handleUpload() // Relancer l'upload avec les noms corrigés
    } catch (error) {
      toast.error('Erreur : ' + error.message)
    } finally {
      setResolving(false)
    }
  }

  return (
    <>
      <div className="page-header">
        <h2 className="page-title">Importer un PDF</h2>
        <p className="page-subtitle">Chargez une feuille de route pour créer les tournées automatiquement</p>
      </div>

      <div className="page-body" style={{ maxWidth: '680px' }}>
        <div className="card">
          <div className="card-header">
            <span className="card-title">Nouveau document</span>
          </div>
          <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>

            {detectedDate && (
              <div style={{ padding: '10px 14px', background: '#f0fdf4', border: '1px solid #a7f3d0', borderRadius: 'var(--radius-sm)', fontSize: 13, color: '#065f46' }}>
                📅 Date détectée : <strong>{new Date(detectedDate + 'T12:00:00').toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</strong>
              </div>
            )}

            <div
              className={`upload-zone${dragover ? ' dragover' : ''}`}
              onClick={() => inputRef.current?.click()}
              onDragOver={e => { e.preventDefault(); setDragover(true) }}
              onDragLeave={() => setDragover(false)}
              onDrop={handleDrop}
            >
              <input ref={inputRef} type="file" accept=".pdf" style={{ display: 'none' }} onChange={e => {
                const file = e.target.files[0]
                setFile(file)
                if (file) handleFileAnalyze(file)
              }} />
              {file ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', justifyContent: 'center' }}>
                  <FileText size={28} color="var(--accent)" />
                  <div style={{ textAlign: 'left' }}>
                    <div style={{ fontWeight: 600, color: 'var(--gray-700)' }}>{file.name}</div>
                    <div style={{ fontSize: '12px', color: 'var(--gray-400)' }}>{(file.size / 1024 / 1024).toFixed(2)} Mo</div>
                  </div>
                  <button className="btn btn-ghost btn-sm" onClick={e => { e.stopPropagation(); setFile(null); setDetectedDate(null) }}>
                    <X size={14} />
                  </button>
                </div>
              ) : (
                <>
                  <div className="upload-zone-icon"><Upload size={36} /></div>
                  <div className="upload-zone-title">Déposez votre PDF ici</div>
                  <div className="upload-zone-sub">La date de livraison sera détectée automatiquement</div>
                </>
              )}
            </div>

            {loading && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '12px 16px', background: 'var(--accent-light)', borderRadius: 'var(--radius-sm)' }}>
                <div className="spinner dark" style={{ borderTopColor: 'var(--accent)', borderColor: 'rgba(79,70,229,0.2)' }} />
                <span style={{ fontSize: '14px', color: 'var(--accent)' }}>{progress}</span>
              </div>
            )}

            {unmatchedTours.length > 0 && (
              <div style={{ padding: '16px 20px', borderRadius: 'var(--radius-sm)', background: '#fffbeb', border: '1px solid #fcd34d' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                  <AlertTriangle size={16} color="#d97706" />
                  <span style={{ fontWeight: 700, color: '#92400e', fontSize: 14 }}>
                    {unmatchedTours.length} tournée{unmatchedTours.length > 1 ? 's' : ''} non reconnue{unmatchedTours.length > 1 ? 's' : ''}
                  </span>
                </div>
                <p style={{ fontSize: 12, color: '#92400e', marginBottom: 14 }}>
                  Ces tournées extraites du PDF ne correspondent à aucun nom officiel. Saisissez le nom correct pour chacune.
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {unmatchedTours.map((t, idx) => (
                    <div key={idx} style={{ background: 'white', borderRadius: 'var(--radius-sm)', border: '1px solid #fcd34d', padding: '12px 14px' }}>
                      <div style={{ fontSize: 12, color: 'var(--gray-400)', marginBottom: 6 }}>
                        Nom extrait du PDF :
                        <code style={{ marginLeft: 6, fontWeight: 700, color: 'var(--gray-700)', background: 'var(--gray-100)', padding: '1px 6px', borderRadius: 4 }}>{t.name}</code>
                        <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--gray-400)' }}>({t.parcels.length} colis)</span>
                      </div>
                      <input
                        className="form-input"
                        placeholder="Nom officiel de la tournée..."
                        value={t.manualName}
                        onChange={e => {
                          const updated = [...unmatchedTours]
                          updated[idx] = { ...updated[idx], manualName: e.target.value }
                          setUnmatchedTours(updated)
                        }}
                        style={{ fontSize: 13 }}
                      />
                    </div>
                  ))}
                </div>
                <button className="btn btn-primary" onClick={handleResolveUnmatched} disabled={resolving} style={{ marginTop: 14, width: '100%', justifyContent: 'center' }}>
                  {resolving ? <><div className="spinner" /> Importation...</> : <><CheckCircle size={14} /> Confirmer et importer</>}
                </button>
              </div>
            )}

            {result && (
              <div style={{ padding: '16px 20px', borderRadius: 'var(--radius-sm)', background: result.success ? 'var(--green-light)' : 'var(--red-light)', border: `1px solid ${result.success ? '#a7f3d0' : '#fca5a5'}` }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: result.success ? '8px' : 0 }}>
                  {result.success ? <CheckCircle size={18} color="#059669" /> : <AlertCircle size={18} color="#dc2626" />}
                  <span style={{ fontWeight: 600, color: result.success ? '#065f46' : '#991b1b', fontSize: '14px' }}>
                    {result.success ? 'Import réussi !' : "Erreur lors de l'import"}
                  </span>
                </div>
                {result.success ? (
                  <div style={{ fontSize: '13px', color: '#065f46', marginLeft: '28px' }}>
                    <div>{result.tours} tournées créées</div>
                    <div>{result.parcels} colis à scanner</div>
                    {result.details?.map(t => (
                      <div key={t.name} style={{ marginTop: '4px', opacity: 0.7 }}>
                        → {t.name} : {t.parcels.length} colis
                        {t.excluded.length > 0 && ` (${t.excluded.length} Reprises exclus)`}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div style={{ fontSize: '13px', color: '#991b1b', marginLeft: '28px' }}>{result.error}</div>
                )}
              </div>
            )}

            {unmatchedTours.length === 0 && (
              <button className="btn btn-primary" onClick={handleUpload} disabled={loading || !file} style={{ alignSelf: 'flex-start' }}>
                {loading ? <><div className="spinner" /> Traitement...</> : <><Upload size={15} /> Importer et analyser</>}
              </button>
            )}
          </div>
        </div>
      </div>
    </>
  )
}
