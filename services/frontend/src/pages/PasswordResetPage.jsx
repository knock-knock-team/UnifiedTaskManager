import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { PasswordField } from '../ui/PasswordField';

const PASSWORD_RESET_EMAIL_KEY = 'utm:passwordResetEmail';
const PASSWORD_RESET_CODE_KEY = 'utm:passwordResetCode';
const PASSWORD_RESET_CODE_SENT_AT_KEY = 'utm:passwordResetCodeSentAt';
const RESEND_COOLDOWN_SECONDS = 120;

export function PasswordResetPage({ onStartPasswordReset, onVerifyPasswordResetCode, onCompletePasswordReset }) {
  const navigate = useNavigate();
  const location = useLocation();
  const codeInputRefs = useRef([]);
  const [email, setEmail] = useState(() => sessionStorage.getItem(PASSWORD_RESET_EMAIL_KEY) || '');
  const [codeDigits, setCodeDigits] = useState(() => {
    const saved = sessionStorage.getItem(PASSWORD_RESET_CODE_KEY) || '';
    return Array.from({ length: 6 }, (_, index) => saved[index] || '');
  });
  const [password, setPassword] = useState('');
  const [passwordRepeat, setPasswordRepeat] = useState('');
  const [expiresInSeconds, setExpiresInSeconds] = useState(0);
  const [resendAvailableIn, setResendAvailableIn] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const step = useMemo(() => {
    if (location.pathname.endsWith('/code')) return 'code';
    if (location.pathname.endsWith('/new')) return 'new';
    return 'email';
  }, [location.pathname]);
  const code = codeDigits.join('');

  useEffect(() => {
    if ((step === 'code' || step === 'new') && !email) {
      navigate('/password-reset', { replace: true });
    }
    if (step === 'new' && code.length !== 6) {
      navigate('/password-reset/code', { replace: true });
    }
  }, [code.length, email, navigate, step]);

  useEffect(() => {
    if (step !== 'code') return undefined;
    const updateTimer = () => {
      const sentAt = Number(sessionStorage.getItem(PASSWORD_RESET_CODE_SENT_AT_KEY) || 0);
      if (!sentAt) {
        setResendAvailableIn(0);
        return;
      }
      const elapsedSeconds = Math.floor((Date.now() - sentAt) / 1000);
      setResendAvailableIn(Math.max(0, RESEND_COOLDOWN_SECONDS - elapsedSeconds));
    };
    updateTimer();
    const timer = window.setInterval(updateTimer, 1000);
    return () => window.clearInterval(timer);
  }, [step]);

  async function handleStart(event) {
    setIsSubmitting(true);
    try {
      const data = await onStartPasswordReset(event, email);
      setExpiresInSeconds(Number(data?.expiresInSeconds || 0));
      sessionStorage.setItem(PASSWORD_RESET_EMAIL_KEY, email.trim().toLowerCase());
      sessionStorage.setItem(PASSWORD_RESET_CODE_SENT_AT_KEY, String(Date.now()));
      navigate('/password-reset/code');
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleResendCode() {
    setIsSubmitting(true);
    try {
      const data = await onStartPasswordReset(null, email);
      setCodeDigits(Array.from({ length: 6 }, () => ''));
      setExpiresInSeconds(Number(data?.expiresInSeconds || 0));
      sessionStorage.setItem(PASSWORD_RESET_CODE_KEY, '');
      sessionStorage.setItem(PASSWORD_RESET_CODE_SENT_AT_KEY, String(Date.now()));
      setResendAvailableIn(RESEND_COOLDOWN_SECONDS);
      codeInputRefs.current[0]?.focus();
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleVerify(event) {
    setIsSubmitting(true);
    try {
      const data = await onVerifyPasswordResetCode(event, email, code);
      setExpiresInSeconds(Number(data?.expiresInSeconds || 0));
      sessionStorage.setItem(PASSWORD_RESET_CODE_KEY, code);
      navigate('/password-reset/new');
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleComplete(event) {
    event.preventDefault();
    if (password !== passwordRepeat) return;
    setIsSubmitting(true);
    try {
      await onCompletePasswordReset(event, email, code, password);
      sessionStorage.removeItem(PASSWORD_RESET_EMAIL_KEY);
      sessionStorage.removeItem(PASSWORD_RESET_CODE_KEY);
      sessionStorage.removeItem(PASSWORD_RESET_CODE_SENT_AT_KEY);
      navigate('/login', { replace: true });
    } finally {
      setIsSubmitting(false);
    }
  }

  function updateCodeDigit(index, value) {
    const nextValue = value.replace(/\D/g, '').slice(-1);
    setCodeDigits((current) => {
      const next = [...current];
      next[index] = nextValue;
      return next;
    });
    if (nextValue && index < 5) {
      codeInputRefs.current[index + 1]?.focus();
    }
  }

  function handleCodeKeyDown(index, event) {
    if (event.key === 'Backspace' && !codeDigits[index] && index > 0) {
      codeInputRefs.current[index - 1]?.focus();
    }
  }

  function handleCodePaste(event) {
    const pasted = event.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    if (!pasted) return;
    event.preventDefault();
    setCodeDigits(Array.from({ length: 6 }, (_, index) => pasted[index] || ''));
    codeInputRefs.current[Math.min(pasted.length, 6) - 1]?.focus();
  }

  const expiresCaption = expiresInSeconds > 0
    ? `Код действует примерно ${Math.max(1, Math.ceil(expiresInSeconds / 60))} мин.`
    : 'Код действует ограниченное время.';
  const passwordsMismatch = passwordRepeat && password !== passwordRepeat;

  return (
    <section className="single-page">
      <article className="pane single-card">
        <p className="section-label">Восстановление доступа</p>
        <h2>{step === 'email' ? 'Введите email' : step === 'code' ? 'Введите код' : 'Новый пароль'}</h2>
        <p className="auth-step-caption">
          {step === 'email' && 'Если аккаунт существует, мы отправим на почту 6-значный код восстановления.'}
          {step === 'code' && `Проверьте почту ${email}. ${expiresCaption}`}
          {step === 'new' && 'Код подтверждён. Придумайте новый пароль.'}
        </p>

        {step === 'email' && (
          <form className="auth-form" onSubmit={(event) => void handleStart(event)} autoComplete="off">
            <label className="field-label">
              <span>Email</span>
              <input value={email} onChange={(event) => setEmail(event.target.value)} type="email" name="reset-email" autoComplete="email" placeholder="you@команда.рф" required disabled={isSubmitting} />
            </label>
            <button type="submit" disabled={isSubmitting}>{isSubmitting ? 'Отправляем...' : 'Получить код'}</button>
          </form>
        )}

        {step === 'code' && (
          <form className="auth-form" onSubmit={(event) => void handleVerify(event)} autoComplete="off">
            <div className="registration-code-grid" onPaste={handleCodePaste}>
              {codeDigits.map((digit, index) => (
                <input
                  key={index}
                  ref={(element) => { codeInputRefs.current[index] = element; }}
                  value={digit}
                  onChange={(event) => updateCodeDigit(index, event.target.value)}
                  onKeyDown={(event) => handleCodeKeyDown(index, event)}
                  inputMode="numeric"
                  pattern="\d*"
                  maxLength={1}
                  aria-label={`Цифра ${index + 1} кода восстановления`}
                  disabled={isSubmitting}
                />
              ))}
            </div>
            <p className="auth-helper-caption">Если письмо не пришло, возможно, аккаунта с такой почтой нет. Проверьте email или попробуйте зарегистрироваться.</p>
            <button type="submit" disabled={isSubmitting || code.length !== 6}>{isSubmitting ? 'Проверяем...' : 'Проверить код'}</button>
            <button type="button" className="ghost" disabled={isSubmitting || resendAvailableIn > 0} onClick={() => void handleResendCode()}>
              {resendAvailableIn > 0 ? `Отправить повторно через ${resendAvailableIn} сек.` : 'Отправить код повторно'}
            </button>
            <Link className="auth-inline-link" to="/login">Вернуться ко входу</Link>
          </form>
        )}

        {step === 'new' && (
          <form className="auth-form" onSubmit={(event) => void handleComplete(event)} autoComplete="off">
            <PasswordField
              label="Новый пароль"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              name="reset-password"
              autoComplete="new-password"
              minLength={8}
              placeholder="Не менее 8 символов"
              required
              disabled={isSubmitting}
            />
            <PasswordField
              label="Повтор пароля"
              value={passwordRepeat}
              onChange={(event) => setPasswordRepeat(event.target.value)}
              name="reset-password-repeat"
              autoComplete="new-password"
              minLength={8}
              placeholder="Повторите пароль"
              required
              disabled={isSubmitting}
            />
            {passwordsMismatch && <p className="auth-error-caption">Пароли не совпадают.</p>}
            <button type="submit" disabled={isSubmitting || !password || password !== passwordRepeat}>{isSubmitting ? 'Сохраняем...' : 'Сменить пароль'}</button>
          </form>
        )}

        <p className="auth-foot">
          Вспомнили пароль? <Link to="/login">Войти</Link>
        </p>
      </article>
    </section>
  );
}
