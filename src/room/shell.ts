import * as THREE from 'three'
import { box, slab } from '../lib/geo'
import { surface } from '../lib/materials'
import { BEVEL, PALETTE, ROOM, WINDOW } from '../constants'

/**
 * Оболочка комнаты: пол, две стены, потолок, проём окна, плинтус.
 *
 * Начало координат — угол «левая стена × задняя стена × пол».
 * X вправо вдоль задней стены, Z на зрителя, Y вверх.
 */

/** Детерминированный псевдослучай: одинаковая комната при каждой сборке.
 *  Это важно для запекания — иначе каждый бейк печёт другой пол. */
function hash01(i: number): number {
  const x = Math.sin(i * 127.1 + 311.7) * 43758.5453
  return x - Math.floor(x)
}

function mesh(
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

/** Паркет отдельными досками. Геометрия в этом проекте весит ноль байт,
 *  поэтому доски дешевле текстуры и читаются честнее. */
function buildFloor(): THREE.Group {
  const g = new THREE.Group()
  g.name = 'floor'

  const plankW = 0.155
  const gap = 0.0015
  const count = Math.ceil(ROOM.depth / plankW)

  for (let i = 0; i < count; i++) {
    const z = i * plankW + plankW / 2
    const depth = Math.min(plankW - gap, ROOM.depth - i * plankW)
    if (depth <= 0.01) break

    // Лёгкая вариация тона между досками — без неё пол читается как заливка
    const t = hash01(i)
    const c = new THREE.Color(PALETTE.floorOak).lerp(new THREE.Color(PALETTE.floorOakDark), t * 0.45)

    const plank = new THREE.Mesh(
      slab(ROOM.width, 0.018, depth, 6),
      new THREE.MeshStandardMaterial({ color: c, roughness: 0.72, metalness: 0 }),
    )
    plank.position.set(ROOM.width / 2, -0.009, z)
    plank.receiveShadow = true
    g.add(plank)
  }

  // Стяжка под досками, чтобы в щели между ними не просвечивала пустота
  const sub = new THREE.Mesh(box(ROOM.width, 0.05, ROOM.depth, BEVEL.sm), surface(0x6b5334, 'matte'))
  sub.position.set(ROOM.width / 2, -0.043, ROOM.depth / 2)
  sub.name = 'subfloor'
  g.add(sub)
  return g
}

function buildBackWall(): THREE.Group {
  const g = new THREE.Group()
  g.name = 'wall-back'
  const mat = surface(PALETTE.wallCool, 'matte')
  const t = ROOM.wallThickness
  const zc = -t / 2

  const wLeft = WINDOW.offsetX - WINDOW.width / 2
  const wRight = ROOM.width - (WINDOW.offsetX + WINDOW.width / 2)
  const above = ROOM.height - (WINDOW.sill + WINDOW.height)

  // слева от окна
  g.add(mesh(slab(wLeft, ROOM.height, t), mat, [wLeft / 2, ROOM.height / 2, zc], 'back-l'))
  // справа от окна
  g.add(
    mesh(
      slab(wRight, ROOM.height, t),
      mat,
      [ROOM.width - wRight / 2, ROOM.height / 2, zc],
      'back-r',
    ),
  )
  // под окном
  g.add(
    mesh(
      slab(WINDOW.width, WINDOW.sill, t),
      mat,
      [WINDOW.offsetX, WINDOW.sill / 2, zc],
      'back-under',
    ),
  )
  // над окном
  g.add(
    mesh(
      slab(WINDOW.width, above, t),
      mat,
      [WINDOW.offsetX, ROOM.height - above / 2, zc],
      'back-over',
    ),
  )

  return g
}

function buildWindow(): THREE.Group {
  const g = new THREE.Group()
  g.name = 'window'
  const frame = surface(0xf6f4f0, 'satin')
  const th = 0.045

  const x0 = WINDOW.offsetX - WINDOW.width / 2
  const x1 = WINDOW.offsetX + WINDOW.width / 2
  const y0 = WINDOW.sill
  const y1 = WINDOW.sill + WINDOW.height
  const z = -ROOM.wallThickness + WINDOW.reveal

  // рама
  g.add(mesh(box(WINDOW.width, th, 0.06, BEVEL.sm), frame, [WINDOW.offsetX, y0 + th / 2, z], 'w-b'))
  g.add(mesh(box(WINDOW.width, th, 0.06, BEVEL.sm), frame, [WINDOW.offsetX, y1 - th / 2, z], 'w-t'))
  g.add(
    mesh(box(th, WINDOW.height, 0.06, BEVEL.sm), frame, [x0 + th / 2, (y0 + y1) / 2, z], 'w-l'),
  )
  g.add(
    mesh(box(th, WINDOW.height, 0.06, BEVEL.sm), frame, [x1 - th / 2, (y0 + y1) / 2, z], 'w-r'),
  )
  // средник
  g.add(
    mesh(box(0.03, WINDOW.height, 0.05, BEVEL.sm), frame, [WINDOW.offsetX, (y0 + y1) / 2, z], 'w-m'),
  )

  // подоконник
  g.add(
    mesh(
      box(WINDOW.width + 0.16, 0.03, 0.19, BEVEL.md),
      surface(0xf2efe9, 'satin'),
      [WINDOW.offsetX, y0 - 0.015, -ROOM.wallThickness + 0.095],
      'sill',
    ),
  )

  // «Небо»: плоскость-заглушка в проёме. Для бейка её заменит настоящий источник.
  const sky = new THREE.Mesh(
    new THREE.PlaneGeometry(WINDOW.width, WINDOW.height),
    new THREE.MeshBasicMaterial({ color: 0xdfeaf4 }),
  )
  sky.position.set(WINDOW.offsetX, (y0 + y1) / 2, -ROOM.wallThickness - 0.001)
  sky.name = 'sky'
  g.add(sky)

  return g
}

function buildSkirting(): THREE.Group {
  const g = new THREE.Group()
  g.name = 'skirting'
  const mat = surface(PALETTE.skirting, 'gloss')
  const h = ROOM.skirtingHeight
  const d = 0.018

  g.add(mesh(box(ROOM.width, h, d, BEVEL.sm), mat, [ROOM.width / 2, h / 2, d / 2], 'sk-back'))
  g.add(mesh(box(d, h, ROOM.depth, BEVEL.sm), mat, [d / 2, h / 2, ROOM.depth / 2], 'sk-left'))
  return g
}

export function buildShell(): THREE.Group {
  const shell = new THREE.Group()
  shell.name = 'shell'

  shell.add(buildFloor())
  shell.add(buildBackWall())
  shell.add(buildWindow())
  shell.add(buildSkirting())

  // левая стена
  shell.add(
    mesh(
      slab(ROOM.wallThickness, ROOM.height, ROOM.depth),
      surface(PALETTE.wallWarm, 'matte'),
      [-ROOM.wallThickness / 2, ROOM.height / 2, ROOM.depth / 2],
      'wall-left',
    ),
  )

  // потолок
  shell.add(
    mesh(
      slab(ROOM.width, 0.08, ROOM.depth),
      surface(PALETTE.ceiling, 'matte'),
      [ROOM.width / 2, ROOM.height + 0.04, ROOM.depth / 2],
      'ceiling',
    ),
  )

  return shell
}
