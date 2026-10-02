/** Somente variáveis PÚBLICAS (EXPO_PUBLIC_*). Nunca coloque chaves administrativas ou de IA no app. */
export const env = {
  supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL ?? "",
  supabaseAnonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? "",
};
export const isConfigured = () => env.supabaseUrl.length > 0 && env.supabaseAnonKey.length > 0;
