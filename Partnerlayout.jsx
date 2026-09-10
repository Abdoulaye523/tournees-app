import { Outlet, useNavigate } from 'react-router-dom'
import { useAuth } from './AuthContext'
import { LogOut, ClipboardList } from 'lucide-react'

export default function PartnerLayout() {
  const { profile, signOut } = useAuth()
  const navigate = useNavigate()

  const initials = profile?.full_name
    ? profile.full_name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()
    : '?'

  async function handleSignOut() {
    await signOut()
    navigate('/login')
  }

  return (
    <div className="app-layout">
      <aside className="sidebar" style={{ position: 'static' }}>
        <div className="sidebar-logo">
          <div>
            <h1>Superflash</h1>
            <p>Accès partenaire</p>
          </div>
        </div>

        <nav className="sidebar-nav">
          <span className="sidebar-section-label">Suivi</span>
          <div className="nav-item active">
            <ClipboardList size={16} />
            Suivi des tâches
          </div>
        </nav>

        <div className="sidebar-footer">
          <div className="user-card">
            <div className="user-avatar">{initials}</div>
            <div className="user-info">
              <div className="user-name">{profile?.full_name || profile?.email}</div>
              <div className="user-role">Partenaire</div>
            </div>
            <button className="btn-logout" onClick={handleSignOut} title="Déconnexion">
              <LogOut size={15} />
            </button>
          </div>
        </div>
      </aside>

      <main className="main-content">
        <div className="mobile-topbar">
          <span className="mobile-topbar-logo">Superflash</span>
          <div className="user-avatar" style={{ width: 32, height: 32, fontSize: 11 }}>
            {initials}
          </div>
        </div>
        <Outlet />
      </main>
    </div>
  )
}
