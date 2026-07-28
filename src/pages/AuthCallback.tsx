import {useEffect} from 'react'
import {useNavigate} from 'react-router-dom'
import {supabase} from '../lib/supabase'
export default function AuthCallback(){const navigate=useNavigate();useEffect(()=>{(async()=>{const code=new URL(window.location.href).searchParams.get('code');if(code){const{error}=await supabase.auth.exchangeCodeForSession(code);if(error){navigate(`/login?error=${encodeURIComponent(error.message)}`,{replace:true});return}}navigate('/',{replace:true})})()},[navigate]);return <main className="min-h-screen grid place-items-center">Completing secure sign-in…</main>}
