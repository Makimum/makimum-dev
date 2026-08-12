import * as THREE from 'three'

/**
 * Светящаяся панель: холст, текстура и материал, связанные один раз.
 *
 * Выделено из `Surface`, когда в комнате появился третий экран — планшет.
 * Общего у экранов ровно это: холст, `CanvasTexture`, та же карта в
 * `map` и в `emissiveMap`, и правило «перерисовывать не чаще раза в кадр
 * и только когда что-то изменилось».
 *
 * А вот всё остальное у них РАЗНОЕ, и наследование здесь было бы ошибкой.
 * У монитора и ноутбука маленькая операционная система: рабочий стол,
 * реестр приложений, попадание по плитке через uv, прокрутка, клавиши.
 * У планшета одно окно, которое никто не трогает. Загонять их в один
 * класс значило бы завести в `Surface` третий вид экрана, у которого нет
 * ни приложений, ни рабочего стола, ни кликов, — то есть ветку «а этот
 * ничего из перечисленного не умеет» в каждом методе.
 */

export interface PanelOptions {
  material: THREE.MeshStandardMaterial
  width: number
  height: number
  /**
   * Полотно монитора — кусок цилиндра, и мы смотрим на его ВОГНУТУЮ
   * сторону. UV у CylinderGeometry разложены под выпуклую, поэтому
   * изнутри текст читается зеркально: карта отражается по горизонтали,
   * а вместе с ней и попадание по плитке.
   */
  mirror?: boolean
  /** Собственная яркость свечения. */
  emissive?: number
}

export class Panel {
  readonly canvas: HTMLCanvasElement
  readonly ctx: CanvasRenderingContext2D
  readonly texture: THREE.CanvasTexture
  readonly material: THREE.MeshStandardMaterial
  readonly mirror: boolean

  constructor(o: PanelOptions) {
    this.material = o.material
    this.mirror = o.mirror ?? false

    const made = document.createElement('canvas')
    made.width = o.width
    made.height = o.height
    this.canvas = made
    this.ctx = made.getContext('2d')!

    this.texture = new THREE.CanvasTexture(made)
    this.texture.colorSpace = THREE.SRGBColorSpace
    this.texture.anisotropy = 8
    if (this.mirror) {
      this.texture.wrapS = THREE.RepeatWrapping
      this.texture.repeat.x = -1
      this.texture.offset.x = 1
    }

    this.material.map = this.texture
    // Эмиссия той же картой: экран должен светиться сам, а не отражать
    // комнату. Иначе в тёмной сцене он выглядит выключенным.
    this.material.emissiveMap = this.texture
    this.material.emissive = new THREE.Color(0xffffff)
    this.material.emissiveIntensity = o.emissive ?? 0.85
    this.material.color.set(0x222222)
    // Полностью матовое полотно. При roughness 0.28 прямоугольный
    // источник окна отражался в экране скруглённым белым пятном: на
    // тёмном интерфейсе его не видно, а на белой странице деки оно
    // читается как грязь посреди слайда. 0.6 пятно только размазало.
    // Экран и без бликов не выглядит выключенным — он светится
    // собственной картой эмиссии, а не отражает комнату.
    this.material.roughness = 1
    this.material.needsUpdate = true
  }

  get width() {
    return this.canvas.width
  }

  get height() {
    return this.canvas.height
  }

  /** uv из рейкаста → пиксели холста. */
  toCanvas(uv: THREE.Vector2): { x: number; y: number } {
    const u = this.mirror ? 1 - uv.x : uv.x
    return { x: u * this.canvas.width, y: (1 - uv.y) * this.canvas.height }
  }

  /** Картинка на холсте изменилась — выгрузить её в текстуру. */
  uploaded() {
    this.texture.needsUpdate = true
  }
}
