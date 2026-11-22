// Bless avatars: every team member builds their own character. Pure SVG strings, no images.
// A config is a small flat object of strings (see DEFAULT). avatarSVG(cfg, {view}) draws it.

export const PAL = {
  skin: ['#FFE3D3', '#F7CFAF', '#EBB893', '#D69C72', '#B97C53', '#8E5B3B', '#5F3B27'],
  hair: ['#1F1A1C', '#3B2620', '#6B4130', '#8E4A2A', '#A5432F', '#D9B26A', '#EDE0C8', '#9C9A9E', '#D88BA8', '#7E4C9E'],
  eye: ['#5A3A24', '#2A1C14', '#8A6A2E', '#4E7A4A', '#4A78A8', '#7C8794'],
  cloth: ['#D98A96', '#6E3F7E', '#F2B8B0', '#B79AD8', '#F3E6D8', '#2A1F27', '#F7F3F5', '#2E3B63', '#6E7A4A', '#D9A441', '#2F7F7A', '#C2413B'],
  lips: ['', '#C9727E', '#B5304A', '#8E2F5A', '#C98A73'],
  bg: { rose: ['#F4CBC1', '#C9A0DC'], peach: ['#FFD9B8', '#F4A99A'], lilac: ['#E9DCFF', '#B79AD8'], mint: ['#D3F1E6', '#8FCFC0'], sky: ['#D3E5FF', '#93B5E8'], gold: ['#FFE9AE', '#F2B866'], plum: ['#8A5AA8', '#3A1F4E'], none: null },
};

// Every choice the maker offers, in display order. Labels are what people see.
export const OPTS = {
  g: [['f', 'Female'], ['m', 'Male']],
  face: [['oval', 'Oval'], ['round', 'Round'], ['square', 'Square'], ['heart', 'Heart']],
  eyes: [['normal', 'Classic'], ['big', 'Big'], ['almond', 'Almond'], ['lashes', 'Lashes'], ['dots', 'Dots'], ['happy', 'Happy'], ['calm', 'Calm'], ['wink', 'Wink']],
  brows: [['natural', 'Natural'], ['thick', 'Thick'], ['arched', 'Arched'], ['raised', 'Raised'], ['focused', 'Focused'], ['none', 'None']],
  nose: [['button', 'Button'], ['line', 'Line'], ['wide', 'Wide'], ['pointy', 'Pointy'], ['dots', 'Small']],
  mouth: [['smile', 'Smile'], ['grin', 'Grin'], ['small', 'Soft'], ['laugh', 'Laugh'], ['smirk', 'Smirk'], ['neutral', 'Neutral'], ['tongue', 'Cheeky']],
  cheeks: [['none', 'None'], ['blush', 'Blush'], ['freckles', 'Freckles'], ['both', 'Both']],
  hair: [['short', 'Short'], ['side', 'Side part'], ['quiff', 'Quiff'], ['buzz', 'Buzz'], ['curly', 'Curly'], ['afro', 'Afro'], ['pixie', 'Pixie'], ['bob', 'Bob'], ['long', 'Long'], ['wavy', 'Wavy'], ['bun', 'Bun'], ['pony', 'Ponytail'], ['bald', 'Bald']],
  stache: [['none', 'None'], ['thin', 'Thin'], ['chevron', 'Chevron'], ['handlebar', 'Handlebar'], ['pencil', 'Pencil'], ['walrus', 'Walrus']],
  beard: [['none', 'None'], ['stubble', 'Stubble'], ['short', 'Short'], ['full', 'Full'], ['goatee', 'Goatee']],
  outfit: [['tee', 'T-shirt'], ['vneck', 'V-neck'], ['hoodie', 'Hoodie'], ['shirt', 'Shirt'], ['blazer', 'Blazer'], ['turtle', 'Turtleneck'], ['top', 'Strap top']],
  glasses: [['none', 'None'], ['round', 'Round'], ['square', 'Square'], ['cat', 'Cat-eye'], ['sun', 'Sunglasses']],
  ears: [['none', 'None'], ['studs', 'Studs'], ['hoops', 'Hoops']],
  head: [['none', 'None'], ['hijab', 'Hijab'], ['cap', 'Cap'], ['beanie', 'Beanie']],
  bg: Object.keys(PAL.bg).map((k) => [k, k[0].toUpperCase() + k.slice(1)]),
};
export const COLORS = { skin: PAL.skin, hairC: PAL.hair, eyeC: PAL.eye, outC: PAL.cloth, headC: PAL.cloth, lips: PAL.lips };

export const DEFAULT = { g: 'f', skin: PAL.skin[2], face: 'oval', eyes: 'normal', eyeC: PAL.eye[0], brows: 'natural', nose: 'button', mouth: 'smile', lips: '', cheeks: 'blush', hair: 'long', hairC: PAL.hair[1], stache: 'none', beard: 'none', outfit: 'blazer', outC: PAL.cloth[0], glasses: 'none', ears: 'none', head: 'none', headC: PAL.cloth[3], bg: 'rose' };
const KEYS = Object.keys(DEFAULT);

/** Keep only known keys with known values, so anything saved or received draws safely. */
export function cleanAvatar(a) {
  const o = { ...DEFAULT };
  if (!a || typeof a !== 'object') return o;
  for (const k of KEYS) {
    const v = a[k]; if (typeof v !== 'string') continue;
    if (OPTS[k] ? OPTS[k].some(([x]) => x === v) : (COLORS[k] && COLORS[k].includes(v))) o[k] = v;
  }
  return o;
}

const pick = (a) => a[Math.floor(Math.random() * a.length)];
const pickK = (k) => pick(OPTS[k])[0];
export function randomAvatar(g) {
  g = g || pick(['f', 'm']);
  const f = g === 'f';
  const hair = f ? pick(['long', 'wavy', 'bob', 'bun', 'pony', 'pixie', 'curly', 'afro']) : pick(['short', 'side', 'quiff', 'buzz', 'curly', 'afro', 'bald', 'short', 'side']);
  return {
    g, skin: pick(PAL.skin), face: pickK('face'), eyes: f ? pick(['normal', 'big', 'almond', 'lashes', 'happy']) : pick(['normal', 'big', 'almond', 'dots', 'happy', 'calm']),
    eyeC: pick(PAL.eye), brows: pick(['natural', 'thick', 'arched', 'raised', 'natural']), nose: pickK('nose'), mouth: pick(['smile', 'grin', 'small', 'laugh', 'smirk', 'smile']),
    lips: f && Math.random() < 0.5 ? pick(PAL.lips.slice(1)) : '', cheeks: pickK('cheeks'), hair, hairC: pick(PAL.hair.slice(0, 8)),
    stache: !f && Math.random() < 0.45 ? pick(['thin', 'chevron', 'handlebar', 'pencil', 'walrus']) : 'none',
    beard: !f && Math.random() < 0.5 ? pick(['stubble', 'short', 'full', 'goatee']) : 'none',
    outfit: f ? pickK('outfit') : pick(['tee', 'vneck', 'hoodie', 'shirt', 'blazer', 'turtle']), outC: pick(PAL.cloth),
    glasses: Math.random() < 0.3 ? pick(['round', 'square', 'cat', 'sun']) : 'none', ears: f && Math.random() < 0.5 ? pick(['studs', 'hoops']) : 'none',
    head: f && Math.random() < 0.3 ? 'hijab' : (Math.random() < 0.1 ? pick(['cap', 'beanie']) : 'none'), headC: pick(PAL.cloth), bg: pick(['rose', 'peach', 'lilac', 'mint', 'sky', 'gold']),
  };
}

// colour helpers
function mix(hex, to, t) {
  const h = (hex || '#000000').replace('#', ''), n = parseInt(h.length === 3 ? h.replace(/./g, '$&$&') : h, 16);
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => Math.round(v + (to - v) * t));
  return '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');
}
const dk = (h, t = 0.18) => mix(h, 0, t), lt = (h, t = 0.25) => mix(h, 255, t);

const FACES = {
  oval: { w: 40, d: '<ellipse cx="100" cy="90" rx="40" ry="48"/>' },
  round: { w: 45, d: '<ellipse cx="100" cy="92" rx="45" ry="45"/>' },
  square: { w: 42, d: '<rect x="58" y="44" width="84" height="94" rx="28"/>' },
  heart: { w: 43, d: '<path d="M57 84 Q57 42 100 42 Q143 42 143 84 Q143 118 100 138 Q57 118 57 84Z"/>' },
};
// where a view is zoomed for the option thumbnails
const VIEWS = { full: '0 0 200 200', head: '22 8 156 156', face: '52 62 96 76', eyes: '62 70 76 44', mouth: '72 98 56 42', lower: '50 90 100 80', body: '14 112 172 88' };

let uid = 0;
/** SVG markup for one avatar. opts.view: full | head | face | eyes | mouth | lower | body. opts.title: accessible name. */
export function avatarSVG(raw, opts = {}) {
  const a = cleanAvatar(raw), id = 'av' + (++uid), F = FACES[a.face];
  const skin = a.skin, skinD = dk(skin, 0.14), skinDD = dk(skin, 0.3), hc = a.hairC, hcD = dk(hc, 0.25), oc = a.outC, ocD = dk(oc, 0.2), ocL = lt(oc, 0.2);
  const hij = a.head === 'hijab', cover = a.head === 'cap' || a.head === 'beanie', fem = a.g === 'f';
  const ink = '#2B1B24', mouthC = a.lips || '#7A2E3A';
  const s = [];
  const bg = PAL.bg[a.bg];
  s.push(`<defs><linearGradient id="${id}g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${bg ? bg[0] : '#000'}"/><stop offset="1" stop-color="${bg ? bg[1] : '#000'}"/></linearGradient><clipPath id="${id}c"><rect width="200" height="200"/></clipPath></defs>`);
  if (bg) s.push(`<rect width="200" height="200" fill="url(#${id}g)"/><circle cx="160" cy="40" r="46" fill="#fff" opacity=".12"/>`);
  s.push(`<g clip-path="url(#${id}c)">`);

  // ---- back layers: long hair, afro, ponytail, bun, hood, hijab drape
  if (!hij) {
    const back = {
      long: `<path d="M46 172 Q36 40 100 32 Q164 40 154 172 Q128 180 100 178 Q72 180 46 172Z"/>`,
      wavy: `<path d="M46 158 Q34 40 100 32 Q166 40 154 158 Q162 170 150 178 Q140 170 128 178 Q114 171 100 178 Q86 171 72 178 Q60 170 50 178 Q38 170 46 158Z"/>`,
      bob: `<path d="M48 130 Q40 40 100 32 Q160 40 152 130 Q128 138 100 134 Q72 138 48 130Z"/>`,
      afro: `<circle cx="100" cy="80" r="62"/>${[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((i) => { const t = (i / 12) * Math.PI * 2; return `<circle cx="${(100 + Math.cos(t) * 58).toFixed(1)}" cy="${(80 + Math.sin(t) * 58).toFixed(1)}" r="14"/>`; }).join('')}`,
      pony: `<path d="M128 52 Q176 58 164 132 Q160 150 150 158 Q154 128 146 104 Q140 84 128 72Z"/>`,
      bun: `<circle cx="100" cy="30" r="19"/>`,
      curly: fem ? `<path d="M50 128 Q40 44 100 34 Q160 44 150 128 Q100 140 50 128Z"/>${[56, 70, 86, 114, 130, 144].map((x, i) => `<circle cx="${x}" cy="${126 + (i % 2) * 4}" r="12"/>`).join('')}` : '',
    }[a.hair];
    if (back && a.hair !== 'bald') s.push(`<g fill="${hcD}">${back}</g>`);
  }
  if (a.outfit === 'hoodie') s.push(`<path d="M60 160 Q64 126 100 128 Q136 126 140 160Z" fill="${ocD}"/>`);
  if (hij) s.push(`<path d="M100 28 Q152 28 156 88 Q158 128 142 150 Q170 160 182 200 L18 200 Q30 160 58 150 Q42 128 44 88 Q48 28 100 28Z" fill="${dk(a.headC, 0.12)}"/>`);

  // ---- body and outfit
  const bodyD = fem ? 'M36 200 Q38 164 66 154 Q84 148 100 148 Q116 148 134 154 Q162 164 164 200Z' : 'M26 200 Q28 160 60 152 Q80 146 100 146 Q120 146 140 152 Q172 160 174 200Z';
  s.push(`<rect x="88" y="118" width="24" height="36" rx="8" fill="${skinD}"/>`);
  if (a.outfit === 'top') {
    s.push(`<path d="${bodyD}" fill="${skin}"/><path d="M${fem ? 50 : 42} 200 Q${fem ? 54 : 46} 172 72 166 L78 151 L83 151 L86 164 Q100 172 114 164 L117 151 L122 151 L128 166 Q${fem ? 146 : 154} 172 ${fem ? 150 : 158} 200Z" fill="${oc}"/>`);
  } else {
    s.push(`<path d="${bodyD}" fill="${oc}"/>`);
    if (a.outfit === 'tee') s.push(`<path d="M86 148 Q100 166 114 148" fill="${skinD}" stroke="${ocD}" stroke-width="3"/>`);
    if (a.outfit === 'vneck') s.push(`<path d="M86 148 L100 172 L114 148Z" fill="${skinD}" stroke="${ocD}" stroke-width="3" stroke-linejoin="round"/>`);
    if (a.outfit === 'hoodie') s.push(`<path d="M84 148 Q100 168 116 148" fill="${skinD}" stroke="${ocD}" stroke-width="4"/><path d="M93 162 L91 186 M107 162 L109 186" stroke="${lt(oc, 0.6)}" stroke-width="2.5" stroke-linecap="round"/><circle cx="91" cy="187" r="2.4" fill="${lt(oc, 0.6)}"/><circle cx="109" cy="187" r="2.4" fill="${lt(oc, 0.6)}"/><path d="M60 200 L64 182 M140 200 L136 182" stroke="${ocD}" stroke-width="2" opacity=".5"/>`);
    if (a.outfit === 'shirt') s.push(`<path d="M90 148 L100 162 L110 148Z" fill="${skinD}"/><path d="M86 146 L100 163 L93 172 L80 153Z M114 146 L100 163 L107 172 L120 153Z" fill="${ocL}" stroke="${ocD}" stroke-width="1.5" stroke-linejoin="round"/>${[176, 188].map((y) => `<circle cx="100" cy="${y}" r="2" fill="${ocD}"/>`).join('')}`);
    if (a.outfit === 'blazer') s.push(`<path d="M84 148 L100 200 L116 148Z" fill="#F7F3F5"/><path d="M90 148 L100 160 L110 148Z" fill="${skinD}"/><path d="M84 147 L100 196 L95 168 L72 158Z M116 147 L100 196 L105 168 L128 158Z" fill="${ocD}"/><circle cx="104" cy="190" r="2.2" fill="${dk(oc, 0.4)}"/>`);
    if (a.outfit === 'turtle') s.push(`<rect x="85" y="134" width="30" height="20" rx="8" fill="${ocL}"/>${[90, 95, 100, 105, 110].map((x) => `<path d="M${x} 137 V151" stroke="${oc}" stroke-width="1.4"/>`).join('')}`);
  }
  if (hij) s.push(`<path d="M58 150 Q76 160 100 160 Q124 160 142 150 Q150 170 138 178 Q120 170 100 170 Q80 170 62 178 Q50 170 58 150Z" fill="${a.headC}"/>`);

  // ---- head
  s.push(`<ellipse cx="100" cy="132" rx="16" ry="6" fill="${skinDD}" opacity=".35"/>`);
  if (!hij) {
    const ex = F.w + 1;
    s.push(`<g fill="${skin}"><circle cx="${100 - ex}" cy="96" r="9"/><circle cx="${100 + ex}" cy="96" r="9"/></g><g fill="none" stroke="${skinD}" stroke-width="2" stroke-linecap="round"><path d="M${100 - ex + 3} 92 Q${100 - ex - 2} 96 ${100 - ex + 3} 100"/><path d="M${100 + ex - 3} 92 Q${100 + ex + 2} 96 ${100 + ex - 3} 100"/></g>`);
  }
  s.push(`<g fill="${skin}">${F.d}</g>`);
  if (hij) s.push(`<path d="M56 86 Q56 38 100 36 Q144 38 144 86 Q146 120 128 140 L134 146 Q120 150 100 150 Q80 150 66 146 L72 140 Q54 120 56 86Z M60 88 Q62 52 100 50 Q138 52 140 88 Q140 122 100 140 Q60 122 60 88Z" fill="${a.headC}" fill-rule="evenodd"/><path d="M60 88 Q62 52 100 50 Q138 52 140 88" fill="none" stroke="${dk(a.headC, 0.15)}" stroke-width="2"/>`);

  // cheeks
  if (a.cheeks === 'blush' || a.cheeks === 'both') s.push(`<g fill="#F08A9A" opacity=".35"><ellipse cx="76" cy="111" rx="8" ry="5"/><ellipse cx="124" cy="111" rx="8" ry="5"/></g>`);
  if (a.cheeks === 'freckles' || a.cheeks === 'both') s.push(`<g fill="${skinDD}" opacity=".55">${[[74, 104], [80, 108], [72, 110], [78, 113], [126, 104], [120, 108], [128, 110], [122, 113]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="1.3"/>`).join('')}</g>`);

  // beard sits under the mouth line
  const beard = {
    stubble: `<path d="M58 94 Q58 146 100 146 Q142 146 142 94 Q138 116 126 122 Q114 132 100 132 Q86 132 74 122 Q62 116 58 94Z" opacity=".28"/>`,
    short: `<path d="M57 90 Q56 148 100 150 Q144 148 143 90 Q138 112 128 118 Q116 130 100 130 Q84 130 72 118 Q62 112 57 90Z"/>`,
    full: `<path d="M55 86 Q52 166 100 170 Q148 166 145 86 Q140 112 128 118 Q116 131 100 131 Q84 131 72 118 Q60 112 55 86Z"/>`,
    goatee: `<path d="M89 129 Q100 150 111 129 Q100 134 89 129Z"/>`,
  }[a.beard];
  if (beard) s.push(`<g fill="${hc}">${beard}</g>`);

  // eyes
  const eye = (x, kind, flip) => {
    const t = `translate(${x} 92)${flip ? ' scale(-1 1)' : ''}`;
    const iris = (r, ir) => `<circle r="${r}" fill="#fff"/><circle cx="0.5" cy="0.6" r="${ir}" fill="${a.eyeC}"/><circle cx="0.5" cy="0.6" r="${(ir * 0.52).toFixed(2)}" fill="${ink}"/><circle cx="-1.4" cy="-1.6" r="${(ir * 0.3).toFixed(2)}" fill="#fff"/>`;
    switch (kind) {
      case 'big': return `<g transform="${t}">${iris(9, 6.2)}</g>`;
      case 'almond': return `<g transform="${t}"><clipPath id="${id}e${x}"><path d="M-9 0 Q0 -8 9 0 Q0 7 -9 0Z"/></clipPath><path d="M-9 0 Q0 -8 9 0 Q0 7 -9 0Z" fill="#fff"/><g clip-path="url(#${id}e${x})"><circle cx="0.5" cy="0" r="4.6" fill="${a.eyeC}"/><circle cx="0.5" cy="0" r="2.4" fill="${ink}"/><circle cx="-1" cy="-1.5" r="1.2" fill="#fff"/></g><path d="M-9 0 Q0 -8 9 0" fill="none" stroke="${ink}" stroke-width="1.8" stroke-linecap="round"/></g>`;
      case 'lashes': return `<g transform="${t}">${iris(7.5, 4.6)}<path d="M-7.5 -1 Q0 -9 7.5 -1" fill="none" stroke="${ink}" stroke-width="2" stroke-linecap="round"/><path d="M-6 -4 L-9.5 -7 M-3 -6 L-5 -10 M1 -6.8 L0.5 -11" stroke="${ink}" stroke-width="1.6" stroke-linecap="round"/></g>`;
      case 'dots': return `<g transform="${t}"><ellipse rx="3.6" ry="4.6" fill="${ink}"/><circle cx="-1" cy="-1.6" r="1.2" fill="#fff"/></g>`;
      case 'happy': return `<g transform="${t}"><path d="M-7 2 Q0 -7 7 2" fill="none" stroke="${ink}" stroke-width="3" stroke-linecap="round"/></g>`;
      case 'calm': return `<g transform="${t}"><path d="M-7 -1 Q0 6 7 -1" fill="none" stroke="${ink}" stroke-width="3" stroke-linecap="round"/></g>`;
      default: return `<g transform="${t}">${iris(7.5, 4.6)}</g>`;
    }
  };
  s.push(eye(83, a.eyes === 'wink' ? 'normal' : a.eyes, false), eye(117, a.eyes === 'wink' ? 'happy' : a.eyes, true));

  // brows (drawn for the left eye, mirrored for the right; inner end is +x)
  const brow = {
    natural: ['M-9 2 Q0 -3 9 0', 3], thick: ['M-9 2 Q0 -4 9 0', 5], arched: ['M-9 3 Q-2 -5 9 1', 2.2], raised: ['M-9 -2 Q0 -8 9 -4', 3], focused: ['M-9 -2 Q0 -2 9 3', 3.4],
  }[a.brows];
  if (brow && !(hij && false)) {
    const bc = a.hair === 'bald' || cover ? dk(skin, 0.45) : hcD;
    s.push(`<g fill="none" stroke="${bc}" stroke-width="${brow[1]}" stroke-linecap="round"><path transform="translate(83 78)" d="${brow[0]}"/><path transform="translate(117 78) scale(-1 1)" d="${brow[0]}"/></g>`);
  }

  // nose
  s.push({
    button: `<ellipse cx="100" cy="106" rx="5" ry="3.6" fill="${skinD}"/><ellipse cx="98.5" cy="105" rx="1.6" ry="1" fill="#fff" opacity=".35"/>`,
    line: `<path d="M101 95 Q95 107 101 110" fill="none" stroke="${skinDD}" stroke-width="2.4" stroke-linecap="round"/>`,
    wide: `<path d="M91 107 Q94 112 100 111 Q106 112 109 107" fill="none" stroke="${skinDD}" stroke-width="2.4" stroke-linecap="round"/><circle cx="96" cy="108" r="1.3" fill="${skinDD}"/><circle cx="104" cy="108" r="1.3" fill="${skinDD}"/>`,
    pointy: `<path d="M100 94 L94 109 L102 110" fill="none" stroke="${skinDD}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>`,
    dots: `<circle cx="97" cy="107" r="1.5" fill="${skinDD}"/><circle cx="103" cy="107" r="1.5" fill="${skinDD}"/>`,
  }[a.nose]);

  // mouth
  const lw = a.lips ? 3.6 : 3;
  s.push({
    smile: `<path d="M88 118 Q100 130 112 118" fill="none" stroke="${mouthC}" stroke-width="${lw}" stroke-linecap="round"/>`,
    grin: `<path d="M86 116 Q100 136 114 116Z" fill="#5A1F2C" stroke="${mouthC}" stroke-width="2" stroke-linejoin="round"/><path d="M88 117 L112 117 L110 121 Q100 123 90 121Z" fill="#fff"/>`,
    small: `<path d="M94 120 Q100 125 106 120" fill="none" stroke="${mouthC}" stroke-width="${lw}" stroke-linecap="round"/>`,
    laugh: `<path d="M88 116 Q100 116 112 116 Q110 134 100 134 Q90 134 88 116Z" fill="#5A1F2C" stroke="${mouthC}" stroke-width="2" stroke-linejoin="round"/><path d="M93 129 Q100 124 107 129 Q104 133 100 133 Q96 133 93 129Z" fill="#F07C8C"/>`,
    smirk: `<path d="M90 122 Q102 126 112 116" fill="none" stroke="${mouthC}" stroke-width="${lw}" stroke-linecap="round"/>`,
    neutral: `<path d="M92 122 L108 122" fill="none" stroke="${mouthC}" stroke-width="${lw}" stroke-linecap="round"/>`,
    tongue: `<path d="M98 122 Q104 132 110 122Z" fill="#F07C8C"/><path d="M88 118 Q100 128 112 118" fill="none" stroke="${mouthC}" stroke-width="${lw}" stroke-linecap="round"/>`,
  }[a.mouth]);

  // moustache over the mouth
  const st = {
    thin: `<path d="M88 116 Q100 109 112 116 Q100 113 88 116Z"/>`,
    chevron: `<path d="M85 118 Q90 107 100 111 Q110 107 115 118 Q100 114 85 118Z"/>`,
    handlebar: `<path d="M78 108 Q82 120 92 115 Q100 110 108 115 Q118 120 122 108 Q120 119 108 119.5 Q100 115 92 119.5 Q80 119 78 108Z"/>`,
    pencil: `<path d="M90 114.5 Q100 112 110 114.5" fill="none" stroke="${hc}" stroke-width="2" stroke-linecap="round"/>`,
    walrus: `<path d="M82 120 Q84 106 100 110 Q116 106 118 120 Q114 116 110 122 Q106 117 100 121 Q94 117 90 122 Q86 116 82 120Z"/>`,
  }[a.stache];
  if (st) s.push(`<g fill="${hc}">${st}</g>`);

  // front hair
  if (!hij) {
    const front = {
      short: 'M56 88 Q50 38 100 33 Q150 38 144 88 Q140 62 124 55 Q104 66 76 57 Q62 64 56 88Z',
      side: 'M55 92 Q47 34 100 31 Q153 35 145 90 Q143 60 130 51 Q102 48 74 64 Q62 70 55 92Z',
      quiff: 'M57 86 Q51 44 84 33 Q94 15 124 24 Q151 34 144 86 Q140 60 126 53 Q100 58 76 55 Q62 62 57 86Z',
      buzz: 'M58 78 Q60 40 100 38 Q140 40 142 78 Q132 56 100 54 Q68 56 58 78Z',
      pixie: 'M56 90 Q49 34 106 33 Q151 37 144 82 Q135 58 112 60 Q90 72 68 64 Q60 74 56 90Z',
      bob: 'M56 86 Q53 38 100 35 Q147 38 144 86 Q130 64 100 63 Q70 64 56 86Z',
      long: 'M56 98 Q49 37 100 33 Q151 37 144 98 Q138 63 104 51 L100 49 L96 51 Q62 63 56 98Z',
      wavy: 'M56 98 Q48 36 102 33 Q152 38 144 98 Q140 66 118 54 Q96 66 72 60 Q60 74 56 98Z',
      bun: 'M57 82 Q56 42 100 40 Q144 42 143 82 Q136 58 100 54 Q64 58 57 82Z',
      pony: 'M57 82 Q56 42 100 40 Q144 42 143 82 Q136 58 100 54 Q64 58 57 82Z',
      afro: '',
      curly: '',
      bald: '',
    }[a.hair];
    if (cover) {
      // only the hair that shows below the hat
      if (['long', 'wavy', 'bob', 'curly', 'pony', 'side', 'short', 'pixie', 'quiff'].includes(a.hair)) s.push(`<path d="M56 94 Q56 70 62 66 L70 70 Q64 80 64 96Z M144 94 Q144 70 138 66 L130 70 Q136 80 136 96Z" fill="${hc}"/>`);
    } else if (front) s.push(`<path d="${front}" fill="${hc}"/><path d="${front}" fill="none" stroke="${hcD}" stroke-width="1.2" opacity=".5"/>`);
    if (!cover && a.hair === 'curly') s.push(`<g fill="${hc}"><path d="M56 84 Q54 40 100 36 Q146 40 144 84 Q120 64 100 64 Q80 64 56 84Z"/>${[[60, 72], [66, 56], [78, 44], [93, 38], [108, 38], [122, 44], [134, 56], [140, 72], [76, 60], [92, 54], [108, 54], [124, 60]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="10"/>`).join('')}</g>`);
    if (!cover && a.hair === 'afro') s.push(`<g fill="${hc}"><path d="M54 86 Q50 34 100 30 Q150 34 146 86 Q124 62 100 62 Q76 62 54 86Z"/>${[[60, 70], [70, 52], [86, 40], [100, 36], [114, 40], [130, 52], [140, 70]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="12"/>`).join('')}</g>`);
    if (!cover && a.hair === 'bun') s.push(`<circle cx="100" cy="30" r="17" fill="${hc}"/><path d="M88 40 Q100 46 112 40" stroke="${hcD}" stroke-width="2" fill="none"/>`);
    if (!cover && a.hair === 'pony') s.push(`<rect x="124" y="54" width="10" height="8" rx="3" fill="${a.outC}" transform="rotate(30 129 58)"/>`);
  }

  // earrings (hidden by a hijab)
  if (!hij && a.ears !== 'none') {
    const ex = F.w + 1, gold = '#E2B44F';
    s.push(a.ears === 'studs' ? `<g fill="${gold}"><circle cx="${100 - ex}" cy="105" r="2.6"/><circle cx="${100 + ex}" cy="105" r="2.6"/></g>` : `<g fill="none" stroke="${gold}" stroke-width="2.2"><circle cx="${100 - ex}" cy="110" r="5.5"/><circle cx="${100 + ex}" cy="110" r="5.5"/></g>`);
  }

  // glasses
  const gl = {
    round: `<g fill="#fff" fill-opacity=".12" stroke="${ink}" stroke-width="2.6"><circle cx="83" cy="92" r="11"/><circle cx="117" cy="92" r="11"/></g><path d="M94 91 Q100 87 106 91 M72 90 L60 86 M128 90 L140 86" stroke="${ink}" stroke-width="2.4" fill="none" stroke-linecap="round"/>`,
    square: `<g fill="#fff" fill-opacity=".12" stroke="${ink}" stroke-width="2.6"><rect x="70" y="83" width="26" height="19" rx="5"/><rect x="104" y="83" width="26" height="19" rx="5"/></g><path d="M96 90 L104 90 M70 88 L60 85 M130 88 L140 85" stroke="${ink}" stroke-width="2.4" fill="none" stroke-linecap="round"/>`,
    cat: `<g fill="#fff" fill-opacity=".12" stroke="${ink}" stroke-width="2.6" stroke-linejoin="round"><path d="M68 84 Q82 82 96 86 Q96 100 84 101 Q72 101 70 92Z"/><path d="M132 84 Q118 82 104 86 Q104 100 116 101 Q128 101 130 92Z"/></g><path d="M96 89 Q100 86 104 89 M68 84 L62 80 M132 84 L138 80" stroke="${ink}" stroke-width="2.4" fill="none" stroke-linecap="round"/>`,
    sun: `<g fill="#241820" stroke="${ink}" stroke-width="2.4"><rect x="69" y="84" width="28" height="18" rx="8"/><rect x="103" y="84" width="28" height="18" rx="8"/></g><path d="M74 88 L82 88 M108 88 L116 88" stroke="#fff" stroke-opacity=".35" stroke-width="2.4" stroke-linecap="round"/><path d="M97 90 L103 90 M69 89 L60 86 M131 89 L140 86" stroke="${ink}" stroke-width="2.4" fill="none" stroke-linecap="round"/>`,
  }[a.glasses];
  if (gl) s.push(gl);

  // hats
  if (a.head === 'cap') s.push(`<path d="M55 76 Q54 30 100 28 Q146 30 145 76 Q100 66 55 76Z" fill="${a.headC}"/><path d="M55 76 Q100 64 145 76 Q150 80 168 84 Q150 90 128 84 Q100 78 55 80Z" fill="${dk(a.headC, 0.18)}"/><circle cx="100" cy="29" r="4" fill="${dk(a.headC, 0.25)}"/><path d="M100 30 V70 M76 38 Q80 54 78 72 M124 38 Q120 54 122 72" stroke="${dk(a.headC, 0.15)}" stroke-width="1.5" fill="none"/>`);
  if (a.head === 'beanie') s.push(`<path d="M54 74 Q50 22 100 20 Q150 22 146 74Z" fill="${a.headC}"/><rect x="50" y="62" width="100" height="18" rx="9" fill="${dk(a.headC, 0.15)}"/>${[60, 70, 80, 90, 100, 110, 120, 130, 140].map((x) => `<path d="M${x} 65 V77" stroke="${dk(a.headC, 0.3)}" stroke-width="1.4"/>`).join('')}<circle cx="100" cy="18" r="9" fill="${lt(a.headC, 0.3)}"/>`);

  s.push('</g>');
  const vb = VIEWS[opts.view] || VIEWS.full;
  const title = opts.title ? `<title>${String(opts.title).replace(/[<&>]/g, '')}</title>` : '';
  return `<svg class="${opts.cls || 'av-svg'}" viewBox="${vb}" xmlns="http://www.w3.org/2000/svg" role="img"${opts.title ? '' : ' aria-hidden="true"'}>${title}${s.join('')}</svg>`;
}

// Ready-made characters for the sign-in screen (nobody is signed in there yet).
export const CAST = [
  { g: 'f', skin: PAL.skin[2], face: 'oval', eyes: 'lashes', eyeC: PAL.eye[0], brows: 'arched', nose: 'button', mouth: 'smile', lips: PAL.lips[1], cheeks: 'blush', hair: 'long', hairC: PAL.hair[1], stache: 'none', beard: 'none', outfit: 'blazer', outC: PAL.cloth[0], glasses: 'none', ears: 'hoops', head: 'hijab', headC: PAL.cloth[3], bg: 'none' },
  { g: 'm', skin: PAL.skin[4], face: 'square', eyes: 'happy', eyeC: PAL.eye[1], brows: 'thick', nose: 'wide', mouth: 'grin', lips: '', cheeks: 'none', hair: 'quiff', hairC: PAL.hair[0], stache: 'chevron', beard: 'short', outfit: 'hoodie', outC: PAL.cloth[1], glasses: 'none', ears: 'none', head: 'none', headC: PAL.cloth[0], bg: 'none' },
  { g: 'f', skin: PAL.skin[1], face: 'heart', eyes: 'big', eyeC: PAL.eye[3], brows: 'natural', nose: 'dots', mouth: 'laugh', lips: '', cheeks: 'both', hair: 'curly', hairC: PAL.hair[4], stache: 'none', beard: 'none', outfit: 'vneck', outC: PAL.cloth[2], glasses: 'round', ears: 'studs', head: 'none', headC: PAL.cloth[0], bg: 'none' },
  { g: 'm', skin: PAL.skin[3], face: 'oval', eyes: 'normal', eyeC: PAL.eye[0], brows: 'raised', nose: 'line', mouth: 'smirk', lips: '', cheeks: 'none', hair: 'side', hairC: PAL.hair[2], stache: 'handlebar', beard: 'none', outfit: 'shirt', outC: PAL.cloth[3], glasses: 'square', ears: 'none', head: 'none', headC: PAL.cloth[0], bg: 'none' },
];
