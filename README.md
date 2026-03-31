# Ghost Overlay

Невидимый AI-ассистент поверх экрана. Electron-окно без рамки, поверх всех окон, защищённое от захвата экрана. Работает через локальный reverse proxy к Claude Code + Whisper STT.

## Запуск

### 1. Прокси-сервер

Оверлей обращается к Claude через локальный прокси (`http://127.0.0.1:8317`).
`start.bat` автоматически поднимает локальный прокси из `proxy/`, если порт `8317` свободен.
Ручной запуск прокси тоже доступен: `proxy/start-proxy.bat`.

URL прокси задаётся в `config.json`, а ключи — в `.env`.

### 2. Оверлей

```bash
# установить зависимости (один раз)
npm install

# запуск
npm start

# или через bat-файл
start.bat
```

### Конфигурация

1. Скопировать `config.example.json` → `config.json` и заполнить не-секретные настройки.
2. Скопировать `.env.example` → `.env` и заполнить ключи:
   - `CLAUDE_CODE_SETUP_TOKEN` — токен, используемый как auth token для локального proxy endpoint
   - `WHISPER_API_KEY` — API key для Whisper STT

Пример `.env`:
```dotenv
CLAUDE_CODE_SETUP_TOKEN=your-claude-code-setup-token
WHISPER_API_KEY=your-whisper-api-key
```

Важно: overlay использует локальный прокси на `127.0.0.1:8317`; токен передаётся в этот прокси.

### Связка ключей (важно)

- В `proxy/config.yaml` есть `api-keys[0]`.
- В `overlay/.env` есть `CLAUDE_CODE_SETUP_TOKEN`.
- Эти значения должны совпадать.

Пример `config.json` (без секретов):
```json
{
  "claude": {
    "baseUrl": "http://127.0.0.1:8317",
    "apiKey": ""
  },
  "whisper": {
    "apiKey": ""
  }
}
```

## External Runtime Dependency

- Proxy runtime is external: `CLIProxyAPI` (MIT).
- Source: `https://github.com/router-for-me/CLIProxyAPI`
- Local attribution/details/checksum: `THIRD_PARTY_NOTICES.md`

## Горячие клавиши

### Глобальные (работают из любого окна)

| Комбинация | Действие | Описание |
|---|---|---|
| `Ctrl+Shift+H` | Показать/скрыть | Переключает видимость окна |
| `Ctrl+Shift+S` | Скриншот | Делает скриншот, прикрепляет к следующему сообщению |
| `Ctrl+Shift+R` | Запись голоса | Вкл/выкл STT (речь → текст через Whisper) |
| `Ctrl+Shift+T` | Отправить транскрипт | Отправляет накопленную транскрипцию в Claude без набора текста |
| `Ctrl+Shift+G` | Скриншот + анализ | Скриншот → автоматическая отправка в Claude с промптом |

### Внутри окна (поле ввода)

| Комбинация | Действие |
|---|---|
| `Enter` | Отправить сообщение |
| `Shift+Enter` | Новая строка |
| `Escape` | Очистить ввод, ответ и скриншот |

### Настройка хоткеев

Все глобальные комбинации задаются в `config.json` → `hotkeys`:
```json
{
  "hotkeys": {
    "toggle": "Ctrl+Shift+H",
    "screenshot": "Ctrl+Shift+S",
    "sttToggle": "Ctrl+Shift+R",
    "sendTranscript": "Ctrl+Shift+T",
    "sendScreenshot": "Ctrl+Shift+G"
  }
}
```

Формат — [Electron Accelerator](https://www.electronjs.org/docs/latest/api/accelerator).
