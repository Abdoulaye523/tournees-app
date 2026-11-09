import { supabase } from './supabase'

// Tâches de fin de journée, à cocher chaque jour. L'envoi du rapport par email n'est possible que lorsque
// la checklist du jour est complète.
// - auto : coché automatiquement (pas de case à cocher manuelle)
// - link : raccourci vers la page concernée
export const CHECKLIST_ITEMS = [
  { key: 'import_pdf', label: 'Importer le PDF avec les tournées (préparation du prochain jour de livraison)', auto: true, link: '/admin/upload' },
  { key: 'impression', label: 'Impression des feuilles de tournées' },
  { key: 'agrafage', label: 'Agrafage des feuilles de tournées' },
  { key: 'suivi_retours', label: 'Mise à jour des retours de tournées (onglet « Suivi des tournées »)', link: '/admin/suivi-tournees' },
  { key: 'verif_demandes', label: 'Vérification des demandes à traiter (onglet « Demandes »)', link: '/admin/demandes' },
  { key: 'heures_reflex', label: 'Heures de réception et de départ remplies sur Réflex' },
  { key: 'cmr_kizeo', label: 'CMR envoyées via Kizeo' },
  { key: 'manquants_reflex', label: 'Vérification des manquants dans Réflex' },
  { key: 'scan_tournees', label: 'Scan de toutes les tournées', link: '/admin/tours' },
  { key: 'validation_reflex', label: 'Validation des tournées dans Réflex' },
  { key: 'manquants_feuilles', label: 'Écrire les manquants sur les feuilles de tournées' },
  { key: 'diables', label: 'Rangement des 4 diables bleus sur la ligne 2-3' },
  { key: 'transpalettes', label: 'Rangement et mise en charge des transpalettes électriques' },
  { key: 'pda', label: 'Mise en charge des PDA' },
  { key: 'proprete_bennes', label: 'Vérification de la propreté devant les bennes' },
  { key: 'compacteur', label: 'Éteindre le compacteur' },
]

// Date du jour en heure locale ('YYYY-MM-DD') : la checklist est une liste de tâches de fin de journée
export const localToday = () => new Date().toLocaleDateString('en-CA')

// Préparation du prochain jour de livraison : la préparation se fait le jour J pour un départ en J+1
// (ou J+3 avant un week-end). On cherche la première journée de livraison APRÈS le jour J et ses tournées.
export async function getNextPreparation(day) {
  const { data: dd, error } = await supabase
    .from('delivery_dates')
    .select('id, delivery_date')
    .gt('delivery_date', day)
    .order('delivery_date', { ascending: true })
    .limit(1)
  if (error) throw error
  if (!dd?.length) return null
  const { count, error: e2 } = await supabase
    .from('tours')
    .select('id', { count: 'exact', head: true })
    .eq('delivery_date_id', dd[0].id)
  if (e2) throw e2
  return (count || 0) > 0 ? { date: dd[0].delivery_date, tours: count } : null
}

// Résumé de la checklist d'un jour ('YYYY-MM-DD'), indépendante des dates de livraison
export async function getChecklistStatus(date) {
  const manual = CHECKLIST_ITEMS.filter(i => !i.auto)
  const { data, error } = await supabase
    .from('checklist_checks')
    .select('item_key')
    .eq('delivery_date', date) // colonne historique : contient ici le jour de la checklist
  if (error) throw error
  const checked = new Set((data || []).map(r => r.item_key))
  const missing = manual.filter(i => !checked.has(i.key))
  const prep = await getNextPreparation(date)
  if (!prep) missing.unshift(CHECKLIST_ITEMS.find(i => i.auto)) // le PDF du prochain jour n'est pas importé
  return {
    total: CHECKLIST_ITEMS.length,
    done: CHECKLIST_ITEMS.length - missing.length,
    missing,
    complete: missing.length === 0,
    prep,
  }
}
