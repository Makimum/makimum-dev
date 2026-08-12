import * as THREE from 'three'
import { box } from '../lib/geo'
import { surface } from '../lib/materials'
import { pageBlockMaterial } from '../lib/pageBlock'
import { BEVEL, BOOK, PALETTE } from '../constants'

/**
 * Книга в твёрдом переплёте, закрытая, лежит на столе.
 *
 * Книгу выдают три вещи, и все три сделаны явно:
 *   1) КАНТ — переплётные крышки выступают за блок на пару миллиметров
 *      с трёх сторон. Без канта получается брусок, а не книга: именно
 *      этот выступ и тень под ним говорят, что твёрдая крышка отдельна
 *      от бумаги.
 *   2) КОРЕШОК СКРУГЛЁН. У блока в твёрдом переплёте корешок круглый —
 *      его кругляют при сшивке. Прямой корешок читается как коробка.
 *   3) ОБРЕЗ — не гладкая плоскость. Это торцы сотен листов, и на нём
 *      видна слоистость. Она делается модуляцией в шейдере, а не тремя
 *      сотнями тонких боксов: разница в кадре нулевая, в треугольниках
 *      трёхзначная.
 *
 * Плюс ленточка-закладка: узкая полоса того же красного, что рама
 * кресла и основание лампы. Она здесь работает не украшением, а связкой —
 * третьей точкой одного акцента, чтобы книга не оказалась в комнате
 * предметом из другого набора.
 *
 * НАЗВАНИЯ НА КОРЕШКЕ НЕТ. Что читает Максим — факт о живом человеке,
 * и он не выдумывается; см. `BOOK.title` в constants.
 */

function part(
  geo: THREE.BufferGeometry,
  mat: THREE.Material,
  pos: [number, number, number],
  name: string,
  rot?: [number, number, number],
): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat)
  m.position.set(...pos)
  if (rot) m.rotation.set(...rot)
  m.name = name
  m.castShadow = true
  m.receiveShadow = true
  return m
}

/**
 * Тиснение на корешке.
 *
 * Рисуется на холсте и кладётся на цилиндр корешка. Развёртка у
 * `CylinderGeometry` такая: `u` идёт поперёк, по дуге, `v` — вдоль оси,
 * то есть вдоль высоты книги. Название на корешке читается СНИЗУ ВВЕРХ
 * по этой оси, значит на холсте его надо повернуть — отсюда и разворот
 * контекста, и пропорции холста 1:4, повторяющие дугу против высоты.
 *
 * Тиснение светлое, но НЕ белое: на переплётной ткани это фольга или
 * краска, у которой всегда есть тон подложки. Чистый белый читался бы
 * как наклейка.
 *
 * Возвращает `null`, если названия нет: тогда корешок остаётся гладким
 * и лишнего холста в памяти не заводится.
 */
function spineTexture(title: string | null): THREE.CanvasTexture | null {
  if (!title) return null

  // Дуга корешка против его высоты: πr / h ≈ 0.05 / 0.216. Холст держит
  // ту же пропорцию, иначе буквы поедут по одной оси.
  const W = 256
  const H = 1024
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')!

  ctx.fillStyle = '#' + PALETTE.bookCloth.toString(16).padStart(6, '0')
  ctx.fillRect(0, 0, W, H)

  ctx.save()
  // Разворот на 90°: после него ось X холста идёт вдоль высоты книги.
  ctx.translate(W / 2, H / 2)
  ctx.rotate(-Math.PI / 2)
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = '#d9cfae'
  // Разрядка вручную: у корешка её всегда делают, без неё название
  // читается как строка из документа, а не как тиснение.
  ctx.font = '600 78px ui-monospace, "SF Mono", Menlo, monospace'
  const letters = [...title.toUpperCase()]
  const spacing = 12
  const widths = letters.map((c) => ctx.measureText(c).width + spacing)
  let x = -(widths.reduce((a, b) => a + b, 0) - spacing) / 2
  for (let i = 0; i < letters.length; i++) {
    ctx.fillText(letters[i], x + widths[i] / 2 - spacing / 2, 0)
    x += widths[i]
  }
  // Две линейки над и под названием — типовой приём переплётчика,
  // и они же удерживают строку от плавания по пустому корешку.
  ctx.strokeStyle = 'rgba(217,207,174,0.55)'
  ctx.lineWidth = 5
  const half = (widths.reduce((a, b) => a + b, 0) - spacing) / 2
  for (const dy of [-64, 64]) {
    ctx.beginPath()
    ctx.moveTo(-half, dy)
    ctx.lineTo(half, dy)
    ctx.stroke()
  }
  ctx.restore()

  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 8
  return tex
}

/**
 * Скруглённый корешок — дуга, натянутая между кромками двух крышек.
 *
 * ПОЧЕМУ НЕ ПОЛОВИНА ЦИЛИНДРА. Первая версия брала ровно полуцилиндр
 * радиусом в половину толщины книги, и это неверно дважды.
 *
 * Во-первых, у настоящего переплёта корешок кругляют ПОЛОГО: выпуклость
 * выходит за кромку крышки миллиметров на семь, а не на половину толщины
 * книги. Полуцилиндр давал бы книге лишние шестнадцать миллиметров
 * ширины и силуэт валика, а не корешка.
 *
 * Во-вторых, у той версии выпуклость смотрела ВВЕРХ. Развороты стояли
 * `rotation.x = π/2` и `rotation.y = -π/2`, и комментарий рядом уверял,
 * что это ставит открытую половину внутрь книги. Проверка показала
 * обратное: у `CylinderGeometry` дуга от θ = 90° до 270° выпуклостью
 * смотрит в −Z, поворот вокруг X переводит её в +Y, а поворот вокруг Y
 * этого не меняет — ось вращения и направление совпали. Корешка просто
 * не было видно ни с одного ракурса, и заметить это удалось только
 * наведя камеру по замеренной нормали.
 *
 * Теперь дуга считается из двух физических величин: хорда — расстояние
 * между кромками крышек, стрелка — насколько корешок выступает наружу.
 * Радиус и угол выводятся из них, а не подбираются.
 */
function roundedSpine(
  chord: number,
  sagitta: number,
  height: number,
  mat: THREE.Material,
): { mesh: THREE.Mesh; radius: number } {
  // R = (c²/4 + s²) / 2s — радиус окружности по хорде и стрелке.
  const radius = (Math.pow(chord / 2, 2) + sagitta * sagitta) / (2 * sagitta)
  const halfAngle = Math.asin(Math.min(1, chord / 2 / radius))

  const geo = new THREE.CylinderGeometry(
    radius,
    radius,
    height,
    28,
    1,
    // Открытая труба: торцы дуги упираются в кромки крышек, и крышки
    // диска там были бы видны треугольниками поперёк корешка.
    true,
    // Дуга центрируется на θ = π — это направление, которое повороты
    // ниже переводят ровно в −X, то есть наружу от блока.
    Math.PI - halfAngle,
    halfAngle * 2,
  )
  const m = new THREE.Mesh(geo, mat)
  m.name = 'book-spine'
  m.castShadow = true
  m.receiveShadow = true
  // Ось трубы вдоль высоты книги (локальный Z), выпуклость в −X.
  //
  // Разворот ПОДОБРАН ЗАМЕРОМ, а не выведен на бумаге, и в этом весь
  // смысл: рассуждение про порядок Эйлера здесь уже давало неверный
  // ответ дважды. Четыре кандидата собирались в живой сцене, и у каждого
  // считался габаритный ящик; нужен тот, что даёт [7 мм, 32 мм, 216 мм] —
  // стрелка, хорда и высота книги по своим осям. Это (π/2, π/2, 0).
  // Остальные три клали корешок плашмя: [216, 7, 32].
  m.rotation.set(Math.PI / 2, Math.PI / 2, 0)
  return { mesh: m, radius }
}

/**
 * Книга. Локальные координаты: X — от корешка к обрезу, Z — вдоль
 * корешка, Y — вверх (книга лежит плашмя). Начало — центр книги на
 * уровне стола, поэтому ставить её достаточно одной позицией.
 */
export function buildBook(): THREE.Group {
  const g = new THREE.Group()
  g.name = 'book'

  const clothMat = surface(PALETTE.bookCloth, 'matte')
  const pagesMat = pageBlockMaterial(PALETTE.bookPages)
  const { w, h, block, board, square } = BOOK

  // Блок страниц. Уже крышек на кант с трёх сторон — со стороны корешка
  // канта нет, там блок и крышка сходятся.
  //
  // ЗНАК СМЕЩЕНИЯ ВАЖЕН, и он ловится только замером. Корешок у нас
  // слева (−X), обрез справа. Блок обязан НЕ ДОХОДИТЬ до правой кромки
  // крышки на кант — значит его центр уезжает ВЛЕВО, к корешку. С плюсом
  // блок вставал заподлицо с крышкой, канта не оставалось вовсе, и книга
  // читалась бруском: именно так и вышло с первого раза.
  const blockW = w - square
  const blockH = h - square * 2
  const pages = part(
    box(blockW, block, blockH, 0.0008),
    pagesMat,
    [-square / 2, board + block / 2, 0],
    'book-pages',
  )
  g.add(pages)

  // Крышки: нижняя и верхняя, обе больше блока на кант.
  for (const [y, name] of [
    [board / 2, 'book-board-lower'],
    [board * 1.5 + block, 'book-board-upper'],
  ] as const) {
    g.add(part(box(w, board, h, BEVEL.sm * 0.5), clothMat, [0, y, 0], name))
  }

  // Корешок. Хорда — расстояние между наружными кромками крышек,
  // то есть вся толщина книги; стрелка задана в constants.
  // Материал свой только при наличии тиснения: без названия корешок
  // ничем не отличается от крышек и должен делить с ними один материал,
  // а не заводить второй такой же.
  const label = spineTexture(BOOK.title)
  const spineMat = label
    ? new THREE.MeshStandardMaterial({ map: label, roughness: 0.95, metalness: 0 })
    : clothMat
  const chord = block + board * 2
  const { mesh: spine, radius: spineR } = roundedSpine(chord, BOOK.spineBulge, h, spineMat)
  // Центр окружности лежит ВНУТРИ книги: наружная точка дуги должна
  // выступать за кромку крышки ровно на стрелку.
  spine.position.set(-w / 2 - BOOK.spineBulge + spineR, chord / 2, 0)
  g.add(spine)

  /**
   * Ленточка-закладка. Выходит из блока у корешка и ложится на нижнюю
   * крышку — так она и лежит у закрытой книги, а не висит в воздухе.
   * Толщина 0.2 мм: это лента, и на срезе её быть не должно.
   */
  const ribbon = part(
    box(BOOK.ribbonOut, 0.0002, BOOK.ribbon, 0),
    surface(PALETTE.accentRed, 'satin'),
    [w / 2 - BOOK.ribbonOut / 2 + BOOK.ribbonOut * 0.42, board + 0.0004, h * 0.18],
    'book-ribbon',
  )
  g.add(ribbon)

  return g
}
