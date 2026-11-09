import { useState } from 'react'
import { supabase } from './supabase'
import toast from 'react-hot-toast'
import { MapPin } from 'lucide-react'
import { extractTextFromPDF, parsePDFText, matchTourName } from './UploadPDF'

// Relit les anciens PDF conservés dans Storage (« tour-pdfs ») et renseigne le code postal
// de la première livraison des tournées déjà importées. Sans risque : ne remplit que les tournées sans code postal.
export default function BackfillCodesPostaux() {
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState('')
  const [report, setReport] = useState(null)

  async function run() {
    if (!confirm('Relire tous les anciens PDF importés pour renseigner le code postal de la première livraison ?\nCela peut prendre plusieurs minutes. Gardez cette page ouverte.')) return
    setRunning(true)
    setReport(null)
    let updated = 0, skipped = 0, failed = 0
    try {
      const [{ data: uploads, error: upErr }, { data: refs }, { data: dates }] = await Promise.all([
        supabase.from('pdf_uploads').select('id, storage_path, filename').not('storage_path', 'is', null),
        supabase.from('tours_references').select('id, name'),
        supabase.from('delivery_dates').select('id, delivery_date'),
      ])
      if (upErr) throw upErr
      const dateId = {}
      ;(dates || []).forEach(d => { dateId[d.delivery_date] = d.id })

      for (let i = 0; i < uploads.length; i++) {
        const u = uploads[i]
        setProgress(`PDF ${i + 1}/${uploads.length} : ${u.filename || u.storage_path}`)
        try {
          const { data: blob, error: dlErr } = await supabase.storage.from('tour-pdfs').download(u.storage_path)
          if (dlErr) throw dlErr
          const text = await extractTextFromPDF(blob)
          const { tours, pdfDate } = parsePDFText(text)
          for (const t of tours) {
            if (!t.codePostalPremiereLivraison) { skipped++; continue }
            const m = matchTourName(t.name, refs || [])
            const dId = dateId[t.tourDate || pdfDate]
            if (!m.matched || !dId) { skipped++; continue }
            const { data, error } = await supabase
              .from('tours')
              .update({ code_postal_premiere_livraison: t.codePostalPremiereLivraison })
              .eq('reference_id', m.referenceId)
              .eq('delivery_date_id', dId)
              .is('code_postal_premiere_livraison', null)
              .select('id')
            if (error) throw error
            updated += data?.length || 0
          }
        } catch (err) {
          console.error('Rattrapage', u.storage_path, err)
          failed++
        }
      }
      setReport({ updated, skipped, failed, files: uploads.length })
      toast.success(`${updated} tournée(s) mise(s) à jour`)
    } catch (err) {
      toast.error('Erreur : ' + err.message)
    } finally {
      setRunning(false)
      setProgress('')
    }
  }

  return (
    <div className="card" style={{ marginTop: 24 }}>
      <div style={{ padding: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
          <MapPin size={16} />
          <strong style={{ fontSize: 14 }}>Historique : codes postaux de la première livraison</strong>
        </div>
        <p style={{ fontSize: 13, color: 'var(--gray-500)', marginBottom: 12 }}>
          Relit les PDF déjà importés (conservés dans Storage) et renseigne le code postal du premier client de chaque tournée.
          Les tournées qui ont déjà un code postal ne sont pas modifiées.
        </p>
        <button className="btn btn-secondary" onClick={run} disabled={running}>
          {running ? <><div className="spinner dark" /> Traitement...</> : "Récupérer les codes postaux de l'historique"}
        </button>
        {progress && <p style={{ fontSize: 12, color: 'var(--gray-400)', marginTop: 8 }}>{progress}</p>}
        {report && (
          <p style={{ fontSize: 13, color: 'var(--gray-700)', marginTop: 10 }}>
            {report.files} PDF lus · <strong>{report.updated}</strong> tournées mises à jour · {report.skipped} ignorées (tournée non reconnue ou sans adresse)
            {report.failed > 0 && <> · <span style={{ color: 'var(--red)' }}>{report.failed} PDF en erreur</span></>}
          </p>
        )}
      </div>
    </div>
  )
}
