import type { ReactNode } from 'react';

interface IconProps { size?: number }

function Svg({ size = 20, children }: IconProps & { children: ReactNode }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {children}
    </svg>
  );
}

export const IconClock = (p: IconProps) => <Svg {...p}><circle cx="12" cy="13" r="8" /><path d="M12 9v4l2.5 2M9.5 3h5" /></Svg>;
export const IconSkip = (p: IconProps) => <Svg {...p}><path d="M5 5l9 7-9 7V5zM19 5v14" /></Svg>;
export const IconRepeat = (p: IconProps) => <Svg {...p}><path d="M17 2l3 3-3 3M3 11V9a4 4 0 014-4h13M7 22l-3-3 3-3M21 13v2a4 4 0 01-4 4H4" /></Svg>;
export const IconCheck = (p: IconProps) => <Svg {...p}><path d="M5 12.5l4.5 4.5L19 7.5" /></Svg>;
export const IconLock = (p: IconProps) => <Svg {...p}><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 018 0v3" /></Svg>;
export const IconKeyboard = (p: IconProps) => <Svg {...p}><rect x="3" y="6" width="18" height="12" rx="2" /><path d="M7 10h.01M11 10h.01M15 10h.01M7 14h10" /></Svg>;
export const IconTarget = (p: IconProps) => <Svg {...p}><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="4.5" /><circle cx="12" cy="12" r=".8" /></Svg>;
export const IconRose = (p: IconProps) => <Svg {...p}><path d="M12 3v6M12 15v6M3 12h6M15 12h6M5.6 5.6l4.2 4.2M14.2 14.2l4.2 4.2M18.4 5.6l-4.2 4.2M9.8 14.2l-4.2 4.2" /></Svg>;
export const IconList = (p: IconProps) => <Svg {...p}><path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01" /></Svg>;
export const IconAlert = (p: IconProps) => <Svg {...p}><path d="M12 3l10 18H2L12 3zM12 10v5M12 18h.01" /></Svg>;
export const IconInfo = (p: IconProps) => <Svg {...p}><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></Svg>;
export const IconArrowLeft = (p: IconProps) => <Svg {...p}><path d="M15 5l-7 7 7 7" /></Svg>;
export const IconArrowRight = (p: IconProps) => <Svg {...p}><path d="M5 12h14M13 6l6 6-6 6" /></Svg>;
