// Configuración pública del navegador. El anon/publishable key está diseñado para ser público.
// Nunca coloques aquí SUPABASE_SERVICE_ROLE_KEY, ADMIN_PASSWORD, SESSION_SECRET ni GEMINI_API_KEY.
export const SUPABASE_URL = 'https://ipgnbbtixfyznzcqpqet.supabase.co';
export const SUPABASE_ANON_KEY = sb_publishable_wLNqErUHQFADahq16oXtcA_-Ppqccoq';
export const FUNCTIONS_URL = `${SUPABASE_URL.replace(/\/$/, '')}/functions/v1`;

export function isSupabaseConfigured() {
  return /^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(SUPABASE_URL) &&
    SUPABASE_ANON_KEY.length > 20 &&
    !SUPABASE_ANON_KEY.includes('sb_publishable_wLNqErUHQFADahq16oXtcA_-Ppqccoq');
}
