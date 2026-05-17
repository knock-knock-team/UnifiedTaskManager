import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { PasswordField } from '../ui/PasswordField';

export function LoginPage({ onLogin }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  return (
    <section className="single-page">
      <article className="pane single-card">
        <p className="section-label">Вход</p>
        <h2>Войти в аккаунт</h2>
        <form
          className="auth-form"
          onSubmit={(event) => void onLogin(event, email, password)}
          autoComplete="off"
        >
          <label className="field-label">
            <span>Email</span>
            <input value={email} onChange={(event) => setEmail(event.target.value)} type="email" name="login-email" autoComplete="username" placeholder="you@команда.рф" required />
          </label>
          <PasswordField
            label="Пароль"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            name="login-password"
            autoComplete="current-password"
            placeholder="••••••••"
            required
          />
          <button type="submit">Войти</button>
        </form>
        <p className="auth-secondary-action">
          <Link to="/password-reset">Забыли пароль?</Link>
        </p>
        <p className="auth-foot">
          Нет аккаунта? <Link to="/register">Зарегистрироваться</Link>
        </p>
      </article>
    </section>
  );
}
