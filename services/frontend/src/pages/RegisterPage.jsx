import React, { useState } from 'react';

export function RegisterPage({ onRegister }) {
    const [name, setName] = useState('');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');

    return (
      <section className="single-page">
        <article className="pane single-card">
          <p className="section-label">РЕГИСТРАЦИЯ</p>
          <h2>Создать аккаунт</h2>
          <form onSubmit={(event) => void onRegister(event, name, email, password)} autoComplete="off">
            <input value={name} onChange={(event) => setName(event.target.value)} name="register-name" autoComplete="name" placeholder="Имя" required />
            <input value={email} onChange={(event) => setEmail(event.target.value)} type="email" name="register-email" autoComplete="email" placeholder="Email" required />
            <input value={password} onChange={(event) => setPassword(event.target.value)} type="password" name="register-password" autoComplete="new-password" minLength={8} placeholder="Пароль" required />
            <button type="submit">Зарегистрироваться</button>
          </form>
        </article>
      </section>
    );
  }
