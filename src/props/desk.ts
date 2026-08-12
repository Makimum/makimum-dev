import * as THREE from 'three'
import { box } from '../lib/geo'
import { surface } from '../lib/materials'
import { BEVEL, DESK, PALETTE } from '../constants'

/**
 * Уровень сложности 1 — чистые боксы.
 * Проверяет ровно одно: попадаю ли я в пропорцию. Если стол выглядит
 * неправильно, дело не в технике, а в размерах — их надо перемерить.
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

/** Одна Т-образная нога: башмак, две телескопические секции, верхний кронштейн. */
function buildLeg(side: -1 | 1): THREE.Group {
  const g = new THREE.Group()
  g.name = `leg-${side < 0 ? 'l' : 'r'}`

  const frame = surface(PALETTE.deskFrame, 'satin')
  const topY = DESK.height - DESK.topThickness

  // башмак на полу, вытянут по глубине стола
  g.add(
    part(
      box(0.055, DESK.footHeight, DESK.footLength, BEVEL.md),
      frame,
      [0, DESK.footHeight / 2, 0],
      'foot',
    ),
  )

  // внешняя (нижняя) секция колонны
  const outerH = topY * 0.58
  g.add(
    part(
      box(DESK.columnOuter, outerH, DESK.columnOuter, BEVEL.md),
      frame,
      [0, DESK.footHeight + outerH / 2, 0],
      'column-outer',
    ),
  )

  // внутренняя (верхняя) секция — заходит в внешнюю, поэтому чуть тоньше
  const innerH = topY - DESK.footHeight - outerH + 0.06
  g.add(
    part(
      box(DESK.columnInner, innerH, DESK.columnInner, BEVEL.md),
      frame,
      [0, DESK.footHeight + outerH + innerH / 2 - 0.06, 0],
      'column-inner',
    ),
  )

  // верхний кронштейн под столешницей
  g.add(
    part(
      box(0.075, 0.03, DESK.footLength * 0.72, BEVEL.md),
      frame,
      [0, topY - 0.015, 0],
      'bracket',
    ),
  )

  return g
}

export function buildDesk(): THREE.Group {
  const g = new THREE.Group()
  g.name = 'desk'

  const halfSpan = DESK.width / 2 - DESK.legInset - DESK.columnOuter / 2

  const left = buildLeg(-1)
  left.position.x = -halfSpan
  g.add(left)

  const right = buildLeg(1)
  right.position.x = halfSpan
  g.add(right)

  // поперечная балка между ногами
  g.add(
    part(
      box(halfSpan * 2, 0.045, 0.05, BEVEL.md),
      surface(PALETTE.deskFrame, 'satin'),
      [0, DESK.height - DESK.topThickness - 0.075, 0],
      'crossbeam',
    ),
  )

  // столешница
  g.add(
    part(
      box(DESK.width, DESK.topThickness, DESK.depth, BEVEL.lg),
      surface(PALETTE.deskTop, 'satin'),
      [0, DESK.height - DESK.topThickness / 2, 0],
      'top',
    ),
  )

  g.position.set(DESK.posX, 0, DESK.posZ)
  return g
}
