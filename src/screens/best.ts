/**
 * Рекорд тетриса. Отдельным файлом, потому что его читают двое: игра в
 * комнате и скрытое дерево доступности, которое монтируется ещё до того,
 * как решено грузить сцену. Общий модуль на пятнадцать строк дешевле, чем
 * два места, знающих один и тот же ключ хранилища.
 *
 * Подписан честно: «your best», а не «high score». Сервера у сайта нет,
 * и число это ничьё, кроме этого браузера.
 */

const KEY = 'makimum.tetris.best'

/** localStorage бросает исключение в приватном режиме Safari и при
 *  запрете сторонних данных — рекорд не та вещь, ради которой можно
 *  уронить страницу. */
export function readBest(): number {
  try {
    const raw = localStorage.getItem(KEY)
    const n = raw ? Number.parseInt(raw, 10) : 0
    return Number.isFinite(n) && n > 0 ? n : 0
  } catch {
    return 0
  }
}

export function writeBest(value: number) {
  try {
    localStorage.setItem(KEY, String(Math.max(0, Math.round(value))))
  } catch {
    /* приватный режим: партия просто не переживёт перезагрузку */
  }
}
