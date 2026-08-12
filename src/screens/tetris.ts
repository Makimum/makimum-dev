/**
 * Тетрис: только правила. Ни canvas, ни three, ни DOM, ни localStorage.
 *
 * Это единственный файл проекта, который исполняется без браузера, и
 * терять эту возможность нельзя: «фигура падает одинаково на 60 и 120 Гц»
 * проверяется прогоном логики с разным шагом, а не разглядыванием экрана.
 * Поэтому наружу отсюда уходит СОСТОЯНИЕ ПОЛЯ, а не картинка, рекорд
 * приходит числом снаружи и уходит обратно через колбэк — хранением
 * занимается тот, у кого есть localStorage.
 *
 * Канон взят из Tetris Guideline в той части, где он бесспорен: SRS с
 * настенными отталкиваниями, 7-bag, 100/300/500/800 × уровень.
 */

export type PieceId = 'I' | 'J' | 'L' | 'O' | 'S' | 'T' | 'Z'
export type Cell = PieceId | null
export type Point = readonly [number, number]

/** Канон, менять нечего. */
export const COLS = 10
export const ROWS = 20

export const PIECE_IDS: readonly PieceId[] = ['I', 'J', 'L', 'O', 'S', 'T', 'Z']

/**
 * Фигуры в состоянии спавна, координаты внутри своего бокса, y растёт ВНИЗ.
 * Размер бокса — часть определения SRS: повороты считаются относительно
 * него, и у I он 4×4, у O 2×2, у остальных 3×3. Именно из-за разных
 * боксов у I своя таблица отталкиваний.
 */
const SHAPES: Record<PieceId, { box: number; cells: Point[] }> = {
  I: { box: 4, cells: [[0, 1], [1, 1], [2, 1], [3, 1]] },
  J: { box: 3, cells: [[0, 0], [0, 1], [1, 1], [2, 1]] },
  L: { box: 3, cells: [[2, 0], [0, 1], [1, 1], [2, 1]] },
  O: { box: 2, cells: [[0, 0], [1, 0], [0, 1], [1, 1]] },
  S: { box: 3, cells: [[1, 0], [2, 0], [0, 1], [1, 1]] },
  T: { box: 3, cells: [[1, 0], [0, 1], [1, 1], [2, 1]] },
  Z: { box: 3, cells: [[0, 0], [1, 0], [1, 1], [2, 1]] },
}

/** Все четыре поворота посчитаны один раз: их 28 штук на всю игру. */
const ROT: Record<PieceId, Point[][]> = Object.fromEntries(
  PIECE_IDS.map((id) => {
    const { box, cells } = SHAPES[id]
    const all: Point[][] = [cells]
    for (let r = 1; r < 4; r++) {
      // Поворот по часовой в боксе n×n при y вниз: (x,y) → (n-1-y, x).
      all.push(all[r - 1].map(([x, y]) => [box - 1 - y, x] as Point))
    }
    return [id, all]
  }),
) as Record<PieceId, Point[][]>

/**
 * Настенные отталкивания SRS. Числа записаны в оригинальной системе
 * координат стандарта, где y растёт ВВЕРХ, — так их можно сверить с
 * первоисточником построчно. Знак y переворачивается один раз, в момент
 * применения; переписывать таблицу «под себя» значит гарантированно
 * ошибиться в одной строке из шестнадцати и потом искать её глазами.
 *
 * Ключ — переход «откуда куда», состояния 0 · R(1) · 2 · L(3).
 */
const KICKS_JLSTZ: Record<string, Point[]> = {
  '01': [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],
  '10': [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]],
  '12': [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]],
  '21': [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],
  '23': [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]],
  '32': [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],
  '30': [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],
  '03': [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]],
}

const KICKS_I: Record<string, Point[]> = {
  '01': [[0, 0], [-2, 0], [1, 0], [-2, -1], [1, 2]],
  '10': [[0, 0], [2, 0], [-1, 0], [2, 1], [-1, -2]],
  '12': [[0, 0], [-1, 0], [2, 0], [-1, 2], [2, -1]],
  '21': [[0, 0], [1, 0], [-2, 0], [1, -2], [-2, 1]],
  '23': [[0, 0], [2, 0], [-1, 0], [2, 1], [-1, -2]],
  '32': [[0, 0], [-2, 0], [1, 0], [-2, -1], [1, 2]],
  '30': [[0, 0], [1, 0], [-2, 0], [1, -2], [-2, 1]],
  '03': [[0, 0], [-1, 0], [2, 0], [-1, 2], [2, -1]],
}

/** Начисление за 1–4 линии, умножается на уровень. */
const LINE_SCORE = [0, 100, 300, 500, 800]

/**
 * Задержка фиксации. Без неё фигура прилипает в тот же миг, когда
 * коснулась стопки, и подвинуть её вбок под нависающий край уже нельзя —
 * игра начинает казаться нечестной ровно там, где игрок прав. Сбросов
 * ограниченное число, иначе фигуру можно возить по дну бесконечно.
 */
const LOCK_DELAY = 0.5
const LOCK_RESETS = 15

/**
 * Автоповтор сдвига считается игрой, а не браузером: у системного
 * автоповтора задержка настраивается в системе, и на одной машине фигура
 * поедет через полсекунды, на другой через полторы.
 */
const DAS = 0.17
const ARR = 0.05

/** Ниже этого шага падение перестаёт быть падением: на 60 Гц это уже
 *  больше одной клетки за кадр. Уровень при этом продолжает расти —
 *  он множитель к счёту, а не только к скорости. */
const MIN_FALL = 1 / 60

/**
 * Кривая падения из Tetris Guideline: (0.8 − (level−1)·0.007)^(level−1)
 * секунд на клетку. Своя кривая тут была бы выдуманным числом.
 */
export function fallInterval(level: number): number {
  const n = Math.max(0, level - 1)
  return Math.max(MIN_FALL, Math.pow(0.8 - n * 0.007, n))
}

export type GameKey = 'left' | 'right' | 'down' | 'rotate' | 'drop' | 'start'
export type Phase = 'idle' | 'playing' | 'over'

export interface TetrisView {
  phase: Phase
  /** Только зафиксированные клетки: ROWS строк по COLS. */
  grid: readonly (readonly Cell[])[]
  /** Активная фигура в координатах стакана. y может быть отрицательным:
   *  отталкивание умеет вытолкнуть фигуру выше кромки. */
  active: { id: PieceId; cells: readonly Point[] } | null
  /** Тень — та же фигура на месте приземления. */
  ghost: readonly Point[]
  next: PieceId
  score: number
  level: number
  lines: number
  best: number
  /** Сколько линий собрано последним замыканием — для подписи на экране. */
  lastClear: number
}

export interface TetrisOptions {
  /** Рекорд, прочитанный снаружи. */
  best?: number
  /** Новый рекорд — сохранить снаружи. */
  onBest?: (best: number) => void
  /** Источник случайности. Подменяется в прогонах, чтобы партия
   *  повторялась в точности. */
  rng?: () => number
}

export interface Tetris {
  view(): TetrisView
  /** Фаза отдельно от `view()`: её спрашивают каждый кадр, а `view()`
   *  собирает координаты всех клеток и на это не рассчитан. */
  phase(): Phase
  /** Шаг по ВРЕМЕНИ КАДРА, а не по кадру: на 120 Гц кадров вдвое больше,
   *  а секунда та же. */
  tick(dt: number): void
  /** Возвращает true, если игра забрала клавишу себе. */
  key(name: GameKey, down: boolean): boolean
  /** Что-то изменилось со времени прошлого вопроса — перерисовать стакан. */
  takeDirty(): boolean
  /** Фокус ушёл: keyup уже не придёт, зажатые клавиши надо отпустить
   *  руками, иначе фигура «поедет» при возвращении. */
  releaseKeys(): void
}

export function createTetris(opts: TetrisOptions = {}): Tetris {
  const rng = opts.rng ?? Math.random
  let best = opts.best ?? 0

  let grid: Cell[][] = emptyGrid()
  let phase: Phase = 'idle'
  let piece: { id: PieceId; rot: number; x: number; y: number } | null = null
  let bag: PieceId[] = []
  let next: PieceId = draw()
  let score = 0
  let lines = 0
  let level = 1
  let lastClear = 0

  let fallTimer = 0
  let lockTimer = 0
  let lockResets = 0
  let grounded = false

  let heldLeft = false
  let heldRight = false
  let heldDown = false
  let moveDir = 0
  let moveTimer = 0

  let dirty = true

  function emptyGrid(): Cell[][] {
    return Array.from({ length: ROWS }, () => Array<Cell>(COLS).fill(null))
  }

  /** 7-bag: каждые семь фигур — перестановка полного набора. Не «случайно»,
   *  а «без длинных засух»: без мешка ожидание нужной I доходит до
   *  десятков фигур, и партия проигрывается не по вине игрока. */
  function draw(): PieceId {
    if (!bag.length) {
      bag = [...PIECE_IDS]
      for (let i = bag.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1))
        ;[bag[i], bag[j]] = [bag[j], bag[i]]
      }
    }
    return bag.pop()!
  }

  function fits(id: PieceId, rot: number, x: number, y: number): boolean {
    for (const [cx, cy] of ROT[id][rot]) {
      const gx = x + cx
      const gy = y + cy
      if (gx < 0 || gx >= COLS || gy >= ROWS) return false
      // Выше кромки поля пусто: туда фигуру выталкивает отталкивание.
      if (gy >= 0 && grid[gy][gx]) return false
    }
    return true
  }

  /**
   * Спавн: фигура целиком видна с первого кадра. В каноне она появляется
   * над кромкой и въезжает первым же шагом, но там поле выше на две
   * строки; здесь строк ровно двадцать, и фигура, невидимая до первого
   * падения, читалась бы как задержка отклика.
   */
  function spawn() {
    const id = next
    next = draw()
    const cells = ROT[id][0]
    const minY = Math.min(...cells.map(([, y]) => y))
    const x = id === 'O' ? 4 : 3
    const y = -minY
    piece = { id, rot: 0, x, y }
    fallTimer = 0
    lockTimer = 0
    lockResets = 0
    grounded = false
    // Некуда ставить — партия окончена. Это классический block out.
    if (!fits(id, 0, x, y)) {
      piece = null
      end()
    }
  }

  function end() {
    phase = 'over'
    moveDir = 0
    if (score > best) {
      best = score
      opts.onBest?.(best)
    }
    dirty = true
  }

  function start() {
    grid = emptyGrid()
    score = 0
    lines = 0
    level = 1
    lastClear = 0
    bag = []
    next = draw()
    phase = 'playing'
    spawn()
    dirty = true
  }

  function move(dx: number): boolean {
    if (!piece || !fits(piece.id, piece.rot, piece.x + dx, piece.y)) return false
    piece.x += dx
    touched()
    return true
  }

  function rotate(): boolean {
    if (!piece || piece.id === 'O') return false
    const from = piece.rot
    const to = (from + 1) % 4
    const table = piece.id === 'I' ? KICKS_I : KICKS_JLSTZ
    for (const [kx, ky] of table[`${from}${to}`]) {
      // Знак y переворачивается здесь и только здесь: в таблице он вверх,
      // на поле вниз.
      const x = piece.x + kx
      const y = piece.y - ky
      if (fits(piece.id, to, x, y)) {
        piece.rot = to
        piece.x = x
        piece.y = y
        touched()
        return true
      }
    }
    return false
  }

  /** Удачное действие у самого дна отодвигает фиксацию — но не бесконечно. */
  function touched() {
    dirty = true
    if (!piece) return
    const onFloor = !fits(piece.id, piece.rot, piece.x, piece.y + 1)
    if (grounded && onFloor && lockResets < LOCK_RESETS) {
      lockResets++
      lockTimer = 0
    }
    grounded = onFloor
  }

  function stepDown(): boolean {
    if (!piece || !fits(piece.id, piece.rot, piece.x, piece.y + 1)) return false
    piece.y++
    grounded = !fits(piece.id, piece.rot, piece.x, piece.y + 1)
    dirty = true
    return true
  }

  function lock() {
    if (!piece) return
    let aboveTop = false
    for (const [cx, cy] of ROT[piece.id][piece.rot]) {
      const gy = piece.y + cy
      // Фигура зафиксировалась целиком выше кромки — lock out, конец.
      if (gy < 0) {
        aboveTop = true
        continue
      }
      grid[gy][piece.x + cx] = piece.id
    }
    piece = null
    if (aboveTop) {
      end()
      return
    }

    const kept = grid.filter((row) => row.some((c) => !c))
    const cleared = ROWS - kept.length
    if (cleared) {
      grid = [
        ...Array.from({ length: cleared }, () => Array<Cell>(COLS).fill(null)),
        ...kept,
      ]
      lines += cleared
      score += LINE_SCORE[cleared] * level
      // Уровень +1 каждые десять линий, считая от начала партии.
      level = Math.floor(lines / 10) + 1
    }
    lastClear = cleared
    dirty = true
    spawn()
  }

  function hardDrop() {
    if (!piece) return
    let cells = 0
    while (stepDown()) cells++
    // Жёсткое падение — два очка за клетку, мягкое одно: цена риска в
    // каноне выше цены терпения.
    score += cells * 2
    lock()
  }

  function ghostY(): number {
    if (!piece) return 0
    let y = piece.y
    while (fits(piece.id, piece.rot, piece.x, y + 1)) y++
    return y
  }

  function key(name: GameKey, down: boolean): boolean {
    if (name === 'start') {
      if (down && phase !== 'playing') start()
      return true
    }
    if (phase !== 'playing') {
      // Пробел на экране «game over» перезапускает партию, а не роняет
      // фигуру, которой нет.
      if (name === 'drop' && down) {
        start()
        return true
      }
      // Стрелки игра забирает себе в любом случае: пока тетрис открыт,
      // они не должны листать документ за его спиной.
      return true
    }

    if (name === 'left' || name === 'right') {
      const dir = name === 'left' ? -1 : 1
      if (name === 'left') heldLeft = down
      else heldRight = down
      if (down) {
        move(dir)
        moveDir = dir
        moveTimer = DAS
      } else {
        // Отпустили одну из двух зажатых — едем в сторону оставшейся.
        moveDir = heldLeft ? -1 : heldRight ? 1 : 0
        if (moveDir) moveTimer = ARR
      }
      return true
    }
    if (name === 'down') {
      heldDown = down
      return true
    }
    if (name === 'rotate') {
      if (down) rotate()
      return true
    }
    if (name === 'drop') {
      if (down) hardDrop()
      return true
    }
    return false
  }

  function tick(dt: number) {
    if (phase !== 'playing' || !piece) return

    if (moveDir) {
      moveTimer -= dt
      while (moveTimer <= 0) {
        // Упёрлись в стенку — автоповтор больше не нужен, но зажатая
        // клавиша остаётся: отпустят и нажмут снова.
        if (!move(moveDir)) {
          moveTimer = ARR
          break
        }
        moveTimer += ARR
      }
    }

    // Мягкое падение — двадцатикратная скорость, как в каноне, но не
    // быстрее предела: на высоких уровнях обычное падение уже быстрее.
    const base = fallInterval(level)
    const step = heldDown ? Math.max(MIN_FALL, Math.min(base, base / 20)) : base

    fallTimer += dt
    while (fallTimer >= step) {
      fallTimer -= step
      if (stepDown()) {
        if (heldDown) score += 1
      } else {
        // Дальше некуда: время идёт в задержку фиксации, а не в падение.
        fallTimer = 0
        break
      }
    }

    if (piece && !fits(piece.id, piece.rot, piece.x, piece.y + 1)) {
      grounded = true
      lockTimer += dt
      if (lockTimer >= LOCK_DELAY) lock()
    } else {
      lockTimer = 0
    }
  }

  function view(): TetrisView {
    const cells = piece ? ROT[piece.id][piece.rot] : []
    const gy = ghostY()
    return {
      phase,
      grid,
      active: piece
        ? { id: piece.id, cells: cells.map(([x, y]) => [piece!.x + x, piece!.y + y] as Point) }
        : null,
      ghost: piece ? cells.map(([x, y]) => [piece!.x + x, gy + y] as Point) : [],
      next,
      score,
      level,
      lines,
      best,
      lastClear,
    }
  }

  return {
    view,
    phase: () => phase,
    tick,
    key,
    takeDirty() {
      const was = dirty
      dirty = false
      return was
    },
    releaseKeys() {
      heldLeft = heldRight = heldDown = false
      moveDir = 0
    },
  }
}
