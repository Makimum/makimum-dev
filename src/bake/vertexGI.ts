import * as THREE from 'three'
import { MeshBVH } from 'three-mesh-bvh'

/**
 * Запекание глобального освещения в ВЕРШИННЫЕ ЦВЕТА.
 *
 * Почему так, а не в текстурный лайтмап, как в референсе:
 * лайтмап требует второго набора UV, а его надо получать развёрткой
 * (xatlas тянет WASM в воркере) и потом паковать в атлас. Для процедурной
 * геометрии, которой мы владеем целиком, есть более прямой путь —
 * просто дать поверхностям достаточно вершин и посчитать освещённость
 * в каждой. Ни развёртки, ни атласа, ни швов между чартами, ни единого
 * байта текстур в бандле.
 *
 * Схема двухпроходная — именно она даёт цветовой подмес:
 *   Проход 1: для каждой вершины считаем ПРЯМУЮ освещённость —
 *             сколько неба видно по полусфере (косинусно-взвешенно).
 *   Проход 2: повторяем трассировку, но там, где луч во что-то попал,
 *             берём альбедо задетой поверхности, умноженное на её
 *             освещённость из прохода 1. Это и есть отражённый свет:
 *             медовый паркет подмешивает тёплый тон в низ стены,
 *             а белый потолок — холодный в верх.
 *
 * Однократное отражение. Второго на глаз почти не видно, а стоит он ещё
 * столько же.
 */

/** Имя варианта освещения. Вариантов может быть сколько угодно —
 *  день и ночь это просто два первых. */
export type BakeVariant = string

export interface BakeOptions {
  /** Под каким ключом сложить результат в mesh.userData.bake */
  variant?: BakeVariant
  /** Лучей на вершину. 64 — рабочий минимум, 160 — чисто. */
  rays?: number
  /** Цвет и яркость неба за окном */
  skyColor?: THREE.Color
  skyIntensity?: number
  /** Направленный солнечный свет */
  sunDirection?: THREE.Vector3
  sunColor?: THREE.Color
  sunIntensity?: number
  /** Насколько сильно подмешивается отражённый свет */
  bounceStrength?: number
  /** Вклад светящихся поверхностей (лампа, экраны). От неба НЕ зависит. */
  emissiveStrength?: number
  /** Максимальная дальность луча (метры) — за ней считаем, что небо */
  maxDistance?: number
}

export interface BakeResult {
  vertices: number
  rays: number
  ms: number
}

const DEFAULTS: Required<BakeOptions> = {
  rays: 96,
  skyColor: new THREE.Color(0xbcd4ec),
  skyIntensity: 1.0,
  sunDirection: new THREE.Vector3(-0.35, 0.82, -0.45).normalize(),
  sunColor: new THREE.Color(0xfff0d8),
  sunIntensity: 2.1,
  bounceStrength: 1.0,
  emissiveStrength: 2.6,
  maxDistance: 14,
  variant: 'day',
}

/** Детерминированная последовательность Хаммерсли: равномернее случайной
 *  при том же числе лучей, и одинаковая при каждом запуске — бейк должен
 *  быть воспроизводимым, иначе его нельзя сравнивать между прогонами. */
function hammersley(i: number, n: number): [number, number] {
  let bits = i
  bits = (bits << 16) | (bits >>> 16)
  bits = ((bits & 0x55555555) << 1) | ((bits & 0xaaaaaaaa) >>> 1)
  bits = ((bits & 0x33333333) << 2) | ((bits & 0xcccccccc) >>> 2)
  bits = ((bits & 0x0f0f0f0f) << 4) | ((bits & 0xf0f0f0f0) >>> 4)
  bits = ((bits & 0x00ff00ff) << 8) | ((bits & 0xff00ff00) >>> 8)
  return [i / n, (bits >>> 0) * 2.3283064365386963e-10]
}

/** Косинусно-взвешенное направление в полусфере вокруг нормали.
 *  Косинусный вес — не украшение: он ровно компенсирует множитель N·L
 *  в интеграле освещённости, поэтому оценка сходится в разы быстрее. */
// Временные векторы уровня модуля. Аллокация внутри цикла трассировки
// недопустима: на миллионах лучей сборщик мусора съедает поток целиком
// и бейк выглядит как зависание, а не как медленный счёт.
const _t1 = new THREE.Vector3()
const _lv = new THREE.Vector3()
/** Теневых лучей на источник. Шесть хватает для мягкого края. */
const LIGHT_SAMPLES = 6
const _t2 = new THREE.Vector3()

function cosineHemisphere(n: THREE.Vector3, u1: number, u2: number, out: THREE.Vector3) {
  const r = Math.sqrt(u1)
  const theta = 2 * Math.PI * u2
  const x = r * Math.cos(theta)
  const y = r * Math.sin(theta)
  const z = Math.sqrt(Math.max(0, 1 - u1))

  // ортонормированный базис вокруг нормали (метод Frisvad)
  const sign = n.z >= 0 ? 1 : -1
  const a = -1 / (sign + n.z)
  const b = n.x * n.y * a
  _t1.set(1 + sign * n.x * n.x * a, sign * b, -sign * n.x)
  _t2.set(b, sign + n.y * n.y * a, -n.y)

  out.set(0, 0, 0).addScaledVector(_t1, x).addScaledVector(_t2, y).addScaledVector(n, z).normalize()
}

interface Target {
  mesh: THREE.Mesh
  albedo: THREE.Color
  /** Собственное свечение поверхности. Экраны, лампочка, небо в проёме —
   *  это ИСТОЧНИКИ, а не приёмники: их нельзя ни гасить подменой
   *  материала, ни исключать из расчёта отражённого света. */
  emissive: THREE.Color
  isEmissive: boolean
}

/** Собирает меши, которые участвуют в бейке. */
function collect(root: THREE.Object3D): Target[] {
  const out: Target[] = []
  root.traverse((o) => {
    const m = o as THREE.Mesh
    if (!m.isMesh || !m.geometry?.attributes?.position) return
    if (m.name === 'sky') return // заглушка проёма — источник, а не поверхность
    const mat = m.material as THREE.MeshStandardMaterial
    const albedo = mat?.color ? mat.color.clone() : new THREE.Color(0.7, 0.7, 0.7)
    const emissive = mat?.emissive
      ? mat.emissive.clone().multiplyScalar(mat.emissiveIntensity ?? 1)
      : new THREE.Color(0, 0, 0)
    const isEmissive = emissive.r + emissive.g + emissive.b > 0.02
    out.push({ mesh: m, albedo, emissive, isEmissive })
  })
  return out
}

/**
 * Строит один общий BVH по всей сцене в мировых координатах.
 * Один BVH на всё вместо BVH на меш: пересечение ищется за один запрос,
 * а не за N, и лучу не надо знать, в какой объект он летит.
 */
function buildSceneBVH(targets: Target[]): {
  bvh: MeshBVH
  albedoPerTri: Float32Array
  emissivePerTri: Float32Array
  /** Индекс меша (в порядке targets) для каждого треугольника */
  triMesh: Int32Array
  /** Три ИСХОДНЫХ индекса вершин на треугольник */
  triVerts: Int32Array
} {
  const positions: number[] = []
  const albedoPerTri: number[] = []
  const emissivePerTri: number[] = []
  const triMesh: number[] = []
  const triVerts: number[] = []
  const v = new THREE.Vector3()

  for (let mi = 0; mi < targets.length; mi++) {
    const { mesh, albedo, emissive } = targets[mi]
    mesh.updateWorldMatrix(true, false)
    const geo = mesh.geometry
    const pos = geo.attributes.position
    const idx = geo.index
    const count = idx ? idx.count : pos.count

    for (let i = 0; i < count; i++) {
      const vi = idx ? idx.getX(i) : i
      v.fromBufferAttribute(pos, vi).applyMatrix4(mesh.matrixWorld)
      positions.push(v.x, v.y, v.z)
      // Запоминаем, из какого меша и какой вершины пришёл этот угол
      // треугольника. Без этой связи луч, попавший в поверхность, знает
      // её ЦВЕТ, но не знает, сколько на неё падает света — а именно
      // это и отличает отражённый свет от равномерной серой заливки.
      triVerts.push(vi)
      if (i % 3 === 0) {
        albedoPerTri.push(albedo.r, albedo.g, albedo.b)
        emissivePerTri.push(emissive.r, emissive.g, emissive.b)
        triMesh.push(mi)
      }
    }
  }

  const merged = new THREE.BufferGeometry()
  merged.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  return {
    bvh: new MeshBVH(merged, { targetLeafSize: 8 }),
    albedoPerTri: new Float32Array(albedoPerTri),
    emissivePerTri: new Float32Array(emissivePerTri),
    triMesh: new Int32Array(triMesh),
    triVerts: new Int32Array(triVerts),
  }
}

export function bakeVertexGI(
  root: THREE.Object3D,
  options: BakeOptions = {},
): BakeResult {
  const o = { ...DEFAULTS, ...options }
  const t0 = performance.now()

  // Таблица Хаммерсли считается один раз на весь бейк: последовательность
  // зависит только от индекса луча, а не от вершины.
  const seq = new Float32Array(o.rays * 2)
  for (let s = 0; s < o.rays; s++) {
    const [a, b] = hammersley(s, o.rays)
    seq[s * 2] = a
    seq[s * 2 + 1] = b
  }

  const targets = collect(root)
  const { bvh, albedoPerTri, emissivePerTri, triMesh, triVerts } = buildSceneBVH(targets)
  const albedoOf = new Map<THREE.Mesh, THREE.Color>(targets.map((t) => [t.mesh, t.albedo]))

  const dir = new THREE.Vector3()
  const origin = new THREE.Vector3()
  const nrm = new THREE.Vector3()
  const normalMatrix = new THREE.Matrix3()

  /**
   * ЯВНЫЕ ИСТОЧНИКИ (next-event estimation).
   *
   * Лампочка — сфера радиусом 2.6 см под плафоном. Вероятность, что
   * случайный луч из полусферы попадёт в неё через раструб, ничтожна:
   * большинство вершин не получали от лампы НИЧЕГО, а редкие получали
   * всё сразу — классические firefly. Подбор множителя такое не лечит,
   * потому что проблема не в яркости, а в выборке.
   *
   * Решение стандартное: не надеяться на случайное попадание, а стрелять
   * из каждой вершины ПРЯМО в источник и проверять, не перекрыт ли путь.
   * Каждая вершина получает свет детерминированно, шум исчезает,
   * множитель перестаёт быть подгоночным.
   */
  interface Emitter {
    pos: THREE.Vector3
    radius: number
    color: THREE.Color
  }
  const emitters: Emitter[] = []
  for (const t of targets) {
    if (!t.isEmissive) continue
    t.mesh.updateWorldMatrix(true, false)
    t.mesh.geometry.computeBoundingSphere()
    const bs = t.mesh.geometry.boundingSphere
    if (!bs) continue
    const scale = new THREE.Vector3().setFromMatrixScale(t.mesh.matrixWorld)
    emitters.push({
      pos: bs.center.clone().applyMatrix4(t.mesh.matrixWorld),
      radius: Math.max(bs.radius * Math.max(scale.x, scale.y, scale.z), 0.012),
      color: t.emissive.clone(),
    })
  }

  // ---- ПРОХОД 1: прямая освещённость в каждой вершине ----
  interface VertexData {
    irradiance: Float32Array // rgb на вершину
    world: Float32Array
    normal: Float32Array
  }
  const perMesh = new Map<THREE.Mesh, VertexData>()
  const perMeshArr: VertexData[] = [] // тот же порядок, что targets/triMesh
  let totalVerts = 0

  for (const { mesh } of targets) {
    const geo = mesh.geometry
    const pos = geo.attributes.position
    const nor = geo.attributes.normal
    if (!nor) geo.computeVertexNormals()

    const n = pos.count
    const world = new Float32Array(n * 3)
    const normal = new Float32Array(n * 3)
    const irradiance = new Float32Array(n * 3)

    mesh.updateWorldMatrix(true, false)
    normalMatrix.getNormalMatrix(mesh.matrixWorld)

    for (let i = 0; i < n; i++) {
      origin.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld)
      nrm.fromBufferAttribute(geo.attributes.normal, i).applyMatrix3(normalMatrix).normalize()
      world[i * 3] = origin.x
      world[i * 3 + 1] = origin.y
      world[i * 3 + 2] = origin.z
      normal[i * 3] = nrm.x
      normal[i * 3 + 1] = nrm.y
      normal[i * 3 + 2] = nrm.z
    }

    const vd: VertexData = { irradiance, world, normal }
    perMesh.set(mesh, vd)
    perMeshArr.push(vd)
    totalVerts += n
  }

  const shadowRay = new THREE.Ray()

  const trace = (from: THREE.Vector3, d: THREE.Vector3) => {
    shadowRay.origin.copy(from)
    shadowRay.direction.copy(d)
    return bvh.raycastFirst(shadowRay, THREE.FrontSide)
  }

  for (const [, data] of perMesh) {
    const n = data.world.length / 3
    for (let i = 0; i < n; i++) {
      nrm.set(data.normal[i * 3], data.normal[i * 3 + 1], data.normal[i * 3 + 2])
      origin.set(data.world[i * 3], data.world[i * 3 + 1], data.world[i * 3 + 2])
      origin.addScaledVector(nrm, 0.002) // сдвиг от самопересечения

      let r = 0
      let g = 0
      let b = 0
      for (let s = 0; s < o.rays; s++) {
        cosineHemisphere(nrm, seq[s * 2], seq[s * 2 + 1], dir)
        const h = trace(origin, dir)
        if (!h || h.distance > o.maxDistance) {
          // луч ушёл в небо
          r += o.skyColor.r * o.skyIntensity
          g += o.skyColor.g * o.skyIntensity
          b += o.skyColor.b * o.skyIntensity
        }
      }
      const inv = 1 / o.rays
      // солнце: один теневой луч
      const sunDot = Math.max(0, nrm.dot(o.sunDirection))
      if (sunDot > 0) {
        const h = trace(origin, o.sunDirection)
        if (!h) {
          r += o.sunColor.r * o.sunIntensity * sunDot * o.rays
          g += o.sunColor.g * o.sunIntensity * sunDot * o.rays
          b += o.sunColor.b * o.sunIntensity * sunDot * o.rays
        }
      }
      // --- явная выборка источников ---
      // Множим на o.rays, потому что ниже всё делится на inv = 1/rays:
      // так вклад источника оказывается в тех же единицах, что и небо.
      for (const em of emitters) {
        _lv.subVectors(em.pos, origin)
        const dist = _lv.length()
        if (dist < 1e-4) continue
        _lv.divideScalar(dist)
        const ndl = nrm.dot(_lv)
        if (ndl <= 0) continue

        // Несколько лучей по диску источника — даёт мягкий край тени
        // вместо ступеньки, которую дал бы одиночный луч в центр.
        let vis = 0
        for (let sp = 0; sp < LIGHT_SAMPLES; sp++) {
          cosineHemisphere(_lv, seq[sp * 2] * 0.06, seq[sp * 2 + 1], dir)
          const h = trace(origin, dir)
          // Не перекрыт, если ничего не встретили ИЛИ встретили сам
          // источник: он тоже лежит в BVH, поэтому попадание на его
          // расстоянии — это и есть «дошли».
          if (!h || h.distance >= dist - em.radius * 1.5) vis++
        }
        if (!vis) continue

        const v = vis / LIGHT_SAMPLES
        // Телесный угол сферического источника ≈ π·r²/d², делённый на π
        // из ламбертовой нормировки — остаётся r²/d².
        const falloff = (em.radius * em.radius) / (dist * dist)
        const w = ndl * falloff * v * o.rays * o.emissiveStrength
        r += em.color.r * w
        g += em.color.g * w
        b += em.color.b * w
      }

      data.irradiance[i * 3] = r * inv
      data.irradiance[i * 3 + 1] = g * inv
      data.irradiance[i * 3 + 2] = b * inv
    }
  }

  // ---- Освещённость на треугольник ----
  // Мост между проходами. Луч в проходе 2 знает только faceIndex, а
  // освещённость посчитана по вершинам — усредняем её по трём углам
  // каждого треугольника. Это и есть та величина, которой не хватало:
  // отражённая яркость = АЛЬБЕДО поверхности × СВЕТ, на неё падающий.
  // Пока множителем стояла глобальная яркость неба, белая стена
  // «отражала» одинаково и под лампой, и в дальнем тёмном углу —
  // отсюда и бралась равномерная серая заливка вместо пятна света.
  const triCount = triMesh.length
  const irradiancePerTri = new Float32Array(triCount * 3)
  for (let t = 0; t < triCount; t++) {
    const data = perMeshArr[triMesh[t]]
    if (!data) continue
    let ir = 0
    let ig = 0
    let ib = 0
    for (let c = 0; c < 3; c++) {
      const vi = triVerts[t * 3 + c]
      ir += data.irradiance[vi * 3]
      ig += data.irradiance[vi * 3 + 1]
      ib += data.irradiance[vi * 3 + 2]
    }
    irradiancePerTri[t * 3] = ir / 3
    irradiancePerTri[t * 3 + 1] = ig / 3
    irradiancePerTri[t * 3 + 2] = ib / 3
  }

  // ---- ПРОХОД 2: одно отражение ----
  // Тот же обход, но попадания теперь НЕ игнорируются: с задетой
  // поверхности снимается альбедо и умножается на её освещённость
  // из первого прохода. Это и есть цветовой подмес.
  for (const { mesh, isEmissive } of targets) {
    // Источник не запекаем: его яркость не зависит от того, сколько
    // света на него падает. Подмена материала погасила бы экран и
    // лампочку в чёрное — так монитор и «исчезал» после бейка.
    if (isEmissive) continue

    const data = perMesh.get(mesh)!
    const n = data.world.length / 3
    const out = new Float32Array(n * 3)

    for (let i = 0; i < n; i++) {
      nrm.set(data.normal[i * 3], data.normal[i * 3 + 1], data.normal[i * 3 + 2])
      origin.set(data.world[i * 3], data.world[i * 3 + 1], data.world[i * 3 + 2])
      origin.addScaledVector(nrm, 0.002)

      // Два РАЗДЕЛЬНЫХ накопителя, и это принципиально.
      // Отражённый свет пропорционален тому, сколько света в комнате
      // вообще есть, — значит масштабируется яркостью неба. Свечение
      // ламп и экранов от неба не зависит вовсе: лампа горит ночью так
      // же, как днём. Сложенные в один накопитель, они дают белую ночь —
      // стены продолжают «отражать» свет, которого нет.
      // Только отражённое. Прямой свет источников теперь даёт проход 1
      // через явную выборку — учитывать его здесь второй раз означало бы
      // светить лампой дважды.
      let br = 0, bg = 0, bb = 0
      for (let s = 0; s < o.rays; s++) {
        cosineHemisphere(nrm, seq[s * 2], seq[s * 2 + 1], dir)
        const h = trace(origin, dir)
        const fidx = h?.faceIndex
        if (h && fidx != null && fidx >= 0 && h.distance <= o.maxDistance) {
          const fi = fidx * 3
          const falloff = 1 / (1 + h.distance * h.distance * 0.35)
          // альбедо × освещённость В ТОЧКЕ ПОПАДАНИЯ, покомпонентно:
          // тёплый свет лампы на медовом паркете и холодный от окна
          // на белой стене дают РАЗНЫЙ отражённый цвет
          br += (albedoPerTri[fi] ?? 0.6) * irradiancePerTri[fi] * falloff
          bg += (albedoPerTri[fi + 1] ?? 0.6) * irradiancePerTri[fi + 1] * falloff
          bb += (albedoPerTri[fi + 2] ?? 0.6) * irradiancePerTri[fi + 2] * falloff
        }
      }
      // skyIntensity здесь БОЛЬШЕ НЕ НУЖЕН: уровень света теперь несёт
      // сама освещённость точки попадания. Множитель на небо был
      // костылём, компенсировавшим её отсутствие.
      const invB = (1 / o.rays) * o.bounceStrength * 2.4
      // Итог = АЛЬБЕДО поверхности × её освещённость. Так же устроен
      // Baked.js в референсе: цвет предмета уже вмешан в запечённое,
      // поэтому материал дальше может быть максимально дешёвым.
      const alb = albedoOf.get(mesh)!
      out[i * 3] = alb.r * (data.irradiance[i * 3] + br * invB)
      out[i * 3 + 1] = alb.g * (data.irradiance[i * 3 + 1] + bg * invB)
      out[i * 3 + 2] = alb.b * (data.irradiance[i * 3 + 2] + bb * invB)
    }

    // Складываем вариант в userData, а не только в атрибут: чтобы
    // переключать день/ночь, нужны ОБА массива одновременно.
    const store = (mesh.userData.bake ??= {}) as Record<string, Float32Array>
    store[o.variant] = out

    // В атрибут кладём копию — интерполяция будет писать в неё,
    // а исходные варианты должны остаться нетронутыми.
    const existing = mesh.geometry.getAttribute('color')
    if (existing) {
      ;(existing.array as Float32Array).set(out)
      existing.needsUpdate = true
    } else {
      mesh.geometry.setAttribute('color', new THREE.BufferAttribute(out.slice(), 3))
    }

    // Подмена материала на самый дешёвый из возможных: освещение уже
    // посчитано и лежит в вершинах, считать его каждый кадр незачем.
    // Это и есть тот выигрыш, ради которого пекут.
    const old = mesh.material as THREE.Material & { map?: THREE.Texture | null }
    if (old instanceof THREE.MeshBasicMaterial && old.name === 'baked') continue
    const baked = new THREE.MeshBasicMaterial({ vertexColors: true })
    if ('alphaTest' in old && (old as THREE.MeshStandardMaterial).alphaTest > 0) {
      baked.alphaTest = (old as THREE.MeshStandardMaterial).alphaTest
      baked.side = (old as THREE.MeshStandardMaterial).side
      baked.onBeforeCompile = (old as THREE.MeshStandardMaterial).onBeforeCompile
      baked.customProgramCacheKey = (old as THREE.MeshStandardMaterial).customProgramCacheKey
    }
    baked.name = 'baked'
    mesh.material = baked
  }

  return {
    vertices: totalVerts,
    rays: totalVerts * o.rays * 2,
    ms: performance.now() - t0,
  }
}
