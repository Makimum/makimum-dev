#!/usr/bin/env node
/**
 * Получить refresh-токен Spotify. Запускается ОДИН РАЗ, на своей машине.
 *
 *   node scripts/spotify-auth.mjs
 *
 * Скрипт поднимает временный сервер на 127.0.0.1:8888, открывает окно
 * согласия Spotify, ловит код возврата, меняет его на токены и печатает
 * refresh-токен в терминал. Больше он не делает ничего: никуда не ходит,
 * ничего не сохраняет на диск и никому не отправляет.
 *
 * ПОЧЕМУ ТОКЕН ПЕЧАТАЕТСЯ, А НЕ ЗАПИСЫВАЕТСЯ В ФАЙЛ. Файл с учётными
 * данными в рабочем каталоге — это файл, который однажды уедет в коммит.
 * Из терминала строка идёт прямо в `wrangler pages secret put`, и на
 * диске не остаётся.
 *
 * ЧТО НУЖНО ЗАРАНЕЕ
 *
 *  1. developer.spotify.com/dashboard → Create app.
 *     Имя любое. Redirect URI — РОВНО:  http://127.0.0.1:8888/callback
 *     Именно 127.0.0.1, а не localhost: Spotify требует https везде,
 *     кроме петлевого адреса, и «localhost» под это исключение у них
 *     не подпадает.
 *     API/SDK — Web API.
 *
 *  2. Со страницы приложения взять Client ID и Client Secret и передать
 *     их скрипту переменными окружения, чтобы они не попали в историю
 *     команд оболочки:
 *
 *        read -rs SPOTIFY_CLIENT_ID
 *        read -rs SPOTIFY_CLIENT_SECRET
 *        export SPOTIFY_CLIENT_ID SPOTIFY_CLIENT_SECRET
 *        node scripts/spotify-auth.mjs
 *
 * ЗАПРАШИВАЕМЫЕ ПРАВА — ТОЛЬКО ЧТЕНИЕ ТОГО, ЧТО ИГРАЕТ.
 * `user-read-currently-playing` и `user-read-recently-played`. Ни
 * управления плеером, ни доступа к библиотеке, ни к почте, ни к
 * плейлистам. Токен, выданный на эти права, не может изменить в аккаунте
 * ничего — в худшем случае кто-то узнает, что вы слушаете, а это ровно
 * то, что сайт и показывает всем подряд по вашему решению.
 */

import http from 'node:http'
import crypto from 'node:crypto'
import { exec } from 'node:child_process'

const CLIENT_ID = process.env.SPOTIFY_CLIENT_ID
const CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET
const REDIRECT = 'http://127.0.0.1:8888/callback'
const SCOPES = 'user-read-currently-playing user-read-recently-played'

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('\nНет SPOTIFY_CLIENT_ID или SPOTIFY_CLIENT_SECRET в окружении.')
  console.error('См. комментарий в начале файла.\n')
  process.exit(1)
}

// Защита от подделки ответа: сверяем то, что вернулось, с тем, что послали.
const state = crypto.randomBytes(16).toString('hex')

const authUrl =
  'https://accounts.spotify.com/authorize?' +
  new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: 'code',
    redirect_uri: REDIRECT,
    scope: SCOPES,
    state,
    // Заставляет Spotify показать экран согласия, даже если приложение
    // уже разрешено: иначе при повторном прогоне непонятно, выдан ли
    // новый токен или подставлен старый.
    show_dialog: 'true',
  })

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1:8888')
  if (url.pathname !== '/callback') {
    res.writeHead(404).end()
    return
  }

  const done = (message) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    res.end(
      `<!doctype html><meta charset="utf-8">` +
        `<body style="font:16px/1.5 ui-monospace,monospace;background:#0b0e13;color:#eae8e3;` +
        `display:grid;place-items:center;height:100vh;margin:0"><p>${message}</p></body>`,
    )
  }

  if (url.searchParams.get('state') !== state) {
    done('Не совпал state. Запустите скрипт заново.')
    console.error('\nНе совпал state — ответ пришёл не на наш запрос. Прервано.\n')
    server.close()
    process.exit(1)
  }

  const error = url.searchParams.get('error')
  if (error) {
    done('Доступ не выдан.')
    console.error(`\nSpotify вернул ошибку: ${error}\n`)
    server.close()
    process.exit(1)
  }

  const code = url.searchParams.get('code')
  const basic = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64')
  const r = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT,
    }),
  })

  if (!r.ok) {
    done('Обмен кода не удался.')
    console.error(`\nОбмен кода на токен: HTTP ${r.status}\n`, await r.text(), '\n')
    server.close()
    process.exit(1)
  }

  const json = await r.json()
  done('Готово. Возвращайтесь в терминал.')
  server.close()

  console.log('\n──────────────────────────────────────────────────────────')
  console.log('REFRESH-ТОКЕН (никому не показывать, в чат не вставлять):\n')
  console.log(json.refresh_token)
  console.log('\n──────────────────────────────────────────────────────────')
  console.log('\nДальше три команды. Каждая спросит значение и не покажет его:\n')
  console.log('  bunx wrangler pages secret put SPOTIFY_CLIENT_ID     --project-name=makimum')
  console.log('  bunx wrangler pages secret put SPOTIFY_CLIENT_SECRET --project-name=makimum')
  console.log('  bunx wrangler pages secret put SPOTIFY_REFRESH_TOKEN --project-name=makimum')
  console.log('\nПосле них — новый деплой, и планшет заиграет ваш Spotify.')
  console.log('Проверить:  curl -s https://makimum.dev/api/now-playing\n')
})

server.listen(8888, '127.0.0.1', () => {
  console.log('\nОткрываю окно согласия Spotify…')
  console.log('Если не открылось — вот ссылка:\n')
  console.log(authUrl + '\n')
  const open =
    process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start ""' : 'xdg-open'
  exec(`${open} "${authUrl}"`)
})
