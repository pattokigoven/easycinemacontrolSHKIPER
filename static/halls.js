// WebSocket подключение
const socket = io();

let currentHallId = null;
let hallsData = {};
let sse = null;
let pollTimer = null;

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
                protocol: hall.protocol || 'barco'
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
    document.getElementById('active-hall-info').textContent = `${hall.ip}:${hall.port}`;
    
    // Очистить лог
    document.getElementById('hall-log').innerHTML = '';
    addLog(`Выбран ${hall.name} (ID: ${hallId})`, 'info');

    // Сразу активируем UI, т.к. внешний API — сокет-подключение не требуется
    setControlsEnabled(true);
    document.getElementById('status-indicator').classList.remove('offline');
    document.getElementById('status-indicator').classList.add('online');
    document.getElementById('status-text').textContent = 'API доступен';

    startStatus();
}

// Активация/деактивация элементов управления
function setControlsEnabled(enabled) {
    const controls = document.querySelectorAll('#shutdown-btn, #volume-slider, .btn-volume, .btn-light-on, .btn-light-off');
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
    
    const btn = document.getElementById('shutdown-btn');
    const originalText = btn.textContent;
    btn.disabled = true;
    btn.textContent = '⏳ Завершение...';
    
    try {
        const response = await fetch(`/api/${currentHallId}/shutdown-session`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });
        const data = await response.json();
        
        if (!data.success) {
            addLog('Ошибка завершения сеанса', 'error');
        }
    } catch (error) {
        addLog('Ошибка: ' + error.message, 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = originalText;
    }
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

// Управление светом
async function sendLightCommand(action) {
    if (!currentHallId) return;
    
    try {
        const response = await fetch(`/api/${currentHallId}/light/${action}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });
        const data = await response.json();
        
        if (!data.success) {
            addLog('Ошибка: ' + data.message, 'error');
        }
    } catch (error) {
        addLog('Ошибка: ' + error.message, 'error');
    }
}

// Обновление отображения громкости
function updateVolumeDisplay(faderValue) {
    const level = (parseFloat(faderValue) / 10).toFixed(1);
    document.getElementById('volume-value').textContent = level;
}

// Установка громкости
async function setVolume(faderValue) {
    if (!currentHallId) return;
    
    const level = parseFloat(faderValue) / 10;
    
    try {
        const response = await fetch(`/api/${currentHallId}/volume`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ level: level })
        });
        const data = await response.json();
        
        if (!data.success) {
            addLog('Ошибка: ' + data.message, 'error');
        }
    } catch (error) {
        addLog('Ошибка: ' + error.message, 'error');
    }
}

// Установка предустановки громкости
function setVolumePreset(faderValue) {
    const slider = document.getElementById('volume-slider');
    slider.value = faderValue;
    updateVolumeDisplay(faderValue);
    setVolume(faderValue);
}

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
