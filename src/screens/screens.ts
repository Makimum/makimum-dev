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
import {
  NOW_PLAYING,
  elapsedAt,
  paintNowPlaying,
  paintProgress,
  type ProgressBand,
} from './nowPlaying'

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
export class NowPlaying {
  readonly mesh: THREE.Mesh
  private readonly panel: Panel
  private band: ProgressBand | null = null
  private background: CanvasGradient | string = '#000'
  private full = true
  private lastSecond = -1
  private clock = ''

  constructor(mesh: THREE.Mesh, material: THREE.MeshStandardMaterial) {
    this.mesh = mesh
    this.panel = new Panel({
      material,
      // 820 × 1180 — ровно половина настоящей матрицы iPad Air (1640 ×
      // 2360). Полного разрешения здесь не нужно: у планшета нет
      // хотспота, ближе минимального расстояния орбиты (0.6 м) камера
      // не подойдёт, а там экран занимает около трети высоты кадра.
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

  flush(nowMs: number) {
    const elapsed = elapsedAt(nowMs)
    const second = Math.floor(elapsed)

    if (this.full) {
      this.full = false
      this.lastSecond = second
      const r = paintNowPlaying(
        this.panel.ctx,
        this.panel.width,
        this.panel.height,
        NOW_PLAYING,
        elapsed,
        this.clock,
      )
      this.band = r.band
      this.background = r.background
      this.panel.uploaded()
      return
    }

    if (second === this.lastSecond || !this.band) return
    this.lastSecond = second
    paintProgress(this.panel.ctx, this.panel.width, this.band, this.background, NOW_PLAYING, elapsed)
    this.panel.uploaded()
  }
}

export class Screens {
  readonly surfaces: Surface[] = []
  /** Планшет. Отдельно от `surfaces`, потому что он не Surface и не
   *  участвует ни в наведении, ни в кликах, ни в игре. */
  tablet: NowPlaying | null = null
  private byMesh = new Map<THREE.Object3D, Surface>()
  private lastClock = ''

  constructor(scene: THREE.Scene) {
    // Все три экрана называются 'screen'; различаем по родителю.
    scene.traverse((o) => {
      const m = o as THREE.Mesh
      if (!m.isMesh || m.name !== 'screen') return
      const mat = m.material as THREE.MeshStandardMaterial
      let p: THREE.Object3D | null = m.parent
      while (p && p.name !== 'monitor' && p.name !== 'macbook' && p.name !== 'tablet') p = p.parent

      if (p?.name === 'tablet') {
        this.tablet = new NowPlaying(m, mat)
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

  forMesh(o: THREE.Object3D | null | undefined): Surface | null {
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
  }

  resetAll() {
    for (const s of this.surfaces) s.reset()
  }
}
