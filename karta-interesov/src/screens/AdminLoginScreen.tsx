import { useRef, useState } from 'react';
import type { FormEvent } from 'react';
import AppHeader, { AppFooter } from '../components/AppHeader';
import { IconAlert } from '../components/icons';
import { ApiError } from '../types';
import type { AdminSession } from '../types';
import { adminService, describeError } from '../services/api';

interface Props {
  onLogin: (session: AdminSession) => void;
  /** Например, «Сессия истекла». */
  notice: string | null;
}

/** Вход администратора. Логин и пароль проверяет только сервер. */
export default function AdminLoginScreen({ onLogin, notice }: Props) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (submitting.current) return;
    if (!username.trim() || !password) {
      setError('Введите логин и пароль.');
      return;
    }
    submitting.current = true;
    setBusy(true);
    setError(null);
    try {
      const session = await adminService.login(username.trim(), password);
      onLogin(session);
    } catch (err) {
      // Для неверных данных и блокировки сервер присылает готовое сообщение
      if (err instanceof ApiError && (err.status === 401 || err.status === 429)) setError(err.message);
      else setError(describeError(err));
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  const alert = error ?? notice;

  return (
    <div className="shell">
      <AppHeader />
      <main className="page">
        <div className="container container--narrow">
          <h1 className="h2">Вход для администратора</h1>
          <p className="lead" style={{ marginTop: 12, marginBottom: 24 }}>
            Панель доступна только создателю теста. Учётная запись студента здесь не подходит.
          </p>
          {!adminService.enabled && (
            <div className="form-alert form-alert--info" role="alert" style={{ marginBottom: 16 }}>
              <IconAlert size={18} />
              <span>Панель работает только с подключённым сервером (VITE_API_MODE=api).</span>
            </div>
          )}
          <form className="card form" onSubmit={handleSubmit} noValidate>
            {alert && (
              <div className="form-alert" role="alert">
                <IconAlert size={18} />
                <span>{alert}</span>
              </div>
            )}
            <div className="field">
              <label className="field__label" htmlFor="adm-username">Логин</label>
              <input id="adm-username" className="input" autoComplete="username" value={username}
                onChange={e => { setUsername(e.target.value); setError(null); }} disabled={busy} maxLength={64} />
            </div>
            <div className="field">
              <label className="field__label" htmlFor="adm-password">Пароль</label>
              <input id="adm-password" className="input" type="password" autoComplete="current-password" value={password}
                onChange={e => { setPassword(e.target.value); setError(null); }} disabled={busy} maxLength={1024} />
            </div>
            <button type="submit" className="btn btn--primary btn--block" disabled={busy || !adminService.enabled}>
              {busy ? 'Входим…' : 'Войти'}
            </button>
          </form>
          <p className="muted small" style={{ marginTop: 16 }}>
            <a href="#/" className="link-btn">← К тесту</a>
          </p>
        </div>
      </main>
      <AppFooter />
    </div>
  );
}
