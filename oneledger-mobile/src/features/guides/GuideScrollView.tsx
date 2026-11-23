import { useCallback, useRef, type ComponentProps, type RefObject } from "react";
import { ScrollView, type ViewInstance, type ScrollViewInstance } from "react-native";
import { GuideScrollContext } from "./context";

/** Reveal a live anchor inside the nearest scrolling screen without guessed offsets. */
export function GuideScrollView({ children, onScroll, ...props }: ComponentProps<typeof ScrollView>) {
  const ref = useRef<ScrollViewInstance>(null);
  const offset = useRef(0);
  const reveal = useCallback((target: RefObject<ViewInstance | null>) => {
    const scroll = ref.current;
    if (!scroll || !target.current) return;
    scroll.measureInWindow((_sx, sy) => target.current?.measureInWindow((_x, y) => {
      scroll.scrollTo({ y: Math.max(0, offset.current + y - sy - 16), animated: false });
    }));
  }, []);
  return <GuideScrollContext.Provider value={reveal}><ScrollView {...props} ref={ref} onScroll={event => { offset.current = event.nativeEvent.contentOffset.y; onScroll?.(event); }} scrollEventThrottle={props.scrollEventThrottle ?? 32}>{children}</ScrollView></GuideScrollContext.Provider>;
}
