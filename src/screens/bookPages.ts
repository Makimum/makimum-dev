import { getDoc, type Block } from './content'
import { UI, font, tracked, trackedWidth, wrapLines } from './theme'
import type { HitRegion } from './paint'

/**
 * Разворот книги «Geek Profile».
 *
 * ОТКУДА ТЕКСТ. Ни одной новой строки здесь не написано: страницы
 * набираются из тех же блоков, что показывает приложение About на
 * ноутбуке (`getDoc('about')`). Это принципиально. Книга на столе с
 * выдуманным содержимым была бы ровно тем, чего правило проекта не
 * допускает; книга, в которой напечатано то же, что человек о себе уже
 * говорит, — это тот же факт в другом носителе. Название «Geek Profile»
 * дал Максим, и оно ровно про это.
 *
 * ПОЧЕМУ НАБОР СВОЙ, А НЕ ТОТ ЖЕ, ЧТО НА ЭКРАНЕ. Экран светится, книга
 * отражает. У экранной типографики светлый текст на тёмном и разрядка под
 * подсветку; у книжной — тёмный на бумаге, засечки, узкая колонка,
 * колонцифра внизу. Прогнать те же блоки через тот же рисователь значило
 * бы получить скриншот экрана, наклеенный на бумагу.
 *
 * СТРАНИЦЫ ВЁРСТАЮТСЯ, А НЕ РАЗМЕЧАЮТСЯ РУКАМИ. Разбивка считается по
 * реальной высоте набранного текста: строки меряются тем же ctx, которым
 * рисуются. Ручная разбивка разъехалась бы от первой же правки текста.
 */

/** Бумага и краска. Не из PALETTE: это не поверхность комнаты, а печать. */
const PAPER = '#efe9db'
const PAPER_SHADE = '#e4dccb'
const INK = '#26221c'
const INK_SOFT = '#6b6459'
const SERIF = 'Georgia, "Times New Roman", serif'

export interface Spread {
  /** Блоки левой и правой страницы. */
  left: Block[]
  right: Block[]
}

interface Measured {
  block: Block
  height: number
}

/**
 * Высота блока в пикселях холста страницы. Меряется тем же контекстом,
 * которым потом рисуется, — иначе вёрстка и отрисовка разойдутся.
 */
function measure(ctx: CanvasRenderingContext2D, b: Block, w: number, k: number): number {
  switch (b.t) {
    case 'lead':
      ctx.font = font(400, 27 * k, SERIF)
      return wrapLines(ctx, b.text, w).length * 38 * k + 22 * k
    case 'p':
      ctx.font = font(400, 20 * k, SERIF)
      return wrapLines(ctx, b.text, w).length * 30 * k + 18 * k
    case 'h':
      return 46 * k
    case 'kicker':
      return 34 * k
    case 'bullets':
      ctx.font = font(400, 19 * k, SERIF)
      return b.items.reduce((a, it) => a + wrapLines(ctx, it, w - 22 * k).length * 28 * k, 0) + 14 * k
    case 'metrics':
      return 66 * k
    case 'note':
      ctx.font = font(400, 17 * k, SERIF)
      return wrapLines(ctx, b.text, w).length * 25 * k + 16 * k
    case 'rule':
      return 26 * k
    case 'gap':
      return (b.size ?? 12) * k
    default:
      // Фотографии, снимки галереи и ссылки в книгу не идут: печать их
      // не показывает, а место они бы заняли.
      return 0
  }
}

function draw(ctx: CanvasRenderingContext2D, b: Block, x: number, y: number, w: number, k: number): number {
  switch (b.t) {
    case 'lead': {
      ctx.fillStyle = INK
      ctx.font = font(400, 27 * k, SERIF)
      let cy = y + 27 * k
      for (const line of wrapLines(ctx, b.text, w)) {
        ctx.fillText(line, x, cy)
        cy += 38 * k
      }
      return cy - y + 4 * k
    }
    case 'p': {
      ctx.fillStyle = INK
      ctx.font = font(400, 20 * k, SERIF)
      let cy = y + 20 * k
      for (const line of wrapLines(ctx, b.text, w)) {
        ctx.fillText(line, x, cy)
        cy += 30 * k
      }
      return cy - y + 8 * k
    }
    case 'h': {
      ctx.fillStyle = INK
      ctx.font = font(600, 21 * k, SERIF)
      ctx.fillText(b.text, x, y + 24 * k)
      return 46 * k
    }
    case 'kicker': {
      ctx.fillStyle = INK_SOFT
      ctx.font = font(600, 13 * k, SERIF)
      tracked(ctx, b.text.toUpperCase(), x, y + 18 * k, 2.4 * k)
      return 34 * k
    }
    case 'bullets': {
      ctx.fillStyle = INK
      ctx.font = font(400, 19 * k, SERIF)
      let cy = y + 19 * k
      for (const item of b.items) {
        // Тире, а не точка: в наборе книги маркер списка — длинное тире.
        ctx.fillStyle = INK_SOFT
        ctx.fillText('—', x, cy)
        ctx.fillStyle = INK
        for (const line of wrapLines(ctx, item, w - 22 * k)) {
          ctx.fillText(line, x + 22 * k, cy)
          cy += 28 * k
        }
      }
      return cy - y + 6 * k
    }
    case 'metrics': {
      let cx = x
      for (const m of b.items) {
        ctx.fillStyle = INK
        ctx.font = font(600, 26 * k, SERIF)
        ctx.fillText(m.value, cx, y + 30 * k)
        const vw = ctx.measureText(m.value).width
        ctx.fillStyle = INK_SOFT
        ctx.font = font(400, 12 * k, SERIF)
        const lines = wrapLines(ctx, m.label, Math.max(vw, 90 * k))
        ctx.fillText(lines[0] ?? '', cx, y + 48 * k)
        cx += Math.max(vw, 90 * k) + 26 * k
      }
      return 66 * k
    }
    case 'note': {
      ctx.fillStyle = INK_SOFT
      ctx.font = font(400, 17 * k, SERIF)
      let cy = y + 17 * k
      for (const line of wrapLines(ctx, b.text, w)) {
        ctx.fillText(line, x, cy)
        cy += 25 * k
      }
      return cy - y + 6 * k
    }
    case 'rule': {
      ctx.strokeStyle = 'rgba(38,34,28,0.18)'
      ctx.lineWidth = Math.max(1, 1.2 * k)
      ctx.beginPath()
      ctx.moveTo(x, y + 13 * k)
      ctx.lineTo(x + w * 0.42, y + 13 * k)
      ctx.stroke()
      return 26 * k
    }
    case 'gap':
      return (b.size ?? 12) * k
    default:
      return 0
  }
}

/**
 * Разложить блоки по разворотам.
 *
 * Титул — отдельный разворот: у книги он всегда отдельный, и это первое,
 * что видно при открытии.
 */
export function paginate(
  ctx: CanvasRenderingContext2D,
  pageW: number,
  pageH: number,
  k: number,
): Spread[] {
  const doc = getDoc('about')
  const blocks: Block[] = doc ? [...doc.body, ...(doc.aside ?? [])] : []
  const usable = pageH - 150 * k

  const measured: Measured[] = blocks
    .map((b) => ({ block: b, height: measure(ctx, b, pageW, k) }))
    .filter((m) => m.height > 0)

  const pages: Block[][] = []
  let page: Block[] = []
  let used = 0
  for (const m of measured) {
    if (used + m.height > usable && page.length) {
      pages.push(page)
      page = []
      used = 0
    }
    page.push(m.block)
    used += m.height
  }
  if (page.length) pages.push(page)

  // Титул занимает левую страницу первого разворота — правая начинает текст.
  const spreads: Spread[] = [{ left: [], right: pages[0] ?? [] }]
  for (let i = 1; i < pages.length; i += 2) {
    spreads.push({ left: pages[i] ?? [], right: pages[i + 1] ?? [] })
  }
  return spreads
}

/**
 * Нарисовать разворот целиком. Возвращает области попадания: левый и
 * правый край листают, как в настоящей книге пальцем.
 */
export function paintSpread(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  spreads: Spread[],
  index: number,
  title: string,
): HitRegion[] {
  const k = H / 1000
  const pageW = W / 2
  const margin = 74 * k
  const colW = pageW - margin * 2

  ctx.fillStyle = PAPER
  ctx.fillRect(0, 0, W, H)

  // Тень у корешка: без неё разворот — один лист, а не две страницы.
  const gutter = ctx.createLinearGradient(W / 2 - 46 * k, 0, W / 2 + 46 * k, 0)
  gutter.addColorStop(0, 'rgba(0,0,0,0)')
  gutter.addColorStop(0.5, 'rgba(60,50,36,0.22)')
  gutter.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.fillStyle = gutter
  ctx.fillRect(W / 2 - 46 * k, 0, 92 * k, H)

  // Лёгкая тонировка к внешним обрезам — бумага темнеет от края.
  for (const side of [0, 1]) {
    const g = ctx.createLinearGradient(side ? W : 0, 0, side ? W - 90 * k : 90 * k, 0)
    g.addColorStop(0, PAPER_SHADE)
    g.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = g
    ctx.fillRect(side ? W - 90 * k : 0, 0, 90 * k, H)
  }

  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
  const spread = spreads[index] ?? { left: [], right: [] }

  // Титульная страница — только на первом развороте.
  if (index === 0) {
    const cx = pageW / 2
    ctx.textAlign = 'center'
    ctx.fillStyle = INK_SOFT
    ctx.font = font(600, 13 * k, SERIF)
    const kicker = 'A PORTFOLIO'
    tracked(ctx, kicker, cx - trackedWidth(ctx, kicker, 3 * k) / 2, H * 0.36, 3 * k)
    ctx.fillStyle = INK
    ctx.font = font(400, 46 * k, SERIF)
    ctx.textAlign = 'center'
    ctx.fillText(title, cx, H * 0.45)
    ctx.strokeStyle = 'rgba(38,34,28,0.28)'
    ctx.lineWidth = Math.max(1, 1.2 * k)
    ctx.beginPath()
    ctx.moveTo(cx - 70 * k, H * 0.48)
    ctx.lineTo(cx + 70 * k, H * 0.48)
    ctx.stroke()
    ctx.fillStyle = INK_SOFT
    ctx.font = font(400, 17 * k, SERIF)
    ctx.fillText('Maxim Fursov', cx, H * 0.53)
    ctx.textAlign = 'left'
  } else {
    let y = margin
    for (const b of spread.left) y += draw(ctx, b, margin, y, colW, k)
  }

  let y = margin
  for (const b of spread.right) y += draw(ctx, b, pageW + margin, y, colW, k)

  // Колонцифры. На титульной странице их не ставят.
  ctx.fillStyle = INK_SOFT
  ctx.font = font(400, 13 * k, SERIF)
  ctx.textAlign = 'center'
  if (index > 0) ctx.fillText(String(index * 2), pageW / 2, H - 44 * k)
  ctx.fillText(String(index * 2 + 1), pageW * 1.5, H - 44 * k)
  ctx.textAlign = 'left'

  const hits: HitRegion[] = []
  if (index > 0) hits.push({ id: 'prev', x: 0, y: 0, w: W * 0.16, h: H })
  if (index < spreads.length - 1) hits.push({ id: 'next', x: W * 0.84, y: 0, w: W * 0.16, h: H })
  return hits
}
