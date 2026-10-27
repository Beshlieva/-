import type { ReactNode } from 'react';

export function BrandMark() {
  return (
    <svg className="brand__mark" viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <rect width="32" height="32" rx="9" fill="#0b1f3a" />
      <circle cx="16" cy="16" r="9" fill="none" stroke="#14b8a6" strokeWidth="1.8" />
      <path d="M16 7.5v4M16 20.5v4M7.5 16h4M20.5 16h4" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M19.8 12.2l-2.3 5.3-5.3 2.3 2.3-5.3 5.3-2.3z" fill="#14b8a6" />
    </svg>
  );
}

interface AppHeaderProps {
  sticky?: boolean;
  right?: ReactNode;
}

export default function AppHeader({ sticky, right }: AppHeaderProps) {
  return (
    <header className={`topbar${sticky ? ' topbar--sticky' : ''}`}>
      <div className="topbar__inner">
        <span className="brand">
          <BrandMark />
          Карта интересов
        </span>
        {right}
      </div>
    </header>
  );
}

export function AppFooter() {
  return (
    <footer className="footer">
      <div className="footer__inner">
        <span>Методика А.Е. Голомштока, адаптированная версия</span>
        <span>174 утверждения · 29 направлений</span>
      </div>
    </footer>
  );
}
