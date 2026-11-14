import { StyleSheet, Text, View } from "react-native";

// Placeholder home. Replaced by the real tab shell in PR 5.
export default function Index() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>OneLedger</Text>
      <Text style={styles.subtitle}>Mobile app scaffold</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#f6f6f7",
  },
  title: { fontSize: 28, fontWeight: "700", color: "#07143a" },
  subtitle: { marginTop: 8, fontSize: 16, color: "#52525b" },
});
