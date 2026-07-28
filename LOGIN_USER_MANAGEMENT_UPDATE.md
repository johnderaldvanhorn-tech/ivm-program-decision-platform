# Login and User Management Update

Adds a protected login route, temporary browser-local authentication, user management under Settings > Users & Access, current-user display, sign out, and revision v0.9.4.

Default account:
- Email: johnderaldvanhorn@gmail.com
- Password: 123456
- Role: Administrator

Important: this is a temporary local authentication layer. Accounts are stored in browser localStorage with SHA-256 password hashes. Move authentication to Supabase Auth before external or production deployment.
