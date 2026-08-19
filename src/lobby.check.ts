/**
 * Прогон правила «что кликабельно» без браузера.
 *
 * Существует потому, что решение о реестре предметов принимается один раз при
 * старте и глазами не проверяется: комната просто оказывается беднее, а
 * почему — не видно. До этого захода реестр на телефоне отдавал 2 предмета из
 * 6, и заметить это можно было только чтением кода.
 *
 * Числа в таблице замеров — НАСТОЯЩИЕ, снятые `scripts/measure-readability.mjs`
 * на живом сайте. Поэтому прогон ловит не только правило, но и разъезд правила
 * с реальностью: если поза монитора сдвинется, проекции изменятся, и строки
 * придётся пересчитать замером заново, а не подогнать.
 *
 *     bun run src/lobby.check.ts
 */
import { HOTSPOTS } from './interaction/hotspots'
import { tabOrder } from './interaction/tabOrder'
import { documentsReadable, panelFit, pickHotspots } from './lobby'

let failed = 0
function check(name: string, ok: boolean, extra = '') {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}${extra ? '  — ' + extra : ''}`)
  if (!ok) failed++
}

/* ---------------------------------------------------------------- */
/* Реестр                                                            */
/* ---------------------------------------------------------------- */

const full = pickHotspots(true, HOTSPOTS)
const short = pickHotspots(false, HOTSPOTS)

check('где документы читаются — весь реестр', full.length === HOTSPOTS.length,
  `${full.length} из ${HOTSPOTS.length}`)
check('монитор и ноутбук там есть',
  ['monitor', 'macbook'].every((id) => full.some((h) => h.id === id)))
check('книга и планшет там есть',
  ['book', 'tablet'].every((id) => full.some((h) => h.id === id)))
check('где не читаются — только срабатывающие на месте',
  short.every((h) => h.kind === 'switch' || h.kind === 'spin'),
  short.map((h) => h.id).join(', '))
check('лампа и кресло доступны всегда',
  ['lamp', 'chair'].every((id) => short.some((h) => h.id === id)))
check('реестр не переставлен на месте',
  HOTSPOTS[0]?.id === 'monitor', `первый — ${HOTSPOTS[0]?.id}`)

/* ---------------------------------------------------------------- */
/* Правило читаемости на снятых числах                               */
/* ---------------------------------------------------------------- */

/** Холст монитора: 2048 × 870, см. screens.ts. */
const CANVAS_H = 870

interface Row {
  name: string
  panel: { w: number; h: number }
  viewW: number
  readable: boolean
  why: string
}

const MEASURED: Row[] = [
  {
    name: 'iPhone 15 Pro ландшафт',
    panel: { w: 527, h: 226 }, viewW: 852,
    readable: false, why: 'кегль 4.9 — нечитаемо',
  },
  {
    name: 'iPad 11" портрет',
    panel: { w: 1602, h: 686 }, viewW: 834,
    readable: false, why: 'кегль 15.0, но полотно шире кадра вдвое',
  },
  {
    name: 'iPad 11" ландшафт',
    panel: { w: 1119, h: 479 }, viewW: 1194,
    readable: true, why: 'кегль 10.5, влезает',
  },
  {
    name: 'iPad 13" ландшафт',
    panel: { w: 1374, h: 589 }, viewW: 1366,
    readable: true, why: 'кегль 12.9, за краем 8 px из 1374',
  },
  {
    name: 'MacBook Air 1440×900',
    panel: { w: 1207, h: 517 }, viewW: 1440,
    readable: true, why: 'кегль 11.3 — сегодняшняя норма',
  },
]

for (const r of MEASURED) {
  const fit = panelFit(r.panel, r.viewW, CANVAS_H)
  const got = documentsReadable(fit)
  check(`${r.name}: ${r.readable ? 'полный реестр' : 'короткий реестр'}`,
    got === r.readable,
    `кегль ${fit.typePx.toFixed(1)} px, по ширине ${fit.fitsWidth ? 'влезает' : 'нет'} · ${r.why}`)
}

check('не посчиталось — предметы не отнимаем', documentsReadable(null) === true)

/* ---------------------------------------------------------------- */
/* Полоса между устройствами пуста — порог не обязан быть точным     */
/* ---------------------------------------------------------------- */

// Смысл проверки: если однажды кто-то подвинет MIN_TYPE_PX «чуть-чуть», он
// должен упереться в неё, а не тихо выключить iPad. Ровно то же и с допуском
// по ширине: телефон обязан оставаться далеко под порогом, а iPad — далеко
// над ним.
const phone = panelFit({ w: 527, h: 226 }, 852, CANVAS_H)
const pad = panelFit({ w: 1119, h: 479 }, 1194, CANVAS_H)
check('между телефоном и iPad полоса больше вдвое',
  pad.typePx > phone.typePx * 2,
  `${phone.typePx.toFixed(1)} → ${pad.typePx.toFixed(1)} px`)

/* ---------------------------------------------------------------- */
/* Порядок клавиатурного обхода                                      */
/* ---------------------------------------------------------------- */

// `tabOrder` обобщённая и про сцену ничего не знает — проекция приходит
// снаружи. Поэтому проверяется на своих объектах, без приведений типов:
// если для проверки понадобился бы `as unknown as`, это значило бы, что
// функция знает лишнее.
const fake = [
  { id: 'right', x: 300 },
  { id: 'left', x: 10 },
  { id: 'mid', x: 150 },
]
const ordered = tabOrder(fake, (h) => h.x)

check('обход идёт слева направо',
  ordered.map((h) => h.id).join(',') === 'left,mid,right',
  ordered.map((h) => h.id).join(','))
check('предметы не теряются и не двоятся', ordered.length === fake.length)

// `Array.prototype.sort` сортирует НА МЕСТЕ. `tabOrder`, переставивший сам
// реестр, тихо поменял бы порядок у всех остальных читателей `HOTSPOTS` —
// включая отрисовку и подбор.
check('исходный массив не переставлен',
  fake.map((h) => h.id).join(',') === 'right,left,mid',
  fake.map((h) => h.id).join(','))

// Предмет, не попавший в обзорный кадр, получает Infinity и обязан уехать
// в конец, а не растворить порядок: NaN в компараторе оставил бы его
// неопределённым, и обход стал бы разным от запуска к запуску.
const withMissing = [
  { id: 'gone', x: Number.POSITIVE_INFINITY },
  { id: 'far', x: 900 },
  { id: 'near', x: 5 },
]
check('невидимые предметы уезжают в конец',
  tabOrder(withMissing, (h) => h.x).map((h) => h.id).join(',') === 'near,far,gone',
  tabOrder(withMissing, (h) => h.x).map((h) => h.id).join(','))

// Два предмета на одной вертикали — обычное дело (книга лежит перед
// планшетом). Порядок между ними обязан остаться тем же, что в реестре,
// иначе обход поедет от пересборки к пересборке.
const tied = [
  { id: 'first', x: 100 },
  { id: 'second', x: 100 },
  { id: 'third', x: 100 },
]
check('при равной координате порядок реестра сохраняется',
  tabOrder(tied, (h) => h.x).map((h) => h.id).join(',') === 'first,second,third')

check('пустой реестр не ломает обход', tabOrder([], () => 0).length === 0)

console.log('')
// Падаем исключением, а не `process.exit`: у проекта нет типов Node, и
// тащить их ради одной строки — плохой обмен. Так же устроены palette.check
// и tetris.check.
if (failed) throw new Error(`${failed} проверок реестра упало`)
console.log('реестр предметов в порядке')
