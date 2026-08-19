import * as THREE from 'three'

/**
 * Промер кадра. Отвечает ровно на один вопрос: сколько раз за кадр сцена
 * прогоняется по геометрии и во что это обходится.
 *
 * ПОЧЕМУ НЕ HUD. HUD показывает `renderer.info` ПОСЛЕ цепочки, а он
 * обнуляется на каждом внутреннем `render()` — то есть к концу кадра там
 * лежит статистика последнего полноэкранного квада. Чтобы увидеть кадр
 * целиком, считать надо на каждом вызове и складывать.
 *
 * ПОЧЕМУ УСТАНОВКА ЛЕНИВАЯ. Обёртка вокруг `renderer.render` стоит четыре
 * сложения на вызов — ничто, но она стоит их ВСЕГДА. Пока `run()` не
 * позвали, обёртки нет вовсе.
 *
 * КАК ОТЛИЧАЕТСЯ ПРОХОД ПО ГЕОМЕТРИИ ОТ КВАДА. По первому аргументу:
 * `FullScreenQuad` рисует свой меш, а проход по сцене передаёт саму сцену.
 * Считать по числу треугольников было бы гаданием, а это точное правило.
 *
 * ТЕНЬ СЧИТАЕТСЯ ОТДЕЛЬНО. Карта теней рисуется ВНУТРИ `renderer.render`,
 * уже после того как `info` обнулён, поэтому её драуколлы неотличимо
 * подмешаны к основному проходу. Разделяет их обёртка вокруг
 * `shadowMap.render`: она снимает счётчик до и после.
 */

export interface FrameSample {
  /** Проходов по геометрии (сцена целиком) */
  geo: number
  /** Полноэкранных квадов */
  quads: number
  /** Драуколлов за кадр суммарно по всем проходам */
  calls: number
  /** Треугольников, отправленных за кадр суммарно */
  tris: number
  /** Драуколлов, ушедших в карты теней */
  shadowCalls: number
  /** Пересчётов карты теней (0, если тень взята готовой) */
  shadowRuns: number
  /** Длительность кадра, мс */
  ms: number
}

export interface ProfileReport {
  frames: number
  seconds: number
  fps: number
  /** Средние за кадр */
  geo: number
  quads: number
  calls: number
  tris: number
  shadowCalls: number
  shadowRuns: number
  /** Кадровое время */
  p50: number
  p99: number
}

export interface Profiler {
  /** Зовётся первой строкой кадрового цикла. Закрывает предыдущий кадр. */
  frame(nowMs: number): void
  /** Собрать отчёт за N секунд. */
  run(seconds?: number): Promise<ProfileReport>
  /** Идёт ли сбор прямо сейчас. */
  busy(): boolean
}

export function createProfiler(renderer: THREE.WebGLRenderer, scene: THREE.Scene): Profiler {
  let installed = false
  let collecting = false
  const samples: FrameSample[] = []

  // Счётчики текущего кадра
  let geo = 0
  let quads = 0
  let calls = 0
  let tris = 0
  let shadowCalls = 0
  let shadowRuns = 0
  let last = 0

  function install() {
    if (installed) return
    installed = true

    const origRender = renderer.render.bind(renderer)
    renderer.render = ((obj: THREE.Object3D, cam: THREE.Camera) => {
      origRender(obj, cam)
      if (!collecting) return
      if (obj === scene) geo++
      else quads++
      calls += renderer.info.render.calls
      tris += renderer.info.render.triangles
    }) as typeof renderer.render

    // Карта теней. `render` у WebGLShadowMap — обычное свойство-функция,
    // поэтому подменяется так же, как у рендерера.
    const sm = renderer.shadowMap as unknown as {
      render: (lights: THREE.Light[], scene: THREE.Scene, camera: THREE.Camera) => void
    }
    const origShadow = sm.render.bind(sm)
    sm.render = (lights, s, cam) => {
      if (!collecting) return origShadow(lights, s, cam)
      const before = renderer.info.render.calls
      origShadow(lights, s, cam)
      const spent = renderer.info.render.calls - before
      if (spent > 0) {
        shadowRuns++
        shadowCalls += spent
      }
    }
  }

  function frame(nowMs: number) {
    if (!collecting) return
    if (last > 0) {
      samples.push({ geo, quads, calls, tris, shadowCalls, shadowRuns, ms: nowMs - last })
    }
    last = nowMs
    geo = quads = calls = tris = shadowCalls = shadowRuns = 0
  }

  function pick(sorted: number[], q: number): number {
    if (!sorted.length) return 0
    const i = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * q)))
    return sorted[i]
  }

  async function run(seconds = 3): Promise<ProfileReport> {
    install()
    samples.length = 0
    last = 0
    collecting = true
    await new Promise((r) => setTimeout(r, seconds * 1000))
    collecting = false

    const n = samples.length
    if (!n) {
      return { frames: 0, seconds, fps: 0, geo: 0, quads: 0, calls: 0, tris: 0, shadowCalls: 0, shadowRuns: 0, p50: 0, p99: 0 }
    }
    const sum = (f: (s: FrameSample) => number) => samples.reduce((a, s) => a + f(s), 0)
    const times = samples.map((s) => s.ms).sort((a, b) => a - b)
    const total = sum((s) => s.ms)
    const r2 = (v: number) => +v.toFixed(2)
    return {
      frames: n,
      seconds: r2(total / 1000),
      fps: r2((n / total) * 1000),
      geo: r2(sum((s) => s.geo) / n),
      quads: r2(sum((s) => s.quads) / n),
      calls: Math.round(sum((s) => s.calls) / n),
      tris: Math.round(sum((s) => s.tris) / n),
      shadowCalls: Math.round(sum((s) => s.shadowCalls) / n),
      shadowRuns: r2(sum((s) => s.shadowRuns) / n),
      p50: r2(pick(times, 0.5)),
      p99: r2(pick(times, 0.99)),
    }
  }

  return { frame, run, busy: () => collecting }
}

/**
 * Подпись кадра: сетка средних цветов, свёрнутая в строку.
 *
 * ЗАЧЕМ. Правка, которая обязана НЕ менять картинку, проверяется только
 * сравнением картинок. Скриншот окна для этого не годится: он ловит и
 * подпись под кадром, и полосу загрузки, и разное сглаживание шрифтов, —
 * то есть шумит там, где нас интересует ровно холст.
 *
 * ПОЧЕМУ НЕ `canvas.toDataURL()`. У рендерера выключен
 * `preserveDrawingBuffer`, и холст отдаёт пустую картинку — это уже
 * ловилось при пересъёмке кадра шапки. Поэтому читаем буфер сами,
 * `gl.readPixels`, и обязательно В ТОМ ЖЕ кадре, сразу после отрисовки:
 * до возврата из rAF буфер ещё наш.
 *
 * ПОЧЕМУ СЕТКА, А НЕ ПИКСЕЛИ. Полный кадр 1440×900 — это пять мегабайт,
 * которые нечем сравнить глазами и незачем таскать целиком. Сетка 24×15
 * ловит любое смещение тона, тени или затенения контактов и при этом
 * умещается в две тысячи символов.
 *
 * Зерно перед снятием подписи надо гасить (`post.grain(0)`): оно
 * перебрасывается каждый кадр по построению и различалось бы всегда.
 */
export interface FrameSignature {
  w: number
  h: number
  cols: number
  rows: number
  /** По три байта на ячейку, слева направо и сверху вниз. */
  sig: string
}

export function grabSignature(
  renderer: THREE.WebGLRenderer,
  cols = 24,
  rows = 15,
): FrameSignature {
  const gl = renderer.getContext()
  const size = new THREE.Vector2()
  renderer.getDrawingBufferSize(size)
  const w = size.x
  const h = size.y
  const px = new Uint8Array(w * h * 4)
  gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px)

  let out = ''
  for (let ry = 0; ry < rows; ry++) {
    for (let rx = 0; rx < cols; rx++) {
      // readPixels отдаёт снизу вверх — строки ячеек считаются с конца,
      // чтобы подпись читалась в том же порядке, что и кадр.
      const y0 = Math.floor(((rows - 1 - ry) * h) / rows)
      const y1 = Math.floor(((rows - ry) * h) / rows)
      const x0 = Math.floor((rx * w) / cols)
      const x1 = Math.floor(((rx + 1) * w) / cols)
      let r = 0, g = 0, b = 0, n = 0
      // Шаг по три пикселя: средний цвет ячейки от прореживания не
      // сдвигается, а чтение становится втрое короче.
      for (let y = y0; y < y1; y += 3) {
        for (let x = x0; x < x1; x += 3) {
          const i = (y * w + x) * 4
          r += px[i]
          g += px[i + 1]
          b += px[i + 2]
          n++
        }
      }
      if (!n) n = 1
      const hex = (v: number) => Math.round(v / n).toString(16).padStart(2, '0')
      out += hex(r) + hex(g) + hex(b)
    }
  }
  return { w, h, cols, rows, sig: out }
}

/** Подпись кадра целиком или только её строка. */
export type SignatureLike = FrameSignature | string

/**
 * Достать строку подписи из того, что дали. `null` — «это не подпись».
 *
 * Существует из-за ловушки, на которую наступают, следуя документации:
 * `grab()` отдаёт ОБЪЕКТ, а сравнение принимало СТРОКУ, при том что в
 * хендоффе пара записана как `grab() · compareFrames(a, b)`. Передача
 * объектов целиком проходила молча — см. комментарий в `compareSignatures`.
 */
function sigOf(v: SignatureLike): string | null {
  if (typeof v === 'string') return v
  if (v && typeof v === 'object' && typeof v.sig === 'string') return v.sig
  return null
}

/**
 * Расхождение двух подписей кадра, в единицах восьмибитного канала.
 * Возвращает и среднее, и максимум: среднее ловит сдвиг тона по всему
 * кадру, максимум — локальную поломку вроде пропавшего затенения в углу.
 *
 * Принимает и объект подписи, и голую строку: `compareFrames(a, b)` после
 * двух `grab()` — самое естественное употребление, и оно обязано работать.
 *
 * ⚠️ ЧЕМ ЭТО БЫЛО ОПАСНО. Раньше сюда принималась только строка. Объекты
 * проходили охранник (`a.length !== b.length` — это `undefined !== undefined`,
 * то есть ложь), давали `n = NaN`, цикл не выполнялся НИ РАЗУ, и наружу
 * уходило `{ ok: true, max: 0 }` — «кадры совпали идеально» при полном
 * отсутствии сравнения. Ложный зелёный в проверке, которая существует ровно
 * затем, чтобы ловить изменения картинки. Поймано при приёмке расщепления
 * флага: настоящее расхождение того же кадра было 0.0157.
 *
 * Поэтому непонятный вход теперь ВСЕГДА `ok: false`. Проверка, которая не
 * умеет проверить, обязана сказать это вслух, а не промолчать успешно.
 */
export function compareSignatures(a: SignatureLike, b: SignatureLike) {
  const sa = sigOf(a)
  const sb = sigOf(b)
  if (sa === null || sb === null) {
    return { ok: false as const, reason: 'это не подпись кадра: нужен результат grab()' }
  }
  if (!sa.length) return { ok: false as const, reason: 'пустая подпись' }
  if (sa.length !== sb.length) return { ok: false as const, reason: 'разная длина подписи' }
  // Сетка у обеих подписей должна совпадать. Длина это уже гарантирует
  // (она есть cols × rows × 3), но при объектах можно сказать точнее — и
  // назвать несовпадение по имени, а не «разная длина».
  if (typeof a === 'object' && typeof b === 'object' && (a.cols !== b.cols || a.rows !== b.rows)) {
    return { ok: false as const, reason: `разная сетка: ${a.cols}×${a.rows} против ${b.cols}×${b.rows}` }
  }

  let sum = 0
  let max = 0
  let worstAt = -1
  const n = sa.length / 2
  for (let i = 0; i < n; i++) {
    const d = Math.abs(parseInt(sa.substr(i * 2, 2), 16) - parseInt(sb.substr(i * 2, 2), 16))
    sum += d
    if (d > max) {
      max = d
      worstAt = Math.floor(i / 3)
    }
  }
  return { ok: true as const, mean: +(sum / n).toFixed(4), max, worstCell: worstAt, channels: n }
}

/**
 * Запас по видеокарте под вертикальной синхронизацией.
 *
 * На 60 Гц кадр упирается в развёртку, и «60 fps» ничего не говорит о том,
 * сколько осталось: и картинка, которой хватает впритык, и картинка вдвое
 * дешевле дадут одинаковые 16.7 мс. Поэтому запас меряется не временем, а
 * тем, до какого масштаба рендера кадр ещё держится: множитель поднимается
 * ступенями, и берётся последний, на котором p50 остался в кадре.
 *
 * Это и есть честное «до/после» для оптимизации: число проходов упало —
 * множитель обязан вырасти.
 */
export interface StressStep {
  scale: number
  fps: number
  p50: number
}

export async function stressTest(
  profiler: Profiler,
  setScale: (s: number) => void,
  steps: number[] = [1, 1.25, 1.5, 1.75, 2, 2.5, 3],
  seconds = 1.2,
): Promise<{ steps: StressStep[]; headroom: number }> {
  const out: StressStep[] = []
  let headroom = 0
  for (const s of steps) {
    setScale(s)
    // Кадр после смены размера перевыделяет таргеты и заведомо длиннее
    // остальных — он не должен попасть в выборку.
    await new Promise((r) => setTimeout(r, 250))
    const r = await profiler.run(seconds)
    out.push({ scale: s, fps: r.fps, p50: r.p50 })
    // 17.5 мс, а не 16.7: развёртка не идеальна, и кадр, изредка
    // задевающий следующую синхронизацию, — это ещё не просадка.
    if (r.p50 <= 17.5) headroom = s
    else break
  }
  setScale(1)
  return { steps: out, headroom }
}
