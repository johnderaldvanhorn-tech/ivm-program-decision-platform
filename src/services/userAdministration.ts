import { supabase } from '../lib/supabase'
import type { ManagedUser, UserRole } from '../types/users'
export async function listManagedUsers(): Promise<ManagedUser[]> { const { data, error } = await supabase.from('user_profiles').select('*').order('created_at', { ascending:false }); if (error) throw error; return (data || []) as ManagedUser[] }
export async function inviteUser(input:{ email:string; firstName?:string; lastName?:string; role:UserRole; department?:string }) { const { data, error } = await supabase.functions.invoke('invite-user', { body: input }); if (error) throw error; if (data?.error) throw new Error(data.error); return data }
export async function manageUser(input:{ action:string; userId:string; role?:UserRole; department?:string }) { const { data, error } = await supabase.functions.invoke('manage-user', { body: input }); if (error) throw error; if (data?.error) throw new Error(data.error); return data }
