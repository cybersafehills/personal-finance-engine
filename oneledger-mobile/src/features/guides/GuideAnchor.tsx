import { useFocusEffect } from "expo-router";
import { cloneElement, isValidElement, useCallback, useContext, useEffect, useRef, type ReactNode } from "react";
import { View, type StyleProp, type ViewStyle, type ViewInstance } from "react-native";
import { GuideScrollContext, useGuides, type GuidesContextValue } from "./context";

type Props = { id: string; children: ReactNode; follow?: () => void; reveal?: () => void; style?: StyleProp<ViewStyle>; divider?: boolean; enabled?: boolean; persistent?: boolean };
export function GuideAnchor(props: Props) {
  const guides = useGuides();
  const children = props.divider !== undefined && isValidElement<{ divider?: boolean }>(props.children) ? cloneElement(props.children, { divider: props.divider }) : props.children;
  // Screens can also render without the guide host (isolated tests, auth).
  if (!guides || props.enabled === false) return <View style={props.style}>{children}</View>;
  return props.persistent ? <PersistentAnchor {...props} guides={guides}>{children}</PersistentAnchor> : <RegisteredAnchor {...props} guides={guides}>{children}</RegisteredAnchor>;
}
function RegisteredAnchor({ id, children, follow, reveal, style, guides }: Props & { guides: GuidesContextValue }) {
  const ref = useRef<ViewInstance>(null);
  const scroll = useContext(GuideScrollContext);
  const { register } = guides;
  useFocusEffect(useCallback(() => register(id, {
    measure: (callback) => ref.current?.measureInWindow(callback),
    reveal: () => { if (reveal) reveal(); else scroll?.(ref); },
    follow,
  }), [register, id, follow, reveal, scroll]));
  return <View ref={ref} collapsable={false} style={style}>{children}</View>;
}

/** Global navigation lives outside any focused screen but still has a live layout. */
function PersistentAnchor({ id, children, follow, style, guides }: Props & { guides: GuidesContextValue }) {
  const ref = useRef<ViewInstance>(null);
  const { register } = guides;
  useEffect(() => register(id, { measure: callback => ref.current?.measureInWindow(callback), follow }), [register, id, follow]);
  return <View ref={ref} collapsable={false} style={style}>{children}</View>;
}
