/**
 * Прогон страницы без браузера.
 *
 * Существует ровно потому, что дерево контента собирается ЧИСТОЙ функцией:
 * иначе «фотография и шесть пруфов видны» из приёмки проверялось бы
 * разглядыванием, а тихо выпавший тип блока не заметил бы никто.
 *
 *     bun run check          # tsc --noEmit + этот прогон + прогон тетриса
 *     bun run src/page/tree.check.ts   # только он, без проверки типов
 */
import { blockNodes, type VNode } from './blocks'
import type { Block } from '../screens/content'
import { contentNodes } from './tree'

let failed = 0
function check(name: string, ok: boolean, extra = '') {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}${extra ? '  — ' + extra : ''}`)
  if (!ok) failed++
}

/** Все узлы поддерева одним списком — так проще искать тег или атрибут. */
function flat(nodes: VNode[]): VNode[] {
  return nodes.flatMap((n) => [n, ...flat(n.kids ?? [])])
}

/**
 * По одному образцу КАЖДОГО типа блока.
 *
 * Не массив, а словарь по `Block['t']`: у массива образец нового типа
 * пришлось бы не забыть дописать, а здесь пропущенный ключ — ошибка типов,
 * и `bun run check` падает на шаге `tsc --noEmit` ещё до прогона.
 */
const SAMPLES: Record<Block['t'], Block> = {
  lead: { t: 'lead', text: 'lead' },
  p: { t: 'p', text: 'para' },
  h: { t: 'h', text: 'head', sub: 'sub' },
  kicker: { t: 'kicker', text: 'kick' },
  metrics: { t: 'metrics', items: [{ value: '601', label: 'users' }] },
  bullets: { t: 'bullets', items: ['one'] },
  stack: { t: 'stack', items: ['TypeScript'] },
  note: { t: 'note', text: 'note' },
  link: { t: 'link', label: 'site', href: 'https://example.com' },
  rule: { t: 'rule' },
  gap: { t: 'gap' },
  photo: { t: 'photo', src: '/gallery/stage.webp', ratio: 0.4, caption: 'cap' },
  shots: { t: 'shots' },
}

for (const b of Object.values(SAMPLES)) {
  check(`блок «${b.t}» даёт узлы`, blockNodes(b).length > 0)
}

{
  const nodes = flat(blockNodes({ t: 'shots' }))
  const imgs = nodes.filter((n) => n.tag === 'img')
  check('«shots» даёт шесть картинок', imgs.length === 6, `${imgs.length}`)
  check(
    'у каждой картинки есть src и alt',
    imgs.every((n) => n.attrs?.src && n.attrs?.alt),
  )
  check(
    'картинки грузятся лениво',
    imgs.every((n) => n.attrs?.loading === 'lazy'),
  )
}

{
  const nodes = flat(blockNodes({ t: 'photo', src: '/gallery/stage.webp', ratio: 0.4 }))
  check('«photo» даёт картинку', nodes.some((n) => n.tag === 'img'))
}

{
  const a = flat(blockNodes({ t: 'link', label: 'x', href: 'https://x.com' }))
    .find((n) => n.tag === 'a')
  check('ссылка наружу открывается в новой вкладке', a?.attrs?.target === '_blank')
  check('и с rel против window.opener', a?.attrs?.rel === 'noopener noreferrer')
}

{
  const nodes = contentNodes()
  const heads = flat(nodes).filter((n) => n.tag === 'h2').map((n) => n.text)
  // Резюме первым — не косметика: за ним на страницу и приходят. Порядок
  // держится проверкой, потому что уехать он может незаметно, а цена —
  // спрятанное за тремя экранами то единственное, что человек искал.
  check(
    'разделы идут в порядке спеки, резюме первым',
    JSON.stringify(heads) ===
      JSON.stringify(['Résumé', 'Projects', 'Receipts', 'About', 'Contact', 'This Room', 'Tetris']),
    String(heads),
  )
  const imgs = flat(nodes).filter((n) => n.tag === 'img')
  check('на странице шесть пруфов и фотография', imgs.length === 7, `${imgs.length}`)
  const pdfs = flat(nodes).filter((n) => n.attrs?.href?.endsWith('.pdf'))
  check('ровно одна PDF кнопка', pdfs.length === 1, `${pdfs.length}`)
  if (pdfs.length > 0) check('кнопка имеет класс btn', pdfs[0].attrs?.class === 'btn', pdfs[0].attrs?.class)

  // Дубли ссылок: один и тот же href не должен встретиться дважды —
  // именно так контакты трижды расползались по странице.
  const allHrefs = flat(nodes)
    .filter((n) => n.attrs?.href)
    .map((n) => n.attrs?.href as string)
  const uniqueHrefs = new Set(allHrefs)
  check(
    `никаких дублей ссылок (${allHrefs.length} ссылок на странице)`,
    allHrefs.length === uniqueHrefs.size,
    `${allHrefs.length} всего, ${uniqueHrefs.size} уникальных`,
  )

  check('дека не потеряна', flat(nodes).some((n) => n.tag === 'details'))
}

if (failed) throw new Error(`${failed} проверок упало`)
console.log('\nвсе проверки прошли')
