import { Stack } from "expo-router";
import { color } from "../../ui/theme";
import { t } from "../../i18n/pt-BR";

export default function AuthLayout() {
  return (
    <Stack screenOptions={{ headerStyle: { backgroundColor: color.bg }, headerShadowVisible: false, headerTintColor: color.text, contentStyle: { backgroundColor: color.bg }, headerBackTitle: t.common.back }}>
      <Stack.Screen name="welcome" options={{ headerShown: false }} />
      <Stack.Screen name="sign-in" options={{ title: t.auth.signInTitle }} />
      <Stack.Screen name="sign-up" options={{ title: t.auth.signUpTitle }} />
      <Stack.Screen name="recover" options={{ title: t.auth.recoverTitle }} />
    </Stack>
  );
}
