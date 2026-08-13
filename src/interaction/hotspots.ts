import { BOOK, DESK, MONITOR, TABLET, WORKSTATION } from '../constants'

/**
 * Реестр интерактивных объектов — единственный источник правды о том,
 * что в комнате кликабельно и куда при этом летит камера.
 *
 * Позы камеры сняты РУКАМИ через dumpCamera() в консоли и закоммичены сюда.
 * Они намеренно не вычисляются из габаритного ящика: автоматический подлёт
 * всегда выглядит как автоматический — кадр получается технически верным
 * и композиционно мёртвым. Эти семь чисел на предмет стоят того, чтобы
 * их подобрать глазами один раз.
 */

export interface CameraPose {
  position: [number, number, number]
  target: [number, number, number]
  fov: number
}

export interface Hotspot {
  id: string
  /**
   * Имя УЗЛА в сцене: кликабельна вся его подветка. Для монитора это
   * группа целиком, а не только полотно — попадание в рамку или в стойку
   * тоже означает «кликнули монитор». Что делать с самим полотном,
   * дальше решает Screens по uv.
   */
  meshName: string
  /** Подпись при наведении */
  label: string
  /** Поза камеры в режиме фокуса */
  pose: CameraPose
  /**
   * Что делает клик.
   *
   * `focus` (по умолчанию) — подлёт камеры и работа с интерфейсом предмета.
   * `switch` — предмет переключается НА МЕСТЕ, камера не двигается. Для
   * лампы подлёт был бы издевательством: смысл щелчка в том, чтобы
   * увидеть, как меняется свет во всей комнате, а не разглядывать колбу.
   */
  kind?: 'focus' | 'switch' | 'spin'
}

/** Переключатель предмета, живущий на месте. Реестр знает только имя;
 *  само поведение приносит сцена, потому что ей принадлежат источники. */
export interface HotspotSwitch {
  toggle(): void
  label(): string
}

/** Предмет, который тащат указателем. Ввод отдаёт ему только координату
 *  по X: ось вращения — своя у каждого предмета, и знать о ней вводу
 *  незачем. */
export interface HotspotSpin {
  begin(clientX: number): void
  drag(clientX: number): void
  end(): void
  dragging(): boolean
  label(): string
}

/** Обзорная поза — сюда возвращаемся по Esc и по клику в пустоту. */
export const OVERVIEW: CameraPose = {
  position: [3.3, 1.68, 2.45],
  target: [0.95, 0.9, 1.05],
  fov: 54,
}

/** Высота центра полотна монитора — считается, а не вбивается,
 *  чтобы поза не разъехалась при правке габаритов стола. */
const SCREEN_Y = DESK.height + MONITOR.neckH + MONITOR.screenH / 2

/**
 * Поза для маленького предмета на столе.
 *
 * У монитора и ноутбука позы сняты руками через `dumpCamera()` — и это
 * правильно: там кадр композиционный, и вычисленный подлёт выглядел бы
 * вычисленным. У планшета и книги задача другая и куда более узкая:
 * поставить камеру перед плоскостью, чтобы на ней можно было ЧИТАТЬ.
 * Тут «на глаз» — это лишний источник ошибки, а не авторский жест:
 * предметы мелкие, и промах в пять сантиметров уводит их из кадра.
 *
 * Считается от локальных координат рабочего места. Разворот на π/2 у
 * `WORKSTATION` переводит локальный +X в мировой −Z, а локальный +Z — в
 * мировой +X; отсюда две строки ниже.
 */
function deskPose(
  local: { x: number; y: number; z: number },
  normal: { x: number; y: number; z: number },
  distance: number,
  fov: number,
): CameraPose {
  const world = {
    x: WORKSTATION.posX + local.z,
    y: local.y,
    z: WORKSTATION.posZ - local.x,
  }
  const n = { x: normal.z, y: normal.y, z: -normal.x }
  return {
    position: [world.x + n.x * distance, world.y + n.y * distance, world.z + n.z * distance],
    target: [world.x, world.y, world.z],
    fov,
  }
}

/** Планшет: экран откинут назад на TABLET.tilt, значит и нормаль у него
 *  наклонена ровно на столько же. */
const TABLET_LOCAL_X = -0.4
const TABLET_LOCAL_Z = 0.1
const tabletCos = Math.cos(TABLET.tilt)
const tabletSin = Math.sin(TABLET.tilt)
const TABLET_POSE = deskPose(
  {
    x: TABLET_LOCAL_X,
    y: DESK.height + 0.003 + (TABLET.h / 2) * tabletCos + (TABLET.thickness / 2) * tabletSin,
    z: TABLET_LOCAL_Z - (TABLET.h / 2) * tabletSin + (TABLET.thickness / 2) * tabletCos,
  },
  { x: 0, y: tabletSin, z: tabletCos },
  0.55,
  30,
)

/**
 * Книга лежит плашмя, поэтому смотрим сверху и чуть под углом: строго
 * сверху разворот читается как скан, а не как книга на столе.
 *
 * ДВЕ ВЕЩИ, БЕЗ КОТОРЫХ КАДР КОСОЙ, и обе видны только на живой сцене.
 *
 * Первая: целиться надо в центр РАЗВОРОТА, а не в начало координат книги.
 * Разворот раскрывается влево от корешка, то есть его середина — это сам
 * корешок, смещённый от центра книги на полширины.
 *
 * Вторая: книгу кладут с разворотом на 0.31 радиана — её КЛАДУТ, а не
 * ставят по линейке. Наклон камеры поэтому берётся не в мировых осях, а
 * вдоль страницы: горизонталь кадра обязана совпасть с направлением
 * строки. С мировым наклоном текст выходил повёрнутым на те же 18°,
 * и это было первое, что бросилось в глаза на скриншоте.
 */
const BOOK_LOCAL_X = -0.05
const BOOK_LOCAL_Z = 0.22
const BOOK_YAW = 0.31
/** Середина разворота = корешок: полширины книги в её собственном −X. */
const BOOK_SPREAD_X = BOOK_LOCAL_X - (BOOK.w / 2) * Math.cos(BOOK_YAW)
const BOOK_SPREAD_Z = BOOK_LOCAL_Z + (BOOK.w / 2) * Math.sin(BOOK_YAW)
/** Наклон от вертикали. Синус уходит вдоль страницы (локальный +Z книги),
 *  а не в мировую ось. */
const BOOK_LEAN = 0.34
const BOOK_POSE = deskPose(
  {
    x: BOOK_SPREAD_X,
    y: DESK.height + BOOK.board * 2 + BOOK.block,
    z: BOOK_SPREAD_Z,
  },
  {
    x: Math.sin(BOOK_YAW) * BOOK_LEAN,
    y: Math.sqrt(1 - BOOK_LEAN * BOOK_LEAN),
    z: Math.cos(BOOK_YAW) * BOOK_LEAN,
  },
  0.42,
  34,
)

export const HOTSPOTS: Hotspot[] = [
  {
    id: 'monitor',
    meshName: 'monitor',
    label: 'Desktop',
    pose: {
      position: [1.42, SCREEN_Y + 0.02, 1.23],
      target: [0.42, SCREEN_Y, 1.23],
      fov: 34,
    },
  },
  {
    id: 'macbook',
    meshName: 'macbook',
    label: 'MacBook',
    // Поза подтянута под интерфейс: пока на матрице лежал один документ,
    // хватало общего плана, но по значку в 33% высоты кадра не попадают.
    // Камера пододвинута по той же оси взгляда до 0.58 м, цель — точный
    // центр матрицы (снят из сцены, а не на глаз), поле зрения сужено.
    pose: {
      position: [1.141, 0.97, 0.803],
      target: [0.577, 0.85, 0.744],
      fov: 28,
    },
  },
  {
    id: 'tablet',
    meshName: 'tablet',
    label: 'what is playing',
    pose: TABLET_POSE,
  },
  {
    id: 'book',
    meshName: 'book',
    label: 'read the book',
    pose: BOOK_POSE,
  },
  {
    id: 'chair',
    meshName: 'chair',
    label: 'spin the chair',
    kind: 'spin',
    // Как и у лампы, поза при kind: 'spin' не используется: камера
    // остаётся на месте, иначе не видно, как кресло крутится в комнате.
    pose: {
      position: [2.1, 1.25, 1.9],
      target: [1.35, 0.72, 0.6],
      fov: 40,
    },
  },
  {
    id: 'lamp',
    meshName: 'lamp',
    // Подпись перекрывается состоянием выключателя: «turn the lamp on»
    // после щелчка обязано стать «turn the lamp off», иначе наведение
    // врёт про то, что произойдёт.
    label: 'turn the lamp on',
    kind: 'switch',
    // Поза не используется при kind: 'switch', но поле обязательное, и
    // оставить его врущим хуже, чем заполнить осмысленно: это кадр на
    // случай, если лампа когда-нибудь всё-таки станет фокусируемой.
    pose: {
      position: [1.02, 1.12, 0.86],
      target: [0.62, 0.96, 0.62],
      fov: 32,
    },
  },
]

export function findHotspotByMeshName(name: string): Hotspot | undefined {
  return HOTSPOTS.find((h) => h.meshName === name)
}

/**
 * Что кликабельно с телефона.
 *
 * Ровно те предметы, которые срабатывают НА МЕСТЕ, без подлёта камеры:
 * лампа и кресло. Монитор и ноутбук сюда не попадают, потому что документы
 * на телефоне читают на странице — полотно монитора 2048 × 870, то есть
 * 21:9, и строка резюме на нём не читается даже в ландшафте.
 *
 * Побочная выгода не косметическая: `createFocus` строит BVH по КАЖДОМУ мешу
 * своего реестра, а монитор с ноутбуком — самые тяжёлые узлы сцены.
 */
export const MOBILE_HOTSPOTS: Hotspot[] = HOTSPOTS.filter(
  (h) => h.kind === 'switch' || h.kind === 'spin',
)
