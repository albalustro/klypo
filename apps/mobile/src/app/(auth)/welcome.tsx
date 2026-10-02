import { useRouter } from "expo-router";
import { View } from "react-native";
import { t } from "../../i18n/pt-BR";
import { Button, Card, H1, P, Screen } from "../../ui/components";

export default function Welcome() {
  const router = useRouter();
  return (
    <Screen>
      <View style={{ flex: 1, justifyContent: "center", gap: 16 }}>
        <H1>{t.welcome.title}</H1>
        <P muted>{t.welcome.body}</P>
        <Card><P muted>{t.welcome.exampleBefore}</P></Card>
        <Card><P>{t.welcome.exampleAfter}</P></Card>
      </View>
      <Button label={t.welcome.create} onPress={() => router.push("/sign-up")} />
      <Button label={t.welcome.signIn} variant="secondary" onPress={() => router.push("/sign-in")} />
    </Screen>
  );
}
