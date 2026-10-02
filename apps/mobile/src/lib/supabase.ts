import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient } from "@supabase/supabase-js";
import { AppState } from "react-native";
import { env, isConfigured } from "./env";

export const supabase = createClient<any>(
  isConfigured() ? env.supabaseUrl : "http://localhost:54321",
  isConfigured() ? env.supabaseAnonKey : "unconfigured",
  {
    auth: { storage: AsyncStorage, autoRefreshToken: true, persistSession: true, detectSessionInUrl: false, flowType: "pkce" },
  },
);

// Recomendação para React Native: só renovar o token com o app em primeiro plano.
AppState.addEventListener("change", (s) => {
  if (s === "active") supabase.auth.startAutoRefresh();
  else supabase.auth.stopAutoRefresh();
});
