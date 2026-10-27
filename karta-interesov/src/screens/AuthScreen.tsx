import { useRef, useState } from 'react';
import type { ChangeEvent, FormEvent } from 'react';
import AppHeader, { AppFooter } from '../components/AppHeader';
import { IconAlert, IconArrowLeft, IconArrowRight } from '../components/icons';
import { REGIONS } from '../data/regions';
import { parseAge, PASSWORD_MIN, validateRegistration, isValidEmail } from '../lib/registrationValidation';
import type { FieldErrors, RegistrationValues } from '../lib/registrationValidation';
import { authService, describeError, serverErrorCode, serverFieldErrors } from '../services/api';
import type { AuthSession } from '../types';

interface AuthScreenProps {
  onAuthenticated: (session: AuthSession) => void;
  onBack: () => void;
}

type Mode = 'register' | 'login';

const EMPTY: RegistrationValues = {
  firstName: '', lastName: '', email: '', age: '', regionCode: '', password: '', passwordRepeat: '',
};

/** Регистрация нового студента и вход в существующую учётную запись (email + пароль). */
export default function AuthScreen({ onAuthenticated, onBack }: AuthScreenProps) {
  const [mode, setMode] = useState<Mode>('register');
  const [values, setValues] = useState<RegistrationValues>(EMPTY);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [duplicateEmail, setDuplicateEmail] = useState(false);
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false); // защита от двойного нажатия до перерисовки

  function setField(name: keyof RegistrationValues) {
    return (e: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
      const value = e.target.value;
      setValues(prev => ({ ...prev, [name]: value }));
      setErrors(prev => (prev[name] ? { ...prev, [name]: undefined } : prev));
      setFormError(null);
      if (name === 'email') setDuplicateEmail(false);
    };
  }

  function switchMode(next: Mode, keepEmail = false) {
    setMode(next);
    setErrors({});
    setFormError(null);
    setDuplicateEmail(false);
    setValues(prev => ({ ...EMPTY, email: keepEmail ? prev.email : '' }));
  }

  async function handleRegister() {
    const found = validateRegistration(values);
    if (Object.keys(found).length > 0) {
      setErrors(found);
      return;
    }
    const age = parseAge(values.age);
    if ('error' in age) return; // уже отсечено validateRegistration

    setBusy(true);
    try {
      const session = await authService.register({
        firstName: values.firstName.trim(),
        lastName: values.lastName.trim(),
        email: values.email.trim(),
        age: age.age,
        regionCode: values.regionCode,
        password: values.password,
      });
      onAuthenticated(session);
    } catch (err) {
      const code = serverErrorCode(err);
      if (code === 'EMAIL_ALREADY_REGISTERED') {
        setDuplicateEmail(true);
        setErrors({ email: 'Этот email уже зарегистрирован.' });
      } else if (code === 'VALIDATION_ERROR') {
        const fields = serverFieldErrors(err);
        const mapped: FieldErrors = {};
        for (const key of Object.keys(EMPTY) as (keyof RegistrationValues)[]) {
          if (fields[key]) mapped[key] = fields[key];
        }
        if (Object.keys(mapped).length > 0) setErrors(mapped);
        else setFormError('Проверьте введённые данные и попробуйте ещё раз.');
      } else {
        setFormError(describeError(err));
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleLogin() {
    const found: FieldErrors = {};
    if (values.email.trim() === '') found.email = 'Введите email.';
    else if (!isValidEmail(values.email)) found.email = 'Введите корректный email, например name@example.com.';
    if (values.password === '') found.password = 'Введите пароль.';
    if (Object.keys(found).length > 0) {
      setErrors(found);
      return;
    }

    setBusy(true);
    try {
      const session = await authService.login({ email: values.email.trim(), password: values.password });
      onAuthenticated(session);
    } catch (err) {
      const code = serverErrorCode(err);
      if (code === 'INVALID_CREDENTIALS') setFormError('Неверный email или пароль.');
      else if (code === 'LOGIN_LOCKED') setFormError('Слишком много неудачных попыток входа. Подождите 15 минут и попробуйте снова.');
      else setFormError(describeError(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (submitting.current) return;
    submitting.current = true;
    setFormError(null);
    try {
      if (mode === 'register') await handleRegister();
      else await handleLogin();
    } finally {
      submitting.current = false;
    }
  }

  const isRegister = mode === 'register';

  function field(
    name: keyof RegistrationValues,
    label: string,
    props: { type?: string; autoComplete?: string; inputMode?: 'numeric' | 'email'; placeholder?: string; maxLength?: number } = {},
  ) {
    const id = `auth-${name}`;
    const error = errors[name];
    return (
      <div className="field">
        <label className="field__label" htmlFor={id}>{label}</label>
        <input
          id={id}
          className={`input${error ? ' input--error' : ''}`}
          type={props.type ?? 'text'}
          value={values[name]}
          onChange={setField(name)}
          autoComplete={props.autoComplete}
          inputMode={props.inputMode}
          placeholder={props.placeholder}
          maxLength={props.maxLength}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          disabled={busy}
        />
        {error && <p className="field__error" id={`${id}-error`} role="alert">{error}</p>}
      </div>
    );
  }

  return (
    <div className="shell">
      <AppHeader />

      <main className="page">
        <div className="container container--narrow">
          <button type="button" className="linkback" onClick={onBack}>
            <IconArrowLeft size={16} />
            Назад
          </button>

          <h1 className="h2" style={{ marginTop: 12 }}>{isRegister ? 'Регистрация' : 'Вход'}</h1>
          <p className="lead" style={{ marginTop: 12, marginBottom: 24 }}>
            {isRegister
              ? 'Заполните короткую анкету — ваши ответы и результат будут привязаны к вашей учётной записи.'
              : 'Войдите в учётную запись, которую вы создали ранее.'}
          </p>

          <div className="tabs" role="tablist" aria-label="Регистрация или вход">
            <button type="button" role="tab" className="tab" aria-selected={isRegister} onClick={() => !isRegister && switchMode('register', true)} disabled={busy}>
              Регистрация
            </button>
            <button type="button" role="tab" className="tab" aria-selected={!isRegister} onClick={() => isRegister && switchMode('login', true)} disabled={busy}>
              Вход
            </button>
          </div>

          <form className="card form" onSubmit={handleSubmit} noValidate>
            {formError && (
              <div className="form-alert" role="alert">
                <IconAlert size={18} />
                <span>{formError}</span>
              </div>
            )}

            {duplicateEmail && (
              <div className="form-alert form-alert--info" role="alert">
                <IconAlert size={18} />
                <div>
                  <p>Пользователь с таким email уже есть — повторная регистрация не нужна. Войдите в существующую учётную запись.</p>
                  <button type="button" className="link-btn" onClick={() => switchMode('login', true)}>
                    Перейти ко входу
                  </button>
                </div>
              </div>
            )}

            {isRegister && (
              <div className="form__row">
                {field('firstName', 'Имя', { autoComplete: 'given-name', maxLength: 50 })}
                {field('lastName', 'Фамилия', { autoComplete: 'family-name', maxLength: 50 })}
              </div>
            )}

            {field('email', 'Email', { type: 'email', autoComplete: 'email', inputMode: 'email', placeholder: 'name@example.com', maxLength: 254 })}

            {isRegister && (
              <div className="form__row">
                {field('age', 'Возраст', { inputMode: 'numeric', maxLength: 3, placeholder: 'Например, 17' })}
                <div className="field">
                  <label className="field__label" htmlFor="auth-regionCode">Регион Казахстана</label>
                  <select
                    id="auth-regionCode"
                    className={`input${errors.regionCode ? ' input--error' : ''}`}
                    value={values.regionCode}
                    onChange={setField('regionCode')}
                    aria-invalid={errors.regionCode ? true : undefined}
                    aria-describedby={errors.regionCode ? 'auth-regionCode-error' : undefined}
                    disabled={busy}
                  >
                    <option value="">Выберите регион</option>
                    {REGIONS.map(r => (
                      <option key={r.code} value={r.code}>{r.name}</option>
                    ))}
                  </select>
                  {errors.regionCode && <p className="field__error" id="auth-regionCode-error" role="alert">{errors.regionCode}</p>}
                </div>
              </div>
            )}

            {field('password', 'Пароль', {
              type: 'password',
              autoComplete: isRegister ? 'new-password' : 'current-password',
            })}
            {isRegister && (
              <>
                <p className="muted small" style={{ marginTop: -6 }}>Не менее {PASSWORD_MIN} символов. Пароль понадобится, чтобы войти снова.</p>
                {field('passwordRepeat', 'Повторите пароль', { type: 'password', autoComplete: 'new-password' })}
              </>
            )}

            <button type="submit" className="btn btn--primary btn--block" disabled={busy}>
              {busy ? 'Подождите…' : isRegister ? 'Зарегистрироваться' : 'Войти'}
              {!busy && <IconArrowRight size={18} />}
            </button>

            <p className="muted small" style={{ textAlign: 'center' }}>
              {isRegister ? 'Уже есть учётная запись? ' : 'Ещё не зарегистрированы? '}
              <button type="button" className="link-btn" onClick={() => switchMode(isRegister ? 'login' : 'register', true)} disabled={busy}>
                {isRegister ? 'Войти' : 'Зарегистрироваться'}
              </button>
            </p>
          </form>
        </div>
      </main>

      <AppFooter />
    </div>
  );
}
