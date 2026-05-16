import React, { useState } from 'react';
import { Link } from 'react-router-dom';

export function RegisterPage({ onRegister }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  return (
    <section className="single-page">
      <article className="pane single-card">
        <p className="section-label">Регистрация</p>
        <h2>Создать аккаунт</h2>
        <form className="auth-form" onSubmit={(event) => void onRegister(event, name, email, password)} autoComplete="off">
          <label className="field-label">
            <span>Имя</span>
            <input value={name} onChange={(event) => setName(event.target.value)} name="register-name" autoComplete="name" placeholder="Как к вам обращаться" required />
          </label>
          <label className="field-label">
            <span>Email</span>
            <input value={email} onChange={(event) => setEmail(event.target.value)} type="email" name="register-email" autoComplete="email" placeholder="you@команда.рф" required />
          </label>
          <label className="field-label">
            <span>Пароль</span>
            <input value={password} onChange={(event) => setPassword(event.target.value)} type="password" name="register-password" autoComplete="new-password" minLength={8} placeholder="Не менее 8 символов" required />
          </label>
          <button type="submit">Зарегистрироваться</button>
        </form>
        <p className="auth-foot">
          Уже есть аккаунт? <Link to="/login">Войти</Link>
        </p>
      </article>
    </section>
  );
}
