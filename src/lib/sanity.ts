import * as THREE from 'three'
import { ROOM } from '../constants'

/**
 * Проверки раскладки сцены.
 *
 * Зачем: предмет, уехавший внутрь стены или сквозь пол, НЕ вызывает ошибки.
 * Он просто пропадает из кадра — и это ловится глазом лишь тогда, когда
 * предметов уже двенадцать и непонятно, какой именно виноват.
 * Первый же такой случай (стол зашёл в левую стену на 15 см, левая нога
 * исчезла целиком) стоил ручной диагностики. Дальше ловим машинно.
 *
 * Проверки намеренно грубые: цель — поймать ошибку на порядок, а не
 * заниматься точной коллизией.
 */

export interface Placement {
  /** Имя корневого объекта предмета */
  name: string
  /** Разрешено ли предмету касаться стены (мебель у стены — да, ковёр — нет) */
  againstWall?: boolean
  /**
   * У предмета РАЗМАШИСТАЯ форма, и его габаритный ящик — не предмет, а
   * объём, который предмет обметает. Такой ящик в попарную проверку не
   * годится вовсе, и это не придирка: лампа стоит основанием в углу
   * стола, а плафон выносит по диагонали почти на полметра — её ящик
   * накрывает половину столешницы, внутри которой на самом деле воздух.
   *
   * Замер, из-за которого флаг и появился: проверка объявила пересечение
   * лампы с планшетом на 5.2 л, притом что плафон стоит на 23 см ВЫШЕ
   * планшета, а рука на его высоте отстоит на 18 см по X. Два таких же
   * ложных срабатывания (лампа с монитором на 43.5 л и лампа с креслом
   * на 7.0 л) висели в выводе с самого начала и приучали не смотреть на
   * предупреждения — а проверка, которую перестают читать, не работает.
   *
   * Помеченный предмет по-прежнему проверяется на выход за комнату:
   * там ящик как раз то, что нужно.
   */
  sweeps?: boolean
}

const EPS = 0.005

function bounds(obj: THREE.Object3D): THREE.Box3 {
  return new THREE.Box3().setFromObject(obj)
}

function fmt(v: THREE.Vector3): string {
  return v
    .toArray()
    .map((n) => n.toFixed(2))
    .join(', ')
}

/** Проверяет, что предмет лежит внутри коробки комнаты. */
function checkInsideRoom(name: string, b: THREE.Box3, problems: string[]) {
  if (b.min.x < -EPS) {
    problems.push(
      `«${name}» уходит в ЛЕВУЮ СТЕНУ на ${(-b.min.x * 100).toFixed(0)} см (min.x = ${b.min.x.toFixed(3)})`,
    )
  }
  if (b.min.z < -EPS) {
    problems.push(
      `«${name}» уходит в ЗАДНЮЮ СТЕНУ на ${(-b.min.z * 100).toFixed(0)} см (min.z = ${b.min.z.toFixed(3)})`,
    )
  }
  if (b.min.y < -EPS) {
    problems.push(`«${name}» проваливается СКВОЗЬ ПОЛ на ${(-b.min.y * 100).toFixed(0)} см`)
  }
  if (b.max.x > ROOM.width + EPS) {
    problems.push(`«${name}» вылезает за правую границу комнаты (max.x = ${b.max.x.toFixed(3)})`)
  }
  if (b.max.z > ROOM.depth + EPS) {
    problems.push(`«${name}» вылезает вперёд за границу комнаты (max.z = ${b.max.z.toFixed(3)})`)
  }
  if (b.max.y > ROOM.height + EPS) {
    problems.push(`«${name}» пробивает ПОТОЛОК (max.y = ${b.max.y.toFixed(3)})`)
  }
}

/** Проверяет попарные пересечения габаритных ящиков. */
function checkOverlaps(items: { name: string; box: THREE.Box3 }[], problems: string[]) {
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const a = items[i]
      const c = items[j]
      if (!a.box.intersectsBox(c.box)) continue

      const overlap = a.box.clone().intersect(c.box)
      const s = overlap.getSize(new THREE.Vector3())
      const vol = s.x * s.y * s.z
      // Мелкое касание габаритов — норма (лампа над столом, стул под столешницей).
      // Ругаемся только на существенное взаимопроникновение.
      if (vol > 0.004) {
        problems.push(
          `«${a.name}» и «${c.name}» пересекаются объёмом ${(vol * 1000).toFixed(1)} л (${fmt(s)} м)`,
        )
      }
    }
  }
}

/**
 * Запускает все проверки. Возвращает список проблем — пустой, если всё чисто.
 * Печатает в консоль, чтобы ошибка была видна сразу при загрузке страницы.
 */
export function checkLayout(scene: THREE.Scene, placements: Placement[]): string[] {
  const problems: string[] = []
  const items: { name: string; box: THREE.Box3 }[] = []

  // ОБЯЗАТЕЛЬНО: Box3.setFromObject читает МИРОВЫЕ матрицы, а они
  // пересчитываются только в рендере. Проверка идёт до первого кадра,
  // поэтому без этой строки любой предмет внутри повёрнутой группы
  // измеряется так, будто группы нет — и проверка сыплет ложной тревогой.
  scene.updateMatrixWorld(true)

  for (const p of placements) {
    const obj = scene.getObjectByName(p.name)
    if (!obj) {
      problems.push(`предмет «${p.name}» не найден в сцене`)
      continue
    }
    const b = bounds(obj)
    checkInsideRoom(p.name, b, problems)
    // В попарную проверку идут только те, чей ящик описывает сам предмет.
    if (!p.sweeps) items.push({ name: p.name, box: b })
  }

  checkOverlaps(items, problems)

  if (problems.length) {
    console.group(`%c⚠ раскладка: ${problems.length} проблем(ы)`, 'color:#e8654a;font-weight:600')
    for (const p of problems) console.warn(p)
    console.groupEnd()
  } else {
    console.log('%c✓ раскладка чистая', 'color:#5aa469;font-weight:600')
  }

  return problems
}
