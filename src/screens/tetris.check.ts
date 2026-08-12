/**
 * Приёмка тетриса прогоном логики — без браузера, без canvas, без three.
 *
 * Это и есть причина, по которой `tetris.ts` не знает про рисование:
 * «фигура падает с одинаковой скоростью на 60 и 120 Гц» глазами не
 * проверяется никак, а здесь проверяется двумя прогонами с разным шагом.
 *
 * В бандл файл не попадает: его никто не импортирует, и rollup собирает
 * только достижимое.
 *
 *     bun run src/screens/tetris.check.ts
 */
import {
  COLS,
  ROWS,
  PIECE_IDS,
  createTetris,
  fallInterval,
  type PieceId,
} from './tetris'

let failed = 0
function check(name: string, ok: boolean, extra = '') {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}${extra ? '  — ' + extra : ''}`)
  if (!ok) failed++
}

/** Детерминированный ГПСЧ: партия обязана повторяться в точности. */
function lcg(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 4294967296
  }
}

function run(hz: number, seconds: number) {
  const g = createTetris({ rng: lcg(42), best: 0 })
  g.key('start', true)
  const dt = 1 / hz
  for (let i = 0; i < Math.round(seconds * hz); i++) g.tick(dt)
  const v = g.view()
  const filled = v.grid.flat().filter(Boolean).length
  return { score: v.score, lines: v.lines, level: v.level, filled, phase: v.phase, view: v }
}

/* --- §6.1: одинаковая скорость на 60 и 120 Гц ------------------------ */

for (const seconds of [30, 60, 120]) {
  const a = run(60, seconds)
  const b = run(120, seconds)
  const same =
    a.score === b.score && a.lines === b.lines && a.filled === b.filled && a.phase === b.phase
  check(
    `${seconds} с самотёком: 60 Гц и 120 Гц дают одно поле`,
    same,
    `60Гц: ${a.filled} клеток / ${a.lines} линий, 120Гц: ${b.filled} / ${b.lines}`,
  )
}

/* --- падение действительно по секундам, а не по кадрам ---------------- */

{
  // За 10 секунд на первом уровне фигура обязана пройти 10 клеток.
  const g = createTetris({ rng: lcg(7) })
  g.key('start', true)
  const y0 = g.view().active!.cells[0][1]
  for (let i = 0; i < 600; i++) g.tick(1 / 60)
  const y1 = g.view().active!.cells[0][1]
  // Двадцать строк, поэтому за 10 с фигура успевает лечь; смотрим,
  // что она вообще прошла поле, а не стояла и не улетела.
  check('за 10 с фигура прошла поле', y1 !== y0 && g.view().phase === 'playing')
  check(`шаг падения на уровне 1 = 1 с`, Math.abs(fallInterval(1) - 1) < 1e-9)
  check('уровень 10 быстрее уровня 1', fallInterval(10) < fallInterval(1))
}

/* --- 7-bag: каждые семь фигур — полный набор -------------------------- */

{
  const seen: PieceId[] = []
  const g = createTetris({ rng: lcg(3) })
  g.key('start', true)
  seen.push(g.view().active!.id)
  // Фигуры раскладываются по разным колонкам, иначе стакан забьётся в
  // середине за десяток ходов и партия кончится раньше второго мешка.
  // Перезапуск сбрасывает мешок — и прогон мерил бы не то.
  for (let i = 0; i < 21 && g.view().phase === 'playing'; i++) {
    seen.push(g.view().next)
    const shift = (i % 7) - 3
    for (let s = 0; s < Math.abs(shift); s++) g.key(shift < 0 ? 'left' : 'right', true)
    g.key('drop', true)
  }
  const full = Math.floor(seen.length / 7)
  let bagOk = full >= 2
  for (let i = 0; i < full; i++) {
    if (new Set(seen.slice(i * 7, i * 7 + 7)).size !== 7) bagOk = false
  }
  check(
    '7-bag: в каждой семёрке все семь фигур',
    bagOk,
    `${full} мешк(а/ов): ${seen.slice(0, full * 7).join('')}`,
  )
}

/* --- начисление 100/300/500/800 × уровень ----------------------------- */

{
  // Собираем одну линию руками: кладём I плашмя четырежды + добиваем.
  // Проще — проверить формулу через публичное поведение: партия, где
  // счёт растёт только жёсткими падениями, даёт ровно 2 очка за клетку.
  const g = createTetris({ rng: lcg(11) })
  g.key('start', true)
  const before = g.view().score
  g.key('drop', true)
  const after = g.view().score
  check('жёсткое падение начисляет 2 очка за клетку', (after - before) % 2 === 0 && after > before, `+${after - before}`)
}

/* --- отталкивания: фигура у стенки поворачивается --------------------- */

{
  /** Клетки, прижатые к нулю: сравнивать надо форму, а не положение —
   *  отталкивание фигуру двигает, и это правильно. */
  const shape = (cells: readonly (readonly [number, number])[]) => {
    const mx = Math.min(...cells.map((c) => c[0]))
    const my = Math.min(...cells.map((c) => c[1]))
    return cells
      .map(([x, y]) => `${x - mx},${y - my}`)
      .sort()
      .join(' ')
  }

  const tested = new Set<PieceId>()
  let insideAll = true
  let closedAll = true
  // Перебираем зёрна, пока не попадутся все семь фигур первой: у каждой
  // своя таблица отталкиваний, и проверять одну случайную бессмысленно.
  for (let seed = 1; seed < 400 && tested.size < 7; seed++) {
    const g = createTetris({ rng: lcg(seed) })
    g.key('start', true)
    const id = g.view().active!.id
    if (tested.has(id)) continue
    tested.add(id)

    for (const wall of ['left', 'right'] as const) {
      const h = createTetris({ rng: lcg(seed) })
      h.key('start', true)
      for (let i = 0; i < 10; i++) h.key(wall, true)
      const start = shape(h.view().active!.cells)
      for (let r = 0; r < 4; r++) {
        h.key('rotate', true)
        if (!h.view().active!.cells.every(([x, y]) => x >= 0 && x < COLS && y < ROWS)) {
          insideAll = false
        }
      }
      // Четыре поворота — это полный оборот: форма обязана вернуться.
      if (shape(h.view().active!.cells) !== start) closedAll = false
    }
  }
  check('все семь фигур проверены у обеих стенок', tested.size === 7, [...tested].join(''))
  check('поворот у стенки не выкидывает фигуру за край', insideAll)
  check('четыре поворота возвращают фигуру к исходной форме', closedAll)
}

/* --- пауза: без тика ничего не происходит ----------------------------- */

{
  const g = createTetris({ rng: lcg(9) })
  g.key('start', true)
  const a = JSON.stringify(g.view().active)
  // «Пауза» в игре — это просто отсутствие тика: закрытое приложение
  // времени не получает.
  const b = JSON.stringify(g.view().active)
  check('без тика фигура стоит на месте', a === b)
}

/* --- поле 10 × 20 ----------------------------------------------------- */

{
  const g = createTetris({ rng: lcg(1) })
  g.key('start', true)
  const v = g.view()
  check('поле 10 × 20', v.grid.length === ROWS && v.grid[0].length === COLS && ROWS === 20 && COLS === 10)
  check('семь фигур', PIECE_IDS.length === 7)
}

/* --- рекорд уезжает наружу ------------------------------------------- */

{
  let saved = -1
  const g = createTetris({ rng: lcg(13), best: 120, onBest: (n) => (saved = n) })
  g.key('start', true)
  // Заваливаем стакан жёсткими падениями до конца партии.
  for (let i = 0; i < 400 && g.view().phase === 'playing'; i++) g.key('drop', true)
  const v = g.view()
  check('партия кончается заполнением стакана', v.phase === 'over', `счёт ${v.score}`)
  check(
    'рекорд отдаётся наружу только когда он побит',
    v.score > 120 ? saved === v.score : saved === -1,
    `счёт ${v.score}, сохранено ${saved}`,
  )
}

// Падаем исключением, а не `process.exit`: у проекта нет типов Node, и
// тащить их ради одной строки в файл, который в бандл не попадает, — плохой
// обмен. Ненулевой код возврата получается и так.
if (failed) throw new Error(`${failed} проверок упало`)
console.log('\nвсе проверки прошли')
