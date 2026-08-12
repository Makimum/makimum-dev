import * as THREE from 'three'

/**
 * Материал книжного блока: обрез, на котором видны отдельные листы.
 *
 * ПОЧЕМУ НЕ ГЕОМЕТРИЕЙ. Обычный роман — это около трёхсот листов. Триста
 * тонких боксов дали бы 7200 треугольников на предмет, который в кадре
 * занимает пять сантиметров, — при том что вся комната сегодня весит
 * 77 тысяч. Слоистость обреза целиком укладывается в одну строку
 * арифметики во фрагментном шейдере.
 *
 * ПОЧЕМУ ПО ЛОКАЛЬНОЙ КООРДИНАТЕ, А НЕ ПО UV. У `BoxGeometry` развёртка
 * своя на каждой грани, и полоса по UV шла бы на разных гранях в разные
 * стороны: на обрезе поперёк листов, а на крышке блока — вдоль. Листы же
 * сложены вдоль ОДНОЙ оси в пространстве предмета, и считать надо от неё.
 * Поэтому в шейдер уходит `position`, а не `uv`.
 *
 * ЗАТУХАНИЕ. Лист — это 0.09 мм. На общем плане такая полоса заведомо
 * тоньше пикселя, и без затухания обрез превращается в рябь — та же
 * ошибка, за которую однажды получило претензию зерно. Частота гасится
 * по `fwidth`, ровно как у сетки кресла: вблизи видны листы, издали
 * ровная кремовая плоскость.
 */

/** Толщина листа обычной книжной бумаги, метры. Отсюда и частота полос:
 *  она не подбирается на глаз, а считается из физического размера. */
const SHEET_M = 0.00009

export function pageBlockMaterial(color: number): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({
    color,
    // Бумага на обрезе — не бархат и не глянец: пачка листов даёт слабый
    // направленный отблеск вдоль стопки.
    roughness: 0.78,
    metalness: 0,
  })

  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uSheet = { value: SHEET_M }

    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vPageLocal;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n  vPageLocal = position;')

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec3 vPageLocal;
uniform float uSheet;`,
      )
      .replace(
        '#include <alphamap_fragment>',
        `#include <alphamap_fragment>
  {
    // Листы сложены вдоль Y: книга лежит плашмя, и стопка растёт вверх.
    float sheets = vPageLocal.y / uSheet;
    // Сколько листов приходится на пиксель. Больше половины — полосу уже
    // не разрешить, и рисовать её значит рисовать шум.
    float perPixel = fwidth(sheets);
    float detail = 1.0 - smoothstep(0.35, 0.9, perPixel);
    // Не синус: у ровной волны обрез выглядит гофрированным железом.
    // Пила даёт то, что есть в жизни, — тень в стыке и светлый лист.
    float saw = abs(fract(sheets) - 0.5) * 2.0;
    diffuseColor.rgb *= 1.0 - detail * 0.22 * saw;
  }`,
      )
  }

  // Без своего ключа three переиспользует программу обычного
  // MeshStandardMaterial и инъекция молча не применится.
  mat.customProgramCacheKey = () => `pageBlock:${color}`
  return mat
}
