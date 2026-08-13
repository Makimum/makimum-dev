/**
 * Весь текст экранов. ТОЛЬКО английский — решение зафиксировано в
 * docs/HANDOFF.md §0.
 *
 * ПРАВИЛО ИСТОЧНИКА: ни одно число здесь не придумано. Всё, что ниже,
 * взято из docs/HANDOFF.md (§1, §3, §6) и docs/CONTEXT.md, где у каждой
 * цифры проставлен источник. Тексты «About» и «Projects» перенесены из
 * HANDOFF §6 практически дословно — это утверждённая переписанная версия.
 *
 * Сознательно НЕ попало на экраны (см. HANDOFF §6):
 *   — competitor signal engine (прямая просьба);
 *   — выручка RiseFaceit (не разглашается);
 *   — «12 reply alerts/day», «67% draft acceptance» — это копирайт с
 *     лендинга VettaX, а не измерения;
 *   — суммарная выручка VettaX и ARPU — есть в данных, но это не витрина.
 */

/**
 * Числа о самой сцене НЕ вписываются в текст руками.
 *
 * В HANDOFF записано «114 746 треугольников, 278 draw calls» — снимок
 * HUD с одного ракурса. Но draw calls считаются на кадр и зависят от
 * отсечения по пирамиде видимости: тот же кадр из другой точки даёт 304.
 * Число, которое устаревает от поворота камеры, на витрине быть не может.
 *
 * Поэтому: треугольники считаются по сцене один раз при старте (величина
 * от камеры не зависит), draw calls показываются ЖИВЫМИ в строке рабочего
 * стола с подписью «в этом кадре», а размер бандла ставится из отчёта
 * сборки. Заполняется из main.ts до первой отрисовки.
 */
export const FACTS = {
  /**
   * Треугольников в сцене целиком, с учётом инстансов. Перезаписывается
   * замером при старте комнаты; значение по умолчанию — последний
   * измеренный результат, потому что в режиме страницы сцена не
   * поднимается вообще, а текст со «зеро треугольников» уехал бы в
   * поисковую выдачу.
   */
  triangles: 79_012,
  /**
   * Весь сайт в gzip, КБ: из вывода `vite build`, сумма всех чанков
   * (8.84 index.html + 8.87 entry + 328.29 main). Ветка страницы одна на
   * оба режима — index.html + entry, без чанка сцены `main-*.js` — весит
   * около 18 КБ: этот кусок и скачивает телефон, потому что комната
   * грузится только динамическим импортом из entry.ts.
   *
   * Росла она из-за index.html: инлайновый <style>
   * инлайновый <style> едет в прод С КОММЕНТАРИЯМИ, минификатор Vite их
   * не снимает (проверено в `dist/index.html`). То есть каждое объяснение
   * в этой таблице стилей посетитель скачивает.
   */
  bundleKB: 346,
}

const nf = new Intl.NumberFormat('en-US')
export const fmt = (n: number) => nf.format(n)

/** На каком из двух экранов живёт приложение. */
export type Screen = 'monitor' | 'laptop'

export interface AppMeta {
  id: string
  /** Подпись под иконкой на рабочем столе */
  label: string
  /** Строка в заголовке окна */
  title: string
  /** Ключ в ICONS */
  icon: string
  /**
   * Где показывать. Раньше реестр был общий, и оба экрана показывали одно
   * и то же — то есть второй экран не добавлял ничего, кроме второй копии.
   * Теперь у каждого своя роль: на ультрашироком мониторе то, на что
   * СМОТРЯТ (снимки, дека, резюме с фотографией), на матрице ноутбука то,
   * что ЧИТАЮТ. Ширина у них разная не случайно, и контент должен это
   * различие использовать.
   */
  on: Screen
}

export type Block =
  | { t: 'lead'; text: string }
  | { t: 'p'; text: string }
  | { t: 'h'; text: string; sub?: string }
  | { t: 'kicker'; text: string }
  | { t: 'metrics'; items: { value: string; label: string }[] }
  | { t: 'bullets'; items: string[] }
  | { t: 'stack'; items: string[] }
  | { t: 'note'; text: string }
  | { t: 'link'; label: string; href: string }
  | { t: 'rule' }
  | { t: 'gap'; size?: number }
  /** Фотография во всю ширину колонки. Грузится лениво, см. paint.ts. */
  | { t: 'photo'; src: string; ratio: number; caption?: string }
  /** Сетка превью галереи. Клик по превью разворачивает снимок. */
  | { t: 'shots' }

export interface Doc {
  /** Основной поток, скроллится */
  body: Block[]
  /**
   * Правая колонка. На ультрашироком мониторе она стоит неподвижно
   * рядом с текстом; на матрице ноутбука места под неё нет, и блоки
   * просто дописываются в конец основного потока.
   */
  aside?: Block[]
}

export const APPS: AppMeta[] = [
  { id: 'about', label: 'About', title: 'about — maxim fursov', icon: 'user', on: 'laptop' },
  { id: 'projects', label: 'Projects', title: 'projects', icon: 'grid', on: 'laptop' },
  { id: 'room', label: 'This Room', title: 'this room — how it is made', icon: 'cube', on: 'laptop' },
  { id: 'contact', label: 'Contact', title: 'contact', icon: 'at', on: 'laptop' },

  { id: 'resume', label: 'Résumé', title: 'maxim fursov — résumé', icon: 'doc', on: 'monitor' },
  { id: 'gallery', label: 'Gallery', title: 'gallery — receipts', icon: 'photo', on: 'monitor' },
  { id: 'deck', label: 'Pitch Deck', title: 'vettax — pitch deck', icon: 'deck', on: 'monitor' },
  { id: 'tetris', label: 'Tetris', title: 'tetris', icon: 'game', on: 'monitor' },
]

/** Приложения одного экрана. Порядок сохраняется — он же порядок плиток. */
export function appsFor(screen: Screen): AppMeta[] {
  return APPS.filter((a) => a.on === screen)
}

/**
 * Снимки для галереи.
 *
 * Лежат в `public/`, а не в бандле: вместе они весят 324 КБ, и класть их
 * в стартовую загрузку значило бы удвоить вес сайта ради картинок,
 * которые большинство посетителей не откроет. Грузятся при первом
 * открытии галереи.
 *
 * Два снимка из исходной папки сюда СОЗНАТЕЛЬНО не попали: скриншот
 * банковского приложения (там вместе с суммой видна история трат и адрес
 * кошелька) и реплай крипто-бота на 248 просмотров. Первый — приватные
 * данные, второму не место рядом с остальными цифрами.
 */
export interface Shot {
  src: string
  title: string
  note: string
}

export const SHOTS: Shot[] = [
  {
    src: '/gallery/peerlist.webp',
    title: 'Peerlist Launchpad — #16',
    note: '124 upvotes, 16 comments. Week 29, 2026.',
  },
  {
    src: '/gallery/analytics.webp',
    title: 'Google Analytics — 601 active users',
    note: '7.2K events over 30 days, from a standing start.',
  },
  {
    src: '/gallery/launch-x.webp',
    title: 'Product Hunt launch post',
    note: '187.7K views on X.',
  },
  {
    src: '/gallery/demo-x.webp',
    title: 'Demo, the day before launch',
    note: '134.9K views. Built in a month, after a pivot.',
  },
  {
    src: '/gallery/peerlist-x.webp',
    title: 'Live on Peerlist',
    note: '16.5K views. ~200 clients, 2 signed companies.',
  },
  {
    src: '/gallery/stage.webp',
    title: 'Pitching on stage',
    note: 'nFactorial Incubator, Almaty.',
  },
]

/**
 * Документы строятся функцией, а не лежат константой: к моменту вызова
 * FACTS уже заполнены измерениями сцены, а у литерала строки запеклись
 * бы на импорте — с нулями.
 */
function buildDocs(): Record<string, Doc> {
  return {
  /* --------------------------------------------------------------- */
  about: {
    body: [
      { t: 'lead', text: 'I build things that ship. Born in Russia, based in Finland.' },
      {
        t: 'p',
        text:
          'I came in through crypto — 100+ projects as an ambassador and drop hunter, inside one of the largest Russian-speaking Web3 communities. It paid. It also taught me that the money was never the part I liked. The part I liked was building the bots and the scripts.',
      },
      {
        t: 'p',
        text: 'So I started building my own. RookieAI was the first — no revenue, no plan, just mine.',
      },
      {
        t: 'p',
        text:
          'Then a friend pulled me into Telegram. He had a project called RiseFaceit; I joined and built the mini-app system behind it. That is where the first real numbers came from: 10,000 users, and revenue.',
      },
      {
        t: 'p',
        text:
          'Then nFactorial incubator in Almaty, where I built VettaX and pitched it to investors. Third place at the AFM AI Hackathon along the way.',
      },
      { t: 'rule' },
      { t: 'kicker', text: 'Right now' },
      { t: 'p', text: 'Three projects in flight, and open to contract work.' },
    ],
    aside: [
      { t: 'kicker', text: 'The room you are in' },
      {
        t: 'p',
        text:
          `This room is not a picture. It is generated by procedural code — zero bytes of geometry in the bundle, global illumination path-traced in your browser. The whole site is ${FACTS.bundleKB} KB.`,
      },
      { t: 'gap' },
      { t: 'link', label: 'github.com/Makimum', href: 'https://github.com/Makimum' },
      { t: 'link', label: 'x.com/makimum_dev', href: 'https://x.com/makimum_dev' },
      { t: 'link', label: 'maxfurs2008@gmail.com', href: 'mailto:maxfurs2008@gmail.com' },
    ],
  },

  /* --------------------------------------------------------------- */
  projects: {
    body: [
      { t: 'h', text: 'VettaX', sub: 'vetta-x.com' },
      {
        t: 'p',
        text:
          'AI growth agent for X and LinkedIn. Watches the accounts you pick, drafts replies and posts in your voice, publishes only after you say yes. Built with a co-founder, in a month.',
      },
      {
        t: 'metrics',
        items: [
          { value: '$202', label: 'first revenue' },
          { value: '39K', label: 'views on the launch post' },
          // 601 и 124 — со снимков галереи, а не из деки: там оставались
          // 379 и 95, снятые на месяц раньше. Резюме сверено со снимками
          // давно, и на странице два числа про одно и то же стояли на
          // соседних экранах — 601 в резюме и 379 здесь.
          { value: '601', label: 'active users' },
          { value: '+37,800%', label: 'in 30 days' },
        ],
      },
      {
        t: 'bullets',
        items: [
          'Featured on Peerlist — Best B2C SaaS, 124 upvotes',
          '3rd place, AFM AI Hackathon (Almaty)',
          "Pitched at nFactorial Incubator '26 demo day",
        ],
      },
      {
        t: 'stack',
        items: ['Python', 'FastAPI', 'Postgres + pgvector', 'Redis / ARQ', 'React 19', 'TanStack'],
      },
      {
        t: 'note',
        text:
          'The hard part was never the model. X answers replies with 403 when the token is wrong and 403 when the surface is wrong, and those look identical. Proving it was per-surface rather than per-account took correlating twelve publish attempts against their targets.',
      },

      { t: 'rule' },
      { t: 'h', text: 'RiseFaceit' },
      {
        t: 'p',
        text: 'Telegram mini-app system. My first product with real users and real money.',
      },
      { t: 'metrics', items: [{ value: '10,000', label: 'users' }] },

      { t: 'rule' },
      { t: 'h', text: 'RookieAI' },
      {
        t: 'p',
        text: 'First project I built for myself. Non-commercial, and that was the point.',
      },

      { t: 'rule' },
      { t: 'h', text: 'makimum.dev', sub: 'this site' },
      {
        t: 'p',
        text:
          'The room is code: no purchased assets, no GLB files, nothing downloaded at runtime. Global illumination is path-traced in the browser in about a minute and baked into vertex colours.',
      },
      {
        t: 'metrics',
        items: [
          { value: fmt(FACTS.triangles), label: 'triangles in this scene' },
          { value: `${FACTS.bundleKB} KB`, label: 'gzipped, whole site' },
          { value: '0', label: 'downloaded 3D assets' },
        ],
      },
    ],
  },

  /* --------------------------------------------------------------- */
  room: {
    body: [
      { t: 'lead', text: 'Everything you are looking at is generated by code.' },
      {
        t: 'p',
        text:
          'No GLB files, no purchased assets, nothing downloaded at runtime. The desk, the chair, the monitor, the lamp, the radiator, the perforated mesh of the seat — all of it is written as geometry in TypeScript. The bundle contains zero bytes of geometry.',
      },
      { t: 'kicker', text: 'The light is not faked either' },
      {
        t: 'p',
        text:
          "Global illumination is path-traced in your browser and baked into vertex colours instead of a lightmap — no second UV set, no atlas, no seams. Pass one traces cosine-weighted sky visibility over the hemisphere. Pass two traces again and multiplies the hit surface's albedo by its own irradiance. That second pass is what warms the bottom of the wall with the colour of the floor.",
      },
      {
        t: 'p',
        text:
          'After the bake every material becomes MeshBasicMaterial and runtime lighting is not computed at all. Day and night are two Float32Arrays and an interpolation, not a reload — the room follows the clock on your machine. The screens are excluded from the bake, which is why this text can change without touching the light in the room.',
      },
      { t: 'kicker', text: 'The headline bug' },
      {
        t: 'p',
        text:
          'BVH triangles were never linked back to their source vertices, and hardcoded constants had been silently compensating — hiding a 100–160× irradiance inflation. I fixed the linkage, added explicit light sampling, removed the resulting double count, and validated it by measuring illuminance rather than by looking at it.',
      },
      {
        t: 'note',
        text:
          'The acceptance test for the bake is colour, not brightness: the bottom of the wall has to become warmer in hue, not merely darker. It lives in the code as checkColourBleed() — 0.0755 warmth at the floor against 0.0206 at the ceiling.',
      },
      { t: 'kicker', text: 'The sky is not decoration' },
      {
        t: 'p',
        text:
          'That window faces west, and what you see through it is the sky over Helsinki at this exact moment — not yours. The sun position comes from an astronomical solver for 60.17° N, the sky itself from the Preetham daylight model, and the clouds and rain from a live weather feed. In June the sun barely sets there; in December noon is a permanent golden hour. The room follows.',
      },
      {
        t: 'note',
        text:
          'Honest limit: the bake has two states, day and night. Sunset light inside the room is an interpolation with a warm shift on top — plausible, not path-traced. Outside the window it is computed.',
      },
      {
        t: 'p',
        text: 'Weather data by Open-Meteo (CC BY 4.0). Sun and moon positions by SunCalc.',
      },
    ],
    aside: [
      { t: 'kicker', text: 'Measured, not estimated' },
      {
        t: 'metrics',
        items: [
          { value: fmt(FACTS.triangles), label: 'triangles in this scene' },
          { value: `${FACTS.bundleKB} KB`, label: 'gzipped, whole site' },
          { value: '0', label: 'downloaded 3D assets' },
          { value: '0', label: 'bytes of geometry shipped' },
        ],
      },
      { t: 'gap' },
      { t: 'kicker', text: 'Built with' },
      {
        t: 'stack',
        items: ['TypeScript', 'three.js', 'three-mesh-bvh', 'Vite', 'Bun', 'Cloudflare Pages'],
      },
    ],
  },

  /* --------------------------------------------------------------- */
  contact: {
    body: [
      { t: 'lead', text: 'Three projects in flight, and open to contract work.' },
      { t: 'gap' },
      { t: 'link', label: 'github.com/Makimum', href: 'https://github.com/Makimum' },
      { t: 'link', label: 'x.com/makimum_dev', href: 'https://x.com/makimum_dev' },
      { t: 'link', label: 'maxfurs2008@gmail.com', href: 'mailto:maxfurs2008@gmail.com' },
      { t: 'link', label: 'vetta-x.com', href: 'https://vetta-x.com' },
      { t: 'gap' },
      {
        t: 'note',
        text: 'Links open in a new tab. Everything else is written once and rendered twice: laid out as a page, and drawn — pixel by pixel, not laid out — on a screen inside the room.',
      },
    ],
  },

  /* --------------------------------------------------------------- */
  // Тетрис словами. Экран комнаты этот документ НЕ читает: при
  // `appId === 'tetris'` paint.ts рисует игру, а не поток блоков. Значит
  // отсюда слова про тетрис берёт только раздел «Tetris» страницы
  // (src/page/tree.ts) — он же скрытое дерево комнаты, и другого источника
  // у поисковика со скринридером нет. Правила описаны текстом намеренно:
  // поток из «фигура опустилась на клетку» скринридер превратит в кашу.
  // Рекорда здесь нет — он живёт в localStorage и дописывается хвостом в
  // page/mount.ts.
  tetris: {
    body: [
      { t: 'lead', text: 'Tetris, on the monitor in the room.' },
      {
        t: 'p',
        text:
          'Ten columns by twenty rows, Super Rotation System with wall kicks, seven-bag randomiser — the standard rules, not an approximation of them. Arrow keys move and rotate, space is a hard drop, escape goes back to the desktop. Leaving the screen pauses the game.',
      },
      {
        t: 'note',
        text: 'The record is stored in this browser only. There is no server behind this site, so it is your best, not a high score.',
      },
    ],
  },

  /* --------------------------------------------------------------- */
  gallery: {
    body: [
      { t: 'lead', text: 'Receipts.' },
      {
        t: 'p',
        text:
          'Screenshots, not claims. Every number below was counted by someone else — a launchpad, an analytics console, a view counter.',
      },
      { t: 'gap' },
      { t: 'shots' },
    ],
  },

  /* --------------------------------------------------------------- */
  // Резюме. Прежний PDF (RU, v4) устарел настолько, что переписан с нуля:
  // в нём не было ни VettaX, ни nFactorial, ни хакатона — то есть всего,
  // что случилось за последний год. Цифры здесь сверены со снимками из
  // галереи, а не переписаны из деки: в деке было 95 апвоутов и 379
  // пользователей, на снимках уже 124 и 601.
  //
  // Projects тоже подтянут к снимкам (601 и 124). Дека НЕ тронута
  // намеренно: она показывалась инвесторам в том виде, в каком показывалась,
  // и переписывать её задним числом — подделывать документ, а не обновлять
  // витрину. Поэтому 379 и 95 в DECK остаются и будут расходиться с
  // остальной страницей.
  resume: {
    body: [
      // Пропорция баннера, а не портрета: снимок сцены вертикальный, и при
      // 0.75 он занимал весь экран целиком — имя и текст уезжали под скролл.
      { t: 'photo', src: '/gallery/stage.webp', ratio: 0.4, caption: 'nFactorial Incubator, Almaty — pitching VettaX.' },
      { t: 'gap' },
      { t: 'lead', text: 'Maxim Fursov — builder, Helsinki.' },
      {
        t: 'p',
        text:
          'I ship products end to end: backend, model plumbing, frontend, and the launch. Born in Russia, based in Finland, currently in the IB Programme.',
      },
      { t: 'rule' },

      { t: 'kicker', text: 'Now' },
      { t: 'h', text: 'VettaX', sub: 'co-founder · vetta-x.com' },
      {
        t: 'p',
        text:
          'AI growth agent for X and LinkedIn. Watches the accounts you pick, drafts replies and posts in your voice, publishes only after you approve. Built with a co-founder in a month, after a full pivot.',
      },
      {
        t: 'metrics',
        items: [
          { value: '601', label: 'active users, 30 days' },
          { value: '187.7K', label: 'views, launch post' },
          { value: '124', label: 'Peerlist upvotes' },
          { value: '$202', label: 'first revenue' },
        ],
      },
      {
        t: 'bullets',
        items: [
          'Peerlist Launchpad — #16 of the week, Best B2C SaaS',
          '3rd place, AFM AI Hackathon — the largest AI-security hackathon in Kazakhstan',
          'Pitched at nFactorial Incubator ’26 demo day, Almaty',
          '~200 clients, 2 signed companies',
        ],
      },
      {
        t: 'stack',
        items: ['Python', 'FastAPI', 'Postgres + pgvector', 'Redis / ARQ', 'React 19', 'TanStack'],
      },
      { t: 'gap' },

      { t: 'h', text: 'RiseFaceit', sub: 'Telegram mini-app system' },
      {
        t: 'p',
        text:
          'Joined a friend’s project and built the mini-app system behind it. First product with real users and real money: 10,000 users.',
      },
      { t: 'gap' },

      { t: 'h', text: 'RookieAI', sub: 'first project, non-commercial' },
      {
        t: 'p',
        text:
          'An AI copilot for picking a university, aimed at IB and A-Level students. No revenue, no plan — the one I built to find out whether I could.',
      },
      { t: 'gap' },

      { t: 'h', text: 'makimum.dev', sub: 'this site' },
      {
        t: 'p',
        text:
          `This site, and the room it is made of. Procedural geometry, no purchased assets, no GLB files. Global illumination path-traced in the browser; the sky outside is the real Helsinki sky, computed from the sun’s actual position. ${fmt(FACTS.triangles)} triangles, ${FACTS.bundleKB} KB gzipped.`,
      },
    ],
    aside: [
      { t: 'kicker', text: 'Before the products' },
      {
        t: 'p',
        text:
          '100+ crypto projects as an ambassador and drop hunter, inside one of the largest Russian-speaking Web3 communities. It paid, and it taught me that the part I liked was building the bots — not the money.',
      },
      { t: 'gap' },

      { t: 'kicker', text: 'Education' },
      {
        t: 'bullets',
        items: [
          'IB Programme — in progress',
          'University of Oulu via FITech — Programming Basics, Programming Advanced',
        ],
      },
      { t: 'gap' },

      { t: 'kicker', text: 'Mathematics' },
      {
        t: 'bullets',
        items: [
          'CEESA Math Competition — three years running',
          'Countdown round — twice',
          '3rd place, team standings',
        ],
      },
      { t: 'gap' },

      { t: 'kicker', text: 'Take it with you' },
      // Тот же текст, что на этом экране, но файлом: собирается из
      // docs/resume.md той же командой, что и всё остальное в docs/.
      // Лежит в public/, поэтому в стартовую загрузку не входит.
      { t: 'link', label: 'Download the PDF', href: '/Maxim_Fursov_CV_EN.pdf' },
      { t: 'gap' },

      { t: 'kicker', text: 'Contact' },
      { t: 'link', label: 'maxfurs2008@gmail.com', href: 'mailto:maxfurs2008@gmail.com' },
      { t: 'link', label: 'github.com/Makimum', href: 'https://github.com/Makimum' },
      { t: 'link', label: 'x.com/makimum_dev', href: 'https://x.com/makimum_dev' },
      { t: 'link', label: 'vetta-x.com', href: 'https://vetta-x.com' },
    ],
  },
  }
}

let cache: Record<string, Doc> | null = null

/** Документы по требованию, один раз. */
export function getDoc(id: string): Doc | undefined {
  if (!cache) cache = buildDocs()
  return cache[id]
}

export function allDocIds(): string[] {
  if (!cache) cache = buildDocs()
  return Object.keys(cache)
}

/**
 * Единственный вызывающий — main.ts, сразу после того как сцена честно
 * посчитала свои треугольники.
 *
 * Без этого сброса кэш достаётся раньше и не тому: `entry.ts` строит скрытое
 * дерево страницы (`mountContent()`) синхронно, а импорт сцены ждёт двух
 * кадров, — и первый же вызов getDoc() успевает запечатать кэш со значением
 * FACTS.triangles ПО УМОЛЧАНИЮ, до всякого замера. Дальше `cache` —
 * модульный синглтон: значение застыло бы навсегда, и панели комнаты
 * (paint.ts читает getDoc() тем же кэшем лениво, по клику) показывали бы
 * устаревшую константу, даже когда main.ts уже посчитал настоящее число.
 * Сегодня это не видно, потому что константа и замер совпадают — ровно так
 * уже пряталось расхождение, которое чинили отдельной правкой (см.
 * main.ts, комментарий у countTriangles).
 *
 * Дерево страницы (`#content`), которое `mountContent()` успел построить ДО
 * этого сброса, несёт то же протухшее число ОТДЕЛЬНЫМ узлом — сброс кэша
 * его не трогает. Поэтому в `main.ts` следующей же строкой стоит
 * `mountContent(true)`: эти два вызова — пара, и снимать пересборку нельзя.
 * Без неё расхождение не исчезает, а переезжает из кэша в DOM.
 *
 * «Это же всё равно никто не увидит» — неверно, и проверять не надо: из
 * комнаты выходят крестиком, после чего то самое дерево и есть страница,
 * которую посетитель читает глазами. На десктопе тоже.
 */
export function resetDocCache() {
  cache = null
}

/* ------------------------------------------------------------------ */
/* Питч-дека VettaX                                                    */
/* ------------------------------------------------------------------ */

/**
 * Шесть слайдов — та же дека, что печаталась в PDF для организаторов
 * nFactorial. Текст перенесён из интерактивной версии
 * (~/Downloads/Pitch_deck_vettax/VettaX_Pitch_standalone), не пересказан.
 *
 * Слайды РИСУЮТСЯ, а не подкладываются картинками: 6 страниц PDF — это
 * ~2.5 МБ в бандле, где сейчас нет ни одного байта ассетов. Дека в коде
 * весит килобайты и остаётся резкой при любом подлёте камеры.
 */
export interface Slide {
  kicker: string
  headline: string
  sub?: string
  body?: string
  numbered?: { n: string; title: string; text: string }[]
  metrics?: { value: string; label: string }[]
  bullets?: string[]
  foot?: string[]
  cta?: string
}

export const DECK: Slide[] = [
  {
    kicker: 'Vetta X',
    headline: 'Your AI growth agent for X',
    sub: 'Grow on X without living on X.',
    body:
      'An AI agent that lives in your X account — watches the right creators, drafts replies in your voice, ships posts in one tap.',
    foot: ['vetta-x.com · @makimum_dev'],
  },
  {
    kicker: 'The problem',
    headline: 'Growing on X is a full-time job. You already have one.',
    numbered: [
      {
        n: '01',
        title: 'Winning a thread is a 90-second game',
        text: 'By the time you see the post, the reply window that decides reach is already gone.',
      },
      {
        n: '02',
        title: 'Consistency burns founders out',
        text: 'Posting and replying well means 2–3 hours a day, every day.',
      },
      {
        n: '03',
        title: 'Generic AI gets ignored',
        text: "ChatGPT-sounding replies read as spam, and ghostwriters don't sound like you.",
      },
    ],
  },
  {
    kicker: 'Traction — first 30 days',
    headline: 'Built in a month. Already growing.',
    metrics: [
      { value: '379', label: 'active users (30d)' },
      { value: '+37,800%', label: 'growth' },
      { value: '$202', label: 'first revenue' },
      { value: '95', label: 'Peerlist upvotes' },
    ],
    foot: [
      '200+ sign-ups · 2 companies signed · 39K views on the launch post',
      'Most active users · @jonathan_aufray (126K) · @edinsoncode (40K) · @S_Rao4U (17K) · @OrieanResearch · @Validate_QA',
    ],
  },
  {
    kicker: 'Live product — no mockups',
    headline: 'Reply Alerts → three angles in my voice → posted on X in one tap.',
    body:
      'The demo is the product, running: the agent watches the accounts you picked, drafts three angles in your voice, and publishes only when you confirm.',
  },
  {
    kicker: "Who's building this",
    headline: 'Maksim Fursov — founder',
    sub: '@makimum_dev',
    bullets: [
      'Built VettaX in 1 month after a full pivot — design, code, launch.',
      "3rd place at Kazakhstan's largest AI-cybersecurity hackathon (AFM AI Hackathon, Almaty) — 300,000 ₸ prize.",
      'Launched on Peerlist Launchpad — featured, 95 upvotes; Product Hunt launch live.',
      'Launch content: 39K views on X, 14.4K on video — all organic, $0 ad spend.',
    ],
  },
  {
    kicker: 'Start now',
    headline: 'Your next 1,000 followers are in the next 100 replies.',
    body: 'Start free in 30 seconds — no card.',
    cta: 'Continue with X → vetta-x.com',
    foot: ['Launch code MAKIMUM2026 — 3-day Pro trial'],
  },
]

/** Короткие названия слайдов для боковой колонки на широком экране. */
export const DECK_INDEX = [
  'Cover',
  'Problem',
  'Traction',
  'Live product',
  'Founder',
  'Start now',
]
