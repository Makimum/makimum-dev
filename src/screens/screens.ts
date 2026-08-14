import * as THREE from 'three'
import { readBest, writeBest } from './best'
import { APPS, DECK, SHOTS, appsFor, type Screen } from './content'
import {
  paintGameFrame,
  paintSurface,
  setImageReadyHandler,
  type GameLayout,
  type HitRegion,
  type SurfaceState,
} from './paint'
import { createTetris, type GameKey, type Phase, type Tetris } from './tetris'
import { Panel } from './panel'
import { paintNowPlaying, paintProgress, paintQueue, type ProgressBand } from './nowPlaying'
import { paginate, paintSpread, type Spread } from './bookPages'
import { BOOK } from '../constants'
import { onReducedMotionChange, prefersReducedMotion } from '../lib/reducedMotion'
import {
  currentElapsed,
  currentTrack,
  isLive,
  isPlaying,
  recentTracks,
  trackChanged,
  trackUrl,
} from './spotify'

/**
 * Экраны комнаты как маленькая операционная система.
 *
 * У монитора и у ноутбука одна и та же оболочка и один и тот же реестр
 * приложений, но СВОЁ состояние: на мониторе может быть открыта дека,
 * пока на ноутбуке лежит рабочий стол. Это не украшение — это то, чем
 * два экрана на столе отличаются от одного.
 *
 * ПОПАДАНИЕ ПО ПЛИТКЕ. Клик приходит из рейкаста вместе с `intersection.uv`,
 * и это единственная надёжная связь между 3D и нарисованным интерфейсом:
 * uv → пиксели холста → прямоугольники, которые рисователь вернул вместе
 * с картинкой. Никаких вычислений «где примерно на экране» — области
 * приходят из того же кода, который их нарисовал, поэтому они не могут
 * разъехаться с картинкой.
 */

export interface SurfaceOptions {
  mesh: THREE.Mesh
  material: THREE.MeshStandardMaterial
  width: number
  height: number
  /**
   * Полотно монитора — кусок цилиндра, и мы смотрим на его ВОГНУТУЮ
   * сторону. UV у CylinderGeometry разложены под выпуклую, поэтому
   * изнутри текст читается зеркально: карта отражается по горизонтали,
   * а вместе с ней и попадание по плитке.
   */
  mirror: boolean
  /** Монитор или ноутбук: от этого зависит набор приложений. */
  screen: Screen
}

/** Что клик сделал с экраном — это решает, что делать камере. */
export type ClickResult = 'none' | 'consumed' | 'exit'

/**
 * Поверхность, с которой можно работать в фокусе.
 *
 * Появился, когда интерактивными стали не только монитор с ноутбуком, но
 * и планшет с книгой. `focus.ts` раньше знал конкретный класс `Surface` —
 * и это было ровно то место, где «добавить ещё один кликабельный предмет»
 * означало «править механику ввода». Теперь ввод знает интерфейс, а
 * каждый предмет отвечает за себя.
 *
 * `hint()` тоже здесь не случайно: подсказку внизу экрана раньше собирал
 * `focus.ts`, разбирая чужое состояние (`view`, `appId`) цепочкой
 * условий. Знать, что написать про СЕБЯ, — работа предмета; иначе каждый
 * новый экран дописывает ветку в чужой файл.
 */
export interface Interactive {
  hover(uv: THREE.Vector2 | null): boolean
  click(uv: THREE.Vector2): ClickResult
  /** Шаг назад по Esc. `exit` означает «дальше отступать некуда, выходим
   *  из фокуса» — камера это и делает. */
  back(): ClickResult
  /** Стрелки влево-вправо. true — предмет их взял, браузеру не отдавать. */
  arrow(dir: 1 | -1): boolean
  scrollBy(dy: number): boolean
  key(k: GameKey, down: boolean): boolean
  /** Строка подсказки под кадром, пока предмет в фокусе. */
  hint(): string
  /** Вернуться в состояние, в котором предмет показывают издалека. */
  reset(): void
  /**
   * Камера вошла в фокус или вышла из него.
   *
   * Нужно предметам, у которых фокус меняет не только картинку на
   * поверхности, но и саму вещь: книга при подлёте ОТКРЫВАЕТСЯ. Метод
   * необязательный — экранам, которые просто меняют вид, он ни к чему.
   */
  focusChanged?(active: boolean): void
}

export class Surface {
  readonly mesh: THREE.Mesh
  /** Холст, текстура и материал — общие с планшетом, см. `Panel`. */
  private readonly panel: Panel
  private hits: HitRegion[] = []
  private scrollMax = 0
  private dirty = true

  /**
   * Игра живёт РЯДОМ с состоянием экрана, а не внутри него.
   *
   * Из-за этого партия переживает и `Esc` на рабочий стол, и выход из
   * фокуса: `reset()` трогает вид, а не игру. Останавливается она сама —
   * тик приходит только открытому приложению, и закрытая игра просто не
   * получает времени.
   */
  private game: Tetris | null = null
  private layout: GameLayout | null = null
  private gameDirty = false
  private gamePhase: Phase | null = null

  private state: SurfaceState = {
    view: 'desktop',
    appId: null,
    scroll: 0,
    slide: 0,
    hover: null,
    daylight: 1,
    clock: '',
    calls: 0,
    screen: 'laptop',
    game: null,
  }

  constructor(o: SurfaceOptions) {
    this.mesh = o.mesh
    this.state.screen = o.screen
    this.panel = new Panel({
      material: o.material,
      width: o.width,
      height: o.height,
      mirror: o.mirror,
    })
  }

  get view() {
    return this.state.view
  }

  /** Что писать под кадром. Логика жила в `focus.ts` и разбирала чужое
   *  состояние; теперь экран отвечает за себя сам. */
  hint(): string {
    if (this.state.view !== 'app') return 'click an app · esc to leave'
    if (this.state.appId === 'tetris') {
      return '← → move · ↓ soft drop · ↑ rotate · space hard drop · esc to go back'
    }
    return 'scroll to read · ← → to move · esc to go back'
  }

  /** Что открыто: подсказке в углу нужны разные слова для документа и
   *  для игры. */
  get appId() {
    return this.state.appId
  }

  private get gameOpen() {
    return this.state.view === 'app' && this.state.appId === 'tetris' && !!this.game
  }

  setClock(clock: string, daylight: number) {
    if (this.state.clock === clock && this.state.daylight === daylight) return
    this.state.clock = clock
    this.state.daylight = daylight
    this.dirty = true
  }

  /** Счётчик кадра. Перерисовываем только при заметном изменении:
   *  дрожание на единицу не стоит выгрузки текстуры в 7 МБ. */
  setCalls(calls: number) {
    if (Math.abs(calls - this.state.calls) < 4) return
    this.state.calls = calls
    if (this.state.view === 'desktop') this.dirty = true
  }

  private regionAt(uv: THREE.Vector2): HitRegion | null {
    // Области приходят из рисователя, поэтому пока картинка не
    // перерисована, они описывают ПРЕДЫДУЩИЙ кадр. Обычно между двумя
    // действиями пользователя проходит кадр и это незаметно; во вкладке
    // в фоне (rAF заморожен) — нет. Дешевле досрочно перерисовать, чем
    // отвечать на клик по тому, чего на экране уже нет.
    this.flush()
    const p = this.panel.toCanvas(uv)
    // Сзади наперёд: то, что нарисовано позже, лежит сверху.
    for (let i = this.hits.length - 1; i >= 0; i--) {
      const r = this.hits[i]
      if (p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h) return r
    }
    return null
  }

  /** Наведение. Возвращает true, если под курсором есть кликабельное. */
  hover(uv: THREE.Vector2 | null): boolean {
    const id = uv ? (this.regionAt(uv)?.id ?? null) : null
    if (id !== this.state.hover) {
      this.state.hover = id
      this.dirty = true
    }
    return id !== null
  }

  click(uv: THREE.Vector2): ClickResult {
    const hit = this.regionAt(uv)
    if (!hit) return 'none'
    const [kind, value, extra] = hit.id.split(':')

    if (kind === 'app') {
      this.open(value)
      return 'consumed'
    }
    if (kind === 'close') {
      return this.back()
    }
    if (kind === 'link') {
      // Ссылка — единственное место, где экран выпускает посетителя
      // наружу, поэтому только новая вкладка и только по явному клику.
      const href = hit.id.slice('link:'.length)
      window.open(href, '_blank', 'noopener,noreferrer')
      return 'consumed'
    }
    if (kind === 'scrollto') {
      this.state.scroll = Math.min(Math.max(Number(value) || 0, 0), this.scrollMax)
      this.dirty = true
      return 'consumed'
    }
    if (kind === 'shot') {
      // Ноль — назад к сетке, иначе номер снимка. Индекс живёт в `slide`:
      // это то же самое «какой кадр открыт», что и у деки.
      this.state.slide = Number(value) || 0
      this.state.scroll = 0
      this.dirty = true
      return 'consumed'
    }
    if (kind === 'deck') {
      if (value === 'prev') this.slideBy(-1)
      else if (value === 'next') this.slideBy(1)
      else if (value === 'go') this.goSlide(Number(extra))
      return 'consumed'
    }
    if (kind === 'game') {
      this.game?.key('start', true)
      this.dirty = true
      return 'consumed'
    }
    return 'none'
  }

  open(id: string) {
    // Только приложения СВОЕГО экрана: у монитора и ноутбука разные наборы,
    // и открыть чужое значило бы показать пустое окно.
    if (!appsFor(this.state.screen).some((a) => a.id === id)) return
    // Игра поднимается при первом открытии и дальше живёт: закрыли —
    // осталась стоять с той же фигурой.
    if (id === 'tetris' && !this.game) {
      this.game = createTetris({ best: readBest(), onBest: writeBest })
    }
    this.state.view = 'app'
    this.state.appId = id
    this.state.scroll = 0
    this.state.slide = 0
    this.state.hover = null
    this.dirty = true
  }

  /**
   * Шаг назад: раскрытый снимок → сетка → рабочий стол → выход из фокуса.
   *
   * Ступень со снимком добавлена по жалобе: `Esc` из открытого кадра
   * выбрасывал сразу на рабочий стол, и чтобы посмотреть второй снимок,
   * приходилось заново заходить в галерею. Шаг назад обязан отменять
   * ПОСЛЕДНЕЕ действие, а не всю цепочку разом.
   */
  back(): ClickResult {
    if (this.state.view === 'app' && this.state.appId === 'gallery' && this.state.slide > 0) {
      this.state.slide = 0
      this.state.hover = null
      this.dirty = true
      return 'consumed'
    }
    if (this.state.view === 'app') {
      // Уходя из игры, отпускаем клавиши руками: `keyup` придёт уже мимо
      // неё, и зажатая стрелка осталась бы зажатой навсегда.
      this.game?.releaseKeys()
      this.state.view = 'desktop'
      this.state.appId = null
      this.state.hover = null
      this.state.slide = 0
      this.dirty = true
      return 'consumed'
    }
    return 'exit'
  }

  scrollBy(dy: number) {
    if (this.state.view !== 'app' || this.scrollMax <= 0) return false
    const next = Math.min(Math.max(this.state.scroll + dy, 0), this.scrollMax)
    if (next === this.state.scroll) return false
    this.state.scroll = next
    this.dirty = true
    return true
  }

  slideBy(d: number) {
    this.goSlide(this.state.slide + d)
  }

  goSlide(i: number) {
    if (this.state.appId !== 'deck' || !Number.isFinite(i)) return
    const next = Math.min(Math.max(i, 0), DECK.length - 1)
    if (next === this.state.slide) return
    this.state.slide = next
    this.dirty = true
  }

  /**
   * Клавиша игре. Возвращает true, если игра её забрала, — тогда наверху
   * стрелка не пойдёт ни в скролл, ни в деку.
   *
   * Разводится это здесь, а не в фокусе: там про приложения не знают, а
   * «стрелки достаются игре, пока она открыта» — правило приложения.
   */
  key(name: GameKey, down: boolean): boolean {
    if (!this.gameOpen) return false
    const took = this.game!.key(name, down)
    this.afterGame()
    return took
  }

  /**
   * Что перерисовывать после хода. Обычно только стакан, но смена фазы
   * (началась партия, кончилась партия) меняет ещё и кликабельные
   * области — по остановленному стакану можно щёлкнуть, чтобы начать, —
   * а области рождаются только в полном проходе.
   */
  private afterGame() {
    if (!this.game) return
    if (this.game.takeDirty()) this.gameDirty = true
    const phase = this.game.phase()
    if (phase !== this.gamePhase) {
      this.gamePhase = phase
      this.dirty = true
    }
  }

  /**
   * Время игре. Приходит каждый кадр и только открытой игре: закрытая не
   * тикает в фоне, и это же её пауза.
   */
  tickGame(dt: number) {
    if (!this.gameOpen) return
    this.game!.tick(dt)
    this.afterGame()
  }

  /** Стрелки: листают деку, а в документе двигают скролл. */
  arrow(d: number): boolean {
    if (this.state.view !== 'app') return false
    // Пока открыт тетрис, стрелки принадлежат ему — даже если сюда как-то
    // дошли: скролла у игры нет, а листать ей нечего.
    if (this.state.appId === 'tetris') return true
    if (this.state.appId === 'deck') {
      this.slideBy(d)
      return true
    }
    // В раскрытом снимке стрелки листают галерею, а не скроллят документ:
    // человек, открывший один кадр, почти всегда хочет посмотреть соседний.
    if (this.state.appId === 'gallery' && this.state.slide > 0) {
      const next = Math.min(Math.max(this.state.slide + d, 1), SHOTS.length)
      if (next !== this.state.slide) {
        this.state.slide = next
        this.dirty = true
      }
      return true
    }
    return this.scrollBy(d * 120)
  }

  reset() {
    this.game?.releaseKeys()
    if (this.state.view === 'desktop' && this.state.hover === null) return
    this.state.view = 'desktop'
    this.state.appId = null
    this.state.hover = null
    this.state.scroll = 0
    this.dirty = true
  }

  /** Внешняя причина перерисовать: догрузилась картинка. */
  forceRedraw() {
    this.dirty = true
  }

  /** Перерисовка не чаще раза в кадр и только когда что-то поменялось. */
  flush() {
    if (!this.dirty) {
      // Ход в игре меняет два прямоугольника из всего окна. Полный проход
      // тут стоил бы раскладки документа и всей типографики — ради стакана,
      // в котором сдвинулась одна фигура.
      if (this.gameDirty && this.layout && this.game) {
        this.gameDirty = false
        paintGameFrame(this.panel.ctx, this.panel.width, this.panel.height, this.layout, this.game.view())
        this.panel.uploaded()
      }
      return
    }
    this.dirty = false
    this.gameDirty = false
    // Рисователь не знает про игру и не спрашивает её сам: снимок поля
    // кладётся в состояние, и рисователь остаётся его чистой функцией.
    this.state.game = this.gameOpen ? this.game!.view() : null
    const res = paintSurface(this.panel.ctx, this.panel.width, this.panel.height, this.state)
    this.hits = res.hits
    this.scrollMax = res.scrollMax
    this.layout = res.layout ?? null
    // Бумажный слайд деки светится втрое ярче тёмного интерфейса, а порог
    // блума 0.72: без снижения эмиссии белая страница расплывается в
    // пятно и перестаёт читаться.
    const light = this.state.view === 'app' && this.state.appId === 'deck'
    this.panel.material.emissiveIntensity = light ? 0.5 : 0.85
    this.panel.uploaded()
  }
}

/**
 * Экран планшета: одно окно, которое никто не трогает.
 *
 * Отдельный класс, а не третий вид `Surface`, и это не мелочь. У
 * монитора с ноутбуком маленькая операционная система: рабочий стол,
 * реестр приложений, попадание по плитке, прокрутка, клавиши, игра. У
 * планшета ничего этого нет. Загнать его в `Surface` значило бы завести
 * ветку «а этот ничего из перечисленного не умеет» в каждом методе.
 * Общее у них — холст с текстурой, и оно вынесено в `Panel`.
 *
 * ПЕРЕРИСОВКА РАЗ В СЕКУНДУ И ТОЛЬКО ПОЛОСОЙ. Меняются на экране ровно
 * две вещи: головка дорожки и таймеры. Полная перерисовка холста
 * 820 × 1180 ради бегущей головки — та же ошибка, которой избежал
 * тетрис, перерисовывая стакан вместо всего окна.
 */
export class NowPlaying implements Interactive {
  readonly mesh: THREE.Mesh
  private readonly panel: Panel
  private band: ProgressBand | null = null
  private background: CanvasGradient | string = '#000'
  private full = true
  private lastSecond = -1
  private clock = ''

  /**
   * Что открыто. `now` — то, что играет; `queue` — список того, что играло
   * раньше. Второго вида не было, пока планшет был декорацией; он появился
   * вместе с фокусом, потому что подлетевшая камера обязана давать больше,
   * чем взгляд издалека, — иначе подлетать незачем.
   */
  private view: 'now' | 'queue' = 'now'
  private scroll = 0
  private maxScroll = 0
  private hits: HitRegion[] = []
  private hovered: string | null = null

  constructor(mesh: THREE.Mesh, material: THREE.MeshStandardMaterial) {
    this.mesh = mesh
    this.panel = new Panel({
      material,
      // 820 × 1180 — ровно половина настоящей матрицы iPad Air (1640 ×
      // 2360). Полного разрешения не нужно: у планшета минимальное
      // расстояние орбиты 0.6 м, а в фокусе камера подходит к нему на
      // 0.34 м, и там экран занимает около двух третей высоты кадра.
      width: 820,
      height: 1180,
      // Планшет светит слабее монитора: он меньше и стоит дальше от
      // глаза. При той же яркости он перетягивал бы на себя ночной кадр,
      // в котором главное — пятно лампы на столешнице.
      emissive: 0.7,
    })
  }

  /** Часы приходят снаружи — те же, что у неба и у монитора. */
  setClock(clock: string) {
    if (clock === this.clock) return
    this.clock = clock
    this.full = true
  }

  /* ---------------- Interactive ---------------- */

  hint(): string {
    if (this.view === 'queue') return 'scroll the list · click to open in Spotify · esc to go back'
    if (!isLive()) return 'esc to go back'
    return 'click the cover to open in Spotify · click the header for history · esc to leave'
  }

  private regionAt(uv: THREE.Vector2): HitRegion | null {
    this.flushNow()
    const p = this.panel.toCanvas(uv)
    for (let i = this.hits.length - 1; i >= 0; i--) {
      const r = this.hits[i]
      if (p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h) return r
    }
    return null
  }

  hover(uv: THREE.Vector2 | null): boolean {
    const id = uv ? (this.regionAt(uv)?.id ?? null) : null
    if (id !== this.hovered) {
      this.hovered = id
      // Подсветка строки видна только в списке; на главном экране
      // перерисовывать весь холст ради наведения незачем.
      if (this.view === 'queue') this.full = true
    }
    return id !== null
  }

  click(uv: THREE.Vector2): ClickResult {
    const hit = this.regionAt(uv)
    if (!hit) return 'none'
    const [kind, value] = hit.id.split(':')

    if (kind === 'queue') {
      // Список открывается только когда он есть. У встроенного трека
      // истории нет, и пустой экран был бы обещанием, которого не сдержали.
      if (!isLive() || !recentTracks().length) return 'none'
      this.view = 'queue'
      this.scroll = 0
      this.hovered = null
      this.full = true
      return 'consumed'
    }
    if (kind === 'back') return this.back()
    if (kind === 'open' || kind === 'song') {
      const url = kind === 'open' ? trackUrl() : (recentTracks()[Number(value)]?.url ?? '')
      if (!url) return 'none'
      // Наружу — только новая вкладка и только по явному нажатию: это то
      // же правило, что у ссылок в документах на мониторе.
      window.open(url, '_blank', 'noopener,noreferrer')
      return 'consumed'
    }
    return 'none'
  }

  back(): ClickResult {
    if (this.view === 'queue') {
      this.view = 'now'
      this.hovered = null
      this.full = true
      return 'consumed'
    }
    return 'exit'
  }

  arrow(dir: 1 | -1): boolean {
    if (this.view !== 'queue') return false
    return this.scrollBy(dir * 120)
  }

  scrollBy(dy: number): boolean {
    if (this.view !== 'queue') return false
    const next = Math.min(Math.max(0, this.scroll + dy), this.maxScroll)
    if (next === this.scroll) return false
    this.scroll = next
    this.full = true
    return true
  }

  key(): boolean {
    return false
  }

  reset() {
    if (this.view === 'now' && !this.hovered) return
    this.view = 'now'
    this.scroll = 0
    this.hovered = null
    this.full = true
  }

  /* ---------------- отрисовка ---------------- */

  /** Досрочная перерисовка перед попаданием: области приходят от
   *  рисователя, и пока он не отработал, они описывают прошлый кадр. */
  private flushNow() {
    if (this.full) this.paint(performance.now())
  }

  private paint(nowMs: number) {
    const ctx = this.panel.ctx
    const W = this.panel.width
    const H = this.panel.height
    this.full = false

    if (this.view === 'queue') {
      const r = paintQueue(ctx, W, H, recentTracks(), this.clock, this.scroll, this.hovered)
      this.hits = r.hits
      this.maxScroll = r.maxScroll
      this.band = null
      this.panel.uploaded()
      return
    }

    const elapsed = currentElapsed(nowMs)
    this.lastSecond = Math.floor(elapsed)
    const r = paintNowPlaying(
      ctx,
      W,
      H,
      currentTrack(),
      elapsed,
      this.clock,
      isPlaying(),
      // Кнопки предлагаются, только если за ними что-то есть: у
      // встроенного трека нет ни ссылки, ни истории.
      isLive(),
    )
    this.band = r.band
    this.background = r.background
    this.hits = r.hits
    this.panel.uploaded()
  }

  flush(nowMs: number) {
    // Приехал другой трек — меняются обложка, название и длительность,
    // то есть весь экран, а не полоса.
    if (trackChanged()) this.full = true
    if (this.full) {
      this.paint(nowMs)
      return
    }
    // В списке нечему тикать: там нет ни дорожки, ни таймера.
    if (this.view === 'queue' || !this.band) return

    const elapsed = currentElapsed(nowMs)
    const second = Math.floor(elapsed)
    if (second === this.lastSecond) return
    this.lastSecond = second
    paintProgress(
      this.panel.ctx,
      this.panel.width,
      this.band,
      this.background,
      currentTrack(),
      elapsed,
      isPlaying(),
    )
    this.panel.uploaded()
  }
}

/**
 * Книга, которую можно открыть и читать.
 *
 * ЧТО ЗДЕСЬ ПРОИСХОДИТ ФИЗИЧЕСКИ. При входе в фокус крышка поворачивается
 * на π вокруг корешка и ложится слева, а между ней и блоком проявляется
 * разворот. При выходе — обратно. Это не декорация: закрытая книга,
 * которую «читают», не читалась бы вовсе, а мгновенно возникший разворот
 * читался бы как подмена предмета.
 *
 * ДЛИТЕЛЬНОСТЬ 620 мс — дольше перелёта камеры (520). Так и надо:
 * книга должна дораскрыться уже после того, как камера встала, иначе
 * движение крышки происходит за кадром и его никто не видит.
 */
/** Полное сметание страницы. Дольше кроссфейда: у него есть путь,
 *  который глаз должен успеть проследить. */
const TURN_FULL_MS = 420
/** Кроссфейд при просьбе уменьшить движение. Скилл доступности называет
 *  потолок в 200 мс для замены движения затуханием; берём 160. */
const TURN_REDUCED_MS = 160

export class BookSpread implements Interactive {
  readonly mesh: THREE.Mesh
  private readonly panel: Panel
  private readonly cover: THREE.Object3D | null
  private readonly spread: THREE.Mesh

  private spreads: Spread[] = []
  private index = 0
  private hits: HitRegion[] = []
  private dirty = true

  /** 0 — закрыта, 1 — раскрыта. Между ними идёт анимация. */
  private openness = 0
  private target = 0
  private startedAt = 0
  private from = 0

  /**
   * ПЕРЕЛИСТЫВАНИЕ. Разложено по ступеням доступности, а не выключено
   * целиком под просьбу уменьшить движение.
   *
   *  — Полное движение: страница ПРОМЕТАЕТСЯ поперёк разворота, с тенью у
   *    ведущего края. Это крупное горизонтальное перемещение на всю
   *    ширину кадра, то есть вестибулярный триггер первой категории.
   *  — Уменьшенное движение: сметания нет вовсе, вместо него кроссфейд
   *    160 мс. Перемещения не остаётся, но переход остаётся — иначе
   *    страница ТЕЛЕПОРТИРУЕТСЯ, а мгновенная подмена дезориентирует не
   *    меньше движения. Это ровно то же решение, что уже принято для
   *    мобильной страницы: просьба уменьшить движение — ступени, а не
   *    выключатель.
   *
   * Настройка читается ЖИВОЙ: включив её посреди сессии, человек обязан
   * получить эффект сразу, а не после перезагрузки вкладки.
   */
  private reduced = prefersReducedMotion()
  private readonly unwatchMotion = onReducedMotionChange((r) => {
    this.reduced = r
    // Движение, начатое до переключения, обязано прекратиться, а не
    // доиграть: человек попросил остановить его именно сейчас.
    if (r && this.turning) this.finishTurn()
    if (r && this.target !== this.openness) {
      this.openness = this.target
      this.apply()
    }
  })

  /** Снимки разворота до и после — для перехода между ними. */
  private before: HTMLCanvasElement | null = null
  private after: HTMLCanvasElement | null = null
  private turning = false
  private turnStart = 0
  /** +1 — вперёд, −1 — назад. Определяет, куда метётся страница. */
  private turnDir: 1 | -1 = 1

  constructor(mesh: THREE.Mesh, material: THREE.MeshStandardMaterial, root: THREE.Group) {
    this.mesh = mesh
    this.spread = mesh
    this.cover = root.getObjectByName('book-cover') ?? null
    this.panel = new Panel({
      material,
      // Разворот — две страницы формата книги: 2 × 140 на 216 мм. Холст
      // держит ту же пропорцию, иначе набор поедет по одной оси.
      width: 1300,
      height: 1000,
      // Бумага не светится. Эмиссия здесь минимальная и нужна только
      // чтобы текст читался в тени крышки, а не проваливался в чёрное.
      emissive: 0.18,
    })
  }

  /* ---------------- Interactive ---------------- */

  hint(): string {
    return this.spreads.length > 1
      ? '← → to turn the page · click the edges · esc to close'
      : 'esc to close'
  }

  private regionAt(uv: THREE.Vector2): HitRegion | null {
    if (this.dirty) this.paint()
    const p = this.panel.toCanvas(uv)
    for (let i = this.hits.length - 1; i >= 0; i--) {
      const r = this.hits[i]
      if (p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h) return r
    }
    return null
  }

  hover(uv: THREE.Vector2 | null): boolean {
    return uv ? !!this.regionAt(uv) : false
  }

  click(uv: THREE.Vector2): ClickResult {
    const hit = this.regionAt(uv)
    if (!hit) return 'none'
    if (hit.id === 'next') return this.turn(1) ? 'consumed' : 'none'
    if (hit.id === 'prev') return this.turn(-1) ? 'consumed' : 'none'
    return 'none'
  }

  back(): ClickResult {
    // Из книги отступать некуда: она либо открыта, либо закрыта. Первый
    // разворот — не «глубже», чем пятый, и возвращать на него по Esc
    // значило бы заставить листать заново.
    return 'exit'
  }

  arrow(dir: 1 | -1): boolean {
    return this.turn(dir)
  }

  scrollBy(dy: number): boolean {
    // Книгу листают, а не прокручивают. Колесо переворачивает страницу,
    // но с порогом: у трекпада инерция, и без него один жест пролистывал
    // бы половину книги.
    if (Math.abs(dy) < 40) return false
    return this.turn(dy > 0 ? 1 : -1)
  }

  key(): boolean {
    return false
  }

  reset() {
    this.setOpen(false)
    if (this.index !== 0) {
      this.index = 0
      this.dirty = true
    }
  }

  focusChanged(active: boolean) {
    this.setOpen(active)
  }

  private turn(dir: 1 | -1): boolean {
    const next = Math.min(Math.max(0, this.index + dir), Math.max(0, this.spreads.length - 1))
    if (next === this.index) return false

    // Кадр «до» снимается ДО смены разворота — иначе снимать будет нечего.
    // Если предыдущий переход ещё идёт, он закрывается: две страницы,
    // летящие одновременно, читаются как сбой, а не как быстрое листание.
    if (this.turning) this.finishTurn()
    this.before = this.snapshot(this.before)

    this.index = next
    this.dirty = true
    this.paint()
    this.after = this.snapshot(this.after)

    this.turnDir = dir
    this.turnStart = performance.now()
    this.turning = true
    return true
  }

  /** Копия текущего холста панели. Переиспользует буфер: перелистывают
   *  подряд, и выделять по холсту 1300 × 1000 на каждый лист незачем. */
  private snapshot(into: HTMLCanvasElement | null): HTMLCanvasElement {
    const c = into ?? document.createElement('canvas')
    c.width = this.panel.width
    c.height = this.panel.height
    const x = c.getContext('2d')!
    x.clearRect(0, 0, c.width, c.height)
    x.drawImage(this.panel.canvas, 0, 0)
    return c
  }

  private finishTurn() {
    this.turning = false
    if (this.after) {
      const ctx = this.panel.ctx
      ctx.globalAlpha = 1
      ctx.drawImage(this.after, 0, 0)
      this.panel.uploaded()
    }
  }

  /**
   * Кадр перехода между разворотами.
   *
   * Полное движение — сметание: граница едет поперёк разворота, слева от
   * неё старое, справа новое (для листания назад — наоборот), а на самой
   * границе лежит тёмная полоса, тень поднятого листа. Уменьшенное —
   * только прозрачность, без единого пикселя перемещения.
   */
  private paintTurn(nowMs: number) {
    const before = this.before
    const after = this.after
    if (!before || !after) return this.finishTurn()

    const dur = this.reduced ? TURN_REDUCED_MS : TURN_FULL_MS
    const t = Math.min(1, (nowMs - this.turnStart) / dur)
    const ctx = this.panel.ctx
    const W = this.panel.width
    const H = this.panel.height

    if (this.reduced) {
      // Кроссфейд. Никакого сдвига: движение убрано, переход оставлен.
      ctx.globalAlpha = 1
      ctx.drawImage(after, 0, 0)
      ctx.globalAlpha = 1 - t
      ctx.drawImage(before, 0, 0)
      ctx.globalAlpha = 1
    } else {
      // Быстрый старт, мягкая посадка — та же кривая, что у шапки
      // страницы и у раскрытия крышки.
      const e = 1 - Math.pow(1 - t, 3)
      // Вперёд: граница едет справа налево, открывая новое из-под старого.
      const x = this.turnDir > 0 ? W * (1 - e) : W * e
      ctx.globalAlpha = 1
      ctx.drawImage(after, 0, 0)

      ctx.save()
      ctx.beginPath()
      if (this.turnDir > 0) ctx.rect(0, 0, x, H)
      else ctx.rect(x, 0, W - x, H)
      ctx.clip()
      ctx.drawImage(before, 0, 0)
      ctx.restore()

      // Тень у ведущего края: без неё это не лист, а стирание.
      const w = W * 0.055
      const g = ctx.createLinearGradient(x - this.turnDir * w, 0, x, 0)
      g.addColorStop(0, 'rgba(30,24,14,0)')
      g.addColorStop(1, 'rgba(30,24,14,0.35)')
      ctx.fillStyle = g
      ctx.fillRect(Math.min(x, x - this.turnDir * w), 0, w, H)
    }

    this.panel.uploaded()
    if (t >= 1) this.finishTurn()
  }

  private setOpen(open: boolean) {
    const t = open ? 1 : 0
    if (t === this.target) return
    this.target = t
    if (this.reduced) {
      this.openness = t
      this.apply()
      return
    }
    this.from = this.openness
    this.startedAt = performance.now()
  }

  /* ---------------- кадр ---------------- */

  private apply() {
    if (this.cover) this.cover.rotation.z = Math.PI * this.openness
    // Разворот появляется, когда крышка уже ушла больше чем наполовину:
    // раньше он торчал бы сквозь неё.
    this.spread.visible = this.openness > 0.55
  }

  private paint() {
    this.dirty = false
    const ctx = this.panel.ctx
    const W = this.panel.width
    const H = this.panel.height
    if (!this.spreads.length) {
      this.spreads = paginate(ctx, W / 2 - 148, H, H / 1000)
    }
    this.hits = paintSpread(ctx, W, H, this.spreads, this.index, BOOK.title ?? '')
    this.panel.uploaded()
  }

  flush(nowMs: number) {
    if (this.target !== this.openness && !this.reduced) {
      const t = Math.min(1, (nowMs - this.startedAt) / 620)
      // Та же кривая, что у шапки страницы: быстрый старт, мягкая посадка.
      const e = 1 - Math.pow(1 - t, 3)
      this.openness = this.from + (this.target - this.from) * e
      this.apply()
    }
    // Переход между разворотами идёт поверх всего остального: он и есть
    // то, что сейчас на холсте.
    if (this.turning) {
      this.paintTurn(nowMs)
      return
    }
    // Рисуем только когда книга раскрыта: закрытую страницу никто не
    // видит, а холст 1300 × 1000 стоит реальной выгрузки в текстуру.
    if (this.dirty && this.openness > 0.5) this.paint()
  }

  /** Отписка от системной настройки. Комната живёт, пока открыта вкладка,
   *  но висящий слушатель на выгруженной сцене — это утечка. */
  dispose() {
    this.unwatchMotion()
  }
}

export class Screens {
  readonly surfaces: Surface[] = []
  /** Планшет. Отдельно от `surfaces`, потому что он не Surface и не
   *  участвует ни в наведении, ни в кликах, ни в игре. */
  tablet: NowPlaying | null = null
  /** Книга. Отдельно по той же причине, что и планшет: у неё нет ни
   *  приложений, ни прокрутки документа — только развороты. */
  book: BookSpread | null = null
  private byMesh = new Map<THREE.Object3D, Interactive>()
  private lastClock = ''

  constructor(scene: THREE.Scene) {
    // Все три экрана называются 'screen'; различаем по родителю.
    scene.traverse((o) => {
      const m = o as THREE.Mesh
      if (!m.isMesh || m.name !== 'screen') return
      const mat = m.material as THREE.MeshStandardMaterial
      let p: THREE.Object3D | null = m.parent
      while (
        p &&
        p.name !== 'monitor' &&
        p.name !== 'macbook' &&
        p.name !== 'tablet' &&
        p.name !== 'book'
      ) {
        p = p.parent
      }

      if (p?.name === 'book') {
        this.book = new BookSpread(m, mat, p as THREE.Group)
        this.byMesh.set(m, this.book)
      } else if (p?.name === 'tablet') {
        this.tablet = new NowPlaying(m, mat)
        this.byMesh.set(m, this.tablet)
      } else if (p?.name === 'monitor') {
        // 2048 × 870 на полотно 0.8 × 0.34 м — около 2.5 пикселя на
        // миллиметр: текст остаётся резким, когда камера подлетает вплотную.
        this.add(
          new Surface({ mesh: m, material: mat, width: 2048, height: 870, mirror: true, screen: 'monitor' }),
        )
      } else if (p?.name === 'macbook') {
        this.add(
          new Surface({ mesh: m, material: mat, width: 1536, height: 960, mirror: false, screen: 'laptop' }),
        )
      }
    })
    // Догрузка снимков галереи приходит асинхронно и должна сама
    // попросить перерисовку — состояние при этом не меняется.
    setImageReadyHandler(() => this.markDirty())
    // Дерево контента монтирует entry.ts: оно нужно и в режиме страницы,
    // где сцены нет вообще, поэтому это не забота экранов.
  }

  /** Картинка догрузилась — перерисовать. Иначе снимок появлялся бы на
   *  экране только после следующего клика. */
  markDirty() {
    for (const s of this.surfaces) s.forceRedraw()
  }

  private add(s: Surface) {
    this.surfaces.push(s)
    s.mesh.traverse((o) => this.byMesh.set(o, s))
  }

  forMesh(o: THREE.Object3D | null | undefined): Interactive | null {
    return o ? (this.byMesh.get(o) ?? null) : null
  }

  /**
   * Часы в строке меню — ХЕЛЬСИНКСКИЕ, те же, по которым живёт небо за
   * окном. Строку считает `sky/time.ts`, здесь она только показывается:
   * два места, вычисляющие «который час», рано или поздно разойдутся.
   */
  tick(daylight: number, calls: number, clock: string) {
    if (clock !== this.lastClock) {
      this.lastClock = clock
      for (const s of this.surfaces) s.setClock(clock, daylight > 0.5 ? 1 : 0)
      this.tablet?.setClock(clock)
    }
    for (const s of this.surfaces) s.setCalls(calls)
  }

  /**
   * Собственное время экранов. Всё остальное здесь перерисовывается по
   * событию, и до игры такого вызова не было вовсе: он приходит КАЖДЫЙ
   * кадр с дельтой времени, потому что падение фигуры считается секундами,
   * а не кадрами — иначе на 120 Гц она полетела бы вдвое быстрее.
   */
  tickGame(dt: number) {
    for (const s of this.surfaces) s.tickGame(dt)
  }

  /** `nowMs` нужен планшету: дорожка идёт по настоящим часам, а не по
   *  числу кадров, — иначе на 120 Гц трек играл бы вдвое быстрее. */
  flush(nowMs: number) {
    for (const s of this.surfaces) s.flush()
    this.tablet?.flush(nowMs)
    this.book?.flush(nowMs)
  }

  resetAll() {
    for (const s of this.surfaces) s.reset()
    // Планшет и книга тоже возвращаются к тому виду, в котором их
    // показывают издалека: список того, что играло, и раскрытая книга
    // издали читаются как что-то недозакрытое.
    this.tablet?.reset()
    this.book?.reset()
  }
}
