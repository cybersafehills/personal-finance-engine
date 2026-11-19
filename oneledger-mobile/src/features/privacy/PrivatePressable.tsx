import { Pressable, type PressableProps } from "react-native";
import { usePrivacy } from "./PrivacyProvider";
import { privateText } from "./mask";
export function PrivatePressable(props: PressableProps) {
  const { fullPrivacy } = usePrivacy();
  return <Pressable {...props} accessibilityLabel={privateText(props.accessibilityLabel, fullPrivacy)} />;
}
