import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { BEVEL, BEVEL_SEGMENTS } from '../constants'

/**
 * Геометрические примитивы проекта.
 *
 * ПРАВИЛО: голый BoxGeometry в этом проекте не используется никогда.
 * Идеально острое ребро — самый заметный признак «сгенерированного» объекта:
 * оно не ловит блик, поэтому силуэт читается как программерская заглушка.
 * Фаска в 3-12 мм стоит два лишних сегмента и переворачивает впечатление.
 */

/** Скруглённый параллелепипед. Замена BoxGeometry во всех случаях. */
export function box(
  w: number,
  h: number,
  d: number,
  bevel: number = BEVEL.md,
): THREE.BufferGeometry {
  // RoundedBoxGeometry падает, если радиус >= половины наименьшей стороны
  const safe = Math.min(bevel, Math.min(w, h, d) / 2 - 1e-4)
  if (safe <= 1e-4) return new THREE.BoxGeometry(w, h, d)
  return new RoundedBoxGeometry(w, h, d, BEVEL_SEGMENTS, safe)
}

/**
 * Тесселированный параллелепипед для крупных поверхностей — стен, пола,
 * потолка. Вершинный бейк ровно настолько подробен, насколько подробна
 * сетка: на восьми вершинах куба градиент отражённого света просто
 * негде записать. Плотность задаётся в вершинах на метр.
 *
 * Фаски здесь нет намеренно: на стене её всё равно не видно, а лишние
 * вершины по краям только сгущают выборку там, где она не нужна.
 *
 * ПЛОТНОСТЬ 7/м — ОТКАТ. На 25 дневная картинка ушла в пересвет
 * (столешница 1.155 против 0.3465), причину установить не удалось,
 * потому что плотность и источник менялись в одном прогоне.
 * Прежняя причина поднять её остаётся в силе: При 7 дневного света хватало —
 * окно большой источник, градиент пологий. Но точечная лампа даёт резкий
 * спад, а между вершинами идёт линейная интерполяция: ночные стены шли
 * полигональными кляксами. Цена прямая — бейк линеен по числу вершин,
 * ЗАМЕРЕНО: рост дешевле, чем кажется. Основная масса вершин сцены —
 * это ПРЕДМЕТЫ (трубы кресла, пружины, рёбра радиатора, клавиши), а не
 * оболочка. Переход с 7 на 14 дал всего +9% к общему числу вершин.
 */
export function slab(w: number, h: number, d: number, perMetre = 7): THREE.BufferGeometry {
  const seg = (x: number) => Math.max(1, Math.round(x * perMetre))
  return new THREE.BoxGeometry(w, h, d, seg(w), seg(h), seg(d))
}

/** Цилиндр вдоль Y с закрытыми торцами. */
export function rod(radius: number, length: number, radial = 16): THREE.BufferGeometry {
  return new THREE.CylinderGeometry(radius, radius, length, radial, 1, false)
}

/**
 * Пружина: труба, протянутая по винтовой линии.
 * Для шарнирной лампы это не украшение — без пружин рука читается
 * как две палки, а с ними сразу как механизм.
 */
export function spring(
  length: number,
  coilRadius: number,
  turns: number,
  wireRadius = 0.0022,
): THREE.BufferGeometry {
  const pts: THREE.Vector3[] = []
  const steps = turns * 12
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    const a = t * turns * Math.PI * 2
    pts.push(new THREE.Vector3(Math.cos(a) * coilRadius, t * length, Math.sin(a) * coilRadius))
  }
  const curve = new THREE.CatmullRomCurve3(pts)
  return new THREE.TubeGeometry(curve, steps, wireRadius, 6, false)
}

/**
 * Купол абажура через LatheGeometry — профиль вращается вокруг оси.
 *
 * Профиль строится от макушки (0, 0) вниз к юбке (radius, -height):
 * макушка в начале координат, раструб смотрит в −Y. Благодаря этому
 * плафон вешается на шейку без дополнительных разворотов, а ориентацию
 * целиком определяет поворот шарнира головы.
 */
export function domeShade(radius: number, height: number, segments = 32): THREE.BufferGeometry {
  const profile: THREE.Vector2[] = []
  const steps = 14
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    // Слегка вогнутая юбка — как у настоящего эмалированного плафона,
    // прямой конус выглядит как воронка из примитива.
    const r = radius * Math.pow(t, 0.78)
    const y = -height * Math.pow(t, 1.35)
    profile.push(new THREE.Vector2(Math.max(r, 1e-4), y))
  }
  return new THREE.LatheGeometry(profile, segments)
}

/** Тор для шарнирных «костяшек» и колец. */
export function knuckle(radius: number, tube: number): THREE.BufferGeometry {
  return new THREE.TorusGeometry(radius, tube, 8, 20)
}

/**
 * Труба по произвольной ломаной, сглаженной сплайном.
 * Основной инструмент для гнутых стальных рам: каркас кресла, дуги,
 * подлокотники. Замкнутый контур даёт петлю без швов.
 */
export function tube(
  points: [number, number, number][],
  radius: number,
  closed = false,
  tubular = 64,
  radial = 8,
): THREE.BufferGeometry {
  const curve = new THREE.CatmullRomCurve3(
    points.map((p) => new THREE.Vector3(...p)),
    closed,
    'catmullrom',
    0.5,
  )
  return new THREE.TubeGeometry(curve, tubular, radius, radial, closed)
}
