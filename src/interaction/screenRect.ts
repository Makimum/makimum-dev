import * as THREE from 'three'

/**
 * Куда предмет попадает НА ЭКРАНЕ — прямоугольник в CSS-пикселях.
 *
 * Нужен двум непохожим читателям, и потому вынесен отдельно: выбору реестра
 * предметов (влезает ли полотно монитора и читается ли на нём текст —
 * `lobby.ts`) и обводу клавиатурного фокуса.
 *
 * ВОСЕМЬ углов, а не два. У повёрнутого предмета проекция противоположных
 * углов габаритного ящика силуэт не накрывает, и рамка тем сильнее съезжает,
 * чем дальше предмет от оси взгляда. Восемь умножений на матрицу — цена,
 * которую не видно даже на шести предметах в кадре.
 */

const box = new THREE.Box3()
const corner = new THREE.Vector3()
const view = new THREE.Vector3()

export interface ScreenRect {
  x: number
  y: number
  w: number
  h: number
}

/**
 * `null` означает «прямоугольнику верить нельзя», а не «предмета нет».
 *
 * У точки за камерой перспективное деление идёт на отрицательное w: знаки
 * переворачиваются, и `project()` возвращает правдоподобные координаты не с
 * той стороны кадра. Молча вернуть такой прямоугольник — значит поставить
 * обвод фокуса на пустое место и не понять, почему.
 */
export function screenRect(
  obj: THREE.Object3D,
  camera: THREE.Camera,
  viewW: number,
  viewH: number,
): ScreenRect | null {
  box.setFromObject(obj)
  if (box.isEmpty()) return null

  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity

  for (let i = 0; i < 8; i++) {
    corner.set(
      i & 1 ? box.max.x : box.min.x,
      i & 2 ? box.max.y : box.min.y,
      i & 4 ? box.max.z : box.min.z,
    )
    // Камера в three.js смотрит вдоль −Z своего пространства, поэтому
    // положительный z после перевода в её систему — это «за спиной».
    view.copy(corner).applyMatrix4(camera.matrixWorldInverse)
    if (view.z > 0) return null

    corner.project(camera)
    const x = (corner.x * 0.5 + 0.5) * viewW
    const y = (-corner.y * 0.5 + 0.5) * viewH
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (y < minY) minY = y
    if (y > maxY) maxY = y
  }

  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
}

/**
 * Тот же прямоугольник, но из ЗАДАННОЙ позы, а не из текущей.
 *
 * Существует ради одного вопроса, который задаётся ДО того, как посетитель
 * куда-либо подлетел: поместится ли полотно монитора в кадр, когда к нему
 * подлетят. Камера при этом стоит в обзорной позе и трогать её нельзя —
 * поэтому считается на копии.
 */
export function screenRectFromPose(
  obj: THREE.Object3D,
  camera: THREE.PerspectiveCamera,
  pose: { position: [number, number, number]; target: [number, number, number]; fov: number },
  viewW: number,
  viewH: number,
): ScreenRect | null {
  const probe = camera.clone()
  probe.position.set(...pose.position)
  probe.fov = pose.fov
  probe.aspect = viewW / viewH
  probe.updateProjectionMatrix()
  probe.lookAt(...pose.target)
  probe.updateMatrixWorld(true)
  // `matrixWorldInverse` сам за `updateMatrixWorld` не следует: у клона он
  // остался бы от исходной камеры, и проекция считалась бы из обзорной позы.
  probe.matrixWorldInverse.copy(probe.matrixWorld).invert()
  return screenRect(obj, probe, viewW, viewH)
}
