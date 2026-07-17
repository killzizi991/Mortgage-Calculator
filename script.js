// script.js
class EarlyPayment {
    constructor(appliedDate, amount) {
        this.appliedDate = appliedDate; // строка YYYY-MM-DD, на которую привязана досрочка
        this.amount = amount;
    }
}

class Mortgage {
    constructor({ id, name, price, downPayment, rate, termMonths, firstPaymentDate, earlyPayments = [] }) {
        this.id = id;
        this.name = name;
        this.price = price;
        this.downPayment = downPayment;
        this.rate = rate;
        this.termMonths = termMonths;
        this.firstPaymentDate = firstPaymentDate;
        this.earlyPayments = earlyPayments.map(ep => new EarlyPayment(ep.appliedDate, ep.amount));
    }

    get loanAmount() {
        return this.price - this.downPayment;
    }

    get monthlyRate() {
        return this.rate / 12 / 100;
    }

    computePMT() {
        const P = this.loanAmount;
        const r = this.monthlyRate;
        const n = this.termMonths;
        if (P <= 0 || n <= 0) return 0;
        if (r === 0) return P / n;
        const pmt = P * (r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1);
        return Math.round(pmt * 100) / 100;
    }

    // Генерация полного графика с учетом досрочек
    generateFullSchedule() {
        const P = this.loanAmount;
        const r = this.monthlyRate;
        const basePMT = this.computePMT();
        if (P <= 0) return [];

        // Собираем карту досрочек по датам (суммируем, если несколько на одну дату)
        const earlyMap = new Map();
        this.earlyPayments.forEach(ep => {
            const d = ep.appliedDate;
            earlyMap.set(d, (earlyMap.get(d) || 0) + ep.amount);
        });

        const schedule = [];
        let balance = Math.round(P * 100) / 100;
        const startDate = new Date(this.firstPaymentDate);
        const targetDay = startDate.getDate();
        let monthIndex = 0;

        while (balance > 0.005) {
            // Вычисляем дату этого платежа
            const year = startDate.getFullYear();
            const month = startDate.getMonth() + monthIndex;
            const maxDay = new Date(year, month + 1, 0).getDate();
            const actualDay = Math.min(targetDay, maxDay);
            const payDate = new Date(year, month, actualDay);
            const dateStr = payDate.toISOString().slice(0, 10);

            // Проценты за месяц
            const interest = Math.round(balance * r * 100) / 100;
            // Платеж (не больше остатка + проценты)
            let payment = basePMT;
            if (balance + interest < payment) {
                payment = Math.round((balance + interest) * 100) / 100;
            }
            let principal = Math.round((payment - interest) * 100) / 100;
            if (principal > balance) principal = balance;

            // Досрочное погашение в эту дату
            const extra = earlyMap.get(dateStr) || 0;

            // Обновление остатка
            balance = Math.round((balance - principal - extra) * 100) / 100;
            if (balance < 0) balance = 0;

            schedule.push({
                index: monthIndex + 1,
                date: dateStr,
                payment: payment,
                interest: interest,
                principal: principal,
                extraPayment: extra,
                isEarlyPayment: extra > 0,
                balanceAfter: balance
            });

            if (balance === 0) break;
            monthIndex++;
        }
        return schedule;
    }

    // График без досрочек
    generateBaseSchedule() {
        const savedEarly = this.earlyPayments;
        this.earlyPayments = [];
        const schedule = this.generateFullSchedule();
        this.earlyPayments = savedEarly;
        return schedule;
    }

    getTotalInterest() {
        const sched = this.generateFullSchedule();
        return sched.reduce((sum, m) => sum + m.interest, 0);
    }

    getBaseTotalInterest() {
        const sched = this.generateBaseSchedule();
        return sched.reduce((sum, m) => sum + m.interest, 0);
    }

    // Поиск ближайшей даты платежа >= inputDate в текущем графике (с досрочками)
    findNextPaymentDate(inputDateStr) {
        const schedule = this.generateFullSchedule();
        if (schedule.length === 0) return null;
        const target = new Date(inputDateStr);
        for (let m of schedule) {
            const d = new Date(m.date);
            if (d >= target) return m.date;
        }
        return null;
    }
}

// ========== Глобальное состояние ==========
const STORAGE_KEY = 'mortgageCalculatorData';

let state = {
    mortgages: [],
    view: 'list', // 'list', 'detail', 'compare'
    selectedId: null,
    compareIds: []
};

// ========== Утилиты ==========
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function formatCurrency(value) {
    return new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', minimumFractionDigits: 2 }).format(value);
}

function formatDate(dateStr) {
    const d = new Date(dateStr);
    return d.toLocaleDateString('ru-RU');
}

function saveState() {
    const serializable = {
        mortgages: state.mortgages.map(m => ({
            id: m.id,
            name: m.name,
            price: m.price,
            downPayment: m.downPayment,
            rate: m.rate,
            termMonths: m.termMonths,
            firstPaymentDate: m.firstPaymentDate,
            earlyPayments: m.earlyPayments.map(ep => ({ appliedDate: ep.appliedDate, amount: ep.amount }))
        })),
        view: state.view,
        selectedId: state.selectedId,
        compareIds: state.compareIds
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(serializable));
}

function loadState() {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    try {
        const data = JSON.parse(raw);
        state.mortgages = data.mortgages.map(m => new Mortgage(m));
        state.view = data.view || 'list';
        state.selectedId = data.selectedId || null;
        state.compareIds = data.compareIds || [];
    } catch (e) {
        console.error('Ошибка загрузки данных', e);
    }
}

function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
}

// ========== Рендеринг ==========
const mainContent = document.getElementById('main-content');
const tabMortgages = document.getElementById('tab-mortgages');
const tabCompare = document.getElementById('tab-compare');

function switchTab(view) {
    state.view = view;
    if (view === 'compare') state.selectedId = null; // сброс детального вида
    updateTabs();
    render();
}

function updateTabs() {
    tabMortgages.classList.toggle('active', state.view !== 'compare');
    tabCompare.classList.toggle('active', state.view === 'compare');
}

tabMortgages.addEventListener('click', () => switchTab('list'));
tabCompare.addEventListener('click', () => switchTab('compare'));

function render() {
    if (state.view === 'compare') {
        renderCompareView();
    } else if (state.view === 'detail' && state.selectedId) {
        const mortgage = state.mortgages.find(m => m.id === state.selectedId);
        if (mortgage) {
            renderDetailView(mortgage);
        } else {
            state.view = 'list';
            state.selectedId = null;
            renderListView();
        }
    } else {
        state.view = 'list';
        state.selectedId = null;
        renderListView();
    }
    saveState();
}

function renderListView() {
    const html = `
        <div class="form-section" id="add-edit-form-container"></div>
        <div class="mortgage-list" id="mortgage-list"></div>
    `;
    mainContent.innerHTML = html;
    renderAddEditForm(null);
    renderMortgageCards();
}

function renderMortgageCards() {
    const listEl = document.getElementById('mortgage-list');
    if (!listEl) return;
    if (state.mortgages.length === 0) {
        listEl.innerHTML = '<p style="text-align:center; color:#64748b; padding:20px;">Нет сохранённых предложений. Добавьте первую ипотеку.</p>';
        return;
    }
    listEl.innerHTML = state.mortgages.map(m => {
        const pmt = m.computePMT();
        return `
            <div class="mortgage-card" data-id="${m.id}">
                <div class="info">
                    <div class="name">${escapeHtml(m.name)}</div>
                    <div class="details">
                        Кредит: ${formatCurrency(m.loanAmount)} | Ставка: ${m.rate}% | Платёж: ${formatCurrency(pmt)}/мес.
                    </div>
                </div>
                <div class="actions">
                    <button class="btn small" data-action="view-detail" data-id="${m.id}">📊 График</button>
                    <button class="btn small" data-action="edit-mortgage" data-id="${m.id}">✏️</button>
                    <button class="btn small danger" data-action="delete-mortgage" data-id="${m.id}">🗑️</button>
                </div>
            </div>
        `;
    }).join('');
}

function renderAddEditForm(editMortgage) {
    const container = document.getElementById('add-edit-form-container');
    if (!container) return;
    const isEdit = !!editMortgage;
    const m = editMortgage || {};
    container.innerHTML = `
        <h3 style="margin-bottom:12px;">${isEdit ? 'Редактировать предложение' : 'Добавить ипотечное предложение'}</h3>
        <div class="form-grid">
            <div class="form-group">
                <label>Название банка</label>
                <input type="text" id="mort-name" value="${isEdit ? escapeHtml(m.name) : ''}" placeholder="Сбер, ВТБ...">
            </div>
            <div class="form-group">
                <label>Цена квартиры (₽)</label>
                <input type="number" id="mort-price" value="${isEdit ? m.price : ''}" placeholder="5000000" min="0">
            </div>
            <div class="form-group">
                <label>Первоначальный взнос (₽)</label>
                <input type="number" id="mort-down" value="${isEdit ? m.downPayment : ''}" placeholder="1000000" min="0">
            </div>
            <div class="form-group">
                <label>Процентная ставка (% годовых)</label>
                <input type="number" id="mort-rate" value="${isEdit ? m.rate : ''}" placeholder="10.5" step="0.01" min="0">
            </div>
            <div class="form-group">
                <label>Срок (месяцев)</label>
                <input type="number" id="mort-term" value="${isEdit ? m.termMonths : ''}" placeholder="180" min="1">
            </div>
            <div class="form-group">
                <label>Дата первого платежа</label>
                <input type="date" id="mort-firstdate" value="${isEdit ? m.firstPaymentDate : ''}">
            </div>
        </div>
        <div class="flex-row" style="margin-top:14px;">
            <button class="btn primary" id="save-mortgage-btn">${isEdit ? 'Сохранить изменения' : 'Добавить'}</button>
            ${isEdit ? '<button class="btn" id="cancel-edit-btn">Отмена</button>' : ''}
        </div>
        ${isEdit ? '<p style="margin-top:8px; color:#b91c1c; font-size:0.85rem;">⚠️ При сохранении все досрочные погашения будут сброшены.</p>' : ''}
    `;

    document.getElementById('save-mortgage-btn').addEventListener('click', () => {
        const name = document.getElementById('mort-name').value.trim();
        const price = parseFloat(document.getElementById('mort-price').value);
        const down = parseFloat(document.getElementById('mort-down').value);
        const rate = parseFloat(document.getElementById('mort-rate').value);
        const term = parseInt(document.getElementById('mort-term').value, 10);
        const firstDate = document.getElementById('mort-firstdate').value;
        if (!name || isNaN(price) || isNaN(down) || isNaN(rate) || isNaN(term) || !firstDate) {
            alert('Заполните все поля корректно.');
            return;
        }
        if (down >= price) {
            alert('Первоначальный взнос не может быть больше или равен цене квартиры.');
            return;
        }
        if (isEdit) {
            const existing = state.mortgages.find(m => m.id === m.id);
            if (existing) {
                existing.name = name;
                existing.price = price;
                existing.downPayment = down;
                existing.rate = rate;
                existing.termMonths = term;
                existing.firstPaymentDate = firstDate;
                existing.earlyPayments = []; // сброс досрочек
            }
        } else {
            const newMort = new Mortgage({
                id: generateId(),
                name,
                price,
                downPayment: down,
                rate,
                termMonths: term,
                firstPaymentDate: firstDate,
                earlyPayments: []
            });
            state.mortgages.push(newMort);
        }
        saveState();
        renderListView();
    });

    if (isEdit) {
        document.getElementById('cancel-edit-btn').addEventListener('click', () => {
            renderListView();
        });
    }
}

function renderDetailView(mortgage) {
    const schedule = mortgage.generateFullSchedule();
    const baseInterest = mortgage.getBaseTotalInterest();
    const totalInterest = mortgage.getTotalInterest();
    const pmt = mortgage.computePMT();

    let earlyRowsHtml = mortgage.earlyPayments.map((ep, idx) => `
        <tr>
            <td>${formatDate(ep.appliedDate)}</td>
            <td>${formatCurrency(ep.amount)}</td>
            <td><button class="btn small danger" data-action="delete-early" data-index="${idx}">Удалить</button></td>
        </tr>
    `).join('');

    const scheduleRows = schedule.map(m => `
        <tr class="${m.isEarlyPayment ? 'early-payment' : ''}">
            <td>${m.index}</td>
            <td>${formatDate(m.date)}</td>
            <td>${formatCurrency(m.payment)}</td>
            <td>${formatCurrency(m.interest)}</td>
            <td>${formatCurrency(m.principal)}</td>
            <td>${formatCurrency(m.balanceAfter)}</td>
        </tr>
    `).join('');

    const html = `
        <button class="btn back-link" id="back-to-list">← К списку ипотек</button>
        <div class="mortgage-card">
            <div class="info">
                <div class="name">${escapeHtml(mortgage.name)}</div>
                <div class="details">
                    Кредит: ${formatCurrency(mortgage.loanAmount)} | Ставка: ${mortgage.rate}% | Срок: ${mortgage.termMonths} мес.<br>
                    Платёж: ${formatCurrency(pmt)}/мес. | Первый платёж: ${formatDate(mortgage.firstPaymentDate)}
                </div>
            </div>
        </div>

        <div class="form-section">
            <h4>Досрочное погашение</h4>
            <div class="flex-row" style="margin-top:8px;">
                <div class="form-group">
                    <label>Дата внесения</label>
                    <input type="date" id="early-date">
                </div>
                <div class="form-group">
                    <label>Сумма (₽)</label>
                    <input type="number" id="early-amount" placeholder="50000" min="1">
                </div>
                <button class="btn primary" id="add-early-btn" style="margin-top:20px;">Добавить</button>
            </div>
            <p style="font-size:0.8rem; margin-top:6px; color:#4a6272;">Дата будет автоматически привязана к ближайшему будущему плановому платежу.</p>
            ${mortgage.earlyPayments.length > 0 ? `
                <div style="margin-top:14px;">
                    <strong>Добавленные досрочки:</strong>
                    <table style="margin-top:6px;">
                        <thead><tr><th>Дата платежа</th><th>Сумма</th><th></th></tr></thead>
                        <tbody>${earlyRowsHtml}</tbody>
                    </table>
                </div>
            ` : ''}
        </div>

        <div class="form-section">
            <h4>Сводка</h4>
            <p>Общая сумма процентов (без досрочек): ${formatCurrency(baseInterest)}</p>
            <p>Общая сумма процентов (с досрочками): ${formatCurrency(totalInterest)}</p>
            ${mortgage.earlyPayments.length > 0 ? `<p>Экономия: ${formatCurrency(baseInterest - totalInterest)}</p>` : ''}
            <p>Фактический срок: ${schedule.length} мес.</p>
        </div>

        <div class="table-container">
            <table>
                <thead>
                    <tr>
                        <th>№</th><th>Дата</th><th>Платёж</th><th>Проценты</th><th>Осн. долг</th><th>Остаток</th>
                    </tr>
                </thead>
                <tbody>${scheduleRows}</tbody>
            </table>
        </div>
    `;

    mainContent.innerHTML = html;

    document.getElementById('back-to-list').addEventListener('click', () => {
        state.view = 'list';
        state.selectedId = null;
        render();
    });

    document.getElementById('add-early-btn').addEventListener('click', () => {
        const dateInput = document.getElementById('early-date').value;
        const amount = parseFloat(document.getElementById('early-amount').value);
        if (!dateInput || isNaN(amount) || amount <= 0) {
            alert('Введите корректную дату и сумму.');
            return;
        }
        const nextDate = mortgage.findNextPaymentDate(dateInput);
        if (!nextDate) {
            alert('Невозможно добавить досрочку: дата выходит за пределы срока кредита.');
            return;
        }
        if (nextDate !== dateInput) {
            if (!confirm(`Досрочное погашение будет привязано к дате платежа ${formatDate(nextDate)}. Продолжить?`)) return;
        }
        mortgage.earlyPayments.push(new EarlyPayment(nextDate, amount));
        saveState();
        renderDetailView(mortgage);
    });

    // Удаление досрочки через делегирование
    mainContent.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-action="delete-early"]');
        if (!btn) return;
        const index = parseInt(btn.dataset.index, 10);
        if (!isNaN(index) && index >= 0 && index < mortgage.earlyPayments.length) {
            mortgage.earlyPayments.splice(index, 1);
            saveState();
            renderDetailView(mortgage);
        }
    });
}

function renderCompareView() {
    // Отбираем выбранные ипотеки
    const selectedMortgages = state.mortgages.filter(m => state.compareIds.includes(m.id));

    const checkboxesHtml = state.mortgages.map(m => `
        <label style="display:flex; align-items:center; gap:8px; margin-bottom:8px;">
            <input type="checkbox" class="compare-checkbox" value="${m.id}" ${state.compareIds.includes(m.id) ? 'checked' : ''}>
            ${escapeHtml(m.name)} (${formatCurrency(m.loanAmount)})
        </label>
    `).join('');

    let compareTableHtml = '';
    if (selectedMortgages.length > 0) {
        compareTableHtml = `
            <div class="compare-table-wrapper">
                <table class="compare-table">
                    <thead>
                        <tr>
                            <th>Банк</th>
                            <th>Сумма кредита</th>
                            <th>Ставка</th>
                            <th>Срок (мес.)</th>
                            <th>Платёж/мес.</th>
                            <th>Проценты без досрочек</th>
                            <th>Итоговая переплата</th>
                            <th>Досрочки</th>
                            <th>Экономия</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${selectedMortgages.map(m => {
                            const pmt = m.computePMT();
                            const baseInt = m.getBaseTotalInterest();
                            const totalInt = m.getTotalInterest();
                            const hasEarly = m.earlyPayments.length > 0;
                            const saving = baseInt - totalInt;
                            return `
                                <tr>
                                    <td><strong>${escapeHtml(m.name)}</strong></td>
                                    <td>${formatCurrency(m.loanAmount)}</td>
                                    <td>${m.rate}%</td>
                                    <td>${m.termMonths}</td>
                                    <td>${formatCurrency(pmt)}</td>
                                    <td>${formatCurrency(baseInt)}</td>
                                    <td>${formatCurrency(totalInt)}</td>
                                    <td>${hasEarly ? 'Да' : 'Нет'}</td>
                                    <td>${hasEarly ? formatCurrency(saving) : '—'}</td>
                                </tr>
                            `;
                        }).join('')}
                    </tbody>
                </table>
            </div>
        `;
    } else {
        compareTableHtml = '<p style="color:#64748b; text-align:center;">Выберите хотя бы одно предложение для сравнения.</p>';
    }

    const html = `
        <div class="compare-selection">
            <h3>Выберите предложения для сравнения</h3>
            <div style="margin: 10px 0;">${checkboxesHtml}</div>
        </div>
        ${compareTableHtml}
    `;

    mainContent.innerHTML = html;

    // Чекбоксы
    document.querySelectorAll('.compare-checkbox').forEach(cb => {
        cb.addEventListener('change', (e) => {
            const id = e.target.value;
            if (e.target.checked) {
                if (!state.compareIds.includes(id)) state.compareIds.push(id);
            } else {
                state.compareIds = state.compareIds.filter(x => x !== id);
            }
            saveState();
            renderCompareView();
        });
    });
}

// Делегирование кликов для списка
document.addEventListener('click', (e) => {
    if (state.view !== 'list') return;
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const action = btn.dataset.action;
    const id = btn.dataset.id;
    if (action === 'view-detail') {
        state.view = 'detail';
        state.selectedId = id;
        render();
    } else if (action === 'edit-mortgage') {
        const m = state.mortgages.find(m => m.id === id);
        if (m) {
            if (confirm('Редактирование параметров сбросит все досрочные погашения. Продолжить?')) {
                renderAddEditForm(m);
            }
        }
    } else if (action === 'delete-mortgage') {
        if (confirm('Удалить предложение?')) {
            state.mortgages = state.mortgages.filter(m => m.id !== id);
            state.compareIds = state.compareIds.filter(x => x !== id);
            if (state.selectedId === id) state.selectedId = null;
            saveState();
            renderListView();
        }
    }
});

// Старт
loadState();
if (state.mortgages.length === 0) {
    // Для демонстрации можно ничего не добавлять, но можно добавить пример
}
updateTabs();
render();
