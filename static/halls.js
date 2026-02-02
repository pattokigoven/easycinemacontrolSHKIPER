// WebSocket подключение
const socket = io();

let currentHallId = null;
let hallsData = {};
let sse = null;
let pollTimer = null;
let cp750PollTimer = null;
let cp750Status = {};  // Хранение статуса CP750 для всех залов

// Инициализация при загрузке страницы
document.addEventListener('DOMContentLoaded', function() {
    loadHallsData();
});

// WebSocket события
socket.on('connected', function(data) {
    console.log('WebSocket connected:', data);
});

socket.on('log', function(data) {
    // Показываем логи только для текущего зала
    if (data.hall_id === currentHallId) {
        addLog(data.message, data.level, data.timestamp);
    }
});

// Загрузка данных залов
async function loadHallsData() {
    try {
        const response = await fetch('/api/halls');
        const halls = await response.json();
        
        halls.forEach(hall => {
            hallsData[hall.id] = {
                name: hall.name,
                ip: hall.ip,
                port: hall.port,
                tms_id: hall.tms_id || hall.id,
                protocol: hall.protocol || 'barco',
                cp750_id: hall.cp750_id || null
            };
        });
        
        addLog('Веб-интерфейс загружен', 'info');
    } catch (e) {
        addLog('Ошибка загрузки конфигурации', 'error');
    }
}

// Выбор зала из списка
async function selectHall() {
    const sel = document.getElementById('hall-select');
    const hallId = sel.value;
    
    console.log('Выбран зал:', hallId);
    
    if (!hallId) {
        // Скрыть карточку если зал не выбран
        document.getElementById('hall-container').style.display = 'none';
        stopStatus();
        currentHallId = null;
        return;
    }
    
    currentHallId = hallId;
    const hall = hallsData[hallId];
    
    if (!hall) { 
        addLog('Данные зала не найдены', 'error'); 
        return; 
    }

    // Показать карточку
    document.getElementById('hall-container').style.display = 'block';
    
    // Обновить информацию о зале
    document.getElementById('active-hall-name').textContent = hall.name;
    
    // Очистить лог
    document.getElementById('hall-log').innerHTML = '';
    addLog(`Выбран ${hall.name} (ID: ${hallId})`, 'info');

    // Сразу активируем UI, т.к. внешний API — сокет-подключение не требуется
    setControlsEnabled(true);
    document.getElementById('status-indicator').classList.remove('offline');
    document.getElementById('status-indicator').classList.add('online');
    document.getElementById('status-text').textContent = 'API доступен';

    startStatus();
    startCP750Status();
}

// Активация/деактивация элементов управления
function setControlsEnabled(enabled) {
    const controls = document.querySelectorAll('#shutdown-btn, #cp750-fader, .btn-cp750, #cp750-mute-btn');
    controls.forEach(c => c.disabled = !enabled);
}

// Запуск опроса статуса
function startStatus() {
    stopStatus();
    // Подключаем SSE как основной канал
    try {
        sse = new EventSource('/api/status/stream');
        sse.onmessage = (evt) => {
            if (!evt?.data) return;
            try {
                const payload = JSON.parse(evt.data);
                applyStatus(payload);
            } catch (_) {}
        };
        sse.onerror = () => { try { sse.close(); } catch(_) {}; sse = null; };
    } catch (_) { sse = null; }

    // Резервный поллинг live раз в 2s
    pollTimer = setInterval(fetchLive, 2000);
    fetchLive();
}

// Остановка опроса статуса
function stopStatus() {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    if (sse) { try { sse.close(); } catch(_) {}; sse = null; }
    stopCP750Status();
}

// Запрос статуса через поллинг
async function fetchLive() {
    try {
        const r = await fetch('/api/status/live');
        if (!r.ok) return;
        const data = await r.json();
        applyStatus(data);
    } catch (_) {}
}

// Применение статуса к UI
function applyStatus(data) {
    if (!currentHallId || !data || !data.devices) return;
    const hall = hallsData[currentHallId];
    const dev = data.devices.find(d => d.id === hall.tms_id || d.name === hall.name);
    if (!dev) return;

    const stateEl = document.getElementById('playback-state');
    const titleEl = document.getElementById('playback-title');
    const posEl = document.getElementById('playback-position');
    const durEl = document.getElementById('playback-duration');

    const state = dev.state || dev.status?.State || '—';
    const title = dev.title || dev.status?.Title || '—';
    const pos = dev.positionMs ?? dev.status?.CurrentPositionInMilliseconds;
    const dur = dev.durationMs ?? dev.status?.DurationInMilliseconds;

    stateEl.textContent = state + formatLampDowser(dev);
    titleEl.textContent = title;
    posEl.textContent = msToTime(pos);
    durEl.textContent = msToTime(dur);
}

// Форматирование информации о лампе и даузере
function formatLampDowser(dev) {
    const lamp = dev.lamp || dev.status?.Lamp;
    const dowser = dev.dowser || dev.status?.Dowser;
    const parts = [];
    if (lamp) parts.push(`Lamp: ${lamp}`);
    if (dowser) parts.push(`Dowser: ${dowser}`);
    return parts.length ? ` (${parts.join(', ')})` : '';
}

// Конвертация миллисекунд в формат времени
function msToTime(ms) {
    if (typeof ms !== 'number') return '—';
    const t = Math.floor(ms / 1000);
    const h = Math.floor(t / 3600);
    const m = Math.floor((t % 3600) / 60);
    const s = t % 60;
    return (h ? h + ':' : '') + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
}

// Завершение сеанса - показ модального окна
function shutdownSession() {
    if (!currentHallId) return;
    
    const hallName = hallsData[currentHallId].name;
    
    // Показать модальное окно
    const modal = document.getElementById('confirm-modal');
    const modalMessage = document.getElementById('modal-message');
    
    modalMessage.textContent = `Завершить сеанс в зале "${hallName}"?`;
    modal.style.display = 'flex';
}

// Подтверждение завершения сеанса
async function confirmShutdown() {
    const modal = document.getElementById('confirm-modal');
    modal.style.display = 'none';
    
    if (!currentHallId) return;
    
    const hall = hallsData[currentHallId];
    const tmsId = hall.tms_id || currentHallId;
    const cp750Id = hall.cp750_id;
    
    const btn = document.getElementById('shutdown-btn');
    const originalText = btn.textContent;
    btn.disabled = true;
    btn.textContent = '⏳ Завершение...';
    
    addLog('=== ЗАВЕРШЕНИЕ СЕАНСА ===', 'info');
    
    let hasErrors = false;
    
    // Вспомогательная функция для безопасного парсинга JSON
    async function safeJsonParse(response) {
        try {
            const text = await response.text();
            if (!text || text.trim() === '') return null;
            return JSON.parse(text);
        } catch (e) {
            return null;
        }
    }
    
    // 1. Остановка воспроизведения
    try {
        addLog('Остановка воспроизведения...', 'info');
        const r = await fetch(`/api/${tmsId}/stop`, { method: 'POST' });
        const data = await safeJsonParse(r);
        if (r.ok || (data && data.ok)) {
            addLog('✓ Воспроизведение остановлено', 'success');
        } else {
            addLog('✗ Ошибка остановки: ' + (data?.detail || data?.error || 'unknown'), 'error');
            hasErrors = true;
        }
    } catch (e) {
        addLog('✗ Ошибка остановки: ' + e.message, 'error');
        hasErrors = true;
    }
    
    // 2. Закрытие шторки (Dowser)
    try {
        addLog('Закрытие шторки...', 'info');
        const r = await fetch(`/api/${tmsId}/projector/dowser/close`, { method: 'POST' });
        const data = await safeJsonParse(r);
        if (r.ok || (data && data.ok)) {
            addLog('✓ Шторка закрыта', 'success');
        } else {
            addLog('✗ Ошибка закрытия шторки: ' + (data?.detail || data?.error || 'unknown'), 'error');
            hasErrors = true;
        }
    } catch (e) {
        addLog('✗ Ошибка закрытия шторки: ' + e.message, 'error');
        hasErrors = true;
    }
    
    // 3. Выключение лампы
    try {
        addLog('Выключение лампы...', 'info');
        const r = await fetch(`/api/${tmsId}/projector/lamp/off`, { method: 'POST' });
        const data = await safeJsonParse(r);
        if (r.ok || (data && data.ok)) {
            addLog('✓ Лампа выключена', 'success');
        } else {
            addLog('✗ Ошибка выключения лампы: ' + (data?.detail || data?.error || 'unknown'), 'error');
            hasErrors = true;
        }
    } catch (e) {
        addLog('✗ Ошибка выключения лампы: ' + e.message, 'error');
        hasErrors = true;
    }
    
    // 4. Установка громкости CP750 на 30
    if (cp750Id) {
        try {
            addLog('Установка громкости CP750 → 30...', 'info');
            const r = await fetch(`/api/cp750/${cp750Id}/fader`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ value: 30, force: false })
            });
            const data = await safeJsonParse(r);
            if (r.ok || (data && (data.success || data.ok))) {
                addLog('✓ Громкость CP750 установлена на 30', 'success');
            } else {
                addLog('✗ Ошибка установки громкости: ' + (data?.detail || data?.error || 'unknown'), 'error');
                hasErrors = true;
            }
        } catch (e) {
            addLog('✗ Ошибка установки громкости: ' + e.message, 'error');
            hasErrors = true;
        }
        
        // 5. Переключение входа CP750 на non_sync
        try {
            addLog('Переключение входа CP750 → non_sync...', 'info');
            const r = await fetch(`/api/cp750/${cp750Id}/input-mode`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ mode: 'non_sync' })
            });
            const data = await safeJsonParse(r);
            if (r.ok || (data && (data.success || data.ok))) {
                addLog('✓ Вход CP750 переключен на non_sync', 'success');
            } else {
                addLog('✗ Ошибка переключения входа: ' + (data?.detail || data?.error || 'unknown'), 'error');
                hasErrors = true;
            }
        } catch (e) {
            addLog('✗ Ошибка переключения входа: ' + e.message, 'error');
            hasErrors = true;
        }
    } else {
        addLog('⚠ CP750 не настроен для этого зала', 'warning');
    }
    
    if (hasErrors) {
        addLog('=== СЕАНС ЗАВЕРШЕН С ОШИБКАМИ ===', 'warning');
    } else {
        addLog('=== СЕАНС УСПЕШНО ЗАВЕРШЕН ===', 'success');
    }
    
    btn.disabled = false;
    btn.textContent = originalText;
}

// Отмена завершения сеанса
function cancelShutdown() {
    const modal = document.getElementById('confirm-modal');
    modal.style.display = 'none';
}

// Обработчики модального окна
document.addEventListener('DOMContentLoaded', function() {
    const modalConfirm = document.getElementById('modal-confirm');
    const modalCancel = document.getElementById('modal-cancel');
    const modal = document.getElementById('confirm-modal');
    
    if (modalConfirm) {
        modalConfirm.addEventListener('click', confirmShutdown);
    }
    
    if (modalCancel) {
        modalCancel.addEventListener('click', cancelShutdown);
    }
    
    // Закрытие по клику вне окна
    if (modal) {
        modal.addEventListener('click', function(e) {
            if (e.target === modal) {
                cancelShutdown();
            }
        });
    }
    
    // Закрытие по Escape
    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') {
            cancelShutdown();
        }
    });
});

// Добавление лога
function addLog(message, level = 'info', timestamp = null) {
    const logContainer = document.getElementById('hall-log');
    if (!logContainer) return;
    
    const entry = document.createElement('div');
    entry.className = `log-entry ${level}`;
    
    if (!timestamp) {
        const now = new Date();
        timestamp = now.toTimeString().split(' ')[0];
    }
    
    entry.innerHTML = `<span class="log-timestamp">[${timestamp}]</span>${message}`;
    
    logContainer.appendChild(entry);
    logContainer.scrollTop = logContainer.scrollHeight;
    
    // Ограничиваем количество записей
    const maxEntries = 30;
    while (logContainer.children.length > maxEntries) {
        logContainer.removeChild(logContainer.firstChild);
    }
}

// Выход из системы
async function logout() {
    if (!confirm('Вы уверены, что хотите выйти?')) {
        return;
    }
    
    try {
        const response = await fetch('/logout', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });
        
        if (response.ok) {
            window.location.href = '/';
        }
    } catch (error) {
        console.error('Ошибка выхода:', error);
        alert('Ошибка выхода из системы');
    }
}

// ============ CP750 Аудиопроцессор ============

// Запуск опроса статуса CP750
function startCP750Status() {
    stopCP750Status();
    fetchCP750Status();
    cp750PollTimer = setInterval(fetchCP750Status, 3000);
}

// Остановка опроса CP750
function stopCP750Status() {
    if (cp750PollTimer) {
        clearInterval(cp750PollTimer);
        cp750PollTimer = null;
    }
}

// Получение статуса всех CP750
async function fetchCP750Status() {
    try {
        const r = await fetch('/api/cp750/status/all');
        if (!r.ok) return;
        const data = await r.json();
        
        if (data.ok && data.devices) {
            data.devices.forEach(dev => {
                // Преобразуем формат от TMS API в удобный формат
                const id = dev.id || dev.status?.cp750_id;
                if (id && dev.status) {
                    cp750Status[id] = {
                        id: id,
                        level: parseInt(dev.status['cp750.sys.fader'] || '50'),
                        mute: dev.status['cp750.sys.mute'] === '1',
                        format: dev.status['cp750.state.bitstream_format'] || '—',
                        input_mode: dev.status['cp750.sys.input_mode'] || '—',
                        sample_rate: dev.status['cp750.state.sample_rate'] || '—',
                        unavailable: dev.unavailable || false,
                        lastError: dev.lastError
                    };
                }
            });
        }
        
        applyCP750Status();
    } catch (e) {
        console.error('CP750 status error:', e);
    }
}

// Применение статуса CP750 к UI
function applyCP750Status() {
    if (!currentHallId) return;
    
    const hall = hallsData[currentHallId];
    if (!hall || !hall.cp750_id) {
        // Нет CP750 для этого зала
        document.getElementById('cp750-status-text').textContent = 'Не настроен';
        return;
    }
    
    const status = cp750Status[hall.cp750_id];
    if (!status) {
        document.getElementById('cp750-indicator').classList.remove('online');
        document.getElementById('cp750-indicator').classList.add('offline');
        document.getElementById('cp750-status-text').textContent = 'Нет данных';
        document.getElementById('cp750-details').style.display = 'none';
        return;
    }
    
    // Проверяем доступность
    if (status.unavailable) {
        document.getElementById('cp750-indicator').classList.remove('online');
        document.getElementById('cp750-indicator').classList.add('offline');
        document.getElementById('cp750-status-text').textContent = 'Недоступен';
        document.getElementById('cp750-details').style.display = 'none';
        return;
    }
    
    // Обновляем индикатор
    document.getElementById('cp750-indicator').classList.remove('offline');
    document.getElementById('cp750-indicator').classList.add('online');
    document.getElementById('cp750-status-text').textContent = 'Подключен';
    document.getElementById('cp750-details').style.display = 'flex';
    
    // Формат и вход
    document.getElementById('cp750-format').textContent = status.format || '—';
    document.getElementById('cp750-input').textContent = status.input_mode || '—';
    
    // Уровень громкости
    const level = status.level ?? 50;
    document.getElementById('cp750-fader').value = level;
    document.getElementById('cp750-fader-value').textContent = level;
    
    // Mute
    const muted = status.mute === true;
    const muteBtn = document.getElementById('cp750-mute-btn');
    if (muted) {
        muteBtn.classList.add('muted');
        muteBtn.textContent = '🔇';
    } else {
        muteBtn.classList.remove('muted');
        muteBtn.textContent = '🔊';
    }
}

// Обновление отображения fader CP750
function updateCP750FaderDisplay(value) {
    document.getElementById('cp750-fader-value').textContent = value;
}

// Установка fader CP750
async function setCP750Fader(value) {
    if (!currentHallId) return;
    
    const hall = hallsData[currentHallId];
    if (!hall || !hall.cp750_id) {
        addLog('CP750 не настроен для этого зала', 'error');
        return;
    }
    
    try {
        const response = await fetch(`/api/cp750/${hall.cp750_id}/fader`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ value: parseInt(value), force: false })
        });
        const data = await response.json();
        
        if (!data.success) {
            addLog('Ошибка CP750: ' + (data.error || data.message), 'error');
        }
    } catch (error) {
        addLog('Ошибка CP750: ' + error.message, 'error');
    }
}

// Установка пресета CP750
function setCP750Preset(value) {
    const slider = document.getElementById('cp750-fader');
    slider.value = value;
    updateCP750FaderDisplay(value);
    setCP750Fader(value);
}

// Переключение Mute CP750
async function toggleCP750Mute() {
    if (!currentHallId) return;
    
    const hall = hallsData[currentHallId];
    if (!hall || !hall.cp750_id) {
        addLog('CP750 не настроен для этого зала', 'error');
        return;
    }
    
    const status = cp750Status[hall.cp750_id];
    const currentMute = status?.mute === true;
    const newMute = !currentMute;
    
    try {
        const response = await fetch(`/api/cp750/${hall.cp750_id}/mute`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ mute: newMute })
        });
        const data = await response.json();
        
        if (data.success) {
            // Обновляем локальный статус
            if (cp750Status[hall.cp750_id]) {
                cp750Status[hall.cp750_id].mute = newMute;
            }
            applyCP750Status();
        } else {
            addLog('Ошибка CP750 Mute: ' + (data.error || data.message), 'error');
        }
    } catch (error) {
        addLog('Ошибка CP750 Mute: ' + error.message, 'error');
    }
}
