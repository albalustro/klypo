import { Stack } from "expo-router";
import { t } from "../../i18n/pt-BR";
import { color } from "../../ui/theme";

export default function MainLayout() {
  return (
    <Stack screenOptions={{ headerStyle: { backgroundColor: color.bg }, headerShadowVisible: false, headerTintColor: color.text, contentStyle: { backgroundColor: color.bg }, headerBackTitle: t.common.back }}>
      <Stack.Screen name="index" options={{ title: t.library.title }} />
      <Stack.Screen name="inbox" options={{ title: t.inbox.title }} />
      <Stack.Screen name="add" options={{ title: t.add.title, presentation: "modal" }} />
      <Stack.Screen name="preview" options={{ title: t.preview.title }} />
      <Stack.Screen name="notice" options={{ title: t.notice.title, presentation: "modal" }} />
      <Stack.Screen name="page/[id]" options={{ title: "" }} />
      <Stack.Screen name="source/[id]" options={{ title: t.source.title }} />
      <Stack.Screen name="settings" options={{ title: t.settings.title }} />
    </Stack>
  );
}
