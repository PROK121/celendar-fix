        (function () {
        // Переключение темы уже определено в inline скрипте в head
        // Дополнительная проверка не нужна, функция уже доступна

        // Данные приложения
        // Используем глобальные менеджеры, если они доступны (из модулей)
        // Данные теперь привязаны к пользователю через StorageManager
        let transactions = [];
        let recurringTemplates = [];

        function syncTransactionManagerState() {
            if (!window.transactionManager) return;
            if (Array.isArray(transactions)) {
                window.transactionManager.transactions = [...transactions];
            }
        }
        
        // Функция для загрузки данных пользователя
        function loadUserData() {
            if (
                window.StorageManager &&
                typeof window.StorageManager.getTransactions === 'function' &&
                typeof window.StorageManager.getRecurringTemplates === 'function'
            ) {
                transactions = window.StorageManager.getTransactions() || [];
                recurringTemplates = window.StorageManager.getRecurringTemplates() || [];
            } else {
                // Fallback - проверяем авторизацию
                const currentUser = window.authManager ? window.authManager.getCurrentUser() : null;
                if (currentUser) {
                    const userKey = `user_${currentUser.id}_transactions`;
                    transactions = JSON.parse(localStorage.getItem(userKey) || '[]');
                    const templatesKey = `user_${currentUser.id}_recurringTemplates`;
                    recurringTemplates = JSON.parse(localStorage.getItem(templatesKey) || '[]');
                } else {
                    transactions = [];
                    recurringTemplates = [];
                }
            }
            syncTransactionManagerState();
        }
        
        // Загружаем данные при инициализации
        loadUserData();
        let currentDate = new Date();
        let currentMonth = currentDate.getMonth();
        let currentYear = currentDate.getFullYear();
        let selectedDay = null;
        let currentSelectedDate = null;
        let cashFlowChart = null;
        let cashFlowChartResizeObserver = null;
        let chartView = 'month';
        let categoryChart = null;

        // Ранний экспорт для inline onclick, чтобы не ловить ReferenceError
        window.changeMonth = function(direction) {
            return changeMonth(direction);
        };
        
        // Экспортируем для использования в модулях
        window.currentMonth = currentMonth;
        window.currentYear = currentYear;

        // Используем monthNames из window, если доступен, иначе создаем
        // Не объявляем const, чтобы избежать дубликатов - используем window.monthNames напрямую
        if (!window.monthNames) {
            window.monthNames = [
                'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
                'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'
            ];
        }
        // Используем window.monthNames и window.dayNames напрямую вместо локальных переменных
        if (!window.dayNames) {
            window.dayNames = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
        }

        function escapeHtml(value) {
            return String(value ?? '')
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#39;');
        }

        const DEFAULT_CATEGORIES = [
            'Зарплата',
            'Питание',
            'Жилье',
            'Транспорт',
            'Коммунальные услуги',
            'Долги и кредиты',
            'Здоровье',
            'Образование',
            'Развлечения',
            'Прочее'
        ];
        const CUSTOM_CATEGORY_VALUE = '__custom_category__';
        const CATEGORY_SELECT_IDS = ['category', 'recurringCategory', 'quickCategory', 'filterCategory', 'budgetCategory', 'editCategory'];

        function getCustomCategoriesKey() {
            if (window.StorageManager && typeof window.StorageManager.getUserKey === 'function') {
                return window.StorageManager.getUserKey('customCategories');
            }
            const currentUser = window.authManager && typeof window.authManager.getCurrentUser === 'function'
                ? window.authManager.getCurrentUser()
                : null;
            return currentUser ? `user_${currentUser.id}_customCategories` : 'customCategories';
        }

        function loadCustomCategories() {
            try {
                const raw = localStorage.getItem(getCustomCategoriesKey());
                const parsed = raw ? JSON.parse(raw) : [];
                if (!Array.isArray(parsed)) return [];
                return [...new Set(
                    parsed
                        .map(item => String(item || '').trim())
                        .filter(Boolean)
                )];
            } catch (_e) {
                return [];
            }
        }

        function saveCustomCategories(categories) {
            try {
                localStorage.setItem(getCustomCategoriesKey(), JSON.stringify(categories));
            } catch (_e) {}
        }

        function getAllCategories(extraCategory = '') {
            const customCategories = loadCustomCategories();
            const merged = [...DEFAULT_CATEGORIES];

            customCategories.forEach((name) => {
                if (!merged.includes(name)) merged.push(name);
            });

            const normalizedExtra = String(extraCategory || '').trim();
            if (normalizedExtra && !merged.includes(normalizedExtra)) {
                merged.push(normalizedExtra);
            }

            return merged;
        }

        function addCustomCategory(name) {
            const normalized = String(name || '').trim();
            if (!normalized || normalized === CUSTOM_CATEGORY_VALUE) return null;
            if (DEFAULT_CATEGORIES.includes(normalized)) return normalized;

            const categories = loadCustomCategories();
            if (!categories.includes(normalized)) {
                categories.push(normalized);
                saveCustomCategories(categories);
            }
            return normalized;
        }

        function renderCategorySelect(selectId, selectedValue = null) {
            const select = document.getElementById(selectId);
            if (!select) return;

            const currentValue = selectedValue === null ? select.value : selectedValue;
            const categories = getAllCategories(currentValue);
            const isFilter = selectId === 'filterCategory';

            const options = [];
            if (isFilter) {
                options.push('<option value="">Все категории</option>');
            }
            categories.forEach((category) => {
                options.push(`<option value="${escapeHtml(category)}">${escapeHtml(category)}</option>`);
            });
            options.push('<option value="__custom_category__">+ Своя категория...</option>');
            select.innerHTML = options.join('');

            if (currentValue && categories.includes(currentValue)) {
                select.value = currentValue;
            } else if (isFilter) {
                select.value = '';
            } else {
                select.value = 'Прочее';
            }
        }

        function renderAllCategorySelects() {
            CATEGORY_SELECT_IDS.forEach((id) => renderCategorySelect(id));
            setupCustomCategoryHandlers();
        }

        function setupCustomCategoryHandlers() {
            CATEGORY_SELECT_IDS.forEach((id) => {
                const select = document.getElementById(id);
                if (!select || select.dataset.customHandlerBound === '1') return;

                select.dataset.customHandlerBound = '1';
                select.addEventListener('focus', () => {
                    select.dataset.prevCategoryValue = select.value;
                });
                select.addEventListener('change', () => {
                    if (select.value !== CUSTOM_CATEGORY_VALUE) {
                        select.dataset.prevCategoryValue = select.value;
                        return;
                    }

                    const newCategoryInput = prompt('Введите название новой категории');
                    const newCategory = addCustomCategory(newCategoryInput);
                    const previousValue = select.dataset.prevCategoryValue || (id === 'filterCategory' ? '' : 'Прочее');

                    if (!newCategory) {
                        select.value = previousValue;
                        return;
                    }

                    CATEGORY_SELECT_IDS.forEach((targetId) => renderCategorySelect(targetId));
                    setupCustomCategoryHandlers();
                    renderCategorySelect(id, newCategory);
                    select.dataset.prevCategoryValue = newCategory;
                });
            });
        }

        function resolveCategoryValue(selectId) {
            const select = document.getElementById(selectId);
            if (!select) return 'Прочее';

            if (select.value !== CUSTOM_CATEGORY_VALUE) {
                return select.value || 'Прочее';
            }

            const newCategory = addCustomCategory(prompt('Введите название новой категории'));
            if (!newCategory) {
                return null;
            }

            CATEGORY_SELECT_IDS.forEach((id) => renderCategorySelect(id));
            setupCustomCategoryHandlers();
            renderCategorySelect(selectId, newCategory);
            return newCategory;
        }

        // Инициализация приложения
        function initApp() {
            // После refresh/авторизации заново читаем сохраненные данные пользователя
            loadUserData();

            // Всегда стартуем с текущего месяца и текущей даты
            currentDate = new Date();
            currentMonth = currentDate.getMonth();
            currentYear = currentDate.getFullYear();
            window.currentMonth = currentMonth;
            window.currentYear = currentYear;

            const todayKey = formatDate(currentDate);
            selectedDay = todayKey;
            currentSelectedDate = todayKey;

            renderCalendar();
            updateMonthStats();
            setFormDate(currentDate);
            renderAllCategorySelects();
            generateRecurringTransactions();
            updateCashFlowChart();
            
            // Установить текущий месяц в заголовке
            updateCurrentMonthDisplay();
        }

        let lastFocusedElement = null;

        function getFocusableElements(container) {
            if (!container) return [];
            return Array.from(container.querySelectorAll(
                'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
            )).filter(el => el.offsetParent !== null);
        }

        function openModal(modalId) {
            const modal = document.getElementById(modalId);
            if (!modal) return;
            lastFocusedElement = document.activeElement;
            modal.style.display = 'flex';
            const focusables = getFocusableElements(modal);
            if (focusables.length > 0) {
                focusables[0].focus();
            }
            if (typeof window.updateModalScrollLock === 'function') {
                window.updateModalScrollLock();
            }
        }

        function closeModalById(modalId) {
            const modal = document.getElementById(modalId);
            if (!modal) return;
            modal.style.display = 'none';
            if (lastFocusedElement && typeof lastFocusedElement.focus === 'function') {
                lastFocusedElement.focus();
            }
            if (typeof window.updateModalScrollLock === 'function') {
                window.updateModalScrollLock();
            }
        }

        // Обновление отображения текущего месяца
        function updateCurrentMonthDisplay() {
            document.getElementById('currentMonthDisplay').textContent = `${window.monthNames[currentMonth]} ${currentYear}`;
        }

        // Вычисление остатка на конец предыдущего месяца
        function calculatePreviousMonthBalance(month, year) {
            // Ищем предыдущий месяц с данными/сохраненным балансом без рекурсии,
            // чтобы избежать переполнения стека на "пустой" истории.
            let prevMonth = month - 1;
            let prevYear = year;
            if (prevMonth < 0) {
                prevMonth = 11;
                prevYear = year - 1;
            }

            // Ограничиваем глубину поиска назад: 20 лет обычно более чем достаточно.
            for (let i = 0; i < 240; i++) {
                const prevMonthTransactions = getTransactionsForMonth(prevMonth, prevYear);
                let savedBalance = null;

                if (window.StorageManager && typeof window.StorageManager.getMonthBalance === 'function') {
                    savedBalance = window.StorageManager.getMonthBalance(prevYear, prevMonth);
                } else {
                    const currentUser = window.authManager ? window.authManager.getCurrentUser() : null;
                    const key = currentUser
                        ? `user_${currentUser.id}_monthBalance_${prevYear}_${prevMonth}`
                        : `monthBalance_${prevYear}_${prevMonth}`;
                    const value = localStorage.getItem(key);
                    savedBalance = value !== null ? parseFloat(value) : null;
                }

                if (savedBalance !== null && !isNaN(savedBalance)) {
                    return savedBalance;
                }

                if (prevMonthTransactions.length > 0) {
                    let balance = 0;
                    prevMonthTransactions.forEach(transaction => {
                        if (transaction.type === 'income') {
                            balance += transaction.amount;
                        } else {
                            balance -= transaction.amount;
                        }
                    });

                    if (window.StorageManager && typeof window.StorageManager.setMonthBalance === 'function') {
                        window.StorageManager.setMonthBalance(prevYear, prevMonth, balance);
                    } else {
                        const currentUser = window.authManager ? window.authManager.getCurrentUser() : null;
                        const key = currentUser
                            ? `user_${currentUser.id}_monthBalance_${prevYear}_${prevMonth}`
                            : `monthBalance_${prevYear}_${prevMonth}`;
                        localStorage.setItem(key, balance.toString());
                    }

                    return balance;
                }

                // Переходим еще на месяц назад
                prevMonth -= 1;
                if (prevMonth < 0) {
                    prevMonth = 11;
                    prevYear -= 1;
                }
            }

            // Если данных так и не нашли, считаем стартовый баланс нулевым.
            return 0;
        }

        // Генерация календаря
        function renderCalendar() {
            const calendar = document.getElementById('calendar');
            calendar.innerHTML = '';

            // Заголовки дней недели
            dayNames.forEach(dayName => {
                const dayHeader = document.createElement('div');
                dayHeader.className = 'day-header';
                dayHeader.textContent = dayName;
                calendar.appendChild(dayHeader);
            });

            // Отображаем текущий месяц и год
            document.getElementById('currentMonth').textContent = 
                `${window.monthNames[currentMonth]} ${currentYear}`;

            const firstDay = new Date(currentYear, currentMonth, 1);
            const lastDay = new Date(currentYear, currentMonth + 1, 0);
            
            // Дни предыдущего месяца
            const firstDayOfWeek = firstDay.getDay() === 0 ? 6 : firstDay.getDay() - 1;
            const prevMonthLastDay = new Date(currentYear, currentMonth, 0).getDate();
            
            for (let i = firstDayOfWeek - 1; i >= 0; i--) {
                const day = document.createElement('div');
                day.className = 'day other-month';
                day.innerHTML = `<div class="day-number">${prevMonthLastDay - i}</div>`;
                calendar.appendChild(day);
            }

            // Вычисляем накопленный остаток для каждого дня
            // Сначала получаем все транзакции за месяц
            const monthTransactions = getTransactionsForMonth(currentMonth, currentYear);
            
            // Вычисляем начальный остаток (остаток на конец предыдущего месяца)
            let initialBalance = calculatePreviousMonthBalance(currentMonth, currentYear);
            
            // Дни текущего месяца
            const today = new Date();
            let cumulativeBalance = initialBalance; // Накопленный остаток с учетом начального остатка
            
            for (let i = 1; i <= lastDay.getDate(); i++) {
                const day = document.createElement('div');
                const dayDate = new Date(currentYear, currentMonth, i);
                const dayKey = formatDate(dayDate);
                
                const isToday = isSameDay(dayDate, today);
                const isSelected = selectedDay === dayKey;
                
                day.className = `day ${isToday ? 'today' : ''} ${isSelected ? 'selected' : ''}`;
                
                const dayTransactions = getTransactionsForDay(dayKey);
                const dayIncome = dayTransactions.income.reduce((sum, t) => sum + t.amount, 0);
                const dayExpense = dayTransactions.expense.reduce((sum, t) => sum + t.amount, 0);
                const dayBalance = dayIncome - dayExpense;
                
                // Добавляем баланс дня к накопленному остатку
                cumulativeBalance += dayBalance;
                
                // Сохраняем остаток на конец дня в localStorage (с учетом пользователя)
                if (i === lastDay.getDate()) {
                    // Это последний день месяца - сохраняем остаток
                    if (window.StorageManager && window.StorageManager.setMonthBalance) {
                        window.StorageManager.setMonthBalance(currentYear, currentMonth, cumulativeBalance);
                    } else {
                        const currentUser = window.authManager ? window.authManager.getCurrentUser() : null;
                        const key = currentUser ? 
                            `user_${currentUser.id}_monthBalance_${currentYear}_${currentMonth}` : 
                            `monthBalance_${currentYear}_${currentMonth}`;
                        localStorage.setItem(key, cumulativeBalance.toString());
                    }
                }
                
                // Округляем до целого для отображения
                const displayCumulativeBalance = Math.round(cumulativeBalance);
                
                // Проверяем, есть ли операции в месяце до этого дня включительно или есть начальный остаток
                const hasTransactionsInMonth = monthTransactions.some(t => {
                    const tDate = parseDate(t.date);
                    return tDate <= dayDate;
                }) || initialBalance !== 0;

                day.innerHTML = `
                    <div class="day-number">${i}</div>
                    <div class="day-transactions">
                        ${dayTransactions.income.map(t => 
                            `<div class="transaction income ${t.isRecurring ? 'recurring' : ''}" title="${escapeHtml(t.description)}${t.isRecurring ? ' (Повторяющаяся)' : ''}">+${Number(t.amount || 0).toLocaleString()} ₸</div>`
                        ).join('')}
                        ${dayTransactions.expense.map(t => 
                            `<div class="transaction expense ${t.isRecurring ? 'recurring' : ''}" title="${escapeHtml(t.description)}${t.isRecurring ? ' (Повторяющаяся)' : ''}">-${Number(t.amount || 0).toLocaleString()} ₸</div>`
                        ).join('')}
                    </div>
                    ${dayIncome + dayExpense > 0 ? 
                        `<div class="day-total ${dayBalance >= 0 ? 'income' : 'expense'}">
                            ${dayBalance >= 0 ? '+' : ''}${dayBalance} ₸
                        </div>` : ''
                    }
                    ${hasTransactionsInMonth ? 
                        `<div class="day-balance ${displayCumulativeBalance >= 0 ? 'balance-positive' : 'balance-negative'}" title="Остаток на конец дня${initialBalance !== 0 && i === 1 ? ' (с учетом остатка предыдущего месяца: ' + initialBalance.toLocaleString() + ' ₸)' : ''}">
                            ${displayCumulativeBalance >= 0 ? '+' : ''}${displayCumulativeBalance.toLocaleString()} ₸
                        </div>` : ''
                    }
                `;

                day.onclick = () => selectDay(dayKey, i);
                calendar.appendChild(day);
            }

            // Дни следующего месяца
            const totalCells = 42; // 6 недель
            const daysInCalendar = firstDayOfWeek + lastDay.getDate();
            const nextMonthDays = totalCells - daysInCalendar;
            
            for (let i = 1; i <= nextMonthDays; i++) {
                const day = document.createElement('div');
                day.className = 'day other-month';
                day.innerHTML = `<div class="day-number">${i}</div>`;
                calendar.appendChild(day);
            }
        }

        // Переключение между вкладками
        function switchTab(tabName) {
            // Убираем активный класс со всех вкладок и контента
            document.querySelectorAll('.tab').forEach(tab => {
                tab.classList.remove('active');
            });
            document.querySelectorAll('.tab-content').forEach(content => {
                content.classList.remove('active');
            });
            
            // Активируем выбранную вкладку и контент
            document.querySelector(`.tab[onclick="switchTab('${tabName}')"]`).classList.add('active');
            document.getElementById(`${tabName}-tab`).classList.add('active');
        }

        // Проверка, является ли день сегодняшним
        function isSameDay(date1, date2) {
            return date1.getDate() === date2.getDate() &&
                   date1.getMonth() === date2.getMonth() &&
                   date1.getFullYear() === date2.getFullYear();
        }

        // Выбор дня в календаре
        function selectDay(date, dayNumber) {
            selectedDay = date;
            currentSelectedDate = date;
            setFormDate(parseDate(date));
            renderCalendar();
            showDayDetails(date, dayNumber);
        }

        // Установка даты в форме
        function setFormDate(date) {
            document.getElementById('date').value = formatDate(date);
            document.getElementById('recurringStartDate').value = formatDate(date);
        }

        // Получение операций за день
        function getTransactionsForDay(date) {
            // Используем менеджер, если доступен
            if (window.transactionManager) {
                return window.transactionManager.getForDay(date);
            }
            const dayTransactions = transactions.filter(t => t.date === date);
            return {
                income: dayTransactions.filter(t => t.type === 'income'),
                expense: dayTransactions.filter(t => t.type === 'expense')
            };
        }

        // Получение операций за месяц
        function getTransactionsForMonth(month, year) {
            // Используем менеджер, если доступен
            if (window.transactionManager) {
                let monthTransactions = window.transactionManager.getForMonth(month, year);
                
                // Применяем фильтры, если они установлены
                if (window.currentFilters) {
                    monthTransactions = window.transactionManager.filter({
                        ...window.currentFilters,
                        dateFrom: window.currentFilters.dateFrom || `${year}-${String(month + 1).padStart(2, '0')}-01`,
                        dateTo: window.currentFilters.dateTo || `${year}-${String(month + 1).padStart(2, '0')}-${new Date(year, month + 1, 0).getDate()}`
                    });
                }
                
                // Применяем поиск, если он установлен
                if (window.searchQuery) {
                    monthTransactions = window.transactionManager.search(window.searchQuery);
                    // Фильтруем по месяцу после поиска
                    const startDate = new Date(year, month, 1);
                    const endDate = new Date(year, month + 1, 0);
                    monthTransactions = monthTransactions.filter(t => {
                        const transactionDate = parseDate(t.date);
                        return transactionDate >= startDate && transactionDate <= endDate;
                    });
                }
                
                return monthTransactions;
            }
            
            const startDate = new Date(year, month, 1);
            const endDate = new Date(year, month + 1, 0);
            
            return transactions.filter(transaction => {
                const transactionDate = parseDate(transaction.date);
                return transactionDate >= startDate && transactionDate <= endDate;
            });
        }

        // Генерация повторяющихся операций
        function generateRecurringTransactions() {
            const today = new Date();
            const endDate = new Date();
            endDate.setMonth(today.getMonth() + 3); // Генерируем на 3 месяца вперед
            
            recurringTemplates.forEach(template => {
                let currentDate = new Date(template.startDate);
                
                while (currentDate <= endDate) {
                    const dateStr = formatDate(currentDate);
                    
                    // Проверяем, существует ли уже такая операция
                    const exists = transactions.some(t => 
                        t.date === dateStr && 
                        t.type === template.type && 
                        t.amount === template.amount && 
                        t.description === template.description &&
                        t.isRecurring === true
                    );
                    
                    if (!exists && currentDate >= new Date(template.startDate)) {
                        transactions.push({
                            id: `${template.id}_${dateStr}`,
                            type: template.type,
                            amount: template.amount,
                            date: dateStr,
                            description: template.description,
                            category: template.category || 'Прочее',
                            isRecurring: true,
                            templateId: template.id
                        });
                    }
                    
                    // Переходим к следующей дате в зависимости от периодичности
                    if (template.frequency === 'weekly') {
                        currentDate.setDate(currentDate.getDate() + 7);
                    } else if (template.frequency === 'monthly') {
                        currentDate.setMonth(currentDate.getMonth() + 1);
                    }
                }
            });
            
            saveToLocalStorage();
        }

        // Обновление статистики за месяц
        function updateMonthStats() {
            const monthTransactions = getTransactionsForMonth(currentMonth, currentYear);
            
            const monthIncome = monthTransactions
                .filter(t => t.type === 'income')
                .reduce((sum, t) => sum + t.amount, 0);
                
            const monthExpense = monthTransactions
                .filter(t => t.type === 'expense')
                .reduce((sum, t) => sum + t.amount, 0);
                
            const monthBalance = monthIncome - monthExpense;
            const totalAmount = monthTransactions.reduce((sum, t) => sum + t.amount, 0);

            // Обновляем основные показатели
            document.getElementById('monthIncome').textContent = `${monthIncome.toLocaleString()} ₸`;
            document.getElementById('monthExpense').textContent = `${monthExpense.toLocaleString()} ₸`;
            document.getElementById('monthBalance').textContent = `${monthBalance.toLocaleString()} ₸`;
            const heroBalanceEl = document.getElementById('heroBalance');
            if (heroBalanceEl) {
                heroBalanceEl.textContent = `${monthBalance.toLocaleString()} ₸`;
            }
            
            // Обновляем дополнительную статистику
            const today = new Date();
            const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
            let daysPassed;
            if (currentYear === today.getFullYear() && currentMonth === today.getMonth()) {
                daysPassed = Math.min(today.getDate(), daysInMonth);
            } else {
                daysPassed = daysInMonth;
            }
            
            document.getElementById('monthTransactionsCount').textContent = monthTransactions.length;
            document.getElementById('avgIncomePerDay').textContent = daysPassed > 0 ? `${(monthIncome / daysPassed).toFixed(0)} ₸` : '0 ₸';
            document.getElementById('avgExpensePerDay').textContent = daysPassed > 0 ? `${(monthExpense / daysPassed).toFixed(0)} ₸` : '0 ₸';

            // Расширенная аналитика по месяцу
            const savingsRate = monthIncome > 0 ? (monthBalance / monthIncome) * 100 : 0;
            const expenseToIncomeRatio = monthIncome > 0 ? (monthExpense / monthIncome) * 100 : 0;
            const avgTransactionAmount = monthTransactions.length > 0 ? totalAmount / monthTransactions.length : 0;

            document.getElementById('savingsRate').textContent =
                monthIncome > 0 ? `${savingsRate.toFixed(0)} %` : '—';
            document.getElementById('expenseToIncomeRatio').textContent =
                monthIncome > 0 ? `${expenseToIncomeRatio.toFixed(0)} %` : '—';
            document.getElementById('avgTransactionAmount').textContent =
                monthTransactions.length > 0 ? `${avgTransactionAmount.toFixed(0)} ₸` : '—';

            // Аналитика по самым затратным дням и категориям
            const expenseByDay = {};
            const expenseByCategory = {};

            monthTransactions.forEach(t => {
                if (t.type === 'expense') {
                    const dateKey = t.date;
                    expenseByDay[dateKey] = (expenseByDay[dateKey] || 0) + t.amount;

                    const category = t.category || 'Прочее';
                    expenseByCategory[category] = (expenseByCategory[category] || 0) + t.amount;
                }
            });

            let maxExpenseDayKey = null;
            let maxExpenseDayValue = 0;
            Object.keys(expenseByDay).forEach(dateKey => {
                if (expenseByDay[dateKey] > maxExpenseDayValue) {
                    maxExpenseDayValue = expenseByDay[dateKey];
                    maxExpenseDayKey = dateKey;
                }
            });

            let topExpenseCategory = null;
            let topExpenseCategoryValue = 0;
            Object.keys(expenseByCategory).forEach(category => {
                if (expenseByCategory[category] > topExpenseCategoryValue) {
                    topExpenseCategoryValue = expenseByCategory[category];
                    topExpenseCategory = category;
                }
            });

            document.getElementById('maxExpenseDay').textContent =
                maxExpenseDayKey
                    ? `${formatDisplayDate(maxExpenseDayKey)} (${maxExpenseDayValue.toLocaleString()} ₸)`
                    : '—';

            document.getElementById('topExpenseCategory').textContent =
                topExpenseCategory
                    ? `${topExpenseCategory} (${topExpenseCategoryValue.toLocaleString()} ₸)`
                    : '—';
            
            // Обновляем недельную аналитику
            updateWeeklyStats(monthTransactions);
            // Обновляем аналитику по категориям
            updateCategoryChart(monthTransactions);
            
            // Проверяем на кассовый разрыв
            checkCashGap(monthTransactions);

            if (typeof window.updateBudgetsDisplay === 'function') {
                window.updateBudgetsDisplay();
            }
            if (typeof window.updateComparison === 'function') {
                window.updateComparison();
            }
        }

        // Проверка на кассовый разрыв
        function checkCashGap(monthTransactions) {
            const cashFlowData = calculateCashFlow(monthTransactions);
            const warningElement = document.getElementById('cashGapWarning');
            const messageElement = document.getElementById('cashGapMessage');
            if (!warningElement || !messageElement) return;

            // Для пустого месяца без стартового остатка предупреждение не нужно
            const hasMonthOperations = monthTransactions.length > 0;
            if (!hasMonthOperations && cashFlowData.initialBalance === 0) {
                warningElement.style.display = 'none';
                return;
            }

            const cashGapInfo = getCashGapInfo(cashFlowData);
            
            // Если есть отрицательное значение, показываем предупреждение
            if (cashGapInfo) {
                warningElement.style.display = 'block';
                messageElement.textContent = `Внимание! Возможен кассовый разрыв ${cashGapInfo.day} числа. Минимальный баланс: ${cashGapInfo.balance.toFixed(0)} ₸`;
            } else {
                warningElement.style.display = 'none';
            }
        }

        function getCashGapInfo(cashFlowData) {
            if (!cashFlowData || !Array.isArray(cashFlowData.cumulativeBalances)) return null;

            let minBalance = Number.POSITIVE_INFINITY;
            let minBalanceDay = 1;

            cashFlowData.cumulativeBalances.forEach((balance, index) => {
                if (balance < minBalance) {
                    minBalance = balance;
                    minBalanceDay = index + 1;
                }
            });

            if (!Number.isFinite(minBalance) || minBalance >= 0) return null;
            return {
                day: minBalanceDay,
                balance: minBalance
            };
        }

        function focusCashGapDay() {
            const monthTransactions = getTransactionsForMonth(currentMonth, currentYear);
            const cashFlowData = calculateCashFlow(monthTransactions);
            const cashGapInfo = getCashGapInfo(cashFlowData);

            if (!cashGapInfo) {
                if (typeof showNotification === 'function') {
                    showNotification('Кассовый разрыв в выбранном месяце не обнаружен');
                }
                return;
            }

            const targetDateObj = new Date(currentYear, currentMonth, cashGapInfo.day);
            const targetDateKey = formatDate(targetDateObj);

            selectedDay = targetDateKey;
            currentSelectedDate = targetDateKey;
            setFormDate(targetDateObj);
            renderCalendar();
            showDayDetails(targetDateKey, cashGapInfo.day);

            const calendarSection = document.querySelector('.calendar-section');
            if (calendarSection) {
                calendarSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
        }

        // Расчет денежного потока
        function calculateCashFlow(monthTransactions) {
            const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
            const dailyBalances = new Array(daysInMonth).fill(0);
            const cumulativeBalances = new Array(daysInMonth).fill(0);
            const labels = [];
            const initialBalance = calculatePreviousMonthBalance(currentMonth, currentYear);
            
            // Заполняем массив балансов по дням
            monthTransactions.forEach(transaction => {
                const transactionDate = parseDate(transaction.date);
                const dayIndex = transactionDate.getDate() - 1;
                
                if (transaction.type === 'income') {
                    dailyBalances[dayIndex] += transaction.amount;
                } else {
                    dailyBalances[dayIndex] -= transaction.amount;
                }
            });
            
            // Рассчитываем накопленный баланс
            let cumulativeBalance = initialBalance;
            for (let i = 0; i < daysInMonth; i++) {
                cumulativeBalance += dailyBalances[i];
                cumulativeBalances[i] = cumulativeBalance;
                labels.push(i + 1);
            }
            
            return {
                labels: labels,
                dailyBalances: dailyBalances,
                cumulativeBalances: cumulativeBalances,
                initialBalance: initialBalance
            };
        }

        // Недели внутри месяца: отрезки от понедельника до воскресенья (первая/последняя недели могут быть короче)
        function splitMonthIntoCalendarWeeks(year, month) {
            const firstDay = new Date(year, month, 1);
            const lastDay = new Date(year, month + 1, 0);
            const weeks = [];
            let currentWeek = [];
            let currentDate = new Date(firstDay);
            while (currentDate <= lastDay) {
                currentWeek.push(new Date(currentDate));
                if (currentDate.getDay() === 0 || currentDate.getTime() === lastDay.getTime()) {
                    weeks.push([...currentWeek]);
                    currentWeek = [];
                }
                currentDate.setDate(currentDate.getDate() + 1);
            }
            if (currentWeek.length > 0) {
                weeks.push([...currentWeek]);
            }
            return weeks;
        }

        function pickWeekForCashFlowChart(weeks, allMonthTransactions, year, month) {
            if (!weeks || weeks.length === 0) return [];
            const today = new Date();
            if (today.getFullYear() === year && today.getMonth() === month) {
                const td = today.getDate();
                const tm = today.getMonth();
                const ty = today.getFullYear();
                for (let i = 0; i < weeks.length; i++) {
                    if (weeks[i].some(d => d.getDate() === td && d.getMonth() === tm && d.getFullYear() === ty)) {
                        return weeks[i];
                    }
                }
            }
            for (let i = weeks.length - 1; i >= 0; i--) {
                const ws = weeks[i][0];
                const we = weeks[i][weeks[i].length - 1];
                const hasTx = allMonthTransactions.some(t => {
                    if (!t || !t.date) return false;
                    const d = parseDate(t.date);
                    return d >= ws && d <= we;
                });
                if (hasTx) return weeks[i];
            }
            return weeks[weeks.length - 1];
        }

        // Обновление графика денежного потока
        function updateCashFlowChart() {
            if (chartView === 'week') {
                updateCashFlowChartForView();
                return;
            }
            const monthTransactions = getTransactionsForMonth(currentMonth, currentYear);
            const cashFlowData = calculateCashFlow(monthTransactions);
            const hasMonthData = monthTransactions.length > 0 || cashFlowData.initialBalance !== 0;
            drawCashFlowChart(cashFlowData.labels, cashFlowData.cumulativeBalances, hasMonthData);
        }

        // Смена вида графика
        function changeChartView(view) {
            chartView = view;

            document.querySelectorAll('.chart-actions button').forEach(button => {
                button.classList.toggle('active', button.getAttribute('data-chart-view') === view);
            });

            updateCashFlowChartForView();
        }

        // Обновление графика в зависимости от выбранного вида
        function updateCashFlowChartForView() {
            const allMonthTransactions = getTransactionsForMonth(currentMonth, currentYear);

            if (chartView === 'week') {
                const weeks = splitMonthIntoCalendarWeeks(currentYear, currentMonth);
                const targetWeek = pickWeekForCashFlowChart(weeks, allMonthTransactions, currentYear, currentMonth);

                if (targetWeek.length === 0) {
                    const cashFlowData = calculateCashFlow(allMonthTransactions);
                    const hasMonthData = allMonthTransactions.length > 0 || cashFlowData.initialBalance !== 0;
                    drawCashFlowChart(cashFlowData.labels, cashFlowData.cumulativeBalances, hasMonthData);
                    return;
                }

                const weekStart = targetWeek[0];
                const weekEnd = targetWeek[targetWeek.length - 1];

                const weekTransactions = allMonthTransactions.filter(t => {
                    if (!t || !t.date) return false;
                    const d = parseDate(t.date);
                    return d >= weekStart && d <= weekEnd;
                });

                const cashFlowFull = calculateCashFlow(allMonthTransactions);
                const startDayNum = weekStart.getDate();
                const openingBalance = startDayNum <= 1
                    ? cashFlowFull.initialBalance
                    : cashFlowFull.cumulativeBalances[startDayNum - 2];

                const daysInWeek = targetWeek.length;
                const dailyBalances = new Array(daysInWeek).fill(0);
                const cumulativeBalances = new Array(daysInWeek).fill(0);
                const labels = [];

                weekTransactions.forEach(t => {
                    const d = parseDate(t.date);
                    const dayIndex = targetWeek.findIndex(day =>
                        day.getDate() === d.getDate() &&
                        day.getMonth() === d.getMonth() &&
                        day.getFullYear() === d.getFullYear()
                    );
                    if (dayIndex >= 0) {
                        const amt = Number(t.amount) || 0;
                        if (t.type === 'income') {
                            dailyBalances[dayIndex] += amt;
                        } else if (t.type === 'expense') {
                            dailyBalances[dayIndex] -= amt;
                        }
                    }
                });

                let cumulative = openingBalance;
                for (let i = 0; i < daysInWeek; i++) {
                    cumulative += dailyBalances[i];
                    cumulativeBalances[i] = cumulative;
                    labels.push(formatDisplayDate(targetWeek[i]));
                }

                const hasWeekData = weekTransactions.length > 0 ||
                    openingBalance !== 0 ||
                    dailyBalances.some(value => value !== 0);
                drawCashFlowChart(labels, cumulativeBalances, hasWeekData);
            } else {
                const monthTransactions = getTransactionsForMonth(currentMonth, currentYear);
                const cashFlowData = calculateCashFlow(monthTransactions);
                const hasMonthData = monthTransactions.length > 0 || cashFlowData.initialBalance !== 0;
                drawCashFlowChart(cashFlowData.labels, cashFlowData.cumulativeBalances, hasMonthData);
            }
        }

        // Универсальная отрисовка графика денежного потока
        function drawCashFlowChart(labels, cumulativeBalances, hasDataOverride = null) {
            const canvas = document.getElementById('cashFlowChart');
            if (!canvas) return;
            const ctx = canvas.getContext('2d');
            const emptyState = document.getElementById('cashFlowEmptyState');
            const hasData = hasDataOverride !== null
                ? hasDataOverride
                : cumulativeBalances.some(value => value !== 0);

            // Canvas всегда показываем, чтобы график не "пропадал" при пустых данных.
            canvas.style.display = 'block';
            if (emptyState) {
                emptyState.style.display = 'none';
            }

            const positiveBalances = cumulativeBalances.map(balance =>
                balance >= 0 ? balance : null
            );

            const negativeBalances = cumulativeBalances.map(balance =>
                balance < 0 ? balance : null
            );

            if (cashFlowChartResizeObserver) {
                cashFlowChartResizeObserver.disconnect();
                cashFlowChartResizeObserver = null;
            }
            if (cashFlowChart) {
                cashFlowChart.destroy();
            }

            cashFlowChart = new Chart(ctx, {
                type: 'line',
                data: {
                    labels: labels,
                    datasets: [
                        {
                            label: 'Положительный баланс',
                            data: positiveBalances,
                            borderColor: '#6C63FF',
                            backgroundColor: 'rgba(108, 99, 255, 0.1)',
                            borderWidth: 2,
                            fill: true,
                            tension: 0.4,
                        },
                        {
                            label: 'Отрицательный баланс',
                            data: negativeBalances,
                            borderColor: '#FF6584',
                            backgroundColor: 'rgba(255, 101, 132, 0.1)',
                            borderWidth: 2,
                            fill: true,
                            tension: 0.4,
                        }
                    ]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: {
                            display: true,
                            position: 'top'
                        },
                        tooltip: {
                            callbacks: {
                                label: function(context) {
                                    return `Баланс: ${context.parsed.y.toFixed(0)} ₸`;
                                }
                            }
                        }
                    },
                    scales: {
                        x: {
                            title: {
                                display: true,
                                text: chartView === 'week' ? 'Дни недели' : 'День месяца'
                            }
                        },
                        y: {
                            title: {
                                display: true,
                                text: 'Баланс (₸)'
                            },
                            beginAtZero: true
                        }
                    }
                }
            });

            const chartWrap = canvas.closest('.cash-flow-chart-wrap');
            if (chartWrap && typeof ResizeObserver !== 'undefined') {
                cashFlowChartResizeObserver = new ResizeObserver(() => {
                    if (cashFlowChart) {
                        cashFlowChart.resize();
                    }
                });
                cashFlowChartResizeObserver.observe(chartWrap);
            }
        }

        // Обновление недельной статистики
        function updateWeeklyStats(monthTransactions) {
            const container = document.getElementById('weeklyStatsContainer');
            if (!container) return;
            container.innerHTML = '';
            
            const firstDay = new Date(currentYear, currentMonth, 1);
            const lastDay = new Date(currentYear, currentMonth + 1, 0);
            
            // Разбиваем месяц на недели
            let weeks = [];
            let currentWeek = [];
            let currentDate = new Date(firstDay);
            
            while (currentDate <= lastDay) {
                currentWeek.push(new Date(currentDate));
                
                // Если это последний день недели или последний день месяца
                if (currentDate.getDay() === 0 || currentDate.getDate() === lastDay.getDate()) {
                    weeks.push([...currentWeek]);
                    currentWeek = [];
                }
                
                currentDate.setDate(currentDate.getDate() + 1);
            }
            
            // Для каждой недели считаем статистику
            weeks.forEach((week, index) => {
                if (week.length === 0) return;
                
                const weekStart = week[0];
                const weekEnd = week[week.length - 1];
                
                // Фильтруем операции за неделю
                const weekTransactions = monthTransactions.filter(transaction => {
                    const transactionDate = parseDate(transaction.date);
                    return transactionDate >= weekStart && transactionDate <= weekEnd;
                });
                
                const weekIncome = weekTransactions
                    .filter(t => t.type === 'income')
                    .reduce((sum, t) => sum + t.amount, 0);
                    
                const weekExpense = weekTransactions
                    .filter(t => t.type === 'expense')
                    .reduce((sum, t) => sum + t.amount, 0);
                    
                const weekBalance = weekIncome - weekExpense;
                
                // Создаем карточку недели
                const weekCard = document.createElement('div');
                weekCard.className = 'week-card';
                
                weekCard.innerHTML = `
                    <div class="week-header">
                        <span>Неделя ${index + 1}</span>
                        <span class="week-dates">${formatDisplayDate(weekStart)} - ${formatDisplayDate(weekEnd)}</span>
                    </div>
                    <div class="week-stats">
                        <div class="week-stat week-income">
                            <div class="week-stat-value">+${weekIncome.toLocaleString()} ₸</div>
                            <div class="week-stat-label">Доходы</div>
                        </div>
                        <div class="week-stat week-expense">
                            <div class="week-stat-value">-${weekExpense.toLocaleString()} ₸</div>
                            <div class="week-stat-label">Расходы</div>
                        </div>
                        <div class="week-stat week-balance">
                            <div class="week-stat-value">${weekBalance >= 0 ? '+' : ''}${weekBalance.toLocaleString()} ₸</div>
                            <div class="week-stat-label">Баланс</div>
                        </div>
                    </div>
                `;
                
                container.appendChild(weekCard);
            });
            
            // Если нет данных за месяц
            if (weeks.length === 0) {
                container.innerHTML = `
                    <div class="empty-state">
                        <i class="far fa-calendar"></i>
                        <p>Нет данных за этот месяц</p>
                    </div>
                `;
            }
        }

        // Показать детали дня
        function showDayDetails(date, dayNumber) {
            const dayTransactions = transactions.filter(t => t.date === date);
            const modal = document.getElementById('dayModal');
            const modalTitle = document.getElementById('modalDayTitle');
            const modalTransactions = document.getElementById('modalDayTransactions');

            const dateObj = parseDate(date);
            modalTitle.textContent = `Операции за ${dayNumber} ${window.monthNames[dateObj.getMonth()]} ${dateObj.getFullYear()}`;
            
            if (dayTransactions.length === 0) {
                modalTransactions.innerHTML = `
                    <div class="empty-state">
                        <i class="far fa-folder-open"></i>
                        <p>Нет операций за этот день</p>
                    </div>
                `;
            } else {
                modalTransactions.innerHTML = dayTransactions.map(transaction => `
                    <div class="transaction-item" data-transaction-id="${transaction.id}">
                        <div class="transaction-info">
                            <span class="transaction-amount ${transaction.type}">
                                ${transaction.type === 'income' ? '+' : '-'}${Number(transaction.amount || 0).toLocaleString()} ₸
                                ${transaction.isRecurring ? '<span class="recurring-badge">Повтор.</span>' : ''}
                            </span>
                            <span class="transaction-desc">
                                ${escapeHtml(transaction.description || 'Без описания')}
                                ${transaction.category ? ' · ' + escapeHtml(transaction.category) : ''}
                            </span>
                        </div>
                        <div class="transaction-actions">
                            <button onclick="editTransaction('${transaction.id}')" title="Редактировать" class="btn-edit">
                                <i class="fas fa-edit"></i>
                            </button>
                            <button onclick="deleteTransaction('${transaction.id}')" title="Удалить" class="btn-delete">
                                <i class="fas fa-trash"></i>
                            </button>
                        </div>
                    </div>
                `).join('');
            }

            // Очистить форму быстрого добавления
            document.getElementById('quickAmount').value = '';
            document.getElementById('quickDescription').value = '';
            document.getElementById('quickType').value = 'income';

            openModal('dayModal');
        }

        // Закрыть модальное окно
        function closeModal() {
            closeModalById('dayModal');
        }

        // Смена месяца
        function changeMonth(direction) {
            currentMonth += direction;
            if (currentMonth < 0) {
                currentMonth = 11;
                currentYear--;
            } else if (currentMonth > 11) {
                currentMonth = 0;
                currentYear++;
            }
            // Обновляем глобальные переменные для модулей
            window.currentMonth = currentMonth;
            window.currentYear = currentYear;
            selectedDay = null;
            renderCalendar();
            updateMonthStats();
            updateCurrentMonthDisplay();
            updateCashFlowChart();
        }
        
        // Делаем функцию доступной глобально
        window.changeMonth = changeMonth;

        // Добавление операции из основной формы
        function addTransaction() {
            const type = document.getElementById('type').value;
            const amount = parseFloat(document.getElementById('amount').value);
            const date = document.getElementById('date').value;
            const description = document.getElementById('description').value;
            const category = resolveCategoryValue('category');

            if (!Number.isFinite(amount) || amount <= 0 || !date || !category) {
                alert('Заполните обязательные поля: сумма и дата');
                return;
            }

            const transaction = {
                id: Date.now().toString(),
                type,
                amount,
                date,
                description,
                category,
                isRecurring: false
            };

            // Используем менеджер, если доступен
            if (window.transactionManager) {
                if (window.transactionManager.add(transaction)) {
                    transactions = window.transactionManager.getAll();
                } else {
                    return; // Ошибка валидации
                }
            } else {
                transactions.push(transaction);
            }
            saveToLocalStorage();
            renderCalendar();
            updateMonthStats();
            updateCashFlowChart();
            clearForm();
            showNotification('Операция успешно добавлена!');
        }

        // Добавление повторяющейся операции
        function addRecurringTransaction() {
            const type = document.getElementById('recurringType').value;
            const amount = parseFloat(document.getElementById('recurringAmount').value);
            const frequency = document.getElementById('recurringFrequency').value;
            const startDate = document.getElementById('recurringStartDate').value;
            const description = document.getElementById('recurringDescription').value;
            const category = resolveCategoryValue('recurringCategory');

            if (!Number.isFinite(amount) || amount <= 0 || !startDate || !category) {
                alert('Заполните обязательные поля: сумма и дата начала');
                return;
            }

            const template = {
                id: 'rec_' + Date.now().toString(),
                type,
                amount,
                frequency,
                startDate,
                description,
                category
            };

            recurringTemplates.push(template);
            saveToLocalStorage();
            generateRecurringTransactions();
            renderCalendar();
            updateMonthStats();
            updateCashFlowChart();
            clearRecurringForm();
            showNotification('Повторяющаяся операция успешно добавлена!');
        }

        // Быстрое добавление операции из модального окна
        function addQuickTransaction() {
            const type = document.getElementById('quickType').value;
            const amount = parseFloat(document.getElementById('quickAmount').value);
            const description = document.getElementById('quickDescription').value;
            const category = resolveCategoryValue('quickCategory');
            const date = currentSelectedDate;

            if (!Number.isFinite(amount) || amount <= 0 || !category) {
                alert('Заполните обязательные поля: сумма');
                return;
            }

            const transaction = {
                id: Date.now().toString(),
                type,
                amount,
                date,
                description,
                category,
                isRecurring: false
            };

            transactions.push(transaction);
            saveToLocalStorage();
            renderCalendar();
            updateMonthStats();
            updateCashFlowChart();
            
            // Обновить содержимое модального окна
            const dateObj = parseDate(date);
            const dayNumber = dateObj.getDate();
            showDayDetails(date, dayNumber);
            
            // Очистить форму быстрого добавления
            document.getElementById('quickAmount').value = '';
            document.getElementById('quickDescription').value = '';
            
            showNotification('Операция успешно добавлена!');
        }

        // Показать уведомление
        function showNotification(message) {
            const notification = document.getElementById('notification');
            notification.querySelector('span').textContent = message;
            notification.classList.add('show');
            
            setTimeout(() => {
                notification.classList.remove('show');
            }, 3000);
        }

        // Редактирование операции
        window.editTransaction = function(id) {
            const transaction = transactions.find(t => t.id === id);
            if (!transaction) return;
            
            // Закрываем модальное окно дня
            closeModal();
            
            // Открываем модальное окно редактирования
            const editModal = document.getElementById('editTransactionModal');
            if (!editModal) {
                // Создаем модальное окно, если его нет
                createEditModal();
            }
            
            // Заполняем форму данными транзакции
            document.getElementById('editTransactionId').value = transaction.id;
            document.getElementById('editType').value = transaction.type;
            document.getElementById('editAmount').value = transaction.amount;
            document.getElementById('editDate').value = transaction.date;
            document.getElementById('editDescription').value = transaction.description || '';
            renderCategorySelect('editCategory', transaction.category || 'Прочее');
            setupCustomCategoryHandlers();
            
            // Показываем модальное окно
            openModal('editTransactionModal');
        };
        
        // Создание модального окна редактирования
        function createEditModal() {
            const modal = document.createElement('div');
            modal.className = 'modal';
            modal.id = 'editTransactionModal';
            modal.innerHTML = `
                <div class="modal-content">
                    <div class="modal-header">
                        <h3 class="modal-title">Редактировать операцию</h3>
                        <button class="modal-close" onclick="closeEditModal()">
                            <i class="fas fa-times"></i>
                        </button>
                    </div>
                    <div class="modal-body">
                        <form id="editTransactionForm">
                            <input type="hidden" id="editTransactionId">
                            <div class="form-group">
                                <label class="form-label"><i class="fas fa-exchange-alt"></i> Тип операции</label>
                                <select class="form-control" id="editType">
                                    <option value="income">Доход</option>
                                    <option value="expense">Расход</option>
                                </select>
                            </div>
                            <div class="form-row">
                                <div class="form-group">
                                    <label class="form-label"><i class="fas fa-money-bill-wave"></i> Сумма</label>
                                    <input type="number" class="form-control" id="editAmount" placeholder="0" required>
                                </div>
                                <div class="form-group">
                                    <label class="form-label"><i class="fas fa-calendar-day"></i> Дата</label>
                                    <input type="date" class="form-control" id="editDate" required>
                                </div>
                            </div>
                            <div class="form-group">
                                <label class="form-label"><i class="fas fa-comment"></i> Описание</label>
                                <input type="text" class="form-control" id="editDescription" placeholder="Описание">
                            </div>
                            <div class="form-group">
                                <label class="form-label"><i class="fas fa-tags"></i> Категория</label>
                                <select class="form-control" id="editCategory">
                                    <option value="Зарплата">Зарплата</option>
                                    <option value="Питание">Питание</option>
                                    <option value="Жилье">Жилье</option>
                                    <option value="Транспорт">Транспорт</option>
                                    <option value="Коммунальные услуги">Коммунальные услуги</option>
                                    <option value="Долги и кредиты">Долги и кредиты</option>
                                    <option value="Здоровье">Здоровье</option>
                                    <option value="Образование">Образование</option>
                                    <option value="Развлечения">Развлечения</option>
                                    <option value="Прочее" selected>Прочее</option>
                                </select>
                            </div>
                            <div class="form-actions">
                                <button type="button" class="btn btn-primary" onclick="saveEditedTransaction()" style="width: 100%;">
                                    <i class="fas fa-save"></i> Сохранить изменения
                                </button>
                                <button type="button" class="btn btn-outline" onclick="closeEditModal()" style="width: 100%; margin-top: 10px;">
                                    Отмена
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            `;
            document.body.appendChild(modal);
        }
        
        // Сохранение отредактированной транзакции
        window.saveEditedTransaction = function() {
            const id = document.getElementById('editTransactionId').value;
            const type = document.getElementById('editType').value;
            const amount = parseFloat(document.getElementById('editAmount').value);
            const date = document.getElementById('editDate').value;
            const description = document.getElementById('editDescription').value;
            const category = resolveCategoryValue('editCategory');
            
            if (!Number.isFinite(amount) || amount <= 0 || !date || !category) {
                alert('Заполните обязательные поля: сумма и дата');
                return;
            }
            
            const index = transactions.findIndex(t => t.id === id);
            if (index !== -1) {
                // Используем менеджер, если доступен
                if (window.transactionManager) {
                    const updated = {
                        ...transactions[index],
                        type,
                        amount,
                        date,
                        description,
                        category
                    };
                    if (window.transactionManager.update(id, updated)) {
                        transactions = window.transactionManager.getAll();
                    } else {
                        return; // Ошибка валидации
                    }
                } else {
                    transactions[index] = {
                        ...transactions[index],
                        type,
                        amount,
                        date,
                        description,
                        category
                    };
                }
                
                saveToLocalStorage();
                renderCalendar();
                updateMonthStats();
                updateCashFlowChart();
                closeEditModal();
                
                // Обновляем модальное окно дня, если оно открыто
                const dayModal = document.getElementById('dayModal');
                if (dayModal && dayModal.style.display === 'flex') {
                    const currentDate = document.getElementById('modalDayTitle')
                        .textContent.match(/\d+/)[0];
                    const dateObj = new Date(currentYear, currentMonth, parseInt(currentDate));
                    showDayDetails(formatDate(dateObj), parseInt(currentDate));
                }
                
                showNotification('Операция успешно обновлена!');
            }
        };
        
        // Закрытие модального окна редактирования
        window.closeEditModal = function() {
            const modal = document.getElementById('editTransactionModal');
            if (modal) {
                closeModalById('editTransactionModal');
            }
        };

        // Удаление операции
        function deleteTransaction(id) {
            if (confirm('Удалить эту запись?')) {
                // Используем менеджер, если доступен
                if (window.transactionManager) {
                    if (window.transactionManager.remove(id)) {
                        transactions = window.transactionManager.getAll();
                    }
                } else {
                    transactions = transactions.filter(t => t.id !== id);
                }
                saveToLocalStorage();
                renderCalendar();
                updateMonthStats();
                updateCashFlowChart();
                // Обновляем модальное окно, если оно открыто
                const modal = document.getElementById('dayModal');
                if (modal.style.display === 'flex') {
                    const currentDate = document.getElementById('modalDayTitle')
                        .textContent.match(/\d+/)[0];
                    const dateObj = new Date(currentYear, currentMonth, parseInt(currentDate));
                    showDayDetails(formatDate(dateObj), parseInt(currentDate));
                }
                showNotification('Операция удалена!');
            }
        }

        // Показать модальное окно с повторяющимися операциями
        function showRecurringTransactions() {
            const modal = document.getElementById('recurringModal');
            const transactionsList = document.getElementById('recurringTransactionsList');
            
            if (recurringTemplates.length === 0) {
                transactionsList.innerHTML = `
                    <div class="empty-state">
                        <i class="fas fa-redo"></i>
                        <p>Нет повторяющихся операций</p>
                    </div>
                `;
            } else {
                transactionsList.innerHTML = recurringTemplates.map(template => `
                    <div class="transaction-item">
                        <div class="transaction-info">
                            <span class="transaction-amount ${template.type}">
                                ${template.type === 'income' ? '+' : '-'}${Number(template.amount || 0).toLocaleString()} ₸
                            </span>
                            <span class="transaction-desc">${escapeHtml(template.description || 'Без описания')}</span>
                            <small>${template.frequency === 'weekly' ? 'Еженедельно' : 'Ежемесячно'} с ${formatDisplayDate(template.startDate)}</small>
                        </div>
                        <div class="transaction-actions">
                            <button onclick="deleteRecurringTemplate('${template.id}')" title="Удалить шаблон">
                                <i class="fas fa-trash"></i>
                            </button>
                        </div>
                    </div>
                `).join('');
            }
            
            openModal('recurringModal');
        }

        // Закрыть модальное окно с повторяющимися операциями
        function closeRecurringModal() {
            closeModalById('recurringModal');
        }

        // Удаление шаблона повторяющейся операции
        function deleteRecurringTemplate(id) {
            if (confirm('Удалить этот шаблон повторяющейся операции? Все будущие операции также будут удалены.')) {
                // Удаляем шаблон
                recurringTemplates = recurringTemplates.filter(t => t.id !== id);
                
                // Удаляем все сгенерированные операции из этого шаблона
                transactions = transactions.filter(t => t.templateId !== id);
                
                saveToLocalStorage();
                renderCalendar();
                updateMonthStats();
                updateCashFlowChart();
                showRecurringTransactions();
                showNotification('Шаблон повторяющейся операции удален!');
            }
        }

        // Очистка формы
        function clearForm() {
            document.getElementById('amount').value = '';
            document.getElementById('description').value = '';
        }

        // Очистка формы повторяющихся операций
        function clearRecurringForm() {
            document.getElementById('recurringAmount').value = '';
            document.getElementById('recurringDescription').value = '';
        }

        // Сохранение в локальное хранилище
        function saveToLocalStorage() {
            // Синхронизируем in-memory менеджер, если доступен
            if (window.transactionManager) {
                window.transactionManager.transactions = transactions;
                if (typeof window.transactionManager.save === 'function') {
                    window.transactionManager.save();
                }
            }

            // Основное сохранение: пользовательское хранилище
            if (
                window.StorageManager &&
                typeof window.StorageManager.setTransactions === 'function' &&
                typeof window.StorageManager.setRecurringTemplates === 'function'
            ) {
                window.StorageManager.setTransactions(transactions);
                window.StorageManager.setRecurringTemplates(recurringTemplates);
            } else {
                // Fallback с проверкой пользователя
                const currentUser = window.authManager ? window.authManager.getCurrentUser() : null;
                if (currentUser) {
                    const transactionsKey = `user_${currentUser.id}_transactions`;
                    const templatesKey = `user_${currentUser.id}_recurringTemplates`;
                    localStorage.setItem(transactionsKey, JSON.stringify(transactions));
                    localStorage.setItem(templatesKey, JSON.stringify(recurringTemplates));
                } else {
                    // Старый способ без пользователей (для совместимости)
                    localStorage.setItem('transactions', JSON.stringify(transactions));
                    localStorage.setItem('recurringTemplates', JSON.stringify(recurringTemplates));
                }
            }
        }

        // Форматирование даты в YYYY-MM-DD
        function formatDate(date) {
            const year = date.getFullYear();
            const month = String(date.getMonth() + 1).padStart(2, '0');
            const day = String(date.getDate()).padStart(2, '0');
            return `${year}-${month}-${day}`;
        }

        // Форматирование даты для отображения (принимает строку или объект Date)
        function formatDisplayDate(input) {
            const date = input instanceof Date ? input : parseDate(input);
            const options = { day: 'numeric', month: 'short' };
            return date.toLocaleDateString('ru-RU', options);
        }

        // Парсинг даты из строки YYYY-MM-DD
        function parseDate(dateString) {
            const parts = dateString.split('-');
            return new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
        }

        // Аналитика по категориям (круговая диаграмма)
        function updateCategoryChart(monthTransactions) {
            const canvas = document.getElementById('categoryChart');
            const ctx = canvas.getContext('2d');
            const emptyState = document.getElementById('categoryEmptyState');
            const expenseTransactions = monthTransactions.filter(t => t.type === 'expense');

            const totals = {};
            expenseTransactions.forEach(t => {
                const category = t.category || 'Прочее';
                totals[category] = (totals[category] || 0) + t.amount;
            });

            const labels = Object.keys(totals);
            const data = Object.values(totals);

            if (categoryChart) {
                categoryChart.destroy();
            }

            if (labels.length === 0) {
                if (canvas) {
                    canvas.style.display = 'none';
                }
                if (emptyState) {
                    emptyState.style.display = 'block';
                }
                categoryChart = new Chart(ctx, {
                    type: 'doughnut',
                    data: {
                        labels: ['Нет данных'],
                        datasets: [{
                            data: [1],
                            backgroundColor: ['#e0e0e0']
                        }]
                    },
                    options: {
                        plugins: {
                            legend: { display: false }
                        }
                    }
                });
                return;
            }

            if (canvas) {
                canvas.style.display = 'block';
            }
            if (emptyState) {
                emptyState.style.display = 'none';
            }

            const colors = [
                '#6C63FF', '#FF6584', '#FFB74D', '#4CD964', '#42A5F5',
                '#AB47BC', '#FF7043', '#26C6DA', '#8D6E63', '#7CB342'
            ];

            categoryChart = new Chart(ctx, {
                type: 'doughnut',
                data: {
                    labels,
                    datasets: [{
                        data,
                        backgroundColor: labels.map((_, idx) => colors[idx % colors.length]),
                        borderWidth: 1
                    }]
                },
                options: {
                    plugins: {
                        legend: {
                            position: 'bottom'
                        },
                        tooltip: {
                            callbacks: {
                                label: function(context) {
                                    const value = context.parsed;
                                    const total = data.reduce((s, v) => s + v, 0);
                                    const percent = total ? (value / total) * 100 : 0;
                                    return `${context.label}: ${value.toLocaleString()} ₸ (${percent.toFixed(0)}%)`;
                                }
                            }
                        }
                    }
                }
            });
        }

        // Экспорт данных
        function exportData() {
            // Показываем меню выбора формата
            const format = prompt('Выберите формат экспорта:\n1 - JSON\n2 - CSV\n3 - Excel\n4 - Отчет (TXT)\n\nВведите номер:');
            
            if (!format) return;
            
            const data = {
                transactions: transactions,
                recurringTemplates: recurringTemplates
            };
            
            const dateStr = new Date().toISOString().slice(0, 10);

            function downloadBlob(content, mimeType, filename) {
                const blob = new Blob([content], { type: mimeType });
                const url = URL.createObjectURL(blob);
                const link = document.createElement('a');
                link.href = url;
                link.download = filename;
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
                URL.revokeObjectURL(url);
            }

            function escapeCsv(value) {
                const text = value === null || value === undefined ? '' : String(value);
                return `"${text.replace(/"/g, '""')}"`;
            }

            try {
                switch (format.trim()) {
                    case '1': {
                        const dataStr = JSON.stringify(data, null, 2);
                        downloadBlob(dataStr, 'application/json;charset=utf-8', `financial-calendar-backup-${dateStr}.json`);
                        showNotification('Данные успешно экспортированы в JSON!');
                        break;
                    }
                    case '2': {
                        const headers = ['ID', 'Дата', 'Тип', 'Категория', 'Описание', 'Сумма'];
                        const rows = transactions.map((t) => [
                            t && t.id ? t.id : '',
                            t && t.date ? t.date : '',
                            t && t.type ? t.type : '',
                            t && t.category ? t.category : '',
                            t && t.description ? t.description : '',
                            t && t.amount !== undefined ? t.amount : ''
                        ]);
                        const csv = [headers, ...rows].map((row) => row.map(escapeCsv).join(',')).join('\n');
                        downloadBlob('\uFEFF' + csv, 'text/csv;charset=utf-8', `transactions-${dateStr}.csv`);
                        showNotification('Данные успешно экспортированы в CSV!');
                        break;
                    }
                    case '3': {
                        const headers = ['ID', 'Дата', 'Тип', 'Категория', 'Описание', 'Сумма'];
                        const rows = transactions.map((t) => `
                            <tr>
                                <td>${(t && t.id) || ''}</td>
                                <td>${(t && t.date) || ''}</td>
                                <td>${(t && t.type) || ''}</td>
                                <td>${(t && t.category) || ''}</td>
                                <td>${(t && t.description) || ''}</td>
                                <td>${(t && t.amount !== undefined) ? t.amount : ''}</td>
                            </tr>
                        `).join('');
                        const table = `
                            <table border="1">
                                <thead><tr>${headers.map((h) => `<th>${h}</th>`).join('')}</tr></thead>
                                <tbody>${rows}</tbody>
                            </table>
                        `;
                        downloadBlob('\uFEFF' + table, 'application/vnd.ms-excel;charset=utf-8', `transactions-${dateStr}.xls`);
                        showNotification('Данные успешно экспортированы в Excel!');
                        break;
                    }
                    case '4': {
                        const monthTransactions = getTransactionsForMonth(currentMonth, currentYear);
                        const income = monthTransactions
                            .filter((t) => t.type === 'income')
                            .reduce((sum, t) => sum + (Number(t.amount) || 0), 0);
                        const expense = monthTransactions
                            .filter((t) => t.type === 'expense')
                            .reduce((sum, t) => sum + (Number(t.amount) || 0), 0);
                        const balance = income - expense;
                        const report = [
                            'ОТЧЕТ ПО ФИНАНСАМ',
                            `Период: ${window.monthNames[currentMonth]} ${currentYear}`,
                            `Дата формирования: ${new Date().toLocaleString('ru-RU')}`,
                            '',
                            `Операций за месяц: ${monthTransactions.length}`,
                            `Доходы: ${income.toLocaleString('ru-RU')} ₸`,
                            `Расходы: ${expense.toLocaleString('ru-RU')} ₸`,
                            `Баланс: ${balance.toLocaleString('ru-RU')} ₸`,
                            '',
                            'Всего операций в базе:',
                            `${transactions.length}`
                        ].join('\n');
                        downloadBlob(report, 'text/plain;charset=utf-8', `report-${dateStr}.txt`);
                        showNotification('Отчет успешно экспортирован!');
                        break;
                    }
                    default:
                        showNotification('Неверный формат!', 'error');
                }
            } catch (error) {
                console.error('Export error:', error);
                showNotification('Ошибка при экспорте данных', 'error');
            }
        }

        // Импорт данных
        function importData() {
            document.getElementById('importFile').click();
        }

        function importBankStatementPdf() {
            const input = document.getElementById('bankStatementFile');
            if (!input) {
                alert('Поле загрузки PDF не найдено');
                return;
            }
            input.click();
        }

        let pdfProcessingStartMs = 0;
        let pdfProcessingTimer = null;
        let pdfProcessingExpectedTotalMs = 45000;
        const PDF_IMPORT_ETA_KEY = 'pdf_import_avg_ms';

        function setPdfProcessingVisible(visible) {
            const overlay = document.getElementById('pdfProcessingOverlay');
            if (!overlay) return;
            overlay.style.display = visible ? 'flex' : 'none';
            if (!visible) {
                if (pdfProcessingTimer) clearInterval(pdfProcessingTimer);
                pdfProcessingTimer = null;
            }
        }

        function updatePdfProcessing(step, status, pct) {
            const statusEl = document.getElementById('pdfProcessingStatus');
            const stepEl = document.getElementById('pdfProcessingStep');
            const timeEl = document.getElementById('pdfProcessingTime');
            const fillEl = document.getElementById('pdfProcessingBarFill');
            if (statusEl) statusEl.textContent = status || 'Обработка…';
            if (stepEl) stepEl.textContent = step || '—';
            if (fillEl) fillEl.style.width = `${Math.max(5, Math.min(100, Number(pct) || 0))}%`;

            if (!pdfProcessingStartMs) return;
            const elapsedMs = Date.now() - pdfProcessingStartMs;
            const remainingMs = Math.max(0, pdfProcessingExpectedTotalMs - elapsedMs);
            const totalSec = Math.max(0, Math.ceil(remainingMs / 1000));
            const mm = Math.floor(totalSec / 60);
            const ss = String(totalSec % 60).padStart(2, '0');
            if (timeEl) timeEl.textContent = `${mm}:${ss}`;
        }

        function startPdfProcessing(step, status, pct) {
            pdfProcessingStartMs = Date.now();
            try {
                const saved = Number(localStorage.getItem(PDF_IMPORT_ETA_KEY));
                if (Number.isFinite(saved) && saved > 5000) {
                    pdfProcessingExpectedTotalMs = Math.min(Math.max(saved, 8000), 180000);
                } else {
                    pdfProcessingExpectedTotalMs = 45000;
                }
            } catch (_e) {
                pdfProcessingExpectedTotalMs = 45000;
            }
            setPdfProcessingVisible(true);
            updatePdfProcessing(step, status, pct);
            if (pdfProcessingTimer) clearInterval(pdfProcessingTimer);
            pdfProcessingTimer = setInterval(() => updatePdfProcessing(step, status, pct), 1000);
        }

        function stopPdfProcessing() {
            const elapsedMs = pdfProcessingStartMs ? (Date.now() - pdfProcessingStartMs) : 0;
            if (elapsedMs > 3000 && elapsedMs < 5 * 60 * 1000) {
                try {
                    const prev = Number(localStorage.getItem(PDF_IMPORT_ETA_KEY));
                    const next = Number.isFinite(prev) && prev > 0 ? Math.round(prev * 0.75 + elapsedMs * 0.25) : elapsedMs;
                    localStorage.setItem(PDF_IMPORT_ETA_KEY, String(next));
                } catch (_e) {}
            }
            pdfProcessingStartMs = 0;
            setPdfProcessingVisible(false);
        }

        function normalizeCategory(rawCategory, type) {
            const allowed = new Set([
                'Зарплата', 'Питание', 'Жилье', 'Транспорт',
                'Коммунальные услуги', 'Долги и кредиты',
                'Здоровье', 'Образование', 'Развлечения', 'Прочее'
            ]);
            const text = String(rawCategory || '').trim();
            if (allowed.has(text)) return text;
            const lc = text.toLowerCase();
            if (/зарплат|salary|доход|income/.test(lc)) return 'Зарплата';
            if (/еда|food|кафе|ресторан|супермаркет|продукт/.test(lc)) return 'Питание';
            if (/жиль|аренд|ипотек/.test(lc)) return 'Жилье';
            if (/транспорт|такси|авто|бензин|metro/.test(lc)) return 'Транспорт';
            if (/коммун|жкх|интернет|телефон/.test(lc)) return 'Коммунальные услуги';
            if (/долг|кредит|loan/.test(lc)) return 'Долги и кредиты';
            if (/здоров|мед|аптек/.test(lc)) return 'Здоровье';
            if (/образ|курс|школ|универс/.test(lc)) return 'Образование';
            if (/развлеч|кино|театр|игр/.test(lc)) return 'Развлечения';
            return type === 'income' ? 'Зарплата' : 'Прочее';
        }

        function normalizeAiTransaction(item, idx) {
            if (!item || typeof item !== 'object') return null;
            const rawDate = String(item.date || '').trim();
            const dateMatch = rawDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
            if (!dateMatch) return null;
            const dt = new Date(rawDate);
            if (Number.isNaN(dt.getTime())) return null;

            const amountNum = Number(item.amount);
            if (!Number.isFinite(amountNum) || amountNum <= 0) return null;

            let type = String(item.type || '').trim().toLowerCase();
            if (type !== 'income' && type !== 'expense') {
                type = detectTransactionType(item.description || '', amountNum);
            }

            const description = String(item.description || '').trim().slice(0, 200) || 'Импорт из банковской выписки (AI)';
            const category = normalizeCategory(item.category, type);

            return {
                id: `ai_pdf_${Date.now()}_${idx}`,
                type,
                amount: amountNum,
                date: rawDate,
                description,
                category,
                isRecurring: false
            };
        }

        const PDF_ALLOWED_CATEGORIES = [
            'Зарплата', 'Питание', 'Жилье', 'Транспорт',
            'Коммунальные услуги', 'Долги и кредиты',
            'Здоровье', 'Образование', 'Развлечения', 'Прочее'
        ];

        function isValidPreviewRow(row) {
            if (!row) return false;
            if (!/^\d{4}-\d{2}-\d{2}$/.test(String(row.date || ''))) return false;
            const amount = Number(row.amount);
            if (!Number.isFinite(amount) || amount <= 0) return false;
            if (row.type !== 'income' && row.type !== 'expense') return false;
            if (!PDF_ALLOWED_CATEGORIES.includes(String(row.category || ''))) return false;
            return true;
        }

        let pdfPreviewOriginal = [];
        let pdfPreviewDraft = [];

        function renderPdfPreview() {
            const tbody = document.getElementById('pdfPreviewTbody');
            const summary = document.getElementById('pdfPreviewSummary');
            if (!tbody || !summary) return;

            const total = pdfPreviewDraft.length;
            const validCount = pdfPreviewDraft.filter(isValidPreviewRow).length;
            summary.textContent = `Всего: ${total} • Валидных: ${validCount} • К импорту: ${validCount}`;

            if (!total) {
                tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding: 18px;">Нет операций</td></tr>';
                return;
            }

            const typeOptions = `
                <option value="income">Доход</option>
                <option value="expense">Расход</option>
            `;
            const categoryOptions = PDF_ALLOWED_CATEGORIES
                .map((c) => `<option value="${c}">${c}</option>`)
                .join('');

            tbody.innerHTML = pdfPreviewDraft.map((row, idx) => {
                const invalid = !isValidPreviewRow(row);
                const safeDesc = String(row.description || '');
                return `
                    <tr class="${invalid ? 'pdf-row-invalid' : ''}" data-row-idx="${idx}">
                        <td style="width: 140px;">
                            <input class="pdf-preview-input" type="date" value="${String(row.date || '')}" data-field="date" data-idx="${idx}">
                        </td>
                        <td style="width: 120px;">
                            <input class="pdf-preview-input" type="number" min="0.01" step="0.01" value="${Number(row.amount) || ''}" data-field="amount" data-idx="${idx}">
                        </td>
                        <td style="width: 120px;">
                            <select class="pdf-preview-input" data-field="type" data-idx="${idx}">
                                ${typeOptions}
                            </select>
                        </td>
                        <td style="width: 200px;">
                            <select class="pdf-preview-input" data-field="category" data-idx="${idx}">
                                ${categoryOptions}
                            </select>
                        </td>
                        <td>
                            <textarea class="pdf-preview-input" data-field="description" data-idx="${idx}">${safeDesc}</textarea>
                        </td>
                        <td style="width: 90px; text-align: right;">
                            <button type="button" class="btn btn-outline btn-sm" onclick="window.removePdfPreviewRow(${idx})">Удалить</button>
                        </td>
                    </tr>
                `;
            }).join('');

            // выставляем выбранные значения в select
            pdfPreviewDraft.forEach((row, idx) => {
                const typeSel = tbody.querySelector(`select[data-field="type"][data-idx="${idx}"]`);
                if (typeSel) typeSel.value = row.type === 'expense' ? 'expense' : 'income';
                const catSel = tbody.querySelector(`select[data-field="category"][data-idx="${idx}"]`);
                if (catSel) catSel.value = PDF_ALLOWED_CATEGORIES.includes(row.category) ? row.category : 'Прочее';
            });

            // единый обработчик изменений
            tbody.querySelectorAll('.pdf-preview-input').forEach((el) => {
                el.addEventListener('input', (e) => {
                    const target = e.target;
                    const field = target.getAttribute('data-field');
                    const i = Number(target.getAttribute('data-idx'));
                    if (!field || Number.isNaN(i) || !pdfPreviewDraft[i]) return;
                    const next = { ...pdfPreviewDraft[i] };
                    if (field === 'amount') next.amount = Number(target.value);
                    else next[field] = target.value;
                    // нормализация категории
                    if (field === 'category') next.category = normalizeCategory(next.category, next.type);
                    pdfPreviewDraft[i] = next;
                    renderPdfPreview();
                });
            });
        }

        function openPdfPreviewModal(validatedRows) {
            const modal = document.getElementById('pdfPreviewModal');
            if (!modal) return;
            pdfPreviewOriginal = Array.isArray(validatedRows) ? validatedRows.map((x) => ({ ...x })) : [];
            pdfPreviewDraft = Array.isArray(validatedRows) ? validatedRows.map((x) => ({ ...x })) : [];
            renderPdfPreview();
            modal.style.display = 'flex';
            if (typeof window.updateModalScrollLock === 'function') window.updateModalScrollLock();
        }

        function closePdfPreview() {
            const modal = document.getElementById('pdfPreviewModal');
            if (modal) modal.style.display = 'none';
            if (typeof window.updateModalScrollLock === 'function') window.updateModalScrollLock();
        }

        function removePdfPreviewRow(idx) {
            pdfPreviewDraft = pdfPreviewDraft.filter((_, i) => i !== idx);
            renderPdfPreview();
        }

        function removePdfPreviewInvalid() {
            pdfPreviewDraft = pdfPreviewDraft.filter(isValidPreviewRow);
            renderPdfPreview();
        }

        function resetPdfPreview() {
            pdfPreviewDraft = pdfPreviewOriginal.map((x) => ({ ...x }));
            renderPdfPreview();
        }

        function confirmPdfPreviewImport() {
            const toImport = pdfPreviewDraft
                .map((row, i) => normalizeAiTransaction(row, i))
                .filter(Boolean)
                .filter(isValidPreviewRow);

            if (!toImport.length) {
                alert('Нет валидных операций для импорта. Исправьте строки, подсвеченные красным.');
                return;
            }

            const ok = confirm(`Импортировать ${toImport.length} операций в календарь?`);
            if (!ok) return;

            transactions = [...transactions, ...toImport];
            saveToLocalStorage();
            renderCalendar();
            updateMonthStats();
            updateCashFlowChart();
            showNotification(`Импортировано ${toImport.length} операций из PDF`);
            closePdfPreview();
        }

        function detectTransactionType(description, amount) {
            const text = String(description || '').toLowerCase();
            if (amount < 0) return 'expense';
            if (amount > 0 && /(поступ|зачисл|salary|зарплат|возврат|refund|перевод от|cashback|кэшбэк)/i.test(text)) {
                return 'income';
            }
            return amount >= 0 ? 'income' : 'expense';
        }

        function detectCategory(description, type) {
            const text = String(description || '').toLowerCase();
            const byKeyword = [
                { category: 'Питание', re: /(магнит|пятерочка|пятёрочка|вкусвилл|перекресток|перекрёсток|кафе|ресторан|food|delivery|самокат|яндекс\.?еда|yandex\.?eda|kfc|mcd|burger|coffee)/i },
                { category: 'Транспорт', re: /(такси|yandex go|яндекс go|metro|метро|автобус|трамвай|троллейбус|azs|газпромнефть|лукойл|shell|топливо|бензин|парковк)/i },
                { category: 'Коммунальные услуги', re: /(жкх|коммун|электро|вода|газ|интернет|мобильн|телефон|ростелеком|билайн|мтс|tele2|megafon|квартплат)/i },
                { category: 'Жилье', re: /(аренда|ипотек|rent|квартира|жилье|жильё)/i },
                { category: 'Здоровье', re: /(аптека|клиник|больниц|мед|стомат|лекарств)/i },
                { category: 'Образование', re: /(курс|обучен|школ|универс|udemy|coursera|skillbox|stepik)/i },
                { category: 'Развлечения', re: /(кино|театр|netflix|spotify|игр|steam|развлеч|concert|концерт)/i },
                { category: 'Долги и кредиты', re: /(кредит|loan|займ|долг|погашен|процент по кредиту|банк)/i },
                { category: 'Зарплата', re: /(зарплат|salary|аванс|преми|bonus|payroll)/i }
            ];
            const found = byKeyword.find((m) => m.re.test(text));
            if (found) return found.category;
            return type === 'income' ? 'Зарплата' : 'Прочее';
        }

        function parseDateFromText(text) {
            const src = String(text || '');
            const match = src.match(/\b(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{2,4})\b/);
            if (!match) return null;
            const day = Number(match[1]);
            const month = Number(match[2]);
            let year = Number(match[3]);
            if (year < 100) year += 2000;
            if (!day || !month || !year) return null;
            return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        }

        function parseAmountFromText(text) {
            const src = String(text || '');
            // Для выписок банков используем сумму с запятой, чтобы не ловить даты вида 27.02.2026
            const match = src.match(/([+\-]?\d[\d\s]*,\d{2})/);
            if (!match) return null;
            const normalized = match[1].replace(/\s+/g, '').replace(',', '.');
            const value = Number(normalized);
            return Number.isFinite(value) ? value : null;
        }

        function extractTransactionsFromPdfText(fullText) {
            const source = String(fullText || '');
            const normalizedText = source
                .replace(/\u00A0/g, ' ')
                .replace(/\u202F/g, ' ')
                .replace(/\u2009/g, ' ')
                .replace(/\u2212/g, '-')
                .replace(/\r/g, '\n')
                .replace(/[ \t]+/g, ' ')
                .replace(/\n{2,}/g, '\n')
                .trim();

            const result = [];

            function pushParsed(segment, dateToken, idx) {
                const date = parseDateFromText(dateToken || segment);
                if (!date) return;
                const amountMatch = segment.match(/([+\-]?\d[\d ]*,\d{2})\s*KZT/i) || segment.match(/([+\-]?\d[\d ]*,\d{2})/);
                if (!amountMatch) return;
                const amountRaw = parseAmountFromText(amountMatch[1]);
                if (amountRaw === null) return;
                const amount = Math.abs(amountRaw);
                if (!Number.isFinite(amount) || amount <= 0) return;

                let desc = segment
                    .replace(/\b\d{1,2}[.\-/]\d{1,2}[.\-/]\d{2,4}\b/g, ' ')
                    .replace(new RegExp(amountMatch[1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), ' ')
                    .replace(/\bKZT\b/gi, ' ')
                    .replace(/\b(Валюта операции|Приход в валюте счета|Расход в валюте счета|Комиссия|№ карточки\/счета|Всего:|Дата проведения операции|Дата обработки операции|Описание операции)\b/gi, ' ')
                    .replace(/\s{2,}/g, ' ')
                    .trim();
                if (!desc || desc.length < 2) {
                    desc = 'Импорт из банковской выписки';
                }

                const type = detectTransactionType(desc, amountRaw);
                const category = detectCategory(desc, type);
                result.push({
                    id: `pdf_${Date.now()}_${idx}`,
                    type,
                    amount,
                    date,
                    description: desc,
                    category,
                    isRecurring: false
                });
            }

            // Стратегия 1: сегменты между парой дат (дата проведения + дата обработки)
            const startRe = /(\d{1,2}[.\-/]\d{1,2}[.\-/]\d{2,4})\s+(\d{1,2}[.\-/]\d{1,2}[.\-/]\d{2,4})/g;
            const starts = [];
            let m;
            while ((m = startRe.exec(normalizedText)) !== null) {
                starts.push({ idx: m.index, date1: m[1], date2: m[2] });
            }
            for (let i = 0; i < starts.length; i++) {
                const cur = starts[i];
                const nextIdx = i + 1 < starts.length ? starts[i + 1].idx : normalizedText.length;
                const segment = normalizedText.slice(cur.idx, nextIdx).trim();
                if (segment) pushParsed(segment, cur.date1, i);
            }

            // Стратегия 2: построчно с "дотягиванием" описания, если первая не дала результатов
            if (result.length === 0) {
                const lines = normalizedText.split('\n').map((l) => l.trim()).filter(Boolean);
                const lineStartRe = /^(\d{1,2}[.\-/]\d{1,2}[.\-/]\d{2,4})(?:\s+(\d{1,2}[.\-/]\d{1,2}[.\-/]\d{2,4}))?/;
                for (let i = 0; i < lines.length; i++) {
                    const s = lineStartRe.exec(lines[i]);
                    if (!s) continue;
                    const dateToken = s[1];
                    let segment = lines[i];
                    for (let j = i + 1; j < Math.min(i + 6, lines.length); j++) {
                        if (lineStartRe.test(lines[j])) break;
                        segment += ' ' + lines[j];
                    }
                    pushParsed(segment, dateToken, `ln_${i}`);
                }
            }

            const unique = [];
            const seen = new Set();
            result.forEach((t) => {
                const key = `${t.date}|${t.type}|${t.amount}|${t.description}`;
                if (!seen.has(key)) {
                    seen.add(key);
                    unique.push(t);
                }
            });
            return unique;
        }

        async function ensurePdfJsLoaded() {
            const getPdfGlobal = () => (
                window.pdfjsLib ||
                window.pdfjsDistBuildPdf ||
                window['pdfjs-dist/build/pdf'] ||
                window.pdfjs ||
                null
            );

            const already = getPdfGlobal();
            if (already) return already;

            const scriptUrls = [
                'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.7.76/legacy/build/pdf.min.js',
                'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.7.76/legacy/build/pdf.min.js',
                'https://unpkg.com/pdfjs-dist@4.7.76/legacy/build/pdf.min.js'
            ];

            for (let i = 0; i < scriptUrls.length; i++) {
                const url = scriptUrls[i];
                try {
                    await new Promise((resolve, reject) => {
                        const script = document.createElement('script');
                        script.src = url;
                        script.async = true;
                        script.onload = () => resolve();
                        script.onerror = () => reject(new Error(`Не удалось загрузить ${url}`));
                        document.head.appendChild(script);
                    });
                    const loaded = getPdfGlobal();
                    if (loaded) return loaded;
                } catch (_e) {
                    // пробуем следующий CDN
                }
            }

            throw new Error('Библиотека PDF не загружена');
        }

        async function readPdfText(file) {
            const buffer = await file.arrayBuffer();

            // Основной путь: PDF.js
            try {
                const pdfjsLib = await ensurePdfJsLoaded();
                if (pdfjsLib.GlobalWorkerOptions) {
                    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.7.76/legacy/build/pdf.worker.min.js';
                }
                // disableWorker: true снимает проблемы postMessage/COOP в некоторых окружениях
                const loadingTask = pdfjsLib.getDocument({ data: buffer, disableWorker: true });
                const pdf = await loadingTask.promise;
                let text = '';

                for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
                    const page = await pdf.getPage(pageNum);
                    const content = await page.getTextContent();
                    const items = (content.items || []).map((item) => ({
                        str: item.str || '',
                        x: Array.isArray(item.transform) ? item.transform[4] : 0,
                        y: Array.isArray(item.transform) ? item.transform[5] : 0
                    }));
                    const linesMap = new Map();
                    items.forEach((it) => {
                        const yKey = String(Math.round(it.y));
                        if (!linesMap.has(yKey)) linesMap.set(yKey, []);
                        linesMap.get(yKey).push(it);
                    });
                    const yKeys = Array.from(linesMap.keys()).map(Number).sort((a, b) => b - a);
                    const pageLines = yKeys.map((y) => {
                        const lineItems = (linesMap.get(String(y)) || []).sort((a, b) => a.x - b.x);
                        return lineItems.map((it) => it.str).join(' ').replace(/\s{2,}/g, ' ').trim();
                    }).filter(Boolean);
                    text += `\n${pageLines.join('\n')}`;
                }
                if (text && text.trim().length > 20) {
                    return text;
                }
            } catch (_e) {
                // fallback ниже
            }

            // Fallback 1: распаковываем stream-блоки PDF через pako (FlateDecode)
            let inflatedText = '';
            try {
                const bytes = new Uint8Array(buffer);
                let rawLatin1 = '';
                for (let i = 0; i < bytes.length; i++) rawLatin1 += String.fromCharCode(bytes[i]);

                if (window.pako) {
                    const streamRe = /stream[\r\n]+([\s\S]*?)endstream/g;
                    let m;
                    while ((m = streamRe.exec(rawLatin1)) !== null) {
                        const chunk = m[1] || '';
                        const chunkBytes = new Uint8Array(chunk.length);
                        for (let j = 0; j < chunk.length; j++) {
                            chunkBytes[j] = chunk.charCodeAt(j) & 0xff;
                        }
                        try {
                            const out = window.pako.inflate(chunkBytes, { to: 'string' });
                            if (out && out.length > 20) {
                                inflatedText += '\n' + out;
                            }
                        } catch (_inflateErr) {
                            // не каждый stream deflate-кодирован — это нормально
                        }
                    }
                }
            } catch (_e) {
                // игнорируем, пойдем дальше
            }

            // Fallback 2: пытаемся извлечь текст напрямую из PDF-байтов
            const decoders = ['utf-8', 'windows-1251', 'latin1'];
            let best = '';
            for (let i = 0; i < decoders.length; i++) {
                try {
                    const raw = new TextDecoder(decoders[i]).decode(buffer);
                    // Берем только печатные фрагменты и приводим в строки
                    const chunks = raw
                        .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, ' ')
                        .split(/[\r\n]+/)
                        .map((s) => s.trim())
                        .filter((s) => s.length > 2);
                    const candidate = chunks.join('\n');
                    if (candidate.length > best.length) {
                        best = candidate;
                    }
                } catch (_err) {
                    // пробуем следующий decoder
                }
            }

            const merged = [inflatedText, best].filter(Boolean).join('\n');
            if (!merged || merged.length < 20) {
                throw new Error('Не удалось извлечь текст из PDF');
            }
            return merged;
        }

        // Обработчик выбора файла для импорта
        document.getElementById('importFile').addEventListener('change', function(event) {
            const file = event.target.files[0];
            if (!file) return;

            const reader = new FileReader();
            reader.onload = function(e) {
                try {
                    const importedData = JSON.parse(e.target.result);
                    
                    if (importedData.transactions && importedData.recurringTemplates) {
                        if (confirm('Заменить текущие данные импортированными? Все текущие данные будут потеряны.')) {
                            transactions = importedData.transactions;
                            recurringTemplates = importedData.recurringTemplates;
                            saveToLocalStorage();
                            renderCalendar();
                            updateMonthStats();
                            updateCashFlowChart();
                            showNotification('Данные успешно импортированы!');
                        }
                    } else {
                        alert('Неверный формат файла. Файл должен содержать данные календаря.');
                    }
                } catch (error) {
                    alert('Ошибка при чтении файла: ' + error.message);
                }
            };
            reader.readAsText(file);
            
            // Сброс значения input, чтобы можно было выбрать тот же файл снова
            event.target.value = '';
        });

        document.getElementById('bankStatementFile').addEventListener('change', async function(event) {
            const file = event.target.files[0];
            if (!file) return;

            try {
                if (location.protocol === 'file:') {
                    alert('Импорт выписки PDF работает только при запуске через HTTP(S). Запустите локальный сервер.');
                    return;
                }
                startPdfProcessing('1/4', 'Подготовка файла…', 10);
                const formData = new FormData();
                formData.append('statement', file);

                updatePdfProcessing('2/4', 'Отправка на сервер…', 25);
                const response = await fetch('/api/parse-bank-pdf', {
                    method: 'POST',
                    body: formData
                });
                updatePdfProcessing('3/4', 'Распознавание и разбор…', 60);
                const payload = await response.json().catch(() => ({}));
                if (!response.ok || !payload.success) {
                    throw new Error(payload.message || `HTTP ${response.status}`);
                }
                const rawTransactions = Array.isArray(payload.transactions) ? payload.transactions : [];
                updatePdfProcessing('4/4', 'Валидация и подготовка импорта…', 85);
                const validated = rawTransactions
                    .map((t, i) => normalizeAiTransaction(t, i))
                    .filter(Boolean);

                if (!validated.length) {
                    alert('AI вернул данные, но они не прошли валидацию. Проверьте формат ответа endpoint.');
                    return;
                }

                stopPdfProcessing();
                openPdfPreviewModal(validated);
            } catch (error) {
                console.error('PDF import error:', error);
                alert(`Ошибка импорта PDF: ${error.message}`);
            } finally {
                stopPdfProcessing();
                event.target.value = '';
            }
        });

        // Очистка всех данных
        function clearAllData() {
            if (confirm('Вы уверены, что хотите удалить все данные? Это действие нельзя отменить.')) {
                transactions = [];
                recurringTemplates = [];
                saveToLocalStorage();
                renderCalendar();
                updateMonthStats();
                updateCashFlowChart();
                showNotification('Все данные удалены!');
            }
        }

        // Показать справку
        function showHelp() {
            openModal('helpModal');
        }

        // Закрыть справку
        function closeHelpModal() {
            closeModalById('helpModal');
        }

        // Focus trap и закрытие по Escape для открытых модалок
        document.addEventListener('keydown', (event) => {
            const openModalElement = Array.from(document.querySelectorAll('.modal, .auth-modal'))
                .find(modal => window.getComputedStyle(modal).display !== 'none');

            if (!openModalElement) return;

            if (event.key === 'Escape') {
                if (openModalElement.id === 'dayModal') closeModal();
                if (openModalElement.id === 'recurringModal') closeRecurringModal();
                if (openModalElement.id === 'helpModal') closeHelpModal();
                if (openModalElement.id === 'editTransactionModal') closeEditModal();
                return;
            }

            if (event.key !== 'Tab') return;

            const focusables = getFocusableElements(openModalElement);
            if (focusables.length === 0) return;

            const first = focusables[0];
            const last = focusables[focusables.length - 1];

            if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first.focus();
            }
        });

        // Закрытие модального окна при клике вне его
        window.onclick = function(event) {
            const dayModal = document.getElementById('dayModal');
            const helpModal = document.getElementById('helpModal');
            const recurringModal = document.getElementById('recurringModal');
            const editModal = document.getElementById('editTransactionModal');
            
            if (event.target === dayModal) {
                closeModal();
            }
            if (event.target === helpModal) {
                closeHelpModal();
            }
            if (event.target === recurringModal) {
                closeRecurringModal();
            }
            if (event.target === editModal) {
                closeEditModal();
            }
        }


        // Переключение темы уже определено в inline скрипте в head
        // Дополнительная проверка не нужна, функция уже доступна

        // Функции фильтров (для немедленной доступности)
        window.showFilters = window.showFilters || function() {
            const panel = document.getElementById('filtersPanel');
            if (panel) {
                const isHidden = panel.style.display === 'none' || !panel.style.display;
                panel.style.display = isHidden ? 'block' : 'none';
            }
        };
        
        window.closeFilters = window.closeFilters || function() {
            const panel = document.getElementById('filtersPanel');
            if (panel) {
                panel.style.display = 'none';
            }
        };
        
        window.applyFilters = window.applyFilters || function() {
            const filters = {
                type: document.getElementById('filterType')?.value || '',
                category: document.getElementById('filterCategory')?.value || '',
                dateFrom: document.getElementById('filterDateFrom')?.value || '',
                dateTo: document.getElementById('filterDateTo')?.value || '',
                minAmount: parseFloat(document.getElementById('filterMinAmount')?.value) || null,
                maxAmount: parseFloat(document.getElementById('filterMaxAmount')?.value) || null
            };
            
            window.currentFilters = filters;
            
            if (typeof renderCalendar === 'function') renderCalendar();
            if (typeof updateMonthStats === 'function') updateMonthStats();
            
            if (typeof showNotification === 'function') {
                showNotification('Фильтры применены');
            }
        };
        
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
            
            if (typeof renderCalendar === 'function') renderCalendar();
            if (typeof updateMonthStats === 'function') updateMonthStats();
            
            if (typeof showNotification === 'function') {
                showNotification('Фильтры сброшены');
            }
        };

        // Экспорт обработчиков для inline onclick в index.html
        window.switchTab = switchTab;
        window.changeChartView = changeChartView;
        window.closeModal = closeModal;
        window.addTransaction = addTransaction;
        window.addRecurringTransaction = addRecurringTransaction;
        window.addQuickTransaction = addQuickTransaction;
        window.deleteTransaction = deleteTransaction;
        window.showRecurringTransactions = showRecurringTransactions;
        window.closeRecurringModal = closeRecurringModal;
        window.exportData = exportData;
        window.importData = importData;
        window.importBankStatementPdf = importBankStatementPdf;
        window.closePdfPreview = closePdfPreview;
        window.removePdfPreviewRow = removePdfPreviewRow;
        window.removePdfPreviewInvalid = removePdfPreviewInvalid;
        window.resetPdfPreview = resetPdfPreview;
        window.confirmPdfPreviewImport = confirmPdfPreviewImport;
        window.clearAllData = clearAllData;
        window.showHelp = showHelp;
        window.closeHelpModal = closeHelpModal;
        window.focusCashGapDay = focusCashGapDay;
        window.updateMonthStats = updateMonthStats;

        // Fallback handlers, если доп. функции не подключены отдельно
        if (typeof window.dismissOnboarding !== 'function') {
            window.dismissOnboarding = function() {
                const hint = document.getElementById('onboardingHint');
                if (hint) hint.style.display = 'none';
                try {
                    localStorage.setItem('onboardingDismissed', '1');
                } catch (_e) {}
            };
        }

        // Инициализация при загрузке
        document.addEventListener('DOMContentLoaded', () => {
            // Тема уже инициализирована в начале файла
            // Дополнительно обновляем UI если нужно
            try {
                const currentUser = window.authManager ? window.authManager.getCurrentUser() : null;
                const settingsKey = currentUser ? 
                    (
                        window.StorageManager && typeof window.StorageManager.getUserKey === 'function'
                            ? window.StorageManager.getUserKey('settings')
                            : `user_${currentUser.id}_settings`
                    ) :
                    'settings';
                const settings = JSON.parse(localStorage.getItem(settingsKey) || '{}');
                const theme = settings.theme || 'light';
                if (document.documentElement.getAttribute('data-theme') !== theme) {
                    document.documentElement.setAttribute('data-theme', theme);
                }
            } catch (e) {
                console.error('Error loading theme:', e);
            }
            
            // Инициализируем приложение только если пользователь авторизован
            // Проверка происходит в authUI, который вызывает initApp после входа
            if (window.authManager && window.authManager.isAuthenticated()) {
                initApp();
            }

            const quickMenu = document.querySelector('.quick-menu');
            if (quickMenu) {
                document.addEventListener('click', (event) => {
                    if (!quickMenu.contains(event.target)) {
                        quickMenu.removeAttribute('open');
                    }
                });

                quickMenu.querySelectorAll('.quick-menu-item').forEach((item) => {
                    item.addEventListener('click', () => quickMenu.removeAttribute('open'));
                });
            }
        });
        
        // Делаем initApp доступной глобально для вызова после авторизации
        window.initApp = initApp;
        })();

