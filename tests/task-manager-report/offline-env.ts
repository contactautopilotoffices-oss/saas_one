// Import this FIRST in a test that loads the task-manager services: they read these on load.
// Offline: nothing in such a test reaches Supabase or Zoho.
process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:1';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'fake-key-offline-test';
process.env.MAIL_TOKEN_KEY = 'fake-key-offline-test';
process.env.ZOHO_TASKS_CLIENT_ID = 'fake-client';
process.env.ZOHO_TASKS_CLIENT_SECRET = 'fake-secret';
