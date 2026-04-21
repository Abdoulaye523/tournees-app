import { createContext, useContext, useEffect, useState, useRef } from 'react'
import { supabase } from './supabase'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)
  const initialized = useRef(false)

  async function fetchProfile(userId) {
    try {
      const { data } = await supabase
        .from('users')
        .select('*')
        .eq('id', userId)
        .single()
      setProfile(data || null)
    } catch (e) {
      setProfile(null)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    // 1. Charger la session existante au démarrage
    supabase.auth.getSession().then(({ data: { session } }) => {
      initialized.current = true
      setUser(session?.user ?? null)
      if (session?.user) {
        fetchProfile(session.user.id)
      } else {
        setLoading(false)
      }
    })

    // 2. Écouter les changements d'auth (login, logout)
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        // Ignorer le premier événement si getSession l'a déjà traité
        // pour éviter la double exécution au démarrage
        if (!initialized.current) return

        setUser(session?.user ?? null)

        if (session?.user) {
          // Nouveau login — recharger le profil depuis la base
          setLoading(true)
          await fetchProfile(session.user.id)
        } else {
          // Logout
          setProfile(null)
          setLoading(false)
        }
      }
    )

    return () => subscription.unsubscribe()
  }, [])

  async function signIn(email, password) {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    return { error }
  }

  async function signOut() {
    setProfile(null)
    setUser(null)
    await supabase.auth.signOut()
  }

  return (
    <AuthContext.Provider value={{ user, profile, loading, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
