# TMS Backend API Documentation

Theatre Management System (TMS) API для управления киносерверами Barco и Dolby/Doremi, 
аудиопроцессорами CP750 и интеграции с внешним расписанием.

**Базовый URL**: `http://localhost:8089`  
**Версия**: 0.1.6

---

## Содержание

1. [Общие эндпоинты](#общие-эндпоинты)
2. [Устройства (Devices)](#устройства-devices)
3. [Статус устройств](#статус-устройств)
4. [Управление плеером](#управление-плеером)
5. [Проектор](#проектор)
6. [Расписание](#расписание)
7. [Аудиопроцессор CP750](#аудиопроцессор-cp750)
8. [Ingest (FTP сканирование)](#ingest-ftp-сканирование)
9. [Администрирование](#администрирование)

---

## Общие эндпоинты

### Проверка доступности
```http
GET /api/ping
```

**Ответ:**
```json
{"ok": true}
```

---

## Устройства (Devices)

### Получить список всех устройств
```http
GET /api/devices
```

**Ответ:**
```json
{
  "ok": true,
  "devices": [
    {
      "id": "Zal1",
      "protocol": "barco",
      "name": "Barco1",
      "host": "192.168.198.61",
      "port": 43758,
      "username": "admin",
      "cp750": {
        "id": "Zal1_cp750",
        "name": "Zal1_cp750",
        "host": "192.168.198.71",
        "port": 61408
      }
    },
    {
      "id": "Zal2",
      "protocol": "dolby",
      "name": "doremi2",
      "base_url": "http://192.168.198.42",
      "login_user": "admin"
    }
  ]
}
```

### Получить снимок состояния всех устройств
```http
GET /api/devices/snapshot
```

**Ответ:**
```json
{
  "ok": true,
  "devices": [
    {
      "id": "Zal1",
      "name": "Barco1",
      "lastUpdated": 1705567200.123,
      "ageSec": 2.5,
      "status": { ... }
    }
  ]
}
```

### Получить снимок конкретного устройства
```http
GET /api/{device_id}/snapshot
```

**Параметры пути:**
- `device_id` - ID устройства (например: `Zal1`, `Zal2`)

---

## Статус устройств

### Получить статус устройства
```http
GET /api/{device_id}/status
```

**Ответ:**
```json
{
  "ok": true,
  "status": {
    "State": "Play",
    "Mode": "Scheduled",
    "CurrentPositionInMilliseconds": 123456,
    "DurationInMilliseconds": 7200000,
    "Title": "Movie Title",
    "Lamp": "On",
    "Dowser": "Open"
  },
  "cached": true,
  "ageSec": 1.5
}
```

### Получить агрегированный статус всех устройств
```http
GET /api/status/all
```

**Ответ:**
```json
{
  "ok": true,
  "devices": [
    {
      "id": "Zal1",
      "name": "Barco1",
      "status": {
        "State": "Play",
        "PositionMs": 123456,
        "CurrentPositionExtrapolatedInMilliseconds": 124000
      }
    }
  ]
}
```

### Live статус (для UI)
```http
GET /api/status/live
```

**Ответ:**
```json
{
  "ok": true,
  "ts": 1705567200.123,
  "devices": [
    {
      "id": "Zal1",
      "name": "Barco1",
      "title": "Movie Title",
      "state": "Play",
      "positionMs": 123456,
      "durationMs": 7200000,
      "lamp": "On",
      "dowser": "Open",
      "updatedAt": 1705567199.5
    }
  ]
}
```

### SSE поток статусов (Server-Sent Events)
```http
GET /api/status/stream
```

**Тип ответа:** `text/event-stream`  
Обновление каждую секунду. Формат данных аналогичен `/api/status/live`.

---

## Управление плеером

### Воспроизведение
```http
POST /api/{device_id}/play
```

### Пауза
```http
POST /api/{device_id}/pause
```

### Стоп
```http
POST /api/{device_id}/stop
```

### Получить список шоу
```http
GET /api/{device_id}/shows
```

**Ответ:**
```json
{
  "ok": true,
  "shows": [
    {"id": "show_001", "title": "Morning Show"},
    {"id": "show_002", "title": "Evening Premiere"}
  ]
}
```

### Выбрать шоу
```http
POST /api/{device_id}/select-show
Content-Type: application/json

{"id": "show_001"}
```

### Получить список cues
```http
GET /api/{device_id}/cues
```

**Ответ:**
```json
{
  "ok": true,
  "cues": [
    {"id": "cue_1", "title": "Lights Down"},
    {"id": "cue_2", "title": "Start Feature"}
  ]
}
```

### Запустить cue
```http
POST /api/{device_id}/trigger-cue
Content-Type: application/json

{"id": "cue_1"}
```

### Изменить режим
```http
POST /api/{device_id}/change-mode
Content-Type: application/json

{"mode": "Manual"}
```

**Доступные режимы:** `Manual`, `Scheduled`, `ManualRepeat`

---

## Проектор

### Статус проектора
```http
GET /api/{device_id}/projector
```

**Ответ:**
```json
{
  "ok": true,
  "lamp": "On",
  "dowser": "Open",
  "active_macro": null
}
```

### Получить список макросов
```http
GET /api/{device_id}/projector/macros
```

**Ответ:**
```json
{
  "ok": true,
  "macros": [
    {"name": "2D_FLAT", "title": "2D Flat"},
    {"name": "3D_SCOPE", "title": "3D Scope"}
  ]
}
```

### Выполнить макрос
```http
POST /api/{device_id}/projector/macro/{macro_name}
```

**Параметры пути:**
- `macro_name` - имя макроса (например: `2D_FLAT`)

### Управление лампой
```http
POST /api/{device_id}/projector/lamp/{action}
```

**Параметры пути:**
- `action` - `on` или `off`

### Управление dowser (шторкой)
```http
POST /api/{device_id}/projector/dowser/{action}
```

**Параметры пути:**
- `action` - `open` или `close`

### Следующее событие расписания
```http
GET /api/{device_id}/projector/next-event
```

---

## Расписание

### Получить расписание устройства
```http
GET /api/{device_id}/schedule
```

**Query параметры:**
- `start` - начало периода в формате ISO 8601 (опционально)
- `end` - конец периода в формате ISO 8601 (опционально)
- `fast` - быстрый режим без внешних данных (опционально)

**Ответ:**
```json
{
  "ok": true,
  "schedule": [
    {
      "scheduleId": "sch_001",
      "showId": "show_001",
      "title": "Movie Title",
      "start": "2025-01-18T14:00:00Z",
      "durationSec": 7200
    }
  ]
}
```

### Получить расписание на день (все залы)
```http
GET /api/schedule/day
```

**Query параметры:**
- `day` - дата в формате YYYY-MM-DD (опционально, по умолчанию сегодня)
- `fast` - быстрый режим (опционально)

### Отладка внешнего расписания
```http
GET /api/schedule/external-debug
```

**Query параметры:**
- `day` - дата в формате YYYY-MM-DD (опционально)

### SOAP статистика
```http
GET /api/{device_id}/soap-stats
```

**Query параметры:**
- `reset` - `1` для сброса статистики

---

## Аудиопроцессор CP750

### Список CP750 устройств
```http
GET /api/cp750/devices
```

**Ответ:**
```json
{
  "devices": [
    {
      "id": "Zal1_cp750",
      "name": "Zal1_cp750",
      "host": "192.168.198.71",
      "port": 61408,
      "hall": "Zal1"
    }
  ]
}
```

### Статус CP750
```http
GET /api/cp750/{cp_id}/status
```

**Ответ:**
```json
{
  "level": 47,
  "mute": false,
  "format": "71",
  "input_mode": "dig_1",
  "cp750_id": "Zal1_cp750"
}
```

### Агрегированный статус всех CP750
```http
GET /api/cp750/status/all
```

### Установить уровень громкости (fader)
```http
POST /api/cp750/{cp_id}/fader
Content-Type: application/json

{"value": 45, "force": false}
```

**Параметры:**
- `value` - уровень 0-100
- `force` - true для подтверждения опасно высокого уровня (выше порога)

### Установить mute
```http
POST /api/cp750/{cp_id}/mute
Content-Type: application/json

{"mute": true}
```

### Установить режим входа
```http
POST /api/cp750/{cp_id}/input-mode
Content-Type: application/json

{"mode": "dig_1"}
```

---

## Ingest (FTP сканирование)

### Запустить сканирование FTP
```http
POST /api/{device_id}/ingest/scan-start
Content-Type: application/json

{"url": "ftp://user:pass@host:21/path"}
```

**Ответ:**
```json
{
  "ok": true,
  "job_id": "uuid-job-id"
}
```

### Статус сканирования
```http
GET /api/{device_id}/ingest/scan-status?job={job_id}
```

### Статус с дедупликацией
```http
GET /api/{device_id}/ingest/scan-status2?job={job_id}
```

### Отменить сканирование
```http
POST /api/{device_id}/ingest/scan-cancel
Content-Type: application/json

{"job": "job_id"}
```

### История задач
```http
GET /api/{device_id}/ingest/jobs
GET /api/{device_id}/ingest/history
```

### Детали задачи
```http
GET /api/{device_id}/ingest/job/{job_id}
```

---

## Extended API (WSDL методы)

Extended API предоставляет прямой доступ ко всем методам WSDL Barco и Dolby.
Все эндпоинты имеют префикс `/api/{device_id}/extended/`.

### Session

| Endpoint | Barco | Dolby | Описание |
|----------|:-----:|:-----:|----------|
| `GET /extended/session/whoami` | ✅ | ✅ | Текущий пользователь |
| `GET /extended/session/users` | ✅ | ❌ | Список пользователей |
| `GET /extended/session/sessions` | ✅ | ❌ | Активные сессии |

### Player

| Endpoint | Barco | Dolby | Описание |
|----------|:-----:|:-----:|----------|
| `GET /extended/player/selected` | ✅ | ❌ | Выбранное шоу |
| `GET /extended/player/recovery` | ✅ | ❌ | Информация восстановления |

### Projector

| Endpoint | Barco | Dolby | Описание |
|----------|:-----:|:-----:|----------|
| `GET /extended/projector/test-patterns` | ✅ | ❌ | Тестовые паттерны |
| `GET /extended/projector/all-macros` | ✅ | ❌ | Все макросы (вкл. скрытые) |
| `GET /extended/projector/lens` | ✅ | ❌ | Информация об объективе |
| `GET /extended/projector/light-mode` | ✅ | ❌ | Режим освещения |

### Content

| Endpoint | Barco | Dolby | Описание |
|----------|:-----:|:-----:|----------|
| `GET /extended/cpl` | ✅ | ✅ | Список CPL |
| `GET /extended/cpl/{id}` | ✅ | ✅ | Детали CPL |
| `GET /extended/kdm` | ✅ | ✅ | Список KDM |
| `GET /extended/spl` | ❌ | ✅ | Список SPL (Dolby) |
| `GET /extended/shows` | ✅ | ❌ | Список Shows (Barco) |
| `GET /extended/macros` | ✅ | ✅ | Список макросов |

### Storage

| Endpoint | Barco | Dolby | Описание |
|----------|:-----:|:-----:|----------|
| `GET /extended/storage` | ✅ | ✅ | Статус хранилища |
| `GET /extended/storage/raid` | ✅ | ❌ | Статус RAID |
| `GET /extended/storage/external` | ✅ | ❌ | Внешние накопители |

### Ingest (Dolby only)

| Endpoint | Barco | Dolby | Описание |
|----------|:-----:|:-----:|----------|
| `GET /extended/ingest` | ❌ | ✅ | Задачи загрузки |

### Schedule

| Endpoint | Barco | Dolby | Описание |
|----------|:-----:|:-----:|----------|
| `GET /extended/schedule/status` | ✅ | ✅ | Статус планировщика |
| `GET /extended/schedule/next` | ✅ | ✅ | Следующее событие |

### System

| Endpoint | Barco | Dolby | Описание |
|----------|:-----:|:-----:|----------|
| `GET /extended/system/version` | ✅ | ✅ | Версия ПО |
| `GET /extended/system/version/details` | ✅ | ❌ | Детальные версии |
| `GET /extended/system/product` | ✅ | ❌ | Информация о продукте |
| `GET /extended/system/status` | ✅ | ✅ | Статус системы |
| `GET /extended/system/errors` | ✅ | ❌ | Ошибки системы |
| `GET /extended/system/immersive-sound` | ✅ | ❌ | Immersive audio |

### GPIO / Cues / Licenses

| Endpoint | Barco | Dolby | Описание |
|----------|:-----:|:-----:|----------|
| `GET /extended/gpio` | ✅ | ❌ | Статус GPIO |
| `GET /extended/cues` | ✅ | ❌ | Список cues |
| `GET /extended/licenses` | ✅ | ❌ | Лицензии |

### Примеры Extended API

```bash
# Получить все CPL
curl http://localhost:8089/api/Zal1/extended/cpl

# Получить KDM
curl http://localhost:8089/api/Zal1/extended/kdm

# Статус системы Dolby
curl http://localhost:8089/api/Zal2/extended/system/status
```

---

## Администрирование

### Аутентификация

#### Вход
```http
POST /api/{device_id}/login
Content-Type: application/json

{"username": "admin", "password": "password"}
```

#### Выход
```http
POST /api/{device_id}/logout
```

### Управление устройствами

#### Получить список устройств (admin)
```http
GET /api/admin/devices
```

#### Создать устройство
```http
POST /api/admin/devices
Content-Type: application/json

{
  "id": "Zal7",
  "protocol": "barco",
  "name": "New Hall",
  "host": "192.168.198.67",
  "port": 43758,
  "username": "admin",
  "password": "password"
}
```

**Для Dolby:**
```json
{
  "id": "Zal8",
  "protocol": "dolby",
  "name": "Dolby Hall",
  "base_url": "http://192.168.198.48",
  "login_user": "admin",
  "login_pass": "1234"
}
```

#### Обновить устройство
```http
PUT /api/admin/devices/{device_id}
Content-Type: application/json

{"name": "Updated Name"}
```

#### Удалить устройство
```http
DELETE /api/admin/devices/{device_id}
```

### Выключение сервера (dev)
```http
POST /api/admin/shutdown
```

**Заголовки (если установлен SMS_ADMIN_TOKEN):**
- `X-Admin-Token: <token>`

---

## Переменные окружения

| Переменная | Описание | По умолчанию |
|------------|----------|--------------|
| `SMS_SUPPRESS_TLS_WARN` | Подавить предупреждения TLS | `1` |
| `SMS_VERBOSE` | Подробные логи SOAP | `0` |
| `CP750_TIMEOUT` | Таймаут сокета CP750 (сек) | - |
| `CP750_FADER_MAX` | Макс. значение fader | - |
| `CP750_FADER_THRESHOLD` | Порог подтверждения | `45` |
| `SMS_ADMIN_TOKEN` | Токен для admin shutdown | - |
| `SMS_FORCE_EXIT_SEC` | Принудительный выход (сек) | `0` |

---

## Конфигурация

Файл: `backend/config.json`

```json
{
  "verify_ssl": false,
  "timeout_sec": 10,
  "barco_poll_interval_sec": 60,
  "dolby_poll_interval_sec": 3,
  "devices": [
    {
      "id": "Zal1",
      "protocol": "barco",
      "name": "Barco1",
      "host": "192.168.198.61",
      "port": 43758,
      "username": "admin",
      "password": "password",
      "cp750": {
        "id": "Zal1_cp750",
        "name": "Zal1_cp750",
        "host": "192.168.198.71",
        "port": 61408
      }
    },
    {
      "id": "Zal2",
      "protocol": "dolby",
      "name": "doremi2",
      "base_url": "http://192.168.198.42",
      "login_user": "admin",
      "login_pass": "1234",
      "cp750": {
        "id": "Zal2_cp750",
        "name": "Zal2_cp750",
        "host": "192.168.198.72",
        "port": 61408
      }
    }
  ]
}
```

---

## Поддерживаемые протоколы

### Barco (SOAP SMS 1.2)
- Полная поддержка управления плеером
- Управление проектором (lamp, dowser, macros)
- Расписание через SOAP
- Таймаут минимум 10 секунд (рекомендация Barco)

### Dolby/Doremi
- Управление воспроизведением через ShowControl
- Lamp/Dowser статус
- SPL timeline
- Интеграция с CP750

---

## Интерфейсы

| URL | Описание |
|-----|----------|
| `/ui/` | Основной веб-интерфейс |
| `/debug` | Отладочная страница |
| `/api-manager` | API Manager |

---

## Ошибки

Все ошибки возвращаются в формате:
```json
{
  "detail": "Error message"
}
```

**HTTP коды:**
- `400` - Неверный запрос
- `404` - Устройство не найдено
- `409` - Конфликт (устройство уже существует)
- `502` - Ошибка связи с устройством
- `503` - Сервис недоступен (завершение работы)

---

## Примеры использования

### PowerShell
```powershell
# Проверка API
Invoke-RestMethod -Uri "http://localhost:8089/api/ping"

# Получить статус устройства
Invoke-RestMethod -Uri "http://localhost:8089/api/Zal1/status"

# Воспроизведение
Invoke-RestMethod -Uri "http://localhost:8089/api/Zal1/play" -Method POST
```

### curl
```bash
# Проверка API
curl http://localhost:8089/api/ping

# Получить устройства
curl http://localhost:8089/api/devices

# Изменить громкость CP750
curl -X POST http://localhost:8089/api/cp750/Zal1_cp750/fader \
  -H "Content-Type: application/json" \
  -d '{"value": 45}'
```

### JavaScript/Fetch
```javascript
// Получить live статус
fetch('http://localhost:8089/api/status/live')
  .then(r => r.json())
  .then(data => console.log(data.devices));

// SSE подписка на обновления
const evtSource = new EventSource('http://localhost:8089/api/status/stream');
evtSource.onmessage = (e) => {
  const data = JSON.parse(e.data);
  console.log('Update:', data.devices);
};
```
