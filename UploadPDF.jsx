import { useState, useRef } from 'react'
import { supabase } from './supabase'
import { useAuth } from './AuthContext'
import { Upload, FileText, CheckCircle, AlertCircle, X } from 'lucide-react'
import toast from 'react-hot-toast'

// ─── PDF PARSER ───────────────────────────────────────────────────────────────

async function extractTextFromPDF(file) {
  // Utilise pdf.js via CDN pour extraire le texte correctement
  const pdfjsLib = await loadPdfJs()

  const arrayBuffer = await file.arrayBuffer()
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise

  let fullText = ''
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i)
    const content = await page.getTextContent()

    // Reconstituer les lignes en tenant compte des positions Y
    const items = content.items
    let lastY = null
    let line = ''

    for (const item of items) {
      const y = item.transform[5]
      if (lastY !== null && Math.abs(y - lastY) > 2) {
        fullText += line + '\n'
        line = item.str
      } else {
        line += item.str
      }
      lastY = y
    }
    if (line) fullText += line + '\n'
    fullText += '\f' // séparateur de page
  }

  return fullText
}

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

function parsePDFText(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean)
  const tours = {}
  let currentTourName = null
  let inChargement = false

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    // Détection tournée : ligne contenant CAMION (insensible casse)
    const tourMatch = line.match(/TOURNEE\s+TA830(?:CAMION|camion)(.+)/i)
    if (tourMatch) {
      currentTourName = tourMatch[1].trim()
      if (!tours[currentTourName]) {
        tours[currentTourName] = { name: currentTourName, parcels: [], excluded: [] }
      }
      inChargement = false
      continue
    }

    // Cas MNS1 : nom sur ligne séparée
    const camionLine = line.match(/^ta830camion(.+)/i)
    if (camionLine && !line.toUpperCase().includes('TOURNEE')) {
      currentTourName = camionLine[1].trim()
      if (!tours[currentTourName]) {
        tours[currentTourName] = { name: currentTourName, parcels: [], excluded: [] }
      }
      continue
    }

    if (!currentTourName) continue

    // Section CHARGEMENT → on parse
    if (line === 'CHARGEMENT') {
      inChargement = true
      continue
    }

    // Section LIVRAISON → on arrête pour cette tournée
    if (line === 'LIVRAISON' && inChargement) {
      inChargement = false
      currentTourName = null
      continue
    }

    if (!inChargement) continue

    // Nouvelle page → reset si on tombe sur une nouvelle tournée
    if (line === '\f') continue

    // Détecter type Reprise sur la ligne suivante du colis
    if (line.match(/Type\s+prestation/i) && line.includes('Reprise')) {
      // Marquer le dernier colis comme exclu
      const t = tours[currentTourName]
      if (t.parcels.length > 0) {
        const last = t.parcels.pop()
        t.excluded.push({ ...last, exclusionReason: 'Reprise' })
      }
      continue
    }

    // Détection barcode : 9 à 15 chiffres en fin de ligne (ou seul sur la ligne)
    const barcodeMatch = line.match(/(\d{9,15})\s*$/)
    if (
      barcodeMatch &&
      !line.match(/^Type\s+prestation/i) &&
      !line.match(/^Référence/i) &&
      !line.match(/^Créneau/i) &&
      !line.match(/^Quantité/i) &&
      !line.match(/^\d{2}:\d{2}/) // pas une heure
    ) {
      const barcode = barcodeMatch[1]
      const t = tours[currentTourName]
      const exists = t.parcels.some(p => p.barcode === barcode)
        || t.excluded.some(p => p.barcode === barcode)
      if (!exists) {
        t.parcels.push({ barcode })
      }
    }
  }

  return Object.values(tours).filter(t => t.parcels.length > 0 || t.excluded.length > 0)
}

// ─── COMPONENT ────────────────────────────────────────────────────────────────
export default function UploadPDF() {
  const { profile } = useAuth()
  const [file, setFile] = useState(null)
  const [deliveryDate, setDeliveryDate] = useState('')
  const [loading, setLoading] = useState(false)
  const [progress, setProgress] = useState('')
  const [result, setResult] = useState(null)
  const [dragover, setDragover] = useState(false)
  const inputRef = useRef()

  const tomorrow = new Date()
  tomorrow.setDate(tomorrow.getDate() + 1)
  const tomorrowStr = tomorrow.toISOString().split('T')[0]

  function handleDrop(e) {
    e.preventDefault()
    setDragover(false)
    const f = e.dataTransfer.files[0]
    if (f?.type === 'application/pdf') setFile(f)
    else toast.error('Veuillez déposer un fichier PDF.')
  }

  async function handleUpload() {
    if (!file || !deliveryDate) return toast.error('Sélectionnez un fichier et une date.')
    setLoading(true)
    setResult(null)

    try {
      // 1. Upload Storage
      setProgress('Envoi du fichier...')
      const path = `${deliveryDate}/${Date.now()}_${file.name}`
      const { error: uploadError } = await supabase.storage
        .from('tour-pdfs')
        .upload(path, file)
      if (uploadError) throw new Error('Erreur upload : ' + uploadError.message)

      // 2. Delivery date
      setProgress('Création de la date de livraison...')
      const { data: dateData, error: dateError } = await supabase
        .from('delivery_dates')
        .upsert({ delivery_date: deliveryDate }, { onConflict: 'delivery_date' })
        .select()
        .single()
      if (dateError) throw new Error('Erreur date : ' + dateError.message)

      // 3. Enregistrer upload
      const { data: uploadRecord } = await supabase
        .from('pdf_uploads')
        .insert({
          delivery_date_id: dateData.id,
          uploaded_by: profile.id,
          filename: file.name,
          storage_path: path,
          status: 'processing',
        })
        .select()
        .single()

      // 4. Extraction texte PDF avec pdf.js
      setProgress('Extraction du texte du PDF...')
      const text = await extractTextFromPDF(file)

      // Debug : log les 500 premiers caractères
      console.log('PDF text sample:', text.substring(0, 500))

      // 5. Parser
      setProgress('Analyse des tournées...')
      const parsedTours = parsePDFText(text)
      console.log('Parsed tours:', parsedTours)

      if (parsedTours.length === 0) {
        throw new Error('Aucune tournée détectée. Vérifiez que le PDF contient bien les lignes TOURNEE TA830CAMION...')
      }

      // 6. Insertion en base
      setProgress(`Insertion de ${parsedTours.length} tournées...`)
      let totalTours = 0
      let totalParcels = 0

      for (const tour of parsedTours) {
        const { data: tourData, error: tourError } = await supabase
          .from('tours')
          .upsert({
            delivery_date_id: dateData.id,
            name: tour.name,
            total_parcels: tour.parcels.length,
            excluded_parcels: tour.excluded.length,
            status: 'pending',
          }, { onConflict: 'delivery_date_id,name' })
          .select()
          .single()

        if (tourError) {
          console.warn(`Tournée ${tour.name} ignorée:`, tourError.message)
          continue
        }

        if (tour.parcels.length > 0) {
          const { error: parcelsError } = await supabase
            .from('parcels')
            .upsert(
              tour.parcels.map(p => ({ tour_id: tourData.id, barcode: p.barcode, excluded: false })),
              { onConflict: 'barcode', ignoreDuplicates: true }
            )
          if (!parcelsError) totalParcels += tour.parcels.length
        }

        if (tour.excluded.length > 0) {
          await supabase.from('parcels').upsert(
            tour.excluded.map(p => ({
              tour_id: tourData.id,
              barcode: p.barcode,
              excluded: true,
              exclusion_reason: p.exclusionReason || 'Reprise',
            })),
            { onConflict: 'barcode', ignoreDuplicates: true }
          )
        }

        totalTours++
      }

      // 7. Mettre à jour statut upload
      if (uploadRecord) {
        await supabase.from('pdf_uploads').update({
          status: 'done',
          tours_created: totalTours,
          parcels_created: totalParcels,
        }).eq('id', uploadRecord.id)
      }

      setResult({ success: true, tours: totalTours, parcels: totalParcels, details: parsedTours })
      toast.success(`Import terminé : ${totalTours} tournées, ${totalParcels} colis`)

    } catch (err) {
      console.error('Upload error:', err)
      setResult({ success: false, error: err.message })
      toast.error('Erreur : ' + err.message)
    } finally {
      setLoading(false)
      setProgress('')
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

            <div className="form-group">
              <label className="form-label">Date de livraison</label>
              <input
                type="date"
                className="form-input"
                value={deliveryDate || tomorrowStr}
                onChange={e => setDeliveryDate(e.target.value)}
              />
              <span style={{ fontSize: '12px', color: 'var(--gray-400)' }}>
                Exemple : si aujourd'hui on contrôle les tournées du 16 avril, sélectionnez le 16 avril.
              </span>
            </div>

            <div
              className={`upload-zone${dragover ? ' dragover' : ''}`}
              onClick={() => inputRef.current?.click()}
              onDragOver={e => { e.preventDefault(); setDragover(true) }}
              onDragLeave={() => setDragover(false)}
              onDrop={handleDrop}
            >
              <input
                ref={inputRef}
                type="file"
                accept=".pdf"
                style={{ display: 'none' }}
                onChange={e => setFile(e.target.files[0])}
              />
              {file ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', justifyContent: 'center' }}>
                  <FileText size={28} color="var(--accent)" />
                  <div style={{ textAlign: 'left' }}>
                    <div style={{ fontWeight: 600, color: 'var(--gray-700)' }}>{file.name}</div>
                    <div style={{ fontSize: '12px', color: 'var(--gray-400)' }}>
                      {(file.size / 1024 / 1024).toFixed(2)} Mo
                    </div>
                  </div>
                  <button className="btn btn-ghost btn-sm" onClick={e => { e.stopPropagation(); setFile(null) }}>
                    <X size={14} />
                  </button>
                </div>
              ) : (
                <>
                  <div className="upload-zone-icon"><Upload size={36} /></div>
                  <div className="upload-zone-title">Déposez votre PDF ici</div>
                  <div className="upload-zone-sub">ou cliquez pour parcourir vos fichiers</div>
                </>
              )}
            </div>

            {loading && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '12px 16px', background: 'var(--accent-light)', borderRadius: 'var(--radius-sm)' }}>
                <div className="spinner dark" style={{ borderTopColor: 'var(--accent)', borderColor: 'rgba(79,70,229,0.2)' }} />
                <span style={{ fontSize: '14px', color: 'var(--accent)' }}>{progress}</span>
              </div>
            )}

            {result && (
              <div style={{
                padding: '16px 20px', borderRadius: 'var(--radius-sm)',
                background: result.success ? 'var(--green-light)' : 'var(--red-light)',
                border: `1px solid ${result.success ? '#a7f3d0' : '#fca5a5'}`,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: result.success ? '8px' : 0 }}>
                  {result.success ? <CheckCircle size={18} color="#059669" /> : <AlertCircle size={18} color="#dc2626" />}
                  <span style={{ fontWeight: 600, color: result.success ? '#065f46' : '#991b1b', fontSize: '14px' }}>
                    {result.success ? 'Import réussi !' : 'Erreur lors de l\'import'}
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

            <button
              className="btn btn-primary"
              onClick={handleUpload}
              disabled={loading || !file}
              style={{ alignSelf: 'flex-start' }}
            >
              {loading ? <><div className="spinner" /> Traitement...</> : <><Upload size={15} /> Importer et analyser</>}
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
