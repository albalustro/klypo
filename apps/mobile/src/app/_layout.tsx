import Constants, { ExecutionEnvironment } from "expo-constants";
import { Stack, useRouter } from "expo-router";
import { ShareIntentProvider, useShareIntentContext } from "expo-share-intent";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { DraftProvider, useDrafts } from "../lib/drafts";
import { AuthProvider, useAuth } from "../lib/auth";
import { isConfigured } from "../lib/env";
import { QueueProvider } from "../queue/provider";
import { t } from "../i18n/pt-BR";
import { Center, H2, P, Spinner } from "../ui/components";

// Expo Go não contém o módulo nativo de compartilhamento (precisa de development build).
const inExpoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;

/** Recebe o que outros apps compartilham e leva à prévia. O intent só é "consumido" depois de entrar na sessão. */
function ShareHandler() {
  const { session } = useAuth();
  const { hasShareIntent, shareIntent, resetShareIntent } = useShareIntentContext();
  const drafts = useDrafts();
  const router = useRouter();
  useEffect(() => {
    if (!hasShareIntent || !session) return;
    (async () => {
      await drafts.addShared((shareIntent.files ?? []).map((f) => ({ path: f.path, mimeType: f.mimeType })), shareIntent.text);
      resetShareIntent();
      router.push("/preview");
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasShareIntent, session]);
  return null;
}

function Gate() {
  const { session, ready } = useAuth();
  if (!isConfigured()) return <Center><H2>{t.config.missingTitle}</H2><P muted>{t.config.missingBody}</P></Center>;
  if (!ready) return <Center><Spinner /></Center>;
  return (
    <>
      <ShareHandler />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="reset-password" />
        <Stack.Protected guard={!session}><Stack.Screen name="(auth)" /></Stack.Protected>
        <Stack.Protected guard={!!session}><Stack.Screen name="(main)" /></Stack.Protected>
      </Stack>
    </>
  );
}

export default function RootLayout() {
  return (
    <ShareIntentProvider options={{ disabled: inExpoGo }}>
      <AuthProvider>
        <DraftProvider>
          <QueueProvider>
            <StatusBar style="dark" />
            <Gate />
          </QueueProvider>
        </DraftProvider>
      </AuthProvider>
    </ShareIntentProvider>
  );
}
