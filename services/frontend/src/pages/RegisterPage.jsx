import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';

const REGISTRATION_EMAIL_KEY = 'utm:registrationEmail';
const REGISTRATION_CODE_KEY = 'utm:registrationCode';
const REGISTRATION_CODE_SENT_AT_KEY = 'utm:registrationCodeSentAt';
const RESEND_COOLDOWN_SECONDS = 120;

export function RegisterPage({ onStartRegistration, onVerifyRegistrationCode, onCompleteRegistration }) {
  const navigate = useNavigate();
  const location = useLocation();
  const codeInputRefs = useRef([]);
  const [name, setName] = useState('');
  const [email, setEmail] = useState(() => sessionStorage.getItem(REGISTRATION_EMAIL_KEY) || '');
  const [codeDigits, setCodeDigits] = useState(() => {
    const saved = sessionStorage.getItem(REGISTRATION_CODE_KEY) || '';
    return Array.from({ length: 6 }, (_, index) => saved[index] || '');
  });
  const [password, setPassword] = useState('');
  const [passwordRepeat, setPasswordRepeat] = useState('');
  const [expiresInSeconds, setExpiresInSeconds] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [resendAvailableIn, setResendAvailableIn] = useState(0);
  const step = useMemo(() => {
    if (location.pathname.endsWith('/code')) return 'code';
    if (location.pathname.endsWith('/password')) return 'password';
    return 'email';
  }, [location.pathname]);
  const code = codeDigits.join('');

  useEffect(() => {
    if ((step === 'code' || step === 'password') && !email) {
      navigate('/register', { replace: true });
    }
    if (step === 'password' && code.length !== 6) {
      navigate('/register/code', { replace: true });
    }
  }, [code.length, email, navigate, step]);

  useEffect(() => {
    if (step !== 'code') return undefined;
    const updateResendTimer = () => {
      const sentAt = Number(sessionStorage.getItem(REGISTRATION_CODE_SENT_AT_KEY) || 0);
      if (!sentAt) {
        setResendAvailableIn(0);
        return;
      }
      const elapsedSeconds = Math.floor((Date.now() - sentAt) / 1000);
      setResendAvailableIn(Math.max(0, RESEND_COOLDOWN_SECONDS - elapsedSeconds));
    };
    updateResendTimer();
    const timer = window.setInterval(updateResendTimer, 1000);
    return () => window.clearInterval(timer);
  }, [step]);

  async function handleStart(event) {
    setIsSubmitting(true);
    try {
      const data = await onStartRegistration(event, email);
      setExpiresInSeconds(Number(data?.expiresInSeconds || 0));
      sessionStorage.setItem(REGISTRATION_EMAIL_KEY, email.trim().toLowerCase());
      sessionStorage.setItem(REGISTRATION_CODE_SENT_AT_KEY, String(Date.now()));
      navigate('/register/code');
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleResendCode() {
    setIsSubmitting(true);
    try {
      const data = await onStartRegistration(null, email);
      setCodeDigits(Array.from({ length: 6 }, () => ''));
      setExpiresInSeconds(Number(data?.expiresInSeconds || 0));
      sessionStorage.setItem(REGISTRATION_CODE_KEY, '');
      sessionStorage.setItem(REGISTRATION_CODE_SENT_AT_KEY, String(Date.now()));
      setResendAvailableIn(RESEND_COOLDOWN_SECONDS);
      codeInputRefs.current[0]?.focus();
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleVerify(event) {
    setIsSubmitting(true);
    try {
      const data = await onVerifyRegistrationCode(event, email, code);
      setExpiresInSeconds(Number(data?.expiresInSeconds || 0));
      sessionStorage.setItem(REGISTRATION_CODE_KEY, code);
      navigate('/register/password');
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleComplete(event) {
    event.preventDefault();
    if (password !== passwordRepeat) {
      return;
    }
    setIsSubmitting(true);
    try {
      await onCompleteRegistration(event, name, email, code, password);
      sessionStorage.removeItem(REGISTRATION_EMAIL_KEY);
      sessionStorage.removeItem(REGISTRATION_CODE_KEY);
      sessionStorage.removeItem(REGISTRATION_CODE_SENT_AT_KEY);
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
        <p className="section-label">Регистрация</p>
        <h2>{step === 'email' ? 'Подтвердите email' : step === 'code' ? 'Введите код' : 'Завершите регистрацию'}</h2>
        <p className="auth-step-caption">
          {step === 'email' && 'Введите почту, на неё придёт 6-значный код подтверждения.'}
          {step === 'code' && `Мы отправили код на ${email}. ${expiresCaption}`}
          {step === 'password' && 'Код подтверждён. Теперь укажите имя и придумайте пароль.'}
        </p>
        {step === 'email' && (
          <form className="auth-form" onSubmit={(event) => void handleStart(event)} autoComplete="off">
            <label className="field-label">
              <span>Email</span>
              <input value={email} onChange={(event) => setEmail(event.target.value)} type="email" name="register-email" autoComplete="email" placeholder="you@команда.рф" required disabled={isSubmitting} />
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
                  aria-label={`Цифра ${index + 1} кода`}
                  disabled={isSubmitting}
                />
              ))}
            </div>
            <button type="submit" disabled={isSubmitting || code.length !== 6}>{isSubmitting ? 'Проверяем...' : 'Проверить код'}</button>
            <button type="button" className="ghost" disabled={isSubmitting || resendAvailableIn > 0} onClick={() => void handleResendCode()}>
              {resendAvailableIn > 0 ? `Отправить повторно через ${resendAvailableIn} сек.` : 'Отправить код повторно'}
            </button>
            <button type="button" className="ghost" disabled={isSubmitting} onClick={() => {
              sessionStorage.removeItem(REGISTRATION_EMAIL_KEY);
              sessionStorage.removeItem(REGISTRATION_CODE_KEY);
              sessionStorage.removeItem(REGISTRATION_CODE_SENT_AT_KEY);
              setCodeDigits(Array.from({ length: 6 }, () => ''));
              navigate('/register');
            }}>
              Изменить email
            </button>
          </form>
        )}
        {step === 'password' && (
          <form className="auth-form" onSubmit={(event) => void handleComplete(event)} autoComplete="off">
            <label className="field-label">
              <span>Имя</span>
              <input value={name} onChange={(event) => setName(event.target.value)} name="register-name" autoComplete="name" placeholder="Как к вам обращаться" required disabled={isSubmitting} />
            </label>
            <label className="field-label">
              <span>Пароль</span>
              <input value={password} onChange={(event) => setPassword(event.target.value)} type="password" name="register-password" autoComplete="new-password" minLength={8} placeholder="Не менее 8 символов" required disabled={isSubmitting} />
            </label>
            <label className="field-label">
              <span>Повтор пароля</span>
              <input value={passwordRepeat} onChange={(event) => setPasswordRepeat(event.target.value)} type="password" name="register-password-repeat" autoComplete="new-password" minLength={8} placeholder="Повторите пароль" required disabled={isSubmitting} />
            </label>
            {passwordsMismatch && <p className="auth-error-caption">Пароли не совпадают.</p>}
            <button type="submit" disabled={isSubmitting || !password || password !== passwordRepeat}>{isSubmitting ? 'Создаём аккаунт...' : 'Завершить регистрацию'}</button>
          </form>
        )}
        <p className="auth-foot">
          Уже есть аккаунт? <Link to="/login">Войти</Link>
        </p>
      </article>
    </section>
  );
}
