import { useTheme } from "@/theme/ThemeProvider";
import { useId } from "react";
import Svg, { Circle, Defs, Ellipse, G, LinearGradient, Path, Rect, Stop } from "react-native-svg";
import type { PartnerCategory } from "./model";

/** Original, local vector objects: no remote creative requests on app startup. */
export function PartnerArtwork({ category, size = 120 }: { category: PartnerCategory; size?: number }) {
  const { colors } = useTheme();
  const id = `art-${useId().replace(/:/g, "")}`;
  return <Svg width={size} height={size} viewBox="0 0 160 160" accessible={false} pointerEvents="none">
    <Defs>
      <LinearGradient id={`${id}-face`} x1="0" y1="0" x2="1" y2="1"><Stop stopColor={colors.onSolid}/><Stop offset="0.5" stopColor={colors.creativePearl}/><Stop offset="1" stopColor={colors.creativeLilac}/></LinearGradient>
      <LinearGradient id={`${id}-edge`} x1="0" y1="0" x2="1" y2="1"><Stop stopColor={colors.creativeEdgeLight}/><Stop offset="1" stopColor={colors.creativeEdgeDark}/></LinearGradient>
      <LinearGradient id={`${id}-gold`} x1="0" y1="0" x2="1" y2="1"><Stop stopColor={colors.creativeGoldLight}/><Stop offset="0.5" stopColor={colors.creativeGold}/><Stop offset="1" stopColor={colors.creativeGoldDark}/></LinearGradient>
    </Defs>
    <Ellipse cx={83} cy={139} rx={54} ry={10} fill={colors.creativeShadow} opacity={0.16}/>
    {category === "Connectivity" ? <G rotation={-13} origin="80,80">
      <Rect x={47} y={24} width={75} height={113} rx={18} fill={`url(#${id}-edge)`}/>
      <Rect x={38} y={17} width={75} height={113} rx={18} fill={`url(#${id}-face)`}/>
      <Rect x={45} y={24} width={61} height={98} rx={12} fill={colors.creativeScreen}/>
      <Path d="M66 31H85" stroke={colors.creativeSpeaker} strokeWidth={4} strokeLinecap="round"/>
      <Path d="M54 65Q76 44 98 65M62 75Q76 61 90 75M70 85Q76 79 82 85" stroke={colors.creativeSignal} strokeWidth={5} strokeLinecap="round" fill="none"/>
      <Circle cx={76} cy={95} r={4} fill={colors.onSolid}/>
      <Path d="M69 113H83" stroke={colors.creativeHandle} strokeWidth={3} strokeLinecap="round"/>
    </G> : category === "Learning" ? <G rotation={-12} origin="80,80">
      <Path d="M33 52 91 27 131 53V124L72 146 33 120Z" fill={`url(#${id}-edge)`}/>
      <Path d="M35 48 92 26 128 48 70 72Z" fill={colors.creativePaper}/>
      <Path d="M36 55 71 76V138L36 117Z" fill={colors.creativeSpine}/>
      <Path d="M71 76 128 53V119L71 141Z" fill={`url(#${id}-face)`}/>
      <Path d="M84 87 115 75M84 99 115 87M84 111 103 104" stroke={colors.creativePrint} strokeWidth={4} strokeLinecap="round"/>
      <Path d="M101 36V62L110 54 118 56V43" fill={`url(#${id}-gold)`}/>
    </G> : <G>
      {[108, 88, 68].map(y => <G key={y}><Path d={`M33 ${y}V${y+14}C33 ${y+31} 112 ${y+31} 112 ${y+14}V${y}`} fill={colors.creativeCoinEdge}/><Ellipse cx={72.5} cy={y} rx={39.5} ry={16} fill={`url(#${id}-gold)`}/><Ellipse cx={72.5} cy={y} rx={30} ry={10} fill="none" stroke={colors.creativeCoinRim} strokeOpacity={0.65} strokeWidth={2}/></G>)}
      <G rotation={16} origin="113,91"><Rect x={88} y={49} width={52} height={70} rx={12} fill={`url(#${id}-edge)`}/><Rect x={82} y={43} width={52} height={70} rx={12} fill={`url(#${id}-face)`}/><Path d="M94 63H123M98 71H119M95 93H121M99 70V90M108 70V90M117 70V90" stroke={colors.creativeBankInk} strokeWidth={3} strokeLinecap="round"/></G>
    </G>}
    <Path d="M133 18 136 29 146 33 136 37 133 48 130 37 120 33 130 29Z" fill={`url(#${id}-gold)`}/>
    <Circle cx={23} cy={95} r={4} fill={colors.onSolid} opacity={0.65}/>
  </Svg>;
}
