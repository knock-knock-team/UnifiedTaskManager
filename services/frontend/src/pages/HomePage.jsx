import React from 'react';
import { useNavigate } from 'react-router-dom';

export function HomePage({ isAuthorized }) {
  const navigate = useNavigate();
  return (
    <>
      <section className="hero hero-home">
        <p className="eyebrow">UNIFIED TASK MANAGER</p>
        <h1>Задачи, чаты, файлы и звонки в одном рабочем контуре</h1>
        <p className="hero-note">
          Единая точка входа для команды: канбан-доска с дедлайнами и напоминаниями, переписка по проектам,
          загрузка артефактов, видеовстречи и AI-помощник в боковой панели — без скачивания отдельных клиентов.
        </p>
        <div className="hero-cta-row">
          {!isAuthorized && <button type="button" onClick={() => navigate('/register')}>Создать аккаунт</button>}
          {!isAuthorized && <button type="button" className="ghost" onClick={() => navigate('/login')}>Войти</button>}
          {isAuthorized && <button type="button" onClick={() => navigate('/tasks')}>Открыть задачи</button>}
          {isAuthorized && <button type="button" className="ghost" onClick={() => navigate('/chats')}>Чаты</button>}
          {isAuthorized && <button type="button" className="ghost" onClick={() => navigate('/calls')}>Видеовстречи</button>}
          {isAuthorized && <button type="button" className="ghost" onClick={() => navigate('/files')}>Файлы</button>}
          {isAuthorized && <button type="button" className="ghost" onClick={() => navigate('/cabinet')}>Личный кабинет</button>}
        </div>
      </section>

      <section className="section-block">
        <article className="pane">
          <p className="section-label">ВОЗМОЖНОСТИ</p>
          <h2>Что уже есть в интерфейсе</h2>
          <div className="feature-grid">
            <div>
              <strong>Доска задач</strong>
              <span>Колонки под ваш процесс, фильтры, дедлайны, комментарии и карта связей между карточками.</span>
            </div>
            <div>
              <strong>AI-ассистент</strong>
              <span>Сворачиваемая панель справа: запросы к модели в контексте выбранной команды и проекта.</span>
            </div>
            <div>
              <strong>Совместная работа</strong>
              <span>Чаты, файловое хранилище по окружениям и комнаты для видеозвонков с приглашением по ссылке.</span>
            </div>
          </div>
        </article>
      </section>

      <section className="section-block">
        <article className="pane">
          <p className="section-label">ОБЗОР ИНТЕРФЕЙСА</p>
          <h2>Как это выглядит в работе</h2>
          <p className="section-text">
            Ниже — упрощённый макет доски и подсказка по ассистенту. Реальные данные появятся после входа и выбора команды.
          </p>
          <div className="home-demo">
            <div className="home-demo-board" aria-hidden>
              <div className="home-demo-columns">
                <div className="home-demo-col">
                  <div className="home-demo-col-head">К выполнению</div>
                  <div className="home-demo-card" />
                  <div className="home-demo-card" />
                </div>
                <div className="home-demo-col">
                  <div className="home-demo-col-head">В работе</div>
                  <div className="home-demo-card" />
                </div>
                <div className="home-demo-col">
                  <div className="home-demo-col-head">Готово</div>
                  <div className="home-demo-card" />
                  <div className="home-demo-card" />
                </div>
              </div>
            </div>
            <div className="home-demo-agent">
              <span className="home-demo-agent-dot" aria-hidden />
              <span>Панель агента закреплена справа: можно спросить о задачах, не уходя с доски.</span>
            </div>
          </div>
        </article>
      </section>

      <section className="section-block">
        <article className="pane">
          <p className="section-label">СЦЕНАРИЙ</p>
          <h2>Типичный день в системе</h2>
          <div className="scenario-grid">
            <div>
              <span>01</span>
              <strong>Контекст</strong>
              <p>Выберите команду и проект на доске — дальше фильтры, дедлайны и агент используют этот контекст.</p>
            </div>
            <div>
              <span>02</span>
              <strong>Синхронизация</strong>
              <p>Обновляйте статусы и читайте чаты; файлы и звонки доступны из той же шапки приложения.</p>
            </div>
            <div>
              <span>03</span>
              <strong>Кабинет</strong>
              <p>Профиль, приглашения в команды, сводка по задачам выбранного проекта и тема оформления.</p>
            </div>
          </div>
        </article>
      </section>
    </>
  );
}
