"""
Barco ICMP Multi-Hall Control - Web Interface
Веб-интерфейс для управления несколькими залами одновременно
"""

from flask import Flask, render_template, request, jsonify, session, Response, stream_with_context
from flask_socketio import SocketIO, emit
import socket
import threading
import time
import json
import random
from datetime import datetime
import os
import requests


# Базовый URL внешнего TMS API (можно переопределить через TMS_API_BASE)
EXTERNAL_API_BASE = os.environ.get('TMS_API_BASE', 'http://192.168.198.21:8089')


class BarcoController:
    """Класс для управления одним залом Barco ICMP"""
    
    def __init__(self, hall_id, host='192.168.1.100', port=43748, tms_id=None):
        self.hall_id = hall_id
        self.tms_id = tms_id or hall_id  # ID устройства во внешнем TMS (если отличается)
        self.host = host
        self.port = port
        self.socket = None
        self.connected = False
        self.ack_enabled = False
        self.lock = threading.Lock()
        
    def connect(self):
        """Подключение к Barco ICMP"""
        acquired = self.lock.acquire(timeout=10)
        if not acquired:
            return False, "Не удалось получить блокировку (timeout)"
        
        try:
            print(f"[{self.hall_id}] Попытка подключения к {self.host}:{self.port}")
            self.socket = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            self.socket.settimeout(5)
            self.socket.connect((self.host, self.port))
            self.connected = True
            
            print(f"[{self.hall_id}] Подключено к {self.host}:{self.port}")
            
            # Включаем подтверждения (ACK)
            success, response = self._send_command_internal("ACK,1")
            if success:
                self.ack_enabled = True
                print(f"[{self.hall_id}] ACK режим включен: {response}")
            
            return True, f"Подключено к {self.host}:{self.port}"
        except Exception as e:
            print(f"[{self.hall_id}] Ошибка подключения: {str(e)}")
            self.connected = False
            return False, f"Ошибка подключения: {str(e)}"
        finally:
            self.lock.release()
    
    def disconnect(self):
        """Отключение от Barco ICMP"""
        acquired = self.lock.acquire(timeout=10)
        if not acquired:
            return
        
        try:
            if self.socket:
                try:
                    self.socket.close()
                except:
                    pass
            self.connected = False
            self.socket = None
            self.ack_enabled = False
            print(f"[{self.hall_id}] Отключено")
        finally:
            self.lock.release()
    
    def _send_command_internal(self, command):
        """Внутренний метод отправки команды (без блокировки)"""
        if not self.connected or not self.socket:
            return False, "Не подключено к устройству"
        
        try:
            if not command.endswith(';'):
                command = command + ';'
            
            self.socket.sendall(command.encode('ascii'))
            print(f"[{self.hall_id}] Отправлено: {command}")
            
            if self.ack_enabled or command.startswith('ACK'):
                time.sleep(0.1)
                try:
                    response = self.socket.recv(1024).decode('ascii').strip()
                    if response:
                        print(f"[{self.hall_id}] Ответ: {response}")
                        if 'ACK' in response:
                            return True, "ACK"
                        elif 'NACK' in response:
                            return False, "NACK"
                        return True, response
                    return True, "OK"
                except socket.timeout:
                    return True, "OK (timeout)"
            else:
                return True, "Отправлено"
            
        except Exception as e:
            print(f"[{self.hall_id}] Ошибка отправки команды: {str(e)}")
            return False, f"Ошибка: {str(e)}"
    
    def send_command(self, command):
        """Публичный метод отправки команды (с блокировкой)"""
        acquired = self.lock.acquire(timeout=10)
        if not acquired:
            return False, "Не удалось получить блокировку (timeout)"
        
        try:
            return self._send_command_internal(command)
        finally:
            self.lock.release()
    
    def stop(self):
        """Остановка воспроизведения через внешний TMS API с fallback на ICMP.

        Попытка: POST {EXTERNAL_API_BASE}/api/{device_id}/stop
        В случае сетевой ошибки или некорректного ответа — выполняется внутренняя остановка.
        Возвращает (success: bool, message: str).
        """
        url = f"{EXTERNAL_API_BASE}/api/{self.tms_id}/stop"
        try:
            resp = requests.post(url, timeout=5)
        except Exception as e:
            print(f"[{self.hall_id}] Внешний TMS API недоступен при stop: {e}. Применяем внутренний стоп.")
            return self.send_command("PLAYER.Stop")

        if resp.status_code == 200:
            try:
                data = resp.json()
                ok = data.get('ok', True) if isinstance(data, dict) else True
                return bool(ok), resp.text
            except ValueError:
                return True, resp.text
        else:
            print(f"[{self.hall_id}] TMS API stop вернул HTTP {resp.status_code}, тело: {resp.text}. Применяем внутренний стоп.")
            return self.send_command("PLAYER.Stop")
    
    def play(self):
        """Запуск воспроизведения через внешний TMS API с фолбэком на ICMP.

        POST {EXTERNAL_API_BASE}/api/{device_id}/play
        """
        url = f"{EXTERNAL_API_BASE}/api/{self.tms_id}/play"
        try:
            resp = requests.post(url, timeout=5)
        except Exception as e:
            print(f"[{self.hall_id}] Внешний TMS API недоступен при play: {e}. Применяем внутренний запуск.")
            return self.send_command("PLAYER.Play")

        if resp.status_code == 200:
            try:
                data = resp.json()
                ok = data.get('ok', True) if isinstance(data, dict) else True
                return bool(ok), resp.text
            except ValueError:
                return True, resp.text
        else:
            print(f"[{self.hall_id}] TMS API play вернул HTTP {resp.status_code}, тело: {resp.text}. Применяем внутренний запуск.")
            return self.send_command("PLAYER.Play")
    
    def lamp_off(self):
        """Выключение лампы через внешний TMS API с фолбэком на ICMP"""
        url = f"{EXTERNAL_API_BASE}/api/{self.tms_id}/projector/lamp/off"
        try:
            resp = requests.post(url, timeout=5)
        except Exception as e:
            print(f"[{self.hall_id}] Внешний TMS API недоступен при lamp_off: {e}. Применяем внутреннюю команду.")
            return self.send_command("PROJECTOR.Turn Lamp Off")

        if resp.status_code == 200:
            try:
                data = resp.json()
                ok = data.get('ok', True) if isinstance(data, dict) else True
                return bool(ok), resp.text
            except ValueError:
                return True, resp.text
        else:
            print(f"[{self.hall_id}] TMS API lamp_off вернул HTTP {resp.status_code}, тело: {resp.text}. Применяем внутреннюю команду.")
            return self.send_command("PROJECTOR.Turn Lamp Off")
    
    def clear(self):
        """Очистка плейлиста"""
        return self.send_command("PLAYER.Clear")
    
    def light_on(self):
        """Включение света через EKOS"""
        return self.send_command('EKOS.Send Text,"$KE,WR,4,1\\0D\\0A"')
    
    def light_off(self):
        """Выключение света через EKOS"""
        return self.send_command('EKOS.Send Text,"$KE,WR,1,1\\0D\\0A"')
    
    def set_volume(self, level):
        """Установка громкости через tm8710 (0-5.5)"""
        fader_value = int(float(level) * 10)
        return self.send_command(f'tm8710.Send Text,"tm8710.sys.fader {fader_value}"')
    
    def shutdown_session(self):
        """Полное завершение сеанса: Stop -> Lamp OFF -> Clear -> Lights ON"""
        results = []
        
        # 1. Остановка (через TMS при наличии)
        success, response = self.stop()
        results.append(('stop', success, response))
        time.sleep(0.5)
        
        # 2. Выключение лампы (через TMS при наличии)
        success, response = self.lamp_off()
        results.append(('lamp_off', success, response))
        time.sleep(0.5)
        
        # 3. Очистка (внутренняя команда ICMP)
        success, response = self.clear()
        results.append(('clear', success, response))
        time.sleep(0.5)
        
        # 4. Включение света (EKOS внутренняя команда)
        success, response = self.send_command('EKOS.Send Text,"$KE,WR,4,1\\0D\\0A"')
        results.append(('lights_on', success, response))
        
        all_success = all(r[1] for r in results)
        return all_success, results


# Мемные приветствия для администраторов
def load_greetings():
    """Загружает приветствия из файла"""
    try:
        with open('greetings.txt', 'r', encoding='utf-8') as f:
            greetings = [line.strip() for line in f if line.strip()]
            return greetings if greetings else ["Добро пожаловать! 🎬"]
    except FileNotFoundError:
        print("Предупреждение: Файл greetings.txt не найден. Используются приветствия по умолчанию.")
        return [
            "Приветствую, повелитель пикселей! 🎬",
            "О великий киномеханик, ваше величество! 👑",
            "Добро пожаловать в царство 24 кадров в секунду! 🎞️"
        ]

GREETINGS = load_greetings()

# Логирование действий
def log_action(admin_name, hall_id, action, details=''):
    """Записывает действие администратора в лог-файл"""
    timestamp = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    log_entry = f"[{timestamp}] Админ: {admin_name} | Зал: {hall_id} | Действие: {action}"
    if details:
        log_entry += f" | {details}"
    
    # Запись в файл
    log_dir = 'logs'
    if not os.path.exists(log_dir):
        os.makedirs(log_dir)
    
    log_file = os.path.join(log_dir, f'admin_actions_{datetime.now().strftime("%Y-%m-%d")}.log')
    with open(log_file, 'a', encoding='utf-8') as f:
        f.write(log_entry + '\n')
    
    print(log_entry)

# Flask приложение
app = Flask(__name__)
app.config['SECRET_KEY'] = 'barco-multi-hall-secret-key-2026'
app.config['SESSION_COOKIE_SAMESITE'] = 'Lax'
app.config['SESSION_COOKIE_SECURE'] = False
socketio = SocketIO(app, cors_allowed_origins="*", async_mode='threading', manage_session=False)

# Загрузка конфигурации залов
def load_halls_config():
    try:
        with open('halls_config.json', 'r', encoding='utf-8') as f:
            config = json.load(f)
            return config['halls']
    except Exception as e:
        print(f"Ошибка загрузки конфигурации: {e}")
        return []

# Словарь контроллеров для каждого зала
controllers = {}

def init_controllers():
    """Инициализация контроллеров для каждого зала"""
    halls = load_halls_config()
    print(f"Загружено залов из конфигурации: {len(halls)}")
    for hall in halls:
        hall_id = hall['id']
        print(f"  Инициализация зала: {hall_id} -> {hall['ip']}:{hall['port']}")
        controllers[hall_id] = BarcoController(
            hall_id=hall_id,
            host=hall['ip'],
            port=hall['port'],
            tms_id=hall.get('tms_id')
        )
    print(f"Инициализировано {len(controllers)} залов")
    print(f"Ключи в controllers: {list(controllers.keys())}")

# Инициализация при запуске
init_controllers()


def emit_log(hall_id, message, level='info'):
    """Отправка лога через WebSocket"""
    timestamp = datetime.now().strftime("%H:%M:%S")
    socketio.emit('log', {
        'hall_id': hall_id,
        'message': message,
        'level': level,
        'timestamp': timestamp
    })
    print(f"[{hall_id}] {message}")


@app.route('/')
def index():
    """Главная страница с управлением всеми залами"""
    # Проверка авторизации
    if 'admin_name' not in session:
        return render_template('login.html', greeting=random.choice(GREETINGS))
    
    halls = load_halls_config()
    admin_name = session.get('admin_name', 'Неизвестный')
    return render_template('halls.html', halls=halls, admin_name=admin_name)

@app.route('/login', methods=['POST'])
def login():
    """Авторизация администратора"""
    data = request.get_json()
    admin_name = data.get('admin_name', '').strip()
    
    if not admin_name:
        return jsonify({'success': False, 'message': 'Введите имя'})
    
    if len(admin_name) < 2:
        return jsonify({'success': False, 'message': 'Имя слишком короткое'})
    
    session['admin_name'] = admin_name
    log_action(admin_name, 'SYSTEM', 'LOGIN', 'Вход в систему')
    
    return jsonify({'success': True, 'message': f'Добро пожаловать, {admin_name}!'})

@app.route('/logout', methods=['POST'])
def logout():
    """Выход из системы"""
    admin_name = session.get('admin_name', 'Неизвестный')
    log_action(admin_name, 'SYSTEM', 'LOGOUT', 'Выход из системы')
    session.pop('admin_name', None)
    return jsonify({'success': True})

@app.route('/api/admin')
def get_admin():
    """Получить имя текущего администратора"""
    return jsonify({
        'admin_name': session.get('admin_name', None),
        'authenticated': 'admin_name' in session
    })


@app.route('/api/halls')
def get_halls():
    """Получить список залов с их базовой конфигурацией (без сокетов)."""
    halls = load_halls_config()
    result = []
    for hall in halls:
        result.append({
            'id': hall['id'],
            'name': hall['name'],
            'ip': hall['ip'],
            'port': hall['port'],
            'tms_id': hall.get('tms_id', hall['id']),
            'protocol': hall.get('protocol', 'barco'),
            'cp750_id': hall.get('cp750_id'),
            'connected': False
        })
    return jsonify(result)


@app.route('/api/status/live')
def status_live():
    """Прокси для агрегированного статуса (JSON, с Lamp/Dowser для Barco)."""
    try:
        r = requests.get(f"{EXTERNAL_API_BASE}/api/status/live", timeout=5)
        return jsonify(r.json()), r.status_code
    except Exception as e:
        return jsonify({'ok': False, 'error': str(e)}), 502


# ============ CP750 API Endpoints ============

@app.route('/api/cp750/status/all')
def cp750_status_all():
    """Получить статус всех CP750 аудиопроцессоров"""
    try:
        r = requests.get(f"{EXTERNAL_API_BASE}/api/cp750/status/all", timeout=5)
        return jsonify(r.json()), r.status_code
    except Exception as e:
        return jsonify({'ok': False, 'error': str(e)}), 502


@app.route('/api/cp750/<cp_id>/status')
def cp750_status(cp_id):
    """Получить статус конкретного CP750"""
    try:
        r = requests.get(f"{EXTERNAL_API_BASE}/api/cp750/{cp_id}/status", timeout=5)
        return jsonify(r.json()), r.status_code
    except Exception as e:
        return jsonify({'ok': False, 'error': str(e)}), 502


@app.route('/api/cp750/<cp_id>/fader', methods=['POST'])
def cp750_fader(cp_id):
    """Установить уровень громкости CP750"""
    if 'admin_name' not in session:
        return jsonify({'success': False, 'message': 'Не авторизован'}), 401
    
    admin_name = session['admin_name']
    data = request.get_json()
    value = data.get('value', 50)
    force = data.get('force', False)
    
    try:
        r = requests.post(
            f"{EXTERNAL_API_BASE}/api/cp750/{cp_id}/fader",
            json={'value': value, 'force': force},
            timeout=5
        )
        result = r.json()
        
        # Логирование
        log_action(admin_name, cp_id, 'CP750_FADER', f'Уровень: {value}')
        
        # Emit через WebSocket
        hall_id = cp_id.replace('_cp750', '').lower()
        emit_log(hall_id, f'CP750 Громкость: {value}', 'success' if result.get('ok', True) else 'error')
        
        return jsonify({'success': True, 'result': result}), r.status_code
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 502


@app.route('/api/cp750/<cp_id>/mute', methods=['POST'])
def cp750_mute(cp_id):
    """Установить mute CP750"""
    if 'admin_name' not in session:
        return jsonify({'success': False, 'message': 'Не авторизован'}), 401
    
    admin_name = session['admin_name']
    data = request.get_json()
    mute = data.get('mute', False)
    
    try:
        r = requests.post(
            f"{EXTERNAL_API_BASE}/api/cp750/{cp_id}/mute",
            json={'mute': mute},
            timeout=5
        )
        result = r.json()
        
        # Логирование
        action = 'CP750_MUTE_ON' if mute else 'CP750_MUTE_OFF'
        log_action(admin_name, cp_id, action, '')
        
        # Emit через WebSocket
        hall_id = cp_id.replace('_cp750', '').lower()
        emit_log(hall_id, f'CP750 Mute: {"ВКЛ" if mute else "ВЫКЛ"}', 'success')
        
        return jsonify({'success': True, 'result': result}), r.status_code
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 502


@app.route('/api/cp750/<cp_id>/input-mode', methods=['POST'])
def cp750_input_mode(cp_id):
    """Установить режим входа CP750"""
    if 'admin_name' not in session:
        return jsonify({'success': False, 'message': 'Не авторизован'}), 401
    
    admin_name = session['admin_name']
    data = request.get_json()
    mode = data.get('mode', 'dig_1')
    
    try:
        r = requests.post(
            f"{EXTERNAL_API_BASE}/api/cp750/{cp_id}/input-mode",
            json={'mode': mode},
            timeout=5
        )
        result = r.json()
        
        # Логирование
        log_action(admin_name, cp_id, 'CP750_INPUT_MODE', f'Режим: {mode}')
        
        # Emit через WebSocket
        hall_id = cp_id.replace('_cp750', '').lower()
        emit_log(hall_id, f'CP750 Вход: {mode}', 'success' if result.get('ok', True) else 'error')
        
        return jsonify({'success': True, 'result': result}), r.status_code
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 502


# ============ End CP750 API ============

# ============ Projector API ============

@app.route('/api/<device_id>/stop', methods=['POST'])
def projector_stop(device_id):
    """Остановка воспроизведения через TMS API"""
    if 'admin_name' not in session:
        return jsonify({'success': False, 'message': 'Не авторизован'}), 401
    
    admin_name = session['admin_name']
    
    try:
        r = requests.post(f"{EXTERNAL_API_BASE}/api/{device_id}/stop", timeout=10)
        result = r.json()
        log_action(admin_name, device_id, 'STOP', '')
        return jsonify(result), r.status_code
    except Exception as e:
        return jsonify({'ok': False, 'error': str(e)}), 502


@app.route('/api/<device_id>/projector/lamp/<action>', methods=['POST'])
def projector_lamp(device_id, action):
    """Управление лампой проектора через TMS API"""
    if 'admin_name' not in session:
        return jsonify({'success': False, 'message': 'Не авторизован'}), 401
    
    admin_name = session['admin_name']
    
    if action not in ['on', 'off']:
        return jsonify({'ok': False, 'error': 'Invalid action'}), 400
    
    try:
        # Используем формат {"on": true/false}
        lamp_on = (action == 'on')
        r = requests.post(
            f"{EXTERNAL_API_BASE}/api/{device_id}/lamp",
            json={'on': lamp_on},
            timeout=10
        )
        result = r.json()
        log_action(admin_name, device_id, f'LAMP_{action.upper()}', '')
        return jsonify(result), r.status_code
    except Exception as e:
        return jsonify({'ok': False, 'error': str(e)}), 502


@app.route('/api/<device_id>/projector/dowser/<action>', methods=['POST'])
def projector_dowser(device_id, action):
    """Управление шторкой проектора через TMS API"""
    if 'admin_name' not in session:
        return jsonify({'success': False, 'message': 'Не авторизован'}), 401
    
    admin_name = session['admin_name']
    
    if action not in ['open', 'close']:
        return jsonify({'ok': False, 'error': 'Invalid action'}), 400
    
    try:
        # Используем формат {"closed": true/false}
        closed = (action == 'close')
        r = requests.post(
            f"{EXTERNAL_API_BASE}/api/{device_id}/dowser",
            json={'closed': closed},
            timeout=10
        )
        result = r.json()
        log_action(admin_name, device_id, f'DOWSER_{action.upper()}', '')
        return jsonify(result), r.status_code
    except Exception as e:
        return jsonify({'ok': False, 'error': str(e)}), 502


# ============ End Projector API ============

@app.route('/api/status/stream')
def status_stream():
    """Прокси для SSE стрима статусов (auto-update)."""
    try:
        upstream = requests.get(f"{EXTERNAL_API_BASE}/api/status/stream", stream=True, timeout=5)
    except Exception as e:
        return jsonify({'ok': False, 'error': str(e)}), 502

    def generate():
        try:
            for chunk in upstream.iter_content(chunk_size=None):
                if chunk:
                    yield chunk
        finally:
            try:
                upstream.close()
            except Exception:
                pass

    ct = upstream.headers.get('Content-Type', 'text/event-stream')
    return Response(stream_with_context(generate()), mimetype=ct)

@app.route('/api/<hall_id>/connect', methods=['POST'])
def connect_hall(hall_id):
    """Внешний API режим — физическое подключение не требуется."""
    if 'admin_name' not in session:
        return jsonify({'success': False, 'message': 'Не авторизован'}), 401
    return jsonify({'success': True, 'message': 'API режим: сокет-подключение не требуется'})

@app.route('/api/<hall_id>/disconnect', methods=['POST'])
def disconnect_hall(hall_id):
    """Внешний API режим — просто подтверждаем."""
    if 'admin_name' not in session:
        return jsonify({'success': False, 'message': 'Не авторизован'}), 401
    return jsonify({'success': True, 'message': 'Отключено (логически)'})

@app.route('/api/<hall_id>/play', methods=['POST'])
def api_play(hall_id):
    """Запуск сеанса (воспроизведения) через внешний API"""
    if 'admin_name' not in session:
        return jsonify({'success': False, 'message': 'Не авторизован'}), 401

    admin_name = session['admin_name']
    controller = controllers.get(hall_id)
    if not controller:
        return jsonify({'success': False, 'message': 'Зал не найден'}), 404

    # Для play подключение к ICMP не обязательно, но оставим проверку статуса UI
    success, response = controller.play()
    log_action(admin_name, hall_id, 'PLAY', '')
    emit_log(hall_id, f'Запуск воспроизведения: {response}', 'success' if success else 'error')

    return jsonify({'success': success, 'message': response})


@app.route('/api/<hall_id>/stop', methods=['POST'])
def api_stop(hall_id):
    """Остановка сеанса через внешний API"""
    if 'admin_name' not in session:
        return jsonify({'success': False, 'message': 'Не авторизован'}), 401

    admin_name = session['admin_name']
    controller = controllers.get(hall_id)
    if not controller:
        return jsonify({'success': False, 'message': 'Зал не найден'}), 404

    success, response = controller.stop()
    log_action(admin_name, hall_id, 'STOP', '')
    emit_log(hall_id, f'Остановка воспроизведения: {response}', 'success' if success else 'error')

    return jsonify({'success': success, 'message': response})


@app.route('/api/<hall_id>/shutdown-session', methods=['POST'])
def shutdown_session(hall_id):
    """Полное завершение сеанса"""
    if 'admin_name' not in session:
        return jsonify({'success': False, 'message': 'Не авторизован'}), 401
    
    admin_name = session['admin_name']
    controller = controllers.get(hall_id)
    if not controller:
        return jsonify({'success': False, 'message': 'Зал не найден'}), 404
    
    if not controller.connected:
        return jsonify({'success': False, 'message': 'Не подключено'})
    
    emit_log(hall_id, '=== ЗАВЕРШЕНИЕ СЕАНСА ===', 'info')
    
    success, results = controller.shutdown_session()
    
    # Логирование действия
    log_action(admin_name, hall_id, 'SHUTDOWN_SESSION',
              f'Результат: {"успешно" if success else "с ошибками"}')
    
    for action, result, response in results:
        level = 'success' if result else 'error'
        emit_log(hall_id, f'{action}: {response}', level)
    
    emit_log(hall_id, '=== СЕАНС ЗАВЕРШЕН ===' if success else '=== ЗАВЕРШЕНО С ОШИБКАМИ ===',
             'success' if success else 'warning')
    
    return jsonify({'success': success, 'message': 'Сеанс завершен' if success else 'Завершено с ошибками'})


@app.route('/api/<hall_id>/light/<action>', methods=['POST'])
def control_light(hall_id, action):
    """Управление светом"""
    if 'admin_name' not in session:
        return jsonify({'success': False, 'message': 'Не авторизован'}), 401
    
    admin_name = session['admin_name']
    controller = controllers.get(hall_id)
    if not controller:
        return jsonify({'success': False, 'message': 'Зал не найден'}), 404
    
    if not controller.connected:
        return jsonify({'success': False, 'message': 'Не подключено'})
    
    if action == 'on':
        success, response = controller.light_on()
        log_action(admin_name, hall_id, 'LIGHT_ON', 'Включение света')
        emit_log(hall_id, f'Свет ВКЛ: {response}', 'success' if success else 'error')
    elif action == 'off':
        success, response = controller.light_off()
        log_action(admin_name, hall_id, 'LIGHT_OFF', 'Выключение света')
        emit_log(hall_id, f'Свет ВЫКЛ: {response}', 'success' if success else 'error')
    else:
        return jsonify({'success': False, 'message': 'Неизвестное действие'})
    
    return jsonify({'success': success, 'message': response})


@app.route('/api/<hall_id>/volume', methods=['POST'])
def set_volume(hall_id):
    """Установка громкости"""
    if 'admin_name' not in session:
        return jsonify({'success': False, 'message': 'Не авторизован'}), 401
    
    admin_name = session['admin_name']
    controller = controllers.get(hall_id)
    if not controller:
        return jsonify({'success': False, 'message': 'Зал не найден'}), 404
    
    if not controller.connected:
        return jsonify({'success': False, 'message': 'Не подключено'})
    
    data = request.get_json()
    level = float(data.get('level', 4))
    
    if level < 0 or level > 5.5:
        return jsonify({'success': False, 'message': 'Уровень должен быть от 0 до 5.5'})
    
    success, response = controller.set_volume(level)
    log_action(admin_name, hall_id, 'VOLUME', f'Уровень: {level}')
    emit_log(hall_id, f'Громкость {level}: {response}', 'success' if success else 'error')
    
    return jsonify({'success': success, 'message': response, 'level': level})


@socketio.on('connect')
def handle_connect():
    """Обработка подключения WebSocket"""
    emit('connected', {'message': 'WebSocket подключен'})
    print('WebSocket клиент подключен')


@socketio.on('disconnect')
def handle_disconnect():
    """Обработка отключения WebSocket"""
    print('WebSocket клиент отключен')


if __name__ == '__main__':
    print("=" * 50)
    print("Barco ICMP Multi-Hall Control - Запуск сервера")
    print("=" * 50)
    print(f"Загружено залов: {len(controllers)}")
    for hall_id, controller in controllers.items():
        print(f"  - {hall_id}: {controller.host}:{controller.port}")
    print()
    print("Сервер запущен на:")
    print("  http://127.0.0.1:5059")
    print("  http://0.0.0.0:5059")
    print("=" * 50)
    
    socketio.run(app, host='0.0.0.0', port=5059, debug=False)
