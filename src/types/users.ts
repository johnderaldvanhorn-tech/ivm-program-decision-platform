export type UserRole = 'Super Administrator' | 'Administrator' | 'Operations Manager' | 'Analyst' | 'Viewer'
export type UserStatus = 'pending_invitation' | 'active' | 'locked' | 'disabled' | 'password_reset_required'
export type ManagedUser = { id:string; email:string|null; first_name:string|null; last_name:string|null; role:UserRole; department:string|null; status:UserStatus; last_login_at:string|null; created_at:string }
