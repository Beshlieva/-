import React, { Suspense, lazy, useEffect, useState } from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'

// Панель администратора грузится отдельным фрагментом и только по адресу /#/admin:
// студенческий интерфейс остаётся прежним и не получает её код.
const AdminApp = lazy(() => import('./AdminApp'))

const isAdminRoute = () => window.location.hash.replace(/\/+$/, '') === '#/admin'

function Root() {
  const [admin, setAdmin] = useState(isAdminRoute)
  useEffect(() => {
    const onHash = () => setAdmin(isAdminRoute())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])
  if (!admin) return <App />
  return (
    <Suspense fallback={null}>
      <AdminApp />
    </Suspense>
  )
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
)
