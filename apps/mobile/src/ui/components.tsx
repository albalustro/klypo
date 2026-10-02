import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View, type TextInputProps, type ViewStyle } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import type { ReactNode } from "react";
import { color, minTouch, radius, space } from "./theme";

export function Screen({ children, scroll = true, padded = true }: { children: ReactNode; scroll?: boolean; padded?: boolean }) {
  const body = <View style={{ padding: padded ? space.lg : 0, gap: space.md, flexGrow: 1 }}>{children}</View>;
  return (
    <SafeAreaView style={styles.screen} edges={["bottom", "left", "right"]}>
      {scroll ? <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ flexGrow: 1 }}>{body}</ScrollView> : body}
    </SafeAreaView>
  );
}

export function H1({ children }: { children: ReactNode }) { return <Text accessibilityRole="header" style={styles.h1}>{children}</Text>; }
export function H2({ children }: { children: ReactNode }) { return <Text accessibilityRole="header" style={styles.h2}>{children}</Text>; }
export function P({ children, muted, style, numberOfLines }: { children: ReactNode; muted?: boolean; style?: object; numberOfLines?: number }) { return <Text numberOfLines={numberOfLines} style={[styles.p, muted && { color: color.muted }, style]}>{children}</Text>; }

export function Button({ label, onPress, variant = "primary", disabled, busy, accessibilityHint }: {
  label: string; onPress: () => void; variant?: "primary" | "secondary" | "danger" | "ghost"; disabled?: boolean; busy?: boolean; accessibilityHint?: string;
}) {
  const v = variantStyles[variant];
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityHint={accessibilityHint} accessibilityState={{ disabled: !!disabled || !!busy, busy }}
      disabled={disabled || busy} onPress={onPress} style={({ pressed }) => [styles.button, v.box, (disabled || busy) && { opacity: 0.5 }, pressed && { opacity: 0.8 }]}>
      {busy ? <ActivityIndicator color={v.text.color} /> : <Text style={[styles.buttonText, v.text]}>{label}</Text>}
    </Pressable>
  );
}

export function Field({ label, error, ...props }: TextInputProps & { label: string; error?: string }) {
  return (
    <View style={{ gap: space.xs }}>
      <Text style={styles.label}>{label}</Text>
      <TextInput accessibilityLabel={label} placeholderTextColor={color.muted} {...props} style={[styles.input, props.multiline && { minHeight: 96, textAlignVertical: "top" }, props.style]} />
      {error ? <Text accessibilityLiveRegion="polite" style={{ color: color.danger }}>{error}</Text> : null}
    </View>
  );
}

export function Card({ children, onPress, accessibilityLabel }: { children: ReactNode; onPress?: () => void; accessibilityLabel?: string }) {
  const inner = <View style={styles.card}>{children}</View>;
  return onPress ? <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel} onPress={onPress} style={({ pressed }) => pressed && { opacity: 0.85 }}>{inner}</Pressable> : inner;
}

export function Banner({ tone = "info", children }: { tone?: "info" | "warn" | "danger" | "ok"; children: ReactNode }) {
  const m = { info: [color.accentSoft, color.text], warn: [color.warnSoft, color.warn], danger: [color.dangerSoft, color.danger], ok: [color.okSoft, color.ok] }[tone];
  return <View accessibilityRole="alert" style={{ backgroundColor: m[0], borderRadius: radius.md, padding: space.md }}><Text style={{ color: m[1] }}>{children}</Text></View>;
}

export function Chip({ label, tone = "neutral" }: { label: string; tone?: "neutral" | "accent" | "warn" | "ok" | "danger" }) {
  const m = { neutral: [color.border, color.muted], accent: [color.accentSoft, color.accent], warn: [color.warnSoft, color.warn], ok: [color.okSoft, color.ok], danger: [color.dangerSoft, color.danger] }[tone];
  return <View style={{ alignSelf: "flex-start", backgroundColor: m[0], borderRadius: 999, paddingHorizontal: space.md, paddingVertical: 4 }}><Text style={{ color: m[1], fontSize: 12, fontWeight: "600" }}>{label}</Text></View>;
}

export function Center({ children }: { children: ReactNode }) { return <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: space.xl, gap: space.md }}>{children}</View>; }
export const Spinner = () => <ActivityIndicator accessibilityLabel="Carregando" color={color.accent} />;
export function Row({ children, style }: { children: ReactNode; style?: ViewStyle }) { return <View style={[{ flexDirection: "row", alignItems: "center", gap: space.md }, style]}>{children}</View>; }

const variantStyles = {
  primary: { box: { backgroundColor: color.accent }, text: { color: color.accentText } },
  secondary: { box: { backgroundColor: color.surface, borderWidth: 1, borderColor: color.border }, text: { color: color.text } },
  danger: { box: { backgroundColor: color.dangerSoft }, text: { color: color.danger } },
  ghost: { box: { backgroundColor: "transparent" }, text: { color: color.accent } },
} as const;

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.bg },
  h1: { fontSize: 28, fontWeight: "700", color: color.text },
  h2: { fontSize: 20, fontWeight: "600", color: color.text },
  p: { fontSize: 16, lineHeight: 24, color: color.text },
  button: { minHeight: minTouch, borderRadius: radius.md, paddingHorizontal: space.lg, alignItems: "center", justifyContent: "center" },
  buttonText: { fontSize: 16, fontWeight: "600" },
  label: { fontSize: 14, fontWeight: "600", color: color.text },
  input: { minHeight: minTouch, borderWidth: 1, borderColor: color.border, borderRadius: radius.md, backgroundColor: color.surface, paddingHorizontal: space.md, paddingVertical: space.sm, fontSize: 16, color: color.text },
  card: { backgroundColor: color.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: color.border, padding: space.lg, gap: space.sm },
});
