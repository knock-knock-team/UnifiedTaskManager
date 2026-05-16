import React, { useState } from 'react';

export function LoginPage({ onLogin }) {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');

    return (
      <section className="single-page">
        <article className="pane single-card">
          <p className="section-label">ЛОГИН</p>
          <h2>Войти в аккаунт</h2>
          <form
            onSubmit={(event) => void onLogin(event, email, password)}
            autoComplete="off"
          >
            <input value={email} onChange={(event) => setEmail(event.target.value)} type="email" name="login-email" autoComplete="username" placeholder="Email" required />
            <input value={password} onChange={(event) => setPassword(event.target.value)} type="password" name="login-password" autoComplete="current-password" placeholder="Пароль" required />
            <button type="submit">Войти</button>
          </form>
        </article>
      </section>
    );
  }
