import { useCallback, useEffect, useRef, useState } from 'react';
import StartScreen from './screens/StartScreen';
import InstructionsScreen from './screens/InstructionsScreen';
import TestScreen from './screens/TestScreen';
import CompletionScreen from './screens/CompletionScreen';
import ResultsGate from './screens/ResultsGate';
import AuthScreen from './screens/AuthScreen';
import AttemptStatusScreen from './screens/AttemptStatusScreen';
import { clearProgress, loadProgress, saveProgress } from './lib/progressStorage';
import { generateId } from './lib/id';
import { clearAuth, loadAuth, saveAuth } from './lib/authStorage';
import { clearAttemptRef, loadAttemptRef, saveAttemptRef } from './lib/attemptRef';
import { AttemptController } from './lib/serverAttempt';
import type { AttemptSnapshot } from './lib/serverAttempt';
import { viewFromLocal, viewFromServer } from './lib/testView';
import { ApiError } from './types';
import {
  attemptService, authService, buildLocalResult, buildSubmitRequest, describeError, testService,
} from './services/api';
import {
  answerQuestion, answeredCount, createSession, expireQuestion, isComplete, isRoundFinished,
  reconcileOnLoad, startRetryRound, totalQuestions, unansweredIds,
} from './lib/testSession';
import type { TestSession } from './lib/testSession';
import type { AppScreen, AuthSession, ServerAttemptState } from './types';

/**
 * Режим работы теста.
 *  - api  (VITE_API_MODE=api): попытка, ответы, таймер и результат живут на сервере (MySQL);
 *    браузер только показывает состояние, присланное сервером;
 *  - demo (по умолчанию): сервера нет, тест идёт локально, как на предыдущих этапах.
 */
const SERVER_MODE = attemptService.enabled;

const EMPTY_SNAPSHOT: AttemptSnapshot = {
  phase: 'idle', state: null, deadline: null, lastExpiredId: null, revision: 0, busy: false, error: null,
};

interface Restored {
  screen: AppScreen;
  session: TestSession | null;
  clientAttemptId: string;
  startedAt: string | null;
}

/**
 * Демо-режим: восстанавливаем незавершённое прохождение из localStorage.
 * Время, прошедшее с закрытия страницы, учитывается (reconcileOnLoad): таймер продолжается, а не начинается заново.
 */
function restoreLocalSession(): Restored {
  const fresh: Restored = { screen: 'start', session: null, clientAttemptId: generateId(), startedAt: null };
  if (SERVER_MODE) return fresh; // в режиме api локальный черновик не используется
  const saved = loadProgress();
  if (!saved) return fresh;

  const session = reconcileOnLoad(saved.session, Date.now());
  let screen = saved.screen;
  if (screen === 'start' || screen === 'instructions') screen = 'start';
  else if (screen === 'results' && !isComplete(session.answers)) screen = 'completion';
  else if (screen === 'test' && isRoundFinished(session)) screen = 'completion';
  else if (screen === 'completion' && !isRoundFinished(session)) screen = 'test';
  return { screen, session, clientAttemptId: saved.clientAttemptId, startedAt: saved.startedAt };
}

/** Экран, соответствующий состоянию серверной попытки. */
function screenForServerState(state: ServerAttemptState): AppScreen {
  if (state.status === 'completed') return 'results';
  return state.roundFinished || state.currentQuestion === null ? 'completion' : 'test';
}

export default function App() {
  const [initial] = useState(restoreLocalSession);
  const [initialAuth] = useState<AuthSession | null>(() => (authService.enabled ? loadAuth() : null));
  const [screen, setScreen] = useState<AppScreen>(SERVER_MODE ? 'start' : initial.screen);
  // Демо-режим: локальная сессия
  const [session, setSession] = useState<TestSession | null>(initial.session);
  const [clientAttemptId, setClientAttemptId] = useState(initial.clientAttemptId);
  const [startedAt, setStartedAt] = useState<string | null>(initial.startedAt);
  // Пользователь и токен нужны только при подключённом API; в демо-режиме сервера нет, вход не требуется.
  const [auth, setAuth] = useState<AuthSession | null>(initialAuth);
  // Режим api: состояние серверной попытки
  const [snap, setSnap] = useState<AttemptSnapshot>(EMPTY_SNAPSHOT);
  const [booting, setBooting] = useState<boolean>(SERVER_MODE && initialAuth !== null);
  const controllerRef = useRef<AttemptController | null>(null);
  /** Куда перейти, если после входа незавершённой попытки нет. */
  const afterRestoreRef = useRef<AppScreen>('start');

  const token = auth?.accessToken ?? null;
  const userId = auth?.user.userId ?? null;

  const handleUnauthorized = useCallback(() => {
    clearAuth();
    clearAttemptRef();
    setAuth(null);
    setSnap(EMPTY_SNAPSHOT);
    setScreen('start');
  }, []);
  const unauthorizedRef = useRef(handleUnauthorized);
  unauthorizedRef.current = handleUnauthorized;

  // Сохранённый токен мог устареть (выход на другом устройстве, новый вход): проверяем один раз при запуске.
  // Сетевая ошибка сессию не сбрасывает — вход пропадает только по ответу 401.
  useEffect(() => {
    if (!authService.enabled || !initialAuth) return;
    const controller = new AbortController();
    authService
      .me(initialAuth.accessToken, { signal: controller.signal })
      .then(user => {
        if (controller.signal.aborted) return;
        const fresh = { user, accessToken: initialAuth.accessToken };
        saveAuth(fresh);
        setAuth(fresh);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        if (err instanceof ApiError && err.status === 401) {
          clearAuth();
          clearAttemptRef();
          setAuth(null);
          setBooting(false);
          setScreen('start');
        }
      });
    return () => controller.abort();
  }, [initialAuth]);

  // Режим api: при появлении токена (запуск страницы или вход) создаём клиент попытки и восстанавливаем
  // текущую серверную попытку: сначала по сохранённой ссылке, затем — последнюю незавершённую.
  // Сервер сам списывает истёкшее время и не продлевает его при обновлении страницы.
  useEffect(() => {
    if (!SERVER_MODE || !token || !userId) {
      controllerRef.current = null;
      setSnap(EMPTY_SNAPSHOT);
      return;
    }
    let cancelled = false;
    let unauthorized = false;
    const controller = new AttemptController({
      service: attemptService,
      token,
      newId: generateId,
      describe: describeError,
      onChange: setSnap,
      onUnauthorized: () => {
        unauthorized = true;
        unauthorizedRef.current();
      },
    });
    controllerRef.current = controller;
    setSnap(controller.snapshot);

    void controller.restore(loadAttemptRef(userId)).then(state => {
      if (cancelled || unauthorized) return; // при 401 приложение уже вернуло пользователя ко входу
      setBooting(false);
      // Ошибка связи: экран статуса покажет сообщение и кнопку «Повторить»
      if (controller.snapshot.phase === 'error') setScreen('test');
      else setScreen(state ? screenForServerState(state) : afterRestoreRef.current);
    });

    return () => {
      cancelled = true;
      controller.dispose();
      if (controllerRef.current === controller) controllerRef.current = null;
    };
  }, [token, userId]);

  // Запоминаем id серверной попытки, чтобы после обновления страницы сразу её открыть.
  // Это только ссылка: ответы, баллы и время лежат на сервере (см. lib/attemptRef.ts).
  const serverAttemptId = snap.state?.attemptId ?? null;
  useEffect(() => {
    if (SERVER_MODE && userId && serverAttemptId) saveAttemptRef(userId, serverAttemptId);
  }, [userId, serverAttemptId]);

  // Демо-режим: сохраняем черновик при каждом изменении — в том числе момент окончания времени на текущий вопрос.
  useEffect(() => {
    if (SERVER_MODE) return;
    if (!session || screen === 'start' || screen === 'auth' || screen === 'instructions') {
      if (!session) clearProgress();
      return;
    }
    saveProgress({ screen, session, clientAttemptId, startedAt });
  }, [screen, session, clientAttemptId, startedAt]);

  // Круг закончился → экран завершения. Единственное место этого перехода: он не зависит от
  // таймера или клика, поэтому «перепрыгнуть» или зависнуть на тесте нельзя.
  useEffect(() => {
    if (SERVER_MODE) {
      const st = snap.state;
      if (snap.phase === 'ready' && st && st.status === 'in_progress') {
        if (screen === 'test' && (st.roundFinished || st.currentQuestion === null)) setScreen('completion');
        else if (screen === 'completion' && !st.roundFinished && st.currentQuestion !== null) setScreen('test');
      }
      return;
    }
    if (screen === 'test' && session && isRoundFinished(session)) setScreen('completion');
  }, [screen, session, snap]);

  // ───────── Действия во время теста ─────────

  const handleAnswer = useCallback((questionId: number, value: number) => {
    if (SERVER_MODE) {
      void controllerRef.current?.answer(questionId, value);
      return;
    }
    setSession(prev => (prev ? answerQuestion(prev, questionId, value, Date.now()) : prev));
  }, []);

  const handleExpire = useCallback((questionId: number) => {
    if (SERVER_MODE) {
      void controllerRef.current?.expire(questionId);
      return;
    }
    setSession(prev => (prev ? expireQuestion(prev, questionId, Date.now()) : prev));
  }, []);

  function handleStart() {
    // С подключённым API сначала нужна регистрация или вход; в демо-режиме — сразу к инструкции
    setScreen(authService.enabled && !auth ? 'auth' : 'instructions');
  }

  function handleAuthenticated(next: AuthSession) {
    saveAuth(next);
    // После входа сначала ищем незавершённую попытку на сервере (эффект выше); если её нет — инструкция.
    afterRestoreRef.current = 'instructions';
    setBooting(SERVER_MODE);
    setAuth(next);
    if (!SERVER_MODE) setScreen('instructions');
  }

  function resetServerState() {
    clearAttemptRef();
    setSnap(EMPTY_SNAPSHOT);
    // Новый клиент попытки — со свежим состоянием: старый контроллер больше не нужен
    controllerRef.current?.dispose();
    controllerRef.current = null;
  }

  function handleLogout() {
    const tokenToRevoke = auth?.accessToken;
    if (tokenToRevoke) void authService.logout(tokenToRevoke).catch(() => undefined); // токен аннулируется на сервере, если он доступен
    clearAuth();
    clearProgress(); // локальный черновик теста принадлежит предыдущему пользователю
    resetServerState();
    afterRestoreRef.current = 'start';
    setAuth(null);
    setSession(null);
    setStartedAt(null);
    setClientAttemptId(generateId());
    setScreen('start');
  }

  async function beginServerAttempt() {
    setScreen('test');
    const state = await controllerRef.current?.begin();
    if (state) setScreen(screenForServerState(state));
  }

  function handleBegin() {
    if (SERVER_MODE) {
      void beginServerAttempt();
      return;
    }
    // Новая сессия создаётся только если её ещё нет — повторное нажатие не сбрасывает время
    setSession(prev => prev ?? createSession(Date.now()));
    setStartedAt(prev => prev ?? new Date().toISOString());
    setScreen('test');
  }

  async function retryServerRound() {
    const ok = await controllerRef.current?.retryRound();
    if (ok) setScreen('test');
  }

  function handleRetryMissing() {
    if (SERVER_MODE) {
      void retryServerRound();
      return;
    }
    setSession(prev => (prev ? startRetryRound(prev, Date.now()) : prev));
    setScreen('test');
  }

  function handleViewResults() {
    if (SERVER_MODE) {
      // Результат — только когда на ВСЕ вопросы есть ответы на сервере (его проверяет и finish)
      if (snap.state?.canFinish || snap.state?.status === 'completed') setScreen('results');
      return;
    }
    // Результат — только когда на ВСЕ вопросы есть ответы
    if (session && isComplete(session.answers)) setScreen('results');
  }

  function handleRetake() {
    clearProgress();
    resetServerState();
    setSession(null);
    setStartedAt(null);
    setClientAttemptId(generateId()); // новая попытка — новый идентификатор
    // Серверной попытки больше нет в памяти: заново создаём клиент (тот же токен, новое состояние)
    if (SERVER_MODE && token && userId) {
      const controller = new AttemptController({
        service: attemptService, token, newId: generateId, describe: describeError,
        onChange: setSnap, onUnauthorized: () => unauthorizedRef.current(),
      });
      controllerRef.current = controller;
      setSnap(controller.snapshot);
    }
    setScreen('start');
  }

  function renderServerScreen() {
    const st = snap.state;
    if (snap.phase === 'error') {
      return (
        <AttemptStatusScreen
          status="error"
          message={snap.error}
          onRetry={() => (st ? void controllerRef.current?.restore(st.attemptId) : void beginServerAttempt())}
          onBack={() => setScreen('start')}
        />
      );
    }
    if (!st || snap.phase !== 'ready') return <AttemptStatusScreen status="loading" />;

    if (screen === 'test' && st.status === 'in_progress' && st.currentQuestion) {
      return <TestScreen view={viewFromServer(snap)} onAnswer={handleAnswer} onExpire={handleExpire} />;
    }
    if (screen === 'completion' && st.status === 'in_progress') {
      return (
        <CompletionScreen
          key={st.round}
          round={st.round}
          answeredCount={st.answeredCount}
          missingCount={st.totalQuestions - st.answeredCount}
          total={st.totalQuestions}
          onViewResults={handleViewResults}
          onRetryMissing={handleRetryMissing}
          busy={snap.busy}
          error={snap.error}
        />
      );
    }
    if (screen === 'results' && token && (st.canFinish || st.status === 'completed')) {
      const attemptId = st.attemptId;
      return (
        <ResultsGate
          key={attemptId}
          load={signal => attemptService.finish(token, attemptId, { signal })}
          onRetake={handleRetake}
        />
      );
    }
    return <AttemptStatusScreen status="loading" />;
  }

  function renderLocalScreen() {
    return (
      <>
        {screen === 'test' && session && !isRoundFinished(session) && (
          <TestScreen view={viewFromLocal(session)} onAnswer={handleAnswer} onExpire={handleExpire} />
        )}
        {screen === 'completion' && session && (
          <CompletionScreen
            key={session.round}
            round={session.round}
            answeredCount={answeredCount(session.answers)}
            missingCount={unansweredIds(session.answers).length}
            total={totalQuestions()}
            onViewResults={handleViewResults}
            onRetryMissing={handleRetryMissing}
          />
        )}
        {screen === 'results' && session && isComplete(session.answers) && (
          <ResultsGate
            load={signal =>
              testService.submitAttempt(buildSubmitRequest({ clientAttemptId, answers: session.answers, startedAt }), { signal })
            }
            localFallback={() => buildLocalResult(session.answers, clientAttemptId)}
            onRetake={handleRetake}
          />
        )}
      </>
    );
  }

  // ───────── Экраны ─────────

  if (SERVER_MODE && booting) return <AttemptStatusScreen status="loading" />;

  let body;
  if (screen === 'start') {
    body = (
      <StartScreen
        onStart={handleStart}
        onUserAccess={() => setScreen('auth')}
        showEntryLinks={authService.enabled}
        userName={auth?.user.displayName ?? null}
        onLogout={authService.enabled && auth ? handleLogout : undefined}
      />
    );
  } else if (screen === 'auth') {
    body = <AuthScreen onAuthenticated={handleAuthenticated} onBack={() => setScreen('start')} />;
  } else if (screen === 'instructions') {
    body = <InstructionsScreen onBegin={handleBegin} onBack={() => setScreen('start')} />;
  } else if (SERVER_MODE) {
    body = renderServerScreen();
  } else {
    body = renderLocalScreen();
  }
  return <>{body}</>;
}
