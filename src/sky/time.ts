import * as THREE from 'three'
import * as SunCalc from 'suncalc'

/**
 * Момент времени → состояние неба над Хельсинки.
 *
 * ЕДИНСТВЕННЫЙ вход у всей системы — высота солнца над горизонтом.
 * Фаза суток, яркость комнаты, экспозиция и тёплый сдвиг выводятся из
 * неё, а не назначаются по часам. Поэтому декабрьский полдень в
 * Хельсинки (солнце на 6°) честно выглядит как затянувшийся рассвет —
 * он им и является.
 *
 * ВРЕМЯ БЕРЁТСЯ У КОМНАТЫ, А НЕ У ПОСЕТИТЕЛЯ. Раньше `daylightFactor`
 * читал `date.getHours()` — часы гостя — и сайт из Алматы показывал
 * алматинский вечер. Момент времени абсолютен (`Date` — это UTC),
 * поэтому SunCalc для финских координат даёт финское небо кому угодно;
 * пересчитывать в зону нужно только для НАДПИСИ с часами.
 */

/** Хельсинки. Широта важна: на 60° сумерки длинные, а в июне их нет вовсе. */
export const HELSINKI = { lat: 60.1699, lon: 24.9384 } as const

/**
 * Окно смотрит на ЗАПАД (решение Максима). Отсюда вся ориентация мира:
 * −Z запад, +Z восток, +X север, −X юг.
 *
 * ⚠️ ЕДИНИЦЫ. suncalc 2.0.1 отдаёт **градусы**, а азимут считает
 * **от севера по часовой стрелке** — обычный компасный курс. Все ходовые
 * сниппеты в сети написаны под старый API (радианы, азимут от юга) и
 * дают высоту солнца вроде −113°, которой не бывает. Проверено на живых
 * данных: 9 августа в 21:47 Хельсинки библиотека вернула
 * `altitude −2.01°, azimuth 308.3°` — солнце только что село на
 * северо-западе, закат в 21:31. Сходится.
 *
 * Проверка формулы: азимут 270° (запад) при нулевой высоте даёт
 * (0, 0, −1) — солнце ровно в проёме окна.
 */
export function skyDirection(altitudeDeg: number, azimuthDeg: number, out = new THREE.Vector3()) {
  const alt = altitudeDeg * RAD
  const az = azimuthDeg * RAD
  const c = Math.cos(alt)
  return out.set(c * Math.cos(az), Math.sin(alt), c * Math.sin(az))
}

export type Phase = 'night' | 'astronomical' | 'civil' | 'golden' | 'day'

export interface SkyState {
  /** Момент, для которого всё посчитано */
  date: Date
  /** Высота солнца, градусы. Отрицательная — под горизонтом */
  sunAltitude: number
  sun: THREE.Vector3
  moon: THREE.Vector3
  /** Освещённая доля диска луны, 0…1 */
  moonPhase: number
  /** 0 — ночь, 1 — день. Тот же коэффициент, что интерполирует бейк */
  daylight: number
  /** 0 вне золотого часа, 1 в его середине */
  golden: number
  /** 1 глубокой ночью, 0 днём — прозрачность звёздного слоя */
  nightness: number
  phase: Phase
  /** Часы Хельсинки, уже отформатированные */
  clock: string
}

const helsinkiClock = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Helsinki',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})

const RAD = Math.PI / 180

/** Плавная ступень, чтобы фазы не щёлкали. */
const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

export function skyState(date: Date): SkyState {
  const pos = SunCalc.getPosition(date, HELSINKI.lat, HELSINKI.lon)
  // Уже в градусах — см. комментарий к skyDirection.
  const alt = pos.altitude

  // Границы фаз — стандартные астрономические, а не подобранные:
  // −18° астрономические сумерки, −6° гражданские, 0° сам горизонт,
  // 6° конец золотого часа.
  const daylight = smoothstep(-6, 6, alt)
  const nightness = 1 - smoothstep(-14, -2, alt)
  // Золотой час: колокол вокруг горизонта. Именно он даёт тёплый сдвиг
  // в комнате — третьего запечённого варианта света у нас нет.
  const golden = smoothstep(-6, 1, alt) * (1 - smoothstep(2, 9, alt))

  const phase: Phase =
    alt < -12 ? 'night' : alt < -6 ? 'astronomical' : alt < 0 ? 'civil' : alt < 6 ? 'golden' : 'day'

  const moonPos = SunCalc.getMoonPosition(date, HELSINKI.lat, HELSINKI.lon)
  const moonIllum = SunCalc.getMoonIllumination(date)

  return {
    date,
    sunAltitude: alt,
    sun: skyDirection(pos.altitude, pos.azimuth),
    moon: skyDirection(moonPos.altitude, moonPos.azimuth),
    moonPhase: moonIllum.fraction,
    daylight,
    golden,
    nightness,
    phase,
    clock: helsinkiClock.format(date),
  }
}

/**
 * Тёплый сдвиг вершинных цветов комнаты.
 *
 * Честная оговорка, записанная здесь, а не в README: запечённых
 * вариантов света ровно два — день и ночь. Закат в комнате получается
 * интерполяцией между ними плюс этот множитель. Освещённость
 * правдоподобная, но НЕ посчитанная; за окном при этом всё честно.
 */
export function warmTint(state: SkyState, out = new THREE.Color()): THREE.Color {
  const g = state.golden
  return out.setRGB(1 + 0.26 * g, 1 + 0.05 * g, 1 - 0.17 * g)
}

/**
 * Времена восхода и заката на дату — для отладки и для приёмки.
 * На 60° широты часть моментов бывает `null` (полярный день в июне),
 * и это не ошибка: SunCalc так сообщает, что события не наступает.
 */
export function sunTimes(date: Date) {
  const t = SunCalc.getTimes(date, HELSINKI.lat, HELSINKI.lon)
  // `null` здесь — не ошибка, а сообщение: на 60° широты в июне солнце
  // не заходит, и момента заката не существует.
  const fmt = (d: Date | null | undefined) =>
    d && !Number.isNaN(d.getTime()) ? helsinkiClock.format(d) : null
  return {
    dawn: fmt(t.dawn),
    sunrise: fmt(t.sunrise),
    solarNoon: fmt(t.solarNoon),
    sunset: fmt(t.sunset),
    dusk: fmt(t.dusk),
    night: fmt(t.night),
  }
}
