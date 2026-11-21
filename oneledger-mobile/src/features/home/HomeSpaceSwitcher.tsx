import Feather from "@expo/vector-icons/Feather";
import { useState } from "react";
import { Modal, Pressable, StyleSheet, View } from "react-native";
import { Text } from "@/components/ds";
import { useActiveSpace } from "@/features/spaces/ActiveSpaceProvider";
import { MenuGroup, MenuRow } from "@/features/settings/MenuUI";
import { makeStyles, useTheme } from "@/theme/ThemeProvider";

export function HomeSpaceSwitcher() {
  const { active,spaces,setActive }=useActiveSpace();
  const [open,setOpen]=useState(false);
  const {colors}=useTheme();
  const styles=useStyles();
  return <View style={styles.wrapper}>
    <Pressable accessibilityRole="button" accessibilityLabel={`Change Space, ${active?.name ?? "Workspace"}`} disabled={spaces.length===0} onPress={()=>setOpen(true)} style={styles.trigger}>
      <View style={styles.pill}><Text variant="caption" color="accent" numberOfLines={1} style={{flexShrink:1}}>{active?.name ?? "Workspace"}</Text><Feather name="chevron-down" size={12} color={colors.accent}/></View>
    </Pressable>
    <Modal transparent animationType="fade" visible={open} onRequestClose={()=>setOpen(false)}><View style={styles.scrim}><View style={styles.sheet} accessibilityViewIsModal>
      <MenuGroup title="Choose a Space">{spaces.map(s=><MenuRow key={s.id} label={s.name} selected={active?.id===s.id} role="radio" onPress={()=>{setActive(s.id);setOpen(false);}}/>)}</MenuGroup>
      <Pressable accessibilityRole="button" accessibilityLabel="Close Space picker" onPress={()=>setOpen(false)} style={styles.close}><Text color="accent">Close</Text></Pressable>
    </View></View></Modal>
  </View>;
}
const useStyles=makeStyles(c=>StyleSheet.create({
  wrapper:{height:44,justifyContent:"center",maxWidth:120,flexShrink:1},
  trigger:{height:44,justifyContent:"center",alignItems:"flex-start"},
  pill:{flexDirection:"row",alignItems:"center",gap:4,paddingHorizontal:8,paddingVertical:4,borderRadius:8,backgroundColor:c.accentBg,maxWidth:120},
  close:{minHeight:44,justifyContent:"center",alignItems:"center"},
  scrim:{flex:1,backgroundColor:"rgba(0,0,0,0.4)",justifyContent:"center",padding:24},
  sheet:{padding:20,borderRadius:20,backgroundColor:c.background,gap:12}
}));
