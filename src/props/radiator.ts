import * as THREE from 'three'
import { box } from '../lib/geo'
import { surface } from '../lib/materials'
import { BEVEL, PALETTE, RADIATOR, WINDOW } from '../constants'

/**
 * Уровень сложности 2 — бокс плюс параметрическая повторяющаяся деталь.
 * Проверяет, читается ли процедурный повтор как «изготовленное изделие»,
 * а не как массив кубиков. Если рёбра и решётка не спасают силуэт —
 * значит параметрический подход не вытянет и остальные предметы.
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

export function buildRadiator(): THREE.Group {
  const g = new THREE.Group()
  g.name = 'radiator'

  const mat = surface(PALETTE.radiator, 'gloss')
  const { width: W, height: H, depth: D } = RADIATOR
  const panelT = 0.016

  // Задняя панель — прижата к стене
  g.add(part(box(W, H, panelT, BEVEL.sm), mat, [0, H / 2, panelT / 2], 'panel-back'))

  // Передняя панель с вертикальными гофрами.
  // Гофр — это и есть то, что отличает панельный радиатор от белого ящика.
  const grooveCount = 9
  const bay = W / grooveCount
  for (let i = 0; i < grooveCount; i++) {
    const x = -W / 2 + bay * (i + 0.5)
    g.add(
      part(
        box(bay * 0.86, H - 0.012, panelT, BEVEL.sm),
        mat,
        [x, H / 2, D - panelT / 2],
        `front-bay-${i}`,
      ),
    )
  }
  // тонкая перемычка, связывающая гофры в одну панель
  g.add(part(box(W, H - 0.012, 0.006, BEVEL.sm), mat, [0, H / 2, D - panelT - 0.004], 'front-web'))

  // Конвекционные рёбра между панелями — видны сбоку и сверху сквозь решётку
  const finMat = surface(0xe6e4df, 'satin')
  for (let i = 0; i < RADIATOR.finCount; i++) {
    const x = -W / 2 + (W / RADIATOR.finCount) * (i + 0.5)
    g.add(
      part(
        box(0.0035, H - 0.09, RADIATOR.finDepth, BEVEL.sm),
        finMat,
        [x, H / 2, D / 2],
        `fin-${i}`,
      ),
    )
  }

  // Верхняя решётка со щелями
  const slotBay = W / RADIATOR.topGrilleSlots
  for (let i = 0; i < RADIATOR.topGrilleSlots; i++) {
    const x = -W / 2 + slotBay * (i + 0.5)
    g.add(
      part(box(slotBay * 0.68, 0.01, D * 0.82, BEVEL.sm), mat, [x, H - 0.005, D / 2], `slot-${i}`),
    )
  }
  // обвязка решётки по периметру
  g.add(part(box(W, 0.012, 0.012, BEVEL.sm), mat, [0, H - 0.006, 0.014], 'grille-rear'))
  g.add(part(box(W, 0.012, 0.012, BEVEL.sm), mat, [0, H - 0.006, D - 0.014], 'grille-front'))

  // Боковые заглушки
  for (const s of [-1, 1] as const) {
    g.add(
      part(box(0.012, H, D, BEVEL.sm), mat, [(s * (W - 0.012)) / 2, H / 2, D / 2], `cap-${s < 0 ? 'l' : 'r'}`),
    )
  }

  // Кронштейны и подводка
  const pipe = surface(PALETTE.metal, 'metal')
  for (const s of [-1, 1] as const) {
    g.add(
      part(
        box(0.03, 0.05, 0.05, BEVEL.sm),
        mat,
        [(s * (W - 0.18)) / 2, H - 0.09, D / 2],
        `mount-${s < 0 ? 'l' : 'r'}`,
      ),
    )
  }
  const valve = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, RADIATOR.floorGap, 12), pipe)
  valve.position.set(-W / 2 + 0.05, -RADIATOR.floorGap / 2, D / 2)
  valve.name = 'valve'
  g.add(valve)

  // Радиатор висит под окном
  g.position.set(WINDOW.offsetX, RADIATOR.floorGap, 0.005)
  return g
}
