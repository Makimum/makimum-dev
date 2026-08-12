import { SHOTS, type Block } from '../screens/content'

/**
 * Описание узла вместо самого узла.
 *
 * Дерево контента собирается БЕЗ DOM намеренно: это делает его проверяемым
 * прогоном в bun, где никакого document нет. Цена — пятнадцать строк
 * монтировщика в mount.ts; выигрыш — тип блока не может выпасть молча.
 */
export interface VNode {
  tag: string
  text?: string
  attrs?: Record<string, string>
  kids?: VNode[]
}

export const el = (tag: string, text?: string, attrs?: Record<string, string>, kids?: VNode[]): VNode => ({
  tag,
  ...(text ? { text } : {}),
  ...(attrs ? { attrs } : {}),
  ...(kids ? { kids } : {}),
})

/** Ссылка наружу — единственное место, где страница выпускает посетителя,
 *  поэтому только новая вкладка и только с rel против window.opener. */
const link = (label: string, href: string): VNode =>
  el('a', label, { href, target: '_blank', rel: 'noopener noreferrer', class: 'lnk' })

export function blockNodes(b: Block): VNode[] {
  switch (b.t) {
    case 'lead':
      return [el('p', b.text, { class: 'lead' })]
    case 'p':
      return [el('p', b.text)]
    case 'note':
      return [el('p', b.text, { class: 'note' })]
    case 'h':
      return [el('h3', b.sub ? `${b.text} — ${b.sub}` : b.text)]
    case 'kicker':
      return [el('h4', b.text, { class: 'kicker' })]
    case 'metrics':
      return [
        el('ul', undefined, { class: 'metrics' },
          b.items.map((m) =>
            el('li', undefined, undefined, [
              el('b', m.value),
              el('span', m.label),
            ]),
          ),
        ),
      ]
    case 'bullets':
      return [el('ul', undefined, undefined, b.items.map((i) => el('li', i)))]
    case 'stack':
      return [el('p', b.items.join(' · '), { class: 'stack' })]
    case 'link':
      // PDF — кнопка под палец, а не ссылка в строке текста: в мелкий текст
      // на телефоне пальцем не попасть, а за резюме сюда и приходят.
      if (b.href.endsWith('.pdf')) {
        return [
          el('p', undefined, undefined, [
            el('a', b.label, {
              href: b.href,
              class: 'btn',
              download: '',
            }),
          ]),
        ]
      }
      return [el('p', undefined, undefined, [link(b.label, b.href)])]
    case 'rule':
      return [el('hr')]
    case 'gap':
      // `size` читает и paint.ts (там это пиксели канваса), поэтому поле
      // не может молча значить «только для комнаты»: заданный размер
      // уезжает в инлайновую высоту, незаданный остаётся за классом.
      return [
        el('div', undefined, {
          class: 'gap',
          ...(b.size ? { style: `height:${b.size}px` } : {}),
        }),
      ]
    case 'photo':
      // Пропорция приезжает из данных и уходит в CSS-переменную: без неё
      // страница дёргается при догрузке картинки.
      return [
        el('figure', undefined, { class: 'shot banner', style: `--ratio:${b.ratio}` }, [
          el('img', undefined, {
            src: b.src,
            alt: b.caption ?? 'Maxim Fursov',
            loading: 'lazy',
            decoding: 'async',
          }),
          ...(b.caption ? [el('figcaption', b.caption)] : []),
        ]),
      ]
    case 'shots':
      // Пруфы — те же снимки, что в галерее комнаты, из того же массива.
      // Второго списка картинок в проекте быть не должно.
      //
      // ЛЕНТА, А НЕ СТОЛБИК. Столбиком шесть снимков занимали 2853 пикселя —
      // три с половиной экрана телефона, и до контактов после них почти
      // никто не доезжал. Горизонтальная лента укладывает их в один экран
      // и просит тот же жест, которым и так смотрят фотографии.
      return [
        el('div', undefined, { class: 'shots', role: 'list' },
          SHOTS.map((s) =>
            el('figure', undefined, { class: 'shot', role: 'listitem' }, [
              el('img', undefined, {
                src: s.src,
                alt: s.title,
                loading: 'lazy',
                decoding: 'async',
              }),
              el('figcaption', undefined, undefined, [
                el('b', s.title),
                el('span', s.note),
              ]),
            ]),
          ),
        ),
      ]
    default: {
      // Новый тип блока обязан сломать `bun run check` — его шаг
      // `tsc --noEmit` и ловит это присваивание. Именно команду, а не
      // «сборку»: `vite build` типы не проверяет, а `bun run` их стирает,
      // так что до рантайма здесь дело не дойдёт только через check.
      // Прежняя версия этого кода отправляла в `default: break` четыре
      // типа сразу, и вместе с ними — фотографию и все шесть пруфов.
      const never: never = b
      throw new Error(`неизвестный блок: ${JSON.stringify(never)}`)
    }
  }
}
