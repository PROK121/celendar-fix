// Главный файл приложения - точка входа
// Работает без ES6 модулей для поддержки file:// протокола

// Получаем менеджеры из глобального scope (загружаются через script теги)
// Не объявляем const StorageManager, чтобы избежать дубликатов - используем window.StorageManager напрямую
const TransactionManager = (typeof window !== 'undefined' && window.TransactionManager) || class TransactionManagerFallback {
    constructor() {
        this.transactions = [];
    }

    getAll() {
        return this.transactions || [];
    }

    getForMonth(month, year) {
        return this.getAll().filter((t) => {
            if (!t || !t.date) return false;
            const d = new Date(t.date);
            return d.getMonth() === month && d.getFullYear() === year;
        });
    }

    getForDay(date) {
        const dayTransactions = this.getAll().filter((t) => t && t.date === date);
        return {
            income: dayTransactions.filter((t) => t.type === 'income'),
            expense: dayTransactions.filter((t) => t.type === 'expense')
        };
    }

    add(transaction) {
        if (!transaction) return false;
        this.transactions.push(transaction);
        return true;
    }

    update(id, payload) {
        const index = this.transactions.findIndex((t) => t && t.id === id);
        if (index === -1) return false;
        this.transactions[index] = { ...this.transactions[index], ...payload };
        return true;
    }

    remove(id) {
        const prevLen = this.transactions.length;
        this.transactions = this.transactions.filter((t) => t && t.id !== id);
        return this.transactions.length < prevLen;
    }

    filter(filters = {}) {
        return this.getAll().filter((t) => {
            if (!t) return false;
            if (filters.type && t.type !== filters.type) return false;
            if (filters.category && t.category !== filters.category) return false;
            if (filters.dateFrom && t.date < filters.dateFrom) return false;
            if (filters.dateTo && t.date > filters.dateTo) return false;
            if (filters.minAmount && Number(t.amount) < Number(filters.minAmount)) return false;
            if (filters.maxAmount && Number(t.amount) > Number(filters.maxAmount)) return false;
            return true;
        });
    }

    search(query = '') {
        const normalized = String(query).trim().toLowerCase();
        if (!normalized) return this.getAll();
        return this.getAll().filter((t) => {
            const description = String(t.description || '').toLowerCase();
            const category = String(t.category || '').toLowerCase();
            const amount = String(t.amount || '');
            return description.includes(normalized) || category.includes(normalized) || amount.includes(normalized);
        });
    }

    save() {}
};

const BudgetManager = (typeof window !== 'undefined' && window.BudgetManager) || class BudgetManagerFallback {
    constructor() {
        this.budgets = [];
    }

    getAll() {
        return this.budgets || [];
    }

    getForMonth(month, year) {
        return this.getAll().filter((b) => b && b.month === month && b.year === year);
    }

    add(budget) {
        if (!budget) return false;
        const item = { ...budget, id: budget.id || `b_${Date.now()}` };
        this.budgets.push(item);
        return true;
    }

    remove(id) {
        const prevLen = this.budgets.length;
        this.budgets = this.budgets.filter((b) => b && b.id !== id);
        return this.budgets.length < prevLen;
    }
};
// Не объявляем const StatsCalculator, чтобы избежать дубликатов - используем window.StatsCalculator напрямую
const ErrorHandler = (typeof window !== 'undefined' && window.ErrorHandler) || {
    showNotification: function(msg, type) {
        console.log(type || 'info', msg);
        if (typeof showNotification === 'function') {
            showNotification(msg, type);
        }
    }
};

// Формат даты и другие утилиты (встроенные версии)
const formatDate = (typeof window !== 'undefined' && window.formatDate) || function(date) {
    if (!date) return '';
    const d = new Date(date);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const monthNames = (typeof window !== 'undefined' && window.monthNames) || [
    'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
    'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'
];

const debounce = (typeof window !== 'undefined' && window.debounce) || function(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
};

// Глобальные переменные (для обратной совместимости с app.js)
if (!window.transactionManager) {
    window.transactionManager = typeof TransactionManager === 'function' ? new TransactionManager() : TransactionManager;
}
if (!window.budgetManager) {
    window.budgetManager = typeof BudgetManager === 'function' ? new BudgetManager() : BudgetManager;
}
if (!window.statsCalculator) {
    window.statsCalculator = (typeof window !== 'undefined' && window.StatsCalculator) || {};
}

function monthTotalsForComparison(transactions, month, year) {
    let income = 0;
    let expense = 0;
    const list = Array.isArray(transactions) ? transactions : [];
    for (let i = 0; i < list.length; i++) {
        const t = list[i];
        if (!t || !t.date) continue;
        const d = new Date(t.date);
        if (Number.isNaN(d.getTime()) || d.getMonth() !== month || d.getFullYear() !== year) continue;
        if (t.entryKind === 'plan') continue;
        const amt = Number(t.amount) || 0;
        if (t.type === 'income') income += amt;
        else if (t.type === 'expense') expense += amt;
    }
    return { income, expense, balance: income - expense };
}

function percentChangeMonthOverMonth(prevVal, currVal) {
    if (prevVal === 0 && currVal === 0) return 0;
    if (prevVal === 0) return currVal > 0 ? 100 : (currVal < 0 ? -100 : 0);
    return ((currVal - prevVal) / Math.abs(prevVal)) * 100;
}

if (!window.StatsCalculator) {
    window.StatsCalculator = {
        compareWithPreviousMonth(transactions, month, year) {
            const curr = monthTotalsForComparison(transactions, month, year);
            let prevMonth = month - 1;
            let prevYear = year;
            if (prevMonth < 0) {
                prevMonth = 11;
                prevYear -= 1;
            }
            const prev = monthTotalsForComparison(transactions, prevMonth, prevYear);

            const incCh = percentChangeMonthOverMonth(prev.income, curr.income);
            const expCh = percentChangeMonthOverMonth(prev.expense, curr.expense);
            const balCh = percentChangeMonthOverMonth(prev.balance, curr.balance);

            return {
                income: { change: incCh, changeType: incCh >= 0 ? 'positive' : 'negative' },
                expense: { change: expCh, changeType: expCh >= 0 ? 'negative' : 'positive' },
                balance: { change: balCh, changeType: balCh >= 0 ? 'positive' : 'negative' }
            };
        }
    };
}
if (!window.errorHandler) {
    window.errorHandler = ErrorHandler;
}

// Инициализация темы
function initTheme() {
    const StorageManager = (typeof window !== 'undefined' && window.StorageManager) || {};
    const settings = StorageManager.getSettings ? StorageManager.getSettings() : {};
    const theme = settings.theme || 'light';
    document.documentElement.setAttribute('data-theme', theme);
    
    const themeToggle = document.getElementById('themeToggle');
    const themeText = document.getElementById('themeText');
    if (themeToggle && themeText) {
        const icon = themeToggle.querySelector('i');
        if (theme === 'dark') {
            if (icon) icon.className = 'fas fa-sun';
            themeText.textContent = 'Светлая тема';
        } else {
            if (icon) icon.className = 'fas fa-moon';
            themeText.textContent = 'Темная тема';
        }
    }
}

// Переключение темы - улучшенная версия с использованием StorageManager
// Если функция уже определена (из inline скрипта), улучшаем её
if (typeof window.toggleTheme === 'function') {
    const originalToggleTheme = window.toggleTheme;
    window.toggleTheme = function() {
        // Вызываем оригинальную функцию
        originalToggleTheme();
        
        // Дополнительно сохраняем через StorageManager если доступен
        try {
            const StorageManager = (typeof window !== 'undefined' && window.StorageManager) || {};
            if (StorageManager.getSettings && StorageManager.setSettings) {
                const settings = StorageManager.getSettings();
                const currentTheme = document.documentElement.getAttribute('data-theme') || 'light';
                settings.theme = currentTheme;
                StorageManager.setSettings(settings);
            }
        } catch (e) {
            // Игнорируем ошибки, если StorageManager не доступен
        }
    };
} else {
    // Если функция не определена, определяем её
    window.toggleTheme = function() {
        const currentTheme = document.documentElement.getAttribute('data-theme') || 'light';
        const newTheme = currentTheme === 'light' ? 'dark' : 'light';
        
        document.documentElement.setAttribute('data-theme', newTheme);
        
        const StorageManager = (typeof window !== 'undefined' && window.StorageManager) || {};
        if (StorageManager.getSettings && StorageManager.setSettings) {
            const settings = StorageManager.getSettings();
            settings.theme = newTheme;
            StorageManager.setSettings(settings);
        }
        
        const themeToggle = document.getElementById('themeToggle');
        const themeText = document.getElementById('themeText');
        if (themeToggle && themeText) {
            const icon = themeToggle.querySelector('i');
            if (newTheme === 'dark') {
                if (icon) icon.className = 'fas fa-sun';
                themeText.textContent = 'Светлая тема';
            } else {
                if (icon) icon.className = 'fas fa-moon';
                themeText.textContent = 'Темная тема';
            }
        }
    };
}

// Инициализация обработчика темы
function initThemeToggle() {
    const themeToggle = document.getElementById('themeToggle');
    if (themeToggle) {
        themeToggle.addEventListener('click', window.toggleTheme);
    }
}

// Показать фильтры
window.showFilters = window.showFilters || function() {
    const panel = document.getElementById('filtersPanel');
    if (panel) {
        const isHidden = panel.style.display === 'none' || !panel.style.display;
        panel.style.display = isHidden ? 'block' : 'none';
    }
};

// Закрыть фильтры
window.closeFilters = window.closeFilters || function() {
    const panel = document.getElementById('filtersPanel');
    if (panel) {
        panel.style.display = 'none';
    }
};

// Применить фильтры
window.applyFilters = window.applyFilters || function() {
    const filters = {
        type: document.getElementById('filterType')?.value || '',
        category: document.getElementById('filterCategory')?.value || '',
        dateFrom: document.getElementById('filterDateFrom')?.value || '',
        dateTo: document.getElementById('filterDateTo')?.value || '',
        minAmount: parseFloat(document.getElementById('filterMinAmount')?.value) || null,
        maxAmount: parseFloat(document.getElementById('filterMaxAmount')?.value) || null
    };
    
    // Сохраняем фильтры для использования в app.js
    window.currentFilters = filters;
    
    // Обновляем календарь и статистику
    if (typeof window.renderCalendar === 'function') {
        window.renderCalendar();
    }
    if (typeof window.updateMonthStats === 'function') {
        window.updateMonthStats();
    }
    
    if (typeof window.showNotification === 'function') {
        window.showNotification('Фильтры применены');
    } else if (typeof showNotification === 'function') {
        showNotification('Фильтры применены');
    }
};

// Очистить фильтры
window.clearFilters = window.clearFilters || function() {
    const filterType = document.getElementById('filterType');
    const filterCategory = document.getElementById('filterCategory');
    const filterDateFrom = document.getElementById('filterDateFrom');
    const filterDateTo = document.getElementById('filterDateTo');
    const filterMinAmount = document.getElementById('filterMinAmount');
    const filterMaxAmount = document.getElementById('filterMaxAmount');
    const searchInput = document.getElementById('searchInput');
    
    if (filterType) filterType.value = '';
    if (filterCategory) filterCategory.value = '';
    if (filterDateFrom) filterDateFrom.value = '';
    if (filterDateTo) filterDateTo.value = '';
    if (filterMinAmount) filterMinAmount.value = '';
    if (filterMaxAmount) filterMaxAmount.value = '';
    if (searchInput) searchInput.value = '';
    
    window.currentFilters = null;
    window.searchQuery = null;
    
    if (typeof window.renderCalendar === 'function') {
        window.renderCalendar();
    }
    if (typeof window.updateMonthStats === 'function') {
        window.updateMonthStats();
    }
    
    if (typeof window.showNotification === 'function') {
        window.showNotification('Фильтры сброшены');
    } else if (typeof showNotification === 'function') {
        showNotification('Фильтры сброшены');
    }
};

// Поиск с debounce
const debouncedSearch = debounce(() => {
    const query = document.getElementById('searchInput')?.value || '';
    window.searchQuery = query;
    
    if (window.renderCalendar) window.renderCalendar();
    if (window.updateMonthStats) window.updateMonthStats();
}, 300);

// Показать модальное окно бюджета
window.showBudgetModal = function() {
    const modal = document.getElementById('budgetModal');
    if (modal) {
        modal.style.display = 'flex';
        loadBudgetsList();
        
        // Установить текущий месяц и год по умолчанию
        const now = new Date();
        const monthSelect = document.getElementById('budgetMonth');
        const yearInput = document.getElementById('budgetYear');
        if (monthSelect) monthSelect.value = now.getMonth();
        if (yearInput) yearInput.value = now.getFullYear();
    }
    if (typeof window.updateModalScrollLock === 'function') {
        window.updateModalScrollLock();
    }
};

// Закрыть модальное окно бюджета
window.closeBudgetModal = function() {
    const modal = document.getElementById('budgetModal');
    if (modal) {
        modal.style.display = 'none';
    }
    if (typeof window.updateModalScrollLock === 'function') {
        window.updateModalScrollLock();
    }
};

// Добавить бюджет
window.addBudget = function() {
    const category = document.getElementById('budgetCategory')?.value;
    const amount = parseFloat(document.getElementById('budgetAmount')?.value);
    const month = parseInt(document.getElementById('budgetMonth')?.value);
    const year = parseInt(document.getElementById('budgetYear')?.value);
    
    if (!category || !amount || isNaN(month) || isNaN(year)) {
        ErrorHandler.showNotification('Заполните все поля', 'error');
        return;
    }
    
    const budget = {
        category,
        amount,
        month,
        year
    };
    
    if (window.budgetManager.add(budget)) {
        document.getElementById('budgetForm').reset();
        loadBudgetsList();
        updateBudgetsDisplay();
        ErrorHandler.showNotification('Бюджет добавлен', 'success');
    }
};

// Загрузить список бюджетов
function loadBudgetsList() {
    const container = document.getElementById('budgetsList');
    if (!container) return;
    
    const budgets = window.budgetManager.getAll();
    const currentMonth = window.currentMonth !== undefined ? window.currentMonth : new Date().getMonth();
    const currentYear = window.currentYear !== undefined ? window.currentYear : new Date().getFullYear();
    
    const monthBudgets = budgets.filter(b => b.month === currentMonth && b.year === currentYear);
    
    if (monthBudgets.length === 0) {
        container.innerHTML = '<p style="text-align: center; color: var(--text-secondary);">Нет бюджетов на этот месяц</p>';
        return;
    }
    
    container.innerHTML = monthBudgets.map(budget => {
        return `
            <div class="budget-item-list">
                <div>
                    <strong>${budget.category}</strong>
                    <div style="font-size: 0.9em; color: var(--text-secondary);">
                        ${budget.amount.toLocaleString()} ₸
                    </div>
                </div>
                <button class="btn btn-outline btn-small" onclick="deleteBudget('${budget.id}')">
                    <i class="fas fa-trash"></i>
                </button>
            </div>
        `;
    }).join('');
}

// Удалить бюджет
window.deleteBudget = function(id) {
    if (confirm('Удалить этот бюджет?')) {
        if (window.budgetManager.remove(id)) {
            loadBudgetsList();
            updateBudgetsDisplay();
            ErrorHandler.showNotification('Бюджет удален', 'success');
        }
    }
};

// Обновить отображение бюджетов
function updateBudgetsDisplay() {
    const container = document.getElementById('budgetsContainer');
    if (!container) return;
    
    const budgets = window.budgetManager.getForMonth(
        window.currentMonth !== undefined ? window.currentMonth : new Date().getMonth(),
        window.currentYear !== undefined ? window.currentYear : new Date().getFullYear()
    );
    
    if (budgets.length === 0) {
        container.innerHTML = '<p style="text-align: center; color: var(--text-secondary); padding: 20px;">Нет бюджетов на этот месяц</p>';
        return;
    }
    
    // Получаем транзакции за месяц для расчета потраченных сумм
    const transactions = window.transactionManager.getForMonth(
        window.currentMonth !== undefined ? window.currentMonth : new Date().getMonth(),
        window.currentYear !== undefined ? window.currentYear : new Date().getFullYear()
    );
    
    container.innerHTML = budgets.map(budget => {
        const spent = transactions
            .filter(t => t.type === 'expense' && t.category === budget.category && t.entryKind !== 'plan')
            .reduce((sum, t) => sum + t.amount, 0);
        
        const percentage = (spent / budget.amount) * 100;
        const remaining = budget.amount - spent;
        const exceeded = spent > budget.amount;
        const warning = percentage >= 80 && percentage < 100;
        
        return `
            <div class="budget-item ${exceeded ? 'exceeded' : warning ? 'warning' : ''}">
                <div class="budget-header">
                    <span class="budget-category">${budget.category}</span>
                    <span class="budget-amount">${budget.amount.toLocaleString()} ₸</span>
                </div>
                <div class="budget-progress">
                    <div class="progress-bar">
                        <div class="progress-fill" style="width: ${Math.min(percentage, 100)}%"></div>
                    </div>
                </div>
                <div class="budget-stats">
                    <span>Потрачено: <strong>${spent.toLocaleString()} ₸</strong></span>
                    <span class="${exceeded ? 'exceeded' : ''}">
                        ${exceeded ? 'Превышено на' : 'Осталось'}: 
                        <strong>${Math.abs(remaining).toLocaleString()} ₸</strong>
                    </span>
                </div>
            </div>
        `;
    }).join('');
}

// Обновить сравнение периодов
function updateComparison() {
    if (typeof window.currentMonth !== 'number' || typeof window.currentYear !== 'number') return;

    const StatsCalculator = (typeof window !== 'undefined' && window.StatsCalculator) || {};
    if (!StatsCalculator.compareWithPreviousMonth) return;

    let allTx = [];
    if (window.transactionManager && typeof window.transactionManager.getAll === 'function') {
        allTx = window.transactionManager.getAll() || [];
    }
    if ((!allTx || allTx.length === 0) && window.StorageManager && typeof window.StorageManager.getTransactions === 'function') {
        allTx = window.StorageManager.getTransactions() || [];
    }

    const comparison = StatsCalculator.compareWithPreviousMonth(
        allTx,
        window.currentMonth,
        window.currentYear
    );
    
    const formatChange = (value, type) => {
        const sign = value >= 0 ? '+' : '';
        const arrow = value >= 0 ? '↗' : '↘';
        const className = type === 'positive' ? 'positive' : 'negative';
        return `<span class="change ${className}">${sign}${value.toFixed(1)}% ${arrow}</span>`;
    };
    
    const incomeEl = document.getElementById('comparisonIncome');
    const expenseEl = document.getElementById('comparisonExpense');
    const balanceEl = document.getElementById('comparisonBalance');
    
    if (incomeEl) {
        incomeEl.innerHTML = formatChange(comparison.income.change, comparison.income.changeType);
    }
    if (expenseEl) {
        expenseEl.innerHTML = formatChange(comparison.expense.change, comparison.expense.changeType);
    }
    if (balanceEl) {
        balanceEl.innerHTML = formatChange(comparison.balance.change, comparison.balance.changeType);
    }
}

// Показать уведомление (для обратной совместимости)
window.showNotification = function(message, type = 'success') {
    ErrorHandler.showNotification(message, type);
};

// Инициализация при загрузке
document.addEventListener('DOMContentLoaded', () => {
    initTheme();
    initThemeToggle();
    
    // Добавить обработчик поиска
    const searchInput = document.getElementById('searchInput');
    if (searchInput) {
        searchInput.addEventListener('input', debouncedSearch);
    }
    
    // Инициализация клавиатурных сокращений
    if (typeof window.initKeyboardShortcuts === 'function') {
        window.initKeyboardShortcuts();
    }
    
});

// Экспорт функций для использования в app.js
window.updateBudgetsDisplay = updateBudgetsDisplay;
window.updateComparison = updateComparison;
