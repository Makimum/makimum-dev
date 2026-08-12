import * as THREE from 'three'
import { Sky } from 'three/examples/jsm/objects/Sky.js'
import { WINDOW } from '../constants'
import type { SkyState } from './time'
import { precipKind, type Weather } from './weather'

/**
 * Небо за окном — четыре слоя на плоскостях, ноль ассетов.
 *
 * ПОЧЕМУ ПЛОСКОСТИ, А НЕ КУПОЛ. Комната — угол: есть левая стена, задняя,
 * пол и потолок, а двух других стен нет. Полноценный купол вокруг сцены
 * был бы виден во всех этих провалах, и диорама превратилась бы в
 * парящий в небе островок. Плоскость за окном показывает небо ровно там,
 * где ему положено быть — в проёме, — а остальное остаётся тёмной пустотой.
 *
 * Слой 1 — модель Preetham из three.js (`Sky.SkyShader`), уже лежит в
 * зависимостях. Её вершинный шейдер прижимает фрагменты к дальней
 * плоскости (`gl_Position.z = gl_Position.w`), поэтому слой всегда за
 * стеной и виден только сквозь проём — ровно то, что нужно. Направление
 * взгляда шейдер берёт из мировой позиции фрагмента, так что параллакс
 * при облёте камеры настоящий. Сюда же вписаны земля и затянутое небо.
 *
 * Слой 2 — ночь: звёзды и луна с фазой. Preetham на отрицательной высоте
 * солнца даёт почти чёрное небо, и без этого слоя в окне была бы дыра.
 *
 * Слой 3 — облака. Свой, а не из `Sky.js`: почему — см. ниже, у CLOUD_FRAG.
 *
 * Слой 4 — осадки: дождь или снег прямо перед стеклом.
 */

/** Небо и звёзды — далеко, чтобы параллакс читался. Осадки — вплотную. */
const SKY_Z = -14
const NIGHT_Z = -13.9
const CLOUD_Z = -13.8
const PRECIP_Z = -0.55

export interface SkyLayers {
  group: THREE.Group
  update(state: SkyState, weather: Weather, time: number): void
  /** Гасит небо и возвращает старый квад: бейкер обязан видеть то же,
   *  что видел раньше, иначе свет в комнате поедет. */
  setBakeMode(on: boolean): void
}

const NIGHT_VERT = /* glsl */ `
  varying vec3 vWorld;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`

/**
 * Звёзды считаются, а не кладутся текстурой: хеш по направлению взгляда
 * даёт одинаковое небо в любом разрешении и не весит ни байта. Луна —
 * диск с терминатором, повёрнутым по освещённой доле из SunCalc.
 */
const NIGHT_FRAG = /* glsl */ `
  varying vec3 vWorld;
  uniform vec3 uMoon;
  uniform float uMoonPhase;
  uniform float uNight;
  uniform float uTime;
  uniform float uHaze;
  uniform float uCity;
  uniform vec3  uSun;
  uniform float uTwilight;

  float hash(vec2 p) {
    p = fract(p * vec2(0.3183099, 0.3678794) + vec2(0.71, 0.113));
    p += dot(p, p + 19.19);
    return fract(p.x * p.y * 17.0);
  }

  void main() {
    // Слой виден, пока есть хоть одно из двух: ночь или сумерки. Раньше
    // порогом была только ночь, и сумерки в июне не показывались вовсе.
    float vis = max(uNight, uTwilight);
    if (vis <= 0.002) discard;
    vec3 dir = normalize(vWorld - cameraPosition);
    // Ниже горизонта звёзд нет — там земля.
    float above = smoothstep(-0.02, 0.06, dir.y);

    // ЗВЕЗДА — ТОЧКА, А НЕ ЯЧЕЙКА, И СЕТКА УГЛОВАЯ, А НЕ ОБЪЁМНАЯ.
    //
    // Прежний вариант хешировал floor(dir * 220) и зажигал ячейку
    // целиком: на экране получался квадрат со стороной в пиксель, а
    // радиальная аберрация из grade подкрашивала ему края — на кадре это
    // читалось как битые пиксели, а не как небо.
    //
    // Спад внутри ячейки эту беду чинит, но объёмную сетку — нет: dir
    // единичный, то есть выборка идёт по сфере, а случайный центр звезды
    // лежал бы где угодно в кубике, и луч по нему чаще всего промахивался
    // (проверено: звёзды пропали почти все). Поэтому сетка построена по
    // двум углам направления. Искажения у полюсов нам безразличны: в
    // проём видно полосу у горизонта, а не зенит.
    float phi = atan(dir.z, dir.x);
    float theta = asin(clamp(dir.y, -1.0, 1.0));
    vec2 g = vec2(phi, theta) * 210.0;
    vec2 cell = floor(g);
    vec2 f = fract(g);
    float h = hash(cell);
    vec2 centre = vec2(hash(cell + 7.3), hash(cell + 19.1)) * 0.7 + 0.15;
    float d = length(f - centre);
    // Яркость разная: ровное небо из одинаковых точек выглядит напечатанным.
    float mag = 0.30 + 0.70 * hash(cell + 41.9);
    float star = smoothstep(0.9920, 1.0, h) * smoothstep(0.26, 0.0, d) * mag;
    float twinkle = 0.65 + 0.35 * sin(uTime * 2.2 + h * 40.0);
    vec3 col = vec3(star * twinkle) * vec3(0.86, 0.9, 1.0) * uNight;

    // НОЧНОЕ НЕБО НЕ ЧЁРНОЕ, и это не вкусовщина: у Preetham при солнце
    // под горизонтом остаётся только константа порядка 0.0003, и после
    // тонмаппинга проём становится ровным чёрным прямоугольником — глаз
    // читает такой прямоугольник как незагрузившуюся сцену, а не как ночь.
    // Тон и засветка живут ЗДЕСЬ, а не в слое Preetham, потому что это
    // ровно то, чем слой ночи и занимается: как выглядит небо, когда
    // солнца уже нет.
    col += vec3(0.014, 0.019, 0.036) * (0.45 + 0.55 * smoothstep(-0.02, 0.35, dir.y)) * uNight;
    // Город за горизонтом: тёплая полоса, гаснущая вверх.
    col += vec3(1.0, 0.58, 0.26) * uCity * smoothstep(0.26, -0.01, dir.y);

    // СУМЕРКИ. Самая важная часть слоя, и её здесь не было.
    //
    // У Preetham яркость солнца считает sunIntensity(), а она обнуляется,
    // когда солнце опускается ниже −2.3°: модель просто выключается, и
    // ниже этой высоты небо у неё — константа. Для Хельсинки это не
    // мелочь, а дыра размером в лето: в июне солнце не опускается ниже
    // −7° вообще, то есть ВСЯ белая ночь у модели была чёрной. Проверено
    // прогоном: 21 июня 01:00, солнце на −5.79°, окно — чёрный
    // прямоугольник, хотя в Хельсинки в этот момент светло.
    //
    // Поэтому сумеречное свечение считается здесь: холодный купол плюс
    // тёплая полоса в той стороне, где солнце село. Направление берётся
    // по азимуту (горизонтальная проекция), потому что само солнце уже
    // под горизонтом и его высота ничего не подсказывает.
    vec2 sunAz = normalize(vec2(uSun.x, uSun.z) + vec2(1e-5));
    vec2 dirAz = normalize(vec2(dir.x, dir.z) + vec2(1e-5));
    float sunward = dot(sunAz, dirAz) * 0.5 + 0.5;
    // Свечение жмётся к горизонту: выше оно быстро сходит на нет.
    float band = exp(-max(0.0, dir.y) * 5.0);
    vec3 cool = vec3(0.055, 0.085, 0.150);
    vec3 warm = vec3(0.320, 0.185, 0.105);
    col += (cool + warm * pow(sunward, 3.0)) * band * uTwilight;

    // Луна: диск с мягким краем плюс ореол.
    float dm = dot(dir, normalize(uMoon));
    float disc = smoothstep(0.99955, 0.99985, dm);
    float halo = smoothstep(0.985, 1.0, dm) * 0.35;
    // Терминатор: сдвигаем границу освещённой части по фазе.
    vec3 side = normalize(cross(uMoon, vec3(0.0, 1.0, 0.0)));
    float t = dot(dir - normalize(uMoon), side) * 3000.0;
    float lit = smoothstep(-1.0, 1.0, t + (uMoonPhase * 2.0 - 1.0) * 2.0);
    col += vec3(0.98, 0.97, 0.92) * (disc * lit + halo * uMoonPhase) * uNight;

    // Альфа здесь единица, а гашение каждой составляющей уже вписано в
    // цвет выше. Так надо потому, что слоёв в этом шейдере теперь два —
    // ночь и сумерки, — и они живут по разным расписаниям: одна общая
    // альфа гасила бы сумерки ночным коэффициентом, а он в июне почти
    // нулевой. Блендинг аддитивный, при альфе 1.0 он просто складывает.
    //
    // Облака гасят звёзды и свечение, а не лежат поверх них.
    gl_FragColor = vec4(col * above * (1.0 - uHaze * 0.85), 1.0);
  }
`

const CLOUD_VERT = NIGHT_VERT

/**
 * Облака.
 *
 * ПОЧЕМУ СВОИ, А НЕ ИЗ `Sky.js`. У модели Preetham в three r185 облачный
 * слой есть, и сначала он и стоял здесь. Он не работает по трём причинам,
 * и все три пойманы замером, а не вычитаны:
 *
 * 1. Цвет облака там масштабируется на `vSunE * 0.00002` ≈ 0.02, тогда как
 *    само небо в той же строке — `(Lin + L0) * 0.04`, то есть единицы.
 *    Подмешивание облака ТЕМНИТ небо в десятки раз: при `cloudCoverage 0.9`
 *    окно становится почти чёрным. Затянутый день выглядел как сумерки —
 *    а в Хельсинки это режим по умолчанию бо́льшую часть года.
 * 2. Шум там берётся как `fbm(cloudUV * 1000.0)`, и штатный `cloudScale`
 *    равен 0.0002. Любое «на глаз подобранное» значение вроде 0.35 уводит
 *    частоту за пиксель, и структура вырождается в ровную заливку.
 * 3. `horizonFade` гасит облака в полосе `dir.y < 0.1…0.3` — ровно в той,
 *    которую и видно из окна: сквозь наш проём взгляд идёт от −0.22 до
 *    +0.11. Слой рассчитан на взгляд ВВЕРХ из скайбокса, а у нас взгляд
 *    в горизонт через дыру в стене.
 *
 * Поэтому здесь слой написан под свою задачу: облачная пелена, уходящая
 * к горизонту, со сжатием перспективы и без муара на этом сжатии.
 */
const CLOUD_FRAG = /* glsl */ `
  varying vec3 vWorld;
  uniform vec3  uSun;
  uniform float uCover;     // доля неба под облаками, 0…1
  uniform float uDaylight;  // 0 ночь, 1 день
  uniform float uGolden;    // 1 в середине золотого часа
  uniform float uNight;
  uniform float uCity;      // подсветка низа облаков городом
  uniform float uTime;
  uniform float uWind;      // км/ч

  float hash21(vec2 p) {
    p = fract(p * vec2(233.34, 851.73));
    p += dot(p, p + 23.45);
    return fract(p.x * p.y);
  }

  float vnoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash21(i);
    float b = hash21(i + vec2(1.0, 0.0));
    float c = hash21(i + vec2(0.0, 1.0));
    float d = hash21(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }

  /**
   * fbm с гашением высоких октав.
   *
   * У горизонта проекция сжимает облачный слой в бесконечность, и мелкие
   * октавы уходят за размер пикселя — сетка начинает кипеть муаром на
   * каждом кадре. Октава гасится не в ноль, а в своё среднее (0.5):
   * так сумма не съезжает и порог покрытия остаётся тем же.
   */
  float fbm(vec2 p, float lod) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 5; i++) {
      float w = clamp(lod * 5.0 - float(i), 0.0, 1.0);
      v += a * mix(0.5, vnoise(p), w);
      p *= 2.03;
      a *= 0.5;
    }
    return v;
  }

  void main() {
    if (uCover <= 0.003) discard;
    vec3 dir = normalize(vWorld - cameraPosition);
    if (dir.y <= 0.002) discard;

    // Проекция взгляда на слой облаков.
    //
    // Честная проекция на плоскость — это dir.xz / dir.y, и у горизонта
    // она уходит в бесконечность. Проверено: сквозь наш проём видно
    // полосу dir.y от 0 до 0.11, то есть ТОЛЬКО зону крайнего сжатия, и
    // облака вырождаются в горизонтальные разводы, похожие на рябь на
    // воде. Поэтому в знаменателе стоит смещение: слой ведёт себя как
    // купол, а не как бесконечная плоскость. Перспектива остаётся —
    // ближе к горизонту всё ещё мельче, — но в пределах кадра меняется
    // в полтора раза, а не в сто.
    float y = max(dir.y, 0.0);
    vec2 p = dir.xz / (y + 0.16);
    float lod = clamp(0.35 + y * 5.0, 0.0, 1.0);

    // Снос по ветру. Скорость условная: 25 км/ч должны читаться как
    // движение, но за минуту наблюдения не перемотать всё небо.
    vec2 q = p * 0.62 + vec2(uTime * (0.0035 + uWind * 0.0010), uTime * 0.0012);
    float n = fbm(q, lod);

    float mask = smoothstep(1.0 - uCover - 0.06, 1.0 - uCover + 0.30, n);
    // Дальние облака тонут в дымке, а не обрываются линией: у самого
    // горизонта слой уходит в прозрачность и сквозь него светит небо.
    mask *= smoothstep(0.004, 0.075, dir.y);
    if (mask <= 0.002) discard;

    // Свет. Со стороны солнца край подсвечен, с теневой — низ облака.
    float sunward = dot(dir, normalize(uSun)) * 0.5 + 0.5;
    vec3 lit  = mix(vec3(0.92, 0.94, 0.99), vec3(1.00, 0.82, 0.58), uGolden);
    vec3 base = mix(vec3(0.32, 0.35, 0.43), vec3(0.34, 0.27, 0.30), uGolden);
    vec3 col = mix(base, lit, smoothstep(0.2, 1.0, sunward));

    // Ночью облако — силуэт: оно ТЕМНЕЕ неба, а не светлее, и снизу его
    // подсвечивает город.
    col *= 0.03 + 0.97 * uDaylight;
    col += vec3(1.0, 0.66, 0.36) * uCity * uNight * (1.0 - lod) * 0.5;

    gl_FragColor = vec4(col, mask * (0.55 + 0.35 * uCover));
  }
`

const PRECIP_VERT = NIGHT_VERT

/**
 * Осадки. Дождь — вытянутые штрихи, снег — медленные хлопья; наклон
 * берётся из скорости ветра, потому что вертикальный дождь при 25 км/ч
 * выглядит неправильно даже тому, кто не знает почему.
 */
const PRECIP_FRAG = /* glsl */ `
  varying vec3 vWorld;
  uniform float uTime;
  uniform float uAmount;   // 0…1
  uniform float uSnow;     // 0 дождь, 1 снег
  uniform float uSlant;    // наклон от ветра
  uniform vec3  uTint;

  float hash21(vec2 p) {
    p = fract(p * vec2(233.34, 851.73));
    p += dot(p, p + 23.45);
    return fract(p.x * p.y);
  }

  void main() {
    if (uAmount <= 0.001) discard;
    vec2 uv = vWorld.xy;
    // Сетка задана В МЕТРАХ: плоскость осадков стоит в мировых
    // координатах, поэтому и размер капли, и скорость падения можно
    // свести к натуре, а не подбирать. Ячейка снега — около 4 см
    // (26 на метр), капля падает 5.6 м/с, хлопье 0.77 м/с.
    //
    // Прежние 7 ячеек на метр давали хлопья с ладонь: в проёме это
    // читалось как боке, а не как снег. Поймано кадром — раньше снег на
    // живых данных не проверялся, в день сборки в Хельсинки было ясно.
    float yScale = mix(1.6, 26.0, uSnow);
    float xScale = mix(9.0, 26.0, uSnow);
    float speed = mix(9.0, 20.0, uSnow);
    vec2 gv = vec2(uv.x * xScale + uv.y * uSlant, uv.y * yScale + uTime * speed);
    vec2 id = floor(gv);
    vec2 f = fract(gv) - 0.5;
    float r = hash21(id);
    if (r > mix(0.30, 0.16, uSnow) * uAmount) discard;

    float shape = mix(
      smoothstep(0.34, 0.0, abs(f.x) * 6.0 + abs(f.y) * 0.55),  // штрих дождя
      smoothstep(0.30, 0.0, length(f)),                          // хлопья снега
      uSnow
    );
    gl_FragColor = vec4(uTint, shape * 0.55 * uAmount);
  }
`

/** Типы three объявляют SkyShader как `object`; форма у него известная. */
interface SkyShaderDef {
  uniforms: Record<string, THREE.IUniform>
  vertexShader: string
  fragmentShader: string
}
const SKY_SHADER = Sky.SkyShader as unknown as SkyShaderDef

/**
 * Preetham отдаёт полноценный HDR: полуденное небо там измеряется
 * десятками, а не единицами. В нашей цепочке до тонмаппинга стоит блум с
 * порогом 0.72 — он такое небо превращает в белый туман на всю комнату.
 * Поэтому яркость неба масштабируется одним множителем перед выдачей;
 * это не «подгонка на глаз», а согласование двух диапазонов, которые
 * иначе не стыкуются.
 *
 * Было 0.055. Понижено после замера: окно смотрит в ГОРИЗОНТ, а не в
 * зенит — сквозь проём видно направления от −0.22 до +0.11 по высоте, —
 * и в кадр попадает самая яркая часть модели, окологоризонтная. При 0.055
 * она уходила за порог блума целиком, и днём проём заливало белым вместе
 * с рамой. Судить об этом по зениту нельзя: там небо втрое темнее.
 */
const SKY_GAIN = 0.030

/**
 * Множитель на другом конце шкалы — когда солнце ушло под горизонт.
 * Разница с дневным больше чем на порядок, и это не произвол: у Preetham
 * она такая и есть, а глаз её сглаживает адаптацией. Значение то же, что
 * стояло здесь до правки дневного конца (0.055 × 8), и менять его причин
 * не нашлось: закат и ночь на нём читались.
 */
const SKY_GAIN_NIGHT = 0.44

/**
 * Альбедо земли. Скошенное поле с перелеском под пасмурным небом отражает
 * около 15 % — отсюда и порядок величины, а не «подобрано, чтобы не
 * слепило». Чуть теплее серого: под снегом было бы вдвое больше, но
 * снег у нас приходит погодой, а не временем года.
 */
const GROUND_ALBEDO = new THREE.Color(0.19, 0.175, 0.145)

/**
 * Ночная подсветка горизонта городом. Единственная величина здесь, у
 * которой нет физического обоснования: Хельсинки за окном мы не считаем,
 * а рисуем. Нужна, чтобы ночная земля не была математически честной
 * дырой в ноль — глаз читает такую дыру как незагрузившуюся текстуру.
 */
const CITY_GLOW = 0.010

/**
 * Патч фрагментного шейдера Preetham: земля и затянутое небо.
 *
 * Обе правки живут здесь, а не отдельным слоем, по одной причине — им
 * нужны промежуточные величины самой модели (`Lin`, `direction`), и они
 * ещё в области видимости в точке подмены.
 */
const skyFragment = SKY_SHADER.fragmentShader.replace(
  'gl_FragColor = vec4( texColor, 1.0 );',
  /* glsl */ `
  vec3 viewDir = normalize( vWorldPosition - cameraPosition );
  vec3 skyCol = texColor * uSkyGain;

  // ЗАТЯНУТОЕ НЕБО НЕ ТЕМНЕЕТ, А ВЫРАВНИВАЕТСЯ. Облачность съедает не
  // яркость, а контраст и цвет: пропадает синева зенита и разница между
  // зенитом и горизонтом. Раньше облачность гасили понижением rayleigh, и
  // пасмурный полдень выезжал в сумерки — ровно наоборот тому, как
  // выглядит настоящий пасмурный полдень.
  float lum = dot( skyCol, vec3( 0.2126, 0.7152, 0.0722 ) );
  skyCol = mix( skyCol, vec3( lum ) * vec3( 1.0, 1.01, 1.04 ), uOvercast );

  // ЗЕМЛЯ СВЕТИТСЯ ОТРАЖЁННЫМ, А НЕ СОБСТВЕННЫМ.
  //
  // Ниже горизонта Preetham не считает ничего нового: угол там обрезан
  // (acos( max( 0.0, dot( up, direction ) ) )), и оптическая длина
  // застывает на горизонтном значении. Значит Lin под горизонтом — это
  // яркость неба у самого горизонта, то есть ровно то, что на землю и
  // падает. Берём её как освещённость и умножаем на альбедо.
  //
  // Отсюда два свойства, которых не было у прежней константы: земля
  // права во все часы сама, без отдельной ночной ветки, и физически не
  // может оказаться ярче неба над собой. Прежний вариант мог: ночью
  // константа 0.020 после экспозиции 2.6 давала различимый сине-серый
  // при почти нулевом небе, и в окне земля светилась ярче звёзд.
  //
  // Солнечный диск (L0) в освещённость не берём: это точечный источник
  // в 19 000 единиц, его отражение выжгло бы низ проёма.
  vec3 horizon = max( vec3( 0.0 ), Lin * 0.04 ) * uSkyGain;
  float lumH = dot( horizon, vec3( 0.2126, 0.7152, 0.0722 ) );
  horizon = mix( horizon, vec3( lumH ), uOvercast );

  // Чем ниже смотрим, тем ближе к нам земля и тем меньше между нами
  // воздуха: у горизонта видно дымку — то же небо, потерявшее контраст, —
  // а ниже проступает сама поверхность. Заодно это убирает бритвенную
  // линию, которой горизонт резал проём на всю ширину.
  float depth = clamp( -viewDir.y / 0.20, 0.0, 1.0 );
  depth = depth * depth * ( 3.0 - 2.0 * depth );
  vec3 ground = mix( horizon * 0.88, horizon * uGroundAlbedo, depth );

  // Сумеречное небо тоже светит на землю, и не учесть это нельзя: ниже
  // −2.3° модель отдаёт ноль, освещённость обнуляется, и под светлым
  // июньским небом оказывается чёрная дыра. Свечение то же, что в слое
  // ночи, — иначе земля и небо разъедутся по цвету.
  vec2 sunAzS = normalize( vec2( vSunDirection.x, vSunDirection.z ) + vec2( 1e-5 ) );
  vec2 dirAzS = normalize( vec2( viewDir.x, viewDir.z ) + vec2( 1e-5 ) );
  float sunwardS = dot( sunAzS, dirAzS ) * 0.5 + 0.5;
  vec3 twi = ( vec3( 0.055, 0.085, 0.150 ) + vec3( 0.320, 0.185, 0.105 ) * pow( sunwardS, 3.0 ) ) * uTwilight;
  ground += uGroundAlbedo * twi * 1.2;

  ground += uCity * vec3( 1.0, 0.70, 0.40 ) * ( 1.0 - depth ) * ( 1.0 - depth );

  float below = smoothstep( 0.05, -0.02, viewDir.y );
  gl_FragColor = vec4( mix( skyCol, ground, below ), 1.0 );
  `,
)

export function createSky(scene: THREE.Scene): SkyLayers {
  const group = new THREE.Group()
  group.name = 'sky-outside'

  // --- слой 1: Preetham + земля ---
  const skyMat = new THREE.ShaderMaterial({
    uniforms: {
      ...THREE.UniformsUtils.clone(SKY_SHADER.uniforms),
      uSkyGain: { value: SKY_GAIN },
      uOvercast: { value: 0 },
      uGroundAlbedo: { value: GROUND_ALBEDO.clone() },
      uCity: { value: 0 },
      uTwilight: { value: 0 },
    },
    vertexShader: SKY_SHADER.vertexShader,
    fragmentShader:
      'uniform float uSkyGain;\nuniform float uOvercast;\nuniform vec3 uGroundAlbedo;\n' +
      'uniform float uCity;\nuniform float uTwilight;\n' +
      skyFragment,
    side: THREE.DoubleSide,
    depthWrite: false,
  })
  const skyPlane = new THREE.Mesh(new THREE.PlaneGeometry(64, 40), skyMat)
  skyPlane.position.set(WINDOW.offsetX, 8, SKY_Z)
  skyPlane.name = 'sky-preetham'
  skyPlane.renderOrder = -10
  group.add(skyPlane)

  // --- слой 2: ночь ---
  const nightMat = new THREE.ShaderMaterial({
    uniforms: {
      uMoon: { value: new THREE.Vector3(0, 1, 0) },
      uMoonPhase: { value: 0.5 },
      uNight: { value: 0 },
      uTime: { value: 0 },
      uHaze: { value: 0 },
      uCity: { value: 0 },
      uSun: { value: new THREE.Vector3(0, 1, 0) },
      uTwilight: { value: 0 },
    },
    vertexShader: NIGHT_VERT,
    fragmentShader: NIGHT_FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  })
  const nightPlane = new THREE.Mesh(new THREE.PlaneGeometry(64, 40), nightMat)
  nightPlane.position.set(WINDOW.offsetX, 8, NIGHT_Z)
  nightPlane.name = 'sky-night'
  nightPlane.renderOrder = -9
  group.add(nightPlane)

  // --- слой 3: облака ---
  // Стоят ПОСЛЕ звёзд, а не до: облако закрывает звезду собой. Слой 2
  // при этом всё равно гасит звёзды по общей облачности — сквозь редкие
  // разрывы небо не должно быть таким же звёздным, как в ясную ночь.
  const cloudMat = new THREE.ShaderMaterial({
    uniforms: {
      uSun: { value: new THREE.Vector3(0, 1, 0) },
      uCover: { value: 0 },
      uDaylight: { value: 1 },
      uGolden: { value: 0 },
      uNight: { value: 0 },
      uCity: { value: 0 },
      uTime: { value: 0 },
      uWind: { value: 0 },
    },
    vertexShader: CLOUD_VERT,
    fragmentShader: CLOUD_FRAG,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  })
  const cloudPlane = new THREE.Mesh(new THREE.PlaneGeometry(64, 40), cloudMat)
  cloudPlane.position.set(WINDOW.offsetX, 8, CLOUD_Z)
  cloudPlane.name = 'sky-cloud'
  cloudPlane.renderOrder = -8.5
  group.add(cloudPlane)

  // --- слой 4: осадки ---
  const precipMat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uAmount: { value: 0 },
      uSnow: { value: 0 },
      uSlant: { value: 0.2 },
      uTint: { value: new THREE.Color(0.78, 0.82, 0.9) },
    },
    vertexShader: PRECIP_VERT,
    fragmentShader: PRECIP_FRAG,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  })
  const precipPlane = new THREE.Mesh(new THREE.PlaneGeometry(7, 6), precipMat)
  precipPlane.position.set(WINDOW.offsetX, 2.2, PRECIP_Z)
  precipPlane.name = 'sky-precip'
  precipPlane.renderOrder = -8
  group.add(precipPlane)

  scene.add(group)

  // Старый квад-заглушка в проёме больше не нужен, но остаётся в сцене:
  // на нём держится бейк. Гасим его и возвращаем в setBakeMode.
  const oldQuad = scene.getObjectByName('sky') as THREE.Mesh | undefined
  if (oldQuad) oldQuad.visible = false

  const sun = new THREE.Vector3()

  function update(state: SkyState, weather: Weather, time: number) {
    const u = skyMat.uniforms
    // Preetham ждёт вектор на солнце; длина не важна, кроме vSunfade,
    // который считается от абсолютной высоты — отсюда масштаб.
    sun.copy(state.sun).multiplyScalar(400_000)
    u.sunPosition.value.copy(sun)
    u.time.value = time

    // Множитель яркости зависит от высоты солнца — это грубая
    // автоэкспозиция, и она нужна по той же причине, по которой глаз
    // адаптируется: разница между полднем и закатом у Preetham больше
    // порядка, и один множитель либо выжигает день, либо гасит закат
    // в серое пятно. Проверено обоими крайними случаями.
    //
    // Показатель 1.5, а не 2: на квадрате финский декабрьский полдень
    // (солнце на 6.4°, окно смотрит от него на запад) проваливался в
    // почти чёрное окно при полностью освещённой комнате. Кривая обязана
    // проходить через ту же точку, что и прежняя, — иначе правка дневного
    // конца молча роняет весь низкий свет, а его в Хельсинки больше
    // половины года.
    const low = 1 - Math.min(1, Math.max(0, (state.sunAltitude + 6) / 20))
    const cloud = weather.cloudCover
    // Затянутое небо рассеивает свет по всему куполу, и суммарная
    // яркость проёма не падает, а слегка растёт. Отсюда добавка, а не
    // вычитание: раньше пасмурность гасили, и день выглядел вечером.
    const overcast = smoothstep(0.3, 0.9, cloud)
    u.uSkyGain.value =
      (SKY_GAIN + (SKY_GAIN_NIGHT - SKY_GAIN) * Math.pow(low, 1.5)) * (1 + 0.12 * overcast)
    u.uOvercast.value = overcast
    u.uCity.value = CITY_GLOW * state.nightness
    // Сумерки: включаются там, где заканчивается Preetham (−2.3°), и
    // гаснут к астрономической ночи. Верхняя граница подобрана так, чтобы
    // передача была без ступеньки: на −2° модель уже почти не светит, а
    // здесь свечение уже почти полное. Величина одна на два слоя — небо и
    // земля обязаны гаснуть в такт.
    //
    // Степень 1.8, а не линейная ступень: сумерки убывают не равномерно.
    // Гражданские (0…−6°) светлые, мореходные (−6…−12°) уже тусклые,
    // астрономические (ниже −12°) почти чёрные. На линейной ступени
    // августовская полночь (−10.2°) светилась как июньская (−5.8°), и
    // земля в проёме снова оказывалась ярче неба — проверено кадром.
    const twilight =
      Math.pow(smoothstep(-13, -3, state.sunAltitude), 1.8) *
      (1 - smoothstep(-3, 1, state.sunAltitude))
    u.uTwilight.value = twilight

    // Мутность и рассеяние ведёт облачность: ясное финское небо жёстче
    // и синее, затянутое — молочное и плоское. Rayleigh теперь падает
    // втрое слабее, чем раньше: его понижение красит небо в сумерки, а
    // выравниванием занимается uOvercast, который яркость не трогает.
    u.turbidity.value = 2 + cloud * 8
    u.rayleigh.value = 2.2 - cloud * 0.5
    u.mieCoefficient.value = 0.005 + cloud * 0.012
    u.mieDirectionalG.value = 0.8 - cloud * 0.1
    // Облачный слой самой модели выключен целиком — см. комментарий к
    // CLOUD_FRAG. Нулевое покрытие пропускает весь блок по `if`.
    u.cloudCoverage.value = 0

    const n = nightMat.uniforms
    n.uMoon.value.copy(state.moon)
    n.uMoonPhase.value = state.moonPhase
    n.uNight.value = state.nightness
    n.uTime.value = time
    n.uHaze.value = cloud
    // Затянутое небо засветку города не гасит, а усиливает: облака её
    // отражают вниз. Отсюда множитель по облачности, а не деление.
    n.uCity.value = CITY_GLOW * (1 + 1.6 * cloud) * state.nightness
    n.uSun.value.copy(state.sun)
    n.uTwilight.value = twilight

    const c = cloudMat.uniforms
    c.uSun.value.copy(state.sun)
    // Немного облаков есть почти всегда; полностью пустое небо бывает
    // реже, чем показывает округление, поэтому нижний порог не нулевой.
    c.uCover.value = cloud < 0.04 ? 0 : Math.min(0.97, 0.1 + cloud * 0.85)
    c.uDaylight.value = state.daylight
    c.uGolden.value = state.golden
    c.uNight.value = state.nightness
    c.uCity.value = CITY_GLOW * 40 * state.nightness
    c.uTime.value = time
    c.uWind.value = Math.min(60, weather.wind)

    const kind = precipKind(weather)
    const p = precipMat.uniforms
    // Интенсивность из миллиметров за час: 0.1 мм это морось, 4 мм — ливень.
    const amount = kind === 'none' ? 0 : Math.min(1, 0.28 + weather.precipitation / 4)
    p.uAmount.value = amount
    p.uSnow.value = kind === 'snow' ? 1 : 0
    p.uSlant.value = Math.min(1.2, weather.wind / 30)
    p.uTime.value = time
    precipPlane.visible = amount > 0
  }

  function setBakeMode(on: boolean) {
    group.visible = !on
    if (oldQuad) oldQuad.visible = on
  }

  return { group, update, setBakeMode }
}

/** Та же плавная ступень, что в time.ts; дублировать импорт ради одной
 *  строки дороже, чем саму строку. */
function smoothstep(a: number, b: number, x: number) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}
