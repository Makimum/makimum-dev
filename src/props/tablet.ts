import * as THREE from 'three'
import { box } from '../lib/geo'
import { surface } from '../lib/materials'
import { BEVEL, PALETTE, TABLET } from '../constants'

/**
 * iPad Air 11" в чехле-подставке, портретом, на столе.
 *
 * Это ТРЕТИЙ ЭКРАН комнаты, и собран он тем же способом, что монитор и
 * ноутбук: меш с именем `screen` внутри группы, а всё остальное про него
 * знает `src/screens/`. Материал полотна создаётся здесь пустым — карту,
 * эмиссию и холст на него вешает `Panel`, когда `Screens` обходит сцену.
 * Так предмет не знает про canvas, а экраны не знают про геометрию.
 *
 * ПОЧЕМУ ПОРТРЕТ. Планшет, стоящий боком, читается как второй маленький
 * монитор; стоящий портретом — сразу как планшет. И «сейчас играет» —
 * интерфейс вертикальный по своей природе: обложка, название, дорожка,
 * кнопки идут одной колонкой.
 *
 * ПОЧЕМУ У НЕГО НЕТ ХОТСПОТА. Подлёт камеры к планшету ничего не даёт:
 * читать там нечего, нажимать нечего. А каждый хотспот стоит BVH по
 * своему мешу — цена без выгоды.
 */

function part(
  geo: THREE.BufferGeometry,
  mat: THREE.Material,
  pos: [number, number, number],
  name: string,
): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat)
  m.position.set(...pos)
  m.name = name
  m.castShadow = true
  m.receiveShadow = true
  return m
}

export function buildTablet(): THREE.Group {
  const g = new THREE.Group()
  g.name = 'tablet'

  const bodyMat = surface(PALETTE.tabletBody, 'satin')
  const caseMat = surface(PALETTE.tabletCase, 'matte')
  const { w, h, thickness, screenW, screenH } = TABLET

  /**
   * Наклонённая часть: сам планшет и задняя стенка чехла. Ось наклона —
   * по НИЖНЕМУ ребру, поэтому планшет откидывается назад, оставаясь
   * стоять на столе, а не проваливаясь сквозь него.
   */
  const leaning = new THREE.Group()
  leaning.name = 'tablet-leaning'
  leaning.rotation.x = -TABLET.tilt

  // Корпус. Растёт вверх от оси наклона.
  leaning.add(part(box(w, h, thickness, BEVEL.sm), bodyMat, [0, h / 2, 0], 'body'))

  // Задняя крышка чехла — приклеена к корпусу сзади и чуть больше его.
  leaning.add(
    part(
      box(w + 0.003, h + 0.003, TABLET.caseBack, BEVEL.sm),
      caseMat,
      [0, h / 2, -thickness / 2 - TABLET.caseBack / 2],
      'case-back',
    ),
  )

  /**
   * Полотно. Плоскость, а не грань корпуса: у экрана своя UV-развёртка
   * 0…1, и попадание по нему, если оно когда-нибудь понадобится, идёт
   * по ней же. Материал пустой — его наполнит `Panel`.
   */
  const screen = new THREE.Mesh(
    new THREE.PlaneGeometry(screenW, screenH),
    new THREE.MeshStandardMaterial({
      color: PALETTE.screenOff,
      roughness: 1,
      metalness: 0,
    }),
  )
  screen.name = 'screen'
  screen.position.set(0, h / 2, thickness / 2 + 0.0002)
  leaning.add(screen)

  g.add(leaning)

  /**
   * Опора чехла: наклонная пластина сзади. У магнитного чехла это
   * сложенная втрое передняя крышка, и в силуэте от неё видно ровно
   * косую грань, упирающуюся в спинку.
   *
   * ВСЯ ГЕОМЕТРИЯ СЧИТАЕТСЯ ОТ ТОЧКИ КАСАНИЯ, А НЕ ПОДБИРАЕТСЯ. С
   * подобранными числами подпорка вышла наклонена в другую сторону и
   * своим верхом ПРОРЕЗАЛА экран: на обложке лежала тёмная полоса
   * поперёк. Здесь берётся точка на спинке (62% высоты, уже с учётом
   * наклона планшета и толщины чехла), берётся след подпорки на столе —
   * и длина с углом получаются из них, а не наоборот. Поменяется
   * `TABLET.tilt` — всё пересчитается само.
   */
  const cos = Math.cos(TABLET.tilt)
  const sin = Math.sin(TABLET.tilt)
  const touchAlong = h * 0.62
  const touchY = touchAlong * cos
  const touchZ = -touchAlong * sin - (thickness / 2 + TABLET.caseBack) * cos
  // След на столе. Чем дальше назад, тем устойчивее и тем положе крышка;
  // 0.46 высоты — то, что даёт узнаваемый треугольник, не выезжая за
  // заднюю кромку стола.
  const footZ = -h * 0.46
  const dy = touchY
  const dz = touchZ - footZ
  const propLen = Math.hypot(dy, dz)

  const prop = part(
    box(w * 0.86, propLen, TABLET.caseBack, BEVEL.sm),
    caseMat,
    [0, dy / 2, (touchZ + footZ) / 2],
    'case-prop',
  )
  // Верх подпорки уходит ВПЕРЁД, к спинке планшета: она подпирает его,
  // а не откидывается вместе с ним.
  prop.rotation.x = Math.atan2(dz, dy)
  g.add(prop)

  return g
}
