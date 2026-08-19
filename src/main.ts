import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { RectAreaLightUniformsLib } from 'three/examples/jsm/lights/RectAreaLightUniformsLib.js'
import { CHAIR, DESK, ROOM, SPIKE_CAMERA, WINDOW, WORKSTATION } from './constants'
import { buildShell } from './room/shell'
import { buildDesk } from './props/desk'
import { buildRadiator } from './props/radiator'
import { buildLamp } from './props/lamp'
import { buildMonitor } from './props/monitor'
import { buildMacbook } from './props/macbook'
import { buildChair } from './props/chair'
import { buildBook } from './props/book'
import { buildTablet } from './props/tablet'
import { checkLayout } from './lib/sanity'
import { bakeBoth, setTimeOfDay, daylightFactor, setLamp } from './bake/timeOfDay'
import { createFocus } from './interaction/focus'
import { HOTSPOTS } from './interaction/hotspots'
import { createPost } from './post/composer'
import { Screens } from './screens/screens'
import { FACTS, resetDocCache } from './screens/content'
import { documentsReadable, isRoomOpen, panelFit, pickHotspots, thriftyRender } from './lobby'
import { screenRectFromPose } from './interaction/screenRect'
import { createKeyboardMode } from './interaction/keyboardMode'
import { createHotspotButtons } from './interaction/hotspotButtons'
import { mountContent } from './page/mount'
import { createSky } from './sky/dome'
import { setNowPlaying, startSpotify } from './screens/spotify'
import { createLampSwitch } from './props/lampSwitch'
import { createChairSpin } from './props/chairSpin'
import { skyState, sunTimes, warmTint, type SkyState } from './sky/time'
import { CLEAR, fetchWeather, type Weather } from './sky/weather'
import { compareSignatures, createProfiler, grabSignature, stressTest } from './lib/profile'

/**
 * Спайк «угол комнаты».
 *
 * Свет здесь — реалтаймовый и временный. Он существует только чтобы
 * увидеть форму. Настоящая цель — запечённый GI-лайтмап; когда он заведётся,
 * весь блок setupLighting уходит, а материалы переключатся на MeshBasic.
 */

const canvas = document.querySelector<HTMLCanvasElement>('#scene')!

/** Служебный оверлей — только по ?debug. На проде счётчики и «layout ⚠»
 *  в углу читаются как недоделанный сайт, а не как инженерная честность. */
const DEBUG = new URLSearchParams(location.search).has('debug')

/**
 * Сколько можно потратить на кадр. Считается здесь, до создания рендерера,
 * потому что нужно сразу для antialias, а ниже ещё раз — для профиля теней и
 * цепочки пост-обработки.
 *
 * Решение приходит из `lobby.ts`, а не из своего `matchMedia`: раньше эта
 * строка была ВТОРЫМ читателем «мобильности» в обход модуля, который в
 * собственном комментарии утверждает, что решатель один.
 *
 * Это ровно ПОЛОВИНА прежнего флага. Вторая половина — «что показывать» —
 * теперь отвечает отдельно, и у iPad ответы разные: тратить бережно, но
 * показывать всё. См. `documentsReadable()` ниже.
 */
const thrifty = thriftyRender()

// Каждый видимый кадр идёт через композер, а в дефолтный фреймбуфер пишет
// только полноэкранный квад: MSAA-буфер выделяется и не сглаживает ни одного
// ребра геометрии. На телефоне это чистая потеря памяти.
const renderer = new THREE.WebGLRenderer({ canvas, antialias: !thrifty })
// Размер НЕ выставляется здесь: `setSize` со стилем по умолчанию
// печатает инлайновые width/height в пиксельях, а если модуль
// исполняется до раскладки страницы (или во вкладке в фоне), туда
// попадают нули — и холст навсегда остаётся нулевого размера, потому
// что 100vw из таблицы стилей инлайновому правилу проигрывает.
// Единственный источник размера — resize() ниже, по ResizeObserver.
// DPR ограничен: на ультрашироком мониторе рендер-таргеты при DPR 2
// съедают под гигабайт, а машина и так живёт в свопе.
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5))
renderer.outputColorSpace = THREE.SRGBColorSpace
renderer.toneMapping = THREE.ACESFilmicToneMapping
renderer.toneMappingExposure = 1.05
renderer.shadowMap.enabled = true
renderer.shadowMap.type = THREE.PCFShadowMap
/**
 * КАРТА ТЕНЕЙ ПЕРЕСЧИТЫВАЕТСЯ ПО СОБЫТИЮ, А НЕ КАЖДЫЙ КАДР.
 *
 * В этой комнате движется ровно одна вещь, отбрасывающая тень, — кресло.
 * Солнце ставится один раз при сборке и больше не двигается: время суток
 * меняет ему яркость и цвет, но не положение. Значит рисунок теней между
 * кадрами не меняется вообще, и шестьдесят пересчётов карты 2048² в
 * секунду — это полный проход по геометрии, выброшенный в мусор.
 *
 * Замерено до правки на 1440×900: ДВА пересчёта карты за кадр и 270
 * драуколлов на них днём, 474 ночью с горящей лампой. Два, а не один,
 * потому что проход нормалей внутри GTAO — это тоже `renderer.render`
 * по сцене, и тень честно пересчитывалась и в нём.
 *
 * Раньше этот блок стоял под `if (mobile)`, то есть выигрыш получал
 * только телефон, а десктоп — тот, что упирается в видеокарту, — платил
 * полную цену. Теперь правило одно на всех: ниже, в `frame()`,
 * `needsUpdate` поднимается только когда едет кресло или щёлкнула лампа.
 */
renderer.shadowMap.autoUpdate = false
renderer.shadowMap.needsUpdate = true

const scene = new THREE.Scene()
scene.background = new THREE.Color(0x1a1a1c)

const camera = new THREE.PerspectiveCamera(
  SPIKE_CAMERA.fov,
  window.innerWidth / window.innerHeight,
  0.05,
  60,
)
camera.position.set(...SPIKE_CAMERA.position)

const controls = new OrbitControls(camera, canvas)
controls.target.set(...SPIKE_CAMERA.target)
controls.enableDamping = true
controls.dampingFactor = 0.08
controls.maxDistance = 9
controls.minDistance = 0.6
// Палец против мыши: по умолчанию два пальца одновременно приближают и
// ПАНОРАМИРУЮТ, то есть уводят цель орбиты сквозь стену — а вернуться
// оттуда нечем, кнопки сброса в комнате нет.
controls.enablePan = false
controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_ROTATE }
// Под пол и за потолок камера не заходит: там нет комнаты, там изнанка.
controls.minPolarAngle = 0.25
controls.maxPolarAngle = Math.PI / 2 + 0.25
controls.update()

function setupLighting() {
  // RectAreaLight не работает без предзагрузки своих LTC-таблиц
  RectAreaLightUniformsLib.init()

  // Дневной свет из окна — главный источник
  // Ключевой свет поднят, а заполнение ниже срезано (см. bounce/ambient).
  // Прежнее соотношение — сильный ключ и такое же сильное заполнение со
  // всех сторон — давало ровно освещённую коробку без единой глубокой
  // тени: технически светло, визуально плоско и потому «серо».
  const sun = new THREE.DirectionalLight(0xf2f6ff, 3.2)
  sun.position.set(WINDOW.offsetX - 0.8, WINDOW.sill + WINDOW.height + 1.1, -3.4)
  sun.target.position.set(WINDOW.offsetX, 0.7, 1.4)
  sun.castShadow = true
  sun.shadow.mapSize.set(thrifty ? 1024 : 2048, thrifty ? 1024 : 2048)
  sun.shadow.camera.left = -3
  sun.shadow.camera.right = 3
  sun.shadow.camera.top = 3.5
  sun.shadow.camera.bottom = -1
  sun.shadow.camera.near = 0.4
  sun.shadow.camera.far = 12
  sun.shadow.bias = -0.0008
  sun.shadow.normalBias = 0.02
  scene.add(sun, sun.target)

  // Рассеянный свет неба через окно — заполнение, чтобы тени не были чёрными
  const sky = new THREE.RectAreaLight(0xdceaf8, 3.4, WINDOW.width, WINDOW.height)
  sky.position.set(WINDOW.offsetX, WINDOW.sill + WINDOW.height / 2, -0.02)
  sky.lookAt(WINDOW.offsetX, WINDOW.sill + WINDOW.height / 2, 3)
  scene.add(sky)

  // Дешёвая имитация переотражения от пола и потолка.
  // Именно это запечённый GI сделает по-настоящему.
  // Переотражение осталось, но перестало спорить с ключом по силе:
  // у настоящего непрямого света в комнате с одним окном доля меньше.
  const bounce = new THREE.HemisphereLight(0xe8eef7, 0xc08a52, 0.42)
  scene.add(bounce)

  const ambient = new THREE.AmbientLight(0xffffff, 0.07)
  scene.add(ambient)

  /**
   * Экраны как источник света.
   *
   * В тёмной комнате с включённым компьютером светят именно они — это
   * первое, что видно на любой ночной фотографии рабочего места, и
   * единственное, что отделяет стол от стены. Без этого источника ночь
   * получалась ровным серым заполнением: все поверхности освещены
   * одинаково со всех сторон, и предметы сливаются в одно пятно.
   *
   * Прямоугольный источник, потому что и сам монитор прямоугольный.
   * Теней не даёт: они дороги, а вклад у него мягкий и рассеянный.
   */
  // Позиция и разворот берутся у самого монитора — уже после того, как
  // рабочее место собрано и повёрнуто. Считать их руками в мировых
  // координатах значит завести второй источник правды о том, где стоит
  // стол, и разъехаться с ним при первом же развороте.
  const screenGlow = new THREE.RectAreaLight(0x93b6ff, 0, 0.86, 0.3)
  scene.add(screenGlow)

  return { sun, sky, bounce, ambient, screenGlow }
}

const rtLights = setupLighting()

/**
 * Реалтайм-свет вслед за небом.
 *
 * Бейк на проде не запускается (он ручной и стоит минуту), поэтому
 * комнату там освещают именно эти источники. Без этой функции небо за
 * окном честно темнело бы к ночи, а комната оставалась бы залитой
 * полуденным солнцем — рассинхрон, который заметнее любого артефакта.
 *
 * Это НЕ замена бейку: интенсивность масштабируется, а рисунок теней
 * остаётся дневным. Настоящее решение — третий запечённый вариант,
 * оно записано в план отдельным пунктом.
 */
const RT_BASE = {
  sun: rtLights.sun.intensity,
  sky: rtLights.sky.intensity,
  bounce: rtLights.bounce.intensity,
  ambient: rtLights.ambient.intensity,
}
const warm = new THREE.Color()
/**
 * Цвет света из окна по времени суток.
 *
 * Раньше он был один на все часы — бледно-голубой, — и именно поэтому
 * закат в комнате не отличался от полудня, а вся картинка читалась
 * обесцвеченной. Между этими тремя значениями лежит вся разница между
 * «серым рендером» и временем суток: ночью в окно идёт холодная синева,
 * на закате оно заливает комнату оранжевым, днём светит нейтрально.
 */
const SKY_DAY = new THREE.Color(0xdceaf8)
const SKY_NIGHT = new THREE.Color(0x3d5f96)
const SKY_GOLDEN = new THREE.Color(0xff9d52)
/** Прямое солнце: днём почти белое, на закате красное. */
const SUN_DAY = new THREE.Color(0xf2f6ff)
const SUN_GOLDEN = new THREE.Color(0xff8a3d)
const skyTint = new THREE.Color()
const sunTint = new THREE.Color()

function applyRealtimeTime(state: SkyState) {
  if (baked) return
  const k = state.daylight
  warmTint(state, warm)

  // СВЕТ НОЧЬЮ ГАСНЕТ НЕ ЦЕЛИКОМ И НЕ РАВНОМЕРНО.
  //
  // Раньше все источники умножались на один множитель `0.06 + 0.94k`, и
  // ночь получалась ровно приглушённым днём: заполнение со всех сторон,
  // ноль направления, ноль разницы в цвете. В кадре это читалось как
  // серое пятно, в котором стена, пол, стол и кресло сливаются, — а зерно
  // на такой ровной поверхности становилось единственной деталью и лезло
  // в глаза рябью. Претензия «всё серое» была ровно про это.
  //
  // Настоящая тёмная комната держится на КОНТРАСТЕ: холодный свет из
  // окна как ключевой, тёплые экраны у стола, и провал в чёрное между
  // ними. Поэтому у каждого источника своя кривая.

  // Солнце уходит вместе с днём — прямого света ночью нет вовсе.
  // Цвет ведёт золотой час: на закате прямой луч краснеет по-настоящему,
  // а не «слегка теплеет». Именно этого не хватало, чтобы закат читался.
  rtLights.sun.intensity = RT_BASE.sun * k
  sunTint.copy(SUN_DAY).lerp(SUN_GOLDEN, state.golden * 0.9)
  rtLights.sun.color.copy(sunTint).multiply(warm)

  // Окно ночью становится ключевым источником: оно слабое, но
  // НАПРАВЛЕННОЕ, и именно оно рисует падение света вглубь комнаты.
  skyTint.copy(SKY_NIGHT).lerp(SKY_DAY, k).lerp(SKY_GOLDEN, state.golden * 0.8)
  rtLights.sky.color.copy(skyTint)
  // Небо в полусфере переотражения тоже меняет температуру: иначе
  // потолок на закате остаётся дневным и спорит со стенами.
  rtLights.bounce.color.copy(skyTint)
  rtLights.sky.intensity = RT_BASE.sky * (0.2 + 0.8 * k)

  // Заполнение падает почти в ноль: оно и есть то, что делало картинку
  // плоской. Днём переотражение от пола и потолка реально, ночью — нет.
  // Совсем в ноль нельзя: посетитель приходит в комнату в своё время, и
  // если это три часа ночи, он должен увидеть тёмную комнату, а не
  // чёрный экран, который читается как несработавшая загрузка.
  rtLights.bounce.intensity = RT_BASE.bounce * (0.05 + 0.95 * k)
  rtLights.ambient.intensity = RT_BASE.ambient * (0.05 + 0.95 * k)

  // Экраны, наоборот, разгораются к ночи: днём их вклад тонет в солнце.
  rtLights.screenGlow.intensity = 0.62 * (1 - k) * (1 - k)

  // Экспозиция ночью выше, чтобы освещённое читалось, — а всё, куда свет
  // не дошёл, честно уходит в чёрное. Это и есть контраст.
  renderer.toneMappingExposure = 1.05 * (1 + (1 - k) * 0.62)
}
scene.add(buildShell())
scene.add(buildRadiator())

/**
 * Рабочее место одним узлом. Стол, техника на нём и кресло связаны жёстко,
 * поэтому разворот на 90° — это одна строка, а не пересчёт координат
 * каждого предмета вручную. Предметы пересаживаются в систему координат
 * стола: их позиции из constants заданы в мировых, отсюда вычитание.
 */
const workstation = new THREE.Group()
workstation.name = 'workstation'
workstation.position.set(WORKSTATION.posX, 0, WORKSTATION.posZ)
workstation.rotation.y = WORKSTATION.yaw

const desk = buildDesk()
const monitor = buildMonitor()
const macbook = buildMacbook()
for (const o of [desk, monitor, macbook]) {
  o.position.x -= DESK.posX
  o.position.z -= DESK.posZ
}

const chair = buildChair()
chair.position.set(CHAIR.offsetX, 0, CHAIR.offsetZ)

/**
 * Планшет и книга.
 *
 * Координаты — те же локальные, что у лампы: от ЦЕНТРА столешницы,
 * X вдоль стола, Z от задней кромки к передней. Стол занят монитором
 * (x −0.08), ноутбуком (x 0.39) и лампой (x −0.55); свободного места
 * ровно два куска, и предметы разведены по ним, а не свалены рядом.
 *
 * ЗАДНЕЙ КРОМКИ ДЛЯ ПЛАНШЕТА НЕТ, и это выяснилось замером. Полотно
 * монитора — 0.8 м на столе шириной 1.4: оно тянется от x −0.48 до 0.32,
 * то есть накрывает весь промежуток между лампой и стойкой. Планшет,
 * поставленный туда, оказывался ПОД панелью и читался зажатым. Поэтому
 * он вынесен на передний план слева — где его и ставят в жизни: экраном
 * к креслу, перед левым краем монитора.
 *
 * Книга — на переднем крае перед монитором. Лежащий предмет в глубине
 * стола не читается вовсе: его закрывает всё, что стоит вертикально.
 */
const tablet = buildTablet()
// +0.003 по высоте: подпорка чехла отклонена сильнее самого планшета и
// нижним углом уходила на три миллиметра в столешницу (поймано measure()).
tablet.position.set(-0.40, DESK.height + 0.003, 0.10)

const book = buildBook()
book.position.set(-0.05, DESK.height, 0.22)
// Небольшой разворот: книгу КЛАДУТ, а не ставят по линейке. Ровно
// параллельная кромке стола книга читается как элемент интерфейса.
book.rotation.y = 0.31

// Лампа тоже часть рабочего места: стоит на столешнице и ездит с ней
workstation.add(desk, monitor, macbook, chair, tablet, book, buildLamp())
scene.add(workstation)

// Свет экранов встаёт на место только теперь: рабочее место собрано и
// повёрнуто, и у полотна монитора наконец есть мировые координаты.
{
  const panel = monitor.getObjectByName('screen')
  if (panel) {
    const p = panel.getWorldPosition(new THREE.Vector3())
    const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(
      panel.getWorldQuaternion(new THREE.Quaternion()),
    )
    rtLights.screenGlow.position.copy(p).addScaledVector(forward, 0.04)
    rtLights.screenGlow.lookAt(p.clone().addScaledVector(forward, 1))
  }
}

// Ловим предметы, уехавшие в стены или друг в друга, до того как это
// придётся искать глазами среди двенадцати объектов.
const problems = checkLayout(scene, [
  { name: 'desk', againstWall: true },
  { name: 'radiator', againstWall: true },
  // Лампа шарнирная: её ящик — обметаемый объём, а не предмет. См. `sweeps`.
  { name: 'lamp', againstWall: true, sweeps: true },
  { name: 'monitor' },
  { name: 'macbook' },
  { name: 'chair' },
  { name: 'tablet' },
  { name: 'book' },
])

/**
 * ВОРОТА A. Запекаем GI и гасим реалтайм-свет: после бейка освещение
 * лежит в вершинах, и любой оставшийся источник светил бы поверх него.
 * Критерий проверяется в checkColourBleed() — цвет, а не яркость.
 */
let baked = false
function runBake(rays = 96) {
  if (baked) return 'уже запечено'
  // Бейкер обязан видеть ровно ту сцену, на которой калибровался: небо
  // за окном гасим, старый квад-заглушку возвращаем. Иначе Preetham
  // становится источником на пол-комнаты и весь замеренный свет едет.
  sky.setBakeMode(true)
  const lights: THREE.Light[] = []
  scene.traverse((o) => {
    const l = o as THREE.Light
    if (l.isLight) lights.push(l)
  })

  // Печём ОБА варианта сразу: день и ночь. Второй прогон стоит столько же,
  // сколько первый, но переключение между ними потом бесплатно.
  const res = bakeBoth(scene, rays)
  for (const l of lights) l.intensity = 0
  // Экспозицию выставляет applyTime: она зависит от времени суток.
  baked = true

  sky.setBakeMode(false)
  applyTime(skyNow())

  const out = {
    вершин: res.day.vertices,
    'секунд (день)': +(res.day.ms / 1000).toFixed(2),
    'секунд (ночь)': +(res.night.ms / 1000).toFixed(2),
    'сейчас дневного света': +skyNow().daylight.toFixed(2),
  }
  console.log('%c✓ бейк завершён', 'color:#5aa469;font-weight:600', out)
  return out
}

/** Применяет время суток: 0 — ночь, 1 — день. Фон подстраивается,
 *  иначе за окном остаётся дневное небо при ночной комнате. */
/** Экспозиция при полном дне и в глубокой ночи.
 *  Разные не для красоты: после перехода на физическое отражение
 *  внутренняя грань стены даёт 0.26 днём и 0.0018 ночью — разрыв в 145
 *  раз. Одной экспозицией это не покрыть, и в жизни тоже не покрывается:
 *  глаз адаптируется. */
const EXPOSURE_DAY = 2.0
const EXPOSURE_NIGHT = 2.6

function applyTime(state: SkyState) {
  const k = state.daylight
  setTimeOfDay(scene, k, warmTint(state))
  // Интерполируем в ЛОГАРИФМЕ: экспозиция воспринимается в ступенях,
  // и линейный лерп между 2 и 9 провёл бы почти весь путь в сумерках.
  renderer.toneMappingExposure = Math.exp(
    Math.log(EXPOSURE_NIGHT) + (Math.log(EXPOSURE_DAY) - Math.log(EXPOSURE_NIGHT)) * k,
  )
  // Лампа гаснет к дню. Плафон и лампочка исключены из бейка как
  // источники, поэтому их свечением надо управлять отдельно —
  // иначе лампа горит в полдень.
  setLamp(scene, 1 - k)
  // Фон — пустота вокруг диорамы, а не небо: небо теперь настоящее и
  // живёт за окном отдельными слоями.
  scene.background = new THREE.Color(0x0a0d16).lerp(new THREE.Color(0x1a1a1c), k)
}

/**
 * Ворота A проверяются ЦВЕТОМ, а не яркостью: низ стены обязан стать
 * ТЕПЛЕЕ по тону, а не просто темнее. Тепло меряем как (R−B) в
 * запечённом цвете — если паркет действительно подмешал свой тон,
 * у пола эта разница будет заметно больше, чем у потолка.
 */
function checkColourBleed() {
  const wall = scene.getObjectByName('wall-left') as THREE.Mesh
  if (!wall) return 'нет стены'
  const col = wall.geometry.getAttribute('color')
  const pos = wall.geometry.getAttribute('position')
  if (!col) return 'стена не запечена'

  let lowR = 0, lowB = 0, lowN = 0
  let hiR = 0, hiB = 0, hiN = 0
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i) + ROOM.height / 2 // геометрия центрирована
    if (y > 0.04 && y < 0.22) { lowR += col.getX(i); lowB += col.getZ(i); lowN++ }
    if (y > ROOM.height - 0.26 && y < ROOM.height - 0.06) { hiR += col.getX(i); hiB += col.getZ(i); hiN++ }
  }
  if (!lowN || !hiN) return 'не нашёл вершин в полосах'
  const lowWarmth = lowR / lowN - lowB / lowN
  const hiWarmth = hiR / hiN - hiB / hiN
  const verdict = lowWarmth > hiWarmth ? 'ПРОЙДЕНО' : 'ПРОВАЛЕНО'
  const r = {
    'теплота у пола (R−B)': +lowWarmth.toFixed(4),
    'теплота у потолка (R−B)': +hiWarmth.toFixed(4),
    'разница': +(lowWarmth - hiWarmth).toFixed(4),
    'Ворота A': verdict,
  }
  console.log(`%cВорота A: ${verdict}`, `color:${verdict === 'ПРОЙДЕНО' ? '#5aa469' : '#e8654a'};font-weight:700`, r)
  return r
}

/**
 * Треугольники сцены целиком, с учётом инстансов.
 *
 * Считается здесь, а не переписывается в текст руками: цифра на экране
 * обязана быть измерением, а не воспоминанием о предыдущем замере.
 * Счётчик HUD для этого не годится — он показывает отрисованное за кадр,
 * то есть зависит от того, куда смотрит камера.
 */
function countTriangles(root: THREE.Object3D): number {
  let n = 0
  root.traverse((o) => {
    const m = o as THREE.Mesh
    if (!m.isMesh) return
    const g = m.geometry
    const pos = g.getAttribute('position')
    if (!pos) return
    const tris = (g.index ? g.index.count : pos.count) / 3
    const inst = (m as THREE.InstancedMesh).isInstancedMesh ? (m as THREE.InstancedMesh).count : 1
    n += tris * inst
  })
  return Math.round(n)
}

/* ------------------------------------------------------------------ */
/* Небо за окном                                                       */
/* ------------------------------------------------------------------ */

const sky = createSky(scene)

// Замер стоит ПОСЛЕ неба, а не до: четыре плоскости купола — восемь
// треугольников — такая же часть сцены, как стены, и посетитель их видит
// в окне. Считая раньше, мы получали 77 132 против 77 140 в FACTS, то
// есть расхождение цифры на экране с цифрой в тексте на ровном месте.
// Экраны собираются ниже (`new Screens`), так что в FACTS замер попадает
// до первой отрисовки.
FACTS.triangles = countTriangles(scene)
// entry.ts зовёт mountContent() синхронно, а сцена сюда доходит только
// через два кадра и динамический импорт — значит getDoc() уже мог
// запечатать кэш документов старым, дефолтным FACTS.triangles ДО этой
// строки, а mountContent() — уже вмонтировать узел с этим старым числом
// в #content. Сброс кэша чинит будущие чтения (панели комнаты в paint.ts
// читают getDoc() лениво, по клику — то есть уже после этой строки), но
// сам по себе не трогает уже смонтированные узлы: без пересборки дерева
// расхождение просто переехало бы из «кэш» в «DOM» — посетитель комнаты
// увидел бы свежее число на экране, а поисковик и скринридер в #content
// старое. Поэтому следом идёт форсированная пересборка того же дерева.
resetDocCache()
mountContent(true)

/** Погода не блокирует ничего: небо поднимается ясным, ответ приезжает
 *  через долю секунды и меняет его. */
let weather: Weather = CLEAR
/** Последнее, что реально приехало из сети: `setWeather()` без аргумента
 *  обязан вернуть настоящую погоду, а не заглушку «ясно». */
let fetched: Weather = CLEAR
void fetchWeather().then((w) => {
  fetched = w
  weather = w
})

/** Отладочная прокрутка времени. `null` — идти по настоящим часам. */
let frozenAt: Date | null = null

/** ISO без зоны → момент, у которого в Хельсинки именно эти часы.
 *  Смещение спрашивается у самой зоны, поэтому переход на летнее время
 *  учитывается сам. */
function helsinkiWallTime(iso: string): Date {
  const guess = new Date(`${iso}Z`)
  const shown = new Date(guess.toLocaleString('en-US', { timeZone: 'Europe/Helsinki' }))
  const utc = new Date(guess.toLocaleString('en-US', { timeZone: 'UTC' }))
  return new Date(guess.getTime() - (shown.getTime() - utc.getTime()))
}
function skyNow(): SkyState {
  return skyState(frozenAt ?? new Date())
}

// Лампа — единственный предмет, который переключается на месте.
// Поднимается ДО focus: реестр переключателей нужен ему при сборке.
const lampSwitch = createLampSwitch(scene)
const chairSpin = createChairSpin(scene)

// Режим фокуса: наведение, клик, подлёт камеры, панель с контентом
const screens = new Screens(scene)

// Живой Spotify на планшете. Поднимается здесь, а не внутри экрана:
// опрос сети — это про комнату целиком, и он не должен начинаться от
// того, что кто-то дошёл до отрисовки планшета. Не настроено или сети
// нет — планшет играет встроенный трек и никто ничего не замечает.
startSpotify()

/** Что кликабельно — решает не палец, а ЧИТАЕМОСТЬ. См. `monitorReadable()`
 *  ниже. Один список на двух читателей: рейкаст и клавиатурный обход обязаны
 *  видеть одни и те же предметы, иначе Tab уводил бы туда, куда мышь не
 *  попадает. */
const activeHotspots = pickHotspots(monitorReadable(), HOTSPOTS)

const focus = createFocus(
  scene,
  camera,
  controls,
  canvas,
  screens,
  lampSwitch ? { lamp: { toggle: () => lampSwitch.toggle(), label: () => lampSwitch.label() } } : {},
  chairSpin ? { chair: chairSpin } : {},
  activeHotspots,
)

/**
 * Клавиатура проявляется по первому навигационному нажатию — до него в
 * комнате ничего не меняется. Создаётся здесь, потому что живёт ровно
 * столько же, сколько сцена: на странице без комнаты обводить нечего.
 */
const keyboard = createKeyboardMode()

/**
 * Кнопки предметов для обхода клавишей. Создаются ПОСЛЕ фокуса, потому что
 * нажатие на кнопку означает ровно то же, что попадание по предмету
 * рейкастом, — и дорога у обоих одна, `focus.activate`.
 */
const hotspotButtons = createHotspotButtons(
  activeHotspots,
  scene,
  camera,
  keyboard,
  (h) => focus.activate(h, true),
)

/**
 * Помещается ли на этом экране полотно монитора так, чтобы документы на нём
 * читались. Считается ПО ЖИВОЙ СЦЕНЕ: берётся настоящий меш полотна и
 * настоящая поза фокуса, углы проецируются.
 *
 * Так, а не двумя константами в `lobby.ts`, потому что любая константа здесь
 * выводится из НЫНЕШНЕЙ позы монитора и тихо соврёт, как только позу
 * подвинут. Проверять её при этом нечем: комната просто окажется беднее, а
 * почему — не видно. Замер `scripts/measure-readability.mjs` снимает те же
 * числа снаружи и служит сверкой.
 *
 * РЕШЕНИЕ СНИМАЕТСЯ В ЛАНДШАФТНОЙ РАСКЛАДКЕ, как бы устройство ни было
 * повёрнуто сейчас. Реестр строится один раз — `createFocus` кладёт BVH по
 * каждому мешу, — а планшет в руке поворачивают походя. Решив по портрету,
 * мы отняли бы у iPad монитор до конца сессии, и поворот экрана уже ничего
 * не вернул бы. Решив по ландшафту, мы в худшем случае показываем в портрете
 * обрезанный кадр — а это посетитель чинит сам, повернув устройство.
 */
function monitorReadable(): boolean {
  const monitor = screens.surfaces.find((s) => s.screen === 'monitor')
  const spot = HOTSPOTS.find((h) => h.id === 'monitor')
  if (!monitor || !spot) return true

  const w = canvas.clientWidth || window.innerWidth
  const h = canvas.clientHeight || window.innerHeight
  if (!w || !h) return true
  const long = Math.max(w, h)
  const short = Math.min(w, h)

  const panel = screenRectFromPose(monitor.mesh, camera, spot.pose, long, short)
  return documentsReadable(panel ? panelFit(panel, long, monitor.canvasHeight) : null)
}

// Пост-обработка. Ноль ассетов, но именно она убирает ощущение
// «слишком чистой» картинки: запечённая сцена освещена ровно от края
// до края, а настоящая оптика так не умеет.
//
// Мобильный профиль.
//
// За один кадр сцена сегодня прогоняется по геометрии ТРИЖДЫ: проход
// глубины, основной рендер и ещё один полный проход внутри GTAO ради карты
// нормалей. Плюс около двадцати полноэкранных квадов. Это профиль
// настольной видеокарты.
//
// Свечение остаётся: это подпись картинки — окно и экраны светятся именно
// им. Уходят затенение контактов и расфокус; вместе с расфокусом уходит и
// проход глубины, который существовал только ради него.
const post = createPost(renderer, scene, camera, thrifty ? { ao: false, grade: false } : {})

/** Промер кадра. Обёртки вокруг рендерера ставятся только по первому
 *  вызову `profile()` — до него профайлер не стоит ничего. */
const profiler = createProfiler(renderer, scene)

// --- служебный оверлей спайка ---
const hud = document.querySelector<HTMLDivElement>('#hud')!
hud.hidden = !DEBUG
function updateHud() {
  const i = renderer.info
  // Счётчики берём у пост-цепочки: она снимает их сразу после рендера
  // сцены, до полноэкранных проходов.
  const st = post.stats()
  hud.textContent = [
    `triangles   ${st.triangles.toLocaleString('en')}`,
    `draw calls  ${st.calls}`,
    `geometries  ${i.memory.geometries}`,
    `textures    ${i.memory.textures}`,
    `room        ${ROOM.width}×${ROOM.depth}×${ROOM.height} m`,
    `layout      ${problems.length ? `⚠ ${problems.length} issues` : '✓ clean'}`,
  ].join('\n')
}

/**
 * Размер берётся у САМОГО холста, а не у окна: при первой загрузке
 * `innerWidth/innerHeight` считываются до раскладки, и справа и снизу
 * остаются чёрные поля.
 *
 * Функция ТОЛЬКО меряет. Раньше она же переключала режим — и была вторым
 * писателем `data-mode` после гейта: на способном устройстве она возвращала
 * атрибут в `room`, а на телефоне уходила в ранний `return` ДО
 * `renderer.setSize`, из-за чего комната рисовалась бы в дефолтный буфер
 * 300 × 150, растянутый CSS на весь экран.
 */
/**
 * Множитель разрешения рендера. Единица — обычная работа; всё остальное
 * бывает только под `stress()`, который ищет запас по видеокарте.
 * Пропорции кадра он не трогает, поэтому композиция при замере та же.
 */
let renderScale = 1

function resize() {
  const w = canvas.clientWidth || window.innerWidth
  const h = canvas.clientHeight || window.innerHeight
  // Нулевой замер бывает у вкладки в фоне: рендер-таргет нулевого размера —
  // это неполный фреймбуфер и чёрный кадр, а не «пока пусто».
  if (!w || !h) return
  camera.aspect = w / h
  camera.updateProjectionMatrix()
  const rw = Math.max(1, Math.round(w * renderScale))
  const rh = Math.max(1, Math.round(h * renderScale))
  // `updateStyle = false`: холст обязан остаться прежнего размера на
  // странице, меняется только сколько пикселей в него рисуется.
  renderer.setSize(rw, rh, false)
  post.setSize(rw, rh)
}

/**
 * Кадровый цикл идёт только у открытой комнаты. Держать шестьдесят кадров
 * в секунду ради спрятанного холста — ровно та трата батареи, ради которой
 * гейт и делался.
 */
function applyMode() {
  if (isRoomOpen()) {
    resize()
    renderer.setAnimationLoop(frame)
  } else {
    renderer.setAnimationLoop(null)
    // Единственное место, где факт «комната закрыта» уже известен, — значит
    // и режим фокуса гасится здесь. Фокус держит состояние ВНЕ сцены:
    // выключенную орбиту, плашку `.focus-hint` и подпись `.hotspot-label`
    // на `<body>`, раскрытый документ на экранах. Без этого вызова крестик
    // оставлял плашку висеть поверх страницы, а повторный вход возвращал
    // камеру вплотную к монитору с мёртвой орбитой.
    focus.exit()
  }
}

addEventListener('resize', resize)
new ResizeObserver(resize).observe(canvas)

// Режим мог смениться без изменения размеров окна — например крестиком.
new MutationObserver(applyMode).observe(document.documentElement, {
  attributes: true,
  attributeFilter: ['data-mode'],
})

applyMode()

// Отладочные хуки: подгонка кадра под фото и промер собранной сцены
Object.assign(window as unknown as Record<string, unknown>, {
  scene,
  camera,
  controls,
  runBake,
  checkColourBleed,
  post: post.params,
  applyTime,
  daylightFactor,
  /**
   * Прокрутка времени для проверки неба: `setSkyTime('2026-12-21T09:00')`
   * — момент считается в зоне Хельсинки. Без аргумента возвращает часы
   * обратно на настоящее время. Проверить закат иначе нельзя: ждать его
   * по три часа на каждую правку шейдера не вариант.
   */
  setSkyTime: (iso?: string) => {
    // Строка без зоны читается как ХЕЛЬСИНКСКОЕ стенное время. Прибавлять
    // фиксированные +03:00 нельзя: зимой там +02:00, и декабрьский
    // полдень уезжал на час.
    frozenAt = iso ? helsinkiWallTime(iso) : null
    state = skyNow()
    applyRealtimeTime(state)
    if (baked) applyTime(state)
    // Прокрутка времени обязана двигать и лампу: иначе проверить закат
    // с ней можно только дождавшись настоящего заката.
    lampSwitch?.follow(state.daylight)
    return {
      clock: state.clock,
      phase: state.phase,
      altitude: +state.sunAltitude.toFixed(2),
      daylight: +state.daylight.toFixed(3),
      lamp: +(lampSwitch?.level() ?? 0).toFixed(2),
    }
  },
  /** Восход, полдень и закат в Хельсинки на выбранную дату. */
  sunTimes: (iso?: string) => sunTimes(iso ? new Date(iso) : new Date()),
  skyState: () => skyNow(),
  /** Экраны: `screens.surfaces[0].open('gallery')` — открыть приложение,
   *  не целясь мышью в монитор из-за кресла. */
  screens,
  /** Щелчок по лампе из консоли — чтобы проверять кривую, не целясь мышью.
   *  Он же, как и настоящий щелчок, забирает лампу у автоматики. */
  lamp: () => lampSwitch?.toggle(),
  lampLevel: () => lampSwitch?.level(),
  /** Перехватил ли посетитель управление лампой у времени суток. */
  lampOverridden: () => lampSwitch?.overridden(),
  /** Сила источника в канделах: подбирается на живой комнате. */
  lampPower: (v: number) => lampSwitch?.setPower(v),
  /**
   * Подмена трека на планшете — для проверки раскладки.
   * `setNowPlaying({ title: '…', artist: '…', recent: [...] })`;
   * без аргумента возвращает то, что приехало из сети.
   */
  setNowPlaying,
  weather: () => weather,
  /**
   * Подмена погоды для проверки облаков и осадков.
   * `setWeather({ cloudCover: 0.8, code: 71, precipitation: 1.2 })` — снег;
   * без аргумента возвращает то, что приехало из Open-Meteo.
   *
   * Нужен по той же причине, что и `setSkyTime`: ждать в Хельсинки
   * подходящей погоды, чтобы посмотреть на свой же шейдер, — не вариант.
   * Прошлый хендофф предлагал «смотреть через подмену weather()», но
   * `weather()` только читает; подменить было нечем.
   */
  setWeather: (w?: Partial<Weather>) => {
    weather = w ? { ...CLEAR, ...w, live: false } : fetched
    return weather
  },
  /**
   * Промер кадра за N секунд: сколько раз сцена прогоняется по геометрии,
   * сколько драуколлов и треугольников уходит суммарно за кадр, сколько
   * из них тратит карта теней, p50/p99 кадрового времени.
   *
   * HUD на эти вопросы не отвечает: `renderer.info` обнуляется на каждом
   * внутреннем `render()`, и после цепочки там лежит последний квад.
   */
  profile: (seconds?: number) => profiler.run(seconds),
  /**
   * Запас по видеокарте. Под вертикальной синхронизацией «60 fps» не
   * говорит ничего: и впритык, и вдвое дешевле дают 16.7 мс. Поэтому
   * поднимаем разрешение рендера ступенями и смотрим, до какого множителя
   * кадр держится. Это и есть число, которое обязано вырасти после
   * снятия лишних проходов.
   */
  stress: () =>
    stressTest(profiler, (s) => {
      renderScale = s
      resize()
    }),
  /**
   * Подпись кадра — сетка средних цветов. Ею проверяется, что правка,
   * которая обязана НЕ менять картинку, её и не изменила.
   *
   * Перед снятием гасить зерно: `post.grain(0)`. Оно перебрасывается
   * каждый кадр по построению и разошлось бы всегда.
   */
  grab: () => new Promise((res) => { pendingGrab = res }),
  /** Расхождение двух подписей: среднее и максимум по каналу. */
  compareFrames: compareSignatures,
  /** Идёт ли человек по комнате с клавиатуры. То же самое видно в разметке
   *  атрибутом `data-keyboard` на корне. */
  keyboardMode: () => keyboard.active(),
  dumpCamera: () => ({
    position: camera.position.toArray().map((n) => +n.toFixed(3)),
    target: controls.target.toArray().map((n) => +n.toFixed(3)),
    fov: camera.fov,
  }),
  /** Габаритный ящик любого объекта по имени — быстрый способ поймать
   *  предмет, уехавший за кадр или собранный не того размера. */
  measure: (name: string) => {
    const obj = scene.getObjectByName(name)
    if (!obj) return `нет объекта "${name}"`
    const b = new THREE.Box3().setFromObject(obj)
    const s = b.getSize(new THREE.Vector3())
    const c = b.getCenter(new THREE.Vector3())
    const f = (v: THREE.Vector3) => v.toArray().map((n) => +n.toFixed(3))
    return { размер: f(s), центр: f(c), мин: f(b.min), макс: f(b.max) }
  },
})

let frames = 0
const clock = new THREE.Clock()

/** Заказ на подпись кадра. Исполняется внутри `frame()`, потому что
 *  прочитать буфер можно только там. См. хук `grab()`. */
let pendingGrab: ((s: ReturnType<typeof grabSignature>) => void) | null = null

/** Объявлен функцией, а не стрелкой в переменной: `applyMode()` ссылается
 *  на него выше по файлу, чтобы запустить цикл у уже открытой комнаты. */
let state: SkyState = skyNow()

function frame() {
  const nowMs = performance.now()
  // Первой строкой: закрывает счётчики предыдущего кадра до того, как в
  // текущем что-нибудь нарисуется. Пока сбор не идёт — сразу возврат.
  profiler.frame(nowMs)
  focus.update(nowMs)
  lampSwitch?.update(nowMs)
  controls.update()
  // Кнопки предметов едут за камерой. Сама функция выходит первой строкой,
  // пока клавиатуру не проявили, — то есть для мыши это один вызов и
  // сравнение булева.
  hotspotButtons.sync()

  // Дельта снимается РОВНО ОДИН РАЗ за кадр: `Clock.getDelta()` обнуляет
  // счётчик, и второй вызов вернул бы ноль — зерно перестало бы жить, а
  // выбег кресла зависел бы от того, кто спросил первым.
  const dt = Math.min(0.05, clock.getDelta())
  const t = clock.getElapsedTime()
  // Выбег кресла идёт по времени, а не по числу кадров: иначе на экране
  // со 120 Гц кресло докручивалось бы вдвое дольше.
  chairSpin?.update(dt)
  /**
   * Тень — только когда есть что перерисовывать.
   *
   * Прошлый вариант обновлял её каждый четвёртый кадр и только на
   * телефоне. Сомнение, из-за которого он таким и остался, снято:
   * `moving()` у кресла — это «под рукой ИЛИ на выбеге», а не
   * `dragging()`, поэтому докрутка после отпускания не застывает.
   *
   * Первые два кадра — безусловно. Один был бы теоретически достаточен,
   * но карта считается внутри `renderer.render`, а на первом кадре ещё
   * едет раскладка: холст может смениться в размере, и таргеты вместе с
   * ним. Второй кадр стоит один проход один раз за сессию и снимает
   * целый класс «тень не появилась, и непонятно почему».
   */
  // Флаги снимаются ДО условия, а не внутри него: `||` коротит, и
  // `shadowDirty()` — читатель, который флаг СБРАСЫВАЕТ. Спрятанный за
  // коротким замыканием, он не сбрасывался бы в те кадры, когда едет
  // кресло, и лампа щёлкала бы тень дважды.
  const chairMoving = chairSpin?.moving() ?? false
  // Мгновенный поворот кресла (толчок клавишей при отключённой анимации)
  // скорости не оставляет, и `moving()` про него не знает.
  const chairStepped = chairSpin?.shadowDirty() ?? false
  const lampDirty = lampSwitch?.shadowDirty() ?? false
  if (frames < 2 || chairMoving || chairStepped || lampDirty) {
    renderer.shadowMap.needsUpdate = true
  }
  // Та же дельта уходит в игру на мониторе — и по той же причине. Тик
  // приходит каждый кадр, но что-то делает только у открытой игры.
  screens.tickGame(dt)
  // Положение солнца пересчитываем дважды в секунду: за 500 мс оно
  // проходит четыре угловые секунды. Анимацию облаков и осадков
  // двигаем каждый кадр — она живёт временем, а не астрономией.
  if (frames % 30 === 2) {
    state = skyNow()
    applyRealtimeTime(state)
    if (baked) applyTime(state)
    // Лампа сама зажигается к ночи. Порог и правило «рука человека
    // главнее автоматики» живут в самой лампе — здесь только сигнал.
    lampSwitch?.follow(state.daylight)
    screens.tick(state.daylight, post.stats().calls, state.clock)
  }
  // Объектив наведён туда же, куда смотрит посетитель: на цель орбиты.
  // При подлёте в фокус цель едет вместе с камерой, и резкость едет за ней.
  post.setFocus(camera.position.distanceTo(controls.target))
  sky.update(state, weather, t)
  // Перерисовка экрана — не чаще раза в кадр и только если что-то изменилось.
  // Планшету нужны настоящие часы: дорожка идёт секундами, а не кадрами.
  screens.flush(nowMs)
  post.render(dt)
  // Подпись кадра снимается РОВНО ЗДЕСЬ: `preserveDrawingBuffer` выключен,
  // и после возврата из этого колбэка буфер уже не наш.
  if (pendingGrab) {
    const done = pendingGrab
    pendingGrab = null
    done(grabSignature(renderer))
  }
  if (DEBUG && frames % 30 === 0) updateHud()
  // Готовность объявляется ПОСЛЕ первого настоящего кадра, а не на импорте
  // модуля: между ними ещё один rAF, в котором холст пуст. Атрибут гасит
  // строку загрузки в index.html и показывает оверлеи комнаты (#help и,
  // под ?debug, #hud) — до него они спрятаны, чтобы не висеть на чёрном.
  if (frames === 0) document.documentElement.dataset.ready = ''
  frames++
}
