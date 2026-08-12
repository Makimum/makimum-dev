import * as THREE from 'three'
import { bakeVertexGI, type BakeResult } from './vertexGI'

/**
 * День и ночь.
 *
 * Тут окупается решение печь в вершинные цвета, а не в текстуру.
 * Два состояния освещения — это два `Float32Array` на геометрию, и
 * переход между ними это интерполяция атрибута: ни перезагрузки ассетов,
 * ни второго комплекта текстур, ни лишних запросов по сети. У референса
 * с текстурными атласами то же самое стоило бы ещё 3.5 МБ трафика.
 *
 * Ночь — не «то же самое, только темнее». Меняется источник:
 * днём комнату освещает окно, ночью — лампа и экраны. Поэтому у неба
 * гаснет и яркость, и солнце, а вклад светящихся поверхностей остаётся
 * прежним и начинает доминировать. Это и даёт другой рисунок теней,
 * а не просто снижение экспозиции.
 */

export const DAY = {
  variant: 'day',
  skyColor: new THREE.Color(0xbcd4ec),
  skyIntensity: 1.0,
  sunColor: new THREE.Color(0xfff0d8),
  sunIntensity: 2.1,
  bounceStrength: 1.0,
  // Днём лампа выключена (см. setLamp), поэтому это множитель ТОЛЬКО
  // для экранов. Шесть было катастрофой: радиус источника берётся из
  // ограничивающей сферы, у изогнутого полотна монитора это ~0.42 м
  // против 0.026 м у лампочки, то есть спад r²/d² больше в 170 раз —
  // экран работал прожектором над столом при дневном свете.
  emissiveStrength: 0.35,
} as const

export const NIGHT = {
  variant: 'night',
  // Ночное небо — тусклое и холодное: это уличный фонарь и луна,
  // а не источник, который что-то освещает.
  skyColor: new THREE.Color(0x1b2740),
  skyIntensity: 0.16,
  sunIntensity: 0,
  // bounceStrength теперь ОДИНАКОВ с днём и это правильно: сила
  // переотражения — свойство поверхностей, а не времени суток.
  // Раньше здесь стояло 1.35, чтобы компенсировать отсутствие
  // освещённости в формуле отражения; после её появления костыль
  // не нужен — уровень света ночь берёт из самой освещённости.
  bounceStrength: 1.0,
  /**
   * После явной выборки источников это ЯРКОСТЬ ЛАМПЫ, а не подгоночный
   * коэффициент. Порядок диктует физика: спад для лампочки радиусом
   * 2.6 см на расстоянии 40 см равен r²/d² ≈ 0.004, поэтому чтобы дать
   * на столешнице освещённость уровня дневной (~0.27), яркость должна
   * быть в районе полусотни. Прежние 0.4 и 2.2 были осмысленны только
   * пока источник ловился случайными лучами.
   */
  // Экраны и лампа теперь разведены по яркости на уровне САМИХ
  // источников: лампочка 60, экран 0.55 (см. lamp.ts / monitor.ts).
  // Поэтому общий множитель может быть скромным — разницу несёт
  // собственная яркость, как и должно быть физически.
  emissiveStrength: 0.35,
} as const

export interface TimeOfDayResult {
  day: BakeResult
  night: BakeResult
  totalMs: number
}

/** Лампа выключена как источник — ноль и ночью, и днём. Предмет
 *  на столе остался целиком, светить перестал. */
const LAMP_BULB_FULL = 0
const LAMP_SHADE_FULL = 0

/**
 * Включает и выключает лампу — и как источник для бейка, и визуально.
 * Вызывается ДО прогона бейкера: `collect()` считывает emissiveIntensity
 * в момент запуска, поэтому выключенная здесь лампа просто не попадает
 * в дневной вариант как источник.
 */
export function setLamp(root: THREE.Object3D, k: number) {
  const bulb = root.getObjectByName('bulb') as THREE.Mesh | undefined
  if (bulb) {
    const m = bulb.material as THREE.MeshStandardMaterial
    m.emissiveIntensity = LAMP_BULB_FULL * k
  }
  const shade = root.getObjectByName('shade') as THREE.Mesh | undefined
  if (shade) {
    const m = shade.material as THREE.MeshStandardMaterial
    m.emissiveIntensity = LAMP_SHADE_FULL * k
  }
}

/** Печёт оба варианта. Долго — это авторская операция, не рантайм. */
export function bakeBoth(root: THREE.Object3D, rays = 48): TimeOfDayResult {
  const t0 = performance.now()
  setLamp(root, 0) // днём лампа выключена
  const day = bakeVertexGI(root, { ...DAY, rays })
  setLamp(root, 1) // ночью горит
  const night = bakeVertexGI(root, { ...NIGHT, rays })
  return { day, night, totalMs: performance.now() - t0 }
}

const _tmp = new THREE.Color()

/**
 * Устанавливает время суток. `t` = 0 — глубокая ночь, 1 — день.
 * Значения между ними интерполируются: это позволяет и плавный
 * переход по клику на лампу, и привязку к реальным часам.
 */
export function setTimeOfDay(root: THREE.Object3D, t: number, tint?: THREE.Color): number {
  const k = THREE.MathUtils.clamp(t, 0, 1)
  let touched = 0
  // Тёплый сдвиг золотого часа. Запечённых вариантов света ровно два,
  // и третьего под закат нет; множитель по каналам — честное
  // приближение, а не имитация под видом расчёта. Стоит он ноль:
  // цикл по вершинам всё равно уже идёт.
  const tr = tint?.r ?? 1
  const tg = tint?.g ?? 1
  const tb = tint?.b ?? 1

  root.traverse((o) => {
    const m = o as THREE.Mesh
    const store = m.userData?.bake as Record<string, Float32Array> | undefined
    if (!store?.day || !store?.night) return
    const attr = m.geometry.getAttribute('color') as THREE.BufferAttribute | undefined
    if (!attr) return

    const dst = attr.array as Float32Array
    const d = store.day
    const n = store.night
    for (let i = 0; i < dst.length; i += 3) {
      dst[i] = (n[i] + (d[i] - n[i]) * k) * tr
      dst[i + 1] = (n[i + 1] + (d[i + 1] - n[i + 1]) * k) * tg
      dst[i + 2] = (n[i + 2] + (d[i + 2] - n[i + 2]) * k) * tb
    }
    attr.needsUpdate = true
    touched++
  })

  void _tmp
  return touched
}

/**
 * Доля дневного света по реальным часам.
 * Грубая модель без астрономии: рассвет 6:00, закат 21:00, по часу
 * на сумерки с каждой стороны. Настоящий расчёт по широте и дате —
 * это когда появится geolocation, а пока честнее простая кривая,
 * чем сложная и неправильная.
 */
export function daylightFactor(date: Date): number {
  const h = date.getHours() + date.getMinutes() / 60
  const SUNRISE = 6
  const SUNSET = 21
  const DUSK = 1.2
  if (h <= SUNRISE - DUSK || h >= SUNSET + DUSK) return 0
  if (h >= SUNRISE + DUSK && h <= SUNSET - DUSK) return 1
  if (h < SUNRISE + DUSK) return (h - (SUNRISE - DUSK)) / (DUSK * 2)
  return 1 - (h - (SUNSET - DUSK)) / (DUSK * 2)
}
