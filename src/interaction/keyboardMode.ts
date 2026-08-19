/**
 * Есть ли у посетителя клавиатура — не угадывается, а ПРОЯВЛЯЕТСЯ.
 *
 * ПОЧЕМУ НЕ МЕДИАЗАПРОСОМ. Надёжного способа спросить «пристёгнута ли
 * клавиатура» не существует. `any-pointer: fine` ловит трекпад Magic
 * Keyboard — но у Smart Keyboard Folio трекпада нет вовсе, и такая
 * клавиатура до первого нажатия невидима в принципе. Гадать по ширине
 * экрана или по UA — тем более мимо: на iPad Safari отдаёт `pointer: coarse`
 * и с клавиатурой, и без неё.
 *
 * Поэтому тот же приём, которым браузер решает про `:focus-visible`: до
 * первого навигационного нажатия комната ведёт себя как прежде, после —
 * показывает обвод и подпись. Взятый в руку указатель гасит обратно.
 * Ничего не навязываем, отвечаем на уже проявленное намерение.
 *
 * ПОЧЕМУ ФАБРИКА, А НЕ ПОДПИСКА ПРИ ИМПОРТЕ. Слушатели вешаются на окно, и
 * модуль, делающий это при импорте, нельзя ни выключить, ни собрать дважды
 * в тестах. Здесь как у `createFocus` и `createLampSwitch`: явное создание,
 * явный `dispose`.
 */

/**
 * Клавиши, означающие «я иду по интерфейсу с клавиатуры».
 *
 * Букв тут нет намеренно: человек, случайно задевший клавишу во время
 * чтения, не просил показывать ему обводы. Обычные печатные символы этого
 * намерения не выражают, а Tab и стрелки — выражают.
 */
const NAV_KEYS: ReadonlySet<string> = new Set([
  'Tab',
  'Enter',
  ' ',
  'Escape',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
])

/**
 * Cmd + . — второй выход из фокуса, он же признак клавиатуры.
 *
 * Существует потому, что клавиши Esc нет на Smart Keyboard Folio и на Magic
 * Keyboard для iPad 2020–2022: Apple объявляет функциональный ряд только у
 * Magic Keyboard Folio («14-key function row, including an escape key») и у
 * Magic Keyboard для iPad Pro M4. Cmd + . — давняя конвенция Apple «отмена».
 */
export function isCancelChord(e: KeyboardEvent): boolean {
  return e.metaKey && e.key === '.'
}

export function isNavKey(e: KeyboardEvent): boolean {
  return NAV_KEYS.has(e.key) || isCancelChord(e)
}

export interface KeyboardMode {
  /** Идёт ли человек по комнате с клавиатуры прямо сейчас. */
  active(): boolean
  /** Подписка на смену. Возвращает отписку. */
  onChange(cb: (on: boolean) => void): () => void
  dispose(): void
}

export function createKeyboardMode(): KeyboardMode {
  let on = false
  const listeners = new Set<(v: boolean) => void>()

  function set(v: boolean) {
    if (on === v) return
    on = v
    // Атрибут на корне — чтобы CSS мог отличить одно состояние от другого,
    // не спрашивая ни у кого. Читать его в JS незачем: для этого есть
    // `active()`, и второй источник правды тут не нужен.
    document.documentElement.dataset.keyboard = v ? 'on' : 'off'
    for (const cb of listeners) cb(v)
  }

  // ФАЗА ПЕРЕХВАТА, и это не косметика. Браузер переставляет фокус по Tab
  // ПОСЛЕ того, как событие разошлось по дереву. Значит подписчики,
  // разложившие кнопки по своим местам синхронно вот здесь, успевают до
  // того, как фокус на одну из них встанет. Слушая всплытие, мы бы опоздали
  // ровно на один кадр — и первый обвод мигнул бы в углу экрана.
  const onKeyDown = (e: KeyboardEvent) => {
    if (isNavKey(e)) set(true)
  }
  // Взяли указатель — обводы больше не нужны. Ровно так же ведёт себя
  // `:focus-visible` у самого браузера.
  const onPointerDown = () => set(false)

  addEventListener('keydown', onKeyDown, { capture: true })
  addEventListener('pointerdown', onPointerDown, { capture: true })

  return {
    active: () => on,
    onChange(cb) {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    dispose() {
      removeEventListener('keydown', onKeyDown, { capture: true })
      removeEventListener('pointerdown', onPointerDown, { capture: true })
      listeners.clear()
      delete document.documentElement.dataset.keyboard
    },
  }
}
