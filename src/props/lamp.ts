import * as THREE from 'three'
import { domeShade, knuckle, rod, spring } from '../lib/geo'
import { shadeMaterial, surface } from '../lib/materials'
import { DESK, LAMP, PALETTE } from '../constants'

/**
 * Уровень сложности 3 — белая шарнирная лампа на красном основании, на столе.
 *
 * Это честный индикатор всего процедурного подхода. Если она не даётся
 * за разумное время, оценка часов неверна и путь надо пересматривать
 * ДО того, как в комнате появятся ещё девять предметов.
 *
 * Собрана настоящей иерархией шарниров, а не одной застывшей формой:
 * каждый сустав — отдельная Group со своим поворотом. Поза задаётся
 * тремя углами в constants, и та же иерархия потом оживает без переделки.
 *
 *   mount → lowerArm → upperArm → head → shade
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

/** Корпус лампы — белый. Красный только на настенном узле. */
const ARM = () => surface(PALETTE.lampArm, 'satin')
const ACCENT = () => surface(PALETTE.accentRed, 'gloss')
const STEEL = () => surface(PALETTE.metal, 'metal')

/** Пара параллельных тяг + пружина между ними — узнаваемый силуэт шарнирной лампы.
 *  Строится вдоль локальной оси +Y, от 0 до `length`. */
function buildSegment(length: number, name: string): THREE.Group {
  const g = new THREE.Group()
  g.name = name

  const half = LAMP.armGauge / 2
  for (const s of [-1, 1] as const) {
    g.add(
      part(
        rod(LAMP.armThickness / 2, length, 12),
        ARM(),
        [0, length / 2, s * half],
        `rail-${s < 0 ? 'a' : 'b'}`,
      ),
    )
  }

  // пружина натяжения вдоль тяг
  const sp = new THREE.Mesh(
    spring(length * 0.78, LAMP.springRadius, LAMP.springTurns),
    STEEL(),
  )
  sp.position.set(0, length * 0.12, 0)
  sp.name = 'spring'
  sp.castShadow = true
  g.add(sp)

  return g
}

/** Шарнирная костяшка: диск с осью. */
function buildKnuckle(name: string): THREE.Group {
  const g = new THREE.Group()
  g.name = name
  const k = new THREE.Mesh(knuckle(0.019, 0.008), ARM())
  k.rotation.y = Math.PI / 2
  k.castShadow = true
  g.add(k)
  g.add(part(rod(0.006, LAMP.armGauge + 0.02, 10), STEEL(), [0, 0, 0], 'pin', [Math.PI / 2, 0, 0]))
  return g
}

export function buildLamp(): THREE.Group {
  const lamp = new THREE.Group()
  lamp.name = 'lamp'

  // --- основание на столешнице ---
  const mount = new THREE.Group()
  mount.name = 'mount'

  // тяжёлый круглый блин — он и держит вынос руки
  const base = new THREE.Mesh(
    new THREE.CylinderGeometry(LAMP.baseRadius, LAMP.baseRadius * 1.06, LAMP.baseHeight, 28),
    ACCENT(),
  )
  base.position.y = LAMP.baseHeight / 2
  base.name = 'base'
  base.castShadow = true
  base.receiveShadow = true
  mount.add(base)

  // войлочная подложка, чтобы блин не «висел» на столешнице
  const pad = new THREE.Mesh(
    new THREE.CylinderGeometry(LAMP.baseRadius * 0.97, LAMP.baseRadius * 0.97, 0.003, 24),
    surface(0x3a3a3c, 'matte'),
  )
  pad.position.y = 0.0015
  pad.name = 'base-pad'
  mount.add(pad)

  // стойка от основания до первого шарнира
  mount.add(
    part(
      rod(0.013, LAMP.postHeight, 14),
      ARM(),
      [0, LAMP.baseHeight + LAMP.postHeight / 2, 0],
      'post',
    ),
  )
  lamp.add(mount)

  // --- нижнее плечо ---
  const lower = new THREE.Group()
  lower.name = 'joint-lower'
  lower.position.set(0, LAMP.baseHeight + LAMP.postHeight, 0)
  lower.rotation.z = LAMP.angleLower
  lower.add(buildKnuckle('knuckle-base'))
  lower.add(buildSegment(LAMP.armLower, 'arm-lower'))
  mount.add(lower)

  // --- верхнее плечо ---
  const upper = new THREE.Group()
  upper.name = 'joint-mid'
  upper.position.set(0, LAMP.armLower, 0)
  upper.rotation.z = LAMP.angleUpper
  upper.add(buildKnuckle('knuckle-mid'))
  upper.add(buildSegment(LAMP.armUpper, 'arm-upper'))
  lower.add(upper)

  // --- голова с абажуром ---
  const head = new THREE.Group()
  head.name = 'joint-head'
  head.position.set(0, LAMP.armUpper, 0)
  head.rotation.z = LAMP.angleShade
  head.add(buildKnuckle('knuckle-head'))

  // короткая шейка между шарниром и плафоном
  head.add(part(rod(0.009, 0.05, 10), ARM(), [0, 0.025, 0], 'neck'))

  // купол: макушка в (0, 0.05), раструб смотрит вниз
  const shade = new THREE.Mesh(domeShade(LAMP.shadeRadius, LAMP.shadeHeight), shadeMaterial())
  shade.position.set(0, 0.05, 0)
  shade.name = 'shade'
  shade.castShadow = true
  head.add(shade)

  // ободок по краю раструба
  const rim = new THREE.Mesh(knuckle(LAMP.shadeRadius, 0.004), surface(0xe2dfd8, 'satin'))
  rim.position.set(0, 0.05 - LAMP.shadeHeight, 0)
  rim.rotation.x = Math.PI / 2
  rim.name = 'rim'
  head.add(rim)

  // Колба внутри купола. Света НЕ даёт: лампа сейчас выключена как
  // источник целиком — ни эмиссии, ни прожектора. Геометрия и вся
  // шарнирная структура сохранены полностью, изменилось только то,
  // что она перестала светить.
  const bulb = new THREE.Mesh(
    new THREE.SphereGeometry(0.026, 14, 10),
    new THREE.MeshStandardMaterial({
      color: 0xfff2dc,
      roughness: 1,
    }),
  )
  bulb.position.set(0, 0.05 - LAMP.shadeHeight * 0.55, 0)
  bulb.name = 'bulb'
  head.add(bulb)

  upper.add(head)

  // Локальные координаты группы workstation: лампа стоит НА столешнице
  // слева от монитора и ездит вместе со столом.
  lamp.position.set(LAMP.deskX, DESK.height, LAMP.deskZ)
  lamp.rotation.y = LAMP.yaw
  return lamp
}
