import { View } from "react-native";

// Jest stand-in for @expo/vector-icons/Feather. The real one loads
// expo-font -> expo-asset, which the unit-test environment does not provide.
// Renders an inert view tagged with the icon name (testID `icon-<name>`).
export default function Feather({ name }: { name: string }) {
  return <View testID={`icon-${name}`} />;
}
