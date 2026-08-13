/**
 * Что играет у Максима прямо сейчас — Cloudflare Pages Function.
 *
 * ПОЧЕМУ ЭТО СЕРВЕР, А НЕ ЗАПРОС ИЗ БРАУЗЕРА. Долгоживущий refresh-токен
 * Spotify — это учётные данные. В клиентском JS он был бы виден каждому,
 * кто откроет вкладку разработчика, и дал бы полный доступ к аккаунту в
 * рамках выданных прав. Поэтому токен живёт в секретах Pages, а наружу
 * уходит только то, что и так видно на экране планшета: название, автор,
 * альбом, длительность и позиция.
 *
 * ПОЧЕМУ 204, А НЕ 500, КОГДА НЕ НАСТРОЕНО. Проект открыт, и у любого,
 * кто его форкнет, переменных не будет. Пустой ответ — это «нечего
 * показать», и комната спокойно рисует свой встроенный трек. Ошибка же
 * означала бы, что сломано, а ничего не сломано.
 *
 * ТИПЫ ЗДЕСЬ РУЧНЫЕ. Функция исполняется в Workers, а не в браузере, и
 * её типы живут в `@cloudflare/workers-types`. Тащить пакет ради двух
 * интерфейсов — нарушение правила «никаких новых зависимостей» без
 * причины; `tsconfig` проекта покрывает только `src`, а wrangler собирает
 * этот файл esbuild-ом без проверки типов. Поэтому нужное описано здесь.
 */

interface Env {
  SPOTIFY_CLIENT_ID?: string
  SPOTIFY_CLIENT_SECRET?: string
  SPOTIFY_REFRESH_TOKEN?: string
}

interface PagesContext {
  request: Request
  env: Env
  waitUntil(promise: Promise<unknown>): void
}

/** Сколько держим ответ. Пятнадцать секунд — это меньше, чем человек
 *  успевает заметить рассинхрон, и при этом сто одновременных посетителей
 *  дают Spotify четыре запроса в минуту, а не шесть тысяч. */
const CACHE_SECONDS = 15

/**
 * Access-токен живёт час. Изолят Workers переживает много запросов, так
 * что держим его в памяти и обновляем заранее, за пять минут до конца:
 * обмен refresh-токена — это лишние 200 мс на запросе, и платить их
 * каждый раз незачем.
 */
let cachedToken: { value: string; expiresAt: number } | null = null

async function accessToken(env: Env): Promise<string> {
  const now = Date.now()
  if (cachedToken && cachedToken.expiresAt > now) return cachedToken.value

  const basic = btoa(`${env.SPOTIFY_CLIENT_ID}:${env.SPOTIFY_CLIENT_SECRET}`)
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: env.SPOTIFY_REFRESH_TOKEN!,
    }),
  })
  if (!res.ok) throw new Error(`token ${res.status}`)
  const json = (await res.json()) as { access_token: string; expires_in: number }
  cachedToken = {
    value: json.access_token,
    expiresAt: now + (json.expires_in - 300) * 1000,
  }
  return cachedToken.value
}

interface SpotifyArtist {
  name: string
}
interface SpotifyTrack {
  name: string
  duration_ms: number
  artists: SpotifyArtist[]
  album?: { name: string }
}

/** Наружу уходит ровно это и ничего больше. Ни идентификаторов, ни
 *  ссылок, ни того, из какого плейлиста играет: на экране планшета этого
 *  нет, значит и в ответе быть не должно. */
interface Payload {
  playing: boolean
  title: string
  artist: string
  album: string
  durationSec: number
  progressSec: number
}

function shape(track: SpotifyTrack, progressMs: number, playing: boolean): Payload {
  return {
    playing,
    title: track.name,
    artist: track.artists.map((a) => a.name).join(', '),
    album: track.album?.name ?? '',
    durationSec: Math.round(track.duration_ms / 1000),
    progressSec: Math.round(progressMs / 1000),
  }
}

async function readSpotify(env: Env): Promise<Payload | null> {
  const token = await accessToken(env)
  const auth = { Authorization: `Bearer ${token}` }

  const live = await fetch(
    'https://api.spotify.com/v1/me/player/currently-playing?additional_types=track',
    { headers: auth },
  )
  // 204 — «плеер молчит». Это штатный ответ, а не сбой.
  if (live.ok && live.status !== 204) {
    const j = (await live.json()) as {
      item?: SpotifyTrack
      progress_ms?: number
      is_playing?: boolean
      currently_playing_type?: string
    }
    if (j.item && j.currently_playing_type === 'track') {
      return shape(j.item, j.progress_ms ?? 0, !!j.is_playing)
    }
  }

  // Ничего не играет — показываем последнее прослушанное, поставленное на
  // паузу в самом начале. Пустой экран читался бы как поломка, а «плеер
  // на паузе» — это правда о том, что происходит.
  const recent = await fetch('https://api.spotify.com/v1/me/player/recently-played?limit=1', {
    headers: auth,
  })
  if (!recent.ok) return null
  const r = (await recent.json()) as { items?: { track: SpotifyTrack }[] }
  const first = r.items?.[0]?.track
  return first ? shape(first, 0, false) : null
}

export const onRequestGet = async (ctx: PagesContext): Promise<Response> => {
  const { env, request } = ctx

  if (!env.SPOTIFY_CLIENT_ID || !env.SPOTIFY_CLIENT_SECRET || !env.SPOTIFY_REFRESH_TOKEN) {
    // Не настроено — не ошибка. См. шапку файла.
    return new Response(null, { status: 204, headers: { 'Cache-Control': 'public, max-age=300' } })
  }

  // Общий кеш на весь край: сто посетителей одного города обслуживаются
  // одним походом в Spotify.
  const cache = (caches as unknown as { default: Cache }).default
  const key = new Request(new URL(request.url).origin + '/api/now-playing', { method: 'GET' })
  const hit = await cache.match(key)
  if (hit) return hit

  try {
    const data = await readSpotify(env)
    if (!data) return new Response(null, { status: 204 })
    const res = new Response(JSON.stringify(data), {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': `public, max-age=${CACHE_SECONDS}`,
      },
    })
    ctx.waitUntil(cache.put(key, res.clone()))
    return res
  } catch {
    // Spotify лёг или токен отозван. Комната переживёт: она нарисует
    // встроенный трек. Подробности наружу не отдаём — в них может быть
    // текст ошибки провайдера.
    return new Response(null, { status: 204, headers: { 'Cache-Control': 'public, max-age=30' } })
  }
}
