import * as THREE from 'three'
import { computeBoundsTree, disposeBoundsTree, acceleratedRaycast } from 'three-mesh-bvh'
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import {
  HOTSPOTS,
  OVERVIEW,
  type CameraPose,
  type Hotspot,
  type HotspotSwitch,
  type HotspotSpin,
} from './hotspots'
import type { Screens, Surface } from '../screens/screens'
import type { GameKey } from '../screens/tetris'

/**
 * Режим фокуса: наведение, клик, подлёт камеры — и работа с интерфейсом
 * прямо на экране, когда камера уже подлетела.
 *
 * Почему это делается ПЕРВЫМ, а не последним: ультраширокий монитор
 * занимает около 15% ширины обзорного кадра. Никакой текст на нём не
 * читается без подлёта — значит фокус не полировка, а единственный
 * канал доставки контента.
 *
 * Второй уровень появился вместе с рабочим столом: в фокусе указатель
 * перестаёт выбирать ПРЕДМЕТЫ и начинает выбирать ОБЛАСТИ ЭКРАНА.
 * Один и тот же рейкаст, но попадание берётся из `intersection.uv`
 * и уходит в Screens, а не в реестр хотспотов.
 */

// Ускоренный рейкаст. Тот же BVH, что строился для бейка: без него
// 77 140 треугольников сцены (FACTS.triangles, живой замер countTriangles)
// на каждое движение мыши съедают кадр.
THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree
THREE.Mesh.prototype.raycast = acceleratedRaycast

const EASE = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)
const EASE_TARGET = (t: number) => 1 - Math.pow(1 - t, 4)

const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches
/** Наведения на пальце не существует: подпись показывать некому, а рейкаст
 *  на 30 Гц ради неё — чистая трата кадра. */
const coarse = matchMedia('(pointer: coarse)').matches

interface Transition {
  from: CameraPose
  to: CameraPose
  start: number
  duration: number
  /**
   * Куда летим. Клик во время ВОЗВРАТА в комнату надо игнорировать: под
   * курсором ещё тот предмет, из которого посетитель только что вышел, и
   * он провалился бы обратно. Клик во время ПОДЛЁТА игнорировать нечего —
   * попадание считается по живой камере и потому верно.
   */
  kind: 'enter' | 'exit'
}

export interface FocusSystem {
  update(now: number): void
  /**
   * Погасить фокус снаружи — из `applyMode()`, когда комната закрылась.
   *
   * Фокус живёт в DOM (`.focus-hint`, `.hotspot-label` висят на `<body>`,
   * а не внутри холста) и в состоянии контролов, поэтому закрытие комнаты
   * само по себе его не снимает: крестик оставлял `controls.enabled =
   * false`, плашку с подсказкой поверх страницы и экраны в раскрытом
   * документе — а повторный вход возвращал камеру вплотную к монитору с
   * мёртвой орбитой.
   */
  exit(): void
  dispose(): void
}

export function createFocus(
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera,
  controls: OrbitControls,
  canvas: HTMLCanvasElement,
  screens: Screens,
  /** Переключатели по id хотспота — для предметов с kind: 'switch'. */
  switches: Record<string, HotspotSwitch> = {},
  /** Вращаемые предметы по id хотспота — для kind: 'spin'. */
  spinners: Record<string, HotspotSpin> = {},
  /** Какой реестр обходить. На телефоне он короче: см. MOBILE_HOTSPOTS. */
  hotspots: Hotspot[] = HOTSPOTS,
): FocusSystem {
  // ---- разрешение хотспотов в реальные меши ----
  const pickables: THREE.Mesh[] = []
  const ownerOf = new Map<THREE.Object3D, Hotspot>()
  /** Экран, живущий внутри предмета. У монитора и ноутбука он есть,
   *  у будущих хотспотов (лампа, сертификат) его не будет. */
  const surfaceOf = new Map<Hotspot, Surface>()

  for (const h of hotspots) {
    const root = scene.getObjectByName(h.meshName)
    if (!root) {
      console.warn(`[focus] хотспот «${h.id}»: узел "${h.meshName}" не найден`)
      continue
    }
    // Кликабельна вся подветка: у ноутбука это крышка, экран, корпус —
    // попадание в любой из них должно означать «кликнули ноутбук».
    root.traverse((o) => {
      const m = o as THREE.Mesh
      if (!m.isMesh) return
      m.geometry.computeBoundsTree?.()
      pickables.push(m)
      ownerOf.set(m, h)
      const s = screens.forMesh(m)
      if (s) surfaceOf.set(h, s)
    })
  }

  // ---- DOM ----
  const hud = document.createElement('div')
  hud.className = 'hotspot-label'
  hud.setAttribute('aria-hidden', 'true')
  document.body.appendChild(hud)

  const hint = document.createElement('div')
  hint.className = 'focus-hint'
  hint.hidden = true
  document.body.appendChild(hint)

  // ---- состояние ----
  const raycaster = new THREE.Raycaster()
  raycaster.firstHitOnly = true
  const pointer = new THREE.Vector2()
  let hovered: Hotspot | null = null
  let active: Hotspot | null = null
  let activeSurface: Surface | null = null
  let transition: Transition | null = null
  let lastPick = 0

  const currentPose = (): CameraPose => ({
    position: camera.position.toArray() as [number, number, number],
    target: controls.target.toArray() as [number, number, number],
    fov: camera.fov,
  })

  /**
   * Перелёт камеры.
   *
   * ДЛИТЕЛЬНОСТЬ. Было 900 мс, и это оказалось главной причиной жалоб на
   * «нажимаю, а он думает две секунды». Дело не в кадрах: сцена держит 60,
   * первый рендер самого тяжёлого документа стоит 37 мс, а торможение
   * процессора в шесть раз ничего не меняет. Дело в том, что 900 мс —
   * это дольше, чем человек готов считать откликом, и он жмёт ещё раз.
   * 520 мс хватает, чтобы кадр читался как движение, а не как склейка.
   */
  function flyTo(to: CameraPose, now: number, kind: Transition['kind']) {
    if (reducedMotion) {
      camera.position.set(...to.position)
      controls.target.set(...to.target)
      camera.fov = to.fov
      camera.updateProjectionMatrix()
      controls.update()
      transition = null
      return
    }
    transition = { from: currentPose(), to, start: now, duration: 520, kind }
  }

  function setHint() {
    if (!activeSurface) return
    hint.textContent =
      activeSurface.view !== 'app'
        ? 'click an app · esc to leave'
        : activeSurface.appId === 'tetris'
          ? '← → move · ↓ soft drop · ↑ rotate · space hard drop · esc to go back'
          : 'scroll to read · ← → to move · esc to go back'
  }

  function enterFocus(h: Hotspot, now: number) {
    active = h
    activeSurface = surfaceOf.get(h) ?? null
    controls.enabled = false
    hud.style.opacity = '0'
    flyTo(h.pose, now, 'enter')
    hint.hidden = false
    setHint()
  }

  function exitFocus() {
    if (!active) return
    active = null
    activeSurface = null
    hint.hidden = true
    // Возвращаясь в комнату, оба экрана показывают рабочий стол: издалека
    // сетка значков читается как «сюда можно нажать», а раскрытый документ —
    // как нечитаемая простыня.
    screens.resetAll()
    controls.enabled = true
    flyTo(OVERVIEW, performance.now(), 'exit')
  }

  /**
   * Тот же выход, но снаружи и без предусловия «фокус сейчас есть».
   *
   * `exitFocus()` выходит первой строкой, когда `active === null`, — и это
   * правильно для клика: гасить нечего. Закрытие комнаты — другой случай.
   * Оно приходит НЕ от указателя, а значит обрывает всё, что указатель
   * сейчас делал, и незакрытые жесты остаются висеть: `pointerup`, который
   * их закрывает, в холст уже не придёт — холст спрятан.
   *
   * Поэтому здесь собрано то, что фокусу не принадлежит, но переживает
   * закрытие комнаты:
   *  — подпись под курсором зажигается наведением в ОБЗОРНОЙ комнате, а
   *    гасит её рейкаст кадрового цикла, которого после закрытия уже нет:
   *    осталась бы висеть поверх страницы;
   *  — `activeId` («какой указатель ведёт жест») без `pointerup` остаётся
   *    заполненным НАВСЕГДА, и `onDown` дальше выходит первой же строкой —
   *    после возврата в комнату кресло больше не тащится вообще;
   *  — `spinning` закрывается своим же `end()`, а не обнуляется: кресло
   *    должно доработать выбег по правилам предмета, а не застыть на
   *    полускорости.
   */
  function leaveFocus() {
    exitFocus()
    hovered = null
    hud.style.opacity = '0'
    spinning?.end()
    spinning = null
    activeId = null
    dragMoved = 0
    canvas.style.cursor = 'default'
    // Явно, а не «оно и так true»: орбита — то, ради чего этот вызов и
    // существует, и её состояние не должно зависеть от того, по какой из
    // веток выше мы сюда пришли.
    controls.enabled = true
  }

  // ---- ввод ----
  function updatePointer(e: PointerEvent) {
    pointer.x = (e.clientX / innerWidth) * 2 - 1
    pointer.y = -(e.clientY / innerHeight) * 2 + 1
    hud.style.transform = `translate(${e.clientX + 16}px, ${e.clientY + 14}px)`
  }

  function pick() {
    raycaster.setFromCamera(pointer, camera)
    return raycaster.intersectObjects(pickables, false)[0] ?? null
  }

  /**
   * Перетаскивание вращаемого предмета.
   *
   * `pointerdown` слушается в ФАЗЕ ПЕРЕХВАТА и останавливает всплытие,
   * когда попали в кресло. Иначе орбита камеры, которая слушает тот же
   * холст и подписалась раньше нас, начнёт крутить сцену одновременно с
   * креслом, и потащить получится только их вместе.
   */
  let spinning: HotspotSpin | null = null
  let dragMoved = 0
  /**
   * Какой указатель ведёт жест. Второй палец приходит в те же обработчики,
   * и без этого фильтра пинч засчитывался бы как продолжение первого
   * протаскивания — с чужими координатами.
   */
  let activeId: number | null = null
  /** Точка нажатия — от неё, а не накоплением, считается протаскивание.
   *  Причина в WebKit: у событий указателя с pointerType 'touch' там нет
   *  movementX/movementY (ни в Safari, ни в «Chrome для iOS» — под капотом
   *  тот же WebKit), они молча равны нулю. Порог на накоплении такой
   *  дельты на айфоне никогда не срабатывал бы — любой жест дочитывался
   *  бы как клик в точке отпускания. Разница координат от точки нажатия
   *  этой зависимости не имеет, WebKit её не обязан считать сам.
   */
  let downX = 0
  let downY = 0

  const onDown = (e: PointerEvent) => {
    if (activeId !== null) return
    // Начало жеста сбрасывает порог ВСЕГДА, даже когда мы в фокусе или
    // камера ещё летит. Иначе так: посетитель покрутил комнату (порог
    // вырос до сотни пикселей), ткнул в предмет, и следующий его клик
    // сравнивается со СТАРЫМ порогом — потому что в перелёте эта функция
    // раньше выходила первой строкой и до сброса не доходила. Клик
    // пропадал молча, и человек жал ещё раз.
    activeId = e.pointerId
    downX = e.clientX
    downY = e.clientY
    dragMoved = 0
    if (active || transition) return
    updatePointer(e)
    const hit = pick()
    const h = hit ? ownerOf.get(hit.object) : undefined
    const sp = h?.kind === 'spin' ? spinners[h.id] : undefined
    if (!sp) return
    e.stopPropagation()
    e.preventDefault()
    spinning = sp
    sp.begin(e.clientX)
    canvas.setPointerCapture?.(e.pointerId)
    canvas.style.cursor = 'grabbing'
  }

  const onUp = (e: PointerEvent) => {
    if (activeId !== null && e.pointerId !== activeId) return
    activeId = null
    if (!spinning) return
    spinning.end()
    spinning = null
    canvas.releasePointerCapture?.(e.pointerId)
    canvas.style.cursor = 'grab'
  }

  const onMove = (e: PointerEvent) => {
    if (activeId !== null && e.pointerId !== activeId) return
    // Порог считается для ЛЮБОГО протаскивания, а не только за креслом:
    // иначе свайп по комнате читается как клик. Расстояние от точки
    // нажатия, а НЕ накопление за жест: увести палец и вернуть его на
    // место — по существу тап, и накопленная сумма шагов соврала бы,
    // посчитав это протаскиванием.
    if (activeId !== null) dragMoved = Math.hypot(e.clientX - downX, e.clientY - downY)
    if (spinning) {
      spinning.drag(e.clientX)
      return
    }
    updatePointer(e)
  }

  const onClick = (e: PointerEvent) => {
    // Игнорируется только клик во время ВОЗВРАТА в комнату: под курсором
    // ещё тот предмет, из которого посетитель вышел, и он провалился бы
    // обратно. Раньше отбрасывался любой клик за время перелёта, и это
    // была вторая половина жалобы «нажимаю, а ничего»: человек нажимал
    // на плитку, не дожидаясь конца подлёта, и его нажатие исчезало.
    // Подлёту бояться нечего — попадание считается по живой камере.
    if (transition?.kind === 'exit') return
    // Клик, пришедший в конце протаскивания, — не клик. Без этого
    // раскрутка кресла (а на телефоне — любой свайп по комнате)
    // заканчивалась бы подлётом камеры. Порог выше, чем на мыши: палец
    // дрожит сильнее.
    if (dragMoved > 10) {
      dragMoved = 0
      return
    }
    updatePointer(e)
    const hit = pick()

    if (!active) {
      const h = hit ? ownerOf.get(hit.object) : undefined
      if (!h) return
      // Предмет-выключатель срабатывает на месте: камера остаётся там,
      // где стояла, потому что смотреть надо на комнату, а не на предмет.
      // Вращаемый предмет реагирует на протаскивание, а не на клик:
      // одиночный щелчок по нему не должен ничего делать.
      if (h.kind === 'spin') return
      const sw = h.kind === 'switch' ? switches[h.id] : undefined
      if (sw) {
        sw.toggle()
        // Подпись обновляется тут же, под курсором: посетитель не уводил
        // мышь, а смысл следующего клика уже другой.
        hud.textContent = sw.label()
        return
      }
      // Выключатель без реализации — всё равно выключатель: у него нет позы
      // для подлёта, `pose` в реестре стоит формально. Без этой строки
      // предмет, для которого переключатель не передали (createLampSwitch
      // вернул null — лампы в сцене не нашлось), уносил бы камеру в фокус.
      if (h.kind === 'switch') return
      enterFocus(h, performance.now())
      return
    }

    // В фокусе клик сначала предлагается экрану: плитка приложения,
    // кнопка закрытия и стрелки деки живут ВНУТРИ текстуры.
    if (activeSurface && hit?.uv && screens.forMesh(hit.object) === activeSurface) {
      const result = activeSurface.click(hit.uv)
      if (result === 'exit') exitFocus()
      else setHint()
      return
    }
    // Пока камера ЕЩЁ ЛЕТИТ к предмету, промах наружу не считается: с
    // полпути в плитку не целятся, а выбросить нетерпеливого посетителя
    // обратно в комнату — худшее, что можно сделать в ответ на его
    // нажатие. Нетерпеливый клик во время подлёта может только помочь
    // (попасть в плитку), но не отменить то, что он сам же и попросил.
    if (transition) return
    // Клик мимо экрана — выход. Промах по интерфейсу трактуется как
    // «хочу обратно в комнату», а не молчаливо игнорируется.
    if (!hit || ownerOf.get(hit.object) !== active) exitFocus()
  }

  const onWheel = (e: WheelEvent) => {
    if (!active || !activeSurface) return
    if (activeSurface.scrollBy(e.deltaY)) e.preventDefault()
  }

  /**
   * Клавиши игры. Разложены таблицей, а не цепочкой `if`, потому что их
   * надо ловить дважды — на нажатие и на отпускание: сдвиг вбок держится
   * зажатой стрелкой, и без `keyup` фигура уехала бы в стенку.
   */
  const GAME_KEYS: Record<string, GameKey> = {
    ArrowLeft: 'left',
    ArrowRight: 'right',
    ArrowDown: 'down',
    ArrowUp: 'rotate',
    ' ': 'drop',
    Enter: 'start',
  }

  const onKey = (e: KeyboardEvent) => {
    if (!active) return
    if (e.key === 'Escape') {
      if (activeSurface?.back() === 'exit') exitFocus()
      else setHint()
      return
    }
    if (!activeSurface) return
    // Игре клавиши предлагаются ПЕРВОЙ: пока тетрис открыт, стрелки
    // достаются ему, а не скроллу документа и не деке. Esc остаётся выше
    // игры — из неё надо уметь выйти.
    const g = GAME_KEYS[e.key]
    if (g && activeSurface.key(g, true)) {
      e.preventDefault()
      return
    }
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      if (activeSurface.arrow(1)) e.preventDefault()
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      if (activeSurface.arrow(-1)) e.preventDefault()
    }
  }

  const onKeyUp = (e: KeyboardEvent) => {
    if (!active || !activeSurface) return
    const g = GAME_KEYS[e.key]
    if (g) activeSurface.key(g, false)
  }

  canvas.addEventListener('pointerdown', onDown as EventListener, { capture: true })
  canvas.addEventListener('pointerup', onUp as EventListener)
  canvas.addEventListener('pointercancel', onUp as EventListener)
  canvas.addEventListener('pointermove', onMove)
  canvas.addEventListener('click', onClick as EventListener)
  canvas.addEventListener('wheel', onWheel, { passive: false })
  addEventListener('keydown', onKey)
  addEventListener('keyup', onKeyUp)

  // ---- кадр ----
  function update(now: number) {
    // переход камеры
    if (transition) {
      const t = Math.min(1, (now - transition.start) / transition.duration)
      const { from, to } = transition
      // Разный easing на позиции и на цели — иначе кадр «плывёт»:
      // точка внимания должна приходить раньше, чем камера доедет.
      const ep = EASE(t)
      const et = EASE_TARGET(t)
      for (let i = 0; i < 3; i++) {
        camera.position.setComponent(i, from.position[i] + (to.position[i] - from.position[i]) * ep)
        controls.target.setComponent(i, from.target[i] + (to.target[i] - from.target[i]) * et)
      }
      camera.fov = from.fov + (to.fov - from.fov) * ep
      camera.updateProjectionMatrix()
      if (t >= 1) transition = null
    }

    // Рейкаст троттлим до ~30 Гц: на каждое движение мыши он не нужен,
    // а стоит заметно дороже, чем кажется.
    if (!coarse && now - lastPick > 33) {
      lastPick = now
      const hit = transition ? null : pick()

      if (active) {
        // В фокусе наводка идёт по областям экрана, а не по предметам,
        // и только по тому экрану, на который мы смотрим.
        const onScreen =
          !!hit?.uv && !!activeSurface && screens.forMesh(hit.object) === activeSurface
        const over = onScreen ? activeSurface!.hover(hit!.uv!) : (activeSurface?.hover(null) ?? false)
        canvas.style.cursor = over ? 'pointer' : 'default'
        hud.style.opacity = '0'
      } else {
        const h = hit ? (ownerOf.get(hit.object) ?? null) : null
        if (h !== hovered && !spinning) {
          hovered = h
          // Курсор говорит, ЧТО с предметом делать: щёлкнуть или тащить.
          canvas.style.cursor = !h ? 'default' : h.kind === 'spin' ? 'grab' : 'pointer'
          // У выключателя подпись зависит от состояния, а не от реестра.
          const sw = h && h.kind === 'switch' ? switches[h.id] : undefined
          hud.textContent = sw ? sw.label() : (h?.label ?? '')
          hud.style.opacity = h ? '1' : '0'
        }
      }
    }
  }

  function dispose() {
    canvas.removeEventListener('pointerdown', onDown as EventListener, { capture: true })
    canvas.removeEventListener('pointerup', onUp as EventListener)
    canvas.removeEventListener('pointercancel', onUp as EventListener)
    canvas.removeEventListener('pointermove', onMove)
    canvas.removeEventListener('click', onClick as EventListener)
    canvas.removeEventListener('wheel', onWheel)
    removeEventListener('keydown', onKey)
    removeEventListener('keyup', onKeyUp)
    hud.remove()
    hint.remove()
    for (const m of pickables) m.geometry.disposeBoundsTree?.()
  }

  return { update, exit: leaveFocus, dispose }
}
