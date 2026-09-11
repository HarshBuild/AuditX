import { HashRouter } from 'react-router-dom'
import { AuthProvider } from './lib/auth'
import AppRoutes from './lib/routes'

export default function App() {
  return (
    <HashRouter>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </HashRouter>
  )
}