import { PALETTE } from '../constants'

/**
 * Приёмка палитры без браузера.
 *
 * Проверяется не «красиво», а измеримое: чтобы комната не свалилась
 * обратно в один тон. Жалоба «комната монохромна при любом освещении»
 * имела ровно эту причину — всё цветное умещалось в клин H 4–48, то есть
 * в одну шестую круга, а КАЖДАЯ светлая поверхность была подкрашена
 * тёплым. Тест ловит возврат к этому состоянию и не проверяет вкус:
 * любой набор красок с двумя сторонами по температуре его пройдёт.
 *
 * ПОЧЕМУ НЕ HSL-НАСЫЩЕННОСТЬ. Первая версия теста мерила её и провалила
 * стену `0xe9e6e1`, объявив S = 0.15 — при том что между каналами там
 * восемь единиц из 255. У почти белого знаменатель `1 − |2L − 1|` уходит
 * в ноль, и насыщенность раздувается на ровном месте. Всё, что касается
 * светлых поверхностей, меряется АБСОЛЮТНОЙ хромой (max − min по
 * каналам): она не зависит от светлоты и отвечает на нужный вопрос —
 * сколько в краске цвета, а не сколько его «в долях от возможного».
 *
 * Запуск: bun run src/lib/palette.check.ts
 */

interface Colour {
  k: string
  hex: number
  r: number
  g: number
  b: number
  /** Абсолютная хрома: max − min по каналам, 0…1. */
  c: number
  /** Тон в градусах. Осмыслен только при заметной хроме. */
  h: number
  /** Светлота (max + min) / 2. */
  l: number
  /** Подтон: со знаком, тёплый плюс, холодный минус. В единицах 0…1. */
  warmth: number
}

function read(k: string, hex: number): Colour {
  const r = ((hex >> 16) & 255) / 255
  const g = ((hex >> 8) & 255) / 255
  const b = (hex & 255) / 255
  const mx = Math.max(r, g, b)
  const mn = Math.min(r, g, b)
  const c = mx - mn
  let h = 0
  if (c !== 0) {
    if (mx === r) h = ((g - b) / c) % 6
    else if (mx === g) h = (b - r) / c + 2
    else h = (r - g) / c + 4
  }
  return { k, hex, r, g, b, c, h: (h * 60 + 360) % 360, l: (mx + mn) / 2, warmth: r - b }
}

/** Ниже этой хромы тон — шум округления, а не цвет: 0x8a8a8a дал бы
 *  H = 0, то есть «красный». */
const CHROMATIC = 0.12
/** Потолок хромы для светлой поверхности. Выше — это уже слоновая кость,
 *  а она не показывает цвет источника: тепло обязано приходить со светом. */
const LIGHT_CHROMA_MAX = 0.06
/** Заметный подтон. Три единицы из 255 — это ещё дизеринг, четыре — уже
 *  направление, которое видно на большой плоскости. */
const TINT = 4 / 255

let failed = 0
function check(name: string, ok: boolean, detail: string) {
  if (!ok) failed++
  console.log(`${ok ? 'ok   ' : 'ПРОВАЛ'} ${name}  — ${detail}`)
}

const all = Object.entries(PALETTE).map(([k, v]) => read(k, v))
const by = (name: string) => all.find((c) => c.k === name)!

/**
 * Крупные поверхности комнаты — то, из чего кадр состоит по площади.
 * Мелочь вроде логотипа на крышке ноутбука на впечатление не влияет,
 * и держать её в тесте значило бы проверять не то.
 */
const SURFACES = [
  'wallWarm', 'wallCool', 'ceiling', 'skirting', 'deskTop', 'deskFrame',
  'radiator', 'floorOak', 'floorOakDark', 'accentRed', 'bookCloth', 'tabletCase',
]
/** Из них — светлые: стены, потолок, столешница. Они и решают, читается
 *  ли на кадре время суток. */
const LIGHT = ['wallWarm', 'wallCool', 'ceiling', 'skirting', 'deskTop', 'radiator']

const surfaces = SURFACES.map(by)
const chromatic = surfaces.filter((c) => c.c >= CHROMATIC)

/**
 * Разброс тона по КРУГУ, а не по отрезку.
 *
 * Наивный `max − min` врёт ровно там, где это важнее всего: красный
 * (H 4) и холодная стена (H 210) дают 206, но красный с тоном 350 и та
 * же стена дали бы 140 — при том что на глаз они разошлись сильнее.
 * Поэтому берётся наибольшая дуга между соседями и вычитается из круга:
 * это и есть настоящий охват.
 */
function hueSpread(list: number[]): number {
  if (list.length < 2) return 0
  const s = [...list].sort((a, b) => a - b)
  let widestGap = 360 - s[s.length - 1] + s[0]
  for (let i = 1; i < s.length; i++) widestGap = Math.max(widestGap, s[i] - s[i - 1])
  return 360 - widestGap
}

const spread = hueSpread(chromatic.map((c) => c.h))
check(
  'цветные поверхности не сведены в один клин',
  spread >= 120,
  `охват тона ${spread.toFixed(0)}° по ${chromatic.length} поверхностям с хромой ≥ ${CHROMATIC} (нужно ≥ 120°)`,
)

const lights = LIGHT.map(by)
const overpainted = lights.filter((c) => c.c > LIGHT_CHROMA_MAX)
check(
  'светлые поверхности не подкрашены сами',
  overpainted.length === 0,
  overpainted.length
    ? overpainted.map((c) => `${c.k} хрома ${c.c.toFixed(3)}`).join(', ')
    : `${lights.length} поверхностей, максимум хромы ${Math.max(...lights.map((c) => c.c)).toFixed(3)} при потолке ${LIGHT_CHROMA_MAX}`,
)

/**
 * ГЛАВНАЯ ПРОВЕРКА. Старая палитра проваливалась именно здесь: у ВСЕХ
 * светлых поверхностей до одной было R > B. Плоскости, подкрашенные в
 * одну сторону, не могут дать контраста между собой ни при каком свете —
 * отсюда и «монохромная комната».
 */
const warmSide = lights.filter((c) => c.warmth >= TINT)
const coolSide = lights.filter((c) => c.warmth <= -TINT)
check(
  'светлые плоскости разведены по температуре',
  warmSide.length > 0 && coolSide.length > 0,
  `тёплых ${warmSide.length} (${warmSide.map((c) => c.k).join(', ') || '—'}), ` +
    `холодных ${coolSide.length} (${coolSide.map((c) => c.k).join(', ') || '—'})`,
)

check(
  'холодный полюс есть и он насыщенный',
  chromatic.some((c) => c.h >= 170 && c.h <= 260),
  chromatic.filter((c) => c.h >= 170 && c.h <= 260).map((c) => `${c.k} H${c.h.toFixed(0)}`).join(', ') ||
    'ни одной поверхности с тоном 170–260 при заметной хроме',
)

check(
  'тёплый полюс есть и он насыщенный',
  chromatic.some((c) => c.h < 60 || c.h > 330),
  chromatic.filter((c) => c.h < 60 || c.h > 330).map((c) => `${c.k} H${c.h.toFixed(0)}`).join(', ') ||
    'ни одной поверхности с тоном < 60 при заметной хроме',
)

console.log('')
console.log(
  'поверхность'.padEnd(15), 'hex'.padEnd(9),
  'H'.padStart(5), 'хрома'.padStart(7), 'светл'.padStart(7), 'подтон'.padStart(8),
)
for (const c of [...surfaces].sort((a, b) => b.l - a.l)) {
  const tint = c.warmth >= TINT ? 'тёплый' : c.warmth <= -TINT ? 'холодн' : 'ровный'
  console.log(
    c.k.padEnd(15),
    ('#' + c.hex.toString(16).padStart(6, '0')).padEnd(9),
    (c.c < CHROMATIC ? '—' : c.h.toFixed(0)).padStart(5),
    c.c.toFixed(3).padStart(7),
    c.l.toFixed(3).padStart(7),
    tint.padStart(8),
  )
}

console.log('')
// Падаем исключением, а не `process.exit`: у проекта нет типов Node, и
// тащить их ради одной строки — плохой обмен. Так же устроен tetris.check.
if (failed) throw new Error(`${failed} проверок палитры упало`)
console.log('палитра в порядке')
