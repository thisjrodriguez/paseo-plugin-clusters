import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { useMemo, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { type Cluster, clusterIcon } from "./web";

type PluginTheme = PluginSurfaceProps["theme"];

const PALETTE = [
  "#ef4444", "#f97316", "#f59e0b", "#eab308", "#84cc16", "#22c55e", "#10b981", "#14b8a6",
  "#06b6d4", "#0ea5e9", "#3b82f6", "#6366f1", "#8b5cf6", "#a855f7", "#d946ef", "#ec4899",
  "#f43f5e", "#b91c1c", "#c2410c", "#a16207", "#15803d", "#0f766e", "#1d4ed8", "#6d28d9",
  "#be185d", "#78716c", "#57534e", "#475569", "#334155", "#1e293b", "#0f172a", "#000000",
];

const QUICK_ICONS = ["🚀", "⭐", "🔥", "💼", "🏠", "🧪", "🎮", "📚", "🛒", "🤖", "⚙️", "💡", "#", "@", "&", "λ"];

const HEX = /^#[0-9a-f]{6}$/i;

export interface ClusterDraft {
  name: string;
  icon: string;
  color: string;
}

interface Props {
  theme: PluginTheme;
  initial: Pick<Cluster, "name" | "color"> & { icon?: string };
  title: string;
  submitLabel: string;
  onSubmit(draft: ClusterDraft): void;
  onCancel(): void;
}

export function ClusterForm({ theme, initial, title, submitLabel, onSubmit, onCancel }: Props) {
  const [name, setName] = useState(initial.name);
  const [icon, setIcon] = useState(initial.icon ?? "");
  const [color, setColor] = useState(initial.color);
  const [hex, setHex] = useState(initial.color);

  const c = theme.colors;
  const styles = useMemo(
    () => ({
      label: { color: c.foregroundMuted, fontSize: 12, fontWeight: "600" as const },
      input: {
        color: c.foreground,
        borderWidth: 1,
        borderColor: c.border,
        borderRadius: 6,
        padding: 10,
        backgroundColor: c.surface1,
      },
      wrap: { flexDirection: "row" as const, flexWrap: "wrap" as const, gap: 6, alignItems: "center" as const },
      button: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: 6, backgroundColor: c.accent },
      buttonText: { color: c.accentForeground, fontSize: 13 },
      ghost: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: 6, borderWidth: 1, borderColor: c.border },
      text: { color: c.foreground, fontSize: 13 },
    }),
    [c],
  );

  const pickColor = (value: string) => {
    setColor(value);
    setHex(value);
  };
  const onHex = (value: string) => {
    const normalized = value.startsWith("#") ? value : `#${value}`;
    setHex(normalized);
    if (HEX.test(normalized)) setColor(normalized.toLowerCase());
  };

  const trimmedName = name.trim();
  const preview = clusterIcon({ name: trimmedName || "?", icon });
  const submit = () => {
    if (!trimmedName) return;
    onSubmit({ name: trimmedName, icon: icon.trim(), color });
  };

  return (
    <View style={{ gap: 14 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
        <View
          style={{
            width: 56,
            height: 56,
            borderRadius: 28,
            backgroundColor: color,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Text style={{ color: "#ffffff", fontSize: 24, fontWeight: "700" }}>{preview}</Text>
        </View>
        <Text style={{ color: c.foreground, fontSize: 20, fontWeight: "600" }}>{title}</Text>
      </View>

      <View style={{ gap: 6 }}>
        <Text style={styles.label}>NOMBRE</Text>
        <TextInput
          style={styles.input}
          placeholder="Ej. Nicalia"
          placeholderTextColor={c.foregroundMuted}
          value={name}
          onChangeText={setName}
          onSubmitEditing={submit}
          autoFocus
        />
      </View>

      <View style={{ gap: 6 }}>
        <Text style={styles.label}>ICONO · letra, emoji o símbolo (vacío = inicial del nombre)</Text>
        <TextInput
          style={[styles.input, { width: 120, fontSize: 18, textAlign: "center" }]}
          placeholder={preview}
          placeholderTextColor={c.foregroundMuted}
          value={icon}
          onChangeText={(value) => setIcon(Array.from(value).slice(0, 2).join(""))}
        />
        <View style={styles.wrap}>
          {QUICK_ICONS.map((value) => (
            <Pressable
              key={value}
              accessibilityRole="button"
              accessibilityLabel={`Icono ${value}`}
              onPress={() => setIcon(value)}
              style={{
                width: 32,
                height: 32,
                borderRadius: 6,
                alignItems: "center",
                justifyContent: "center",
                borderWidth: 1,
                borderColor: icon === value ? c.foreground : c.border,
                backgroundColor: c.surface1,
              }}
            >
              <Text style={{ color: c.foreground, fontSize: 15 }}>{value}</Text>
            </Pressable>
          ))}
        </View>
      </View>

      <View style={{ gap: 6 }}>
        <Text style={styles.label}>FONDO</Text>
        <View style={styles.wrap}>
          {PALETTE.map((value) => (
            <Pressable
              key={value}
              accessibilityRole="button"
              accessibilityLabel={`Color ${value}`}
              onPress={() => pickColor(value)}
              style={{
                width: 26,
                height: 26,
                borderRadius: 5,
                backgroundColor: value,
                borderWidth: 2,
                borderColor: value === color ? c.foreground : "transparent",
              }}
            />
          ))}
        </View>
        <View style={styles.wrap}>
          <TextInput
            style={[styles.input, { width: 120, fontFamily: "monospace" }]}
            placeholder="#RRGGBB"
            placeholderTextColor={c.foregroundMuted}
            value={hex}
            onChangeText={onHex}
            maxLength={7}
            autoCapitalize="none"
          />
          <Text style={{ color: HEX.test(hex) ? c.foregroundMuted : c.statusDanger, fontSize: 12 }}>
            {HEX.test(hex) ? "Cualquier color en hex" : "Formato: #RRGGBB"}
          </Text>
        </View>
      </View>

      <View style={styles.wrap}>
        <Pressable
          accessibilityRole="button"
          disabled={!trimmedName}
          style={[styles.button, { opacity: trimmedName ? 1 : 0.5 }]}
          onPress={submit}
        >
          <Text style={styles.buttonText}>{submitLabel}</Text>
        </Pressable>
        <Pressable accessibilityRole="button" style={styles.ghost} onPress={onCancel}>
          <Text style={styles.text}>Cancelar</Text>
        </Pressable>
      </View>
    </View>
  );
}
