import React, { useState } from 'react';
import { Link } from 'react-router-dom';

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
          <label className="field-label">
            <span>Пароль</span>
            <input value={password} onChange={(event) => setPassword(event.target.value)} type="password" name="login-password" autoComplete="current-password" placeholder="••••••••" required />
          </label>
          <button type="submit">Войти</button>
        </form>
        <p className="auth-foot">
          Нет аккаунта? <Link to="/register">Зарегистрироваться</Link>
        </p>
      </article>
    </section>
  );
}
