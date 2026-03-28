# Финансовый календарь

## Аккаунты

- **Email + пароль** — локальная регистрация с подтверждением email (EmailJS), пароли и коды в `sessionStorage` (см. `js/auth/auth.js`).
- **Google** — [Google Identity Services](https://developers.google.com/identity/gsi/web). В проекте Client ID задаётся в `index.html` (`window.GOOGLE_CLIENT_ID`). Это **OAuth 2.0 Client ID** (`xxxx.apps.googleusercontent.com`), а **не** API Key (`AIza...`).

  **Как получить или сменить Client ID:**

  1. [Google Cloud Console](https://console.cloud.google.com/) → ваш проект.
  2. **APIs & Services** → **Credentials** → **Create credentials** → **OAuth client ID**.
  3. Тип приложения: **Web application**.
  4. **Authorized JavaScript origins**: `http://localhost:PORT` и ваш продакшен-домен (например `https://example.com`).
  5. Скопируйте **Client ID** (именно он, не «API key» на другой вкладке).
  6. Подставьте Client ID в блок `<script>window.GOOGLE_CLIENT_ID = '...'</script>` в `<head>` файла `index.html` (уже есть — при смене проекта замените значение).

  Если вы случайно подставили API Key (`AIza...`), интерфейс покажет предупреждение — замените значение на OAuth Client ID.

  **Безопасность:** не публикуйте секреты в открытом репозитории; при утечке ключа отзовите его в Cloud Console и создайте новый.

  **Ошибка `401: invalid_client` / «no registered origin»**

  Google сравнивает адрес страницы с полем **Authorized JavaScript origins** у вашего OAuth-клиента. Если совпадения нет — вход блокируется.

  1. Откройте [Google Cloud Console](https://console.cloud.google.com/) → **APIs & Services** → **Credentials**.
  2. Нажмите на ваш **OAuth 2.0 Client ID** (тип *Web application*).
  3. В блоке **Authorized JavaScript origins** нажмите **Add URI** и добавьте **точно** тот адрес, который виден в адресной строке браузера, **без пути к файлу** и **без слэша в конце**:
     - Локально: `http://localhost:5500` **и** при необходимости `http://127.0.0.1:5500` (порт должен совпадать с вашим сервером).
     - На Cloudflare Workers / хостинге: `https://ваш-поддомен.workers.dev` или ваш кастомный домен целиком, например `https://example.com`.
  4. Сохраните (**Save**). Подождите 1–5 минут и обновите страницу с очисткой кэша при необходимости.
  5. Не открывайте приложение как `file:///...` — для Google Sign-In нужен **HTTP(S)** с зарегистрированным origin.
  6. Убедитесь, что в **OAuth consent screen** выбран тип пользователей (Internal / External) и для External при тестировании добавлены тестовые пользователи, если приложение в статусе *Testing*.

- **Apple** — Sign in with Apple для веб требует настройки в Apple Developer (Services ID, домен, ключ). В проекте есть кнопка и инструкция в `alert`; при подключении [Apple JS SDK](https://developer.apple.com/documentation/sign_in_with_apple/sign_in_with_apple_js) можно задать `window.APPLE_CLIENT_ID` и доработать обработчик в `js/auth/oauthProviders.js`.
- **Backend** — при `window.ENABLE_SERVER_AUTH = true` методы `login`, `register`, `oauth-login` и др. уходят на `/api/auth/*` (см. `tryServer` в `auth.js`).

## Облачное хранение

Модуль `js/cloud/cloudSync.js` экспортирует `window.cloudSync.push()` и `window.cloudSync.pull()`.

Пример конфигурации:

```js
window.CLOUD_SYNC = {
  apiBase: 'https://api.example.com',
  pushPath: '/v1/sync/payload',
  pullPath: '/v1/sync/payload',
  credentials: 'include',
  getAuthHeaders: function () {
    return { Authorization: 'Bearer ' + localStorage.getItem('access_token') };
  }
};
```

Контракт по умолчанию: тело `PUT` — JSON с полями `userId`, `payload` (объект ключ→строка localStorage для префикса `user_{id}_`), `updatedAt`. Ответ `GET` — тот же формат. Вы можете переопределить `pullUrl`, `pushMethod` и т.д. в объекте конфигурации.

## Политика конфиденциальности

Статическая страница: [privacy.html](./privacy.html). Ссылка добавлена в форму входа/регистрации и в меню приложения.

## Запуск

Откройте `index.html` через локальный HTTP-сервер (например `npx serve .`), чтобы корректно работали скрипты и OAuth.

## AI импорт банковской выписки PDF (Gemini)

В проекте добавлен backend endpoint:

- `POST /api/parse-bank-pdf` — принимает PDF (`multipart/form-data`, поле `statement`) и возвращает JSON операций.

### Локальный запуск

1. Установите зависимости:
   - `npm install`
2. Запустите сервер:
   - `GEMINI_API_KEY=ваш_ключ npm start`
3. Откройте:
   - `http://localhost:8080`

Опционально:

- `PORT` — порт сервера (по умолчанию `8080`)
- `GEMINI_MODEL` — модель Gemini (см. значение по умолчанию в `server.js`)

### Render и другой хостинг

Файл `.env` в репозиторий обычно **не** кладут: ключ задаётся в панели хостинга.

**Render:** откройте ваш **Web Service** → **Environment** → **Add Environment Variable** → имя `GEMINI_API_KEY`, значение — ключ из [Google AI Studio](https://aistudio.google.com/apikey). Сохраните и **вручную задеплойте** или дождитесь перезапуска, чтобы переменная попала в процесс `node server.js`.

Если ошибка «`GEMINI_API_KEY не задан на сервере`» остаётся, проверьте, что сервис запускается командой вроде `npm start` (корень репозитория с `server.js`), а не только статическая раздача `index.html` без Node.

### В UI

В меню есть пункт:

- `Импорт выписки PDF (AI)` — отправляет PDF на backend, получает распознанные операции, выполняет строгую валидацию и добавляет в календарь после подтверждения.
