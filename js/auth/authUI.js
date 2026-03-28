// UI для системы аутентификации

// Получаем authManager из глобального scope (загружается через script тег)
// Функция для получения authManager с проверкой доступности
function getAuthManager() {
    if (typeof window !== 'undefined' && window.authManager) {
        return window.authManager;
    }
    // Если authManager еще не загружен, ждем
    return null;
}

// authManager будет доступен через window после загрузки auth.js

window.updateModalScrollLock = function () {
    const open = Array.from(document.querySelectorAll('.modal, .auth-modal')).some(
        (el) => window.getComputedStyle(el).display !== 'none'
    );
    if (open) {
        const gutter = window.innerWidth - document.documentElement.clientWidth;
        document.body.style.overflow = 'hidden';
        document.body.style.paddingRight = gutter > 0 ? `${gutter}px` : '';
    } else {
        document.body.style.overflow = '';
        document.body.style.paddingRight = '';
    }
};

class AuthUI {
    constructor() {
        // Получаем authManager при создании
        this.authManager = getAuthManager();
        this.authModal = null;
        this.loginForm = null;
        this.registerForm = null;
        this.init();
    }

    init() {
        // Ждем загрузки DOM
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => {
                this.setupUI();
                this.initPasswordToggles();
            });
        } else {
            this.setupUI();
            this.initPasswordToggles();
        }
    }

    escapeHtml(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    // Инициализация кнопок показа/скрытия пароля
    initPasswordToggles() {
        const toggleButtons = document.querySelectorAll('.password-toggle');
        toggleButtons.forEach(button => {
            button.addEventListener('click', (e) => {
                e.preventDefault();
                const targetId = button.getAttribute('data-target');
                const passwordInput = document.getElementById(targetId);
                
                if (!passwordInput) return;
                
                const icon = button.querySelector('i');
                if (passwordInput.type === 'password') {
                    passwordInput.type = 'text';
                    if (icon) {
                        icon.classList.remove('fa-eye');
                        icon.classList.add('fa-eye-slash');
                    }
                } else {
                    passwordInput.type = 'password';
                    if (icon) {
                        icon.classList.remove('fa-eye-slash');
                        icon.classList.add('fa-eye');
                    }
                }
            });
        });
    }

    setupUI() {
        this.authModal = document.getElementById('authModal');
        this.loginForm = document.getElementById('loginFormElement');
        this.registerForm = document.getElementById('registerFormElement');

        // Проверяем авторизацию при загрузке
        this.checkAuth();

        // Обработчики табов
        document.querySelectorAll('.auth-tab').forEach(tab => {
            tab.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                // Используем currentTarget или closest для получения правильного элемента
                const tabElement = e.currentTarget || e.target.closest('.auth-tab');
                const tabName = tabElement ? tabElement.dataset.tab : null;
                if (tabName) {
                    this.switchTab(tabName);
                }
            });
        });

        // Обработчики форм
        if (this.loginForm) {
            this.loginForm.addEventListener('submit', (e) => this.handleLogin(e));
        }
        const quickLoginBtn = document.getElementById('quickLoginBtn');
        if (quickLoginBtn) {
            quickLoginBtn.addEventListener('click', () => this.handleQuickLogin());
        }

        if (this.registerForm) {
            this.registerForm.addEventListener('submit', (e) => this.handleRegister(e));
        }

        // Обработчик выхода
        const logoutBtn = document.getElementById('logoutBtn');
        if (logoutBtn) {
            logoutBtn.addEventListener('click', () => this.handleLogout());
        }

        // Обработчик личного кабинета
        const profileBtn = document.getElementById('profileBtn');
        if (profileBtn) {
            profileBtn.addEventListener('click', () => this.showAccountPopup());
        }

        const openAdminPanelBtn = document.getElementById('openAdminPanelBtn');
        if (openAdminPanelBtn) {
            openAdminPanelBtn.addEventListener('click', (e) => {
                e.preventDefault();
                this.openAdminPanel();
            });
        }

        const accountPopupModal = document.getElementById('accountPopupModal');
        if (accountPopupModal) {
            accountPopupModal.addEventListener('click', (event) => {
                if (event.target === accountPopupModal) {
                    this.closeAccountPopup();
                }
            });
        }

        // Обработчики восстановления пароля
        const forgotPasswordLink = document.getElementById('forgotPasswordLink');
        if (forgotPasswordLink) {
            forgotPasswordLink.addEventListener('click', (e) => {
                e.preventDefault();
                this.switchTab('forgotPassword');
            });
        }

        const backToLoginLink = document.getElementById('backToLoginLink');
        if (backToLoginLink) {
            backToLoginLink.addEventListener('click', (e) => {
                e.preventDefault();
                this.switchTab('login');
            });
        }

        const forgotPasswordForm = document.getElementById('forgotPasswordFormElement');
        if (forgotPasswordForm) {
            forgotPasswordForm.addEventListener('submit', (e) => this.handleForgotPassword(e));
        }

        const resetPasswordForm = document.getElementById('resetPasswordFormElement');
        if (resetPasswordForm) {
            resetPasswordForm.addEventListener('submit', (e) => this.handleResetPassword(e));
        }

        const backToLoginFromResetLink = document.getElementById('backToLoginFromResetLink');
        if (backToLoginFromResetLink) {
            backToLoginFromResetLink.addEventListener('click', (e) => {
                e.preventDefault();
                this.switchTab('login');
            });
        }

        // Обработчики подтверждения email
        const verifyEmailForm = document.getElementById('verifyEmailFormElement');
        if (verifyEmailForm) {
            verifyEmailForm.addEventListener('submit', (e) => this.handleVerifyEmail(e));
        }

        const resendCodeLink = document.getElementById('resendCodeLink');
        if (resendCodeLink) {
            resendCodeLink.addEventListener('click', (e) => {
                e.preventDefault();
                this.handleResendCode();
            });
        }

        // Делаем authManager доступным глобально
        window.authManager = authManager;
        window.authUI = authUI;

        document.addEventListener('keydown', (event) => this.handleModalKeyboard(event));

        if (typeof window.initOAuthProviders === 'function') {
            setTimeout(() => window.initOAuthProviders(), 0);
        }
    }

    onOAuthSuccess() {
        this.clearErrors();
        this.clearSuccess();
        setTimeout(() => {
            this.showMainApp();
            if (typeof window.initApp === 'function') {
                window.initApp();
            } else if (typeof initApp === 'function') {
                initApp();
            }
        }, 200);
    }

    checkAuth() {
        if (this.authManager && this.authManager.isAuthenticated()) {
            this.showMainApp();
        } else {
            this.showAuthModal();
        }
    }

    showAuthModal() {
        if (this.authModal) {
            this.authModal.style.display = 'flex';
        }
        const mainContainer = document.getElementById('mainContainer');
        if (mainContainer) {
            mainContainer.style.display = 'none';
        }
        window.updateModalScrollLock();
    }

    showMainApp() {
        if (this.authModal) {
            this.authModal.style.display = 'none';
        }
        const mainContainer = document.getElementById('mainContainer');
        if (mainContainer) {
            mainContainer.style.display = 'block';
        }
        this.updateUserInfo();
        window.updateModalScrollLock();
    }

    switchTab(tab) {
        console.log('Переключение на таб:', tab);
        
        if (!tab) {
            console.error('Таб не указан');
            return;
        }
        
        // Обновляем активные табы (скрываем если это не стандартный таб)
        const standardTabs = ['login', 'register'];
        const allTabs = document.querySelectorAll('.auth-tab');
        allTabs.forEach(t => {
            if (t.dataset.tab === tab && standardTabs.includes(tab)) {
                t.classList.add('active');
            } else {
                t.classList.remove('active');
            }
        });
        
        // Скрываем все формы
        document.querySelectorAll('.auth-form').forEach(f => {
            f.classList.remove('active');
            f.style.display = 'none';
        });

        // Показываем нужную форму
        const formId = `${tab}Form`;
        const form = document.getElementById(formId);
        if (form) {
            form.classList.add('active');
            form.style.display = 'block';
            console.log('✅ Форма показана:', formId);
        } else {
            console.error('❌ Форма не найдена:', formId);
            // Если форма не найдена, показываем форму входа
            const loginForm = document.getElementById('loginForm');
            if (loginForm) {
                loginForm.classList.add('active');
                loginForm.style.display = 'block';
            }
        }

        // Очищаем ошибки и сообщения успеха
        this.clearErrors();
        this.clearSuccess();
    }

    async handleLogin(e) {
        e.preventDefault();
        this.clearErrors();
        this.clearSuccess();

        const email = document.getElementById('loginEmail').value;
        const password = document.getElementById('loginPassword').value;

        const result = await this.authManager.login(email, password);

        if (result.success) {
            this.showSuccess('Вход выполнен успешно!');
            setTimeout(() => {
                this.showMainApp();
                // Перезагружаем данные приложения
                if (typeof window.initApp === 'function') {
                    window.initApp();
                } else if (typeof initApp === 'function') {
                    initApp();
                }
            }, 500);
        } else {
            if (result.requiresVerification) {
                // Показываем форму подтверждения email
                const verifyEmailInput = document.getElementById('verifyEmail');
                if (verifyEmailInput) {
                    verifyEmailInput.value = result.email;
                }
                this.switchTab('verifyEmail');
                this.showError('loginError', 'Email не подтвержден. Пожалуйста, подтвердите email.');
            } else {
                this.showError('loginError', result.message);
            }
        }
    }

    async handleQuickLogin() {
        this.clearErrors();
        this.clearSuccess();

        if (!this.authManager || typeof this.authManager.loginWithoutCredentials !== 'function') {
            this.showError('loginError', 'Быстрый вход временно недоступен');
            return;
        }

        const result = await this.authManager.loginWithoutCredentials();
        if (!result.success) {
            this.showError('loginError', result.message || 'Не удалось выполнить быстрый вход');
            return;
        }

        this.showMainApp();
        if (typeof window.initApp === 'function') {
            window.initApp();
        } else if (typeof initApp === 'function') {
            initApp();
        }
    }

    async handleForgotPassword(e) {
        e.preventDefault();
        this.clearErrors();
        this.clearSuccess();

        const emailInput = document.getElementById('forgotEmail');
        if (!emailInput) {
            console.error('❌ Поле forgotEmail не найдено');
            this.showError('forgotPasswordError', 'Ошибка формы. Обновите страницу.');
            return;
        }

        const email = emailInput.value.trim();
        
        if (!email) {
            this.showError('forgotPasswordError', 'Введите email адрес');
            return;
        }

        if (!this.authManager) {
            console.error('❌ authManager не доступен');
            this.showError('forgotPasswordError', 'Ошибка системы. Попробуйте позже.');
            return;
        }

        const result = await this.authManager.requestPasswordReset(email);

        if (result.success) {
            this.showSuccess('forgotPasswordSuccess', result.message);
            
            // Заполняем email в форме сброса пароля
            const resetEmailInput = document.getElementById('resetEmail');
            if (resetEmailInput) {
                resetEmailInput.value = email;
            }
            
            // Переключаемся на форму сброса пароля через 1 секунду
            setTimeout(() => {
                this.switchTab('resetPassword');
            }, 1000);
        } else {
            this.showError('forgotPasswordError', result.message);
        }
    }

    async handleResetPassword(e) {
        e.preventDefault();
        this.clearErrors();
        this.clearSuccess();

        const emailInput = document.getElementById('resetEmail');
        const codeInput = document.getElementById('resetCode');
        const newPasswordInput = document.getElementById('newPassword');
        const confirmPasswordInput = document.getElementById('confirmNewPassword');

        if (!emailInput || !codeInput || !newPasswordInput || !confirmPasswordInput) {
            console.error('❌ Не все поля формы найдены');
            this.showError('resetPasswordError', 'Ошибка формы. Обновите страницу.');
            return;
        }

        const email = emailInput.value.trim();
        const code = codeInput.value.trim();
        const newPassword = newPasswordInput.value;
        const confirmPassword = confirmPasswordInput.value;

        // Валидация
        if (!email) {
            this.showError('resetPasswordError', 'Email не указан');
            return;
        }

        if (!code || code.length !== 6) {
            this.showError('resetPasswordError', 'Введите 6-значный код');
            return;
        }

        if (newPassword.length < 6) {
            this.showError('resetPasswordError', 'Пароль должен содержать минимум 6 символов');
            return;
        }

        if (newPassword !== confirmPassword) {
            this.showError('resetPasswordError', 'Пароли не совпадают');
            return;
        }

        if (!this.authManager) {
            console.error('❌ authManager не доступен');
            this.showError('resetPasswordError', 'Ошибка системы. Попробуйте позже.');
            return;
        }

        const result = await this.authManager.resetPassword(email, code, newPassword);

        if (result.success) {
            // Показываем сообщение об успехе
            const successDiv = document.createElement('div');
            successDiv.id = 'resetPasswordSuccess';
            successDiv.className = 'success-message';
            successDiv.textContent = result.message;
            successDiv.style.display = 'block';
            const resetForm = document.getElementById('resetPasswordForm');
            if (resetForm) {
                const existingSuccess = resetForm.querySelector('#resetPasswordSuccess');
                if (existingSuccess) existingSuccess.remove();
                resetForm.appendChild(successDiv);
            }

            // Очищаем форму
            codeInput.value = '';
            newPasswordInput.value = '';
            confirmPasswordInput.value = '';

            // Переключаемся на форму входа через 1.5 секунды
            setTimeout(() => {
                this.switchTab('login');
                const loginEmailInput = document.getElementById('loginEmail');
                if (loginEmailInput) {
                    loginEmailInput.value = email;
                }
            }, 1500);
        } else {
            this.showError('resetPasswordError', result.message);
        }
    }

    async handleVerifyEmail(e) {
        e.preventDefault();
        this.clearErrors();

        const email = document.getElementById('verifyEmail').value;
        const code = document.getElementById('verifyCode').value;

        const result = await this.authManager.verifyEmail(email, code);

        if (result.success) {
            this.showSuccess('verifyEmailSuccess', result.message);
            setTimeout(() => {
                this.showMainApp();
                if (typeof window.initApp === 'function') {
                    window.initApp();
                } else if (typeof initApp === 'function') {
                    initApp();
                }
            }, 1500);
        } else {
            this.showError('verifyEmailError', result.message);
        }
    }

    async handleResendCode() {
        this.clearErrors();
        this.clearSuccess();
        
        const verifyEmailInput = document.getElementById('verifyEmail');
        if (!verifyEmailInput || !verifyEmailInput.value) {
            this.showError('verifyEmailError', 'Email не указан');
            return;
        }

        const email = verifyEmailInput.value;
        const result = await this.authManager.resendVerificationCode(email);
        
        if (result.success) {
            const successEl = document.getElementById('verifyEmailSuccess');
            if (successEl) {
                successEl.textContent = result.message;
                successEl.style.display = 'block';
            }
        } else {
            this.showError('verifyEmailError', result.message);
        }
    }

    showProfile() {
        this.closeAccountPopup();

        const user = this.authManager.getCurrentUser();
        if (!user) return;

        const profileModal = document.getElementById('profileModal');
        if (!profileModal) return;

        // Заполняем данные профиля
        document.getElementById('profileName').textContent = user.name || 'Пользователь';
        document.getElementById('profileEmail').textContent = user.email;
        
        if (user.createdAt) {
            const date = new Date(user.createdAt);
            document.getElementById('profileDate').textContent = `Дата регистрации: ${date.toLocaleDateString('ru-RU')}`;
        } else {
            document.getElementById('profileDate').textContent = 'Дата регистрации: -';
        }

        const statusBadge = document.getElementById('profileStatus');
        if (user.emailVerified) {
            statusBadge.textContent = '✓ Email подтвержден';
            statusBadge.className = 'status-badge verified';
        } else {
            statusBadge.textContent = '✗ Email не подтвержден';
            statusBadge.className = 'status-badge unverified';
        }

        // Подсчитываем статистику пользователя
        this.updateProfileStats(user);

        // Загружаем список пользователей для переключения
        this.loadUsersList();
        this.loadAdminPanel();

        profileModal.style.display = 'flex';
        const firstButton = profileModal.querySelector('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
        if (firstButton) {
            firstButton.focus();
        }
        window.updateModalScrollLock();
    }

    openAdminPanel() {
        try {
            this.closeAccountPopup();
            this.showProfile();
            const panel = document.getElementById('adminPanel');
            if (panel) {
                panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
        } catch (e) {
            console.error('Не удалось открыть админ-панель:', e);
        }
    }

    getUserTransactions(user) {
        if (!user) return [];

        // 1) Основной источник — TransactionManager (синхронизируется с app.js после загрузки).
        if (window.transactionManager && typeof window.transactionManager.getAll === 'function') {
            try {
                const items = window.transactionManager.getAll();
                return Array.isArray(items) ? items : [];
            } catch (_e) {
                /* fall through */
            }
        }

        // 2) Кастомный слой хранения (если когда-нибудь появится), НЕ путать с встроенным
        //    window.StorageManager из Web Storage API — у него нет getTransactions.
        const sm = window.StorageManager;
        if (
            sm &&
            typeof sm.getTransactions === 'function' &&
            typeof sm.getRecurringTemplates === 'function'
        ) {
            try {
                const items = sm.getTransactions();
                return Array.isArray(items) ? items : [];
            } catch (_e) {
                return [];
            }
        }

        try {
            const key = `user_${user.id}_transactions`;
            const parsed = JSON.parse(localStorage.getItem(key) || '[]');
            return Array.isArray(parsed) ? parsed : [];
        } catch (_e) {
            return [];
        }
    }

    calculateAccountStats(user) {
        const transactions = this.getUserTransactions(user);
        const now = new Date();
        const month = now.getMonth();
        const year = now.getFullYear();

        const income = transactions
            .filter(t => t.type === 'income')
            .reduce((sum, t) => sum + (Number(t.amount) || 0), 0);

        const expense = transactions
            .filter(t => t.type === 'expense')
            .reduce((sum, t) => sum + (Number(t.amount) || 0), 0);

        const monthTransactionsCount = transactions.filter(t => {
            if (!t || !t.date) return false;
            const date = new Date(t.date);
            return !Number.isNaN(date.getTime()) && date.getMonth() === month && date.getFullYear() === year;
        }).length;

        return {
            income,
            expense,
            balance: income - expense,
            transactionsCount: transactions.length,
            monthTransactionsCount
        };
    }

    formatCurrency(value) {
        return `${(Number(value) || 0).toLocaleString('ru-RU')} ₸`;
    }

    showAccountPopup() {
        const user = this.authManager.getCurrentUser();
        if (!user) return;

        const modal = document.getElementById('accountPopupModal');
        if (!modal) return;

        const stats = this.calculateAccountStats(user);

        const nameEl = document.getElementById('accountPopupName');
        const emailEl = document.getElementById('accountPopupEmail');
        const statusEl = document.getElementById('accountPopupStatus');
        const balanceEl = document.getElementById('accountPopupBalance');
        const incomeEl = document.getElementById('accountPopupIncome');
        const expenseEl = document.getElementById('accountPopupExpense');
        const transactionsEl = document.getElementById('accountPopupTransactions');
        const monthTransactionsEl = document.getElementById('accountPopupMonthTransactions');

        if (nameEl) nameEl.textContent = user.name || 'Пользователь';
        if (emailEl) emailEl.textContent = user.email || '-';
        if (statusEl) {
            if (user.emailVerified) {
                statusEl.textContent = '✓ Email подтвержден';
                statusEl.className = 'status-badge verified';
            } else {
                statusEl.textContent = '✗ Email не подтвержден';
                statusEl.className = 'status-badge unverified';
            }
        }

        if (balanceEl) {
            balanceEl.textContent = this.formatCurrency(stats.balance);
            balanceEl.style.color = stats.balance >= 0 ? '#22c55e' : '#ef4444';
        }
        if (incomeEl) incomeEl.textContent = this.formatCurrency(stats.income);
        if (expenseEl) expenseEl.textContent = this.formatCurrency(stats.expense);
        if (transactionsEl) transactionsEl.textContent = String(stats.transactionsCount);
        if (monthTransactionsEl) monthTransactionsEl.textContent = String(stats.monthTransactionsCount);

        const openAdminPanelBtn = document.getElementById('openAdminPanelBtn');
        if (openAdminPanelBtn) {
            const isAdmin = this.authManager && typeof this.authManager.isCurrentUserAdmin === 'function'
                ? this.authManager.isCurrentUserAdmin()
                : false;
            openAdminPanelBtn.style.display = isAdmin ? 'block' : 'none';
        }

        modal.style.display = 'flex';
        const firstButton = modal.querySelector('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
        if (firstButton) firstButton.focus();
        window.updateModalScrollLock();
    }

    // Обновление статистики в профиле
    updateProfileStats(user) {
        if (!user) return;

        let transactions = [];
        try {
            transactions = this.getUserTransactions(user);
        } catch (e) {
            console.warn('updateProfileStats: не удалось прочитать операции', e);
        }

        // Подсчитываем доходы и расходы
        const income = transactions
            .filter(t => t.type === 'income')
            .reduce((sum, t) => sum + (Number(t.amount) || 0), 0);

        const expense = transactions
            .filter(t => t.type === 'expense')
            .reduce((sum, t) => sum + (Number(t.amount) || 0), 0);

        const balance = income - expense;

        // Обновляем отображение
        const incomeEl = document.getElementById('profileIncome');
        const expenseEl = document.getElementById('profileExpense');
        const balanceEl = document.getElementById('profileBalance');
        const transactionsCountEl = document.getElementById('profileTransactionsCount');

        if (incomeEl) incomeEl.textContent = `${income.toLocaleString()} ₸`;
        if (expenseEl) expenseEl.textContent = `${expense.toLocaleString()} ₸`;
        if (balanceEl) {
            balanceEl.textContent = `${balance.toLocaleString()} ₸`;
            balanceEl.style.color = balance >= 0 ? '#22c55e' : '#ef4444';
        }
        if (transactionsCountEl) transactionsCountEl.textContent = transactions.length;
    }

    // Загрузка списка пользователей для переключения
    loadUsersList() {
        const usersList = document.getElementById('usersList');
        if (!usersList) return;

        const users = this.authManager.getAllUsers();
        const currentUser = this.authManager.getCurrentUser();

        if (!users || users.length === 0) {
            usersList.innerHTML = '<p class="profile-info-text">Нет других пользователей</p>';
            return;
        }

        if (users.length === 1) {
            usersList.innerHTML = '<p class="profile-info-text">Вы единственный пользователь</p>';
            return;
        }

        usersList.innerHTML = users.map(user => {
            const isActive = currentUser && user.id === currentUser.id;
            return `
                <div class="user-item ${isActive ? 'active' : ''}" data-user-id="${user.id}">
                    <div class="user-item-info">
                        <div class="user-item-name">${this.escapeHtml(user.name || 'Пользователь')}</div>
                        <div class="user-item-email">${this.escapeHtml(user.email)}</div>
                    </div>
                    <div class="user-item-actions">
                        ${!isActive ? `
                            <button class="btn btn-outline btn-sm" onclick="window.authUI.switchUser('${user.id}')" title="Переключиться">
                                <i class="fas fa-sign-in-alt"></i>
                            </button>
                        ` : `
                            <span class="status-badge verified" style="font-size: 11px; padding: 4px 8px;">Текущий</span>
                        `}
                    </div>
                </div>
            `;
        }).join('');
    }

    loadAdminPanel() {
        const panel = document.getElementById('adminPanel');
        const usersList = document.getElementById('adminUsersList');
        if (!panel || !usersList) return;

        if (!this.authManager || typeof this.authManager.isCurrentUserAdmin !== 'function' || !this.authManager.isCurrentUserAdmin()) {
            panel.style.display = 'none';
            return;
        }

        panel.style.display = 'block';
        const result = this.authManager.listUsersForAdmin();
        if (!result.success || !Array.isArray(result.users) || result.users.length === 0) {
            usersList.innerHTML = '<p class="profile-info-text">Пользователи не найдены</p>';
            return;
        }

        const current = this.authManager.getCurrentUser();
        usersList.innerHTML = result.users.map((user) => {
            const isCurrent = current && current.id === user.id;
            const roleLabel = user.role === 'admin' ? 'Администратор' : 'Пользователь';
            const blockLabel = user.blocked ? 'Разблокировать' : 'Заблокировать';
            return `
                <div class="admin-user-item ${isCurrent ? 'active' : ''}">
                    <div class="admin-user-main">
                        <div class="admin-user-head">
                            <strong>${this.escapeHtml(user.name || 'Пользователь')}</strong>
                            <span class="status-badge ${user.role === 'admin' ? 'verified' : 'unverified'}">${roleLabel}</span>
                        </div>
                        <div class="admin-user-email">${this.escapeHtml(user.email || '')}</div>
                        <div class="admin-user-meta">
                            ${user.emailVerified ? 'Email подтвержден' : 'Email не подтвержден'}${user.blocked ? ' • Заблокирован' : ''}
                        </div>
                    </div>
                    <div class="admin-user-actions">
                        <button class="btn btn-outline btn-sm" onclick="window.authUI.setUserRole('${user.id}','${user.role === 'admin' ? 'user' : 'admin'}')" ${isCurrent ? 'disabled' : ''}>
                            ${user.role === 'admin' ? 'Снять админ' : 'Сделать админ'}
                        </button>
                        <button class="btn btn-outline btn-sm" onclick="window.authUI.toggleUserBlocked('${user.id}', ${user.blocked ? 'false' : 'true'})" ${isCurrent ? 'disabled' : ''}>
                            ${blockLabel}
                        </button>
                        <button class="btn btn-outline btn-sm" onclick="window.authUI.deleteUser('${user.id}')" ${isCurrent ? 'disabled' : ''}>
                            Удалить
                        </button>
                    </div>
                </div>
            `;
        }).join('');
    }

    setUserRole(userId, role) {
        if (!this.authManager || typeof this.authManager.adminSetUserRole !== 'function') return;
        const result = this.authManager.adminSetUserRole(userId, role);
        if (!result.success) {
            alert(result.message || 'Не удалось изменить роль');
            return;
        }
        this.loadAdminPanel();
        this.loadUsersList();
    }

    toggleUserBlocked(userId, blocked) {
        if (!this.authManager || typeof this.authManager.adminSetUserBlocked !== 'function') return;
        const result = this.authManager.adminSetUserBlocked(userId, blocked);
        if (!result.success) {
            alert(result.message || 'Не удалось изменить блокировку');
            return;
        }
        this.loadAdminPanel();
        this.loadUsersList();
    }

    deleteUser(userId) {
        if (!confirm('Удалить пользователя? Это действие необратимо.')) return;
        if (!this.authManager || typeof this.authManager.adminDeleteUser !== 'function') return;
        const result = this.authManager.adminDeleteUser(userId);
        if (!result.success) {
            alert(result.message || 'Не удалось удалить пользователя');
            return;
        }
        this.loadAdminPanel();
        this.loadUsersList();
    }

    // Переключение между пользователями
    switchUser(userId) {
        const users = this.authManager.getAllUsers();
        const user = users.find(u => u.id === userId);
        
        if (!user) {
            this.showError('Ошибка', 'Пользователь не найден');
            return;
        }

        // Выходим из текущего аккаунта
        this.authManager.logout();

        // Входим под выбранным пользователем
        // Для входа нужен пароль, поэтому показываем форму входа с предзаполненным email
        this.showAuthModal();
        this.switchTab('login');
        const emailInput = document.getElementById('loginEmail');
        if (emailInput) {
            emailInput.value = user.email;
        }
        
        // Закрываем модальное окно профиля
        const profileModal = document.getElementById('profileModal');
        if (profileModal) {
            profileModal.style.display = 'none';
        }

        this.showSuccessMessage('Введите пароль для входа под выбранным пользователем');
    }

    clearSuccess() {
        document.querySelectorAll('.success-message').forEach(el => {
            el.textContent = '';
            el.style.display = 'none';
        });
    }

    showSuccess(elementId, message) {
        if (typeof elementId === 'string' && elementId.includes('Success')) {
            const successEl = document.getElementById(elementId);
            if (successEl) {
                successEl.textContent = message;
                successEl.style.display = 'block';
            }
        } else {
            // Старый способ для совместимости
            console.log(message);
        }
    }

    async handleRegister(e) {
        e.preventDefault();
        this.clearErrors();
        this.clearSuccess();

        const name = document.getElementById('registerName').value;
        const email = document.getElementById('registerEmail').value;
        const password = document.getElementById('registerPassword').value;
        const passwordConfirm = document.getElementById('registerPasswordConfirm').value;

        // Проверка совпадения паролей
        if (password !== passwordConfirm) {
            this.showError('registerError', 'Пароли не совпадают');
            return;
        }

        const result = await this.authManager.register(email, password, name);

        if (result.success) {
            if (result.requiresVerification) {
                // Показываем форму подтверждения email
                document.getElementById('verifyEmail').value = email;
                this.switchTab('verifyEmail');
                this.showSuccess('registerSuccess', 'Регистрация успешна! Проверьте почту для подтверждения.');
            } else {
                this.showSuccess('Регистрация успешна! Вы автоматически вошли в систему.');
                setTimeout(() => {
                    this.showMainApp();
                    if (typeof window.initApp === 'function') {
                        window.initApp();
                    } else if (typeof initApp === 'function') {
                        initApp();
                    }
                }, 500);
            }
        } else {
            this.showError('registerError', result.message);
        }
    }

    handleLogout() {
        if (confirm('Вы уверены, что хотите выйти?')) {
            this.closeAccountPopup();
            this.closeProfileModal();
            this.authManager.logout();
            this.showAuthModal();
            // Очищаем формы
            if (this.loginForm) this.loginForm.reset();
            if (this.registerForm) this.registerForm.reset();
            this.clearErrors();
        }
    }

    updateUserInfo() {
        const user = this.authManager.getCurrentUser();
        if (user) {
            const userNameEl = document.getElementById('userName');
            const userEmailEl = document.getElementById('userEmail');
            const userInfoEl = document.getElementById('userInfo');
            const avatarEl = document.getElementById('userAvatar');
            if (userNameEl) userNameEl.textContent = user.name;
            if (userEmailEl) userEmailEl.textContent = user.email || '-';
            if (userInfoEl) userInfoEl.style.display = 'flex';
            if (avatarEl) {
                const raw = String(user.name || user.email || '?').trim();
                const parts = raw.split(/\s+/).filter(Boolean);
                let initials = '?';
                if (parts.length >= 2) {
                    initials = (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
                } else if (parts.length === 1) {
                    const p = parts[0];
                    if (p.includes('@')) {
                        initials = p[0].toUpperCase();
                    } else {
                        initials = p.length >= 2 ? p.slice(0, 2).toUpperCase() : p.toUpperCase();
                    }
                }
                avatarEl.textContent = initials;
                avatarEl.title = user.name || user.email || '';
            }
        }
    }

    showError(elementId, message) {
        const errorEl = document.getElementById(elementId);
        if (errorEl) {
            errorEl.textContent = message;
            errorEl.style.display = 'block';
        }
    }

    showSuccessMessage(message) {
        // Можно добавить toast уведомление
        console.log(message);
    }

    closeProfileModal() {
        const profileModal = document.getElementById('profileModal');
        if (profileModal) {
            profileModal.style.display = 'none';
        }
        window.updateModalScrollLock();
    }

    closeAccountPopup() {
        const accountPopupModal = document.getElementById('accountPopupModal');
        if (accountPopupModal) {
            accountPopupModal.style.display = 'none';
        }
        window.updateModalScrollLock();
    }

    getFocusableElements(container) {
        return Array.from(container.querySelectorAll(
            'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )).filter(el => el.offsetParent !== null);
    }

    handleModalKeyboard(event) {
        const visibleModals = Array.from(document.querySelectorAll('.modal, .auth-modal'))
            .filter(modal => window.getComputedStyle(modal).display !== 'none');
        const activeModal = visibleModals[visibleModals.length - 1];
        if (!activeModal) return;

        if (event.key === 'Escape') {
            if (activeModal.id === 'profileModal') {
                this.closeProfileModal();
            } else if (activeModal.id === 'accountPopupModal') {
                this.closeAccountPopup();
            }
            return;
        }

        if (event.key !== 'Tab') return;

        const focusable = this.getFocusableElements(activeModal);
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];

        if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
        }
    }

    clearErrors() {
        document.querySelectorAll('.error-message').forEach(el => {
            el.textContent = '';
            el.style.display = 'none';
        });
    }
}

// Инициализация
const authUI = new AuthUI();

// Для работы без модулей ES6 - делаем доступным глобально
if (typeof window !== 'undefined') {
    window.authUI = authUI;
}
