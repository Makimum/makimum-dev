import * as THREE from 'three'

/**
 * Лампа как единственный предмет в комнате, который отвечает на нажатие.
 *
 * ПОЧЕМУ ВКЛЮЧЕНИЕ БЫСТРОЕ, А ВЫКЛЮЧЕНИЕ МЕДЛЕННОЕ. У нити накала
 * асимметрия обратная привычной в интерфейсах. Разогревается вольфрам
 * почти мгновенно — это доли секунды, — а остывает долго, проходя по
 * дороге через тёмно-янтарный. Общее правило моушена «выход короче
 * входа» здесь нарушено сознательно: физика говорит наоборот, и любой,
 * кто хоть раз выключал лампу накаливания в тёмной комнате, узнаёт
 * именно медленное угасание. Линейный фейд в обе стороны читался бы
 * как диммер, а не как выключатель.
 *
 * ПОЧЕМУ ПРОЖЕКТОР, А НЕ ТОЧЕЧНЫЙ ИСТОЧНИК. У точечного источника тень
 * считается кубической картой — шесть проходов сцены вместо одного.
 * На машине, которая и так живёт в свопе, это неприемлемо. Прожектор
 * обходится одной картой, и он же честнее: у лампы есть абажур, который
 * направляет свет вниз, а не рассеивает его во все стороны.
 */

/** Разогрев нити. Короткий: вольфрам выходит на режим быстро. */
const ON_MS = 180
/** Остывание. Вдвое с лишним длиннее — это и есть узнаваемая часть. */
const OFF_MS = 420

/** cubic-bezier(0.2, 0, 0, 1) — быстрый старт, мягкая посадка. */
const easeOn = (t: number) => 1 - Math.pow(1 - t, 3)
/** cubic-bezier(0.4, 0, 1, 1) — разгон вниз, без хвоста. */
const easeOff = (t: number) => t * t * t

/** Цвет нити по яркости: на низах глубокий янтарь (~2000 K), на полной
 *  тёплый белый (~2700 K). Именно этот сдвиг и видно на затухании. */
const COLD_FILAMENT = new THREE.Color(1.0, 0.46, 0.11)
const HOT_FILAMENT = new THREE.Color(1.0, 0.78, 0.52)

/**
 * Сила источника в канделах.
 *
 * Подобрана на живой ночной комнате хуком lampPower(): при 7.5 столешница
 * выгорала в белое, потому что три считает свет физически, а при затухании
 * по квадрату расстояния источник в сорока сантиметрах от стола — это
 * очень много. При 0.9 остаётся тёплое пятно с читаемым краем, а комната
 * вокруг остаётся тёмной — ради этого контраста щелчок и нужен.
 */
const PEAK_INTENSITY = 0.9

/**
 * ЛАМПА САМА ЗАЖИГАЕТСЯ К НОЧИ.
 *
 * Причина не в уюте. Ночью комната освещена только небом в окне, и в
 * кадре не остаётся почти ничего: на скриншоте живого сайта в час ночи
 * видны синий контур окна, светящиеся экраны — и всё. Посетитель,
 * пришедший в это время, видит чёрный прямоугольник и не узнаёт, что
 * там вообще есть комната. Настоящий человек в такой комнате включает
 * лампу; сцена обязана вести себя так же.
 *
 * ДВА ПОРОГА, А НЕ ОДИН. С одним лампа моргала бы на границе: `daylight`
 * ползёт непрерывно, а прокрутка времени хуком `setSkyTime` проходит её
 * туда-сюда за один вызов. Между 0.30 и 0.55 лежит около двух градусов
 * высоты солнца — в Хельсинки это пятнадцать-двадцать минут, и обратно
 * состояние за это время не переворачивается.
 *
 * Пороги выбраны по кривой `daylight = smoothstep(-6, 6, alt)`:
 * 0.30 — это солнце на −1.6°, то есть сразу после заката, ровно тогда,
 * когда лампу и включают. 0.55 — солнце на +0.4°, только что взошло.
 */
const AUTO_ON_BELOW = 0.3
const AUTO_OFF_ABOVE = 0.55

export interface LampSwitch {
  /** Щелчок. Возвращает новое состояние. */
  toggle(): boolean
  /**
   * Свет за окном изменился — лампе решать, гореть ли ей.
   *
   * РУКА ЧЕЛОВЕКА ГЛАВНЕЕ АВТОМАТИКИ. После первого же щелчка лампа
   * перестаёт слушать время суток и остаётся такой, какой её оставили.
   * Иначе получается спор: посетитель гасит лампу, чтобы посмотреть на
   * тёмную комнату, а она через полсекунды загорается обратно — и это
   * читается не как автоматика, а как поломка.
   */
  follow(daylight: number): void
  /** Перехватил ли посетитель управление. Нужно приёмке и отладке:
   *  «автоматика молчит после щелчка» — утверждение, которое обязано
   *  проверяться, а не приниматься на слово. */
  overridden(): boolean
  /** Подпись при наведении — зависит от состояния. */
  label(): string
  /** Плавность; вызывается каждый кадр. */
  update(now: number): void
  /** Текущая яркость 0…1 — нужна отладочным хукам и приёмке. */
  level(): number
  /**
   * Перестал ли быть верным готовый рисунок теней. Возвращает true ОДИН
   * раз — на том кадре, где лампа сменила `castShadow`.
   *
   * Сама лампа неподвижна, поэтому её карта теней, посчитанная однажды,
   * остаётся верной сколько угодно. Пересчитать её нужно ровно в момент,
   * когда источник впервые объявил себя отбрасывающим тень: до этого
   * карты у него просто нет.
   */
  shadowDirty(): boolean
  setPower(v: number): void
}

export function createLampSwitch(scene: THREE.Scene): LampSwitch | null {
  const head = scene.getObjectByName('joint-head')
  const bulb = scene.getObjectByName('bulb') as THREE.Mesh | undefined
  const shade = scene.getObjectByName('shade') as THREE.Mesh | undefined
  if (!head || !bulb) {
    console.warn('[lamp] не найден узел лампы — выключатель не поднят')
    return null
  }

  // Источник живёт В ГОЛОВЕ лампы: она на шарнирах, и свет обязан
  // ездить вместе с абажуром, а не висеть в мировых координатах.
  const light = new THREE.SpotLight(0xffffff, 0, 3.4, 1.02, 0.62, 2)
  light.name = 'lamp-light'
  light.position.copy(bulb.position)
  light.castShadow = true
  light.shadow.mapSize.set(512, 512)
  light.shadow.camera.near = 0.05
  light.shadow.camera.far = 3.4
  light.shadow.bias = -0.0015
  light.shadow.normalBias = 0.02
  // Цель — прямо под плафоном, в локальных координатах головы: так
  // конус смотрит туда же, куда развёрнут сам абажур.
  light.target.position.set(0, bulb.position.y - 1, 0)
  head.add(light)
  head.add(light.target)

  const bulbMat = bulb.material as THREE.MeshStandardMaterial
  const shadeMat = shade?.material as THREE.MeshStandardMaterial | undefined
  bulbMat.emissive = new THREE.Color(0x000000)
  if (shadeMat) shadeMat.emissive = new THREE.Color(0x000000)

  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches

  let on = false
  let level = 0
  let from = 0
  let startedAt = 0
  let duration = 0
  let peak = PEAK_INTENSITY
  /** Поднимается в apply(), снимается читателем. См. shadowDirty(). */
  let shadowChanged = false
  /** Щёлкнул ли по лампе человек. После этого автоматика молчит. */
  let manual = false
  // Заведён один раз и переиспользуется: аллокация в кадровом цикле —
  // это всплеск сборщика мусора и заметный рывок.
  const tint = new THREE.Color()

  function apply(k: number) {
    level = k
    tint.copy(COLD_FILAMENT).lerp(HOT_FILAMENT, k)
    light.color.copy(tint)
    light.intensity = peak * k
    // Карта теней считается для КАЖДОГО источника, который её объявил, —
    // нулевая яркость от этого не спасает. Погашенная лампа не должна
    // стоить лишнего прохода сцены каждый кадр.
    const casts = k > 0.002
    if (casts !== light.castShadow) shadowChanged = true
    light.castShadow = casts
    // Колба светится сама: без этого включённая лампа освещает стол,
    // но сама остаётся тёмной, и щелчок читается как чужой свет.
    bulbMat.emissive.copy(tint)
    bulbMat.emissiveIntensity = 2.6 * k
    // Абажур подхватывает свет изнутри и снаружи: у настоящего
    // тканевого плафона тёплое пятно видно с обеих сторон.
    if (shadeMat) {
      shadeMat.emissive.copy(tint)
      shadeMat.emissiveIntensity = 0.32 * k
    }
  }

  apply(0)

  /** Поехать к состоянию `next`. Общая дорога у щелчка и у автоматики —
   *  иначе разошлись бы кривые и обработка «уменьшить движение». */
  function rampTo(next: boolean) {
    if (next === on) return
    on = next
    if (reduced) {
      // Промежуточный янтарь — это анимация. При отключённой анимации
      // выключатель обязан быть выключателем: сразу и без хвоста.
      apply(on ? 1 : 0)
      duration = 0
      return
    }
    from = level
    startedAt = performance.now()
    duration = on ? ON_MS : OFF_MS
  }

  return {
    toggle() {
      // С этой секунды лампа принадлежит человеку, а не часам.
      manual = true
      rampTo(!on)
      return on
    },
    follow(daylight: number) {
      if (manual) return
      if (!on && daylight < AUTO_ON_BELOW) rampTo(true)
      else if (on && daylight > AUTO_OFF_ABOVE) rampTo(false)
    },
    label: () => (on ? 'turn the lamp off' : 'turn the lamp on'),
    update(now: number) {
      if (!duration) return
      const t = Math.min(1, (now - startedAt) / duration)
      const e = on ? easeOn(t) : easeOff(t)
      apply(from + ((on ? 1 : 0) - from) * e)
      if (t >= 1) duration = 0
    },
    level: () => level,
    overridden: () => manual,
    shadowDirty() {
      const was = shadowChanged
      shadowChanged = false
      return was
    },
    setPower(v: number) {
      peak = v
      apply(level)
    },
  }
}
