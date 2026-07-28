import type {ReactNode} from 'react'
import {Navigate,useLocation} from 'react-router-dom'
import {useAuth} from '../../hooks/useAuth'
export function ProtectedRoute({children}:{children:ReactNode}){const{session,loading}=useAuth();const location=useLocation();if(loading)return <main className="min-h-screen bg-slate-950 text-white grid place-items-center"><p>Checking authentication…</p></main>;if(!session)return <Navigate to="/login" replace state={{from:`${location.pathname}${location.search}`}}/>;return children}
