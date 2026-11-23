import {
  Activity, AlertTriangle, ArrowRight, BarChart3, Building2, Check, CheckCheck, ChevronDown,
  ChevronLeft, ChevronRight, CreditCard, Flag, Gavel, HeartPulse, Info, Key, LayoutDashboard,
  LifeBuoy, LineChart, Mail, Menu, Moon, Plug, Receipt, Repeat, ScrollText, Search,
  ShieldCheck, Siren, SlidersHorizontal, Sun, UserPlus, Users, X, type LucideIcon,
} from "lucide-react";

const MAP: Record<string, LucideIcon> = {
  layout: LayoutDashboard, activity: Activity, chart: BarChart3, users: Users, userplus: UserPlus,
  building: Building2, lifebuoy: LifeBuoy, repeat: Repeat, card: CreditCard, trend: LineChart,
  receipt: Receipt, shield: ShieldCheck, key: Key, scroll: ScrollText, siren: Siren,
  heart: HeartPulse, plug: Plug, mail: Mail, flag: Flag, sliders: SlidersHorizontal,
  check: CheckCheck, gavel: Gavel, search: Search, menu: Menu, close: X, sun: Sun, moon: Moon,
  alert: AlertTriangle, info: Info, ok: Check, right: ArrowRight, down: ChevronDown,
  prev: ChevronLeft, next: ChevronRight,
};

export function Icon({
  name,
  size = 16,
  className = "",
}: {
  name: string;
  size?: number;
  className?: string;
}) {
  const C = MAP[name] ?? Info;
  return <C aria-hidden size={size} strokeWidth={1.75} className={className} />;
}
