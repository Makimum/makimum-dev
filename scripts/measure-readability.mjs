/**
 * Замер: при какой высоте вьюпорта документы на мониторе ещё читаются.
 *
 * Отвечает на вопрос, от которого зависит реестр предметов на iPad
 * (docs/specs/2026-08-14-ipad-keyboard.md §3). Считать это на бумаге нельзя:
 * поза монитора снята руками, полотно изогнуто по 1500R, и арифметика по
 * константам уже разошлась с кодом на первой же попытке. Поэтому спрашиваем
 * саму сцену: куда проецируются углы полотна при этой позе.
 *
 * Замер ГЕОМЕТРИЧЕСКИЙ, не временной — загрузка машины на результат не
 * влияет (но комната должна успеть подняться, иначе соврут таймауты).
 *
 * Playwright в зависимости проекта не входит и входить не должен. Путь к
 * нему приезжает снаружи:
 *
 *   PLAYWRIGHT_PATH=/path/to/node_modules/playwright/index.mjs \
 *     node scripts/measure-readability.mjs
 */

const PW = process.env.PLAYWRIGHT_PATH ?? 'playwright'
let chromium
try {
  ;({ chromium } = await import(PW))
} catch {
  console.error(`Не нашёл Playwright по "${PW}".`)
  console.error('Задайте PLAYWRIGHT_PATH — путь к playwright/index.mjs.')
  process.exit(1)
}

const URL = process.env.SITE ?? 'https://makimum.dev'

/** Самый мелкий повторяющийся кегль в документах, в пикселях холста.
 *  Холст монитора 2048 × 870, масштаб k = H/870 = 1, поэтому число из
 *  paint.ts — это прямо пиксели холста. */
const SMALLEST_TYPE = 19
/** Высота холста монитора: та же BASE_H, что задаёт масштаб в paint.ts. */
const CANVAS_H = 870

const SIZES = [
  ['iPhone 15 Pro ландшафт', 852, 393],
  ['iPad 11" портрет', 834, 1194],
  ['iPad 11" ландшафт', 1194, 834],
  ['iPad 13" ландшафт', 1366, 1024],
  ['MacBook Air', 1440, 900],
  ['десктоп 1440×900', 1440, 900],
]

/** Поза фокуса монитора — из src/interaction/hotspots.ts. */
const POSE = { position: [1.42, null, 1.23], target: [0.42, null, 1.23], fov: 34 }

const browser = await chromium.launch()
const rows = []

for (const [name, vw, vh] of SIZES) {
  const page = await browser.newPage({ viewport: { width: vw, height: vh } })
  try {
    await page.goto(`${URL}/?cb=${vw}x${vh}`, { waitUntil: 'load', timeout: 45000 })

    // Комната едет по кнопке там, где гейт не пускает сам.
    if (await page.evaluate(() => document.documentElement.dataset.mode !== 'room')) {
      await page.click('#enter-room', { timeout: 10000 })
    }
    await page.waitForFunction(
      () => document.documentElement.dataset.mode === 'room' && window.screens && window.camera,
      { timeout: 60000 },
    )
    await page.waitForTimeout(2500) // сцена собирается и печёт свет

    const r = await page.evaluate(({ pose, canvasH }) => {
      const cam = window.camera
      const surfaces = window.screens?.surfaces ?? []
      if (!surfaces.length) return { err: 'нет surfaces' }

      // 4×4 из three лежит по столбцам. Возвращаем с w — перспективное
      // деление делаем сами, чтобы поймать точку за камерой.
      const apply = (e, [x, y, z]) => [
        e[0] * x + e[4] * y + e[8] * z + e[12],
        e[1] * x + e[5] * y + e[9] * z + e[13],
        e[2] * x + e[6] * y + e[10] * z + e[14],
        e[3] * x + e[7] * y + e[11] * z + e[15],
      ]

      const corners = (mesh) => {
        const g = mesh.geometry
        if (!g.boundingBox) g.computeBoundingBox()
        const b = g.boundingBox
        const out = []
        for (let i = 0; i < 8; i++) {
          const p = [i & 1 ? b.max.x : b.min.x, i & 2 ? b.max.y : b.min.y, i & 4 ? b.max.z : b.min.z]
          const w = apply(mesh.matrixWorld.elements, p)
          out.push([w[0] / w[3], w[1] / w[3], w[2] / w[3]])
        }
        return out
      }

      // Полотно монитора — то, что около 0.8 м шириной. Ноутбук уже, планшет
      // и книга не Surface. По индексу брать нельзя: порядок задаёт обход
      // сцены, а он не обещан.
      let mesh = null
      let best = 0
      for (const s of surfaces) {
        const c = corners(s.mesh)
        const w = Math.max(...c.map((p) => p[0])) - Math.min(...c.map((p) => p[0]))
        const d = Math.max(...c.map((p) => p[2])) - Math.min(...c.map((p) => p[2]))
        const span = Math.max(w, d)
        if (span > best) { best = span; mesh = s.mesh }
      }
      if (!mesh) return { err: 'не нашёл полотно' }

      // Ставим камеру в позу фокуса. Высота берётся из самой сцены —
      // SCREEN_Y считается от габаритов стола, и дублировать его формулу
      // здесь значило бы завести второй источник правды.
      const cs = corners(mesh)
      const midY = (Math.max(...cs.map((p) => p[1])) + Math.min(...cs.map((p) => p[1]))) / 2
      cam.position.set(pose.position[0], midY + 0.02, pose.position[2])
      cam.fov = pose.fov
      cam.updateProjectionMatrix()
      cam.lookAt(pose.target[0], midY, pose.target[2])
      cam.updateMatrixWorld(true)

      const vi = cam.matrixWorldInverse.elements
      const pr = cam.projectionMatrix.elements
      let minX = Infinity, minY2 = Infinity, maxX = -Infinity, maxY2 = -Infinity
      let behind = 0
      for (const p of cs) {
        const v = apply(vi, p)
        if (v[2] > 0) behind++ // камера смотрит вдоль −Z: плюс это за спиной
        const c = [
          pr[0] * v[0] + pr[4] * v[1] + pr[8] * v[2] + pr[12] * v[3],
          pr[1] * v[0] + pr[5] * v[1] + pr[9] * v[2] + pr[13] * v[3],
          pr[2] * v[0] + pr[6] * v[1] + pr[10] * v[2] + pr[14] * v[3],
          pr[3] * v[0] + pr[7] * v[1] + pr[11] * v[2] + pr[15] * v[3],
        ]
        const x = (c[0] / c[3] * 0.5 + 0.5) * innerWidth
        const y = (-c[1] / c[3] * 0.5 + 0.5) * innerHeight
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY2) minY2 = y
        if (y > maxY2) maxY2 = y
      }

      const wm = Math.max(...cs.map((p) => p[0])) - Math.min(...cs.map((p) => p[0]))
      const hm = Math.max(...cs.map((p) => p[1])) - Math.min(...cs.map((p) => p[1]))
      return {
        behind,
        screenW: maxX - minX, screenH: maxY2 - minY2,
        vw: innerWidth, vh: innerHeight,
        meshW: wm, meshH: hm,
      }
    }, { pose: POSE, canvasH: CANVAS_H })

    if (r.err) { console.log(`${name}: ${r.err}`); await page.close(); continue }

    const pxPerCanvasPx = r.screenH / CANVAS_H
    const type = SMALLEST_TYPE * pxPerCanvasPx
    rows.push({
      Экран: name,
      Вьюпорт: `${r.vw}×${r.vh}`,
      'Полотно, CSS px': `${Math.round(r.screenW)}×${Math.round(r.screenH)}`,
      'Кегль 19': `${type.toFixed(1)} px`,
      'По ширине': r.screenW > r.vw ? `ОБРЕЗАНО на ${Math.round(r.screenW - r.vw)}` : 'влезает',
      'За камерой': r.behind ? `${r.behind} углов` : '—',
    })
  } catch (e) {
    console.log(`${name}: не снялось — ${e.message.split('\n')[0]}`)
  }
  await page.close()
}

await browser.close()
console.table(rows)
console.log(`\nПолотно в сцене: ${rows.length ? 'см. выше' : 'нет данных'}`)
console.log('Кегль 19 — самый мелкий повторяющийся в документах (paint.ts, k = 1).')
