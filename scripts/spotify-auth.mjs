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
 *  2. Запустить скрипт. Client ID и Client Secret он спросит сам, скрыв
 *     ввод. Файла с ними заводить НЕ НАДО: `.env` в рабочем каталоге —
 *     это файл, который однажды уедет в коммит, а репозиторий публичный.
 *     Переменные окружения тоже годятся, если они уже выставлены, — но
 *     это не обязательный путь, а запасной.
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
import { exec, spawn } from 'node:child_process'

const REDIRECT = 'http://127.0.0.1:8888/callback'
const SCOPES = 'user-read-currently-playing user-read-recently-played'

/** Управляющие символы задаются кодом, а не литералом: в исходнике
 *  они невидимы, и первый же редактор или копипаста их потеряет. */
const CTRL_C = String.fromCharCode(3)
const CTRL_D = String.fromCharCode(4)
const BACKSPACE = String.fromCharCode(127)

/**
 * Спросить строку, не показывая ввод.
 *
 * ПОЧЕМУ НЕ `readline`. Первая версия брала его, и на втором вопросе
 * скрипт зависал: закрытый интерфейс уносит stdin с собой, а общий на два
 * вопроса при вводе трубой съедает обе строки первым же чтением. Поймано
 * прогоном `printf 'a\nb\n' | node ...` — минута работы вместо зависшего
 * терминала у того, кто это запустит.
 *
 * ОСТАТОК КУСКА ОБЯЗАТЕЛЬНО СОХРАНЯЕТСЯ. Client ID и Secret ВСТАВЛЯЮТ, а
 * не печатают руками, и вставленные подряд они приходят одним куском.
 * Выбросив хвост после перевода строки, мы теряли второе значение и ждали
 * его вечно — ровно это и показал прогон.
 */
let pending = ''

function takeLine() {
  const i = pending.search(/[\r\n]/)
  if (i < 0) return null
  const line = pending.slice(0, i)
  pending = pending.slice(i + 1).replace(/^\n/, '')
  return line
}

function askHidden(label, hidden = true) {
  process.stdout.write(label)
  const ready = takeLine()
  if (ready !== null) {
    process.stdout.write('\n')
    return Promise.resolve(ready.trim())
  }
  return new Promise((resolve) => {
    const stdin = process.stdin
    const wasRaw = !!stdin.isRaw
    // Сырой режим и ЕСТЬ «не показывать ввод»: терминал перестаёт печатать
    // нажатия сам, а мы за него не печатаем.
    if (stdin.isTTY && hidden) stdin.setRawMode(true)
    stdin.resume()
    stdin.setEncoding('utf8')
    let buf = ''
    let done = false
    const finish = () => {
      if (done) return
      done = true
      stdin.removeListener('data', onData)
      if (stdin.isTTY && hidden) stdin.setRawMode(wasRaw)
      stdin.pause()
      if (hidden) process.stdout.write('\n')
      resolve(buf.trim())
    }
    const onData = (chunk) => {
      if (done) return
      for (let k = 0; k < chunk.length; k++) {
        const ch = chunk[k]
        // В сыром режиме Ctrl+C сигналом не приходит. Не обработать его —
        // значит оставить человека без способа прервать ввод.
        if (ch === CTRL_C) {
          process.stdout.write('\n')
          process.exit(130)
        }
        if (ch === '\r' || ch === '\n' || ch === CTRL_D) {
          pending += chunk.slice(k + 1).replace(/^\n/, '')
          return finish()
        }
        if (ch === BACKSPACE || ch === '\b') buf = buf.slice(0, -1)
        else buf += ch
      }
    }
    stdin.on('data', onData)
  })
}

console.log('\nАвторизация Spotify. Ввод не отображается — это нормально.')
console.log('Значения берутся со страницы приложения в developer.spotify.com/dashboard.\n')

const CLIENT_ID = process.env.SPOTIFY_CLIENT_ID || (await askHidden('Client ID:     '))
const CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET || (await askHidden('Client Secret: '))

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('\nПусто. Прервано.\n')
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

  /**
   * ТОКЕН НА ЭКРАН БОЛЬШЕ НЕ ПЕЧАТАЕТСЯ.
   *
   * Первая версия печатала его и просила «никому не показывать». Это не
   * сработало — и не могло: строка на экране существует, чтобы её
   * скопировали, а куда именно, решает уже человек в спешке. У Максима
   * она уехала в переписку через полминуты после появления.
   *
   * Правильное решение — не показывать вовсе, а отдать напрямую тому,
   * кому она нужна. `wrangler pages secret put` читает значение со
   * стандартного ввода, так что токен идёт из памяти процесса в секреты
   * Cloudflare и нигде по дороге не появляется.
   *
   * Ручной путь остаётся на случай другого хостинга, но он теперь
   * ЯВНЫЙ выбор, а не то, что происходит само.
   */
  const project = process.env.CF_PAGES_PROJECT || 'makimum'
  console.log('\nТокен получен. На экран он не выводится — так безопаснее.\n')
  const answer = (await askHidden(`Положить все три секрета в проект «${project}» сейчас? [Y/n] `, false))
    .toLowerCase()

  if (answer === 'n' || answer === 'no') {
    console.log('\nХорошо. Тогда вывожу токен — он нужен вам сейчас, и это')
    console.log('осознанный выбор. Скопируйте и СРАЗУ очистите терминал (Cmd+K).')
    console.log('Никуда, кроме секретов хостинга, эту строку вставлять нельзя.\n')
    console.log(json.refresh_token)
    console.log('')
    process.exit(0)
  }

  const put = (name, value) =>
    new Promise((resolve) => {
      const child = spawn(
        'npx',
        ['--yes', 'wrangler@4', 'pages', 'secret', 'put', name, '--project-name=' + project],
        { stdio: ['pipe', 'inherit', 'inherit'] },
      )
      child.stdin.write(value + '\n')
      child.stdin.end()
      child.on('close', (code) => resolve(code === 0))
    })

  console.log('\nКладу секреты. Значения не печатаются.\n')
  const ok =
    (await put('SPOTIFY_CLIENT_ID', CLIENT_ID)) &&
    (await put('SPOTIFY_CLIENT_SECRET', CLIENT_SECRET)) &&
    (await put('SPOTIFY_REFRESH_TOKEN', json.refresh_token))

  if (!ok) {
    console.error('\nЧто-то не легло. Посмотрите вывод wrangler выше.\n')
    process.exit(1)
  }

  console.log('\nВсе три на месте. Осталось выкатить — секреты Pages')
  console.log('подхватываются только НОВЫМ деплоем:\n')
  console.log('  bun x vite build')
  console.log('  npx wrangler@4 pages deploy dist --project-name=' + project +
    ' --branch=main --commit-dirty=true\n')
  console.log('Проверить:  curl -s https://makimum.dev/api/now-playing\n')
  process.exit(0)
})

server.listen(8888, '127.0.0.1', () => {
  console.log('\nОткрываю окно согласия Spotify…')
  console.log('Если не открылось — вот ссылка:\n')
  console.log(authUrl + '\n')
  const open =
    process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start ""' : 'xdg-open'
  exec(`${open} "${authUrl}"`)
})
