import * as THREE from 'three'
import { box, rod, tube } from '../lib/geo'
import { surface } from '../lib/materials'
import { meshFabricMaterial } from '../lib/meshFabric'
import { BEVEL, CHAIR, PALETTE } from '../constants'

/**
 * Красное сетчатое эргономичное кресло.
 *
 * Силуэт держится на трёх вещах, и все три сделаны явно:
 *   1) ярко-красная ГНУТАЯ трубчатая рама — не коробки, а трубы по сплайну,
 *   2) диагональные раскосы внутри спинки (характерная «паутина»),
 *   3) отдельный подголовник на стойке над спинкой.
 * Сетка — тёмная полупрозрачная панель, натянутая внутри рамы:
 * именно контраст «яркая рама / тёмное полотно» и читается как это кресло.
 */

function part(
  geo: THREE.BufferGeometry,
  mat: THREE.Material,
  pos: [number, number, number],
  name: string,
  rot?: [number, number, number],
): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat)
  m.position.set(...pos)
  if (rot) m.rotation.set(...rot)
  m.name = name
  m.castShadow = true
  m.receiveShadow = true
  return m
}

const RED = () => surface(PALETTE.accentRed, 'gloss')
const GREY = () => surface(0x55575c, 'satin')
const DARK = () => surface(0x3a3c40, 'matte')

/**
 * Сетчатое полотно с настоящей перфорацией.
 * Разные участки кресла плетутся по-разному: сиденье крупнее и с явной
 * рибностью, спинка мельче, подголовник — самый плотный.
 */
/**
 * Полотно сетки, натянутое на раму, — НЕ плоскость.
 *
 * Раньше и сиденье, и спинка были `PlaneGeometry` в один сегмент, то есть
 * буквально плоскими. Это единственная причина, по которой кресло читалось
 * нарисованным: у настоящей сетки есть провис. Она закреплена по периметру
 * и прогибается внутрь тем сильнее, чем дальше от рамы, — форма косинусного
 * купола, а не конуса и не сферы.
 *
 * `bulge` задаёт продольный профиль: у сиденья он ровный (чаша), у спинки
 * им же делается поясничный выступ, потому что физика та же — ткань идёт за
 * тем, что её держит.
 */
/**
 * Полотно, натянутое ВНУТРИ рамы.
 *
 * Здесь была главная ошибка кресла, и она не про провис, а про то, что
 * полотно жило отдельной жизнью от рамы. Спинка задавалась прямоугольником
 * во всю ширину, а рама — сужающейся кверху петлёй, отклонённой назад: у
 * верхнего края рама уходила на 72% ширины и на 6.5 см вглубь, а сетка
 * оставалась прямой и широкой. В кадре это читалось буквально как «сетка
 * приделана отдельно от конструкции» — потому что так и было.
 *
 * Поэтому теперь силуэт задаётся ОДИН раз, кривой половины рамы, и из неё
 * строятся оба: и трубка (зеркалированием), и полотно. Разъехаться они
 * больше не могут — у них общий источник.
 *
 * `ribs` — поперечины: вдоль профиля (`along`), полуширина (`half`) и
 * вынос по третьей оси (`off`).
 */
interface Rib {
  along: number
  half: number
  off: number
}

function ribsAlongY(curve: THREE.CatmullRomCurve3, count: number): Rib[] {
  const out: Rib[] = []
  const p = new THREE.Vector3()
  for (let i = 0; i <= count; i++) {
    curve.getPoint(i / count, p)
    out.push({ along: p.y, half: Math.abs(p.x), off: p.z })
  }
  return out
}

function ribsAlongZ(curve: THREE.CatmullRomCurve3, count: number): Rib[] {
  const out: Rib[] = []
  const p = new THREE.Vector3()
  for (let i = 0; i <= count; i++) {
    curve.getPoint(i / count, p)
    out.push({ along: p.z, half: Math.abs(p.x), off: p.y })
  }
  return out
}

interface WeaveOpts {
  /** Насколько полотно уходит внутрь трубки, метры. */
  inset: number
  /** Провис в середине, метры (по третьей оси, в минус). */
  sag: number
  /** Дополнительный выступ по доле высоты 0…1 — поясничный. */
  bulge?: (v: number) => number
  /** Куда смотрит третья ось: 1 — вперёд, −1 — назад. */
  dir?: number
  /** Собрать вершину из (x, вдоль, поперёк). */
  place: (x: number, along: number, off: number) => [number, number, number]
}

function weaveInFrame(ribs: Rib[], cols: number, o: WeaveOpts): THREE.BufferGeometry {
  const dir = o.dir ?? 1
  const rows = ribs.length - 1
  const pos: number[] = []
  const uvs: number[] = []
  const idx: number[] = []

  for (let i = 0; i <= rows; i++) {
    const rib = ribs[i]
    const v = i / rows
    // Полотно заканчивается там же, где трубка, минус её толщина: иначе
    // сетка вылезала бы поверх рамы, а не пряталась за ней.
    const half = Math.max(0, rib.half - o.inset)
    for (let j = 0; j <= cols; j++) {
      const u = (j / cols) * 2 - 1
      // Провис максимален в середине пролёта и обнуляется у рамы — по
      // обеим осям сразу, потому что ткань закреплена по всему периметру.
      const slackX = Math.cos((u * Math.PI) / 2)
      const slackY = Math.sin(v * Math.PI)
      let off = rib.off - dir * o.sag * slackX * slackY
      if (o.bulge) off += dir * o.bulge(v) * slackX
      pos.push(...o.place(u * half, rib.along, off))
      uvs.push(j / cols, v)
    }
  }
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      const a = i * (cols + 1) + j
      const b = a + cols + 1
      idx.push(a, b, a + 1, b, b + 1, a + 1)
    }
  }

  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  geo.setIndex(idx)
  // Нормали обязательны: без пересчёта свет ляжет на изогнутое полотно так,
  // будто оно осталось плоским, и вся правка не будет видна.
  geo.computeVertexNormals()
  return geo
}

const curveOf = (pts: [number, number, number][]) =>
  new THREE.CatmullRomCurve3(
    pts.map((p) => new THREE.Vector3(...p)),
    false,
    'catmullrom',
    0.5,
  )

/**
 * Три полотна одного кресла — из одного рулона, и это главное.
 *
 * Частота задаётся в ячейках на кусок UV, а куски у трёх полотен разного
 * размера в метрах. Поэтому числа ниже не подобраны на глаз, а посчитаны
 * от габарита: ячейка везде около 3.5 мм — столько и есть у сетки
 * настоящего кресла. Один множитель на всех дал бы на подголовнике
 * ячейку вчетверо крупнее, чем на спинке, то есть три разные ткани.
 *
 * Различаются полотна тем, чем и должны: сиденье несёт вес, у него нить
 * толще и переплетение глубже; подголовник натянут на маленькую петлю и
 * почти не провисает, у него плетение самое плоское.
 */
const CELL_M = 0.0035
const cells = (metres: number) => Math.round(metres / CELL_M)

// Сиденье: 0.48 × 0.46 м
const fabricSeat = meshFabricMaterial({
  cellsU: cells(CHAIR.seatW), cellsV: cells(CHAIR.seatD),
  hole: 0.33, weftThin: 0.42, weave: 0.7, jitter: 0.06,
})
// Спинка: 0.44 × 0.62 м
const fabricBack = meshFabricMaterial({
  cellsU: cells(CHAIR.backW), cellsV: cells(CHAIR.backH),
  hole: 0.34, weftThin: 0.38, weave: 0.6, jitter: 0.05,
})
// Подголовник: 0.30 × 0.16 м
const fabricHead = meshFabricMaterial({
  cellsU: cells(CHAIR.headrestW), cellsV: cells(CHAIR.headrestH * 0.78),
  hole: 0.31, weftThin: 0.34, weave: 0.45, jitter: 0.04,
})

/** Пятилучевая база с роликами. */
function buildBase(): THREE.Group {
  const g = new THREE.Group()
  g.name = 'chair-base'
  const R = CHAIR.baseR

  for (let i = 0; i < CHAIR.legs; i++) {
    const a = (i / CHAIR.legs) * Math.PI * 2
    const dx = Math.cos(a)
    const dz = Math.sin(a)

    // луч: от ступицы наружу и вниз
    const leg = new THREE.Mesh(
      tube(
        [
          [0, 0.075, 0],
          [dx * R * 0.45, 0.062, dz * R * 0.45],
          [dx * R, 0.045, dz * R],
        ],
        0.017,
        false,
        16,
        7,
      ),
      RED(),
    )
    leg.castShadow = true
    leg.name = `leg-${i}`
    g.add(leg)

    // ролик
    const caster = new THREE.Mesh(
      new THREE.CylinderGeometry(CHAIR.casterR, CHAIR.casterR, 0.018, 12),
      DARK(),
    )
    caster.rotation.x = Math.PI / 2
    caster.position.set(dx * R, CHAIR.casterR, dz * R)
    caster.castShadow = true
    g.add(caster)
  }

  // ступица + газлифт
  g.add(part(new THREE.CylinderGeometry(0.045, 0.055, 0.05, 14), RED(), [0, 0.08, 0], 'hub'))
  g.add(part(rod(0.026, CHAIR.seatH - 0.14, 12), GREY(), [0, CHAIR.seatH / 2 + 0.02, 0], 'gaslift'))
  return g
}

/** Спинка: гнутая петля рамы + сетка + диагональные раскосы. */
function buildBack(): THREE.Group {
  const g = new THREE.Group()
  g.name = 'chair-back'
  const w = CHAIR.backW / 2
  const h = CHAIR.backH

  // ЕДИНСТВЕННЫЙ силуэт спинки: правая половина, снизу вверх. Из него
  // строится и петля рамы (зеркалированием), и полотно внутри неё.
  const backHalf: [number, number, number][] = [
    [0, -0.03, 0.03],
    [w, 0, 0.02],
    [w * 0.96, h * 0.42, -0.03],
    [w * 0.72, h * 0.88, -0.07],
    [0, h, -0.08],
  ]
  const backCurve = curveOf(backHalf)

  // Замкнутая петля рамы, слегка сужающаяся кверху и отклонённая назад.
  const frame = new THREE.Mesh(
    tube(
      [
        [-w, 0, 0.02],
        [-w * 0.96, h * 0.42, -0.03],
        [-w * 0.72, h * 0.88, -0.07],
        [0, h, -0.08],
        [w * 0.72, h * 0.88, -0.07],
        [w * 0.96, h * 0.42, -0.03],
        [w, 0, 0.02],
        [0, -0.03, 0.03],
      ],
      CHAIR.tubeR,
      true,
      80,
      8,
    ),
    RED(),
  )
  frame.castShadow = true
  frame.name = 'back-frame'
  g.add(frame)

  // Сетчатое полотно внутри рамы: провис плюс поясничный выступ.
  //
  // Выступ на 32% высоты — это не вкус, а посадка: поясничный лордоз
  // приходится примерно на треть высоты спинки, и любое эргономичное
  // кресло держит спину именно там. Плоская спинка не держит нигде.
  const panel = new THREE.Mesh(
    weaveInFrame(ribsAlongY(backCurve, 26), 22, {
      inset: CHAIR.tubeR * 0.85,
      sag: 0.016,
      // Выступ на 32% высоты — это не вкус, а посадка: поясничный лордоз
      // приходится примерно на треть высоты спинки, и любое эргономичное
      // кресло держит спину именно там. Плоская спинка не держит нигде.
      bulge: (v) => 0.02 * Math.exp(-Math.pow((v - 0.32) / 0.2, 2)),
      place: (x, along, off) => [x, along, off],
    }),
    fabricBack,
  )
  panel.name = 'back-mesh'
  panel.receiveShadow = true
  g.add(panel)

  // диагональные раскосы — та самая «паутина» на фото
  const strut = (from: [number, number, number], to: [number, number, number], n: string) => {
    const m = new THREE.Mesh(tube([from, to], 0.008, false, 8, 6), RED())
    m.castShadow = true
    m.name = n
    g.add(m)
  }
  strut([-w * 0.9, h * 0.12, 0.0], [w * 0.55, h * 0.62, -0.05], 'strut-a')
  strut([w * 0.9, h * 0.12, 0.0], [-w * 0.55, h * 0.62, -0.05], 'strut-b')
  strut([-w * 0.8, h * 0.66, -0.05], [w * 0.8, h * 0.66, -0.05], 'strut-c')

  // --- подголовник на стойке ---
  // Подголовник ниже и ближе к плечам: прежние пропорции давали силуэт
  // теннисной ракетки — узкую петлю, унесённую высоко над спинкой.
  const HEAD_SCALE = 0.78
  const hh = CHAIR.headrestH * HEAD_SCALE
  const ph = CHAIR.postH * HEAD_SCALE

  const post = new THREE.Mesh(tube([[0, h - 0.04, -0.07], [0, h + ph, -0.1]], 0.0095), RED())
  post.castShadow = true
  post.name = 'headrest-post'
  g.add(post)
  // серый регулировочный блок
  g.add(
    part(box(0.036, 0.075, 0.03, BEVEL.sm), GREY(), [0, h + ph * 0.34, -0.088], 'adjuster'),
  )

  const hw = CHAIR.headrestW / 2
  const hy = h + ph
  const hoop = new THREE.Mesh(
    tube(
      [
        [-hw, hy, -0.09],
        [-hw * 0.7, hy + hh * 0.85, -0.12],
        [0, hy + hh, -0.13],
        [hw * 0.7, hy + hh * 0.85, -0.12],
        [hw, hy, -0.09],
        [0, hy - 0.03, -0.08],
      ],
      // Самая тонкая трубка в кресле: подголовник несёт только сам себя.
      0.0104,
      true,
      48,
      7,
    ),
    RED(),
  )
  hoop.castShadow = true
  hoop.name = 'headrest-hoop'
  g.add(hoop)

  // Полотно подголовника строится из того же силуэта, что и его петля:
  // прямоугольник внутри эллипса вылезал по углам ровно так же, как
  // полотно спинки вылезало из рамы.
  const headCurve = curveOf([
    [0, hy - 0.03, -0.08],
    [hw, hy, -0.09],
    [hw * 0.7, hy + hh * 0.85, -0.12],
    [0, hy + hh, -0.13],
  ])
  const hpanel = new THREE.Mesh(
    weaveInFrame(ribsAlongY(headCurve, 16), 14, {
      inset: 0.0104 * 0.85,
      sag: 0.008,
      place: (x, along, off) => [x, along, off],
    }),
    fabricHead,
  )
  hpanel.name = 'headrest-mesh'
  g.add(hpanel)

  return g
}

export function buildChair(): THREE.Group {
  const g = new THREE.Group()
  g.name = 'chair'

  g.add(buildBase())

  // --- сиденье ---
  const seat = new THREE.Group()
  seat.name = 'seat'
  seat.position.y = CHAIR.seatH

  const sw = CHAIR.seatW / 2
  const sd = CHAIR.seatD / 2
  // Тот же приём, что у спинки: силуэт задан один раз, половиной контура
  // сзади вперёд. Прямоугольная подушка вылезала за скруглённый передний
  // край рамы — на кадре это выглядело как подстеленная под кресло сетка.
  const seatCurve = curveOf([
    [0, 0.004, -sd * 1.02],
    [sw, 0, -sd],
    [sw * 1.02, 0, sd * 0.6],
    [0, -0.012, sd],
  ])

  // рама сиденья
  const seatFrame = new THREE.Mesh(
    tube(
      [
        [-sw, 0, -sd],
        [-sw * 1.02, 0, sd * 0.6],
        [0, -0.012, sd],
        [sw * 1.02, 0, sd * 0.6],
        [sw, 0, -sd],
        [0, 0.004, -sd * 1.02],
      ],
      // Рама сиденья толще спинки: она несёт вес, спинка — нет.
      // Единая трубка от базы до подголовника и делала кресло похожим на
      // проволочную схему, а не на предмет, у которого разные детали
      // рассчитаны на разную нагрузку.
      CHAIR.tubeR * 1.18,
      true,
      56,
      8,
    ),
    RED(),
  )
  seatFrame.castShadow = true
  seatFrame.name = 'seat-frame'
  seat.add(seatFrame)

  // Сетка сиденья: чаша 22 мм в центре.
  //
  // Глубина взята не с потолка: столько провисает сетчатое сиденье под
  // взрослым человеком, и именно она отличает кресло от табурета с
  // натянутой марлей. Локальная ось Z полотна после поворота на −90°
  // смотрит вверх, поэтому провис уходит вниз сам.
  const cushion = new THREE.Mesh(
    weaveInFrame(ribsAlongZ(seatCurve, 22), 20, {
      inset: CHAIR.tubeR * 1.18 * 0.85,
      // Столько провисает сетчатое сиденье под взрослым человеком — это и
      // отличает кресло от табурета с натянутой марлей.
      sag: 0.022,
      place: (x, along, off) => [x, off + 0.004, along],
    }),
    fabricSeat,
  )
  cushion.name = 'seat-mesh'
  cushion.receiveShadow = true
  seat.add(cushion)

  // подлокотники
  for (const s of [-1, 1] as const) {
    const armPost = new THREE.Mesh(
      tube(
        [
          [s * sw * 0.86, -0.02, 0.02],
          [s * sw * 1.08, 0.12, 0.0],
          [s * sw * 1.06, 0.2, -0.03],
        ],
        0.013,
      ),
      GREY(),
    )
    armPost.castShadow = true
    armPost.name = `arm-post-${s < 0 ? 'l' : 'r'}`
    seat.add(armPost)

    const pad = part(
      box(0.055, 0.026, 0.23, BEVEL.md),
      GREY(),
      [s * sw * 1.06, 0.215, -0.03],
      `arm-pad-${s < 0 ? 'l' : 'r'}`,
    )
    seat.add(pad)
  }

  // спинка крепится к заднему краю сиденья и слегка откинута
  const back = buildBack()
  back.position.set(0, 0.01, -sd * 0.92)
  back.rotation.x = -0.16
  seat.add(back)

  g.add(seat)

  g.rotation.y = CHAIR.yaw
  return g
}
