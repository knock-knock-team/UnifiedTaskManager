# UnifiedTaskManager

UnifiedTaskManager - микросервисная система для управления командами, проектами, задачами, файлами, коммуникациями и дедлайнами. В проект встроен AI-ассистент на базе GigaChat: он помогает формулировать задачи и может выполнять реальные операции с задачами и файлами, а не только отвечать текстом в чат.

## Что умеет система

- Команды и проекты: создание рабочих пространств, приглашения, участники, роли и права.
- Задачи: колонки, drag-and-drop доска, список, календарь, mind map, теги, приоритеты, дедлайны, исполнители, история изменений и активность проекта.
- Совместная работа: комментарии к задачам, счетчики непрочитанных сообщений, realtime-синхронизация доски через WebSocket.
- Уведомления: ручные и автоматические email-напоминания о дедлайнах, настройки уведомлений на уровне проекта.
- Файлы: файловые среды для команды и проекта, папки, загрузка, скачивание, удаление и привязка файлов к задачам.
- AI: генерация названия/описания задачи, чат-агент для операций над задачами и файлами, streaming-ответы в интерфейсе.
- Коммуникации: диалоги, групповые чаты и звонки через SFU.
- Наблюдаемость: метрики Prometheus, логи Loki/Promtail, готовая Grafana.

## Скриншоты интерфейса

Ниже оставлены места под изображения интерфейса. Когда скриншоты будут готовы, положите их, например, в `docs/images/` и замените пути или имена файлов.

### Главный экран задач

<!-- TODO: вставить скриншот канбан-доски -->
![Главный экран задач](docs/images/tasks-board.png)

### Карточка задачи

<!-- TODO: вставить скриншот большой карточки задачи с комментариями, исполнителями и дедлайном -->
![Карточка задачи](docs/images/task-card.png)

### Mind map задач

<!-- TODO: вставить скриншот графа проекта, колонок и задач -->
![Mind map задач](docs/images/tasks-mindmap.png)

### AI-ассистент

<!-- TODO: вставить скриншот панели AI-агента -->
![AI-ассистент](docs/images/ai-assistant.png)

### Файловая среда проекта

<!-- TODO: вставить скриншот дерева файлов и папок проекта -->
![Файловая среда проекта](docs/images/file-environment.png)

### Чаты и звонки

<!-- TODO: вставить скриншот диалогов, группового чата или звонка -->
![Чаты и звонки](docs/images/chats-and-calls.png)

## Быстрый старт

Для полноценного запуска нужны секреты для JWT, PostgreSQL/RabbitMQ, SMTP и GigaChat. Базовые значения можно взять из `.env.example`.

```bash
cp .env.example .env
docker compose -f docker-compose.local.yml up --build -d
```

После запуска основные точки входа:

- Frontend: http://localhost:8080
- API Gateway: http://localhost:8081
- RabbitMQ Management UI: http://localhost:15672
- Grafana: http://localhost:3000
- Prometheus: http://localhost:9090
- Loki: http://localhost:3100

Для production/VPS-сборки используется отдельный compose-файл:

```bash
docker compose -f docker-compose.vps-build.yml up --build -d
```

## Основные переменные окружения

Список ниже не заменяет `.env.example`, но помогает понять, что обязательно настроить перед реальным использованием:

- `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD` - база данных.
- `RABBITMQ_USER`, `RABBITMQ_PASSWORD`, `RABBITMQ_URL` - брокер событий и RPC-команд.
- `JWT_SECRET`, `ACCESS_TOKEN_MINUTES`, `REFRESH_TOKEN_HOURS` - авторизация.
- `BOOTSTRAP_ADMIN_EMAIL`, `BOOTSTRAP_ADMIN_PASSWORD`, `BOOTSTRAP_ADMIN_NAME` - первичный администратор.
- `SBER_AUTH` - токен GigaChat для AI-функций.
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_USERNAME`, `SMTP_PASSWORD`, `SMTP_FROM` - отправка писем и deadline-уведомлений.
- `FILE_SERVICE_STORAGE_ROOT` - локальное хранилище файлов.
- `TASK_BOARD_REDIS_URL` - realtime-состояние доски задач.

## Архитектура

Проект разделен на сервисы, которые общаются через HTTP, WebSocket, RabbitMQ и общую PostgreSQL-базу.

```text
services/
├── frontend/              # React/Vite интерфейс
├── api-gateway/           # единая HTTP-точка входа и проксирование сервисов
├── user-service/          # пользователи, auth, команды, роли, права
├── task-service/          # задачи, колонки, комментарии, история, realtime-доска
├── file-service/          # файловые среды проектов и RPC-команды для файлов
├── ml-service/            # Python/FastAPI, GigaChat, task/file agent
├── notification-service/  # email-уведомления о дедлайнах
├── chat-service/          # диалоги и групповые чаты
└── sfu-service/           # звонки и WebRTC/SFU
```

Инфраструктура в `docker-compose.local.yml` и `docker-compose.vps-build.yml`:

- `postgres` - основное хранилище данных.
- `rabbitmq` - события домена и RPC для AI-агента.
- `redis` - realtime board state.
- `nginx` и `caddy` - reverse proxy.
- `coturn` - TURN/STUN для звонков.
- `prometheus`, `loki`, `promtail`, `grafana` - observability stack.

## Frontend

Frontend находится в `services/frontend` и построен на React/Vite.

Основные страницы и возможности:

- Авторизация, регистрация, восстановление пароля и профиль пользователя.
- Страница задач с выбором команды и проекта.
- Канбан-доска с колонками, сортировкой, drag-and-drop задач и колонок.
- Inline-редактирование задач и колонок, optimistic concurrency через ETag.
- Поиск и фильтры по задачам, тегам, описанию и исполнителям.
- Несколько представлений задач: доска, список, календарь и mind map.
- Mind map строит граф `проект -> колонки -> задачи`, позволяет двигать ноды, открывать задачи и рисовать поверх схемы.
- Комментарии к задачам, история изменений, активность проекта.
- Выбор нескольких исполнителей с поиском по участникам команды.
- Настройки автоматических дедлайн-уведомлений.
- Экспорт задач в CSV/JSON.
- AI drawer для общения с агентом.
- Страница файлов с деревом папок, загрузкой, скачиванием и удалением.

## Task Service

`services/task-service` отвечает за доменную модель задач:

- проекты, колонки и задачи;
- несколько исполнителей на задачу;
- комментарии и счетчики непрочитанных сообщений;
- activity log проекта и история конкретной задачи;
- reorder колонок и задач;
- WebSocket stream доски;
- optimistic concurrency через `If-Match`/ETag;
- RabbitMQ events и RPC queue `task-service.agent-commands` для AI-агента.

Сервис умеет работать с PostgreSQL и in-memory repository для тестов/локальных сценариев.

## File Service

`services/file-service` управляет файловыми средами команды и проекта:

- создание и получение файловой среды;
- дерево директорий;
- папки, файлы, загрузка, скачивание, удаление;
- проверка доступа через user-service;
- хранение файлов в локальном storage root и метаданных в PostgreSQL;
- RPC queue `file-service.agent-commands` для команд AI-агента;
- служебный registry вложений задач в `.assistant/task-attachments`.

## Notification Service

`services/notification-service` отправляет email-уведомления о дедлайнах:

- автоматический скан задач с приближающимся сроком;
- ручная отправка напоминания по задаче;
- настройки проекта: `autoEnabled`, `notifyBeforeMinutes`, `urgentBeforeMinutes`;
- учет уже отправленных уведомлений, чтобы не дублировать письма;
- отправка нескольким исполнителям задачи;
- SMTP-конфигурация через переменные окружения.

## API Gateway

`services/api-gateway` - единая HTTP-точка входа. Он проверяет access JWT, добавляет identity headers и проксирует запросы в сервисы:

- `/v1/auth`, `/v1/users`, `/v1/teams`, `/v1/permissions` -> `user-service`;
- `/v1/tasks`, `/v1/task-columns`, `/v1/task-activity`, `/v1/boards` -> `task-service`;
- `/v1/file-environments` -> `file-service`;
- `/v1/chats` -> `chat-service`;
- `/api/tasks/assistant`, `/task_name_description` -> `ml-service`;
- deadline endpoints -> `notification-service`;
- calls/ws endpoints -> `sfu-service`.

OpenAPI-спецификация находится в `services/api-gateway/api/openapi.yaml`.

## AI и ML Service

`services/ml-service` - Python/FastAPI-сервис с интеграцией GigaChat.

Он предоставляет две группы AI-возможностей:

- `/task_name_description` - генерация аккуратного названия и описания задачи из сырого текста.
- `/api/tasks/assistant` и `/api/tasks/assistant/stream` - task/file agent для управления задачами и файлами из чата.

### Task/File Agent

Агент находится в `services/ml-service/src/services/task_file_agent`. Он принимает контекст команды и проекта, проверяет JWT и права пользователя, а затем выполняет операции через инструменты и RPC-команды в `task-service` и `file-service`.

Агент умеет:

- создавать задачи, в том числе из естественного языка;
- задавать задачам название, описание, приоритет, колонку и исполнителей;
- получать список задач и подробности конкретной задачи;
- обновлять название, описание, статус, колонку и исполнителя;
- удалять задачи;
- создавать, переименовывать, удалять и просматривать колонки;
- получать список файлов проекта;
- прикреплять файлы к задачам, откреплять их и показывать вложения.

Для простых команд создания задач и прикрепления файлов есть быстрый regex-path, поэтому агент может выполнять часть запросов напрямую, без лишнего рассуждения модели. Для более сложных сценариев используется GigaChat и tool calling. Streaming endpoint отдает события `status`, `tool_start`, `tool_end`, `token`, `final` и `error`, которые отображаются во frontend drawer.

Важные настройки агента:

- `SBER_AUTH` - авторизация GigaChat.
- `TASK_FILE_AGENT_GATEWAY_BASE_URL` - базовый URL gateway.
- `ML_SERVICE_RABBITMQ_ENABLED`, `ML_SERVICE_RABBITMQ_URL` - RabbitMQ transport.
- `TASK_SERVICE_AGENT_COMMANDS_QUEUE` - очередь команд task-service.
- `FILE_SERVICE_AGENT_COMMANDS_QUEUE` - очередь команд file-service.
- `agent_max_iterations` - лимит итераций агента.
- `gigachat_model`, `gigachat_temperature`, `gigachat_top_p`, `gigachat_max_tokens` - параметры модели.

Агент не предназначен для редактирования исходного кода проекта. Его зона ответственности - операции с задачами, колонками, исполнителями и файлами внутри выбранного проекта.

## Observability

Local и VPS compose-стеки включают self-hosted observability:

- Prometheus собирает `/metrics` с сервисов.
- Loki хранит логи.
- Promtail читает Docker/nginx-логи и отправляет их в Loki.
- Grafana автоматически получает datasources Prometheus и Loki.

## Разработка

Полезные команды:

```bash
# запустить весь локальный стенд
docker compose -f docker-compose.local.yml up --build -d

# остановить стенд
docker compose -f docker-compose.local.yml down

# тесты Go-сервисов из конкретного сервиса
go test ./...

# frontend
cd services/frontend
npm install
npm run build
```

Если меняется переменная окружения или состав сервисов в одном из compose-файлов, проверьте оба файла: `docker-compose.local.yml` и `docker-compose.vps-build.yml`.

## Структура репозитория

```text
UnifiedTaskManager/
├── README.md
├── go.work
├── docker-compose.local.yml
├── docker-compose.vps-build.yml
├── deploy/
│   ├── caddy/
│   ├── grafana/
│   ├── loki/
│   ├── nginx/
│   ├── prometheus/
│   └── promtail/
├── libs/
│   └── go/
└── services/
    ├── api-gateway/
    ├── chat-service/
    ├── file-service/
    ├── frontend/
    ├── ml-service/
    ├── notification-service/
    ├── sfu-service/
    ├── task-service/
    └── user-service/
```
