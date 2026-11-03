import type { CSSProperties, SVGProps } from 'react';
import * as LucideIcons from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

const ICONS: Record<string, LucideIcon> = {
  Atom: LucideIcons.Atom,
  Sigma: LucideIcons.Sigma,
  FlaskConical: LucideIcons.FlaskConical,
  Leaf: LucideIcons.Leaf,
  HeartPulse: LucideIcons.HeartPulse,
  Sprout: LucideIcons.Sprout,
  Trees: LucideIcons.Trees,
  Globe2: LucideIcons.Globe2,
  Wrench: LucideIcons.Wrench,
  Cpu: LucideIcons.Cpu,
  MonitorSmartphone: LucideIcons.MonitorSmartphone,
  Building2: LucideIcons.Building2,
  Plane: LucideIcons.Plane,
  Hammer: LucideIcons.Hammer,
  Scissors: LucideIcons.Scissors,
  ChefHat: LucideIcons.ChefHat,
  ScrollText: LucideIcons.ScrollText,
  BookOpenText: LucideIcons.BookOpenText,
  Brain: LucideIcons.Brain,
  Scale: LucideIcons.Scale,
  BarChart3: LucideIcons.BarChart3,
  Languages: LucideIcons.Languages,
  Newspaper: LucideIcons.Newspaper,
  Palette: LucideIcons.Palette,
  Music4: LucideIcons.Music4,
  Dumbbell: LucideIcons.Dumbbell,
  Users: LucideIcons.Users,
  Shield: LucideIcons.Shield,
};

interface CategoryIconProps extends SVGProps<SVGSVGElement> {
  name: string;
  size?: number;
  color?: string;
}

export default function CategoryIcon({ name, size = 16, color, style, ...props }: CategoryIconProps) {
  const Icon = ICONS[name] ?? LucideIcons.Compass;
  const iconStyle: CSSProperties = {
    color,
    ...style,
  };

  return <Icon size={size} color={color} style={iconStyle} {...props} aria-hidden="true" />;
}
