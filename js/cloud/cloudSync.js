/**
 * Облачная синхронизация данных пользователя (опционально).
 *
 * Задайте перед загрузкой страницы или в консоли:
 *   window.CLOUD_SYNC = {
 *     apiBase: 'https://your-api.example.com',  // без завершающего /
 *     getAuthHeaders: function() { return { Authorization: 'Bearer ...' }; }
 *   };
 *
 * Ожидаемые эндпоинты на backend (пример контракта):
 *   PUT  {apiBase}/v1/sync/payload  — тело JSON { userId, payload, updatedAt }
 *   GET  {apiBase}/v1/sync/payload?userId=...
 *
 * Без настроенного apiBase кнопки покажут подсказку (локальное хранение без изменений).
 */
(function () {
    'use strict';

    function getConfig() {
        return window.CLOUD_SYNC && typeof window.CLOUD_SYNC === 'object' ? window.CLOUD_SYNC : null;
    }

    function collectUserPayload() {
        var auth = window.authManager;
        if (!auth || !auth.getCurrentUser()) {
            return null;
        }
        var user = auth.getCurrentUser();
        var prefix = 'user_' + user.id + '_';
        var keys = [];
        try {
            for (var i = 0; i < localStorage.length; i++) {
                var k = localStorage.key(i);
                if (k && k.indexOf(prefix) === 0) keys.push(k);
            }
        } catch (_e) {}
        var payload = {};
        keys.forEach(function (key) {
            try {
                payload[key] = localStorage.getItem(key);
            } catch (_e) {}
        });
        return {
            userId: user.id,
            email: user.email,
            updatedAt: new Date().toISOString(),
            keys: keys,
            payload: payload
        };
    }

    function mergePayload(data) {
        if (!data || !data.payload || typeof data.payload !== 'object') return false;
        try {
            Object.keys(data.payload).forEach(function (key) {
                var val = data.payload[key];
                if (typeof val === 'string') localStorage.setItem(key, val);
            });
            return true;
        } catch (_e) {
            return false;
        }
    }

    async function pushToCloud() {
        var cfg = getConfig();
        if (!cfg || !cfg.apiBase) {
            alert(
                'Облако не настроено.\n\nЗадайте window.CLOUD_SYNC = { apiBase: "https://...", getAuthHeaders: () => ({}) } и реализуйте API на сервере. См. js/cloud/cloudSync.js и README.'
            );
            return { ok: false };
        }
        var body = collectUserPayload();
        if (!body) {
            alert('Войдите в аккаунт, чтобы синхронизировать данные.');
            return { ok: false };
        }
        var headers = { 'Content-Type': 'application/json' };
        if (typeof cfg.getAuthHeaders === 'function') {
            Object.assign(headers, cfg.getAuthHeaders() || {});
        }
        try {
            var url = cfg.apiBase.replace(/\/$/, '') + (cfg.pushPath || '/v1/sync/payload');
            var res = await fetch(url, {
                method: cfg.pushMethod || 'PUT',
                headers: headers,
                body: JSON.stringify(body),
                credentials: cfg.credentials || 'omit'
            });
            if (!res.ok) {
                throw new Error('HTTP ' + res.status);
            }
            if (typeof window.showNotification === 'function') {
                window.showNotification('Данные отправлены в облако');
            } else {
                alert('Данные отправлены в облако');
            }
            return { ok: true };
        } catch (e) {
            alert('Ошибка отправки в облако: ' + (e.message || e));
            return { ok: false };
        }
    }

    async function pullFromCloud() {
        var cfg = getConfig();
        if (!cfg || !cfg.apiBase) {
            alert('Облако не настроено. См. README и js/cloud/cloudSync.js');
            return { ok: false };
        }
        var auth = window.authManager;
        if (!auth || !auth.getCurrentUser()) {
            alert('Войдите в аккаунт.');
            return { ok: false };
        }
        var user = auth.getCurrentUser();
        var headers = { Accept: 'application/json' };
        if (typeof cfg.getAuthHeaders === 'function') {
            Object.assign(headers, cfg.getAuthHeaders() || {});
        }
        try {
            var base = cfg.apiBase.replace(/\/$/, '');
            var url =
                (cfg.pullUrl && cfg.pullUrl.replace('{userId}', encodeURIComponent(user.id))) ||
                base + (cfg.pullPath || '/v1/sync/payload') + '?userId=' + encodeURIComponent(user.id);
            var res = await fetch(url, {
                method: 'GET',
                headers: headers,
                credentials: cfg.credentials || 'omit'
            });
            if (!res.ok) throw new Error('HTTP ' + res.status);
            var data = await res.json();
            if (mergePayload(data)) {
                if (typeof window.initApp === 'function') window.initApp();
                if (typeof window.showNotification === 'function') {
                    window.showNotification('Данные загружены из облака');
                } else {
                    alert('Данные загружены из облака');
                }
                return { ok: true };
            }
            throw new Error('Пустой или неверный ответ');
        } catch (e) {
            alert('Ошибка загрузки из облака: ' + (e.message || e));
            return { ok: false };
        }
    }

    window.cloudSync = {
        push: pushToCloud,
        pull: pullFromCloud,
        collectUserPayload: collectUserPayload
    };
})();
