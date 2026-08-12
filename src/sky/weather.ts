import { HELSINKI } from './time'

/**
 * Погода над Хельсинки — Open-Meteo.
 *
 * Правила, из которых сделан этот модуль:
 *
 * 1. **Комната никогда не ждёт сеть.** Небо поднимается сразу с ясной
 *    погодой, ответ приезжает и меняет его через секунду. Спиннеров,
 *    сообщений об ошибке и «загрузка погоды…» здесь нет и быть не может:
 *    это декорация, а не функциональность.
 * 2. **Один запрос на сессию.** Ответ кладётся в localStorage на 15 минут —
 *    у самого API интервал обновления 900 секунд, чаще спрашивать нечего.
 *    Лимит бесплатного тарифа 10 000 запросов в сутки; при таком кэше
 *    его не выбрать даже ботам.
 * 3. **Координаты фиксированные, финские.** У посетителя не спрашивается
 *    ничего: ни геолокации, ни разрешений. В сеть уходит только запрос
 *    про Хельсинки.
 *
 * Ключ не нужен. Лицензия данных — CC BY 4.0, атрибуция стоит в
 * приложении This Room.
 */

export interface Weather {
  /** 0…1 */
  cloudCover: number
  /** мм за последний час */
  precipitation: number
  /** Код WMO: 0 ясно, 45 туман, 51–67 дождь, 71–77 снег, 80+ ливни */
  code: number
  temperature: number
  /** км/ч */
  wind: number
  /** true — данные пришли из сети, false — заглушка «ясно» */
  live: boolean
}

export const CLEAR: Weather = {
  cloudCover: 0,
  precipitation: 0,
  code: 0,
  temperature: 0,
  wind: 0,
  live: false,
}

/** Осадки по коду WMO: снег отличается от дождя не силой, а видом. */
export function precipKind(w: Weather): 'none' | 'rain' | 'snow' {
  if (w.code >= 71 && w.code <= 77) return 'snow'
  if (w.code === 85 || w.code === 86) return 'snow'
  if (w.code >= 51 && w.code <= 67) return 'rain'
  if (w.code >= 80 && w.code <= 82) return 'rain'
  if (w.code >= 95) return 'rain'
  return w.precipitation > 0.05 ? 'rain' : 'none'
}

const KEY = 'makimum.weather.v1'
const TTL_MS = 15 * 60 * 1000

const URL =
  `https://api.open-meteo.com/v1/forecast?latitude=${HELSINKI.lat}&longitude=${HELSINKI.lon}` +
  `&current=temperature_2m,cloud_cover,precipitation,weather_code,wind_speed_10m`

interface Cached {
  at: number
  w: Weather
}

function readCache(): Weather | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const c = JSON.parse(raw) as Cached
    if (Date.now() - c.at > TTL_MS) return null
    return c.w
  } catch {
    return null
  }
}

/**
 * Возвращает погоду. Никогда не бросает и никогда не висит: при любой
 * проблеме — ясное небо.
 */
export async function fetchWeather(): Promise<Weather> {
  const cached = readCache()
  if (cached) return cached

  try {
    // Таймаут свой: fetch по умолчанию ждёт столько, сколько захочет сеть,
    // а нам достаточно секунд, дальше просто ясно.
    const ctl = new AbortController()
    const timer = setTimeout(() => ctl.abort(), 6000)
    const res = await fetch(URL, { signal: ctl.signal })
    clearTimeout(timer)
    if (!res.ok) return CLEAR

    const j = (await res.json()) as {
      current?: Record<string, number>
    }
    const c = j.current
    if (!c) return CLEAR

    const w: Weather = {
      cloudCover: Math.min(1, Math.max(0, (c.cloud_cover ?? 0) / 100)),
      precipitation: c.precipitation ?? 0,
      code: c.weather_code ?? 0,
      temperature: c.temperature_2m ?? 0,
      wind: c.wind_speed_10m ?? 0,
      live: true,
    }
    try {
      localStorage.setItem(KEY, JSON.stringify({ at: Date.now(), w } satisfies Cached))
    } catch {
      // Приватный режим запрещает запись — не повод ронять небо.
    }
    return w
  } catch {
    return CLEAR
  }
}
