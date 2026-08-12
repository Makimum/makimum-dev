import * as THREE from 'three'
import { box } from '../lib/geo'
import { surface } from '../lib/materials'
import { BEVEL, DESK, MACBOOK, PALETTE } from '../constants'

/**
 * MacBook Air M1 13" в розовом золоте, открытый.
 *
 * Габариты взяты паспортные, а не на глаз. Силуэт ноутбука узнаётся
 * по четырём вещам, и все четыре здесь сделаны явно:
 *   1) очень тонкая крышка,
 *   2) чёрная рамка вокруг матрицы,
 *   3) утопленная тёмная клавиатурная площадка с отдельными клавишами,
 *   4) крупный трекпад.
 * Без них выходит просто скошенная коробка.
 *
 * Клавиши — один InstancedMesh на все 70 штук: иначе клавиатура одна
 * съела бы больше драуколлов, чем вся остальная комната.
 *
 * Крышка — отдельная Group с осью по заднему ребру, поэтому угол
 * раскрытия задаётся одним числом и ноутбук закрывается анимацией.
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

/** Клавиатура одним инстансированным мешем. */
function buildKeys(): THREE.InstancedMesh {
  const { kbW, kbD, keyCols, keyRows } = MACBOOK
  const gapX = kbW / keyCols
  const gapZ = kbD / keyRows
  const keyGeo = box(gapX * 0.82, 0.0012, gapZ * 0.76, 0.0004)

  const mesh = new THREE.InstancedMesh(
    keyGeo,
    surface(0x1a1a1c, 'matte'),
    keyCols * keyRows,
  )
  mesh.name = 'keys'
  mesh.castShadow = false
  mesh.receiveShadow = true

  const m = new THREE.Matrix4()
  let i = 0
  for (let r = 0; r < keyRows; r++) {
    for (let c = 0; c < keyCols; c++) {
      m.setPosition(
        -kbW / 2 + gapX * (c + 0.5),
        0,
        -kbD / 2 + gapZ * (r + 0.5),
      )
      mesh.setMatrixAt(i++, m)
    }
  }
  mesh.instanceMatrix.needsUpdate = true
  return mesh
}

export function buildMacbook(): THREE.Group {
  const g = new THREE.Group()
  g.name = 'macbook'

  const bodyMat = surface(PALETTE.macbookBody, 'satin')
  const darkMat = surface(0x121214, 'matte')
  const { w, d, baseH, lidT } = MACBOOK

  // --- основание ---
  g.add(part(box(w, baseH, d, 0.0035), bodyMat, [0, baseH / 2, 0], 'base'))

  // утопленная клавиатурная площадка (чёрная «ванна»)
  const kbZ = -d * 0.155
  g.add(
    part(
      box(MACBOOK.kbW + 0.006, 0.0016, MACBOOK.kbD + 0.006, 0.0008),
      darkMat,
      [0, baseH - 0.0004, kbZ],
      'kb-well',
    ),
  )
  const keys = buildKeys()
  keys.position.set(0, baseH + 0.0008, kbZ)
  g.add(keys)

  // трекпад: тот же цвет корпуса, читается только по тонкому контуру
  g.add(
    part(
      box(MACBOOK.padW + 0.0025, 0.0012, MACBOOK.padD + 0.0025, 0.0006),
      surface(0x9c7d72, 'satin'),
      [0, baseH - 0.0002, d * 0.255],
      'pad-outline',
    ),
  )
  g.add(
    part(
      box(MACBOOK.padW, 0.0014, MACBOOK.padD, 0.0006),
      surface(0xcfa99b, 'gloss'),
      [0, baseH + 0.0002, d * 0.255],
      'trackpad',
    ),
  )

  // петля
  const hinge = new THREE.Mesh(
    new THREE.CylinderGeometry(0.0055, 0.0055, w * 0.42, 12),
    surface(0x8f7268, 'satin'),
  )
  hinge.rotation.z = Math.PI / 2
  hinge.position.set(0, baseH - 0.002, -d / 2 + 0.004)
  hinge.name = 'hinge'
  g.add(hinge)

  // --- крышка: вращается вокруг заднего ребра ---
  const lid = new THREE.Group()
  lid.name = 'lid'
  lid.position.set(0, baseH, -d / 2)
  // Знак ПОЛОЖИТЕЛЬНЫЙ: при повороте вокруг X точка (0,0,−1) уходит в
  // (0, sin θ, −cos θ), то есть вверх. С минусом крышка откидывалась вниз
  // и проваливалась сквозь столешницу (ловилось checkLayout).
  lid.rotation.x = MACBOOK.lidAngle

  // корпус крышки растёт от петли вдоль −Z локально
  lid.add(part(box(w, lidT, d, 0.0028), bodyMat, [0, 0, -d / 2], 'lid-shell'))

  // чёрная рамка на лицевой стороне крышки
  lid.add(
    part(
      box(w - 0.004, 0.0008, d - 0.004, 0.0015),
      darkMat,
      [0, lidT / 2 + 0.0002, -d / 2],
      'bezel',
    ),
  )

  // матрица внутри рамки
  const screen = new THREE.Mesh(
    new THREE.PlaneGeometry(MACBOOK.screenW, MACBOOK.screenH),
    new THREE.MeshStandardMaterial({
      color: PALETTE.macbookScreen,
      roughness: 0.2,
      metalness: 0,
      emissive: new THREE.Color(0x33405e),
      emissiveIntensity: 0.75,
    }),
  )
  screen.position.set(0, lidT / 2 + 0.0009, -d / 2 + 0.002)
  screen.rotation.x = -Math.PI / 2
  screen.name = 'screen'
  lid.add(screen)

  // яблоко на обратной стороне — намёком, силуэтом
  const logo = new THREE.Mesh(
    new THREE.CircleGeometry(0.016, 20),
    surface(0xb08d81, 'gloss'),
  )
  logo.position.set(0, -lidT / 2 - 0.0003, -d / 2)
  logo.rotation.x = Math.PI / 2
  logo.name = 'logo'
  lid.add(logo)

  g.add(lid)

  g.position.set(MACBOOK.posX, DESK.height, MACBOOK.posZ)
  g.rotation.y = MACBOOK.yaw
  return g
}
