/**
 * OAuth: Google (Google Identity Services) и заглушка Apple.
 *
 * Настройка Google: задайте OAuth 2.0 Client ID (НЕ API Key вида AIza...):
 *   window.GOOGLE_CLIENT_ID = 'ВАШ.apps.googleusercontent.com';
 * Создание: Google Cloud Console → APIs & Services → Credentials → Create credentials → OAuth client ID → Web application.
 *
 * Apple Sign In на веб требует Apple Developer (Services ID, домен, ключи).
 * Кнопка откроет подсказку; при наличии window.APPLE_CLIENT_ID можно доработать SDK.
 */
(function () {
    'use strict';

    var googleInitialized = false;
    var appleBound = false;

    function parseJwtPayload(token) {
        if (!token || typeof token !== 'string') return null;
        try {
            const parts = token.split('.');
            if (parts.length < 2) return null;
            const base64Url = parts[1];
            const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
            const json = decodeURIComponent(
                atob(base64)
                    .split('')
                    .map(function (c) {
                        return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
                    })
                    .join('')
            );
            return JSON.parse(json);
        } catch (_e) {
            return null;
        }
    }

    function loadScript(src) {
        return new Promise(function (resolve, reject) {
            if (document.querySelector('script[src="' + src + '"]')) {
                resolve();
                return;
            }
            var s = document.createElement('script');
            s.src = src;
            s.async = true;
            s.defer = true;
            s.onload = function () {
                resolve();
            };
            s.onerror = function () {
                reject(new Error('Не удалось загрузить ' + src));
            };
            document.head.appendChild(s);
        });
    }

    async function handleGoogleCredential(response) {
        if (!response || !response.credential) {
            return { success: false, message: 'Пустой ответ Google' };
        }
        var payload = parseJwtPayload(response.credential);
        if (!payload || !payload.email) {
            return { success: false, message: 'Не удалось прочитать профиль Google' };
        }
        if (!window.authManager || typeof window.authManager.loginWithOAuthProfile !== 'function') {
            return { success: false, message: 'Модуль авторизации не загружен' };
        }
        return window.authManager.loginWithOAuthProfile({
            email: payload.email,
            name: payload.name || payload.given_name || '',
            provider: 'google',
            subject: payload.sub || payload.email
        });
    }

    function isLikelyGoogleApiKey(value) {
        return typeof value === 'string' && value.indexOf('AIza') === 0 && value.length > 20;
    }

    async function initGoogleSignIn() {
        var holder = document.getElementById('googleSignInButton');
        if (!holder || googleInitialized) return;

        var host = (location && location.hostname) ? location.hostname : '';
        var isLocalHost = host === 'localhost' || host === '127.0.0.1';
        if (isLocalHost && window.ENABLE_GOOGLE_ON_LOCALHOST !== true) {
            holder.innerHTML =
                '<p class="oauth-hint oauth-hint--warn">Google вход на localhost отключен по умолчанию, чтобы избежать ошибок origin. ' +
                'Добавьте текущий origin в Google Cloud OAuth Client и задайте <code>window.ENABLE_GOOGLE_ON_LOCALHOST = true</code> для включения.</p>';
            return;
        }

        var clientId = typeof window.GOOGLE_CLIENT_ID === 'string' ? window.GOOGLE_CLIENT_ID.trim() : '';
        if (!clientId) {
            holder.innerHTML =
                '<p class="oauth-hint">Google: задайте <code>window.GOOGLE_CLIENT_ID</code> (OAuth Client ID, не API Key). См. README.</p>';
            return;
        }

        if (isLikelyGoogleApiKey(clientId)) {
            holder.innerHTML =
                '<p class="oauth-hint oauth-hint--warn">Указан <strong>API Key</strong> (начинается с <code>AIza...</code>). Для входа через Google нужен <strong>OAuth 2.0 Client ID</strong> вида <code>xxxx.apps.googleusercontent.com</code>. Создайте его в Google Cloud → Credentials → OAuth client ID → Web application и подставьте в <code>window.GOOGLE_CLIENT_ID</code>.</p>';
            return;
        }

        if (clientId.indexOf('.apps.googleusercontent.com') === -1 && clientId.indexOf('googleusercontent') === -1) {
            holder.innerHTML =
                '<p class="oauth-hint oauth-hint--warn">Похоже, это не OAuth Client ID. Ожидается строка вида <code>xxx.apps.googleusercontent.com</code>.</p>';
            return;
        }

        googleInitialized = true;

        try {
            await loadScript('https://accounts.google.com/gsi/client');
        } catch (e) {
            googleInitialized = false;
            holder.innerHTML = '<p class="oauth-hint">Не удалось загрузить Google Sign-In</p>';
            return;
        }

        if (typeof google === 'undefined' || !google.accounts || !google.accounts.id) {
            googleInitialized = false;
            holder.innerHTML = '<p class="oauth-hint">Google Sign-In недоступен</p>';
            return;
        }

        google.accounts.id.initialize({
            client_id: clientId,
            callback: function (response) {
                handleGoogleCredential(response).then(function (result) {
                    if (result.success && window.authUI && typeof window.authUI.onOAuthSuccess === 'function') {
                        window.authUI.onOAuthSuccess(result);
                    } else if (!result.success && window.authUI && typeof window.authUI.showError === 'function') {
                        window.authUI.showError('loginError', result.message || 'Ошибка входа Google');
                    }
                });
            },
            auto_select: false,
            itp_support: true,
            // FedCM + строгие политики COOP часто дают "COOP would block postMessage" в консоли;
            // классический поток без FedCM стабильнее на shared-хостингах (Render и т.д.).
            use_fedcm_for_prompt: false
        });

        holder.innerHTML = '';
        google.accounts.id.renderButton(holder, {
            theme: 'outline',
            size: 'large',
            width: 280,
            text: 'signin_with',
            locale: 'ru'
        });
    }

    function initAppleButton() {
        var btn = document.getElementById('appleSignInBtn');
        if (!btn || appleBound) return;
        appleBound = true;
        btn.addEventListener('click', function () {
            if (window.APPLE_CLIENT_ID && typeof window.AppleID !== 'undefined' && window.AppleID.auth) {
                window.AppleID.auth
                    .signIn()
                    .then(function (res) {
                        var idToken = res && res.authorization && res.authorization.id_token;
                        var payload = parseJwtPayload(idToken);
                        if (!payload || !payload.email) {
                            if (window.authUI) window.authUI.showError('loginError', 'Apple: не удалось получить email');
                            return;
                        }
                        window.authManager
                            .loginWithOAuthProfile({
                                email: payload.email,
                                name: payload.name || '',
                                provider: 'apple',
                                subject: payload.sub || payload.email
                            })
                            .then(function (result) {
                                if (result.success && window.authUI) window.authUI.onOAuthSuccess(result);
                                else if (window.authUI) window.authUI.showError('loginError', result.message);
                            });
                    })
                    .catch(function () {
                        if (window.authUI) window.authUI.showError('loginError', 'Вход через Apple отменён');
                    });
                return;
            }
            alert(
                'Вход через Apple для веб требует настройки в Apple Developer (Services ID, домен, ключ Sign in with Apple).\n\n' +
                    'Подключите Apple JavaScript SDK и задайте window.APPLE_CLIENT_ID, либо используйте ваш backend OAuth.\n' +
                    'Подробности: README проекта (раздел OAuth / Apple).'
            );
        });
    }

    window.initOAuthProviders = function () {
        initGoogleSignIn();
        initAppleButton();
    };
})();
