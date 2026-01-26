// WebSocket подключение
const socket = io();

// Текущий активный зал
let currentHallId = null;
let hallsData = {};

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
                connected: hall.connected,
                name: hall.name,
                ip: hall.ip,
                port: hall.port
            };
        });
        
        addLog('Веб-интерфейс загружен', 'info');
    } catch (error) {
        console.error('Ошибка загрузки данных залов:', error);
        addLog('Ошибка загрузки конфигурации', 'error');
    }
}

// Выбор зала из списка
async function selectHall() {
    const select = document.getElementById('hall-select');
    const hallId = select.value;
    
    console.log('Выбран зал:', hallId);
    
    if (!hallId) {
        // Скрыть карточку если зал не выбран
        document.getElementById('hall-container').style.display = 'none';
        currentHallId = null;
        return;
    }
    
    // Если был выбран другой зал, отключаемся от текущего
    if (currentHallId && currentHallId !== hallId && hallsData[currentHallId]?.connected) {
        await disconnectHall(currentHallId);
    }
    
    currentHallId = hallId;
    const hallData = hallsData[hallId];
    
    if (!hallData) {
        console.error('Данные зала не найдены:', hallId);
        addLog(`Ошибка: данные зала ${hallId} не найдены`, 'error');
        return;
    }
    
    console.log('Данные зала:', hallData);
    
    // Показать карточку
    document.getElementById('hall-container').style.display = 'block';
    
    // Обновить информацию о зале
    document.getElementById('active-hall-name').textContent = hallData.name;
    document.getElementById('active-hall-info').textContent = `${hallData.ip}:${hallData.port}`;
    
    // Очистить лог
    document.getElementById('hall-log').innerHTML = '';
    addLog(`Выбран ${hallData.name} (ID: ${hallId})`, 'info');
    
    // Обновить UI
    updateHallUI(false); // Сначала показываем как не подключенный
    
    // Автоматическое подключение
    if (!hallData.connected) {
        addLog('Подключение...', 'info');
        await connectToHall(hallId);
    } else {
        updateHallUI(true);
    }
}

// Подключение к залу
async function connectToHall(hallId) {
    if (!hallId) hallId = currentHallId;
    if (!hallId) return;
    
    console.log('Подключение к залу:', hallId);
    
    try {
        const url = `/api/${hallId}/connect`;
        console.log('Отправка запроса:', url);
        
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });
        
        console.log('Ответ сервера:', response.status);
        const data = await response.json();
        console.log('Данные ответа:', data);
        
        if (data.success) {
            hallsData[hallId].connected = true;
            updateHallUI(true);
        } else {
            addLog('Ошибка подключения: ' + data.message, 'error');
            updateHallUI(false);
        }
    } catch (error) {
        console.error('Ошибка запроса:', error);
        addLog('Ошибка подключения: ' + error.message, 'error');
        updateHallUI(false);
    }
}

// Отключение от зала (внутренняя функция)
async function disconnectHall(hallId) {
    try {
        await fetch(`/api/${hallId}/disconnect`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });
        hallsData[hallId].connected = false;
    } catch (error) {
        console.error('Ошибка отключения:', error);
    }
}

// Обновление UI зала
function updateHallUI(connected) {
    const statusIndicator = document.getElementById('status-indicator');
    const statusText = document.getElementById('status-text');
    
    // Все кнопки управления
    const controls = document.querySelectorAll(`
        #shutdown-btn,
        #volume-slider,
        .btn-volume,
        .btn-light-on,
        .btn-light-off
    `);
    
    if (connected) {
        statusIndicator.classList.remove('offline');
        statusIndicator.classList.add('online');
        statusText.textContent = 'Подключено';
        
        controls.forEach(ctrl => ctrl.disabled = false);
    } else {
        statusIndicator.classList.remove('online');
        statusIndicator.classList.add('offline');
        statusText.textContent = 'Подключение...';
        
        controls.forEach(ctrl => ctrl.disabled = true);
    }
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
