import * as THREE from 'three'
import { box } from '../lib/geo'
import { surface } from '../lib/materials'
import { BEVEL, DESK, MONITOR, PALETTE } from '../constants'

/**
 * Изогнутый ультраширокий монитор.
 *
 * Кривизна здесь не украшение: именно дуга отличает силуэт ультраширокого
 * монитора от чёрного прямоугольника. Радиус берётся из паспортной кривизны
 * 1500R, а угол дуги считается из неё и ширины полотна — поэтому изменение
 * ширины в constants автоматически пересчитывает изгиб.
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

/**
 * Кусок цилиндра как изогнутая панель.
 * Ось цилиндра ставится ПЕРЕД экраном (со стороны зрителя), поэтому
 * поверхность получается вогнутой к нему — как у настоящего 1500R.
 */
function curvedPanel(
  radius: number,
  width: number,
  height: number,
  mat: THREE.Material,
  name: string,
): THREE.Mesh {
  const theta = width / radius
  const geo = new THREE.CylinderGeometry(
    radius,
    radius,
    height,
    48,
    1,
    true,
    Math.PI - theta / 2,
    theta,
  )
  const m = new THREE.Mesh(geo, mat)
  m.name = name
  m.castShadow = true
  m.receiveShadow = true
  return m
}

export function buildMonitor(): THREE.Group {
  const g = new THREE.Group()
  g.name = 'monitor'

  const R = MONITOR.curveRadius
  const bezelMat = surface(PALETTE.screenBezel, 'satin')
  const bodyMat = surface(PALETTE.screenBody, 'satin')

  // Ось дуги стоит перед экраном — отсюда вогнутость
  const arc = new THREE.Group()
  arc.name = 'panel'
  arc.position.set(0, 0, R)

  // полотно
  const screen = curvedPanel(
    R,
    MONITOR.screenW,
    MONITOR.screenH,
    new THREE.MeshStandardMaterial({
      color: PALETTE.screenOff,
      roughness: 0.28,
      metalness: 0,
      emissive: new THREE.Color(0x3a4a7a),
      emissiveIntensity: 0.55,
      side: THREE.DoubleSide,
    }),
    'screen',
  )
  arc.add(screen)

  // рамка чуть больше полотна и чуть глубже
  const frame = curvedPanel(
    R + MONITOR.panelDepth,
    MONITOR.screenW + MONITOR.bezel * 2,
    MONITOR.screenH + MONITOR.bezel * 2,
    bezelMat,
    'frame',
  )
  frame.material = bezelMat
  arc.add(frame)

  // задняя крышка
  const back = curvedPanel(
    R + MONITOR.panelDepth + 0.001,
    MONITOR.screenW + MONITOR.bezel * 2,
    MONITOR.screenH + MONITOR.bezel * 2,
    bodyMat,
    'back',
  )
  arc.add(back)

  // Полотно ставим так, чтобы низ рамки был на высоте стойки
  const screenCentreY = DESK.height + MONITOR.neckH + MONITOR.screenH / 2
  arc.position.y = screenCentreY
  g.add(arc)

  // ВНИМАНИЕ ПО ЗНАКУ Z: экран смотрит в +Z (в комнату, к креслу),
  // поэтому вся механика — горб, стойка, основание — уходит в −Z,
  // то есть ЗА полотно. С плюсом стойка собирается перед экраном.
  const backZ = -(MONITOR.panelDepth + 0.022)

  // горб под креплением стойки
  g.add(
    part(
      box(0.11, 0.09, 0.045, BEVEL.md),
      bodyMat,
      [0, screenCentreY - MONITOR.screenH * 0.18, backZ],
      'vesa',
    ),
  )

  // Стойка. Центр поднимается на ПОЛОВИНУ собственной высоты над
  // столешницей — иначе низ стойки уезжает в неё (ловилось checkLayout).
  const neckLen = MONITOR.neckH + 0.06
  const neckZ = backZ - 0.012
  g.add(
    part(box(0.055, neckLen, 0.05, BEVEL.md), bodyMat, [0, DESK.height + neckLen / 2, neckZ], 'neck'),
  )

  // V-образное основание: две лапы, расходящиеся вперёд из-под экрана
  for (const s of [-1, 1] as const) {
    const foot = part(
      box(0.028, 0.016, MONITOR.baseD, BEVEL.sm),
      bodyMat,
      [(s * MONITOR.baseW) / 3.4, DESK.height + 0.008, neckZ + MONITOR.baseD / 2 - 0.03],
      `foot-${s < 0 ? 'l' : 'r'}`,
    )
    foot.rotation.y = s * 0.42
    g.add(foot)
  }
  g.add(
    part(box(0.09, 0.016, 0.05, BEVEL.sm), bodyMat, [0, DESK.height + 0.008, neckZ], 'base-hub'),
  )

  g.position.set(MONITOR.posX, 0, MONITOR.posZ)
  return g
}
