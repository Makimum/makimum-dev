import * as THREE from 'three'
import { prefersReducedMotion } from '../lib/reducedMotion'

/**
 * Кресло, которое можно раскрутить.
 *
 * Офисное кресло — единственный предмет в комнате, который в жизни
 * крутят просто так, и именно поэтому оно просится под руку. Важна не
 * сама вращалка, а ВЫБЕГ: настоящее кресло не останавливается там, где
 * его отпустили, оно докручивается и затихает. Без выбега это ползунок,
 * а не кресло.
 *
 * Затухание экспоненциальное, с постоянной времени около секунды, плюс
 * порог остановки — иначе кресло бесконечно ползёт на сотых долях
 * градуса и сцена никогда не засыпает.
 */

/** Радиан на пиксель перетаскивания. Полный оборот ≈ 620 px — примерно
 *  ширина кресла в кадре, то есть «протащить через себя» = один оборот. */
const SENSITIVITY = 0.0101

/** За сколько секунд скорость падает в e раз. */
const SPIN_DAMPING = 1.05

/** Ниже этой скорости кресло считается остановившимся, рад/с. */
const SPIN_STOP = 0.02

/** Максимальная скорость выбега: сильный рывок не должен превращать
 *  кресло в вентилятор. */
const SPIN_MAX = 11

export interface ChairSpin {
  /** Началось перетаскивание. */
  begin(clientX: number): void
  /** Указатель поехал. */
  drag(clientX: number): void
  /** Отпустили — дальше кресло докручивается само. */
  end(): void
  update(dtSeconds: number): void
  dragging(): boolean
  /**
   * Едет ли кресло прямо сейчас — под рукой ИЛИ на выбеге.
   *
   * Нужно карте теней: она перерисовывается только когда в комнате
   * что-то сдвинулось, а кресло — единственное, что двигается. По одному
   * `dragging()` тень застыла бы в момент отпускания и досматривала бы
   * выбег неподвижной.
   */
  moving(): boolean
  label(): string
}

export function createChairSpin(scene: THREE.Scene): ChairSpin | null {
  const chair = scene.getObjectByName('chair')
  if (!chair) {
    console.warn('[chair] узел не найден — вращение не поднято')
    return null
  }

  let held = false
  let lastX = 0
  let lastT = 0
  let velocity = 0

  return {
    begin(clientX) {
      held = true
      lastX = clientX
      lastT = performance.now()
      velocity = 0
    },
    drag(clientX) {
      if (!held) return
      const now = performance.now()
      const dx = clientX - lastX
      const dt = Math.max(1, now - lastT) / 1000
      chair.rotation.y += dx * SENSITIVITY
      // Скорость берётся из ПОСЛЕДНЕГО отрезка, а не усредняется по
      // всему жесту: иначе медленное подведение перед резким рывком
      // съедает бросок, и кресло отпускают — а оно едва ползёт.
      velocity = (dx * SENSITIVITY) / dt
      lastX = clientX
      lastT = now
    },
    end() {
      if (!held) return
      held = false
      // При отключённой анимации выбега нет: кресло стоит там, где
      // отпустили. Вращение остаётся — это управление, а не украшение.
      // Живой ответ, а не снимок на загрузке: настройку включают тогда,
      // когда от движения уже стало плохо.
      if (prefersReducedMotion()) {
        velocity = 0
        return
      }
      // Рывок, сделанный давно, инерции не даёт: если указатель замер
      // перед отпусканием, кресло должно остановиться, а не улететь.
      if (performance.now() - lastT > 90) velocity = 0
      velocity = Math.max(-SPIN_MAX, Math.min(SPIN_MAX, velocity))
    },
    update(dt) {
      if (held || velocity === 0) return
      chair.rotation.y += velocity * dt
      velocity *= Math.exp(-dt / SPIN_DAMPING)
      if (Math.abs(velocity) < SPIN_STOP) velocity = 0
    },
    dragging: () => held,
    moving: () => held || velocity !== 0,
    label: () => 'spin the chair',
  }
}
