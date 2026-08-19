import * as THREE from 'three'
import type { Hotspot } from './hotspots'
import type { KeyboardMode } from './keyboardMode'
import { screenRect } from './screenRect'
import { tabOrder } from './tabOrder'

/**
 * Каждый предмет комнаты — настоящая кнопка поверх холста.
 *
 * ПОЧЕМУ КНОПКИ, А НЕ СВОЙ ОБХОД. Первая редакция плана вела обвод сама:
 * свой указатель по реестру, свой `Tab` с `preventDefault`, свой обвод, и
 * отдельной строкой «довести ARIA». Это хуже во всём:
 *
 *  — `Tab` работает нативно, и порядок обхода — это просто порядок в DOM;
 *  — `Enter` и пробел активируют кнопку сами, разбирать их не надо;
 *  — роль и имя берутся из `<button aria-label>` даром;
 *  — Full Keyboard Access на iPadOS водит НАТИВНЫЙ фокус. Живого iPad у
 *    проекта нет, проверить нечем — и именно поэтому опираться надо на то,
 *    что платформа умеет сама, а не на свою механику, которая там не
 *    заработала бы почти наверняка;
 *  — ловушки фокуса не возникает: `Tab` доходит до крестика и уходит
 *    дальше, как на любой странице.
 *
 * ПОПАДАНИЕ УКАЗАТЕЛЕМ КНОПКИ НЕ ТРОГАЮТ. У них `pointer-events: none`,
 * поэтому мышь и палец по-прежнему считает рейкаст по холсту — со всей
 * логикой протаскивания, порога и попадания по плитке внутри экрана.
 * Фокусируемость от этого не теряется: `pointer-events` на обход клавишей
 * не влияет.
 */

export interface HotspotButtons {
  /** Разложить кнопки по местам. Дёшево, но не бесплатно — см. ниже. */
  sync(): void
  dispose(): void
}

export function createHotspotButtons(
  hotspots: Hotspot[],
  scene: THREE.Object3D,
  camera: THREE.PerspectiveCamera,
  keyboard: KeyboardMode,
  onActivate: (h: Hotspot) => void,
): HotspotButtons {
  const layer = document.getElementById('hotspot-buttons')
  if (!layer) {
    console.warn('[hotspots] нет контейнера #hotspot-buttons — клавиатурный обход выключен')
    return { sync() {}, dispose() {} }
  }

  const pairs: { el: HTMLButtonElement; obj: THREE.Object3D }[] = []

  /**
   * Привести матрицы камеры к текущему кадру.
   *
   * `matrixWorldInverse` заполняет сам рендерер внутри `render()`, а мы
   * считаем проекцию ДО отрисовки — то есть без этой строки кнопки ехали бы
   * с отставанием на кадр. На быстром повороте камеры это видно: обвод
   * тянется за предметом. Один поворот матрицы 4×4 на кадр, рендерер её всё
   * равно пересчитает своим чередом.
   */
  function syncCamera() {
    camera.updateMatrixWorld()
    camera.matrixWorldInverse.copy(camera.matrixWorld).invert()
  }

  // Порядок в DOM И ЕСТЬ порядок обхода, поэтому кнопки добавляются
  // отсортированными. Координата снимается ОДИН раз, в той позе, в которой
  // камера стоит сейчас, — то есть в обзорной, потому что кнопки строятся
  // при сборке комнаты.
  syncCamera()
  const w = window.innerWidth
  const h = window.innerHeight
  const ordered = tabOrder(hotspots, (spot) => {
    const obj = scene.getObjectByName(spot.meshName)
    const r = obj && screenRect(obj, camera, w, h)
    // Предмет, не попавший в обзорный кадр, уезжает в конец обхода, а не
    // теряется: иначе его место в порядке зависело бы от того, что вернёт
    // компаратор на NaN.
    return r ? r.x : Number.POSITIVE_INFINITY
  })

  for (const spot of ordered) {
    const obj = scene.getObjectByName(spot.meshName)
    if (!obj) continue // предмет мог не собраться; реестр это уже пережил
    const el = document.createElement('button')
    el.type = 'button'
    el.className = 'hotspot-btn'
    // Единственное имя предмета, которое будет прочитано вслух. Тот же
    // английский текст, что видит мышь в подписи под курсором.
    el.setAttribute('aria-label', spot.label)
    el.dataset.hotspot = spot.id
    // Подпись ВНУТРИ кнопки, а не общая плашка у курсора.
    //
    // Та, что живёт в `focus.ts`, позиционируется от указателя
    // (`translate(clientX + 16, clientY + 14)`) — с клавиатуры курсора нет,
    // и она осталась бы там, где последний раз лежала мышь. Здесь подпись
    // прибита к предмету по построению: она часть его кнопки и показывается
    // одним правилом CSS по `:focus-visible`, без единой строки на кадр.
    //
    // Заодно снимает неоднозначность обвода: габаритный ящик, спроецированный
    // по осям экрана, у монитора накрывает и соседей по столу — имя предмета
    // говорит, на чём фокус, точнее рамки.
    const caption = document.createElement('span')
    caption.className = 'hotspot-btn__label'
    caption.textContent = spot.label
    el.append(caption)
    el.addEventListener('click', () => onActivate(spot))
    layer.append(el)
    pairs.push({ el, obj })
  }

  function sync() {
    // Позиции обновляются ТОЛЬКО в клавиатурном режиме. Мышь этими кнопками
    // не пользуется, а шесть перекладываний transform каждый кадр ради
    // невидимых элементов — трата на ровном месте: кадр в этой комнате
    // считают по драуколлам, но раскладка браузера тоже не бесплатна.
    if (!keyboard.active()) return
    syncCamera()
    const vw = window.innerWidth
    const vh = window.innerHeight
    for (const p of pairs) {
      const r = screenRect(p.obj, camera, vw, vh)
      // `null` — предмет за спиной камеры. Спрятать, а не оставить на
      // старом месте: иначе обвод встанет на пустоту, а `Tab` уведёт туда,
      // где ничего нет. Скрытая кнопка вдобавок выпадает из обхода сама.
      if (!r) {
        p.el.hidden = true
        continue
      }
      p.el.hidden = false
      p.el.style.transform = `translate(${r.x}px, ${r.y}px)`
      p.el.style.width = `${r.w}px`
      p.el.style.height = `${r.h}px`
    }
  }

  // Разложить СИНХРОННО в момент включения режима, а не ждать кадра.
  // Браузер переставляет фокус по Tab сразу после того, как событие
  // разошлось по дереву, — а `keyboardMode` слушает перехват. Значит вот
  // этот вызов успевает до того, как фокус встанет на кнопку. Без него
  // первый обвод мигнул бы в левом верхнем углу: кнопки ещё не сдвинуты.
  const unwatch = keyboard.onChange((on) => {
    if (on) sync()
  })

  return {
    sync,
    dispose() {
      unwatch()
      for (const p of pairs) p.el.remove()
    },
  }
}
