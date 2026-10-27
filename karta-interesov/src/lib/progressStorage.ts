import { parseSession } from './testSession';
import type { TestSession } from './testSession';
import { TEST_VERSION } from '../types';
import type { AppScreen } from '../types';

/**
 * ЛОКАЛЬНЫЕ данные: незавершённое прохождение в localStorage этого браузера.
 *
 * Что здесь хранится: экран, сессия теста (ответы, очередь вопросов, момент окончания времени на текущий
 * вопрос) и идентификатор попытки. Это только черновик прохождения на ЭТОМ устройстве:
 *  - он не отправляется на сервер и не является сохранённым результатом;
 *  - результаты, сохранённые на сервере (MySQL), будут приходить из src/services/api
 *    с признаком source: 'server' / persisted: true и с этим хранилищем никак не связаны;
 *  - после получения серверного результата черновик нужно очистить (clearProgress).
 *
 * Чтобы отключить локальное хранение, сделайте функции ниже пустыми — остальной код менять не нужно.
 */
const KEY = 'karta-interesov:local:session:v2';
/** Ключ прежней версии (без таймера). Прогресс без ограничения времени не переносится — ключ удаляется. */
const LEGACY_KEY = 'karta-interesov:progress:v1';

export interface SavedProgress {
  screen: AppScreen;
  session: TestSession;
  clientAttemptId: string;
  startedAt: string | null;
}

const SCREENS: AppScreen[] = ['start', 'auth', 'instructions', 'test', 'completion', 'results'];

export function loadProgress(): SavedProgress | null {
  try {
    window.localStorage.removeItem(LEGACY_KEY);
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const data: unknown = JSON.parse(raw);
    if (typeof data !== 'object' || data === null) return null;
    const d = data as Record<string, unknown>;

    if (d.testVersion !== TEST_VERSION) return null;
    if (typeof d.clientAttemptId !== 'string' || d.clientAttemptId === '') return null;
    if (typeof d.screen !== 'string' || !SCREENS.includes(d.screen as AppScreen)) return null;

    const session = parseSession(d.session);
    if (!session) return null;

    return {
      screen: d.screen as AppScreen,
      session,
      clientAttemptId: d.clientAttemptId,
      startedAt: typeof d.startedAt === 'string' ? d.startedAt : null,
    };
  } catch {
    return null; // повреждённые данные или localStorage недоступен
  }
}

export function saveProgress(progress: SavedProgress): void {
  try {
    window.localStorage.setItem(
      KEY,
      JSON.stringify({
        testVersion: TEST_VERSION,
        storage: 'local-device',
        savedAt: new Date().toISOString(),
        ...progress,
      }),
    );
  } catch {
    /* приватный режим или переполнение хранилища — просто работаем без сохранения */
  }
}

export function clearProgress(): void {
  try {
    window.localStorage.removeItem(KEY);
    window.localStorage.removeItem(LEGACY_KEY);
  } catch {
    /* ignore */
  }
}
