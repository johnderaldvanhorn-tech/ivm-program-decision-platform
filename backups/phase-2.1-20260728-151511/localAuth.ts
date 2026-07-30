export type LocalUser = {
  id: string
  email: string
  displayName: string
  role: 'Administrator' | 'Program Manager' | 'Analyst' | 'Viewer'
  passwordHash: string
  active: boolean
  createdAt: string
  updatedAt: string
}

export type PublicUser = Omit<LocalUser, 'passwordHash'>

const USERS_KEY = 'ivm-local-users-v1'
const SESSION_KEY = 'ivm-local-session-v1'

const DEFAULT_USER: LocalUser = {
  id: 'default-john-vanhorn',
  email: 'johnderaldvanhorn@gmail.com',
  displayName: 'John Van Horn',
  role: 'Administrator',
  passwordHash: '8d969eef6ecad3c29a3a629280e686cf0c3f5d5a86aff3ca12020c923adc6c92',
  active: true,
  createdAt: '2026-07-27T00:00:00.000Z',
  updatedAt: '2026-07-27T00:00:00.000Z',
}

function normalizeEmail(email: string) { return email.trim().toLowerCase() }

export async function hashPassword(password: string) {
  const bytes = new TextEncoder().encode(password)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest)).map((value) => value.toString(16).padStart(2, '0')).join('')
}

export function ensureDefaultUser() {
  const users = readUsersRaw()
  if (!users.some((user) => normalizeEmail(user.email) === normalizeEmail(DEFAULT_USER.email))) {
    writeUsersRaw([...users, DEFAULT_USER])
  }
}

function readUsersRaw(): LocalUser[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(USERS_KEY) || '[]')
    return Array.isArray(parsed) ? parsed : []
  } catch { return [] }
}

function writeUsersRaw(users: LocalUser[]) { localStorage.setItem(USERS_KEY, JSON.stringify(users)) }
function toPublic(user: LocalUser): PublicUser { const { passwordHash: _passwordHash, ...publicUser } = user; return publicUser }

export function listUsers(): PublicUser[] {
  ensureDefaultUser()
  return readUsersRaw().map(toPublic).sort((a, b) => a.displayName.localeCompare(b.displayName))
}

export function getSessionUser(): PublicUser | null {
  ensureDefaultUser()
  const userId = localStorage.getItem(SESSION_KEY)
  if (!userId) return null
  const user = readUsersRaw().find((item) => item.id === userId && item.active)
  return user ? toPublic(user) : null
}

export async function signIn(email: string, password: string): Promise<PublicUser> {
  ensureDefaultUser()
  const passwordHash = await hashPassword(password)
  const user = readUsersRaw().find((item) => normalizeEmail(item.email) === normalizeEmail(email))
  if (!user || !user.active || user.passwordHash !== passwordHash) throw new Error('The email or password is incorrect.')
  localStorage.setItem(SESSION_KEY, user.id)
  return toPublic(user)
}

export function signOut() { localStorage.removeItem(SESSION_KEY) }

export async function createUser(input: { email: string; displayName: string; role: LocalUser['role']; password: string }) {
  const users = readUsersRaw()
  const email = normalizeEmail(input.email)
  if (!email || !input.displayName.trim()) throw new Error('Name and email are required.')
  if (input.password.length < 6) throw new Error('Password must contain at least 6 characters.')
  if (users.some((user) => normalizeEmail(user.email) === email)) throw new Error('A user with this email already exists.')
  const now = new Date().toISOString()
  const user: LocalUser = {
    id: crypto.randomUUID(), email, displayName: input.displayName.trim(), role: input.role,
    passwordHash: await hashPassword(input.password), active: true, createdAt: now, updatedAt: now,
  }
  writeUsersRaw([...users, user])
  return toPublic(user)
}

export async function updateUser(id: string, input: Partial<Pick<LocalUser, 'email' | 'displayName' | 'role' | 'active'>> & { password?: string }) {
  const users = readUsersRaw()
  const index = users.findIndex((user) => user.id === id)
  if (index < 0) throw new Error('User not found.')
  const nextEmail = normalizeEmail(input.email ?? users[index].email)
  if (users.some((user, userIndex) => userIndex !== index && normalizeEmail(user.email) === nextEmail)) throw new Error('A user with this email already exists.')
  const passwordHash = input.password ? await hashPassword(input.password) : users[index].passwordHash
  if (input.password && input.password.length < 6) throw new Error('Password must contain at least 6 characters.')
  users[index] = { ...users[index], ...input, email: nextEmail, displayName: (input.displayName ?? users[index].displayName).trim(), passwordHash, updatedAt: new Date().toISOString() }
  delete (users[index] as LocalUser & { password?: string }).password
  writeUsersRaw(users)
  return toPublic(users[index])
}

export function deleteUser(id: string) {
  const currentUser = getSessionUser()
  if (currentUser?.id === id) throw new Error('You cannot delete the account currently signed in.')
  writeUsersRaw(readUsersRaw().filter((user) => user.id !== id))
}
