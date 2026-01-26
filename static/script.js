// WebSocket подключение
const socket = io();

let isConnected = false;

// Инициализация при загрузке страницы
document.addEventListener('DOMContentLoaded', function() {
    // Проверяем статус при загрузке
    checkStatus();
    
    // Обработчик Enter для произвольной команды
    document.getElementById('custom-command').addEventListener('keypress', function(e) {
        if (e.key === 'Enter') {
            sendCustomCommand();
        }
    });
    
    addLog('Веб-интерфейс загружен. Подключитесь к проектору.', 'info');
});

// WebSocket события
socket.on('connected', function(data) {
    console.log('WebSocket connected:', data);
});

socket.on('log', function(data) {
    addLog(data.message, data.level, data.timestamp);
});

// Проверка статуса подключения
async function checkStatus() {
    try {
        const response = await fetch('/api/status');
        const data = await response.json();
        updateConnectionStatus(data.connected);
    } catch (error) {
        console.error('Ошибка проверки статуса:', error);
    }
}

// Подключение/отключение
async function toggleConnection() {
    const btn = document.getElementById('connect-btn');
    
    if (isConnected) {
        // Отключение
        try {
            const response = await fetch('/api/disconnect', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                }
            });
            const data = await response.json();
            
            if (data.success) {
                updateConnectionStatus(false);
            }
        } catch (error) {
            addLog('Ошибка отключения: ' + error.message, 'error');
        }
    } else {
        // Подключение
        const host = document.getElementById('host').value;
        const port = document.getElementById('port').value;
        
        if (!host || !port) {
            addLog('Укажите IP адрес и порт', 'error');
            return;
        }
        
        btn.disabled = true;
        btn.textContent = 'Подключение...';
        
        try {
            const response = await fetch('/api/connect', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ host, port })
            });
            const data = await response.json();
            
            if (data.success) {
                updateConnectionStatus(true);
            } else {
                addLog('Ошибка подключения: ' + data.message, 'error');
                btn.disabled = false;
                btn.textContent = 'Подключить';
            }
        } catch (error) {
            addLog('Ошибка подключения: ' + error.message, 'error');
            btn.disabled = false;
            btn.textContent = 'Подключить';
        }
    }
}

// Обновление статуса подключения
function updateConnectionStatus(connected) {
    isConnected = connected;
    
    const indicator = document.getElementById('status-indicator');
    const btn = document.getElementById('connect-btn');
    const controls = document.querySelectorAll('.btn-control, .btn-lamp, .btn-house-light, .btn-shutdown, .btn-volume, #volume-slider, #custom-command, .custom-command-form button');
    
    if (connected) {
        indicator.classList.remove('offline');
        indicator.classList.add('online');
        btn.textContent = 'Отключить';
        btn.disabled = false;
        
        controls.forEach(control => {
            control.disabled = false;
        });
    } else {
        indicator.classList.remove('online');
        indicator.classList.add('offline');
        btn.textContent = 'Подключить';
        btn.disabled = false;
        
        controls.forEach(control => {
            control.disabled = true;
        });
    }
}

// Отправка команды плееру
async function sendPlayerCommand(action) {
    try {
        const response = await fetch(`/api/player/${action}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            }
        });
        const data = await response.json();
        
        if (!data.success) {
            addLog('Ошибка: ' + data.message, 'error');
        }
    } catch (error) {
        addLog('Ошибка отправки команды: ' + error.message, 'error');
    }
}

// Отправка команды проектору
async function sendProjectorCommand(action) {
    try {
        const response = await fetch(`/api/projector/${action}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            }
        });
        const data = await response.json();
        
        if (!data.success) {
            addLog('Ошибка: ' + data.message, 'error');
        }
    } catch (error) {
        addLog('Ошибка отправки команды: ' + error.message, 'error');
    }
}

// Отправка произвольной команды
async function sendCustomCommand() {
    const input = document.getElementById('custom-command');
    const command = input.value.trim();
    
    if (!command) {
        return;
    }
    
    try {
        const response = await fetch('/api/command', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ command })
        });
        const data = await response.json();
        
        if (!data.success) {
            addLog('Ошибка: ' + data.message, 'error');
        }
        
        // Очищаем поле после успешной отправки
        if (data.success) {
            input.value = '';
        }
    } catch (error) {
        addLog('Ошибка отправки команды: ' + error.message, 'error');
    }
}

// Добавление записи в лог
function addLog(message, level = 'info', timestamp = null) {
    const logContainer = document.getElementById('log-container');
    const entry = document.createElement('div');
    entry.className = `log-entry ${level}`;
    
    if (!timestamp) {
        const now = new Date();
        timestamp = now.toTimeString().split(' ')[0];
    }
    
    entry.innerHTML = `<span class="log-timestamp">[${timestamp}]</span>${message}`;
    
    logContainer.appendChild(entry);
    logContainer.scrollTop = logContainer.scrollHeight;
    
    // Ограничиваем количество записей в логе
    const maxEntries = 100;
    while (logContainer.children.length > maxEntries) {
        logContainer.removeChild(logContainer.firstChild);
    }
}

// Очистка лога
function clearLog() {
    const logContainer = document.getElementById('log-container');
    logContainer.innerHTML = '';
    addLog('Лог очищен', 'info');
}

// Отправка команды освещению через EKOS
async function sendLightCommand(action) {
    try {
        const response = await fetch(`/api/light/${action}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            }
        });
        const data = await response.json();
        
        if (!data.success) {
            addLog('Ошибка: ' + data.message, 'error');
        }
    } catch (error) {
        addLog('Ошибка отправки команды освещению: ' + error.message, 'error');
    }
}

// Полная остановка сеанса
async function shutdownSession() {
    if (!confirm('Вы уверены, что хотите завершить сеанс?\n\nБудет выполнено:\n- Остановка фильма\n- Выключение лампы\n- Очистка плеера')) {
        return;
    }
    
    const btn = event.target;
    btn.disabled = true;
    btn.textContent = '⏳ Завершение сеанса...';
    
    try {
        const response = await fetch('/api/shutdown-session', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            }
        });
        const data = await response.json();
        
        if (data.success) {
            addLog('✓ Сеанс успешно завершен', 'success');
        } else {
            addLog('⚠ Сеанс завершен с ошибками: ' + data.message, 'error');
        }
    } catch (error) {
        addLog('Ошибка завершения сеанса: ' + error.message, 'error');
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<span class="icon">🛑</span> ЗАВЕРШИТЬ СЕАНС';
    }
}

// Управление громкостью
function updateVolumeDisplay(faderValue) {
    const level = (parseFloat(faderValue) / 10).toFixed(1);
    document.getElementById('volume-value').textContent = level;
}

async function setVolume(faderValue) {
    const level = parseFloat(faderValue) / 10;
    try {
        const response = await fetch('/api/volume', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ level: level })
        });
        const data = await response.json();
        
        if (!data.success) {
            addLog('Ошибка установки громкости: ' + data.message, 'error');
        }
    } catch (error) {
        addLog('Ошибка: ' + error.message, 'error');
    }
}

function setVolumePreset(faderValue) {
    const slider = document.getElementById('volume-slider');
    slider.value = faderValue;
    updateVolumeDisplay(faderValue);
    setVolume(faderValue);
}

