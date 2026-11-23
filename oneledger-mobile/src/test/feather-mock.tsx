import { View } from "react-native";

// Jest stand-in for the @expo/vector-icons sets we use (Feather, MaterialCommunityIcons). The real ones load
// expo-font -> expo-asset, which the unit-test environment does not provide.
// Renders an inert view tagged with the icon name (testID `icon-<name>`).
export default function Feather({ name }: { name: string }) {
  return <View testID={`icon-${name}`} />;
}
