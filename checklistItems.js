import { supabase } from './supabase'

// Éléments à cocher avant de valider le contrôle d'une journée (et d'envoyer le rapport par email).
// - auto : coché automatiquement (pas de case à cocher manuelle)
// - link : raccourci vers la page concernée
export const CHECKLIST_ITEMS = [
  { key: 'import_pdf', label: 'Importer le PDF avec les tournées', auto: true, link: '/admin/upload' },
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
  { key: 'proprete_bennes', label: 'Vérification de la propreté devant les bennes' },
  { key: 'compacteur', label: 'Éteindre le compacteur' },
]

// Résumé de la checklist d'une date de livraison ('YYYY-MM-DD')
export async function getChecklistStatus(date) {
  const manual = CHECKLIST_ITEMS.filter(i => !i.auto)
  const { data, error } = await supabase
    .from('checklist_checks')
    .select('item_key')
    .eq('delivery_date', date)
  if (error) throw error
  const checked = new Set((data || []).map(r => r.item_key))
  const missing = manual.filter(i => !checked.has(i.key))
  return {
    total: CHECKLIST_ITEMS.length,
    done: CHECKLIST_ITEMS.length - missing.length, // l'import est forcément fait si des tournées existent
    missing,
    complete: missing.length === 0,
  }
}
