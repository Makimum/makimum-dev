import {
  APPS,
  appsFor,
  SHOTS,
  type Screen,
  DECK,
  DECK_INDEX,
  FACTS,
  fmt,
  getDoc,
  type Block,
  type Doc,
  type Slide,
} from './content'
import {
  ICONS,
  PIECE,
  UI,
  dotGrid,
  font,
  makeCanvas,
  panelVignette,
  roundRect,
  tracked,
  trackedWidth,
  wrapLines,
} from './theme'
import { COLS, ROWS, type Point, type TetrisView } from './tetris'

/**
 * Рисователь экранов: рабочий стол с приложениями и открытое окно.
 *
 * Почему всё это в canvas, а не в HTML поверх сцены: DOM-слой не умеет
 * уходить ЗА геометрию, поэтому кресло не перекрыло бы монитор — и
 * иллюзия комнаты рассыпалась бы ровно там, где она нужнее всего.
 * Текстура живёт внутри сцены и подчиняется глубине и запечённому свету.
 * Цена решения — вёрстка руками; расплата за неё в этом файле.
 *
 * Доступность и SEO этим не жертвуются: тот же контент дублируется
 * настоящим DOM-деревом (см. page/mount.ts), которое CSS прячет за холстом.
 *
 * КООРДИНАТЫ. Всё считается в пикселях холста. Единственный масштаб —
 * `k = H / 870`: он держит видимую величину текста одинаковой на
 * ультрашироком мониторе и на матрице ноутбука.
 */

/** Кликабельная область в пикселях холста. */
export interface HitRegion {
  id: string
  x: number
  y: number
  w: number
  h: number
}

/**
 * Картинки для галереи и резюме.
 *
 * Грузятся лениво и живут в общем кэше на оба экрана: снимок, открытый на
 * мониторе, не должен качаться заново, если его же откроют с ноутбука.
 * Пока картинка не пришла, на её месте рисуется рамка-заполнитель — иначе
 * при первом открытии галереи экран моргнул бы пустотой.
 *
 * Загрузка асинхронная, а перерисовка экрана происходит только по
 * изменению состояния, поэтому пришедшая картинка обязана СООБЩИТЬ о себе.
 * Без этого она появлялась бы на экране только после следующего клика.
 */
/** Какой снимок галереи раскрыт: 0 — сетка превью, иначе номер снимка.
 *  Живёт модульной переменной, потому что `flow()` состояния не получает,
 *  а кэш документа ключуется строкой — индекс уезжает туда же. */
let openShot = 0

const images = new Map<string, HTMLImageElement>()
let onImageReady: (() => void) | null = null

export function setImageReadyHandler(fn: () => void) {
  onImageReady = fn
}

function image(src: string): HTMLImageElement | null {
  const hit = images.get(src)
  if (hit) return hit.complete && hit.naturalWidth > 0 ? hit : null
  const im = new Image()
  im.decoding = 'async'
  im.onload = () => {
    // Документ кэшируется УЖЕ ОТРИСОВАННЫМ холстом, поэтому одной
    // перерисовки экрана мало: пришедшая картинка в готовый холст не
    // попадёт никогда. Кэш документов сбрасывается вместе с ней.
    docCache.clear()
    onImageReady?.()
  }
  im.src = src
  images.set(src, im)
  return null
}

/** Рамка на месте ещё не пришедшей картинки. */
function placeholder(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  ctx.fillStyle = 'rgba(255,255,255,0.04)'
  ctx.fillRect(x, y, w, h)
  ctx.strokeStyle = 'rgba(255,255,255,0.10)'
  ctx.lineWidth = 1
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1)
}

/** Картинка, вписанная в прямоугольник без искажения пропорций. */
function drawContain(
  ctx: CanvasRenderingContext2D,
  im: HTMLImageElement,
  x: number,
  y: number,
  w: number,
  h: number,
) {
  const s = Math.min(w / im.naturalWidth, h / im.naturalHeight)
  const dw = im.naturalWidth * s
  const dh = im.naturalHeight * s
  ctx.drawImage(im, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh)
}

export interface SurfaceState {
  view: 'desktop' | 'app'
  appId: string | null
  /** Смещение скролла документа, px холста */
  scroll: number
  /** Индекс слайда деки */
  slide: number
  /** id области под курсором */
  hover: string | null
  /** 0 — ночь, 1 — день: тот же коэффициент, что и у света комнаты */
  daylight: number
  /** Часы посетителя, уже отформатированные */
  clock: string
  /** Счётчики ТЕКУЩЕГО кадра — комната меряет сама себя */
  calls: number
  /** Какой это экран: у монитора и ноутбука разные наборы приложений. */
  screen: Screen
  /** Снимок поля тетриса, когда открыта игра. Рисователь остаётся чистой
   *  функцией состояния: сам он игру не спрашивает. */
  game: TetrisView | null
}

export interface PaintResult {
  hits: HitRegion[]
  scrollMax: number
  /** Прямоугольники игры, если она открыта: по ним идёт частичная
   *  перерисовка между полными. */
  layout?: GameLayout
}

const BASE_H = 870

/* ------------------------------------------------------------------ */
/* Общее                                                               */
/* ------------------------------------------------------------------ */

function background(ctx: CanvasRenderingContext2D, W: number, H: number, k: number) {
  const g = ctx.createLinearGradient(0, 0, W * 0.6, H)
  g.addColorStop(0, '#121722')
  g.addColorStop(1, UI.ink0)
  ctx.fillStyle = g
  ctx.fillRect(0, 0, W, H)
  dotGrid(ctx, 0, 0, W, H, 46 * k, 'rgba(255,255,255,0.028)', 1.2 * k)
  // Тёплое пятно от лампы в углу — экран не висит в вакууме.
  const warm = ctx.createRadialGradient(W * 0.12, H * 0.86, 0, W * 0.12, H * 0.86, W * 0.5)
  warm.addColorStop(0, 'rgba(244,119,38,0.055)')
  warm.addColorStop(1, 'rgba(244,119,38,0)')
  ctx.fillStyle = warm
  ctx.fillRect(0, 0, W, H)
}

function menubar(
  ctx: CanvasRenderingContext2D,
  W: number,
  k: number,
  state: SurfaceState,
  right: string,
): number {
  const h = 46 * k
  ctx.fillStyle = 'rgba(255,255,255,0.035)'
  ctx.fillRect(0, 0, W, h)
  ctx.fillStyle = UI.hairSoft
  ctx.fillRect(0, h - 1, W, 1)

  ctx.textBaseline = 'middle'
  ctx.textAlign = 'left'
  // Оранжевая точка — логотип деки VettaX, здесь работает как курсор ОС.
  ctx.fillStyle = UI.accent
  ctx.beginPath()
  ctx.arc(28 * k, h / 2, 5 * k, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = UI.text
  ctx.font = font(500, 21 * k, UI.mono)
  ctx.fillText('makimum.dev', 44 * k, h / 2 + 1)

  ctx.fillStyle = UI.dim
  ctx.font = font(400, 21 * k, UI.mono)
  ctx.textAlign = 'right'
  ctx.fillText(right, W - 28 * k, h / 2 + 1)
  ctx.textAlign = 'left'
  // Индикатор времени суток: тот же коэффициент, что двигает свет комнаты.
  ctx.fillStyle = state.daylight > 0.5 ? UI.accent : UI.dim
  ctx.beginPath()
  ctx.arc(W - 28 * k - ctx.measureText(right).width - 18 * k, h / 2, 5 * k, 0, Math.PI * 2)
  if (state.daylight > 0.5) ctx.fill()
  else ctx.stroke()
  return h
}

function footerHint(ctx: CanvasRenderingContext2D, W: number, H: number, k: number, text: string) {
  ctx.fillStyle = UI.faint
  ctx.font = font(400, 20 * k, UI.mono)
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, W / 2, H - 26 * k)
  ctx.textAlign = 'left'
}

/* ------------------------------------------------------------------ */
/* Рабочий стол                                                        */
/* ------------------------------------------------------------------ */

function appTile(
  ctx: CanvasRenderingContext2D,
  app: (typeof APPS)[number],
  cx: number,
  cy: number,
  k: number,
  hovered: boolean,
) {
  const s = 128 * k
  const lift = hovered ? 4 * k : 0
  const x = cx - s / 2
  const y = cy - s / 2 - lift

  if (hovered) {
    ctx.save()
    ctx.shadowColor = 'rgba(244,119,38,0.35)'
    ctx.shadowBlur = 26 * k
    ctx.fillStyle = UI.accentWash
    roundRect(ctx, x, y, s, s, 30 * k)
    ctx.fill()
    ctx.restore()
  } else {
    ctx.fillStyle = 'rgba(255,255,255,0.045)'
    roundRect(ctx, x, y, s, s, 30 * k)
    ctx.fill()
  }
  ctx.strokeStyle = hovered ? UI.accent : UI.hair
  ctx.lineWidth = hovered ? 2.4 * k : 1.4 * k
  roundRect(ctx, x, y, s, s, 30 * k)
  ctx.stroke()

  const draw = ICONS[app.icon]
  if (draw) draw(ctx, cx, cy - lift, s * 0.52, hovered ? UI.accent : UI.text)

  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  ctx.fillStyle = hovered ? UI.text : UI.dim
  ctx.font = font(600, 24 * k)
  ctx.fillText(app.label, cx, y + s + 20 * k)
  ctx.textAlign = 'left'
}

function rail(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  k: number,
  state: SurfaceState,
) {
  ctx.fillStyle = 'rgba(255,255,255,0.028)'
  roundRect(ctx, x, y, w, h, 18 * k)
  ctx.fill()
  ctx.strokeStyle = UI.hairSoft
  ctx.lineWidth = 1.2 * k
  roundRect(ctx, x, y, w, h, 18 * k)
  ctx.stroke()

  const pad = 34 * k
  let cy = y + pad + 6 * k
  ctx.textBaseline = 'top'

  ctx.fillStyle = UI.accent
  ctx.font = font(600, 19 * k, UI.mono)
  tracked(ctx, 'NOW', x + pad, cy, 3 * k)
  cy += 40 * k

  ctx.fillStyle = UI.text
  ctx.font = font(500, 27 * k)
  for (const line of wrapLines(ctx, 'Three projects in flight, and open to contract work.', w - pad * 2)) {
    ctx.fillText(line, x + pad, cy)
    cy += 38 * k
  }
  cy += 24 * k

  ctx.fillStyle = UI.hairSoft
  ctx.fillRect(x + pad, cy, w - pad * 2, 1)
  cy += 28 * k

  ctx.fillStyle = UI.accent
  ctx.font = font(600, 19 * k, UI.mono)
  tracked(ctx, 'THIS ROOM, MEASURED', x + pad, cy, 3 * k)
  cy += 38 * k

  // Треугольники — по сцене (величина постоянная), draw calls — живьём.
  // Второе число двигается при вращении камеры, и это правда: отсечение
  // по пирамиде видимости так и работает.
  //
  // ПОДПИСЬ «scene pass», А НЕ «per frame», И ЭТО НЕ ПРИДИРКА. Счётчик
  // снимается сразу после `RenderPass` — то есть считает ОДИН проход.
  // За весь кадр их больше: G-буфер, ещё около двадцати полноэкранных
  // квадов и, когда есть что перерисовать, карта теней. Замер `profile()`
  // даёт 379 против 78 здесь. Прежняя подпись обещала кадр, а показывала
  // проход — ровно тот сорт вранья, против которого этот экран и заведён.
  for (const [value, label] of [
    [fmt(FACTS.triangles), 'triangles'],
    [String(state.calls), 'draw calls, scene pass'],
    [`${FACTS.bundleKB} KB`, 'gzipped, zero 3D assets'],
  ] as const) {
    ctx.fillStyle = UI.text
    ctx.font = font(600, 30 * k, UI.mono)
    const vw = ctx.measureText(value).width
    ctx.fillText(value, x + pad, cy)
    ctx.fillStyle = UI.dim
    ctx.font = font(400, 21 * k)
    ctx.fillText(label, x + pad + vw + 14 * k, cy + 8 * k)
    cy += 44 * k
  }
}

function paintDesktop(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  k: number,
  state: SurfaceState,
): PaintResult {
  const hits: HitRegion[] = []
  background(ctx, W, H, k)
  const barH = menubar(ctx, W, k, state, `${state.clock} Helsinki`)

  const wide = W / H > 2
  const pad = 56 * k
  const top = barH + pad
  const bottom = H - 52 * k
  const railW = wide ? 600 * k : 0
  const areaX = pad
  const areaW = W - pad * 2 - (wide ? railW + 56 * k : 0)

  if (wide) {
    rail(ctx, W - pad - railW, top, railW, bottom - top, k, state)
  }

  // Обои — это имя. Рабочий стол без него читается как чужой компьютер:
  // пять значков не говорят, чей он.
  ctx.textBaseline = 'top'
  ctx.textAlign = 'left'
  ctx.fillStyle = UI.text
  ctx.font = font(600, 52 * k)
  ctx.fillText('Maxim Fursov', areaX, top + 4 * k)
  ctx.fillStyle = UI.dim
  ctx.font = font(400, 25 * k)
  ctx.fillText('Born in Russia, based in Finland.', areaX, top + 66 * k)
  const headBottom = top + 118 * k

  const apps = appsFor(state.screen)
  const cols = wide ? apps.length : 3
  const rows = Math.ceil(apps.length / cols)
  const cellW = areaW / cols
  const cellH = Math.min(232 * k, (bottom - headBottom) / rows)
  const gridH = rows * cellH
  const gridTop = headBottom + (bottom - headBottom - gridH) / 2

  apps.forEach((app, i) => {
    const r = Math.floor(i / cols)
    const c = i % cols
    // Последний ряд центрируется: два значка, прижатых влево, читаются
    // как обрыв сетки, а не как её конец.
    const inRow = Math.min(cols, apps.length - r * cols)
    const rowW = inRow * cellW
    const cx = areaX + (areaW - rowW) / 2 + cellW * (c + 0.5)
    const cy = gridTop + cellH * (r + 0.42)
    const hovered = state.hover === `app:${app.id}`
    appTile(ctx, app, cx, cy, k, hovered)
    hits.push({
      id: `app:${app.id}`,
      x: cx - cellW / 2,
      y: cy - cellH / 2,
      w: cellW,
      h: cellH,
    })
  })

  footerHint(ctx, W, H, k, 'click an app to open  ·  esc to step back')
  panelVignette(ctx, W, H)
  return { hits, scrollMax: 0 }
}

/* ------------------------------------------------------------------ */
/* Документ                                                            */
/* ------------------------------------------------------------------ */

interface FlowResult {
  height: number
  links: (HitRegion & { href: string })[]
  /** Заголовки и их положение в документе — из них строится оглавление. */
  anchors: { text: string; y: number }[]
}

/**
 * Один проход раскладки документа. При `draw = false` ничего не рисует,
 * только меряет высоту — иначе высоту холста под документ неоткуда взять.
 */
function flow(
  ctx: CanvasRenderingContext2D,
  blocks: Block[],
  x: number,
  y0: number,
  w: number,
  k: number,
  draw: boolean,
): FlowResult {
  let y = y0
  const links: (HitRegion & { href: string })[] = []
  const anchors: { text: string; y: number }[] = []
  ctx.textBaseline = 'top'
  ctx.textAlign = 'left'

  for (const b of blocks) {
    switch (b.t) {
      case 'lead': {
        ctx.font = font(600, 34 * k)
        const lines = wrapLines(ctx, b.text, w)
        if (draw) ctx.fillStyle = UI.text
        for (const l of lines) {
          if (draw) ctx.fillText(l, x, y)
          y += 48 * k
        }
        y += 26 * k
        break
      }
      case 'p': {
        ctx.font = font(400, 27 * k)
        const lines = wrapLines(ctx, b.text, w)
        if (draw) ctx.fillStyle = '#c4c8d0'
        for (const l of lines) {
          if (draw) ctx.fillText(l, x, y)
          y += 41 * k
        }
        y += 24 * k
        break
      }
      case 'h': {
        anchors.push({ text: b.text, y: y - y0 })
        if (draw) {
          ctx.fillStyle = UI.accent
          ctx.fillRect(x, y + 8 * k, 22 * k, 4 * k)
        }
        y += 26 * k
        ctx.font = font(600, 38 * k)
        if (draw) {
          ctx.fillStyle = UI.text
          ctx.fillText(b.text, x, y)
        }
        if (b.sub) {
          const tw = ctx.measureText(b.text).width
          ctx.font = font(400, 23 * k, UI.mono)
          if (draw) {
            ctx.fillStyle = UI.faint
            ctx.fillText(b.sub, x + tw + 20 * k, y + 14 * k)
          }
        }
        y += 56 * k
        break
      }
      case 'kicker': {
        y += 8 * k
        ctx.font = font(600, 19 * k, UI.mono)
        if (draw) {
          ctx.fillStyle = UI.accent
          tracked(ctx, b.text.toUpperCase(), x, y, 3 * k)
        }
        y += 36 * k
        break
      }
      case 'metrics': {
        const gap = 30 * k
        let cx = x
        let rowTop = y
        for (const m of b.items) {
          ctx.font = font(600, 40 * k, UI.mono)
          const vw = ctx.measureText(m.value).width
          ctx.font = font(400, 20 * k)
          const lw = ctx.measureText(m.label).width
          const cw = Math.max(vw, lw)
          if (cx > x && cx + cw > x + w) {
            cx = x
            rowTop += 86 * k
          }
          if (draw) {
            ctx.font = font(600, 40 * k, UI.mono)
            ctx.fillStyle = UI.text
            ctx.fillText(m.value, cx, rowTop)
            ctx.font = font(400, 20 * k)
            ctx.fillStyle = UI.dim
            ctx.fillText(m.label, cx, rowTop + 46 * k)
          }
          cx += cw + gap
        }
        y = rowTop + 86 * k + 14 * k
        break
      }
      case 'bullets': {
        ctx.font = font(400, 26 * k)
        for (const item of b.items) {
          const lines = wrapLines(ctx, item, w - 32 * k)
          if (draw) {
            ctx.fillStyle = UI.accent
            ctx.fillRect(x + 2 * k, y + 12 * k, 10 * k, 3 * k)
            ctx.fillStyle = '#c4c8d0'
          }
          for (const [i, l] of lines.entries()) {
            if (draw) ctx.fillText(l, x + 32 * k, y + i * 38 * k)
          }
          y += lines.length * 38 * k + 12 * k
        }
        y += 14 * k
        break
      }
      case 'stack': {
        ctx.font = font(400, 21 * k, UI.mono)
        const padX = 14 * k
        const chipH = 36 * k
        let cx = x
        let rowTop = y
        for (const item of b.items) {
          const cw = ctx.measureText(item).width + padX * 2
          if (cx > x && cx + cw > x + w) {
            cx = x
            rowTop += chipH + 12 * k
          }
          if (draw) {
            ctx.strokeStyle = UI.hair
            ctx.lineWidth = 1.2 * k
            roundRect(ctx, cx, rowTop, cw, chipH, 6 * k)
            ctx.stroke()
            ctx.fillStyle = UI.dim
            ctx.fillText(item, cx + padX, rowTop + 8 * k)
          }
          cx += cw + 12 * k
        }
        y = rowTop + chipH + 30 * k
        break
      }
      case 'note': {
        ctx.font = font(400, 25 * k)
        const lines = wrapLines(ctx, b.text, w - 34 * k)
        const h = lines.length * 38 * k
        if (draw) {
          ctx.fillStyle = UI.accentDim
          ctx.fillRect(x, y + 4 * k, 3 * k, h - 8 * k)
          ctx.fillStyle = UI.dim
        }
        for (const [i, l] of lines.entries()) {
          if (draw) ctx.fillText(l, x + 34 * k, y + i * 38 * k)
        }
        y += h + 30 * k
        break
      }
      case 'link': {
        ctx.font = font(500, 26 * k, UI.mono)
        const tw = ctx.measureText(b.label).width
        if (draw) {
          ctx.fillStyle = UI.accent
          ctx.fillText(b.label, x + 26 * k, y)
          ctx.fillText('→', x, y)
          ctx.fillStyle = UI.accentDim
          ctx.fillRect(x + 26 * k, y + 34 * k, tw, 1.5 * k)
        }
        links.push({
          id: `link:${b.href}`,
          href: b.href,
          x,
          y: y - 6 * k,
          w: tw + 26 * k,
          h: 44 * k,
        })
        y += 50 * k
        break
      }
      case 'photo': {
        const h = w * b.ratio
        const im = image(b.src)
        if (draw) {
          if (im) {
            // Кадр со сцены — широкий, и обрезать его по центру нельзя:
            // человек на нём стоит не по центру. Вписываем целиком.
            ctx.save()
            roundRect(ctx, x, y, w, h, 14 * k)
            ctx.clip()
            ctx.fillStyle = 'rgba(255,255,255,0.03)'
            ctx.fillRect(x, y, w, h)
            drawContain(ctx, im, x, y, w, h)
            ctx.restore()
            ctx.strokeStyle = UI.hair
            ctx.lineWidth = 1.2 * k
            roundRect(ctx, x, y, w, h, 14 * k)
            ctx.stroke()
          } else {
            placeholder(ctx, x, y, w, h)
          }
        }
        y += h
        if (b.caption) {
          y += 14 * k
          if (draw) {
            ctx.fillStyle = UI.faint
            ctx.font = font(400, 19 * k, UI.mono)
            ctx.fillText(b.caption, x, y)
          }
          y += 24 * k
        }
        y += 10 * k
        break
      }

      case 'shots': {
        if (openShot > 0) {
          // Раскрытый снимок: одна картинка во всю колонку и подпись.
          const shot = SHOTS[openShot - 1]
          const h = w * 0.62
          const im = shot ? image(shot.src) : null
          if (draw) {
            if (im) {
              ctx.save()
              roundRect(ctx, x, y, w, h, 14 * k)
              ctx.clip()
              ctx.fillStyle = 'rgba(0,0,0,0.35)'
              ctx.fillRect(x, y, w, h)
              drawContain(ctx, im, x, y, w, h)
              ctx.restore()
            } else {
              placeholder(ctx, x, y, w, h)
            }
            ctx.strokeStyle = UI.hair
            ctx.lineWidth = 1.2 * k
            roundRect(ctx, x, y, w, h, 14 * k)
            ctx.stroke()
          }
          // Область «назад к сетке» — весь снимок: второй клик возвращает.
          links.push({ id: 'shot:0', x, y, w, h, href: '' })
          y += h + 18 * k
          if (draw && shot) {
            ctx.fillStyle = UI.text
            ctx.font = font(600, 26 * k)
            ctx.fillText(shot.title, x, y)
            ctx.fillStyle = UI.dim
            ctx.font = font(400, 21 * k)
            ctx.fillText(shot.note, x, y + 34 * k)
            ctx.fillStyle = UI.faint
            ctx.font = font(400, 19 * k, UI.mono)
            ctx.fillText('click the shot to go back', x, y + 72 * k)
          }
          y += 104 * k
          break
        }

        // Сетка превью. Две колонки: снимки вытянутые, в три им тесно.
        const cols = w > 760 * k ? 3 : 2
        const gap = 20 * k
        const cw = (w - gap * (cols - 1)) / cols
        const ch = cw * 0.68
        SHOTS.forEach((shot, i) => {
          const cx = x + (i % cols) * (cw + gap)
          const cy = y + Math.floor(i / cols) * (ch + gap + 62 * k)
          const im = image(shot.src)
          if (draw) {
            if (im) {
              ctx.save()
              roundRect(ctx, cx, cy, cw, ch, 12 * k)
              ctx.clip()
              ctx.fillStyle = 'rgba(0,0,0,0.35)'
              ctx.fillRect(cx, cy, cw, ch)
              drawContain(ctx, im, cx, cy, cw, ch)
              ctx.restore()
            } else {
              placeholder(ctx, cx, cy, cw, ch)
            }
            ctx.strokeStyle = UI.hair
            ctx.lineWidth = 1.2 * k
            roundRect(ctx, cx, cy, cw, ch, 12 * k)
            ctx.stroke()
            ctx.fillStyle = UI.text
            ctx.font = font(600, 21 * k)
            for (const [li, line] of wrapLines(ctx, shot.title, cw).entries()) {
              if (li > 0) break
              ctx.fillText(line, cx, cy + ch + 16 * k)
            }
            ctx.fillStyle = UI.faint
            ctx.font = font(400, 18 * k, UI.mono)
            for (const [li, line] of wrapLines(ctx, shot.note, cw).entries()) {
              if (li > 0) break
              ctx.fillText(line, cx, cy + ch + 42 * k)
            }
          }
          links.push({ id: `shot:${i + 1}`, x: cx, y: cy, w: cw, h: ch, href: '' })
        })
        y += Math.ceil(SHOTS.length / cols) * (ch + gap + 62 * k)
        break
      }

      case 'rule': {
        y += 20 * k
        if (draw) {
          ctx.fillStyle = UI.hairSoft
          ctx.fillRect(x, y, w, 1)
        }
        y += 34 * k
        break
      }
      case 'gap': {
        y += (b.size ?? 26) * k
        break
      }
    }
  }
  return { height: y - y0, links, anchors }
}

interface CachedDoc {
  canvas: HTMLCanvasElement
  height: number
  links: (HitRegion & { href: string })[]
  anchors: { text: string; y: number }[]
}

const docCache = new Map<string, CachedDoc>()
const measureCtx = makeCanvas(4, 4).ctx

function renderDoc(key: string, blocks: Block[], w: number, k: number): CachedDoc {
  const id = `${key}@${Math.round(w)}@${k.toFixed(3)}`
  const hit = docCache.get(id)
  if (hit) return hit

  const measured = flow(measureCtx, blocks, 0, 0, w, k, false)
  const { canvas, ctx } = makeCanvas(w, Math.max(1, Math.ceil(measured.height)))
  const drawn = flow(ctx, blocks, 0, 0, w, k, true)
  const out: CachedDoc = {
    canvas,
    height: canvas.height,
    links: drawn.links,
    anchors: drawn.anchors,
  }
  docCache.set(id, out)
  return out
}

/* ------------------------------------------------------------------ */
/* Слайд деки                                                          */
/* ------------------------------------------------------------------ */

/**
 * Слайд рисуется в СВЕТЛОЙ палитре деки внутри тёмного окна: это не
 * приложение, а документ, открытый в приложении, и он имеет право на
 * собственную бумагу. Токены — из питч-деки VettaX (HANDOFF §3).
 */
function paintSlide(
  ctx: CanvasRenderingContext2D,
  s: Slide,
  index: number,
  x: number,
  y: number,
  w: number,
  h: number,
) {
  const c = w / 1148 // масштаб карточки относительно эталонной ширины

  ctx.save()
  roundRect(ctx, x, y, w, h, 10 * c)
  ctx.clip()
  ctx.fillStyle = UI.paper
  ctx.fillRect(x, y, w, h)
  dotGrid(ctx, x, y, w, h, 26 * c, 'rgba(22,22,22,0.07)', 1.1 * c)

  const pad = 74 * c
  ctx.textBaseline = 'top'
  ctx.textAlign = 'left'

  // кикер с оранжевой точкой
  ctx.fillStyle = UI.accent
  ctx.beginPath()
  ctx.arc(x + pad + 5 * c, y + pad + 11 * c, 5 * c, 0, Math.PI * 2)
  ctx.fill()
  ctx.font = font(600, 20 * c, UI.mono)
  ctx.fillStyle = UI.paperDim
  tracked(ctx, s.kicker.toUpperCase(), x + pad + 22 * c, y + pad, 3 * c)

  // номер слайда справа
  ctx.font = font(600, 20 * c, UI.mono)
  ctx.textAlign = 'right'
  ctx.fillStyle = UI.paperDim
  ctx.fillText(String(index + 1).padStart(2, '0'), x + w - pad, y + pad)
  ctx.textAlign = 'left'

  let cy = y + pad + 72 * c

  ctx.font = font(600, 58 * c)
  ctx.fillStyle = UI.paperInk
  for (const l of wrapLines(ctx, s.headline, w - pad * 2)) {
    ctx.fillText(l, x + pad, cy)
    cy += 70 * c
  }
  cy += 10 * c

  if (s.sub) {
    ctx.font = font(500, 30 * c)
    ctx.fillStyle = UI.accent
    ctx.fillText(s.sub, x + pad, cy)
    cy += 52 * c
  }

  if (s.body) {
    ctx.font = font(400, 27 * c)
    ctx.fillStyle = UI.paperDim
    for (const l of wrapLines(ctx, s.body, Math.min(w - pad * 2, 860 * c))) {
      ctx.fillText(l, x + pad, cy)
      cy += 40 * c
    }
    cy += 20 * c
  }

  if (s.numbered) {
    const colW = (w - pad * 2 - 56 * c) / 3
    for (const [i, item] of s.numbered.entries()) {
      const cx = x + pad + i * (colW + 28 * c)
      let iy = cy
      ctx.font = font(600, 22 * c, UI.mono)
      ctx.fillStyle = UI.accent
      ctx.fillText(item.n, cx, iy)
      iy += 38 * c
      ctx.font = font(600, 27 * c)
      ctx.fillStyle = UI.paperInk
      for (const l of wrapLines(ctx, item.title, colW)) {
        ctx.fillText(l, cx, iy)
        iy += 36 * c
      }
      iy += 8 * c
      ctx.font = font(400, 22 * c)
      ctx.fillStyle = UI.paperDim
      for (const l of wrapLines(ctx, item.text, colW)) {
        ctx.fillText(l, cx, iy)
        iy += 32 * c
      }
    }
    cy += 250 * c
  }

  if (s.metrics) {
    const colW = (w - pad * 2) / s.metrics.length
    // Кегль подбирается под самое длинное значение, а не назначается.
    // «+37,800%» в моноширинном 72 не влезал в свою колонку и наезжал
    // на «$202» — четыре числа превращались в кашу ровно на том слайде,
    // ради которого деку и открывают.
    let size = 72 * c
    ctx.font = font(600, size, UI.mono)
    let widest = 0
    for (const m of s.metrics) widest = Math.max(widest, ctx.measureText(m.value).width)
    const fits = colW - 24 * c
    if (widest > fits) size *= fits / widest
    for (const [i, m] of s.metrics.entries()) {
      const cx = x + pad + i * colW
      ctx.font = font(600, size, UI.mono)
      ctx.fillStyle = UI.paperInk
      ctx.fillText(m.value, cx, cy + (72 * c - size) * 0.8)
      ctx.font = font(400, 22 * c)
      ctx.fillStyle = UI.paperDim
      for (const [j, l] of wrapLines(ctx, m.label, colW - 16 * c).entries()) {
        ctx.fillText(l, cx, cy + 86 * c + j * 28 * c)
      }
    }
    cy += 150 * c
  }

  if (s.bullets) {
    ctx.font = font(400, 25 * c)
    for (const item of s.bullets) {
      const lines = wrapLines(ctx, item, w - pad * 2 - 30 * c)
      ctx.fillStyle = UI.accent
      ctx.fillRect(x + pad, cy + 12 * c, 10 * c, 3 * c)
      ctx.fillStyle = UI.paperInk
      for (const [i, l] of lines.entries()) ctx.fillText(l, x + pad + 30 * c, cy + i * 36 * c)
      cy += lines.length * 36 * c + 12 * c
    }
  }

  if (s.cta) {
    ctx.fillStyle = UI.paperInk
    ctx.font = font(600, 28 * c)
    const tw = ctx.measureText(s.cta).width
    roundRect(ctx, x + pad, cy, tw + 56 * c, 68 * c, 8 * c)
    ctx.fill()
    ctx.fillStyle = UI.paper
    ctx.fillText(s.cta, x + pad + 28 * c, cy + 20 * c)
    cy += 96 * c
  }

  // подвал: слова из деки + вордмарк
  if (s.foot) {
    ctx.font = font(400, 21 * c, UI.mono)
    ctx.fillStyle = UI.paperDim
    let fy = y + h - pad - s.foot.length * 30 * c
    for (const line of s.foot) {
      for (const l of wrapLines(ctx, line, w - pad * 2)) {
        ctx.fillText(l, x + pad, fy)
        fy += 30 * c
      }
    }
  }

  ctx.font = font(600, 20 * c)
  ctx.fillStyle = UI.paperDim
  ctx.textAlign = 'right'
  ctx.fillText('Vetta X', x + w - pad, y + h - pad - 6 * c)
  ctx.textAlign = 'left'

  ctx.restore()

  ctx.strokeStyle = UI.paperHair
  ctx.lineWidth = 1
  roundRect(ctx, x, y, w, h, 10 * c)
  ctx.stroke()
}

/* ------------------------------------------------------------------ */
/* Тетрис                                                              */
/* ------------------------------------------------------------------ */

/**
 * Игра — единственное приложение, которое перерисовывается не по действию
 * посетителя, а по времени, и делать это целым экраном нельзя: раскладка
 * документа считается заново, а меняются в ней два прямоугольника.
 * Поэтому полный проход отдаёт наружу их координаты, а между полными
 * проходами рисуются только они.
 */
export interface GameLayout {
  k: number
  cell: number
  well: { x: number; y: number; w: number; h: number }
  panel: { x: number; y: number; w: number; h: number }
}

/** Фон под карточкой скруглён, поэтому её угол обязан показывать то, что
 *  под ним: частичная перерисовка восстанавливает и фон, и виньетку —
 *  иначе кусок экрана посветлел бы после первого же хода. */
function inCard(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  k: number,
  r: { x: number; y: number; w: number; h: number },
  body: () => void,
) {
  ctx.save()
  ctx.beginPath()
  ctx.rect(r.x - 2, r.y - 2, r.w + 4, r.h + 4)
  ctx.clip()
  background(ctx, W, H, k)
  ctx.fillStyle = '#0a0d13'
  roundRect(ctx, r.x, r.y, r.w, r.h, 14 * k)
  ctx.fill()
  ctx.strokeStyle = UI.hair
  ctx.lineWidth = 1.4 * k
  roundRect(ctx, r.x, r.y, r.w, r.h, 14 * k)
  ctx.stroke()
  body()
  panelVignette(ctx, W, H)
  ctx.restore()
}

/** Фигуры для превью: те же клетки, но прижатые к нулю, чтобы коробка
 *  превью не наследовала пустые ряды бокса SRS. */
const NEXT_SHAPE: Record<string, Point[]> = {
  I: [[0, 0], [1, 0], [2, 0], [3, 0]],
  J: [[0, 0], [0, 1], [1, 1], [2, 1]],
  L: [[2, 0], [0, 1], [1, 1], [2, 1]],
  O: [[0, 0], [1, 0], [0, 1], [1, 1]],
  S: [[1, 0], [2, 0], [0, 1], [1, 1]],
  T: [[1, 0], [0, 1], [1, 1], [2, 1]],
  Z: [[0, 0], [1, 0], [1, 1], [2, 1]],
}

/** Клетка стакана. Светлая грань сверху — единственная объёмная деталь:
 *  плоские квадраты на тёмном фоне сливаются в пятно, когда их двадцать. */
function block(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  color: string,
) {
  const p = Math.max(1, size * 0.06)
  const s = size - p * 2
  ctx.fillStyle = color
  roundRect(ctx, x + p, y + p, s, s, size * 0.14)
  ctx.fill()
  ctx.fillStyle = 'rgba(255,255,255,0.16)'
  ctx.fillRect(x + p + s * 0.16, y + p + s * 0.12, s * 0.68, Math.max(1, s * 0.1))
}

function drawWell(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  lay: GameLayout,
  view: TetrisView,
) {
  const { well, cell, k } = lay
  inCard(ctx, W, H, k, well, () => {
    // Те же точки, что на рабочем столе: игра — приложение этой системы,
    // а не чужое окно, приехавшее со стороны.
    dotGrid(ctx, well.x, well.y, well.w, well.h, cell, 'rgba(255,255,255,0.05)', 1.2 * k)

    const at = (p: Point) => ({ x: well.x + p[0] * cell, y: well.y + p[1] * cell })

    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const id = view.grid[r][c]
        if (id) block(ctx, well.x + c * cell, well.y + r * cell, cell, PIECE[id])
      }
    }

    // Тень фигуры. На мониторе внутри 3D-сцены глубина читается хуже, чем
    // на плоском экране, и без тени промахи выглядят несправедливыми.
    if (view.active) {
      ctx.strokeStyle = 'rgba(255,255,255,0.22)'
      ctx.lineWidth = Math.max(1, cell * 0.055)
      for (const p of view.ghost) {
        if (p[1] < 0) continue
        const { x, y } = at(p)
        roundRect(ctx, x + cell * 0.1, y + cell * 0.1, cell * 0.8, cell * 0.8, cell * 0.12)
        ctx.stroke()
      }
      for (const p of view.active.cells) {
        // Отталкивание умеет вытолкнуть фигуру выше кромки — рисуем только
        // то, что внутри стакана.
        if (p[1] < 0) continue
        const { x, y } = at(p)
        block(ctx, x, y, cell, PIECE[view.active.id])
      }
    }

    if (view.phase !== 'playing') {
      ctx.fillStyle = 'rgba(10,13,19,0.82)'
      roundRect(ctx, well.x, well.y, well.w, well.h, 14 * k)
      ctx.fill()
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      const cx = well.x + well.w / 2
      const cy = well.y + well.h / 2
      if (view.phase === 'over') {
        ctx.fillStyle = UI.text
        ctx.font = font(600, 40 * k)
        ctx.fillText('game over', cx, cy - 46 * k)
        ctx.fillStyle = UI.accent
        ctx.font = font(600, 54 * k, UI.mono)
        ctx.fillText(fmt(view.score), cx, cy + 10 * k)
        ctx.fillStyle = UI.dim
        ctx.font = font(400, 21 * k, UI.mono)
        ctx.fillText(view.score >= view.best ? 'your best' : `your best ${fmt(view.best)}`, cx, cy + 52 * k)
        ctx.fillText('space to play again', cx, cy + 92 * k)
      } else {
        ctx.fillStyle = UI.text
        ctx.font = font(600, 36 * k)
        ctx.fillText('tetris', cx, cy - 26 * k)
        ctx.fillStyle = UI.dim
        ctx.font = font(400, 22 * k, UI.mono)
        ctx.fillText('space to start', cx, cy + 22 * k)
      }
      ctx.textAlign = 'left'
      ctx.textBaseline = 'top'
    }
  })
}

function drawPanel(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  lay: GameLayout,
  view: TetrisView,
) {
  const { panel, k } = lay
  inCard(ctx, W, H, k, panel, () => {
    const pad = 28 * k
    let y = panel.y + pad
    ctx.textAlign = 'left'
    ctx.textBaseline = 'top'

    ctx.fillStyle = UI.accent
    ctx.font = font(600, 18 * k, UI.mono)
    tracked(ctx, 'NEXT', panel.x + pad, y, 3 * k)
    y += 34 * k

    // Превью следующей фигуры в собственной клетке: тот же размер, что в
    // стакане, был бы шире панели у горизонтальной I.
    const nc = lay.cell * 0.62
    const cells = NEXT_SHAPE[view.next]
    const bw = (Math.max(...cells.map((p) => p[0])) + 1) * nc
    const bh = (Math.max(...cells.map((p) => p[1])) + 1) * nc
    const bx = panel.x + panel.w / 2 - bw / 2
    const by = y + (nc * 2.2 - bh) / 2
    for (const [cx, cy] of cells) block(ctx, bx + cx * nc, by + cy * nc, nc, PIECE[view.next])
    y += nc * 2.2 + 26 * k

    ctx.fillStyle = UI.hairSoft
    ctx.fillRect(panel.x + pad, y, panel.w - pad * 2, 1)
    y += 26 * k

    for (const [value, label] of [
      [fmt(view.score), 'score'],
      [String(view.level), 'level'],
      [String(view.lines), 'lines'],
      [fmt(view.best), 'your best'],
    ] as const) {
      ctx.fillStyle = UI.text
      ctx.font = font(600, 30 * k, UI.mono)
      ctx.fillText(value, panel.x + pad, y)
      ctx.fillStyle = UI.dim
      ctx.font = font(400, 19 * k)
      ctx.fillText(label, panel.x + pad, y + 34 * k)
      y += 66 * k
    }
  })
}

/** Перерисовка между полными: только стакан и панель со счётом. */
export function paintGameFrame(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  lay: GameLayout,
  view: TetrisView,
) {
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  drawWell(ctx, W, H, lay, view)
  drawPanel(ctx, W, H, lay, view)
}

function paintGameApp(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  k: number,
  state: SurfaceState,
  bodyTop: number,
  hits: HitRegion[],
): GameLayout {
  const view = state.game!
  const pad = 34 * k
  const gap = 52 * k
  const panelW = 300 * k
  const legendW = 340 * k
  const wide = W / H > 2

  // Клетка считается от того, сколько ОСТАЛОСЬ по высоте после строки
  // заголовка, а не наоборот: стакан всегда 10 × 20, и это высота решает,
  // каким он выйдет. Ширины на ультрашироком экране заведомо хватает,
  // но проверить дешевле, чем однажды выехать за край на ноутбуке.
  let cell = Math.floor((H - bodyTop - pad * 2) / ROWS)
  const around = panelW + gap + (wide ? legendW + gap : 0)
  cell = Math.min(cell, Math.floor((W - pad * 2 - around) / COLS))

  const wellW = cell * COLS
  const wellH = cell * ROWS
  const clusterW = (wide ? legendW + gap : 0) + wellW + gap + panelW
  const x0 = (W - clusterW) / 2
  const y0 = bodyTop + (H - bodyTop - wellH) / 2

  const lay: GameLayout = {
    k,
    cell,
    well: { x: x0 + (wide ? legendW + gap : 0), y: y0, w: wellW, h: wellH },
    panel: { x: x0 + clusterW - panelW, y: y0, w: panelW, h: wellH },
  }

  if (wide) {
    ctx.textAlign = 'left'
    ctx.textBaseline = 'top'
    let y = y0 + 6 * k
    ctx.fillStyle = UI.accent
    ctx.font = font(600, 18 * k, UI.mono)
    tracked(ctx, 'CONTROLS', x0, y, 3 * k)
    y += 40 * k
    for (const [keyName, what] of [
      ['← →', 'move'],
      ['↓', 'soft drop'],
      ['↑', 'rotate'],
      ['space', 'hard drop'],
      ['esc', 'back to desktop'],
    ] as const) {
      ctx.fillStyle = UI.text
      ctx.font = font(500, 22 * k, UI.mono)
      ctx.fillText(keyName, x0, y)
      ctx.fillStyle = UI.dim
      ctx.font = font(400, 21 * k)
      ctx.fillText(what, x0 + 110 * k, y + 1 * k)
      y += 38 * k
    }
    y += 22 * k
    ctx.fillStyle = UI.faint
    ctx.font = font(400, 19 * k)
    for (const line of wrapLines(
      ctx,
      'Leaving this screen pauses the game — the piece waits where you left it. The record lives in this browser and nowhere else.',
      legendW,
    )) {
      ctx.fillText(line, x0, y)
      y += 27 * k
    }
  }

  // Виньетка кладётся ДО карточек, а не после всего окна: карточки
  // накладывают её сами при каждой частичной перерисовке, и обратный
  // порядок дал бы им один цвет до первого хода и другой после.
  panelVignette(ctx, W, H)
  drawWell(ctx, W, H, lay, view)
  drawPanel(ctx, W, H, lay, view)

  // Мышью тоже можно начать: посетитель приезжает сюда кликом, и требовать
  // от него клавиатуру ровно в тот момент, когда он ещё ничего не нажимал,
  // значит потерять половину.
  if (view.phase !== 'playing') {
    hits.push({ id: 'game:start', x: lay.well.x, y: lay.well.y, w: lay.well.w, h: lay.well.h })
  }
  return lay
}

/* ------------------------------------------------------------------ */
/* Окно приложения                                                     */
/* ------------------------------------------------------------------ */

function titlebar(
  ctx: CanvasRenderingContext2D,
  W: number,
  k: number,
  title: string,
  hits: HitRegion[],
  hover: string | null,
): number {
  const h = 62 * k
  ctx.fillStyle = 'rgba(255,255,255,0.04)'
  ctx.fillRect(0, 0, W, h)
  ctx.fillStyle = UI.hairSoft
  ctx.fillRect(0, h - 1, W, 1)

  // Светофор. Красный кружок — настоящая кнопка: он и закрывает окно.
  const r = 9 * k
  const cy = h / 2
  const closeHovered = hover === 'close'
  const dots: [number, string][] = [
    [34 * k, closeHovered ? '#ff7a68' : '#e8654a'],
    [64 * k, 'rgba(255,255,255,0.18)'],
    [94 * k, 'rgba(255,255,255,0.18)'],
  ]
  for (const [cx, color] of dots) {
    ctx.fillStyle = color
    ctx.beginPath()
    ctx.arc(cx, cy, r, 0, Math.PI * 2)
    ctx.fill()
  }
  if (closeHovered) {
    ctx.strokeStyle = 'rgba(0,0,0,0.55)'
    ctx.lineWidth = 2 * k
    ctx.beginPath()
    ctx.moveTo(34 * k - 4 * k, cy - 4 * k)
    ctx.lineTo(34 * k + 4 * k, cy + 4 * k)
    ctx.moveTo(34 * k + 4 * k, cy - 4 * k)
    ctx.lineTo(34 * k - 4 * k, cy + 4 * k)
    ctx.stroke()
  }
  hits.push({ id: 'close', x: 14 * k, y: 0, w: 60 * k, h })

  ctx.textBaseline = 'middle'
  ctx.textAlign = 'center'
  ctx.fillStyle = UI.dim
  ctx.font = font(500, 22 * k, UI.mono)
  ctx.fillText(title, W / 2, cy + 1)

  ctx.textAlign = 'right'
  ctx.fillStyle = UI.faint
  ctx.font = font(400, 19 * k, UI.mono)
  ctx.fillText('esc  ·  back to desktop', W - 28 * k, cy + 1)
  ctx.textAlign = 'left'
  return h
}

function scrollbar(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  h: number,
  k: number,
  scroll: number,
  scrollMax: number,
  viewH: number,
) {
  if (scrollMax <= 0) return
  ctx.fillStyle = 'rgba(255,255,255,0.05)'
  roundRect(ctx, x, y, 5 * k, h, 3 * k)
  ctx.fill()
  const thumb = Math.max(60 * k, (viewH / (viewH + scrollMax)) * h)
  const t = y + (scroll / scrollMax) * (h - thumb)
  ctx.fillStyle = UI.accentDim
  roundRect(ctx, x, t, 5 * k, thumb, 3 * k)
  ctx.fill()
}

function paintDeckApp(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  k: number,
  state: SurfaceState,
  bodyTop: number,
  hits: HitRegion[],
) {
  const wide = W / H > 2
  const pad = 44 * k
  const railW = wide ? 320 * k : 0
  const areaX = pad + (wide ? railW + 40 * k : 0)
  const areaW = W - areaX - pad
  const navH = 66 * k
  const availH = H - bodyTop - pad * 2 - navH

  let cardW = Math.min(areaW, (availH * 16) / 9)
  let cardH = (cardW * 9) / 16
  if (cardH > availH) {
    cardH = availH
    cardW = (cardH * 16) / 9
  }
  const cardX = areaX + (areaW - cardW) / 2
  const cardY = bodyTop + pad

  const i = Math.min(Math.max(state.slide, 0), DECK.length - 1)
  paintSlide(ctx, DECK[i], i, cardX, cardY, cardW, cardH)

  // Боковая колонка со списком слайдов: на ультрашироком экране справа
  // и слева от карточки 16:9 остаётся пустое поле — оно должно работать,
  // а не просто быть чёрным.
  if (wide) {
    ctx.textBaseline = 'top'
    ctx.font = font(600, 19 * k, UI.mono)
    ctx.fillStyle = UI.accent
    tracked(ctx, 'SLIDES', pad, bodyTop + pad + 6 * k, 3 * k)
    let y = bodyTop + pad + 52 * k
    DECK_INDEX.forEach((name, idx) => {
      const on = idx === i
      const hovered = state.hover === `deck:go:${idx}`
      if (on || hovered) {
        ctx.fillStyle = on ? UI.accentWash : 'rgba(255,255,255,0.05)'
        roundRect(ctx, pad - 12 * k, y - 8 * k, railW, 46 * k, 8 * k)
        ctx.fill()
      }
      ctx.font = font(400, 19 * k, UI.mono)
      ctx.fillStyle = on ? UI.accent : UI.faint
      ctx.fillText(String(idx + 1).padStart(2, '0'), pad, y + 4 * k)
      ctx.font = font(on ? 600 : 400, 24 * k)
      ctx.fillStyle = on ? UI.text : UI.dim
      ctx.fillText(name, pad + 42 * k, y)
      hits.push({ id: `deck:go:${idx}`, x: pad - 12 * k, y: y - 8 * k, w: railW, h: 46 * k })
      y += 52 * k
    })
  }

  // навигация под карточкой
  const navY = cardY + cardH + 22 * k
  const btn = (id: string, label: string, bx: number) => {
    const w = 118 * k
    const hovered = state.hover === id
    ctx.fillStyle = hovered ? UI.accentWash : 'rgba(255,255,255,0.05)'
    roundRect(ctx, bx, navY, w, 44 * k, 8 * k)
    ctx.fill()
    ctx.strokeStyle = hovered ? UI.accent : UI.hair
    ctx.lineWidth = 1.3 * k
    roundRect(ctx, bx, navY, w, 44 * k, 8 * k)
    ctx.stroke()
    ctx.fillStyle = hovered ? UI.accent : UI.dim
    ctx.font = font(500, 21 * k, UI.mono)
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(label, bx + w / 2, navY + 22 * k)
    ctx.textAlign = 'left'
    ctx.textBaseline = 'top'
    hits.push({ id, x: bx, y: navY, w, h: 44 * k })
  }
  btn('deck:prev', '← prev', cardX)
  btn('deck:next', 'next →', cardX + cardW - 118 * k)

  // точки-индикаторы
  const dotY = navY + 22 * k
  const dw = 18 * k
  const startX = cardX + cardW / 2 - ((DECK.length - 1) * dw) / 2
  DECK.forEach((_, idx) => {
    ctx.fillStyle = idx === i ? UI.accent : 'rgba(255,255,255,0.2)'
    ctx.beginPath()
    ctx.arc(startX + idx * dw, dotY, idx === i ? 5 * k : 3.5 * k, 0, Math.PI * 2)
    ctx.fill()
    if (!wide) hits.push({ id: `deck:go:${idx}`, x: startX + idx * dw - 9 * k, y: dotY - 14 * k, w: 18 * k, h: 28 * k })
  })
}

function paintApp(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  k: number,
  state: SurfaceState,
): PaintResult {
  const hits: HitRegion[] = []
  const app = APPS.find((a) => a.id === state.appId)
  background(ctx, W, H, k)
  const barH = titlebar(ctx, W, k, app?.title ?? '', hits, state.hover)

  if (state.appId === 'deck') {
    paintDeckApp(ctx, W, H, k, state, barH, hits)
    panelVignette(ctx, W, H)
    return { hits, scrollMax: 0 }
  }

  // Игра — не документ: у неё своя раскладка и свои прямоугольники, и в
  // поток блоков её не уложить. Дека решается тем же способом и по той же
  // причине; общего у них ровно строка заголовка.
  if (state.appId === 'tetris' && state.game) {
    return { hits, scrollMax: 0, layout: paintGameApp(ctx, W, H, k, state, barH, hits) }
  }

  const doc: Doc = getDoc(state.appId ?? '') ?? { body: [] }
  const wide = W / H > 2
  const padX = 72 * k
  const padY = 46 * k
  const bodyY = barH + padY
  const viewH = H - bodyY - padY
  const bodyW = W - padX * 2

  const asideW = wide && doc.aside ? 520 * k : 0
  const gap = asideW ? 84 * k : 0
  const colW = Math.min(1000 * k, bodyW - asideW - gap)
  const totalW = colW + gap + asideW
  const colX = padX + Math.max(0, (bodyW - totalW) / 2)

  // Узкому экрану боковая колонка не по карману — её блоки просто
  // дописываются в конец потока, а не сжимаются до нечитаемого.
  const blocks = asideW ? doc.body : [...doc.body, ...(doc.aside ?? [])]
  // Раскрытый снимок галереи меняет саму раскладку документа, поэтому он
  // обязан попасть в ключ кэша — иначе сетка и раскрытый кадр делили бы
  // один нарисованный холст.
  openShot = state.appId === 'gallery' ? state.slide : 0
  const rendered = renderDoc(
    `${state.appId}${asideW ? '-w' : '-n'}${openShot ? `-s${openShot}` : ''}`,
    blocks,
    colW,
    k,
  )

  const scrollMax = Math.max(0, rendered.height - viewH)
  const scroll = Math.min(Math.max(state.scroll, 0), scrollMax)

  const visH = Math.min(viewH, rendered.height)
  ctx.drawImage(rendered.canvas, 0, scroll, colW, visH, colX, bodyY, colW, visH)

  for (const l of rendered.links) {
    const y = bodyY + l.y - scroll
    if (y + l.h < bodyY || y > bodyY + viewH) continue
    hits.push({ id: l.id, x: colX + l.x, y, w: l.w, h: l.h })
  }

  // Плавное затухание текста у верхней и нижней кромки: обрезанная
  // на полуслове строка читается как баг, растворённая — как скролл.
  if (scrollMax > 0) {
    const fadeTop = ctx.createLinearGradient(0, bodyY, 0, bodyY + 40 * k)
    fadeTop.addColorStop(0, 'rgba(11,14,19,0.95)')
    fadeTop.addColorStop(1, 'rgba(11,14,19,0)')
    ctx.fillStyle = fadeTop
    ctx.fillRect(colX, bodyY, colW, 40 * k)
    const fadeBot = ctx.createLinearGradient(0, bodyY + viewH - 56 * k, 0, bodyY + viewH)
    fadeBot.addColorStop(0, 'rgba(11,14,19,0)')
    fadeBot.addColorStop(1, 'rgba(11,14,19,0.95)')
    ctx.fillStyle = fadeBot
    ctx.fillRect(colX, bodyY + viewH - 56 * k, colW, 56 * k)
    scrollbar(ctx, colX + colW + 22 * k, bodyY, viewH, k, scroll, scrollMax, viewH)
  }

  // Оглавление вместо пустоты. У документа без боковой колонки на
  // ультрашироком экране справа остаётся поле шириной с сам текст —
  // пусть оно навигирует, а не пустует.
  if (wide && !asideW && rendered.anchors.length > 1) {
    const tx = colX + colW + 96 * k
    ctx.textBaseline = 'top'
    ctx.textAlign = 'left'
    ctx.fillStyle = UI.accent
    ctx.font = font(600, 19 * k, UI.mono)
    tracked(ctx, 'CONTENTS', tx, bodyY + 6 * k, 3 * k)
    let ty = bodyY + 52 * k
    rendered.anchors.forEach((a, i) => {
      const target = Math.max(0, Math.round(a.y - 16 * k))
      const id = `scrollto:${target}`
      const on = scroll >= target - 8 * k && (i === rendered.anchors.length - 1 || scroll < Math.round(rendered.anchors[i + 1].y - 24 * k))
      const hovered = state.hover === id
      if (on || hovered) {
        ctx.fillStyle = on ? UI.accentWash : 'rgba(255,255,255,0.05)'
        roundRect(ctx, tx - 14 * k, ty - 8 * k, 380 * k, 46 * k, 8 * k)
        ctx.fill()
      }
      ctx.font = font(400, 18 * k, UI.mono)
      ctx.fillStyle = on ? UI.accent : UI.faint
      ctx.fillText(String(i + 1).padStart(2, '0'), tx, ty + 5 * k)
      ctx.font = font(on ? 600 : 400, 24 * k)
      ctx.fillStyle = on ? UI.text : UI.dim
      ctx.fillText(a.text, tx + 42 * k, ty)
      hits.push({ id, x: tx - 14 * k, y: ty - 8 * k, w: 380 * k, h: 46 * k })
      ty += 52 * k
    })
  }

  if (asideW && doc.aside) {
    const ax = colX + colW + gap
    ctx.fillStyle = 'rgba(255,255,255,0.028)'
    roundRect(ctx, ax - 30 * k, bodyY - 22 * k, asideW + 52 * k, viewH + 44 * k, 16 * k)
    ctx.fill()
    ctx.strokeStyle = UI.hairSoft
    ctx.lineWidth = 1.2 * k
    roundRect(ctx, ax - 30 * k, bodyY - 22 * k, asideW + 52 * k, viewH + 44 * k, 16 * k)
    ctx.stroke()
    const rendered2 = renderDoc(`${state.appId}-aside`, doc.aside, asideW, k)
    const h = Math.min(viewH, rendered2.height)
    ctx.drawImage(rendered2.canvas, 0, 0, asideW, h, ax, bodyY, asideW, h)
    for (const l of rendered2.links) {
      if (l.y + l.h > viewH) continue
      hits.push({ id: l.id, x: ax + l.x, y: bodyY + l.y, w: l.w, h: l.h })
    }
  }

  panelVignette(ctx, W, H)
  return { hits, scrollMax }
}

/* ------------------------------------------------------------------ */

export function paintSurface(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  state: SurfaceState,
): PaintResult {
  const k = H / BASE_H
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.clearRect(0, 0, W, H)
  return state.view === 'app' && state.appId
    ? paintApp(ctx, W, H, k, state)
    : paintDesktop(ctx, W, H, k, state)
}
