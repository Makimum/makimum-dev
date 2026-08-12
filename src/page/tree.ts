import { DECK, getDoc, type Block } from '../screens/content'
import { blockNodes, el, type VNode } from './blocks'

/**
 * Порядок разделов страницы.
 *
 * Он НЕ выводится обходом APPS, хотя соблазн есть. Причины две. Реестр
 * приложений разложен под два разных экрана комнаты — на мониторе смотрят,
 * на ноутбуке читают, — и этот порядок к странице отношения не имеет.
 * И второе: обход APPS даёт восемь секций при семи документах, потому что
 * у деки документа нет; одна секция выходила пустой.
 *
 * Порядок здесь — под рекрутёра: сначала что сделано и с какими цифрами,
 * потом пруфы, потом кто это, потом как связаться.
 *
 * Тетрис идёт последним, и это не «на всякий случай». Рекрутёру он не
 * первоочерёден — за ним сюда не приходят, и выше контактов ему делать
 * нечего. Но это работающий код со своими правилами (SRS, wall kicks,
 * семибэг), и выпасть из машиночитаемого дерева он не может: один раз он
 * уже выпал вместе с удалённым a11y.ts, и его текста не осталось ни на
 * странице, ни в скрытом дереве комнаты.
 */
/**
 * Насколько раздел ужат на странице.
 *
 * `full` — общее правило: на виду то, по чему решают глазами.
 * `lean` — только фотография, цифры один раз и кнопка (резюме).
 * `note` — одна строка и всё (раздел про устройство комнаты).
 */
type Density = 'full' | 'lean' | 'note'

export const SECTIONS: { key: string; title: string; density?: Density }[] = [
  /**
   * Резюме стоит ПЕРВЫМ, сразу под шапкой, и это главный порядковый выбор
   * страницы. За резюме рекрутёр сюда и приходит: не «посмотреть проекты»,
   * а понять, стоит ли звать на разговор. Держать его четвёртым значило
   * прятать то единственное, что человек искал, за тремя экранами.
   *
   * Ужато оно при этом сильнее прочих — фотография, цифры и кнопка. Текст
   * резюме пересказывал бы Projects и About теми же словами ниже по
   * странице, а настоящее резюме — это PDF: он и есть кнопка.
   */
  { key: 'resume', title: 'Résumé', density: 'lean' },
  { key: 'projects', title: 'Projects' },
  { key: 'gallery', title: 'Receipts' },
  { key: 'about', title: 'About' },
  { key: 'contact', title: 'Contact' },
  /**
   * «This Room» на телефоне ужата до одной строки и уехала вниз. Рассказ о
   * том, как сделана сцена, — гордость проекта, но не то, ради чего
   * открывают ссылку с телефона: комнату оттуда всё равно не видно, пока
   * не нажмёшь кнопку. Числа сцены при этом не теряются — они стоят в
   * Projects, где makimum.dev перечислен как проект, и повторять их
   * второй раз незачем.
   */
  { key: 'room', title: 'This Room', density: 'note' },
  { key: 'tetris', title: 'Tetris' },
]

/**
 * Дека — единственный раздел под `<details>`.
 *
 * Её текст нужен поисковику (в нём цифры трекшена), но разворачивать шесть
 * слайдов посреди страницы значит утопить контакты. Нативный `<details>`
 * решает это без единой строки скрипта.
 */
function deckNodes(): VNode {
  const kids: VNode[] = [el('summary', 'VettaX — pitch deck')]
  for (const [i, s] of DECK.entries()) {
    kids.push(el('h3', `${i + 1}. ${s.kicker} — ${s.headline}`))
    if (s.sub) kids.push(el('p', s.sub))
    if (s.body) kids.push(el('p', s.body))
    for (const n of s.numbered ?? []) kids.push(el('p', `${n.n} ${n.title} — ${n.text}`))
    if (s.metrics) {
      kids.push(
        el('ul', undefined, { class: 'metrics' },
          s.metrics.map((m) => el('li', undefined, undefined, [el('b', m.value), el('span', m.label)])),
        ),
      )
    }
    for (const b of s.bullets ?? []) kids.push(el('p', b))
    for (const f of s.foot ?? []) kids.push(el('p', f))
    if (s.cta) kids.push(el('p', s.cta))
  }
  return el('details', undefined, { class: 'deck' }, kids)
}

/**
 * Правая колонка целиком, но без контактных ссылок.
 *
 * Aside писалась под боковую колонку в комнате, где контакты рядом с
 * основным текстом удобны. На странице каждый раздел — вертикальный поток,
 * а внизу есть отдельный раздел Contact; контакты, повторённые трижды (в
 * About, в Résumé и в Contact), читаются как заевшая пластинка.
 *
 * Исключение — ссылка на PDF: это не контакт, живёт она только в aside, и
 * другого места скачать резюме на странице нет.
 */
function filterAsideBlocks(aside: Block[]): Block[] {
  return aside.filter(
    (b) => !(b.t === 'link' && !b.href.endsWith('.pdf')),
  )
}

/**
 * Выбросить киккеры, оставшиеся без содержимого.
 *
 * После фильтрации киккер может остаться один: в Résumé под «Contact»
 * лежали ссылки, которые только что убрали, и пустой заголовок выглядит
 * поломкой.
 *
 * Смотрим РОВНО на следующий блок, а не на весь кусок до следующего
 * киккера: содержимое всегда идёт сразу за заголовком, и если сразу за ним
 * стоит другой киккер, разделитель или конец списка — держать нечего.
 */
function removeOrphanedKickers(blocks: VNode[]): VNode[] {
  const out: VNode[] = []
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i]
    if (block.tag === 'h4' && block.attrs?.class === 'kicker') {
      const next = blocks[i + 1]
      const hasContent = !!next && next.tag !== 'h4' && next.tag !== 'hr'
      if (hasContent) out.push(block)
    } else {
      out.push(block)
    }
  }
  return out
}

/**
 * Что остаётся на виду, а что уезжает под раскрытие.
 *
 * Страница мерялась: 1421 слово, семь минут чтения, тринадцать экранов
 * телефона. Рекрутёр, открывший ссылку между делом, столько не читает — и
 * это была прямая жалоба, а не догадка.
 *
 * Резать по счётчику блоков нельзя: получится обрыв на полуслове. Правило
 * содержательное — на виду остаётся то, по чему решение принимается
 * ГЛАЗАМИ: название проекта, одна строка контекста, цифры, снимки,
 * кнопка резюме. Всё остальное — проза, перечни, стек, оговорки — уезжает
 * под «read the full text» и из документа НЕ исчезает: поисковик и
 * скринридер получают тот же текст, что и раньше, просто он больше не
 * требует внимания от того, кто пришёл на две минуты.
 *
 * Первый абзац после заголовка остаётся намеренно: без него проект — это
 * имя и голые числа, а по такому не понять, что человек делал.
 */
function isAlwaysVisible(b: Block): boolean {
  return b.t === 'lead' || b.t === 'h' || b.t === 'metrics' || b.t === 'photo' || b.t === 'shots' || b.t === 'link'
}

function splitByAttention(blocks: Block[], density: Density = 'full'): { seen: Block[]; folded: Block[] } {
  const seen: Block[] = []
  const folded: Block[] = []
  // Один абзац контекста на заголовок: следующий такой же уезжает вниз.
  let paragraphUsed = false
  // В сжатом разделе цифры показываются один раз: дальше идут те же
  // достижения, что уже перечислены выше по странице.
  let metricsUsed = false
  for (const b of blocks) {
    if (b.t === 'h' || b.t === 'lead') paragraphUsed = false
    if (density === 'note') {
      // Одна строка: дальше идёт рассказ, за которым с телефона не приходят.
      if (b.t === 'lead' && seen.length === 0) {
        seen.push(b)
        continue
      }
      if (b.t === 'rule' || b.t === 'gap') continue
      folded.push(b)
      continue
    }
    if (density === 'lean') {
      // Сжатый раздел держит на виду только то, чего нет в других:
      // фотографию, цифры один раз и кнопку.
      //
      // Лид сюда не входит. У резюме он читается «Maxim Fursov — builder,
      // Helsinki», а раздел стоит первым, сразу под заголовком страницы с
      // тем же именем и строкой «Born in Russia, based in Finland» — имя
      // выходило трижды на полутора экранах.
      if (b.t === 'photo' || b.t === 'link') {
        seen.push(b)
        continue
      }
      if (b.t === 'metrics' && !metricsUsed) {
        metricsUsed = true
        seen.push(b)
        continue
      }
      if (b.t === 'rule' || b.t === 'gap') continue
      folded.push(b)
      continue
    }
    if (isAlwaysVisible(b)) {
      seen.push(b)
      continue
    }
    if (b.t === 'p' && !paragraphUsed) {
      paragraphUsed = true
      seen.push(b)
      continue
    }
    // Разделители и отступы сами по себе ничего не говорят, а между
    // уехавшими блоками оставляют висеть пустые линии.
    if (b.t === 'rule' || b.t === 'gap') continue
    folded.push(b)
  }
  if (density === 'lean') {
    // Порядок внутри сжатого раздела задаётся здесь, а не порядком в
    // документе: там сначала идут цифры, и кнопка уезжала на 949-й пиксель,
    // то есть за первый экран телефона. Ради этой кнопки раздел и стоит
    // первым — снимок, кнопка, потом цифры.
    const rank = (b: Block) => (b.t === 'photo' ? 0 : b.t === 'link' ? 1 : 2)
    seen.sort((a, b) => rank(a) - rank(b))
  }
  return { seen, folded }
}

export function contentNodes(): VNode[] {
  const out: VNode[] = []
  for (const s of SECTIONS) {
    const doc = getDoc(s.key)
    const kids: VNode[] = [el('h2', s.title)]
    if (doc) {
      // Правая колонка — через фильтр: контакты, повторённые трижды,
      // читаются как заевшая пластинка, а PDF-ссылке место только здесь.
      // Лид, повторяющий заголовок раздела, — это заголовок дважды.
      // В комнате он был нужен: там у документа своя строка заголовка окна,
      // а первая строка текста работала подзаголовком. На странице заголовок
      // раздела уже стоит выше и набран крупно.
      const sameAsTitle = (b: Block) =>
        b.t === 'lead' && b.text.replace(/[.\s]+$/, '').toLowerCase() === s.title.toLowerCase()
      const all = [...doc.body, ...filterAsideBlocks(doc.aside ?? [])].filter((b) => !sameAsTitle(b))
      const { seen, folded } = splitByAttention(all, s.density)
      kids.push(...removeOrphanedKickers(seen.flatMap(blockNodes)))
      if (folded.length) {
        kids.push(
          el('details', undefined, { class: 'more' }, [
            el('summary', 'read the full text'),
            ...removeOrphanedKickers(folded.flatMap(blockNodes)),
          ]),
        )
      }
    }
    out.push(el('section', undefined, { id: s.key }, kids))
  }
  out.push(deckNodes())
  return out
}
