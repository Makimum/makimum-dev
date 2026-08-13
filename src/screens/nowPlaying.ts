import { UI, font, roundRect, tracked, trackedWidth } from './theme'
import type { HitRegion } from './paint'

/**
 * Экран планшета: музыка, которая сейчас играет.
 *
 * ЧТО ЗДЕСЬ ФАКТ, А ЧТО НЕТ. Что слушает Максим — это факт о живом
 * человеке, и по правилу проекта он не выдумывается. Поэтому на экране
 * стоит то, в чём нет ни одного неверного утверждения: пластинка самой
 * этой комнаты. «This Room» — она и есть эта комната; автор — он;
 * альбом — этот сайт. Шутка сайта про самого себя, а не приписанный
 * человеку чужой трек.
 *
 * Заменить на настоящий — одна константа ниже. Всё остальное, включая
 * обложку, пересоберётся само: обложка выводится ИЗ НАЗВАНИЯ.
 *
 * ЛОГОТИП SPOTIFY НЕ РИСУЕТСЯ. Интерфейс собран в узнаваемом языке
 * приложения — тёмный фон, зелёный акцент, квадратная обложка, дорожка
 * прогресса, ряд транспортных кнопок, — но товарный знак не
 * воспроизводится. Узнаваемость даёт раскладка, а не значок, а чужая
 * марка на витрине собственного портфолио — лишний разговор.
 */

/** Строка списка. Тот же набор полей, что отдаёт функция Pages. */
export interface Song {
  title: string
  artist: string
  album: string
  durationSec: number
  url: string
}

export interface Track {
  title: string
  artist: string
  album: string
  /** Длительность, секунды. */
  seconds: number
  /** Откуда играет — строка над обложкой. */
  source: string
}

export const NOW_PLAYING: Track = {
  title: 'This Room',
  artist: 'Maxim Fursov',
  album: 'makimum.dev',
  seconds: 222,
  source: 'makimum.dev',
}

/** Зелёный Spotify. Взят как цвет, а не как знак: в интерфейсе он
 *  означает «это играет», и заменять его на оранжевый акцент комнаты
 *  нельзя — оранжевый здесь уже занят айдентикой деки. */
const PLAY = '#1ed760'

/* ------------------------------------------------------------------ */
/* Обложка                                                             */
/* ------------------------------------------------------------------ */

/** Детерминированный хеш строки. Одно и то же название — одна и та же
 *  обложка при каждой загрузке; иначе картинка бы «дышала» между
 *  перерисовками. */
function hash(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/**
 * Обложка альбома — процедурная, как и всё в этой комнате.
 *
 * Скачанной картинки здесь нет и не будет: «ноль внешних ассетов»
 * заявлено на самом сайте. Мотив выводится из названия трека — два тона
 * по кругу от одного хеша, косая заливка и дуга, уходящая за край.
 * Так обложка меняется вместе с треком и не требует ни байта ассетов.
 */
export function paintCover(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  seed: string,
) {
  const n = hash(seed)
  const hue = n % 360
  // Второй тон не случайный, а на треть круга дальше: две произвольные
  // краски рядом дают грязь, а треть круга — это всегда пара.
  const hue2 = (hue + 118) % 360

  ctx.save()
  roundRect(ctx, x, y, size, size, size * 0.018)
  ctx.clip()

  const g = ctx.createLinearGradient(x, y, x + size, y + size)
  g.addColorStop(0, `hsl(${hue} 62% 26%)`)
  g.addColorStop(1, `hsl(${hue2} 54% 12%)`)
  ctx.fillStyle = g
  ctx.fillRect(x, y, size, size)

  // Дуга, уходящая за край: центр вынесен наружу кадра, поэтому в
  // обложке видно её часть — приём с настоящих конвертов.
  const cx = x + size * (0.22 + ((n >> 8) & 15) / 60)
  const cy = y + size * (0.78 - ((n >> 12) & 15) / 70)
  const r = size * (0.52 + ((n >> 16) & 7) / 30)
  ctx.globalAlpha = 0.5
  ctx.fillStyle = `hsl(${hue2} 66% 58%)`
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, Math.PI * 2)
  ctx.fill()
  ctx.globalAlpha = 1

  // Тонкие линии поперёк — от них плоская заливка перестаёт быть заливкой.
  ctx.strokeStyle = 'rgba(255,255,255,0.10)'
  ctx.lineWidth = Math.max(1, size * 0.004)
  for (let i = 1; i < 6; i++) {
    const t = i / 6
    ctx.beginPath()
    ctx.moveTo(x, y + size * t)
    ctx.lineTo(x + size, y + size * (t - 0.16))
    ctx.stroke()
  }

  // Затемнение к низу: под обложкой идёт название, и без него текст
  // спорит с картинкой за внимание.
  const shade = ctx.createLinearGradient(x, y + size * 0.55, x, y + size)
  shade.addColorStop(0, 'rgba(0,0,0,0)')
  shade.addColorStop(1, 'rgba(0,0,0,0.35)')
  ctx.fillStyle = shade
  ctx.fillRect(x, y + size * 0.55, size, size * 0.45)

  ctx.restore()
}

/* ------------------------------------------------------------------ */
/* Раскладка                                                           */
/* ------------------------------------------------------------------ */

/** Полоса, которую перерисовывает секундный тик: дорожка и таймеры.
 *  Всё остальное на экране за секунду не меняется. */
export interface ProgressBand {
  y: number
  h: number
}

/**
 * Написать строку, ужав кегль, пока она не влезет, и обрезав многоточием,
 * если ужимать дальше некуда.
 *
 * Порог 0.62 от исходного кегля выбран не наугад: ниже него название
 * перестаёт быть заголовком экрана и начинает читаться как подпись, а
 * иерархия «название крупно, исполнитель мельче» рассыпается.
 */
function fitText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxW: number,
  size: number,
  weight: number,
  colour: string,
) {
  ctx.fillStyle = colour
  let s = size
  ctx.font = font(weight, s, UI.sans)
  while (ctx.measureText(text).width > maxW && s > size * 0.62) {
    s -= size * 0.04
    ctx.font = font(weight, s, UI.sans)
  }
  let out = text
  if (ctx.measureText(out).width > maxW) {
    while (out.length > 1 && ctx.measureText(out + '…').width > maxW) out = out.slice(0, -1)
    out += '…'
  }
  ctx.fillText(out, x, y)
}

const mmss = (s: number) => {
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  return `${m}:${sec.toString().padStart(2, '0')}`
}

function icon(
  ctx: CanvasRenderingContext2D,
  kind: 'prev' | 'next' | 'pause' | 'play' | 'shuffle' | 'repeat',
  cx: number,
  cy: number,
  r: number,
  colour: string,
) {
  ctx.save()
  ctx.fillStyle = colour
  ctx.strokeStyle = colour
  ctx.lineWidth = Math.max(1.5, r * 0.16)
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'

  if (kind === 'pause') {
    const w = r * 0.28
    ctx.fillRect(cx - r * 0.42, cy - r * 0.6, w, r * 1.2)
    ctx.fillRect(cx + r * 0.14, cy - r * 0.6, w, r * 1.2)
  } else if (kind === 'play') {
    // Треугольник сдвинут вправо на десятую радиуса: у равностороннего
    // треугольника центр тяжести не совпадает с геометрическим центром,
    // и без сдвига он выглядит прижатым к левому краю круга.
    ctx.beginPath()
    ctx.moveTo(cx - r * 0.36 + r * 0.1, cy - r * 0.62)
    ctx.lineTo(cx + r * 0.62 + r * 0.1, cy)
    ctx.lineTo(cx - r * 0.36 + r * 0.1, cy + r * 0.62)
    ctx.closePath()
    ctx.fill()
  } else if (kind === 'prev' || kind === 'next') {
    const s = kind === 'next' ? 1 : -1
    // Два треугольника и планка — знак, который читается даже в 20 px.
    for (const off of [-0.45, 0.15]) {
      ctx.beginPath()
      ctx.moveTo(cx + s * (off * r), cy - r * 0.55)
      ctx.lineTo(cx + s * (off * r + r * 0.62), cy)
      ctx.lineTo(cx + s * (off * r), cy + r * 0.55)
      ctx.closePath()
      ctx.fill()
    }
    ctx.fillRect(cx + s * r * 0.78, cy - r * 0.55, s * r * 0.16, r * 1.1)
  } else if (kind === 'shuffle' || kind === 'repeat') {
    // Две стрелки: у перемешивания они скрещены, у повтора замкнуты в
    // кольцо. Разница читается силуэтом, а не деталями.
    ctx.beginPath()
    if (kind === 'shuffle') {
      ctx.moveTo(cx - r * 0.7, cy - r * 0.4)
      ctx.lineTo(cx - r * 0.2, cy - r * 0.4)
      ctx.lineTo(cx + r * 0.45, cy + r * 0.4)
      ctx.moveTo(cx - r * 0.7, cy + r * 0.4)
      ctx.lineTo(cx - r * 0.2, cy + r * 0.4)
      ctx.lineTo(cx + r * 0.45, cy - r * 0.4)
    } else {
      ctx.moveTo(cx - r * 0.55, cy + r * 0.35)
      ctx.lineTo(cx - r * 0.55, cy - r * 0.15)
      ctx.lineTo(cx + r * 0.55, cy - r * 0.15)
      ctx.moveTo(cx + r * 0.55, cy - r * 0.35)
      ctx.lineTo(cx + r * 0.55, cy + r * 0.15)
      ctx.lineTo(cx - r * 0.55, cy + r * 0.15)
    }
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(cx + r * 0.45, cy - r * 0.62)
    ctx.lineTo(cx + r * 0.72, cy - r * 0.36)
    ctx.lineTo(cx + r * 0.42, cy - r * 0.12)
    ctx.closePath()
    ctx.fill()
  }
  ctx.restore()
}

/**
 * Дорожка и таймеры. Отдельной функцией, потому что это единственное,
 * что меняется каждую секунду: перерисовывать ради бегущей головки весь
 * холст 820 × 1180 — та же ошибка, что была бы у тетриса, если бы он
 * перерисовывал окно ради одной сдвинувшейся фигуры.
 */
export function paintProgress(
  ctx: CanvasRenderingContext2D,
  W: number,
  band: ProgressBand,
  background: CanvasGradient | string,
  track: Track,
  elapsed: number,
  playing = true,
) {
  const pad = W * 0.085
  ctx.save()
  // Фон перекладывается тем же градиентом, что и весь экран: он задан на
  // всю высоту, поэтому кусок из него совпадает с тем, что было.
  ctx.fillStyle = background
  ctx.fillRect(0, band.y, W, band.h)

  const barY = band.y + band.h * 0.30
  const barH = Math.max(3, W * 0.007)
  const barW = W - pad * 2
  const t = Math.min(1, Math.max(0, elapsed / track.seconds))

  ctx.fillStyle = 'rgba(255,255,255,0.22)'
  roundRect(ctx, pad, barY, barW, barH, barH / 2)
  ctx.fill()
  ctx.fillStyle = UI.text
  roundRect(ctx, pad, barY, Math.max(barH, barW * t), barH, barH / 2)
  ctx.fill()
  // Головка появляется только на воспроизведении — на паузе её и в
  // приложении нет, пока не тронешь дорожку.
  if (playing) {
    ctx.beginPath()
    ctx.arc(pad + barW * t, barY + barH / 2, barH * 1.7, 0, Math.PI * 2)
    ctx.fillStyle = UI.text
    ctx.fill()
  }

  ctx.font = font(500, W * 0.026, UI.sans)
  ctx.fillStyle = UI.dim
  ctx.textBaseline = 'top'
  ctx.textAlign = 'left'
  ctx.fillText(mmss(elapsed), pad, barY + barH + W * 0.022)
  ctx.textAlign = 'right'
  ctx.fillText(`-${mmss(Math.max(0, track.seconds - elapsed))}`, W - pad, barY + barH + W * 0.022)
  ctx.restore()
}

/**
 * Весь экран целиком. Возвращает полосу прогресса и градиент фона —
 * их берёт секундная дорисовка, чтобы не собирать их заново.
 */
export function paintNowPlaying(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  track: Track,
  elapsed: number,
  clock: string,
  playing = true,
  interactive = false,
): { band: ProgressBand; background: CanvasGradient; hits: HitRegion[] } {
  const pad = W * 0.085
  // Области попадания собираются ТУТ ЖЕ, где рисуется. Это то же правило,
  // что у монитора: прямоугольник для клика приходит из кода, который
  // нарисовал пиксели, и разъехаться с ними не может.
  const hits: HitRegion[] = []

  // Фон приложения тянется от тона обложки к почти чёрному — так же,
  // как в самом приложении: экран продолжает картинку, а не лежит под ней.
  const hue = hash(track.title) % 360
  const bg = ctx.createLinearGradient(0, 0, 0, H)
  bg.addColorStop(0, `hsl(${hue} 30% 16%)`)
  bg.addColorStop(0.55, '#12141a')
  bg.addColorStop(1, UI.ink0)
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, W, H)

  // --- строка состояния ---
  // Часы ТЕ ЖЕ, что у монитора и у неба за окном: строку считает
  // sky/time.ts. Два места, вычисляющие «который час», разойдутся.
  ctx.textBaseline = 'middle'
  ctx.textAlign = 'left'
  ctx.font = font(600, W * 0.028, UI.sans)
  ctx.fillStyle = UI.text
  ctx.fillText(clock, pad * 0.7, H * 0.028)

  // Батарея. Рисуется, а не берётся эмодзи: эмодзи приезжает из
  // системного шрифта и выглядит по-разному на каждой ОС.
  const bw = W * 0.055
  const bh = W * 0.026
  const bx = W - pad * 0.7 - bw
  const byy = H * 0.028 - bh / 2
  ctx.strokeStyle = 'rgba(255,255,255,0.45)'
  ctx.lineWidth = Math.max(1, W * 0.002)
  roundRect(ctx, bx, byy, bw, bh, bh * 0.32)
  ctx.stroke()
  ctx.fillStyle = 'rgba(255,255,255,0.75)'
  roundRect(ctx, bx + bw * 0.08, byy + bh * 0.2, bw * 0.62, bh * 0.6, bh * 0.16)
  ctx.fill()
  ctx.fillRect(bx + bw + W * 0.004, byy + bh * 0.3, W * 0.005, bh * 0.4)

  // --- шапка «откуда играет» ---
  const headY = H * 0.082
  const kicker = 'PLAYING FROM'
  ctx.font = font(700, W * 0.023, UI.sans)
  ctx.fillStyle = UI.faint
  // Разрядка считается вручную, поэтому и центрируется вручную:
  // `textAlign` про неё ничего не знает, она рисует посимвольно.
  ctx.textAlign = 'left'
  tracked(ctx, kicker, W / 2 - trackedWidth(ctx, kicker, W * 0.006) / 2, headY, W * 0.006)
  ctx.textAlign = 'center'
  ctx.font = font(600, W * 0.03, UI.sans)
  ctx.fillStyle = UI.text
  ctx.fillText(track.source, W / 2, headY + H * 0.032)

  // Шеврон «свернуть» слева и многоточие справа — без них шапка висит
  // в пустоте, а в приложении она всегда между двумя кнопками.
  ctx.strokeStyle = UI.dim
  ctx.lineWidth = Math.max(2, W * 0.005)
  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.moveTo(pad * 0.8, headY + H * 0.005)
  ctx.lineTo(pad * 0.8 + W * 0.028, headY + H * 0.021)
  ctx.lineTo(pad * 0.8 + W * 0.056, headY + H * 0.005)
  ctx.stroke()
  ctx.fillStyle = UI.dim
  for (let i = 0; i < 3; i++) {
    ctx.beginPath()
    ctx.arc(W - pad * 0.8 - W * 0.03 + i * W * 0.03, headY + H * 0.013, W * 0.006, 0, Math.PI * 2)
    ctx.fill()
  }

  // --- обложка ---
  const cover = W - pad * 2
  const coverY = H * 0.145
  // Тень под обложкой: она лежит НА фоне, а не является им.
  ctx.save()
  ctx.shadowColor = 'rgba(0,0,0,0.55)'
  ctx.shadowBlur = W * 0.06
  ctx.shadowOffsetY = W * 0.02
  ctx.fillStyle = '#000'
  roundRect(ctx, pad, coverY, cover, cover, cover * 0.018)
  ctx.fill()
  ctx.restore()
  paintCover(ctx, pad, coverY, cover, track.title)

  // --- название и исполнитель ---
  const titleY = coverY + cover + H * 0.05
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
  // ШРИФТ УЖИМАЕТСЯ ПОД ДЛИНУ. «This Room» влезал всегда, а настоящие
  // названия бывают вчетверо длиннее и уезжали бы под сердце справа.
  // Перенос на две строки тут не годится: под названием сразу идёт
  // исполнитель, и вторая строка вытолкнула бы дорожку за край экрана.
  const maxTitle = W - pad * 2 - W * 0.075
  fitText(ctx, track.title, pad, titleY, maxTitle, W * 0.062, 700, UI.text)
  fitText(ctx, track.artist, pad, titleY + H * 0.036, maxTitle, W * 0.038, 500, UI.dim)

  // Сердце справа — заполненное: свой же трек в библиотеке.
  const hx = W - pad
  const hy = titleY - H * 0.012
  const hs = W * 0.026
  ctx.fillStyle = PLAY
  ctx.beginPath()
  ctx.moveTo(hx - hs, hy + hs * 0.35)
  ctx.bezierCurveTo(hx - hs * 2.1, hy - hs * 0.9, hx - hs * 0.6, hy - hs * 1.25, hx - hs, hy - hs * 0.25)
  ctx.bezierCurveTo(hx - hs * 1.4, hy - hs * 1.25, hx + hs * 0.1, hy - hs * 0.9, hx - hs, hy + hs * 0.35)
  ctx.fill()

  // --- дорожка ---
  const band: ProgressBand = { y: titleY + H * 0.05, h: H * 0.075 }
  paintProgress(ctx, W, band, bg, track, elapsed, playing)

  // Обложка вместе с названием — одна большая кнопка «открыть в Spotify».
  // Она же самое очевидное место, куда ткнут, и вести оно должно туда,
  // куда ткнувший и хотел.
  if (interactive) {
    hits.push({ id: 'open', x: pad, y: coverY, w: cover, h: cover + H * 0.075 })
    // Шапка «PLAYING FROM» открывает список того, что играло раньше:
    // в приложении по этой же строке и уходят к источнику.
    hits.push({ id: 'queue', x: pad, y: headY - H * 0.02, w: W - pad * 2, h: H * 0.06 })
  }

  // --- транспорт ---
  // Отступ 0.032, а не 0.045: при прежнем кнопка воспроизведения уходила
  // нижней кромкой на 1185-й пиксель холста высотой 1180, то есть
  // срезалась. Посчитано, а не поправлено на глаз.
  const tY = band.y + band.h + H * 0.032
  const r = W * 0.045
  icon(ctx, 'shuffle', pad + r * 0.6, tY, r * 0.7, PLAY)
  icon(ctx, 'prev', W * 0.3, tY, r * 0.85, UI.text)
  // Кнопка показывает, что произойдёт ПО НАЖАТИЮ, а не что происходит
  // сейчас: играет — значит пауза, стоит — значит треугольник. Наоборот
  // было бы враньём про собственное состояние.
  ctx.fillStyle = UI.text
  ctx.beginPath()
  ctx.arc(W / 2, tY, r * 1.25, 0, Math.PI * 2)
  ctx.fill()
  icon(ctx, playing ? 'pause' : 'play', W / 2, tY, r * 0.8, '#0b0e13')
  icon(ctx, 'next', W * 0.7, tY, r * 0.85, UI.text)
  icon(ctx, 'repeat', W - pad - r * 0.6, tY, r * 0.7, UI.dim)

  return { band, background: bg, hits }
}

/**
 * Список того, что играло раньше.
 *
 * Управления плеером здесь нет и быть не может: права запрошены только на
 * чтение. Поэтому нажатие на строку делает единственное честное — открывает
 * трек в Spotify. Кнопка, которая делает вид, что переключает музыку,
 * врала бы про то, что умеет.
 */
export function paintQueue(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  songs: Song[],
  clock: string,
  scroll: number,
  hover: string | null,
): { hits: HitRegion[]; maxScroll: number } {
  const pad = W * 0.085
  const hits: HitRegion[] = []

  const bg = ctx.createLinearGradient(0, 0, 0, H)
  bg.addColorStop(0, '#12141a')
  bg.addColorStop(1, UI.ink0)
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, W, H)

  // Строка состояния — та же, что на главном экране: часы комнаты.
  ctx.textBaseline = 'middle'
  ctx.textAlign = 'left'
  ctx.font = font(600, W * 0.028, UI.sans)
  ctx.fillStyle = UI.text
  ctx.fillText(clock, pad * 0.7, H * 0.028)

  // Шеврон «назад» — та же кнопка, что и на главном, только теперь она
  // действительно возвращает.
  ctx.strokeStyle = UI.text
  ctx.lineWidth = Math.max(2, W * 0.006)
  ctx.lineCap = 'round'
  const backY = H * 0.075
  ctx.beginPath()
  ctx.moveTo(pad * 0.9 + W * 0.03, backY - W * 0.026)
  ctx.lineTo(pad * 0.9, backY)
  ctx.lineTo(pad * 0.9 + W * 0.03, backY + W * 0.026)
  ctx.stroke()
  hits.push({ id: 'back', x: 0, y: backY - H * 0.03, w: W * 0.28, h: H * 0.06 })

  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
  ctx.font = font(700, W * 0.023, UI.sans)
  ctx.fillStyle = UI.faint
  tracked(ctx, 'RECENTLY PLAYED', pad, H * 0.125, W * 0.006)

  const top = H * 0.16
  const rowH = H * 0.082
  const listH = H - top - H * 0.03
  const maxScroll = Math.max(0, songs.length * rowH - listH)
  const at = Math.min(Math.max(0, scroll), maxScroll)

  ctx.save()
  ctx.beginPath()
  ctx.rect(0, top, W, listH)
  ctx.clip()

  songs.forEach((song, i) => {
    const y = top + i * rowH - at
    if (y + rowH < top || y > top + listH) return
    const id = `song:${i}`
    if (hover === id) {
      ctx.fillStyle = 'rgba(255,255,255,0.06)'
      roundRect(ctx, pad * 0.5, y + rowH * 0.06, W - pad, rowH * 0.88, W * 0.014)
      ctx.fill()
    }
    // Крошечная обложка тем же процедурным мотивом: строка списка без
    // картинки читается как таблица, а не как музыка.
    const art = rowH * 0.66
    paintCover(ctx, pad, y + (rowH - art) / 2, art, song.title)

    const tx = pad + art + W * 0.035
    const maxW = W - tx - pad
    fitText(ctx, song.title, tx, y + rowH * 0.44, maxW, W * 0.032, 600, UI.text)
    fitText(ctx, song.artist, tx, y + rowH * 0.71, maxW, W * 0.026, 400, UI.dim)
    hits.push({ id, x: 0, y, w: W, h: rowH })
  })
  ctx.restore()

  if (!songs.length) {
    ctx.textAlign = 'center'
    ctx.font = font(500, W * 0.03, UI.sans)
    ctx.fillStyle = UI.faint
    ctx.fillText('nothing here yet', W / 2, H * 0.4)
    ctx.textAlign = 'left'
  }

  // Тень у нижней кромки, пока список не докручен: без неё непонятно,
  // что он продолжается.
  if (at < maxScroll - 1) {
    const fade = ctx.createLinearGradient(0, H - H * 0.09, 0, H)
    fade.addColorStop(0, 'rgba(11,14,19,0)')
    fade.addColorStop(1, UI.ink0)
    ctx.fillStyle = fade
    ctx.fillRect(0, H - H * 0.09, W, H * 0.09)
  }

  return { hits, maxScroll }
}

/**
 * Где стоит дорожка сейчас.
 *
 * Позиция берётся от настоящих часов по модулю длительности: посетитель,
 * пришедший в другой момент, застаёт трек в другом месте, а не на одном
 * и том же кадре. Это ровно то же решение, что и у неба за окном, — в
 * комнате не должно быть ничего, что при каждом заходе выглядит одинаково.
 */
export function elapsedAt(nowMs: number, track: Track = NOW_PLAYING): number {
  return (nowMs / 1000) % track.seconds
}
