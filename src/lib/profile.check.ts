/**
 * Прогон сравнения подписей кадра без браузера.
 *
 * Существует из-за конкретной ловушки, а не для полноты. `grab()` отдаёт
 * ОБЪЕКТ `{ w, h, cols, rows, sig }`, а сравнение раньше принимало строку —
 * при том что в хендоффе пара документирована как `grab() · compareFrames(a, b)`.
 * Переданные объекты проходили молча: `undefined !== undefined` — ложь,
 * `n = NaN`, цикл не шёл ни разу, наружу уходило `{ ok: true, max: 0 }`.
 *
 * То есть проверка, которая существует ровно затем, чтобы ловить изменения
 * картинки, отвечала «всё совпало» ровно тогда, когда не сравнивала ничего.
 * Этот прогон стоит здесь, чтобы такой ответ больше не мог вернуться.
 *
 *     bun run src/lib/profile.check.ts
 */
import { compareSignatures, type FrameSignature } from './profile'

let failed = 0
function check(name: string, ok: boolean, extra = '') {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}${extra ? '  — ' + extra : ''}`)
  if (!ok) failed++
}

/** Подпись из готовых байтов: две ячейки по три канала. */
function sig(hex: string, cols = 2, rows = 1): FrameSignature {
  return { w: 100, h: 100, cols, rows, sig: hex }
}

const A = sig('000000ffffff')
const B = sig('000000ffffff')
const C = sig('010000ffffff') // один канал отличается на единицу
const D = sig('ff0000ffffff') // один канал отличается на 255

/* ---- то, ради чего прогон и написан ---- */

const objs = compareSignatures(A, B)
check('объекты подписей сравниваются, а не проходят молча',
  objs.ok === true && 'channels' in objs && objs.channels === 6,
  JSON.stringify(objs))

const differing = compareSignatures(A, D)
check('расхождение на объектах ВИДНО',
  differing.ok === true && 'max' in differing && differing.max === 255,
  JSON.stringify(differing))

// Прежнее поведение: здесь возвращалось { ok: true, max: 0 }.
const junk = compareSignatures({ nope: 1 } as unknown as FrameSignature, B)
check('мусор на входе — это ok: false, а не «кадры совпали»',
  junk.ok === false, JSON.stringify(junk))

const empty = compareSignatures(sig(''), sig(''))
check('пустая подпись — тоже отказ, а не идеальное совпадение',
  empty.ok === false, JSON.stringify(empty))

/* ---- обычная работа ---- */

check('строки по-прежнему принимаются',
  compareSignatures(A.sig, B.sig).ok === true)

const same = compareSignatures(A, B)
check('одинаковые кадры: расхождения нет',
  same.ok === true && 'max' in same && same.max === 0 && same.mean === 0)

const one = compareSignatures(A, C)
check('расхождение в единицу видно и в максимуме',
  one.ok === true && 'max' in one && one.max === 1, JSON.stringify(one))

check('разная длина — отказ',
  compareSignatures(sig('000000'), sig('000000ffffff')).ok === false)

check('разная сетка названа по имени',
  compareSignatures(sig('000000ffffff', 2, 1), sig('000000ffffff', 1, 2)).ok === false)

console.log('')
// Падаем исключением, а не `process.exit`: у проекта нет типов Node, и
// тащить их ради одной строки — плохой обмен. Так же устроены остальные
// прогоны.
if (failed) throw new Error(`${failed} проверок сравнения кадров упало`)
console.log('сравнение подписей в порядке')
