// Система аутентификации и управления пользователями
// Security model:
// - Профили пользователей (без секретов) хранятся в localStorage
// - Секреты (хэши паролей, коды подтверждения/сброса) хранятся только в sessionStorage
// - При наличии backend методы используют server flow (/api/auth/*)

class AuthManager {
    constructor() {
        this.currentUser = null;
        this.userProfilesKey = 'calendar_user_profiles';
        this.currentUserKey = 'current_user';
        this.sensitiveSessionKey = 'calendar_sensitive_auth';
        this.primaryAdminEmail = 'palamarchuk.editor@gmail.com';
        this.apiBase = '/api/auth';
        this.useServerAuth = typeof window !== 'undefined' && window.ENABLE_SERVER_AUTH === true;
        this.sensitiveState = this.loadSensitiveState();
    }

    loadSensitiveState() {
        try {
            const raw = sessionStorage.getItem(this.sensitiveSessionKey);
            if (!raw) {
                return { passwordHashes: {}, verification: {}, reset: {} };
            }
            const parsed = JSON.parse(raw);
            return {
                passwordHashes: parsed.passwordHashes || {},
                verification: parsed.verification || {},
                reset: parsed.reset || {}
            };
        } catch (_e) {
            return { passwordHashes: {}, verification: {}, reset: {} };
        }
    }

    persistSensitiveState() {
        sessionStorage.setItem(this.sensitiveSessionKey, JSON.stringify(this.sensitiveState));
    }

    getAllUsers() {
        try {
            const users = localStorage.getItem(this.userProfilesKey);
            const parsed = users ? JSON.parse(users) : [];
            if (!Array.isArray(parsed)) return [];

            let changed = false;
            const normalized = parsed.map((user) => {
                const next = { ...user };
                if (!next.role) {
                    next.role = 'user';
                    changed = true;
                }
                if (typeof next.blocked !== 'boolean') {
                    next.blocked = false;
                    changed = true;
                }
                if ((next.email || '').toLowerCase() === this.primaryAdminEmail && next.role !== 'admin') {
                    next.role = 'admin';
                    changed = true;
                }
                return next;
            });

            if (normalized.length > 0 && !normalized.some((u) => u.role === 'admin')) {
                normalized[0].role = 'admin';
                changed = true;
            }

            if (changed) {
                this.saveAllUsers(normalized);
            }
            return normalized;
        } catch (_e) {
            return [];
        }
    }

    saveAllUsers(users) {
        localStorage.setItem(this.userProfilesKey, JSON.stringify(users));
    }

    isValidEmail(email) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return emailRegex.test(email);
    }

    hashPassword(password) {
        let hash = 0;
        for (let i = 0; i < password.length; i++) {
            const char = password.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash;
        }
        return hash.toString();
    }

    generateVerificationCode() {
        return Math.floor(100000 + Math.random() * 900000).toString();
    }

    async tryServer(endpoint, payload) {
        if (!this.useServerAuth) {
            return { serverAvailable: false };
        }

        try {
            const response = await fetch(`${this.apiBase}/${endpoint}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify(payload || {})
            });

            const body = await response.json().catch(() => ({}));
            // Если backend endpoint не поднят, переключаемся в локальный fallback-режим
            if (response.status === 404 || response.status === 501 || response.status === 503) {
                return { serverAvailable: false };
            }
            if (!response.ok) {
                return {
                    serverAvailable: true,
                    success: false,
                    message: body.message || 'Ошибка сервера'
                };
            }

            return {
                serverAvailable: true,
                success: Boolean(body.success),
                ...body
            };
        } catch (_e) {
            return { serverAvailable: false };
        }
    }

    async register(email, password, name) {
        const normalizedEmail = (email || '').trim().toLowerCase();
        const normalizedName = (name || '').trim();

        if (!normalizedEmail || !password || !normalizedName) {
            return { success: false, message: 'Все поля обязательны для заполнения' };
        }
        if (!this.isValidEmail(normalizedEmail)) {
            return { success: false, message: 'Неверный формат email' };
        }
        if (password.length < 6) {
            return { success: false, message: 'Пароль должен содержать минимум 6 символов' };
        }

        const serverResult = await this.tryServer('register', {
            email: normalizedEmail,
            password,
            name: normalizedName
        });
        if (serverResult.serverAvailable) {
            return serverResult;
        }

        const users = this.getAllUsers();
        if (users.find(u => u.email === normalizedEmail)) {
            return { success: false, message: 'Пользователь с таким email уже существует' };
        }

        const id = Date.now().toString();
        const user = {
            id,
            email: normalizedEmail,
            name: normalizedName,
            createdAt: new Date().toISOString(),
            emailVerified: false,
            role: users.length === 0 ? 'admin' : 'user',
            blocked: false,
            authProviders: ['email'],
            oauthSubjects: {}
        };

        users.push(user);
        this.saveAllUsers(users);

        this.sensitiveState.passwordHashes[normalizedEmail] = this.hashPassword(password);
        const code = this.generateVerificationCode();
        this.sensitiveState.verification[normalizedEmail] = {
            code,
            expiresAt: Date.now() + (24 * 60 * 60 * 1000)
        };
        this.persistSensitiveState();

        this.sendVerificationEmail(normalizedEmail, code);
        return {
            success: true,
            requiresVerification: true,
            message: 'Регистрация успешна! Проверьте почту для подтверждения email.',
            demoMode: true
        };
    }

    async verifyEmail(email, code) {
        const normalizedEmail = (email || '').trim().toLowerCase();
        const normalizedCode = (code || '').trim();

        const serverResult = await this.tryServer('verify-email', {
            email: normalizedEmail,
            code: normalizedCode
        });
        if (serverResult.serverAvailable) {
            if (serverResult.success && serverResult.user) {
                this.setCurrentUser(serverResult.user);
            }
            return serverResult;
        }

        const users = this.getAllUsers();
        const user = users.find(u => u.email === normalizedEmail);
        if (!user) {
            return { success: false, message: 'Пользователь не найден' };
        }
        if (user.emailVerified) {
            return { success: true, message: 'Email уже подтвержден' };
        }

        const verifyState = this.sensitiveState.verification[normalizedEmail];
        if (!verifyState || verifyState.code !== normalizedCode) {
            return { success: false, message: 'Неверный код подтверждения' };
        }
        if (Date.now() > verifyState.expiresAt) {
            return { success: false, message: 'Код подтверждения истек. Запросите новый.' };
        }

        user.emailVerified = true;
        this.saveAllUsers(users);
        delete this.sensitiveState.verification[normalizedEmail];
        this.persistSensitiveState();
        this.setCurrentUser(user);

        return { success: true, message: 'Email успешно подтвержден!', user };
    }

    async resendVerificationCode(email) {
        const normalizedEmail = (email || '').trim().toLowerCase();

        const serverResult = await this.tryServer('resend-verification', { email: normalizedEmail });
        if (serverResult.serverAvailable) {
            return serverResult;
        }

        const users = this.getAllUsers();
        const user = users.find(u => u.email === normalizedEmail);
        if (!user) {
            return { success: false, message: 'Пользователь не найден' };
        }
        if (user.emailVerified) {
            return { success: false, message: 'Email уже подтвержден' };
        }

        const code = this.generateVerificationCode();
        this.sensitiveState.verification[normalizedEmail] = {
            code,
            expiresAt: Date.now() + (24 * 60 * 60 * 1000)
        };
        this.persistSensitiveState();
        this.sendVerificationEmail(normalizedEmail, code);

        return { success: true, message: 'Код подтверждения отправлен на вашу почту', demoMode: true };
    }

    async requestPasswordReset(email) {
        const normalizedEmail = (email || '').trim().toLowerCase();

        const serverResult = await this.tryServer('request-password-reset', { email: normalizedEmail });
        if (serverResult.serverAvailable) {
            return serverResult;
        }

        const users = this.getAllUsers();
        const user = users.find(u => u.email === normalizedEmail);
        if (!user) {
            return {
                success: true,
                message: 'Если пользователь с таким email существует, на почту отправлена инструкция по восстановлению пароля',
                demoMode: true
            };
        }

        const code = this.generateVerificationCode();
        this.sensitiveState.reset[normalizedEmail] = {
            code,
            expiresAt: Date.now() + (60 * 60 * 1000),
            used: false
        };
        this.persistSensitiveState();
        this.sendPasswordResetEmail(normalizedEmail, code);

        return {
            success: true,
            message: 'Инструкция по восстановлению пароля отправлена на вашу почту',
            demoMode: true
        };
    }

    async resetPassword(email, code, newPassword) {
        const normalizedEmail = (email || '').trim().toLowerCase();
        const normalizedCode = (code || '').trim();

        if ((newPassword || '').length < 6) {
            return { success: false, message: 'Пароль должен содержать минимум 6 символов' };
        }

        const serverResult = await this.tryServer('reset-password', {
            email: normalizedEmail,
            code: normalizedCode,
            password: newPassword
        });
        if (serverResult.serverAvailable) {
            return serverResult;
        }

        const users = this.getAllUsers();
        const user = users.find(u => u.email === normalizedEmail);
        if (!user) {
            return { success: false, message: 'Пользователь не найден' };
        }

        const resetState = this.sensitiveState.reset[normalizedEmail];
        if (!resetState || resetState.code !== normalizedCode) {
            return { success: false, message: 'Неверный код восстановления' };
        }
        if (Date.now() > resetState.expiresAt) {
            return { success: false, message: 'Код восстановления истек. Запросите новый.' };
        }
        if (resetState.used) {
            return { success: false, message: 'Код восстановления уже использован' };
        }

        this.sensitiveState.passwordHashes[normalizedEmail] = this.hashPassword(newPassword);
        this.sensitiveState.reset[normalizedEmail].used = true;
        this.persistSensitiveState();

        return { success: true, message: 'Пароль успешно изменен!' };
    }

    async login(email, password) {
        const normalizedEmail = (email || '').trim().toLowerCase();

        const serverResult = await this.tryServer('login', {
            email: normalizedEmail,
            password
        });
        if (serverResult.serverAvailable) {
            if (serverResult.success && serverResult.user) {
                this.setCurrentUser(serverResult.user);
            }
            return serverResult;
        }

        const users = this.getAllUsers();
        const user = users.find(u => u.email === normalizedEmail);
        if (!user) {
            return { success: false, message: 'Неверный email или пароль' };
        }
        if (!user.emailVerified) {
            return {
                success: false,
                requiresVerification: true,
                email: normalizedEmail,
                message: 'Email не подтвержден'
            };
        }
        if (user.blocked) {
            return { success: false, message: 'Аккаунт заблокирован администратором' };
        }

        const storedHash = this.sensitiveState.passwordHashes[normalizedEmail];
        if (!storedHash) {
            const providers = Array.isArray(user.authProviders) ? user.authProviders : [];
            const hasOAuthProvider = providers.some(p => p === 'google' || p === 'apple' || String(p).startsWith('oauth'));
            const hasOAuthSubjects = user.oauthSubjects && Object.keys(user.oauthSubjects).length > 0;
            if (hasOAuthProvider || hasOAuthSubjects) {
                return {
                    success: false,
                    message: 'Для этого аккаунта настроен вход через Google или Apple. Используйте соответствующую кнопку.'
                };
            }
        }
        if (!storedHash || storedHash !== this.hashPassword(password || '')) {
            return { success: false, message: 'Неверный email или пароль' };
        }

        this.setCurrentUser(user);
        return { success: true, message: 'Вход выполнен успешно!', user };
    }

    /**
     * Вход / регистрация через OAuth (Google, Apple и т.д.).
     * Для production токен должен проверяться на вашем backend.
     * @param {{ email: string, name?: string, provider: string, subject: string }} profile
     */
    async loginWithOAuthProfile(profile) {
        const normalizedEmail = (profile.email || '').trim().toLowerCase();
        const provider = String(profile.provider || 'oauth').toLowerCase();
        const subject = String(profile.subject || '').trim();

        if (!normalizedEmail || !this.isValidEmail(normalizedEmail)) {
            return { success: false, message: 'Не удалось получить email из аккаунта провайдера' };
        }
        if (!subject) {
            return { success: false, message: 'Некорректные данные провайдера входа' };
        }

        const serverResult = await this.tryServer('oauth-login', {
            email: normalizedEmail,
            provider,
            subject,
            name: (profile.name || '').trim()
        });
        if (serverResult.serverAvailable) {
            if (serverResult.success && serverResult.user) {
                this.setCurrentUser(serverResult.user);
            }
            return serverResult;
        }

        const users = this.getAllUsers();
        let user = users.find(u => u.email === normalizedEmail);

        if (!user) {
            const id = `oauth_${Date.now()}_${subject.replace(/[^a-z0-9]/gi, '').slice(0, 24) || 'user'}`;
            user = {
                id,
                email: normalizedEmail,
                name: (profile.name || normalizedEmail.split('@')[0] || 'Пользователь').trim(),
                createdAt: new Date().toISOString(),
                emailVerified: true,
                role: users.length === 0 ? 'admin' : 'user',
                blocked: false,
                authProviders: [provider],
                oauthSubjects: {}
            };
            user.oauthSubjects[provider] = subject;
            users.push(user);
            this.saveAllUsers(users);
        } else {
            if (user.blocked) {
                return { success: false, message: 'Аккаунт заблокирован администратором' };
            }
            if (!user.oauthSubjects) user.oauthSubjects = {};
            if (!user.authProviders) user.authProviders = ['email'];
            user.oauthSubjects[provider] = subject;
            if (!user.authProviders.includes(provider)) {
                user.authProviders.push(provider);
            }
            if (profile.name && String(profile.name).trim()) {
                user.name = String(profile.name).trim();
            }
            user.emailVerified = true;
            this.saveAllUsers(users);
        }

        this.setCurrentUser(user);
        return { success: true, message: 'Вход выполнен', user };
    }

    async loginWithoutCredentials() {
        const guestUser = {
            id: `guest_${Date.now()}`,
            email: 'guest@local',
            name: 'Гостевой пользователь',
            createdAt: new Date().toISOString(),
            emailVerified: true
        };

        this.setCurrentUser(guestUser);
        return { success: true, message: 'Гостевой вход выполнен', user: guestUser };
    }

    setCurrentUser(user) {
        const userData = {
            id: user.id,
            email: user.email,
            name: user.name,
            createdAt: user.createdAt,
            emailVerified: Boolean(user.emailVerified),
            role: user.role || 'user',
            blocked: Boolean(user.blocked)
        };
        sessionStorage.setItem(this.currentUserKey, JSON.stringify(userData));
        this.currentUser = userData;
    }

    isCurrentUserAdmin() {
        const user = this.getCurrentUser();
        if (!user) return false;
        if (user.role === 'admin') return true;

        const users = this.getAllUsers();
        const full = users.find((u) => u.id === user.id || u.email === user.email);
        if (!full) return false;

        if (full.role === 'admin' && user.role !== 'admin') {
            this.setCurrentUser(full);
        }
        return full.role === 'admin';
    }

    listUsersForAdmin() {
        if (!this.isCurrentUserAdmin()) {
            return { success: false, message: 'Недостаточно прав', users: [] };
        }
        const users = this.getAllUsers().map((u) => ({
            id: u.id,
            name: u.name || 'Пользователь',
            email: u.email || '',
            role: u.role || 'user',
            blocked: Boolean(u.blocked),
            emailVerified: Boolean(u.emailVerified),
            createdAt: u.createdAt || null
        }));
        return { success: true, users };
    }

    adminSetUserRole(targetUserId, role) {
        if (!this.isCurrentUserAdmin()) {
            return { success: false, message: 'Недостаточно прав' };
        }
        if (!['admin', 'user'].includes(role)) {
            return { success: false, message: 'Некорректная роль' };
        }
        const current = this.getCurrentUser();
        const users = this.getAllUsers();
        const target = users.find((u) => u.id === targetUserId);
        if (!target) return { success: false, message: 'Пользователь не найден' };

        target.role = role;
        if (current && current.id === target.id) {
            this.setCurrentUser(target);
        }
        this.saveAllUsers(users);
        return { success: true, message: 'Роль обновлена' };
    }

    adminSetUserBlocked(targetUserId, blocked) {
        if (!this.isCurrentUserAdmin()) {
            return { success: false, message: 'Недостаточно прав' };
        }
        const current = this.getCurrentUser();
        if (current && current.id === targetUserId) {
            return { success: false, message: 'Нельзя изменить блокировку для текущего администратора' };
        }
        const users = this.getAllUsers();
        const target = users.find((u) => u.id === targetUserId);
        if (!target) return { success: false, message: 'Пользователь не найден' };

        target.blocked = Boolean(blocked);
        this.saveAllUsers(users);
        return { success: true, message: blocked ? 'Пользователь заблокирован' : 'Пользователь разблокирован' };
    }

    adminDeleteUser(targetUserId) {
        if (!this.isCurrentUserAdmin()) {
            return { success: false, message: 'Недостаточно прав' };
        }
        const current = this.getCurrentUser();
        if (current && current.id === targetUserId) {
            return { success: false, message: 'Нельзя удалить текущего пользователя' };
        }
        const users = this.getAllUsers();
        const target = users.find((u) => u.id === targetUserId);
        if (!target) return { success: false, message: 'Пользователь не найден' };

        const filtered = users.filter((u) => u.id !== targetUserId);
        if (target.role === 'admin' && !filtered.some((u) => u.role === 'admin') && filtered.length > 0) {
            filtered[0].role = 'admin';
        }
        this.saveAllUsers(filtered);
        return { success: true, message: 'Пользователь удален' };
    }

    logout() {
        sessionStorage.removeItem(this.currentUserKey);
        this.currentUser = null;
    }

    getCurrentUser() {
        if (this.currentUser) return this.currentUser;
        try {
            const userData = sessionStorage.getItem(this.currentUserKey);
            if (!userData) return null;
            this.currentUser = JSON.parse(userData);
            return this.currentUser;
        } catch (_e) {
            return null;
        }
    }

    isAuthenticated() {
        return this.getCurrentUser() !== null;
    }

    getUserDataKey(key) {
        const user = this.getCurrentUser();
        if (!user) return null;
        return `user_${user.id}_${key}`;
    }

    getUserData(key, defaultValue = null) {
        const dataKey = this.getUserDataKey(key);
        if (!dataKey) return defaultValue;
        try {
            const item = localStorage.getItem(dataKey);
            return item ? JSON.parse(item) : defaultValue;
        } catch (_e) {
            return defaultValue;
        }
    }

    setUserData(key, value) {
        const dataKey = this.getUserDataKey(key);
        if (!dataKey) return false;
        try {
            localStorage.setItem(dataKey, JSON.stringify(value));
            return true;
        } catch (_e) {
            return false;
        }
    }

    removeUserData(key) {
        const dataKey = this.getUserDataKey(key);
        if (!dataKey) return false;
        try {
            localStorage.removeItem(dataKey);
            return true;
        } catch (_e) {
            return false;
        }
    }

    sendVerificationEmail(email, code) {
        if (!email || !email.trim()) return;
        if (typeof emailjs === 'undefined' || !window.emailjsReady || typeof emailjs.send !== 'function') return;

        const safeEmail = email.trim().toLowerCase();
        const userName = safeEmail.split('@')[0] || 'Пользователь';
        const codeStr = String(code);
        const subject = 'Подтверждение email - Финансовый календарь';
        const textBody = `Ваш код подтверждения email: ${codeStr}`;

        const templateParams = {
            // Часто используемые поля в EmailJS шаблонах
            to_email: safeEmail,
            email: safeEmail,
            to_name: userName,
            user_name: userName,
            name: userName,
            recipient: safeEmail,
            // Возможные имена переменных для кода
            verification_code: codeStr,
            confirm_code: codeStr,
            reset_code: codeStr,
            code: codeStr,
            otp: codeStr,
            // Возможные имена переменных для текста письма
            subject,
            title: subject,
            message: textBody,
            body: textBody,
            body_text: textBody,
            html_message: `<p>Здравствуйте, ${userName}!</p><p>Ваш код подтверждения: <strong>${codeStr}</strong></p>`,
            // Поля отправителя/ответа, которые часто требуются в шаблоне
            from_name: 'Финансовый календарь',
            from_email: 'no-reply@financial-calendar.local',
            reply_to: safeEmail
        };

        emailjs.send('bussines-celendar', 'template_gplvjlg', templateParams).catch(() => {
            // Секреты не логируем и не сохраняем в localStorage
        });
    }

    sendPasswordResetEmail(email, code) {
        if (!email || !email.trim()) return;
        if (typeof emailjs === 'undefined' || !window.emailjsReady || typeof emailjs.send !== 'function') return;

        const safeEmail = email.trim().toLowerCase();
        const userName = safeEmail.split('@')[0] || 'Пользователь';
        const codeStr = String(code);
        const subject = 'Восстановление пароля - Финансовый календарь';
        const textBody = `Ваш код восстановления пароля: ${codeStr}. Код действителен 1 час.`;

        const templateParams = {
            // Часто используемые поля в EmailJS шаблонах
            to_email: safeEmail,
            email: safeEmail,
            to_name: userName,
            user_name: userName,
            name: userName,
            recipient: safeEmail,
            // Возможные имена переменных для кода
            reset_code: codeStr,
            verification_code: codeStr,
            code: codeStr,
            otp: codeStr,
            // Возможные имена переменных для текста письма
            subject,
            title: subject,
            message: textBody,
            body: textBody,
            body_text: textBody,
            html_message: `<p>Здравствуйте, ${userName}!</p><p>Ваш код восстановления: <strong>${codeStr}</strong></p><p>Код действителен 1 час.</p>`,
            // Поля отправителя/ответа, которые часто требуются в шаблоне
            from_name: 'Финансовый календарь',
            from_email: 'no-reply@financial-calendar.local',
            reply_to: safeEmail
        };

        emailjs.send('bussines-celendar', 'template_gplvjlg', templateParams).catch(() => {
            // Секреты не логируем и не сохраняем в localStorage
        });
    }
}

const authManager = new AuthManager();

if (typeof window !== 'undefined') {
    window.authManager = authManager;
}
