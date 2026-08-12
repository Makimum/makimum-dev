import * as THREE from 'three'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'
import { GradeShader } from './grade'

/**
 * Цепочка пост-обработки.
 *
 * Порядок проходов не произволен:
 *   Render → GTAO → Bloom → Grade → Output
 *
 * GTAO идёт СРАЗУ после рендера, пока сцена ещё в линейном
 * пространстве и не тронута свечением: затенение контактов — свойство
 * геометрии, и считать его по картинке с уже размазанным блумом
 * означает затемнять ореолы вместо щелей.
 *
 * Bloom — до цветокоррекции: он имитирует рассеяние в оптике, а зерно
 * и виньетка появляются на плёнке уже после объектива.
 *
 * Output — последним и обязательно: именно он делает тонмаппинг и
 * перевод в sRGB. Если оставить это на рендерере, композер отдаст
 * картинку дважды преобразованной, и она выцветет.
 *
 * ПАМЯТЬ. Каждый проход держит полноэкранный рендер-таргет. На
 * ультрашироком мониторе при DPR 2 цепочка из пяти проходов забирает
 * под гигабайт. Поэтому DPR ограничен полутора, а GTAO считается
 * в половинном разрешении: на затенении контактов это не видно,
 * а памяти экономит вчетверо.
 *
 * ОДИН G-БУФЕР НА ДВУХ ЧИТАТЕЛЕЙ. Раньше сцена прогонялась по геометрии
 * ТРИЖДЫ за кадр: проход глубины ради расфокуса, собственный проход
 * нормалей внутри GTAO и основной рендер. Замер это подтвердил — три
 * прохода, 799 драуколлов и 328 783 треугольника за кадр на 1440×900.
 *
 * Теперь проход один. `GTAOPass.setGBuffer(depth, normals)` выставляет
 * внутренний флаг `_renderGBuffer = false`, и пасс перестаёт рисовать
 * геометрию сам (`GTAOPass.js`, ветка в начале `render()`). Мы отдаём ему
 * тот же таргет, который уже рисовали ради расфокуса, — сменив
 * `overrideMaterial` с `MeshBasicMaterial` на `MeshNormalMaterial`,
 * потому что GTAO нужны и глубина, и нормали, а стоит нормальный
 * материал ровно столько же: ни освещения, ни выборок из карт теней.
 *
 * Настройки таргета скопированы у GTAO не для красоты: `NearestFilter`
 * обязателен, потому что линейная фильтрация нормалей на ребре даёт
 * интерполированную чушь вместо нормали, а `HalfFloatType` держит
 * точность, которой у восьми бит на канал не хватает.
 */

export interface PostOptions {
  /** Затенение контактов. Самый дорогой проход в цепочке. */
  ao?: boolean
  /** Свечение экранов и лампы */
  bloom?: boolean
  /** Виньетка, зерно, аберрация */
  grade?: boolean
}

/** Статистика ИМЕННО СЦЕНЫ, снятая до полноэкранных проходов. */
export interface SceneStats {
  triangles: number
  calls: number
}

export interface PostChain {
  composer: EffectComposer
  /** Счётчики сцены. renderer.info после композера бесполезен: он
   *  сбрасывается на каждом renderer.render(), а последним проходом
   *  идёт полноэкранный квад — отсюда и появлялись «1 треугольник». */
  stats(): SceneStats
  render(dt: number): void
  setSize(w: number, h: number): void
  /** Куда наведён объектив, метры. Обновляется каждый кадр из main. */
  setFocus(distance: number): void
  /** Ручки для подбора на глаз прямо в консоли */
  params: {
    aoIntensity(v: number): void
    bloomStrength(v: number): void
    /** Порог и радиус блума. Вынесены в ручки, потому что подбирать их
     *  надо на живом небе в разную погоду, а не на пересборке. */
    bloomThreshold(v: number): void
    bloomRadius(v: number): void
    vignette(v: number): void
    grain(v: number): void
    /** Размер зерна в пикселях буфера — у плёночного зерна он есть. */
    grainCell(v: number): void
    focusRange(v: number): void
    cocNear(v: number): void
    cocFar(v: number): void
    /** Контраст степенной кривой вокруг 18% серого. */
    contrast(v: number): void
    aberration(v: number): void
    saturation(v: number): void
    exposure(v: number): void
    /** Штатное включение/выключение прохода по имени. Единственный
     *  корректный способ бисекта: ручки вроде blendIntensity гасят
     *  ЭФФЕКТ, но проход всё равно отрабатывает и пишет в буфер. */
    setPass(name: 'ao' | 'bloom' | 'grade', on: boolean): void
    /** Что сейчас включено */
    list(): Record<string, boolean>
  }
  dispose(): void
}

export function createPost(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera,
  options: PostOptions = {},
): PostChain {
  const { ao = true, bloom = true, grade = true } = options
  const w = renderer.domElement.clientWidth
  const h = renderer.domElement.clientHeight

  /**
   * G-буфер: глубина и нормали в половинном разрешении.
   *
   * ЧИТАТЕЛЕЙ ДВОЕ. Расфокус берёт отсюда `depthTexture`, GTAO — и
   * `depthTexture`, и цветовую текстуру с нормалями. Поэтому таргет
   * существует, если включён ХОТЬ ОДИН из них; при обоих выключенных
   * (мобильный профиль зовёт `createPost(..., { ao: false, grade: false })`)
   * память под него не уходит вовсе.
   *
   * ПОЧЕМУ ОТДЕЛЬНЫЙ ПРОХОД, А НЕ ИЗ ТАРГЕТА КОМПОЗЕРА. `EffectComposer`
   * пингпонгует два таргета, и depth-текстура у них общая. Проход
   * цветокоррекции читал бы ту самую глубину, в которую пишет, — чтение и
   * запись одной текстуры, поведение неопределённое. Отдельный проход
   * честнее — и он же теперь единственный.
   *
   * ПОЧЕМУ ОН ДЁШЕВЫЙ. `overrideMaterial` подменяет все материалы на
   * нормальный — ни освещения, ни выборок из карт теней, ни
   * пост-обработки, — а буфер вдвое меньше по стороне, то есть вчетверо
   * по заполнению.
   *
   * Тень в этом проходе не пересчитывается: `needsUpdate` снимается на
   * время прохода и возвращается обратно, чтобы карту посчитал основной
   * рендер — там, где ей и место.
   */
  let gbuffer: THREE.WebGLRenderTarget | null = null
  let normalMaterial: THREE.MeshNormalMaterial | null = null

  /** Сторона G-буфера. Одна функция на всех, чтобы таргет расфокуса и
   *  внутренние таргеты GTAO не разъехались по разрешению. */
  const halfSize = (cw: number, ch: number): [number, number] => [
    Math.max(1, Math.round(cw / 2)),
    Math.max(1, Math.round(ch / 2)),
  ]

  if (ao || grade) {
    const [gw, gh] = halfSize(w, h)
    gbuffer = new THREE.WebGLRenderTarget(gw, gh, {
      // Настройки — те же, что GTAO заводит себе сам, и это не совпадение:
      // Nearest потому, что линейная фильтрация нормалей на ребре даёт
      // нормаль, которой на поверхности нет; HalfFloat потому, что восьми
      // бит на канал нормали не хватает.
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      type: THREE.HalfFloatType,
      depthTexture: new THREE.DepthTexture(gw, gh),
      depthBuffer: true,
    })
    normalMaterial = new THREE.MeshNormalMaterial()
  }

  const composer = new EffectComposer(renderer)

  // Снимаем счётчики сразу после рендера сцены. renderer.info обнуляется
  // при каждом внутреннем renderer.render(), поэтому к концу цепочки там
  // остаётся статистика последнего полноэкранного квада, а не комнаты.
  const renderPass = new RenderPass(scene, camera)
  let sceneStats: SceneStats = { triangles: 0, calls: 0 }
  const origRender = renderPass.render.bind(renderPass)
  renderPass.render = ((...args: Parameters<typeof origRender>) => {
    origRender(...args)
    sceneStats = {
      triangles: renderer.info.render.triangles,
      calls: renderer.info.render.calls,
    }
  }) as typeof renderPass.render
  composer.addPass(renderPass)

  let gtao: GTAOPass | null = null
  if (ao) {
    // Половинное разрешение: затенение контактов низкочастотное по своей
    // природе, лишние пиксели в нём не видны, а память стоят реальную.
    const [gw, gh] = halfSize(w, h)
    gtao = new GTAOPass(scene, camera, gw, gh)
    gtao.output = GTAOPass.OUTPUT.Default
    // Чужой G-буфер вместо своего: пасс перестаёт гонять геометрию сам.
    //
    // Что картинка от этого не меняется — не рассуждение, а замер. Оба
    // пути были собраны рядом и сняты подписью кадра (`grab()`) в одной
    // позе, при одном времени неба и погашенном зерне: расхождение
    // 0.066 в среднем и 1 из 255 в максимуме, то есть округление
    // восьмибитного канала. Проходов при этом стало 2 вместо 3,
    // драуколлов 359 вместо 529.
    gtao.setGBuffer(gbuffer!.depthTexture!, gbuffer!.texture)
    // Конструктор GTAOPass уже успел завести собственный normalRenderTarget
    // (`setGBuffer` без аргументов), и уронить его нельзя: последняя строка
    // `setGBuffer` читает его depthTexture ради отладочного OUTPUT.Depth.
    // Поэтому не удаляем, а освобождаем видеопамять — рисовать в него
    // больше некому.
    // `normalRenderTarget` в типах three не объявлен, он внутренний; каст
    // точечный и подписанный, а не «any на всякий случай».
    ;(gtao as unknown as { normalRenderTarget: THREE.WebGLRenderTarget }).normalRenderTarget.dispose()
    gtao.updateGtaoMaterial({
      // Радиус в метрах. Сцена в метрах, поэтому 0.22 — это примерно
      // ширина ладони: щели под столом и в стыках рамы кресла.
      radius: 0.22,
      distanceExponent: 1.0,
      // Толщина 0.4 означала «считать перекрывающим всё, что в 40 см за
      // сэмплом». Горб VESA стоит в 4.5 см ЗА полотном монитора, попадал
      // в это окно и печатал на экране светлый прямоугольник ровно своего
      // размера — на тёмном интерфейсе незаметный, на белом слайде деки
      // выглядящий как грязь. 4 см оставляют щели под столом и в раме
      // кресла, но не дотягиваются сквозь панель.
      thickness: 0.04,
      scale: 1.0,
      samples: 12,
      screenSpaceRadius: false,
    })
    composer.addPass(gtao)
  }

  let bloomPass: UnrealBloomPass | null = null
  if (bloom) {
    // Порог: свечение достаётся только по-настоящему горячему.
    //
    // Было 0.72 — и этого не хватало ровно на одном сюжете, зато на самом
    // частом. Небо за окном в линейном пространстве стоит около двойки, и
    // при пороге 0.72 в блум уходил ВЕСЬ проём целиком: пасмурный день
    // превращал окно в светящееся пятно, съедавшее и раму, и землю под
    // горизонтом. Замерено на затянутом небе (облачность 0.7, полдень):
    // с блумом окно — ровный туман, без блума — светлое небо и тёмная
    // земля. Порог 1.10 оставляет свечение экранам, лампочке и прямому
    // солнцу на белом, но перестаёт считать горячим само небо.
    //
    // Заодно уже́ радиус: ореол в полкадра расползался по стене, а
    // рассеяние в оптике так далеко не уходит.
    bloomPass = new UnrealBloomPass(new THREE.Vector2(w, h), 0.32, 0.42, 1.1)

    /**
     * Галация: широкий ореол теплее тугого.
     *
     * У настоящей плёнки свет, пробив эмульсию, отражается от подложки и
     * возвращается — рассеиваясь тем сильнее, чем длиннее волна. Поэтому
     * вокруг яркого пятна тугое свечение остаётся нейтральным, а дальний
     * ореол уходит в оранжево-красный. Проход уже считает пять уровней
     * размытия и уже держит массив тинтов — мы просто перестаём оставлять
     * его белым. Ноль дополнительной стоимости.
     */
    bloomPass.bloomTintColors = [
      new THREE.Vector3(1.0, 1.0, 1.0),
      new THREE.Vector3(1.0, 0.94, 0.86),
      new THREE.Vector3(1.0, 0.86, 0.7),
      new THREE.Vector3(1.0, 0.78, 0.58),
      new THREE.Vector3(1.0, 0.72, 0.5),
    ]
    composer.addPass(bloomPass)
  }

  let gradePass: ShaderPass | null = null
  if (grade) {
    gradePass = new ShaderPass(GradeShader)
    gradePass.uniforms.uResolution.value.set(w, h)
    // Глубина берётся из общего G-буфера — того же, из которого GTAO
    // берёт нормали. Своей у расфокуса больше нет.
    gradePass.uniforms.tDepth.value = gbuffer!.depthTexture
    gradePass.uniforms.uNear.value = camera.near
    gradePass.uniforms.uFar.value = camera.far
    composer.addPass(gradePass)
  }

  /** Пиксель буфера, а не CSS: DPR ограничен полутора, и радиус расфокуса
   *  в CSS-пикселях врал бы ровно в эти полтора раза. */
  const bufferSize = new THREE.Vector2()
  function syncTexel() {
    renderer.getDrawingBufferSize(bufferSize)
    gradePass?.uniforms.uTexel.value.set(1 / bufferSize.x, 1 / bufferSize.y)
  }
  syncTexel()

  /**
   * Единственный служебный проход по геометрии за кадр: глубина и нормали.
   *
   * ЦВЕТ ОЧИСТКИ 0x7777ff — не произвольный. Это ровно то, чем чистит свой
   * проход сам GTAOPass, и распаковывается оно в нормаль, смотрящую в
   * камеру. Любой другой фон дал бы затенение по краю кадра и вокруг окна,
   * где геометрии нет.
   *
   * ТЕНЬ ЗДЕСЬ НЕ СЧИТАЕТСЯ. Снимаем `needsUpdate`, а не `autoUpdate`:
   * `autoUpdate` теперь выключен всегда, и один только он карту уже не
   * удержит — при поднятом `needsUpdate` она пересчиталась бы прямо здесь,
   * а основному рендеру не досталось бы ничего. Флаг возвращается на место,
   * и карту считает тот проход, которому она нужна.
   */
  function renderGBuffer() {
    // По факту не сработает: функция зовётся только когда включён GTAO или
    // расфокус, а вместе с любым из них заведён и буфер. Проверка нужна
    // компилятору — связь между двумя функциями он не выводит.
    if (!gbuffer || !normalMaterial) return
    const prevOverride = scene.overrideMaterial
    const prevNeedsUpdate = renderer.shadowMap.needsUpdate
    const prevClear = renderer.getClearColor(new THREE.Color()).getHex()
    const prevAlpha = renderer.getClearAlpha()

    renderer.shadowMap.needsUpdate = false
    scene.overrideMaterial = normalMaterial
    renderer.setRenderTarget(gbuffer)
    renderer.setClearColor(0x7777ff, 1)
    renderer.clear()
    renderer.render(scene, camera)
    renderer.setRenderTarget(null)

    renderer.setClearColor(prevClear, prevAlpha)
    scene.overrideMaterial = prevOverride
    renderer.shadowMap.needsUpdate = prevNeedsUpdate
  }

  composer.addPass(new OutputPass())

  let time = 0
  let frame = 0

  return {
    composer,
    stats: () => sceneStats,
    render(dt: number) {
      time += dt
      frame++
      if (gradePass?.enabled) {
        gradePass.uniforms.uTime.value = time
        // Зерно перебрасывается целиком каждый кадр, а не плывёт по нему:
        // на плёнке кристаллы у каждого кадра свои. Шаг по золотому
        // сечению — чтобы соседние кадры не попадали в одну и ту же
        // выборку хеша и картинка не «дышала» периодом.
        gradePass.uniforms.uGrainSeed.value = (frame * 0.618034) % 1024
      }
      // Проверяем `enabled`, а не существование: выключенный ручкой проход
      // не читает G-буфер, и снимать его для него незачем. Достаточно
      // одного включённого читателя — расфокуса или затенения контактов.
      // G-буфер нужен ДО композера: оба читают его, а не пишут в него.
      if (gradePass?.enabled || gtao?.enabled) renderGBuffer()
      composer.render(dt)
    },
    setSize(nw: number, nh: number) {
      composer.setSize(nw, nh)
      bloomPass?.setSize(nw, nh)
      gradePass?.uniforms.uResolution.value.set(nw, nh)
      // G-буфер и внутренние таргеты GTAO обязаны ехать ОДНОЙ функцией
      // размера. Разъехавшись, они дали бы затенение, посчитанное по
      // нормалям чужого разрешения, — а это не заметно на скриншоте и
      // вылезает только на движении.
      const [gw, gh] = halfSize(nw, nh)
      gtao?.setSize(gw, gh)
      // Таргет существует только вместе со своими читателями: на мобильном
      // профиле выключены оба, и мерить под него нечего.
      gbuffer?.setSize(gw, gh)
      syncTexel()
    },
    /** Расстояние до точки фокуса в метрах — цель орбиты камеры. */
    setFocus(distance: number) {
      if (gradePass) gradePass.uniforms.uFocus.value = distance
    },
    params: {
      aoIntensity: (v) => gtao && (gtao.blendIntensity = v),
      bloomStrength: (v) => bloomPass && (bloomPass.strength = v),
      bloomThreshold: (v) => bloomPass && (bloomPass.threshold = v),
      bloomRadius: (v) => bloomPass && (bloomPass.radius = v),
      vignette: (v) => gradePass && (gradePass.uniforms.uVignette.value = v),
      grain: (v) => gradePass && (gradePass.uniforms.uGrain.value = v),
      /** Размер зерна в пикселях буфера. Подбирается на живой стене. */
      grainCell: (v: number) => gradePass && (gradePass.uniforms.uGrainCell.value = v),
      /** Полуширина резкой зоны и круги нерезкости — для подбора на глаз. */
      focusRange: (v: number) => gradePass && (gradePass.uniforms.uFocusRange.value = v),
      cocNear: (v: number) => gradePass && (gradePass.uniforms.uCocNear.value = v),
      cocFar: (v: number) => gradePass && (gradePass.uniforms.uCocFar.value = v),
      /** Контраст вокруг 18% серого. */
      contrast: (v: number) => gradePass && (gradePass.uniforms.uContrast.value = v),
      aberration: (v) => gradePass && (gradePass.uniforms.uAberration.value = v),
      saturation: (v) => gradePass && (gradePass.uniforms.uSaturation.value = v),
      /** Экспозиция тонмаппинга. Подбирается вживую — перепекать
       *  ради яркости не нужно, ACES сжимает пересвет обратимо. */
      exposure: (v: number) => {
        renderer.toneMappingExposure = v
      },
      setPass: (name, on) => {
        const target = name === 'ao' ? gtao : name === 'bloom' ? bloomPass : gradePass
        if (target) target.enabled = on
      },
      list: () => ({
        ao: gtao?.enabled ?? false,
        bloom: bloomPass?.enabled ?? false,
        grade: gradePass?.enabled ?? false,
      }),
    },
    dispose() {
      composer.dispose()
      // Всё трое — только если был включён GTAO или расфокус.
      gbuffer?.dispose()
      gbuffer?.depthTexture?.dispose()
      normalMaterial?.dispose()
    },
  }
}
