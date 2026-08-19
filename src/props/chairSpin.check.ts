/**
 * Прогон выбега кресла без браузера.
 *
 * ЗАЧЕМ ОН ПОЯВИЛСЯ. Толчок клавишей задуман так, что один толчок — это
 * ровно один оборот: при экспоненциальном затухании весь выбег даёт угол
 * `v₀ · τ`, поэтому скорость СЧИТАЕТСЯ как `2π / SPIN_DAMPING`, а не
 * подбирается. Проверить это в живом браузере не вышло: в headless идёт
 * программный рендер, кадр там около 400 мс, и выбег интегрируется шагами
 * по 0.4 с — при таком шаге и порог остановки, и ошибка метода Эйлера
 * искажают ответ сильнее, чем сама механика. Замер получался про среду, а
 * не про кресло.
 *
 * Здесь время СИНТЕТИЧЕСКОЕ: шаг 1/60 подаётся руками, поэтому ответ не
 * зависит ни от машины, ни от загрузки, ни от того, есть ли видеокарта.
 *
 *     bun run src/props/chairSpin.check.ts
 */
import * as THREE from 'three'
import { createChairSpin } from './chairSpin'

let failed = 0
function check(name: string, ok: boolean, extra = '') {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}${extra ? '  — ' + extra : ''}`)
  if (!ok) failed++
}

function makeChair() {
  const scene = new THREE.Scene()
  const chair = new THREE.Object3D()
  chair.name = 'chair'
  scene.add(chair)
  const spin = createChairSpin(scene)
  if (!spin) throw new Error('кресло не собралось')
  return { chair, spin }
}

/** Прокрутить выбег до остановки шагами по 1/60 с. Возвращает угол и время. */
function coast(spin: ReturnType<typeof makeChair>['spin'], chair: THREE.Object3D) {
  const from = chair.rotation.y
  const STEP = 1 / 60
  let seconds = 0
  // Потолок в 60 с — чтобы неостанавливающееся кресло провалило прогон, а
  // не подвесило его.
  while (spin.moving() && seconds < 60) {
    spin.update(STEP)
    seconds += STEP
  }
  return { angle: chair.rotation.y - from, seconds }
}

/* ---------------------------------------------------------------- */

{
  const { chair, spin } = makeChair()
  spin.nudge()
  const { angle, seconds } = coast(spin, chair)
  // Метод Эйлера при шаге 1/60 даёт около процента сверху — это не
  // погрешность замера, а свойство интегрирования, и оно устойчиво.
  check('один толчок — один оборот',
    Math.abs(angle - Math.PI * 2) < 0.15,
    `${angle.toFixed(3)} рад против 2π = ${(Math.PI * 2).toFixed(3)}, за ${seconds.toFixed(1)} с`)
  check('кресло останавливается само', !spin.moving())
  check('выбег длится единицы секунд, а не минуту', seconds > 2 && seconds < 12,
    `${seconds.toFixed(1)} с`)
}

{
  const { spin } = makeChair()
  spin.nudge()
  check('во время выбега тень обязана пересчитываться', spin.moving())
}

{
  // Под рукой клавиша не мешает: указатель главнее автоматики — то же
  // правило, что у лампы.
  const { chair, spin } = makeChair()
  spin.begin(0)
  const before = chair.rotation.y
  spin.nudge()
  check('толчок не вмешивается, пока предмет тащат', chair.rotation.y === before)
  spin.end()
}

{
  // Толчок по уже крутящемуся креслу задаёт скорость заново, а не
  // складывается с прежней: иначе частым нажатием кресло разгонялось бы в
  // вентилятор, от которого его и уводили.
  const { chair, spin } = makeChair()
  spin.nudge()
  spin.update(1 / 60)
  spin.nudge()
  const { angle } = coast(spin, chair)
  check('повторный толчок не разгоняет кресло без предела',
    Math.abs(angle - Math.PI * 2) < 0.3, `${angle.toFixed(3)} рад`)
}

{
  // `shadowDirty` — читатель, который сбрасывает флаг. Мгновенного
  // поворота здесь нет (настройка «уменьшить движение» в прогоне не
  // включена), поэтому флаг обязан молчать.
  const { spin } = makeChair()
  spin.nudge()
  check('без мгновенного поворота флаг тени молчит', spin.shadowDirty() === false)
}

console.log('')
// Падаем исключением, а не `process.exit`: у проекта нет типов Node, и
// тащить их ради одной строки — плохой обмен. Так же устроены остальные
// прогоны.
if (failed) throw new Error(`${failed} проверок кресла упало`)
console.log('выбег кресла в порядке')
