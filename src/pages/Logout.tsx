import {useEffect} from 'react'
import {Navigate} from 'react-router-dom'
import {useAuth} from '../hooks/useAuth'
export default function Logout(){const{logout}=useAuth();useEffect(()=>{void logout()},[logout]);return <Navigate to="/login" replace/>}
