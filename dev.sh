#!/bin/sh
# Запуск дев-сервера спайка. Скрипт нужен, чтобы launch.json не зависел
# от текущей директории — она у него не настраивается.
cd "$(dirname "$0")" || exit 1
exec bun x vite --port 5178 --strictPort
