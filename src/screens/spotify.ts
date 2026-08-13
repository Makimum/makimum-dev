import { NOW_PLAYING, type Song, type Track } from './nowPlaying'

/**
 * Живой Spotify на планшете.
 *
 * Комната спрашивает `/api/now-playing` ровно так же, как спрашивает
 * погоду у Open-Meteo: асинхронно, ничего не блокируя, и с готовностью
 * не получить ответа. Пока ответа нет — на планшете играет встроенный
 * трек, и посетитель ничего не замечает.
 *
 * ПОЗИЦИЯ ДОРОЖКИ СЧИТАЕТСЯ, А НЕ СПРАШИВАЕТСЯ. Опрос идёт раз в
 * полминуты, а головка обязана ехать плавно. Сервер отдаёт позицию на
 * момент ответа, дальше её продолжают ЧАСЫ: `progress + (сейчас − когда
 * ответили)`. Каждый следующий опрос заново синхронизирует. Иначе
 * дорожка стояла бы тридцать секунд и прыгала.
 *
 * ОБЛОЖКА ОСТАЁТСЯ ПРОЦЕДУРНОЙ, и это не экономия. Настоящая обложка —
 * картинка с чужих серверов, то есть внешний ассет; на витрине этого
 * сайта написано «zero assets», и одна такая картинка сделала бы
 * заявление на первом экране ложным. Мотив выводится из настоящего
 * названия трека, поэтому меняется вместе с музыкой.
 */

const ENDPOINT = '/api/now-playing'
/** Раз в полминуты. Трек живёт минуты, а не секунды; чаще спрашивать
 *  незачем, и на стороне сервера всё равно стоит кеш на 15 секунд. */
const POLL_MS = 30_000

interface Payload extends Song {
  playing: boolean
  progressSec: number
  recent: Song[]
}

export interface LiveState {
  track: Track
  /** Позиция на момент ответа, секунды. */
  progressSec: number
  /** Когда ответ пришёл, по `performance.now()`. */
  at: number
  playing: boolean
  url: string
  /** Что играло до этого — планшет показывает списком. */
  recent: Song[]
}

let live: LiveState | null = null
let started = false
/** Поднимается при смене трека — планшету надо перерисовать весь экран,
 *  а не только полосу прогресса. */
let changed = false

function toTrack(p: Payload): Track {
  return {
    title: p.title,
    artist: p.artist,
    album: p.album,
    seconds: Math.max(1, p.durationSec),
    // Строка над обложкой: у настоящего трека это альбом, а не сайт.
    source: p.album || 'Spotify',
  }
}

async function poll() {
  try {
    const res = await fetch(ENDPOINT, { cache: 'no-store' })
    // 204 — не настроено или Spotify молчит. Оба случая штатные:
    // оставляем то, что уже показано.
    if (res.status === 204 || !res.ok) return
    const p = (await res.json()) as Payload
    if (!p?.title) return
    const wasKey = live && `${live.track.title}|${live.track.artist}`
    const key = `${p.title}|${p.artist}`
    live = {
      track: toTrack(p),
      progressSec: p.progressSec,
      at: performance.now(),
      playing: p.playing,
      url: p.url,
      recent: Array.isArray(p.recent) ? p.recent : [],
    }
    if (wasKey !== key) changed = true
  } catch {
    // Сети нет или ответ битый — молча живём дальше на прежнем состоянии.
  }
}

/** Запускается один раз при сборке комнаты. Первый опрос сразу, дальше
 *  по таймеру. */
export function startSpotify() {
  if (started) return
  started = true
  void poll()
  setInterval(() => void poll(), POLL_MS)
}

/** Что показывать планшету прямо сейчас. */
export function currentTrack(): Track {
  return live?.track ?? NOW_PLAYING
}

/**
 * Позиция дорожки, секунды.
 *
 * У живого трека — от последнего ответа плюс прошедшее время, и только
 * пока он ИГРАЕТ: на паузе головка обязана стоять. У встроенного —
 * по часам с начала эпохи, чтобы у каждого посетителя трек стоял на
 * своём месте, а не на одном и том же кадре.
 */
export function currentElapsed(nowMs: number): number {
  if (!live) return (nowMs / 1000) % NOW_PLAYING.seconds
  const drift = live.playing ? (nowMs - live.at) / 1000 : 0
  return Math.min(live.track.seconds, live.progressSec + drift)
}

/** Сменился ли трек с прошлого вопроса. Флаг снимается читателем. */
export function trackChanged(): boolean {
  const was = changed
  changed = false
  return was
}

/** Играет ли что-то. Планшет рисует паузу вместо кнопки остановки. */
export function isPlaying(): boolean {
  return live ? live.playing : true
}

/** Что играло до этого. Пусто, пока Spotify не подключён — планшет тогда
 *  и не предлагает открыть список. */
export function recentTracks(): Song[] {
  return live?.recent ?? []
}

/** Ссылка на текущий трек, если она есть. */
export function trackUrl(): string {
  return live?.url ?? ''
}

/**
 * Подменить то, что «играет», — для проверки вёрстки.
 *
 * Заведён по той же причине, что и `setWeather`: ждать в Хельсинки
 * подходящей погоды, чтобы посмотреть на свой же шейдер, — не вариант, и
 * ждать подходящего трека, чтобы посмотреть на свою же раскладку, тоже.
 * Настоящие названия бывают вчетверо длиннее «This Room», с запятыми в
 * составе исполнителей и с иероглифами; проверить это можно только
 * подсунув такие данные руками.
 *
 * Без аргумента возвращает то, что реально приехало из сети.
 */
export function setNowPlaying(p?: Partial<Payload>) {
  if (!p) {
    live = null
    changed = true
    return null
  }
  const full: Payload = {
    title: 'Untitled',
    artist: '—',
    album: '',
    durationSec: 200,
    url: '',
    playing: true,
    progressSec: 0,
    recent: [],
    ...p,
  }
  live = {
    track: toTrack(full),
    progressSec: full.progressSec,
    at: performance.now(),
    playing: full.playing,
    url: full.url,
    recent: full.recent,
  }
  changed = true
  return full
}

/** Подключён ли настоящий Spotify. От этого зависит, что предлагать в
 *  фокусе: у встроенного трека ни списка, ни ссылки нет, и обещать их
 *  подписью было бы враньём. */
export function isLive(): boolean {
  return live !== null
}
