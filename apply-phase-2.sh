#!/usr/bin/env bash
set -euo pipefail
TARGET="${1:-$HOME/Projects/ivm-program-decision-platform}"
SOURCE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP="$TARGET/.phase-2-backup-$STAMP"
[[ -f "$TARGET/package.json" ]] || { echo "package.json not found at $TARGET"; exit 1; }
mkdir -p "$BACKUP"
copy(){ rel="$1"; if [[ -e "$TARGET/$rel" ]]; then mkdir -p "$BACKUP/$(dirname "$rel")"; cp -R "$TARGET/$rel" "$BACKUP/$rel"; fi; mkdir -p "$TARGET/$(dirname "$rel")"; cp "$SOURCE/$rel" "$TARGET/$rel"; }
for rel in supabase/phase-2-enterprise-users-v1.1.0.sql supabase/functions/_shared/admin.ts supabase/functions/invite-user/index.ts supabase/functions/manage-user/index.ts src/types/users.ts src/services/userAdministration.ts src/pages/UsersAccess.tsx src/config/version.ts; do copy "$rel"; done
python3 - "$TARGET" <<'PY2'
from pathlib import Path
import re,sys
p=Path(sys.argv[1])/"src/App.tsx"
t=p.read_text()
imp="import UsersAccess from './pages/UsersAccess'"
if imp not in t:
 m=list(re.finditer(r'^import .+$',t,re.M)); i=m[-1].end() if m else 0; t=t[:i]+'
'+imp+t[i:]
if 'path="/settings/users"' not in t:
 m=re.search(r'<Routes(?:\s[^>]*)?>',t)
 if not m: raise SystemExit('Routes not found')
 t=t[:m.end()]+'
<Route path="/settings/users" element={<ProtectedRoute><UsersAccess /></ProtectedRoute>} />'+t[m.end():]
p.write_text(t)
PY2
echo "Installed. Backup: $BACKUP"
echo "Run SQL migration, set secrets, deploy invite-user and manage-user, then npm run build."
