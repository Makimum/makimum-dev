/**
 * Дизайн-токены и примитивы рисования для экранов комнаты.
 *
 * Экран — единственная плоскость сцены, где живёт типографика, поэтому
 * у неё своя система, отдельная от PALETTE комнаты. Правило то же самое:
 * ни один рисователь не объявляет свой цвет и свой кегль сам.
 *
 * МАСШТАБ. Все размеры задаются в единицах `k = высота холста / 870`.
 * Так один и тот же рисователь даёт одинаковую ВИДИМУЮ величину текста
 * и на ультрашироком мониторе (2048×870), и на матрице ноутбука
 * (1536×960) — меняется только сколько символов влезает в строку.
 * Это и есть отзывчивость: узкий экран получает узкую колонку, а не
 * мелкий шрифт.
 *
 * АКЦЕНТ. #F47726 — оранжевая точка из питч-деки VettaX. Взят оттуда
 * намеренно: дека уже показывалась инвесторам, она и есть установившаяся
 * айдентика, поэтому комната подтягивается к ней, а не наоборот.
 */

export const UI = {
  /** Рабочий стол */
  ink0: '#0b0e13',
  /** Тело окна */
  ink1: '#10141c',
  /** Карточка внутри окна */
  ink2: '#181d27',
  hair: 'rgba(255,255,255,0.085)',
  hairSoft: 'rgba(255,255,255,0.045)',
  text: '#eae8e3',
  dim: '#8c919c',
  faint: '#5b616d',
  accent: '#f47726',
  accentDim: 'rgba(244,119,38,0.55)',
  accentWash: 'rgba(244,119,38,0.13)',

  /** Бумага слайдов деки — светлая тема внутри тёмного окна. */
  paper: '#eceae3',
  paperInk: '#161616',
  paperDim: '#6b6862',
  paperHair: 'rgba(22,22,22,0.14)',

  sans: '-apple-system, BlinkMacSystemFont, Inter, "Segoe UI", system-ui, sans-serif',
  mono: 'ui-monospace, "SF Mono", Menlo, monospace',
} as const

/**
 * Цвета фигур тетриса.
 *
 * Не семь произвольных красок, а один проход по кругу от фиолетового к
 * оранжевому: через синий, бирюзовый, зелёный и песочный. Проход
 * односторонний и не заходит в красную четверть — красный в этой комнате
 * занят креслом и лампой, и фигура такого цвета читалась бы как предмет.
 *
 * Акцент `#F47726` достаётся только `I`: она реже всех решает партию, и её
 * появление должно быть событием, а не ещё одним кубиком. Тот же оранжевый
 * стоит в логотипе рабочего стола — на экране он означает «смотри сюда».
 */
export const PIECE: Record<string, string> = {
  T: '#9d84d4',
  J: '#5b8cd6',
  L: '#4fb0c9',
  S: '#54b58c',
  Z: '#8fb457',
  O: '#c9a961',
  I: '#f47726',
}

export function makeCanvas(w: number, h: number) {
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(w))
  canvas.height = Math.max(1, Math.round(h))
  const ctx = canvas.getContext('2d')!
  return { canvas, ctx }
}

export function font(weight: number | string, size: number, family: string = UI.sans): string {
  return `${weight} ${Math.max(1, Math.round(size))}px ${family}`
}

export function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  const rr = Math.min(r, w / 2, h / 2)
  ctx.beginPath()
  ctx.moveTo(x + rr, y)
  ctx.arcTo(x + w, y, x + w, y + h, rr)
  ctx.arcTo(x + w, y + h, x, y + h, rr)
  ctx.arcTo(x, y + h, x, y, rr)
  ctx.arcTo(x, y, x + w, y, rr)
  ctx.closePath()
}

/**
 * Разрядка вручную, посимвольно. `ctx.letterSpacing` появился недавно и
 * не везде: у деки кикеры набраны ALL-CAPS с разрядкой, и без неё они
 * читаются как обычный мелкий текст, а не как метка раздела.
 */
export function tracked(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  spacing: number,
): number {
  let cx = x
  for (const ch of text) {
    ctx.fillText(ch, cx, y)
    cx += ctx.measureText(ch).width + spacing
  }
  return cx - x - spacing
}

export function trackedWidth(
  ctx: CanvasRenderingContext2D,
  text: string,
  spacing: number,
): number {
  let w = 0
  for (const ch of text) w += ctx.measureText(ch).width + spacing
  return Math.max(0, w - spacing)
}

/** Перенос по ширине. Canvas этого не умеет сам. */
export function wrapLines(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxW: number,
): string[] {
  const out: string[] = []
  for (const para of text.split('\n')) {
    if (!para.trim()) {
      out.push('')
      continue
    }
    let line = ''
    for (const word of para.split(' ')) {
      const test = line ? `${line} ${word}` : word
      if (line && ctx.measureText(test).width > maxW) {
        out.push(line)
        line = word
      } else {
        line = test
      }
    }
    if (line) out.push(line)
  }
  return out
}

/** Точечная сетка — прямая цитата фона питч-деки. */
export function dotGrid(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  step: number,
  color: string,
  radius = 1.1,
) {
  ctx.save()
  ctx.fillStyle = color
  for (let gy = y + step / 2; gy < y + h; gy += step) {
    for (let gx = x + step / 2; gx < x + w; gx += step) {
      ctx.beginPath()
      ctx.arc(gx, gy, radius, 0, Math.PI * 2)
      ctx.fill()
    }
  }
  ctx.restore()
}

/** Лёгкое затемнение к краям: без него холст читается как наклейка,
 *  а не как светящаяся панель. */
export function panelVignette(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.25, w / 2, h / 2, Math.max(w, h) * 0.72)
  g.addColorStop(0, 'rgba(0,0,0,0)')
  g.addColorStop(1, 'rgba(0,0,0,0.28)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, w, h)
}

/* ------------------------------------------------------------------ */
/* Иконки приложений                                                   */
/* ------------------------------------------------------------------ */

/**
 * Иконки рисуются кодом, как и вся комната: ни одного растрового ассета
 * и ни одной эмодзи. Эмодзи здесь были бы честным провалом — они
 * приезжают из системного шрифта, выглядят по-разному на каждой ОС
 * и мгновенно выдают, что интерфейс собран из чужих кусков.
 */
export type IconDraw = (
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  s: number,
  color: string,
) => void

const stroke = (ctx: CanvasRenderingContext2D, color: string, s: number, mul = 1) => {
  ctx.strokeStyle = color
  ctx.lineWidth = Math.max(1.5, s * 0.06 * mul)
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
}

/** Портрет: голова и плечи. */
const iconUser: IconDraw = (ctx, cx, cy, s, color) => {
  stroke(ctx, color, s)
  ctx.beginPath()
  ctx.arc(cx, cy - s * 0.17, s * 0.19, 0, Math.PI * 2)
  ctx.stroke()
  ctx.beginPath()
  ctx.arc(cx, cy + s * 0.42, s * 0.36, Math.PI * 1.15, Math.PI * 1.85)
  ctx.stroke()
}

/** Сетка карточек: проекты. */
const iconGrid: IconDraw = (ctx, cx, cy, s, color) => {
  stroke(ctx, color, s)
  const u = s * 0.2
  const gap = s * 0.09
  for (const [dx, dy] of [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ] as const) {
    const x = cx + dx * (u / 2 + gap / 2) - u / 2
    const y = cy + dy * (u / 2 + gap / 2) - u / 2
    roundRect(ctx, x, y, u, u, s * 0.05)
    if (dx === -1 && dy === -1) {
      ctx.fillStyle = color
      ctx.fill()
    } else {
      ctx.stroke()
    }
  }
}

/** Слайд: рамка, заголовок, полоса. */
const iconDeck: IconDraw = (ctx, cx, cy, s, color) => {
  stroke(ctx, color, s)
  const w = s * 0.66
  const h = s * 0.46
  roundRect(ctx, cx - w / 2, cy - h / 2 - s * 0.07, w, h, s * 0.05)
  ctx.stroke()
  ctx.fillStyle = color
  ctx.fillRect(cx - w / 2 + s * 0.08, cy - s * 0.16, w * 0.42, s * 0.045)
  ctx.fillRect(cx - w / 2 + s * 0.08, cy - s * 0.04, w * 0.66, s * 0.035)
  ctx.beginPath()
  ctx.moveTo(cx - s * 0.16, cy + s * 0.34)
  ctx.lineTo(cx + s * 0.16, cy + s * 0.34)
  ctx.stroke()
}

/** Изометрический куб: комната, собранная кодом. */
const iconCube: IconDraw = (ctx, cx, cy, s, color) => {
  stroke(ctx, color, s)
  const w = s * 0.34
  const h = s * 0.19
  const d = s * 0.3
  ctx.beginPath()
  ctx.moveTo(cx, cy - h - d * 0.5)
  ctx.lineTo(cx + w, cy - d * 0.5)
  ctx.lineTo(cx + w, cy + d * 0.5)
  ctx.lineTo(cx, cy + h + d * 0.5)
  ctx.lineTo(cx - w, cy + d * 0.5)
  ctx.lineTo(cx - w, cy - d * 0.5)
  ctx.closePath()
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(cx - w, cy - d * 0.5)
  ctx.lineTo(cx, cy)
  ctx.lineTo(cx + w, cy - d * 0.5)
  ctx.moveTo(cx, cy)
  ctx.lineTo(cx, cy + h + d * 0.5)
  ctx.stroke()
}

/** Собачка: контакты. */
const iconAt: IconDraw = (ctx, cx, cy, s, color) => {
  stroke(ctx, color, s)
  ctx.beginPath()
  ctx.arc(cx, cy, s * 0.16, 0, Math.PI * 2)
  ctx.stroke()
  ctx.beginPath()
  ctx.arc(cx, cy, s * 0.36, Math.PI * 1.75, Math.PI * 1.35)
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(cx + s * 0.16, cy - s * 0.16)
  ctx.lineTo(cx + s * 0.16, cy + s * 0.08)
  ctx.stroke()
}

/** Лист с загнутым углом — резюме. */
function iconDoc(ctx: CanvasRenderingContext2D, cx: number, cy: number, s: number, color: string) {
  ctx.strokeStyle = color
  ctx.lineWidth = s * 0.085
  ctx.lineJoin = 'round'
  const w = s * 0.56
  const h = s * 0.74
  const x = cx - w / 2
  const y = cy - h / 2
  const fold = s * 0.2
  ctx.beginPath()
  ctx.moveTo(x, y)
  ctx.lineTo(x + w - fold, y)
  ctx.lineTo(x + w, y + fold)
  ctx.lineTo(x + w, y + h)
  ctx.lineTo(x, y + h)
  ctx.closePath()
  ctx.stroke()
  // Загнутый уголок отдельной линией: без него лист читается конвертом.
  ctx.beginPath()
  ctx.moveTo(x + w - fold, y)
  ctx.lineTo(x + w - fold, y + fold)
  ctx.lineTo(x + w, y + fold)
  ctx.stroke()
  ctx.beginPath()
  for (let i = 0; i < 3; i++) {
    const ly = y + h * 0.45 + i * s * 0.13
    ctx.moveTo(x + s * 0.1, ly)
    ctx.lineTo(x + w - s * 0.1, ly)
  }
  ctx.stroke()
}

/** Рамка с горой и солнцем — галерея. */
function iconPhoto(ctx: CanvasRenderingContext2D, cx: number, cy: number, s: number, color: string) {
  ctx.strokeStyle = color
  ctx.lineWidth = s * 0.085
  ctx.lineJoin = 'round'
  const w = s * 0.78
  const h = s * 0.62
  const x = cx - w / 2
  const y = cy - h / 2
  ctx.beginPath()
  ctx.rect(x, y, w, h)
  ctx.stroke()
  ctx.beginPath()
  ctx.arc(x + w * 0.28, y + h * 0.3, s * 0.07, 0, Math.PI * 2)
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(x + w * 0.08, y + h * 0.88)
  ctx.lineTo(x + w * 0.42, y + h * 0.45)
  ctx.lineTo(x + w * 0.66, y + h * 0.72)
  ctx.lineTo(x + w * 0.8, y + h * 0.58)
  ctx.lineTo(x + w * 0.94, y + h * 0.88)
  ctx.stroke()
}

/** Фигура S из четырёх клеток — тетрис. Именно S, а не квадрат: квадрат
 *  на плитке читается как «папка», а излом ни с чем не путается. */
function iconGame(ctx: CanvasRenderingContext2D, cx: number, cy: number, s: number, color: string) {
  const u = s * 0.22
  const gap = s * 0.03
  ctx.strokeStyle = color
  ctx.lineWidth = s * 0.075
  ctx.lineJoin = 'round'
  for (const [gxi, gyi] of [
    [0, -1],
    [1, -1],
    [-1, 0],
    [0, 0],
  ] as const) {
    const x = cx + gxi * (u + gap) - u / 2
    const y = cy + gyi * (u + gap) - u / 2
    roundRect(ctx, x, y, u, u, s * 0.035)
    ctx.stroke()
  }
}

export const ICONS: Record<string, IconDraw> = {
  user: iconUser,
  grid: iconGrid,
  deck: iconDeck,
  cube: iconCube,
  at: iconAt,
  doc: iconDoc,
  photo: iconPhoto,
  game: iconGame,
}
