import { currentMode } from '../lobby'
import { readBest } from '../screens/best'
import { contentNodes } from './tree'
import type { VNode } from './blocks'

/**
 * Единственный файл части 1, которому нужен браузер.
 *
 * Контент в документе существует в ОДНОМ экземпляре. Собрать видимую
 * страницу отдельно от скрытого дерева значило бы положить в разметку две
 * копии всего текста: поисковик увидел бы дублирование, а скринридер
 * прочитал бы всё дважды. Поэтому дерево одно, а видимая оно или скрытая —
 * решает правило CSS по `data-mode`, и при смене режима переодевать его
 * никому не надо.
 */
function toDom(v: VNode): HTMLElement {
  const node = document.createElement(v.tag)
  if (v.text) node.textContent = v.text
  for (const [k, val] of Object.entries(v.attrs ?? {})) node.setAttribute(k, val)
  for (const kid of v.kids ?? []) node.append(toDom(kid))
  return node
}

/**
 * `force` пересобирает уже смонтированное дерево вместо того, чтобы молча
 * выйти.
 *
 * Нужен ровно одному вызывающему: `main.ts`, ровно один раз, сразу после
 * того как сцена посчитала свои треугольники (см. `resetDocCache()` рядом
 * с этим вызовом). Без пересборки узел с числом треугольников в этом дереве
 * навсегда остаётся с тем, что было на момент ПЕРВОЙ сборки — она уходит
 * из `entry.ts` синхронно, раньше, чем сцена вообще загрузилась. Раньше это
 * было незаметно, потому что «раньше» и «после замера» совпадали числом;
 * `resetDocCache()` эту одновременность убрал только для чтений на будущее
 * (панели комнаты через `getDoc()`), а само дерево так и осталось со старым
 * узлом — то есть без `force` ровно тот же канал расхождения, который
 * чинили, просто переехавший из «кэш» в «DOM».
 *
 * В момент пересборки её никто не видит: она случается, когда комната уже
 * открыта, а там дерево спрятано за холстом (`data-mode="room"` рисует
 * `#scene` поверх). Но результат видят — крестиком из комнаты выходят и на
 * телефоне, и на десктопе, и дальше это дерево и есть страница.
 */
export function mountContent(force = false) {
  const existing = document.getElementById('content')
  if (existing) {
    if (!force) return
    existing.remove()
  }

  const main = document.createElement('main')
  main.id = 'content'

  const h1 = document.createElement('h1')
  // Домен и так стоит в <title> и og:title — здесь только имя,
  // не строка документа.
  h1.textContent = 'Maxim Fursov'
  main.append(h1)

  const sub = document.createElement('p')
  sub.className = 'sub'
  sub.textContent = 'Born in Russia, based in Finland.'
  main.append(sub)

  // Ни слова «откройте с ноутбука»: страница обязана работать сама.
  // Это приглашение, а не извинение.
  //
  // И ни слова о том, С ЧЕГО читают: страницу теперь видят на обеих
  // поверхностях. На телефоне — сразу, на ноутбуке — как только посетитель
  // вышел из комнаты крестиком. Строка «this site on a laptop» стояла бы
  // ровно перед тем, кто на ноутбуке и есть.
  const hint = document.createElement('p')
  hint.className = 'note'
  hint.textContent =
    'That is the room this site is made of — rendered by code in the browser, with no 3D assets downloaded. Everything in it is written out below.'
  main.append(hint)

  for (const v of contentNodes()) main.append(toDom(v))

  // Рекорд тетриса — единственное число этого дерева, которого нет в
  // content.ts. Читается один раз, живым регионом не становится.
  //
  // Про деку и тетрис хвост говорит уже не «они где-то есть» — оба раздела
  // стоят выше по тексту. Он говорит, чего у текста нет: их нельзя листать
  // и в них нельзя играть нигде, кроме экранов комнаты.
  const best = readBest()
  const tail = document.createElement('p')
  tail.className = 'tail'
  tail.textContent = best
    ? `The deck and the Tetris board above are working screens inside the room; here they are only their text. Your best so far: ${best}.`
    : 'The deck and the Tetris board above are working screens inside the room; here they are only their text.'
  main.append(tail)

  document.body.append(main)
  revealOnApproach(main)
}

/**
 * Проявление при подходе — поддерживающее движение, не авторское.
 *
 * Класс вешается СКРИПТОМ, а умолчание у всего видимое: если скрипт не
 * отработал или наблюдателя в браузере нет, страница остаётся читаемой
 * целиком. Обратный порядок (спрятать в разметке, показать скриптом) —
 * самый дешёвый способ отдать посетителю пустую страницу.
 *
 * Проявляются только заголовки разделов и снимки: то, чем страница
 * говорит без слов. Проявлять каждый абзац значит превратить чтение в
 * череду одинаковых выездов — ровно то, чего просили не делать.
 *
 * Наблюдатель одноразовый: проявившееся не гаснет обратно при обратной
 * прокрутке, иначе страница мигает под пальцем.
 */
function revealOnApproach(root: HTMLElement) {
  if (!('IntersectionObserver' in window)) return
  // Только в режиме страницы. В комнате это же дерево смонтировано
  // спрятанным (клип в один пиксель), его узлы нулевого размера, и порог
  // видимости на них не сработает НИКОГДА — а классы уже висят. Посетитель
  // десктопа, вышедший из комнаты крестиком, получил бы пустую страницу.
  if (currentMode() !== 'page') return

  // Просьбу уменьшить движение НЕ проверяем здесь. Раньше проверяли, и это
  // была ошибка того же рода, что выключать движение целиком: элементы
  // появлялись мгновенно, без всякого перехода. Ступени задаёт CSS —
  // здесь сдвиг, там одно затухание, — а этот код одинаков для обоих.

  const targets = root.querySelectorAll<HTMLElement>('section > h2, .shot')
  if (!targets.length) return

  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue
        // Сдвиг внутри ленты снимков — по порядку, но с потолком: без него
        // шестой кадр ждал бы полсекунды после первого.
        const shots = e.target.parentElement?.classList.contains('shots')
        const i = shots ? [...e.target.parentElement!.children].indexOf(e.target) : 0
        ;(e.target as HTMLElement).style.transitionDelay = `${Math.min(i * 60, 180)}ms`
        e.target.classList.add('is-in')
        io.unobserve(e.target)
      }
    },
    // Проявление начинается до того, как элемент доехал до кромки: иначе
    // движение видно только тем, кто листает медленно.
    { rootMargin: '0px 0px -12% 0px', threshold: 0.15 },
  )
  for (const t of targets) {
    t.classList.add('reveal')
    // Что уже в первом экране — показываем сразу, не дожидаясь наблюдателя.
    // Проявлять то, на что человек и так смотрит, нечего; а заодно это
    // страховка: элемент над кромкой не может остаться спрятанным, если
    // наблюдатель почему-то не сработает.
    if (t.getBoundingClientRect().top < window.innerHeight * 0.9) {
      t.classList.add('is-in')
      continue
    }
    io.observe(t)
  }
}
