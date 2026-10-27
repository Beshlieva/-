import { REGIONS } from '../data/regions';

export const AGE_MIN = 10;
export const AGE_MAX = 100;
export const PASSWORD_MIN = 8;
const PASSWORD_MAX_BYTES = 72;
const NAME_MAX = 50;

export interface RegistrationValues {
  firstName: string;
  lastName: string;
  email: string;
  age: string;
  regionCode: string;
  password: string;
  passwordRepeat: string;
}

export type FieldErrors = Partial<Record<keyof RegistrationValues, string>>;

// Буквы любого алфавита, далее буквы, пробел, апостроф, точка, дефис — то же правило, что на сервере
const NAME_RE = /^\p{L}[\p{L} '.-]*$/u;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function isValidEmail(value: string): boolean {
  const v = value.trim();
  return v.length <= 254 && EMAIL_RE.test(v);
}

function validateName(value: string, label: string): string | undefined {
  const v = value.trim();
  if (v === '') return `Введите ${label}.`;
  if (v.length > NAME_MAX) return `Не длиннее ${NAME_MAX} символов.`;
  if (!NAME_RE.test(v)) return 'Используйте только буквы, пробел, дефис и апостроф.';
  return undefined;
}

/** Проверка пароля по правилам регистрации. Длина в байтах — как на сервере (bcrypt учитывает 72 байта). */
export function validatePassword(password: string): string | undefined {
  if (password === '') return 'Придумайте пароль.';
  if ([...password].length < PASSWORD_MIN) return `Пароль должен содержать не менее ${PASSWORD_MIN} символов.`;
  if (new TextEncoder().encode(password).length > PASSWORD_MAX_BYTES) return 'Пароль слишком длинный.';
  return undefined;
}

/** Возраст: целое число в разумном диапазоне или текст ошибки. */
export function parseAge(value: string): { age: number } | { error: string } {
  const v = value.trim();
  if (v === '') return { error: 'Укажите возраст.' };
  if (!/^\d+$/.test(v)) return { error: 'Возраст — целое число, например 17.' };
  const n = Number(v);
  if (n < AGE_MIN || n > AGE_MAX) return { error: `Возраст должен быть от ${AGE_MIN} до ${AGE_MAX} лет.` };
  return { age: n };
}

/** Проверка формы регистрации. Пустой объект — ошибок нет. Сообщения на русском языке. */
export function validateRegistration(values: RegistrationValues): FieldErrors {
  const errors: FieldErrors = {};

  const first = validateName(values.firstName, 'имя');
  if (first) errors.firstName = first;
  const last = validateName(values.lastName, 'фамилию');
  if (last) errors.lastName = last;

  if (values.email.trim() === '') errors.email = 'Введите email.';
  else if (!isValidEmail(values.email)) errors.email = 'Введите корректный email, например name@example.com.';

  const age = parseAge(values.age);
  if ('error' in age) errors.age = age.error;

  if (values.regionCode === '') errors.regionCode = 'Выберите регион.';
  else if (!REGIONS.some(r => r.code === values.regionCode)) errors.regionCode = 'Выберите регион из списка.';

  const pw = validatePassword(values.password);
  if (pw) errors.password = pw;
  else if (values.passwordRepeat === '') errors.passwordRepeat = 'Повторите пароль.';
  else if (values.password !== values.passwordRepeat) errors.passwordRepeat = 'Пароли не совпадают.';

  return errors;
}
