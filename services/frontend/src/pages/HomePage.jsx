import React from 'react';
import { useNavigate } from 'react-router-dom';

export function HomePage({ isAuthorized }) {
  const navigate = useNavigate();
    return (
      <>
        <section className="hero hero-home">
          <p className="eyebrow">UNIFIED TASK MANAGER</p>
          <h1>УПРАВЛЕНИЕ ЗАДАЧАМИ С АВТОМАТИЗАЦИЕЙ И СИНХРОНИЗАЦИЕЙ</h1>
          <p className="hero-note">
            Мы строим веб-приложение, где задачи, пользователи и события связаны в единую рабочую систему.
            Пользователи работают в личных кабинетах, создают и обновляют задачи, а автоматизация и события
            синхронизируют изменения между сервисами и участниками процесса.
          </p>
          <div className="hero-cta-row">
            {!isAuthorized && <button type="button" onClick={() => navigate('/register')}>Начать с регистрации</button>}
            {!isAuthorized && <button type="button" className="ghost" onClick={() => navigate('/login')}>У меня уже есть аккаунт</button>}
            {isAuthorized && <button type="button" onClick={() => navigate('/tasks')}>Перейти к задачам</button>}
            {isAuthorized && <button type="button" className="ghost" onClick={() => navigate('/chats')}>Открыть чаты</button>}
            {isAuthorized && <button type="button" className="ghost" onClick={() => navigate('/calls')}>Начать видеозвонок</button>}
            {isAuthorized && <button type="button" className="ghost" onClick={() => navigate('/files')}>Открыть файлы</button>}
            {isAuthorized && <button type="button" className="ghost" onClick={() => navigate('/cabinet')}>Открыть личный кабинет</button>}
          </div>
        </section>

        <section className="section-block">
          <article className="pane">
            <p className="section-label">ПРЕИМУЩЕСТВА</p>
            <h2>Почему эта система удобна</h2>
            <div className="feature-grid">
              <div>
                <strong>Единый поток задач</strong>
                <span>Все изменения по задачам фиксируются последовательно и прозрачно для команды.</span>
              </div>
              <div>
                <strong>Событийная автоматизация</strong>
                <span>Сервисные события запускают полезные действия без ручного контроля.</span>
              </div>
              <div>
                <strong>Масштабируемая архитектура</strong>
                <span>Микросервисы позволяют постепенно развивать функциональность без перегрузки системы.</span>
              </div>
            </div>
          </article>
        </section>

        <section className="section-block">
          <article className="pane">
            <p className="section-label">СЦЕНАРИИ ИСПОЛЬЗОВАНИЯ</p>
            <h2>Как это работает для пользователя</h2>
            <div className="scenario-grid">
              <div>
                <span>01</span>
                <strong>Регистрация и вход</strong>
                <p>Пользователь создаёт аккаунт, авторизуется и получает доступ к своему пространству.</p>
              </div>
              <div>
                <span>02</span>
                <strong>Работа с задачами</strong>
                <p>Создаёт задачи, отслеживает статусы, видит изменения и историю выполнения.</p>
              </div>
              <div>
                <span>03</span>
                <strong>События и уведомления</strong>
                <p>Система реагирует на события задач и запускает автоматические сценарии.</p>
              </div>
            </div>
          </article>
        </section>
      </>
    );
  }
