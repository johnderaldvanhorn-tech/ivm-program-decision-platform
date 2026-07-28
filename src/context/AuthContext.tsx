import { createContext, ReactNode, useContext, useMemo, useState } from 'react'
import { ensureDefaultUser, getSessionUser, signIn as localSignIn, signOut as localSignOut, type PublicUser } from '../lib/localAuth'

type AuthContextValue = {
  user: PublicUser | null
  loading: boolean
  signIn: (email: string, password: string) => Promise<void>
  signOut: () => void
  refreshUser: () => void
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  ensureDefaultUser()
  const [user, setUser] = useState<PublicUser | null>(() => getSessionUser())
  const value = useMemo<AuthContextValue>(() => ({
    user,
    loading: false,
    signIn: async (email, password) => setUser(await localSignIn(email, password)),
    signOut: () => { localSignOut(); setUser(null) },
    refreshUser: () => setUser(getSessionUser()),
  }), [user])
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used inside AuthProvider.')
  return context
}
