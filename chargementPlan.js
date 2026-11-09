// Plan de chargement : règle de priorité
//   1) heure de première livraison (la plus tôt d'abord)
//   2) distance entre Antony (92160) et le code postal de la première livraison (la plus lointaine d'abord)
//      une LV1 (chauffeur seul, chargement plus long) compte pour « lv1Km » km de plus
//   3) capacité : 9 quais par créneau ; au-delà, la tournée passe au créneau suivant
// Les quais sont placés au hasard dans chaque créneau.

export const QUAIS = [3, 6, 7, 8, 9, 10, 11, 12, 13]
export const SITE_CP = '92160' // Antony

// Créneaux de départ habituels selon l'heure de première livraison (minutes), déduits de l'historique de juillet à novembre 2026
export const SLOT_RULES = {
  360: [330, 360],        // 06:00 -> 05:30 ou 06:00
  480: [360, 390],        // 08:00 -> 06:00 ou 06:30
  660: [600, 630],        // 11:00 -> 10:00 ou 10:30
  780: [720, 750, 780],   // 13:00 -> 12:00, 12:30, 13:00
  810: [720, 750, 780],   // 13:30
  855: [780, 810],        // 14:15
}

export const fmtMin = m => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
export const parseHM = s => {
  const m = /^(\d{1,2}):(\d{2})/.exec(s || '')
  return m ? Number(m[1]) * 60 + Number(m[2]) : null
}

export function distanceKm(coords, cp) {
  const a = coords[SITE_CP], b = coords[cp]
  if (!a || !b) return null
  const R = 6371, p = Math.PI / 180
  const h = Math.sin(((b[0] - a[0]) * p) / 2) ** 2 + Math.cos(a[0] * p) * Math.cos(b[0] * p) * Math.sin(((b[1] - a[1]) * p) / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

function allowedFor(hpl, rules) {
  const keys = Object.keys(rules).map(Number)
  const h = hpl ?? keys[0]
  const k = keys.reduce((best, x) => (Math.abs(x - h) < Math.abs(best - h) ? x : best), keys[0])
  return rules[k]
}

function rng(seed) { // petit générateur reproductible
  let a = seed >>> 0
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
}

export function shuffleQuais(plan, seed) {
  const rand = rng(seed)
  const bySlot = {}
  plan.forEach(t => { (bySlot[t.slot] ||= []).push(t) })
  const out = {}
  Object.values(bySlot).forEach(list => {
    const q = [...QUAIS]
    for (let i = q.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [q[i], q[j]] = [q[j], q[i]] }
    list.forEach((t, i) => { out[t.id] = q[i] ?? null })
  })
  return plan.map(t => ({ ...t, quai: out[t.id] }))
}

// tours : [{ id, name, hpl (minutes|null), lv1 (bool), dist (km|null), ... }]
export function generatePlan(tours, { lv1Km = 5, capacity = 9, rules = SLOT_RULES, seed = 1 } = {}) {
  const t = tours.map(x => ({
    ...x,
    score: (x.dist ?? 0) + (x.lv1 ? lv1Km : 0),
    allowed: allowedFor(x.hpl, rules),
    slot: null,
    overflow: false,
  }))
  const prio = (a, b) => (a.hpl ?? 9999) - (b.hpl ?? 9999) || b.score - a.score || a.name.localeCompare(b.name)
  t.sort(prio)

  const count = {}
  let pending = [...t]
  const slots = [...new Set(t.flatMap(x => x.allowed))].sort((a, b) => a - b)
  for (const s of slots) {
    const cand = pending.filter(x => x.allowed.includes(s))
    // les tournées dont c'est le dernier créneau possible passent d'abord
    cand.sort((a, b) => (Math.max(...a.allowed) === s ? 0 : 1) - (Math.max(...b.allowed) === s ? 0 : 1) || prio(a, b))
    for (const x of cand.slice(0, capacity)) { x.slot = s; count[s] = (count[s] || 0) + 1 }
    pending = pending.filter(x => x.slot == null)
  }
  for (const x of pending) { // débordement : créneau suivant disponible
    let s = Math.max(...x.allowed)
    while ((count[s] || 0) >= capacity) s += 30
    x.slot = s; x.overflow = true; count[s] = (count[s] || 0) + 1
  }
  return shuffleQuais(t, seed).sort((a, b) => a.slot - b.slot || prio(a, b))
}
