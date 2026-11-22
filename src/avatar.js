// Bless avatars: every team member builds their own character. Pure SVG strings, no images.
// Semi-realistic illustrated style: soft shading, gradients, detailed eyes, lips, nose, hair strands and textures.
// A config is a small flat object of strings (see DEFAULT). avatarSVG(cfg, {view}) draws it.

export const PAL = {
  skin: ['#FCE9DE', '#FFE3D3', '#F7CFAF', '#EBB893', '#E0A982', '#D69C72', '#C68C64', '#B97C53', '#A06A45', '#8E5B3B', '#74482E', '#5F3B27'],
  hair: ['#1F1A1C', '#2C211C', '#3B2620', '#5A3A2A', '#6B4130', '#8E4A2A', '#C26A3A', '#A5432F', '#B5885A', '#D9B26A', '#EDE0C8', '#9C9A9E', '#D88BA8', '#7E4C9E'],
  eye: ['#5A3A24', '#2A1C14', '#8A6A2E', '#4E7A4A', '#4A78A8', '#7C8794'],
  cloth: ['#D98A96', '#6E3F7E', '#F2B8B0', '#B79AD8', '#F3E6D8', '#2A1F27', '#F7F3F5', '#2E3B63', '#6E7A4A', '#D9A441', '#2F7F7A', '#C2413B'],
  lips: ['', '#C9727E', '#B5304A', '#8E2F5A', '#C98A73', '#A8545E'],
  make: ['#B76E79', '#8E5B9E', '#C9A25E', '#7A4A3A', '#4E6E8E'],
  bg: { rose: ['#F4CBC1', '#C9A0DC'], peach: ['#FFD9B8', '#F4A99A'], lilac: ['#E9DCFF', '#B79AD8'], mint: ['#D3F1E6', '#8FCFC0'], sky: ['#D3E5FF', '#93B5E8'], gold: ['#FFE9AE', '#F2B866'], plum: ['#8A5AA8', '#3A1F4E'], none: null },
};

// Every choice the maker offers, in display order. Labels are what people see.
export const OPTS = {
  g: [['f', 'Female'], ['m', 'Male']],
  face: [['oval', 'Oval'], ['round', 'Round'], ['square', 'Square'], ['heart', 'Heart']],
  eyes: [['normal', 'Almond'], ['big', 'Round'], ['almond', 'Upturned'], ['dots', 'Hooded'], ['lashes', 'Long lashes'], ['happy', 'Smiling'], ['calm', 'Closed'], ['wink', 'Wink']],
  brows: [['natural', 'Natural'], ['thick', 'Thick'], ['arched', 'Arched'], ['raised', 'Raised'], ['focused', 'Straight'], ['none', 'None']],
  makeup: [['none', 'None'], ['liner', 'Eyeliner'], ['shadow', 'Eyeshadow'], ['glam', 'Full glam']],
  nose: [['button', 'Small'], ['line', 'Straight'], ['wide', 'Wide'], ['pointy', 'Aquiline'], ['dots', 'Upturned']],
  mouth: [['smile', 'Smile'], ['grin', 'Grin'], ['small', 'Soft'], ['laugh', 'Laugh'], ['smirk', 'Smirk'], ['neutral', 'Neutral'], ['tongue', 'Beaming']],
  cheeks: [['none', 'None'], ['blush', 'Blush'], ['freckles', 'Freckles'], ['both', 'Both']],
  marks: [['none', 'None'], ['mole', 'Beauty mark'], ['dimples', 'Dimples'], ['lines', 'Smile lines'], ['aged', 'Mature']],
  hair: [['short', 'Short'], ['side', 'Side part'], ['quiff', 'Quiff'], ['buzz', 'Buzz'], ['curly', 'Curly'], ['afro', 'Afro'], ['pixie', 'Pixie'], ['bob', 'Bob'], ['long', 'Long'], ['wavy', 'Wavy'], ['bun', 'Bun'], ['pony', 'Ponytail'], ['bald', 'Bald']],
  stache: [['none', 'None'], ['thin', 'Thin'], ['chevron', 'Chevron'], ['handlebar', 'Handlebar'], ['pencil', 'Pencil'], ['walrus', 'Walrus']],
  beard: [['none', 'None'], ['stubble', 'Stubble'], ['short', 'Short'], ['full', 'Full'], ['goatee', 'Goatee']],
  outfit: [['tee', 'T-shirt'], ['vneck', 'V-neck'], ['hoodie', 'Hoodie'], ['shirt', 'Shirt'], ['blazer', 'Blazer'], ['turtle', 'Turtleneck'], ['top', 'Strap top']],
  glasses: [['none', 'None'], ['round', 'Round'], ['square', 'Square'], ['cat', 'Cat-eye'], ['sun', 'Sunglasses']],
  ears: [['none', 'None'], ['studs', 'Studs'], ['hoops', 'Hoops']],
  head: [['none', 'None'], ['hijab', 'Hijab'], ['cap', 'Cap'], ['beanie', 'Beanie']],
  bg: Object.keys(PAL.bg).map((k) => [k, k[0].toUpperCase() + k.slice(1)]),
};
export const COLORS = { skin: PAL.skin, hairC: PAL.hair, eyeC: PAL.eye, outC: PAL.cloth, headC: PAL.cloth, lips: PAL.lips, makeC: PAL.make };

export const DEFAULT = { g: 'f', skin: '#EBB893', face: 'oval', eyes: 'normal', eyeC: PAL.eye[0], brows: 'natural', makeup: 'none', makeC: PAL.make[0], nose: 'button', mouth: 'smile', lips: '', cheeks: 'blush', marks: 'none', hair: 'long', hairC: '#3B2620', stache: 'none', beard: 'none', outfit: 'blazer', outC: PAL.cloth[0], glasses: 'none', ears: 'none', head: 'none', headC: PAL.cloth[3], bg: 'rose' };
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
    g, skin: pick(PAL.skin), face: pickK('face'), eyes: f ? pick(['normal', 'big', 'almond', 'lashes', 'happy', 'dots']) : pick(['normal', 'big', 'almond', 'dots', 'happy']),
    eyeC: pick(PAL.eye), brows: pick(['natural', 'thick', 'arched', 'raised', 'natural', 'focused']), makeup: f ? pick(['none', 'liner', 'shadow', 'glam']) : 'none', makeC: pick(PAL.make),
    nose: pickK('nose'), mouth: pick(['smile', 'grin', 'small', 'laugh', 'smirk', 'smile', 'tongue']),
    lips: f && Math.random() < 0.6 ? pick(PAL.lips.slice(1)) : '', cheeks: pickK('cheeks'), marks: Math.random() < 0.4 ? pick(['mole', 'dimples', 'lines']) : 'none', hair, hairC: pick(PAL.hair.slice(0, 11)),
    stache: !f && Math.random() < 0.45 ? pick(['thin', 'chevron', 'handlebar', 'pencil', 'walrus']) : 'none',
    beard: !f && Math.random() < 0.5 ? pick(['stubble', 'short', 'full', 'goatee']) : 'none',
    outfit: f ? pickK('outfit') : pick(['tee', 'vneck', 'hoodie', 'shirt', 'blazer', 'turtle']), outC: pick(PAL.cloth),
    glasses: Math.random() < 0.3 ? pick(['round', 'square', 'cat', 'sun']) : 'none', ears: f && Math.random() < 0.5 ? pick(['studs', 'hoops']) : 'none',
    head: f && Math.random() < 0.3 ? 'hijab' : (Math.random() < 0.1 ? pick(['cap', 'beanie']) : 'none'), headC: pick(PAL.cloth), bg: pick(['rose', 'peach', 'lilac', 'mint', 'sky', 'gold']),
  };
}

// colour helpers
function rgb(hex) { const h = (hex || '#000000').replace('#', ''); const n = parseInt(h.length === 3 ? h.replace(/./g, '$&$&') : h, 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
function hx(c) { return '#' + c.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join(''); }
function mixTo(hex, hex2, t) { const a = rgb(hex), b = rgb(hex2); return hx(a.map((v, i) => v + (b[i] - v) * t)); }
const dk = (h, t = 0.18) => mixTo(h, '#1a0a10', t), lt = (h, t = 0.25) => mixTo(h, '#ffffff', t);

const FACES = {
  oval: { w: 40, d: 'M60 90 C60 58 76 42 100 42 C124 42 140 58 140 90 C140 116 124 138 100 138 C76 138 60 116 60 90Z' },
  round: { w: 45, d: 'M55 92 C55 62 74 47 100 47 C126 47 145 62 145 92 C145 120 126 137 100 137 C74 137 55 120 55 92Z' },
  square: { w: 42, d: 'M58 74 C58 54 74 44 100 44 C126 44 142 54 142 74 L142 108 C142 126 124 138 100 138 C76 138 58 126 58 108Z' },
  heart: { w: 43, d: 'M57 84 C57 58 74 42 100 42 C126 42 143 58 143 84 C143 110 124 128 100 138 C76 128 57 110 57 84Z' },
};
const VIEWS = { full: '14 18 172 172', head: '22 8 156 156', face: '52 62 96 76', eyes: '62 70 76 44', mouth: '72 98 56 42', lower: '50 90 100 80', body: '14 112 172 88' };

// eye shapes for the LEFT eye in local coords (inner corner at +x); t = upper lid, b = lower lid continuing from e
const EYE = {
  normal: { t: 'M-10 .5 C-7 -4 -3 -6.3 2 -6 C6 -5.7 8.5 -3 10 0', e: '10 0', b: 'C7 3.4 3 4.8 -1 4.7 C-5.5 4.5 -8.5 3 -10 .5' },
  big: { t: 'M-9.5 0 C-7 -5.6 -3 -7.8 1 -7.7 C5.5 -7.5 8.3 -4.6 9.5 0', e: '9.5 0', b: 'C7.5 4.6 3.6 6.2 0 6.2 C-4.5 6 -8 4 -9.5 0' },
  almond: { t: 'M-10.8 -2.4 C-7.6 -5.6 -3 -6.8 2 -6 C6 -5.2 8.6 -2.6 10 .5', e: '10 .5', b: 'C6.8 3.6 2.4 4.6 -2 4 C-6.4 3.3 -9.4 .8 -10.8 -2.4' },
  happy: { t: 'M-10 .8 C-7 -4 -3 -6.3 2 -6 C6 -5.7 8.5 -3 10 .4', e: '10 .4', b: 'C6 1.2 2.5 1.6 -1 1.6 C-5 1.6 -8 1.4 -10 .8' },
};
EYE.lashes = EYE.normal; EYE.dots = EYE.normal;

const BROW = {
  natural: 'M11 1.6 C10.6 -1.8 7.6 -3.3 4 -3.6 C-1.8 -4.1 -7.6 -2.4 -12.4 .9 C-7.4 -.9 -2 -1.5 3.6 -.9 C7 -.6 9.4 .2 11 1.6Z',
  thick: 'M11.2 2.6 C10.8 -2.6 7.6 -4.6 3.6 -4.9 C-2.4 -5.4 -8.2 -3 -12.8 1 C-7.6 -.4 -2.2 -.4 3.4 .4 C7 .9 9.4 1.6 11.2 2.6Z',
  arched: 'M10.6 1.8 C9.8 -1.4 7.4 -3.4 4.4 -4.6 C-.6 -6.4 -6.8 -3.8 -12.2 1.6 C-6.8 -2.4 -1.6 -3 3.4 -1.4 C6.8 -.4 9 .6 10.6 1.8Z',
  focused: 'M11 3.4 C10.4 .4 7.6 -1.2 4 -1.8 C-1.8 -2.8 -7.6 -2.6 -12.4 -.6 C-7.4 -.2 -2 .4 3.6 1.4 C7 2 9.4 2.6 11 3.4Z',
};
BROW.raised = BROW.natural;

let uid = 0;
/** SVG markup for one avatar. opts.view: full | head | face | eyes | mouth | lower | body. opts.title: accessible name. */
export function avatarSVG(raw, opts = {}) {
  const a = cleanAvatar(raw), id = 'av' + (++uid), F = FACES[a.face];
  const skin = a.skin, skinL = lt(skin, 0.16), skinD = dk(skin, 0.16), skinDD = dk(skin, 0.34);
  const hc = a.hairC, hcD = dk(hc, 0.3), hcL = lt(hc, 0.32), oc = a.outC, ocD = dk(oc, 0.22), ocL = lt(oc, 0.18);
  const hij = a.head === 'hijab', cover = a.head === 'cap' || a.head === 'beanie', fem = a.g === 'f';
  const ink = '#24141C', hcol = a.headC;
  const lipBase = a.lips || mixTo(skin, '#B04F60', 0.42);
  const bg = PAL.bg[a.bg];
  const B = `filter="url(#${id}b)"`, B2 = `filter="url(#${id}s)"`;
  const mirror = (inner) => `${inner}<g transform="matrix(-1 0 0 1 200 0)">${inner}</g>`;
  const s = [];

  // ---------- shared paint
  s.push(`<defs>
<linearGradient id="${id}g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${bg ? bg[0] : '#000'}"/><stop offset="1" stop-color="${bg ? bg[1] : '#000'}"/></linearGradient>
<radialGradient id="${id}fg" cx=".42" cy=".38" r=".72"><stop offset="0" stop-color="${skinL}"/><stop offset=".55" stop-color="${skin}"/><stop offset="1" stop-color="${skinD}"/></radialGradient>
<linearGradient id="${id}ng" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${dk(skin, 0.32)}"/><stop offset=".55" stop-color="${dk(skin, 0.1)}"/><stop offset="1" stop-color="${skin}"/></linearGradient>
<linearGradient id="${id}eg" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${skinD}"/><stop offset="1" stop-color="${skin}"/></linearGradient>
<linearGradient id="${id}hg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${lt(hc, 0.1)}"/><stop offset=".5" stop-color="${hc}"/><stop offset="1" stop-color="${dk(hc, 0.22)}"/></linearGradient>
<linearGradient id="${id}hb" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${dk(hc, 0.2)}"/><stop offset="1" stop-color="${dk(hc, 0.42)}"/></linearGradient>
<radialGradient id="${id}ig" cx=".45" cy=".4" r=".6"><stop offset="0" stop-color="${lt(a.eyeC, 0.45)}"/><stop offset=".6" stop-color="${a.eyeC}"/><stop offset="1" stop-color="${dk(a.eyeC, 0.55)}"/></radialGradient>
<linearGradient id="${id}lid" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3a1a24" stop-opacity=".42"/><stop offset=".5" stop-color="#3a1a24" stop-opacity="0"/></linearGradient>
<linearGradient id="${id}cg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${ocL}"/><stop offset="1" stop-color="${dk(oc, 0.16)}"/></linearGradient>
<linearGradient id="${id}kg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${lt(hcol, 0.12)}"/><stop offset="1" stop-color="${dk(hcol, 0.18)}"/></linearGradient>
<radialGradient id="${id}bl" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#EE7F92" stop-opacity=".5"/><stop offset="1" stop-color="#EE7F92" stop-opacity="0"/></radialGradient>
<linearGradient id="${id}gold" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#FBE3A1"/><stop offset=".5" stop-color="#D9A93F"/><stop offset="1" stop-color="#9C7224"/></linearGradient>
<pattern id="${id}t" width="5" height="6" patternUnits="userSpaceOnUse"><path d="M1 .5 l.6 2.2 M3.4 2.6 l-.5 2 M2.2 4.6 l.4 1.2 M4.4 .2 l.3 1.4" stroke="${lt(hc, 0.3)}" stroke-width=".45" stroke-linecap="round" opacity=".55"/><path d="M.4 3.4 l.5 1.6 M3 .6 l-.3 1.4" stroke="${dk(hc, 0.4)}" stroke-width=".5" stroke-linecap="round" opacity=".5"/></pattern>
<pattern id="${id}d" width="2.4" height="2.4" patternUnits="userSpaceOnUse" patternTransform="rotate(30)"><circle cx=".7" cy=".7" r=".45" fill="${hc}"/><circle cx="1.9" cy="1.8" r=".35" fill="${hc}" opacity=".8"/></pattern>
<filter id="${id}b" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="2.6"/></filter>
<filter id="${id}s" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="1"/></filter>
<radialGradient id="${id}vg" cx=".5" cy=".45" r=".7"><stop offset=".6" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".14"/></radialGradient>
<clipPath id="${id}c"><rect width="200" height="200"/></clipPath>
<clipPath id="${id}fc"><path d="${F.d}"/></clipPath>
</defs>`);
  if (bg) s.push(`<rect width="200" height="200" fill="url(#${id}g)"/><circle cx="150" cy="44" r="60" fill="#fff" opacity=".14" ${B}/><rect width="200" height="200" fill="url(#${id}vg)"/>`);
  s.push(`<g clip-path="url(#${id}c)">`);

  // ---------- back layers
  let back = '';
  if (!hij && a.hair !== 'bald') {
    back = {
      long: 'M46 172 C38 120 36 60 58 44 C70 34 84 31 100 31 C116 31 130 34 142 44 C164 60 162 120 154 172 C136 180 118 179 100 178 C82 179 64 180 46 172Z',
      wavy: 'M46 158 C34 110 38 56 60 42 C72 34 86 31 100 31 C116 31 130 34 142 42 C164 56 166 110 154 158 C162 170 152 180 146 176 C140 172 134 180 126 178 C116 174 110 180 100 178 C90 180 84 174 74 178 C66 180 60 172 54 176 C46 180 38 170 46 158Z',
      bob: 'M48 130 C40 90 42 52 62 40 C74 33 86 31 100 31 C114 31 126 33 138 40 C158 52 160 90 152 130 C134 138 118 135 100 134 C82 135 66 138 48 130Z',
      pony: 'M128 52 C170 54 178 96 166 132 C162 148 154 158 148 162 C154 132 150 112 144 100 C138 86 132 78 126 72Z',
      bun: '', curly: fem ? 'M50 128 C40 96 42 56 64 42 C76 34 88 33 100 33 C112 33 124 34 136 42 C158 56 160 96 150 128 C116 140 84 140 50 128Z' : '',
      afro: '',
    }[a.hair] || '';
    if (back) s.push(`<path d="${back}" fill="url(#${id}hb)"/><clipPath id="${id}bc"><path d="${back}"/></clipPath><g clip-path="url(#${id}bc)" fill="none" stroke-linecap="round">${[48, 54, 60, 140, 146, 152].map((x, i) => `<path d="M${x} 70 C${x + (i < 3 ? -4 : 4)} 110 ${x + (i < 3 ? 3 : -3)} 140 ${x} 180" stroke="${i % 2 ? hcL : hcD}" stroke-width="${i % 2 ? 0.8 : 1.1}" opacity=".45"/>`).join('')}</g>`);
    if (a.hair === 'afro' || (a.hair === 'curly' && fem)) {
      const pts = a.hair === 'afro' ? [...Array(14)].map((_, i) => { const t = (i / 14) * Math.PI * 2; return [100 + Math.cos(t) * 56, 80 + Math.sin(t) * 54, 15]; }) : [56, 68, 82, 118, 132, 144].map((x, i) => [x, 124 + (i % 2) * 4, 12]);
      if (a.hair === 'afro') s.push(`<circle cx="100" cy="80" r="60" fill="url(#${id}hb)"/>`);
      s.push(pts.map(([x, y, r]) => `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r}" fill="${dk(hc, 0.28)}"/><circle cx="${(x - r * 0.3).toFixed(1)}" cy="${(y - r * 0.35).toFixed(1)}" r="${(r * 0.45).toFixed(1)}" fill="${hcL}" opacity=".18"/>`).join(''));
    }
  }
  if (a.outfit === 'hoodie') s.push(`<path d="M58 162 C60 136 76 126 100 127 C124 126 140 136 142 162Z" fill="${ocD}"/><path d="M66 158 C70 140 82 133 100 133 C118 133 130 140 134 158" fill="none" stroke="${dk(oc, 0.38)}" stroke-width="2" opacity=".5"/>`);
  if (hij) s.push(`<path d="M100 27 C134 27 156 50 157 88 C158 120 150 140 142 150 C166 160 178 178 184 200 L16 200 C22 178 34 160 58 150 C50 140 42 120 43 88 C44 50 66 27 100 27Z" fill="url(#${id}kg)"/><path d="M48 120 C52 150 64 166 70 200 M152 120 C148 150 136 166 130 200 M40 196 C60 178 80 172 100 172" stroke="${dk(hcol, 0.28)}" stroke-width="1.6" fill="none" opacity=".35"/>`);

  // ---------- neck and body
  const bodyD = fem ? 'M34 200 C36 170 50 158 70 154 C82 151 90 149 100 149 C110 149 118 151 130 154 C150 158 164 170 166 200Z' : 'M24 200 C26 166 42 156 62 152 C76 149 88 147 100 147 C112 147 124 149 138 152 C158 156 174 166 176 200Z';
  s.push(`<path d="M86 114 L86 148 C92 154 108 154 114 148 L114 114Z" fill="url(#${id}ng)"/><path d="M89 128 C90 138 92 146 94 152 M111 128 C110 138 108 146 106 152" stroke="${skinD}" stroke-width="1.2" fill="none" opacity=".45" ${B2}/>`);
  const collarbones = `<path d="M78 162 C86 165 93 164 98 161 M122 162 C114 165 107 164 102 161" stroke="${skinD}" stroke-width="1.3" fill="none" opacity=".55" ${B2}/>`;
  const folds = `<path d="M58 174 C64 184 64 192 62 200 M142 174 C136 184 136 192 138 200" stroke="${dk(oc, 0.35)}" stroke-width="1.6" fill="none" opacity=".35" ${B2}/><ellipse cx="66" cy="164" rx="14" ry="6" fill="#fff" opacity=".12" ${B}/><ellipse cx="134" cy="164" rx="14" ry="6" fill="#fff" opacity=".12" ${B}/>`;
  if (a.outfit === 'top') {
    s.push(`<path d="${bodyD}" fill="url(#${id}fg)"/>${collarbones}<path d="M${fem ? 48 : 40} 200 C${fem ? 52 : 44} 182 60 172 74 168 L79 151 L82.5 151 L86 166 C92 172 108 172 114 166 L117.5 151 L121 151 L126 168 C140 172 ${fem ? 148 : 156} 182 ${fem ? 152 : 160} 200Z" fill="url(#${id}cg)"/><path d="M86 166 C92 172 108 172 114 166" stroke="${ocD}" stroke-width="1.5" fill="none"/>${folds}`);
  } else {
    s.push(`<path d="${bodyD}" fill="url(#${id}cg)"/>${folds}`);
    if (a.outfit === 'tee') s.push(`<path d="M85 148 C90 160 110 160 115 148" fill="${dk(skin, 0.08)}"/><path d="M84 148 C89 162 111 162 116 148" fill="none" stroke="${ocD}" stroke-width="3.2"/><path d="M84 148 C89 162 111 162 116 148" fill="none" stroke="${ocL}" stroke-width="1" opacity=".6"/>`);
    if (a.outfit === 'vneck') s.push(`<path d="M85 148 L100 174 L115 148Z" fill="${dk(skin, 0.06)}"/>${collarbones}<path d="M84 147 L100 175 L116 147" fill="none" stroke="${ocD}" stroke-width="3.2" stroke-linejoin="round"/>`);
    if (a.outfit === 'hoodie') s.push(`<path d="M83 148 C88 166 112 166 117 148" fill="${dk(skin, 0.08)}"/><path d="M82 148 C87 168 113 168 118 148" fill="none" stroke="${ocD}" stroke-width="4.5"/><path d="M93 163 C92 172 91 180 91 187 M107 163 C108 172 109 180 109 187" stroke="${lt(oc, 0.6)}" stroke-width="2.2" stroke-linecap="round" fill="none"/><rect x="89.4" y="185" width="3.2" height="6" rx="1.4" fill="#cfc6cc"/><rect x="107.4" y="185" width="3.2" height="6" rx="1.4" fill="#cfc6cc"/>`);
    if (a.outfit === 'shirt') s.push(`<path d="M90 148 L100 163 L110 148Z" fill="${dk(skin, 0.06)}"/><path d="M84 146 L100 164 L92 175 L78 154Z M116 146 L100 164 L108 175 L122 154Z" fill="${dk(oc, 0.4)}" opacity=".35" transform="translate(0 2.5)" ${B2}/><path d="M85 145 L100 164 L92.5 174 L79 153Z M115 145 L100 164 L107.5 174 L121 153Z" fill="${ocL}" stroke="${ocD}" stroke-width="1" stroke-linejoin="round"/><path d="M100 164 V200" stroke="${ocD}" stroke-width="1" opacity=".6"/>${[176, 188].map((y) => `<circle cx="102.6" cy="${y}" r="1.7" fill="${lt(oc, 0.5)}" stroke="${ocD}" stroke-width=".6"/>`).join('')}`);
    if (a.outfit === 'blazer') s.push(`<path d="M83 148 L100 200 L117 148Z" fill="#F4EFF1"/><path d="M90 148 L100 161 L110 148Z" fill="${dk(skin, 0.06)}"/><path d="M90 150 L100 162 L110 150" stroke="#d9cfd4" stroke-width="1.2" fill="none"/><path d="M83 147 L100 197 L94.5 169 L70 158Z M117 147 L100 197 L105.5 169 L130 158Z" fill="${dk(oc, 0.3)}" opacity=".5" transform="translate(0 2)" ${B2}/><path d="M83 147 L100 196 L95 168 L72 157Z M117 147 L100 196 L105 168 L128 157Z" fill="${ocD}"/><path d="M83 147 L95 168 M117 147 L105 168" stroke="${lt(oc, 0.25)}" stroke-width=".8" opacity=".7"/><circle cx="104.5" cy="190" r="2.3" fill="url(#${id}gold)"/><path d="M128 172 L136 168 L138 174Z" fill="${oc === PAL.cloth[6] ? PAL.cloth[0] : '#F7F3F5'}" opacity=".9"/>`);
    if (a.outfit === 'turtle') s.push(`<path d="M84 132 C84 128 116 128 116 132 L116 152 C110 156 90 156 84 152Z" fill="${ocL}"/>${[88, 92, 96, 100, 104, 108, 112].map((x) => `<path d="M${x} 133 V153" stroke="${dk(oc, 0.15)}" stroke-width="1.1" opacity=".7"/>`).join('')}<path d="M84 152 C90 156 110 156 116 152" stroke="${ocD}" stroke-width="1.5" fill="none"/>`);
  }
  if (hij) s.push(`<path d="M56 150 C72 162 88 164 100 164 C112 164 128 162 144 150 C152 166 146 178 136 182 C122 174 112 172 100 172 C88 172 78 174 64 182 C54 178 48 166 56 150Z" fill="${hcol}"/><path d="M64 160 C80 168 120 168 136 160" stroke="${dk(hcol, 0.22)}" stroke-width="1.4" fill="none" opacity=".5"/>`);

  // ---------- head
  s.push(`<ellipse cx="100" cy="134" rx="24" ry="9" fill="${dk(skin, 0.45)}" opacity=".45" ${B}/>`);
  const ex = 100 - F.w - 1;
  if (!hij) s.push(mirror(`<path d="M${ex + 5} 84 C${ex - 6} 80 ${ex - 10} 90 ${ex - 8} 99 C${ex - 6} 107 ${ex - 1} 110 ${ex + 5} 108Z" fill="url(#${id}eg)"/><path d="M${ex + 2} 89 C${ex - 4} 89 ${ex - 5} 96 ${ex - 3} 101 C${ex - 2} 104 ${ex} 105 ${ex + 3} 104" fill="none" stroke="${skinDD}" stroke-width="1.3" opacity=".7"/><path d="M${ex} 93 C${ex - 2} 95 ${ex - 1} 99 ${ex + 1} 100" fill="none" stroke="${skinD}" stroke-width="1.6" opacity=".6"/>`));
  s.push(`<path d="${F.d}" fill="url(#${id}fg)"/>`);
  // soft modelling inside the face
  const hairFront = hij ? '' : frontHair(a.hair);
  s.push(`<g clip-path="url(#${id}fc)">
<path d="${F.d}" fill="none" stroke="${skinDD}" stroke-width="10" opacity=".22" ${B}/>
<ellipse cx="100" cy="132" rx="20" ry="7" fill="${skinD}" opacity=".35" ${B}/>
<ellipse cx="78" cy="102" rx="9" ry="5" fill="#fff" opacity=".16" ${B}/>
<ellipse cx="122" cy="102" rx="9" ry="5" fill="#fff" opacity=".1" ${B}/>
<ellipse cx="100" cy="64" rx="18" ry="6" fill="#fff" opacity=".14" ${B}/>
<ellipse cx="100" cy="129" rx="6" ry="3" fill="#fff" opacity=".18" ${B}/>
${mirror(`<ellipse cx="83" cy="89" rx="12" ry="7.5" fill="${skinDD}" opacity=".16" ${B}/>`)}
${hairFront && !cover ? `<path d="${hairFront}" fill="${dk(skin, 0.5)}" opacity=".38" transform="translate(0 4)" ${B}/>` : ''}
${cover ? `<rect x="50" y="60" width="100" height="22" fill="${dk(skin, 0.5)}" opacity=".3" ${B}/>` : ''}
</g>`);
  if (hij) s.push(`<path d="M55 86 C55 52 72 35 100 35 C128 35 145 52 145 86 C146 118 136 134 126 142 L132 148 C122 152 112 153 100 153 C88 153 78 152 68 148 L74 142 C64 134 54 118 55 86Z M60 88 C60 62 74 50 100 50 C126 50 140 62 140 88 C140 116 124 138 100 139 C76 138 60 116 60 88Z" fill="url(#${id}kg)" fill-rule="evenodd"/><path d="M60 88 C60 62 74 50 100 50 C126 50 140 62 140 88 C140 116 124 138 100 139 C76 138 60 116 60 88Z" fill="none" stroke="${dk(skin, 0.5)}" stroke-width="5" opacity=".25" ${B}/><path d="M60 88 C60 62 74 50 100 50 C126 50 140 62 140 88" fill="none" stroke="${dk(hcol, 0.25)}" stroke-width="1.6"/><path d="M68 60 C80 44 120 44 132 60" fill="none" stroke="${lt(hcol, 0.4)}" stroke-width="3" opacity=".35" ${B2}/>`);

  // cheeks, freckles, marks
  if (a.cheeks === 'blush' || a.cheeks === 'both') s.push(`<ellipse cx="76" cy="110" rx="12" ry="8" fill="url(#${id}bl)"/><ellipse cx="124" cy="110" rx="12" ry="8" fill="url(#${id}bl)"/>`);
  if (a.cheeks === 'freckles' || a.cheeks === 'both') s.push(`<g fill="${dk(skin, 0.42)}" opacity=".5">${[[73, 103, 1], [79, 106, 0.8], [70, 108, 0.9], [76, 111, 0.7], [83, 109, 0.6], [95, 100, 0.6], [127, 103, 1], [121, 106, 0.8], [130, 108, 0.9], [124, 111, 0.7], [117, 109, 0.6], [105, 100, 0.6]].map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}"/>`).join('')}</g>`);
  if (a.marks === 'lines' || a.marks === 'aged') s.push(mirror(`<path d="M91 110 C86 114 85 119 87 124" stroke="${skinDD}" stroke-width="1.3" fill="none" opacity=".5" ${B2}/>`));
  if (a.marks === 'aged') s.push(`<path d="M84 60 C92 58 108 58 116 60 M87 65 C94 63.5 106 63.5 113 65" stroke="${skinDD}" stroke-width="1" fill="none" opacity=".4"/>${mirror(`<path d="M71 92 L67 90 M71 95 L67 96 M72 98 L69 101" stroke="${skinDD}" stroke-width=".8" opacity=".5"/><path d="M76 99 C80 101 86 101 90 99" stroke="${skinDD}" stroke-width=".8" fill="none" opacity=".45"/>`)}`);
  if (a.marks === 'mole') s.push(`<circle cx="115" cy="117" r="1.4" fill="${dk(skin, 0.6)}"/>`);

  // beard (under the lips)
  const beard = {
    stubble: 'M58 96 C58 120 66 140 100 146 C134 140 142 120 142 96 C139 110 132 120 124 124 C116 130 108 132 100 132 C92 132 84 130 76 124 C68 120 61 110 58 96Z',
    short: 'M57 90 C56 120 66 146 100 150 C134 146 144 120 143 90 C139 106 132 116 126 119 C118 128 109 130 100 130 C91 130 82 128 74 119 C68 116 61 106 57 90Z',
    full: 'M55 86 C52 128 64 164 100 170 C136 164 148 128 145 86 C141 104 134 116 127 120 C118 129 109 131 100 131 C91 131 82 129 73 120 C66 116 59 104 55 86Z',
    goatee: 'M89 129 C90 140 95 148 100 149 C105 148 110 140 111 129 C107 131 104 132 100 132 C96 132 93 131 89 129Z',
  }[a.beard];
  if (beard && a.beard === 'stubble') s.push(`<path d="${beard}" fill="${hc}" opacity=".16"/><path d="${beard}" fill="url(#${id}d)" opacity=".55"/>`);
  else if (beard) s.push(`<path d="${beard}" fill="url(#${id}hg)"/><path d="${beard}" fill="url(#${id}t)"/><path d="${beard}" fill="none" stroke="${hcD}" stroke-width="1.5" opacity=".35" ${B2}/>`);

  // ---------- eyes
  const eyeL = (kind, n) => {
    if (kind === 'calm') return `<path d="M-10 0 C-6 4 4 4.6 10 0" fill="none" stroke="${ink}" stroke-width="1.9" stroke-linecap="round"/><path d="M-7 2.6 L-8.6 5 M-3.6 3.6 L-4.4 6.2 M0 4 L0 6.6 M3.6 3.6 L4.2 6" stroke="${ink}" stroke-width="1" stroke-linecap="round"/><path d="M-10 -5 C-4 -8 4 -8 10 -4" fill="none" stroke="${skinDD}" stroke-width="1" opacity=".55"/>`;
    const E = EYE[kind] || EYE.normal, shape = `${E.t} ${E.b}Z`, cid = `${id}e${n}`;
    const iy = kind === 'happy' ? -1.8 : kind === 'big' ? -0.4 : -0.8, ir = kind === 'big' ? 5.4 : 5;
    let out = `<clipPath id="${cid}"><path d="${shape}"/></clipPath>`;
    if (a.makeup === 'shadow' || a.makeup === 'glam') out += `<path d="M-12 1 C-9 -9 6 -11 12 -2 C8 -6 0 -7.5 -6 -6 C-9 -5 -11 -2 -12 1Z" fill="${a.makeC}" opacity=".55" ${B2}/>`;
    out += `<path d="${shape}" fill="#F7F0EC"/><g clip-path="url(#${cid})"><circle cx=".6" cy="${iy}" r="${ir}" fill="url(#${id}ig)"/><circle cx=".6" cy="${iy}" r="${ir}" fill="none" stroke="${dk(a.eyeC, 0.6)}" stroke-width=".8"/><circle cx=".6" cy="${iy}" r="2.3" fill="#140a0e"/><circle cx="-1.3" cy="${iy - 2}" r="1.3" fill="#fff"/><circle cx="2.4" cy="${iy + 1.4}" r=".6" fill="#fff" opacity=".7"/><path d="${shape}" fill="url(#${id}lid)"/></g>`;
    out += `<path d="M${E.e} ${E.b}" fill="none" stroke="${skinDD}" stroke-width=".8" opacity=".6"/>`;
    const lashW = a.makeup === 'liner' || a.makeup === 'glam' ? 2.8 : 1.9;
    out += `<path d="${E.t}" fill="none" stroke="${ink}" stroke-width="${lashW}" stroke-linecap="round"/>`;
    if (a.makeup === 'liner' || a.makeup === 'glam') out += `<path d="M-9.6 0 L-14 -3.6 L-9 -2.2Z" fill="${ink}"/>`;
    if (kind === 'dots') out += `<path d="M-11 -.6 C-7 -7.4 4 -8.6 11 -1 C6 -4.4 0 -4.8 -4 -4.4 C-7 -4 -9.4 -2.6 -11 -.6Z" fill="${skin}"/><path d="M-10.5 -.8 C-6 -4.6 2 -5.4 10.6 -1.2" fill="none" stroke="${ink}" stroke-width="1.7" stroke-linecap="round" opacity=".85"/>`;
    else out += `<path d="${E.t}" fill="none" stroke="${skinDD}" stroke-width="1" opacity=".5" transform="translate(-.4 -3.4) scale(1.06)"/>`;
    if (kind === 'lashes' || a.makeup === 'glam' || (fem && kind !== 'dots')) {
      const L = kind === 'lashes' || a.makeup === 'glam' ? 1 : 0.6;
      out += `<path d="M-9 -1.6 L${-12 - 2 * L} ${-4 - 2 * L} M-7 -3.8 L${-9 - 1.6 * L} ${-7 - 2.2 * L} M-4.4 -5.3 L${-5.6 - L} ${-9 - 2.4 * L} M-1.4 -6 L${-2 - 0.6 * L} ${-9.6 - 2.4 * L} M1.6 -6 L${1.8} ${-9 - 2 * L}" stroke="${ink}" stroke-width="${0.9 + 0.3 * L}" stroke-linecap="round"/>`;
      if (kind === 'lashes' || a.makeup === 'glam') out += `<path d="M-7 3.4 L-8 5.2 M-4 4.4 L-4.6 6.2 M-1 4.7 L-1.2 6.4" stroke="${ink}" stroke-width=".7" stroke-linecap="round" opacity=".8"/>`;
    }
    if (kind === 'happy') out += `<path d="M-8 4 C-3 6 3 6 8 3.6" fill="none" stroke="${skinDD}" stroke-width="1" opacity=".55"/>`;
    out += `<path d="M-8 6.6 C-3 8.6 3 8.6 7 6" fill="none" stroke="${skinDD}" stroke-width="1" opacity=".22" ${B2}/>`;
    return out;
  };
  const kL = a.eyes === 'wink' ? 'normal' : a.eyes, kR = a.eyes === 'wink' ? 'calm' : a.eyes;
  s.push(`<g transform="translate(83 92)">${eyeL(kL, 'l')}</g><g transform="matrix(-1 0 0 1 200 0)"><g transform="translate(83 92)">${eyeL(kR, 'r')}</g></g>`);

  // brows (filled, tapered, with hair texture)
  if (BROW[a.brows]) {
    const bc = a.hair === 'bald' || cover || hij ? dk(skin, 0.5) : dk(hc, 0.12);
    const dy = a.brows === 'raised' ? 74 : 78;
    const one = `<g transform="translate(83 ${dy})"><path d="${BROW[a.brows]}" fill="${bc}"/><path d="M9 .6 L7.2 -2.4 M6 .1 L4.4 -2.8 M3 -.3 L1.2 -3.2 M0 -.5 L-2 -3.2 M-3 -.6 L-5 -2.8 M-6 -.3 L-8 -2" stroke="${lt(bc, 0.3)}" stroke-width=".45" opacity=".55"/></g>`;
    s.push(mirror(one));
  }

  // ---------- nose
  {
    const nw = { button: 5.4, line: 6, wide: 8.4, pointy: 6.2, dots: 5.4 }[a.nose], ty = { button: 107, line: 109, wide: 108, pointy: 110, dots: 106 }[a.nose];
    const bridge = a.nose === 'pointy' ? `M104 80 C106 88 106 96 ${100 + nw - 1} ${ty - 2}` : `M103.6 80 C104.6 90 104.6 ${ty - 8} ${100 + nw - 1} ${ty - 2}`;
    s.push(`<path d="${bridge}" fill="none" stroke="${skinD}" stroke-width="3.6" opacity=".55" ${B2}/><path d="M97.6 82 C96.8 92 97 ${ty - 9} 98 ${ty - 4}" fill="none" stroke="${skinL}" stroke-width="2.2" opacity=".55" ${B2}/>`);
    if (a.nose === 'pointy') s.push(`<path d="M102 90 C104 94 104.6 100 103 ${ty - 1}" fill="none" stroke="${skinDD}" stroke-width="1" opacity=".45"/>`);
    s.push(`<path d="M${100 - nw} ${ty + 1} C${100 - nw / 2} ${ty + 5} ${100 + nw / 2} ${ty + 5} ${100 + nw} ${ty + 1} C${100 + nw / 2} ${ty + 2.6} ${100 - nw / 2} ${ty + 2.6} ${100 - nw} ${ty + 1}Z" fill="${skinD}" opacity=".7" ${B2}/>`);
    s.push(`<ellipse cx="99" cy="${ty - 2.6}" rx="2.8" ry="2" fill="${lt(skin, 0.4)}" opacity=".65" ${B2}/>`);
    s.push(mirror(`<path d="M${100 - nw + 2} ${ty - 4} C${100 - nw - 2.2} ${ty - 2} ${100 - nw - 1} ${ty + 2.4} ${100 - nw + 2} ${ty + 2.4} C${100 - nw + 4} ${ty + 2.8} ${100 - 4.4} ${ty + 2.6} ${100 - 3.2} ${ty + 2.2}" fill="none" stroke="${skinDD}" stroke-width="1.2" stroke-linecap="round" opacity=".75"/><ellipse cx="${100 - 3.1}" cy="${ty + 1.5}" rx="1.9" ry="${a.nose === 'dots' ? 1.3 : 0.95}" transform="rotate(18 ${100 - 3.1} ${ty + 1.5})" fill="${dk(skin, 0.55)}" opacity=".8"/>`));
  }

  // ---------- mouth (real lips with cupid's bow)
  {
    const P = { smile: [12, 3, 0, 0], grin: [13, 4, 4.6, 1], small: [9, 1, 0, 0], laugh: [13.5, 4.6, 7.5, 1], smirk: [11, 2, 0, 0], neutral: [11, 0, 0, 0], tongue: [14, 5, 6.2, 1] }[a.mouth];
    const [w, cu, g, teeth] = P, L = 100 - w, R = 100 + w, cy = 121, sy = cy + cu * 0.5;
    const up = `M${L} ${cy - cu} C${100 - w * 0.7} ${cy - cu - 2} ${100 - w * 0.35} ${cy - 5} 97.2 ${cy - 4.4} C98.6 ${cy - 4.2} 99.4 ${cy - 3} 100 ${cy - 2.8} C100.6 ${cy - 3} 101.4 ${cy - 4.2} 102.8 ${cy - 4.4} C${100 + w * 0.35} ${cy - 5} ${100 + w * 0.7} ${cy - cu - 2} ${R} ${cy - cu} Q100 ${sy} ${L} ${cy - cu}Z`;
    const lo = `M${L} ${cy - cu} Q100 ${sy + g} ${R} ${cy - cu} C${100 + w * 0.7} ${cy - cu + 4 + g * 0.6} ${100 + w * 0.4} ${cy + g + (g ? 4.2 : 6) + cu * 0.2} 100 ${cy + g + (g ? 4.4 : 6.2) + cu * 0.25} C${100 - w * 0.4} ${cy + g + (g ? 4.2 : 6) + cu * 0.2} ${100 - w * 0.7} ${cy - cu + 4 + g * 0.6} ${L} ${cy - cu}Z`;
    let m = `<ellipse cx="100" cy="${cy + g + 9.5}" rx="${w * 0.5}" ry="1.8" fill="${skinD}" opacity=".55" ${B2}/>`;
    if (g) {
      const mid = `M${L} ${cy - cu} Q100 ${sy} ${R} ${cy - cu} Q100 ${sy + g} ${L} ${cy - cu}Z`, mc = `${id}m`;
      m += `<clipPath id="${mc}"><path d="${mid}"/></clipPath><path d="${mid}" fill="#45141E"/><g clip-path="url(#${mc})">`;
      if (teeth) m += `<path d="M${L} ${cy - cu - 2} L${R} ${cy - cu - 2} L${R} ${cy - cu + 0.6} Q100 ${sy + 3} ${L} ${cy - cu + 0.6}Z" fill="#FBF6F1"/><path d="M${100 - w * 0.45} ${sy} V${sy + 3} M${100 - w * 0.15} ${sy + 0.6} V${sy + 3.6} M${100 + w * 0.15} ${sy + 0.6} V${sy + 3.6} M${100 + w * 0.45} ${sy} V${sy + 3}" stroke="#E4DAD4" stroke-width=".5"/>`;
      if (a.mouth === 'laugh' || a.mouth === 'tongue') m += `<ellipse cx="100" cy="${sy + g + 1.2}" rx="${w * 0.3}" ry="${a.mouth === 'laugh' ? 2.4 : 1.8}" fill="#A8404F"/><path d="M100 ${sy + g - 2} V${sy + g}" stroke="#A53D4E" stroke-width=".6"/>`;
      m += `</g>`;
    }
    m += `<path d="${up}" fill="${dk(lipBase, 0.12)}"/><path d="${lo}" fill="${lipBase}"/><ellipse cx="100" cy="${cy + g + 3.2}" rx="${w * 0.32}" ry="1.4" fill="${lt(lipBase, 0.55)}" opacity=".6" ${B2}/><path d="M98 ${cy - 3.2} L100 ${cy - 2.2} L102 ${cy - 3.2}" stroke="${lt(lipBase, 0.4)}" stroke-width=".7" fill="none" opacity=".6"/>`;
    if (!g) m += `<path d="M${L} ${cy - cu} Q100 ${sy} ${R} ${cy - cu}" fill="none" stroke="${dk(lipBase, 0.5)}" stroke-width="1" stroke-linecap="round"/>`;
    m += `<circle cx="${L - 0.6}" cy="${cy - cu}" r="1.3" fill="${skinDD}" opacity=".4" ${B2}/><circle cx="${R + 0.6}" cy="${cy - cu}" r="1.3" fill="${skinDD}" opacity=".4" ${B2}/>`;
    if (a.marks === 'dimples') m += `<path d="M${L - 4} ${cy - cu - 2} C${L - 5.4} ${cy - cu} ${L - 5} ${cy - cu + 3} ${L - 3.4} ${cy - cu + 4}" stroke="${skinDD}" stroke-width="1.1" fill="none" opacity=".55"/><path d="M${R + 4} ${cy - cu - 2} C${R + 5.4} ${cy - cu} ${R + 5} ${cy - cu + 3} ${R + 3.4} ${cy - cu + 4}" stroke="${skinDD}" stroke-width="1.1" fill="none" opacity=".55"/>`;
    s.push(a.mouth === 'smirk' ? `<g transform="rotate(-6 100 121) translate(1 0)">${m}</g>` : m);
  }

  // moustache over the lips
  const st = {
    thin: 'M87 117 C91 113 96 112.6 100 114 C104 112.6 109 113 113 117 C108 115.6 104 115.6 100 116.2 C96 115.6 92 115.6 87 117Z',
    chevron: 'M84 119 C86 112 93 109 100 111.6 C107 109 114 112 116 119 C111 116.6 105 116 100 116.8 C95 116 89 116.6 84 119Z',
    handlebar: 'M77 107 C78 115 84 119 91 115.6 C95 113 98 111.6 100 112.6 C102 111.6 105 113 109 115.6 C116 119 122 115 123 107 C124 116 118 121 110 120 C105 118 102 117 100 117.4 C98 117 95 118 90 120 C82 121 76 116 77 107Z',
    pencil: 'M89 115.4 C93 113.6 97 113.6 100 114.4 C103 113.6 107 113.6 111 115.4 C107 115.2 103 115.4 100 115.8 C97 115.4 93 115.2 89 115.4Z',
    walrus: 'M81 121 C81 110 90 107 100 110 C110 107 119 110 119 121 C116 117.6 113 119 111 123 C108 118.6 104 120 100 122 C96 120 92 118.6 89 123 C87 119 84 117.6 81 121Z',
  }[a.stache];
  if (st) s.push(`<path d="${st}" fill="url(#${id}hg)"/><path d="${st}" fill="url(#${id}t)"/><path d="${st}" fill="none" stroke="${hcD}" stroke-width=".6" opacity=".5"/>`);

  // ---------- front hair
  if (!hij) {
    if (cover) {
      if (['long', 'wavy', 'bob', 'curly', 'pony', 'side', 'short', 'pixie', 'quiff'].includes(a.hair)) s.push(`<path d="M56 96 C55 82 58 70 63 66 L71 70 C66 80 65 88 65 98Z M144 96 C145 82 142 70 137 66 L129 70 C134 80 135 88 135 98Z" fill="url(#${id}hg)"/>`);
    } else if (hairFront) {
      const px = { side: 80, pixie: 112, wavy: 118, quiff: 104 }[a.hair] || 100;
      const strands = [[58, 84], [64, 70], [74, 60], [86, 54], [114, 54], [126, 60], [136, 70], [142, 84], [96, 52], [106, 52]];
      s.push(`<path d="${hairFront}" fill="url(#${id}hg)"/><clipPath id="${id}hc"><path d="${hairFront}"/></clipPath><g clip-path="url(#${id}hc)" fill="none" stroke-linecap="round">${strands.map(([x, y], i) => `<path d="M${px} 32 C${(px + x) / 2} ${36 + (i % 3)} ${x + (x < px ? 2 : -2)} ${(y + 34) / 2} ${x} ${y}" stroke="${i % 2 ? hcL : hcD}" stroke-width="${i % 2 ? 0.8 : 1.1}" opacity="${i % 2 ? 0.45 : 0.5}"/>`).join('')}<path d="M70 50 C84 38 116 38 130 50" stroke="${lt(hc, 0.45)}" stroke-width="6" opacity=".35" ${B}/></g><path d="${hairFront}" fill="none" stroke="${hcD}" stroke-width=".8" opacity=".55"/>`);
    }
    if (!cover && a.hair === 'curly') {
      const cs = [[60, 72], [66, 56], [78, 45], [93, 38], [108, 38], [122, 45], [134, 56], [140, 72], [76, 60], [92, 53], [108, 53], [124, 60]];
      s.push(`<path d="M56 84 C54 56 74 36 100 36 C126 36 146 56 144 84 C128 68 116 64 100 64 C84 64 72 68 56 84Z" fill="url(#${id}hg)"/>${cs.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="10" fill="${hc}"/><path d="M${x - 6} ${y} C${x - 5} ${y - 6} ${x + 3} ${y - 7} ${x + 6} ${y - 2}" stroke="${hcL}" stroke-width="1" fill="none" opacity=".5"/><path d="M${x - 5} ${y + 4} C${x - 1} ${y + 7} ${x + 4} ${y + 6} ${x + 7} ${y + 2}" stroke="${hcD}" stroke-width="1" fill="none" opacity=".5"/>`).join('')}`);
    }
    if (!cover && a.hair === 'afro') {
      const cs = [[60, 70], [70, 52], [86, 40], [100, 36], [114, 40], [130, 52], [140, 70]];
      s.push(`<path d="M54 86 C50 52 72 30 100 30 C128 30 150 52 146 86 C128 68 116 62 100 62 C84 62 72 68 54 86Z" fill="url(#${id}hg)"/>${cs.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="12" fill="${hc}"/><circle cx="${x - 3}" cy="${y - 4}" r="5" fill="${hcL}" opacity=".18"/>`).join('')}`);
    }
    if (!cover && a.hair === 'bun') s.push(`<circle cx="100" cy="30" r="17" fill="url(#${id}hg)"/><path d="M88 26 C94 18 106 18 112 26 M86 33 C94 26 106 26 114 33" stroke="${hcL}" stroke-width="1" fill="none" opacity=".5"/><path d="M87 41 C94 46 106 46 113 41" stroke="${hcD}" stroke-width="2" fill="none"/>`);
    if (!cover && a.hair === 'pony') s.push(`<rect x="124" y="54" width="10" height="8" rx="3" fill="${oc}" transform="rotate(30 129 58)"/>`);
    if (a.hair === 'bald') s.push(`<ellipse cx="92" cy="54" rx="16" ry="7" fill="#fff" opacity=".22" ${B}/>`);
    if (a.hair === 'buzz') s.push(`<path d="${frontHair('buzz')}" fill="url(#${id}d)" opacity=".5"/>`);
  }

  // earrings (hidden by a hijab)
  if (!hij && a.ears !== 'none') {
    s.push(mirror(a.ears === 'studs' ? `<circle cx="${ex - 1}" cy="106" r="2.6" fill="url(#${id}gold)"/><circle cx="${ex - 1.8}" cy="105.2" r=".8" fill="#fff" opacity=".8"/>` : `<circle cx="${ex - 1}" cy="112" r="6" fill="none" stroke="url(#${id}gold)" stroke-width="2.2"/>`));
  }

  // glasses
  const glare = `<path d="M75 87 L80 84 M109 87 L114 84" stroke="#fff" stroke-width="1.6" stroke-linecap="round" opacity=".55"/>`;
  const gl = {
    round: `<g fill="#fff" fill-opacity=".1" stroke="${ink}" stroke-width="2.4"><circle cx="83" cy="92" r="11.4"/><circle cx="117" cy="92" r="11.4"/></g><path d="M94.4 90.6 C97 87.6 103 87.6 105.6 90.6 M71.6 90 L60 86 M128.4 90 L140 86" stroke="${ink}" stroke-width="2.2" fill="none" stroke-linecap="round"/>${glare}`,
    square: `<g fill="#fff" fill-opacity=".1" stroke="${ink}" stroke-width="2.5"><rect x="69.5" y="83" width="27" height="19" rx="5"/><rect x="103.5" y="83" width="27" height="19" rx="5"/></g><path d="M96.5 89.5 C98.5 88 101.5 88 103.5 89.5 M69.5 88 L60 85 M130.5 88 L140 85" stroke="${ink}" stroke-width="2.2" fill="none" stroke-linecap="round"/>${glare}`,
    cat: `<g fill="#fff" fill-opacity=".1" stroke="${ink}" stroke-width="2.5" stroke-linejoin="round"><path d="M67 83 C80 81 92 83 96.5 86 C96.5 98 90 101.5 83.5 101.5 C75 101.5 70 97 69 90Z"/><path d="M133 83 C120 81 108 83 103.5 86 C103.5 98 110 101.5 116.5 101.5 C125 101.5 130 97 131 90Z"/></g><path d="M96.5 88.6 C98.5 86.8 101.5 86.8 103.5 88.6 M67 83 L61 79 M133 83 L139 79" stroke="${ink}" stroke-width="2.2" fill="none" stroke-linecap="round"/>${glare}`,
    sun: `<defs><linearGradient id="${id}sg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3a2632"/><stop offset="1" stop-color="#140c11"/></linearGradient></defs><g fill="url(#${id}sg)" stroke="${ink}" stroke-width="2.2"><rect x="68.5" y="83.5" width="29" height="19" rx="8"/><rect x="102.5" y="83.5" width="29" height="19" rx="8"/></g><path d="M73 88 L84 86 M107 88 L118 86" stroke="#fff" stroke-opacity=".35" stroke-width="2.2" stroke-linecap="round"/><path d="M97.5 90 C99 88.6 101 88.6 102.5 90 M68.5 89 L60 86 M131.5 89 L140 86" stroke="${ink}" stroke-width="2.2" fill="none" stroke-linecap="round"/>`,
  }[a.glasses];
  if (gl) s.push(`<g opacity=".25" ${B2} transform="translate(1.5 3)">${gl.replace(/url\(#[^)]+\)/g, '#000').replace(/stroke="#fff"/g, 'stroke="none"')}</g>${gl}`);

  // hats
  if (a.head === 'cap') s.push(`<path d="M55 76 C54 44 72 28 100 28 C128 28 146 44 145 76 C120 68 80 68 55 76Z" fill="url(#${id}kg)"/><path d="M55 76 C80 66 120 66 145 76 C152 79 162 81 170 84 C158 92 140 90 128 85 C110 79 80 79 55 80Z" fill="${dk(hcol, 0.2)}"/><path d="M58 79 C80 73 120 73 142 79" stroke="${dk(hcol, 0.45)}" stroke-width="2" fill="none" opacity=".4" ${B2}/><circle cx="100" cy="29" r="4" fill="${dk(hcol, 0.25)}"/><path d="M100 31 V70 M77 38 C80 52 79 62 78 72 M123 38 C120 52 121 62 122 72" stroke="${dk(hcol, 0.2)}" stroke-width="1.2" fill="none" stroke-dasharray="2 1.6"/>`);
  if (a.head === 'beanie') s.push(`<path d="M54 74 C50 40 70 20 100 20 C130 20 150 40 146 74Z" fill="url(#${id}kg)"/>${[64, 72, 80, 88, 96, 104, 112, 120, 128, 136].map((x) => `<path d="M${x} 26 C${x - (x - 100) * 0.1} 44 ${x} 58 ${x} 66" stroke="${dk(hcol, 0.15)}" stroke-width="1.2" fill="none" opacity=".6"/>`).join('')}<rect x="50" y="62" width="100" height="18" rx="9" fill="${dk(hcol, 0.12)}"/>${[56, 63, 70, 77, 84, 91, 98, 105, 112, 119, 126, 133, 140].map((x) => `<path d="M${x} 64.5 V77.5" stroke="${dk(hcol, 0.32)}" stroke-width="1.4"/>`).join('')}<circle cx="100" cy="18" r="9" fill="${lt(hcol, 0.3)}"/><circle cx="97" cy="15" r="3.5" fill="#fff" opacity=".25"/>`);

  s.push('</g>');
  const vb = VIEWS[opts.view] || VIEWS.full;
  const title = opts.title ? `<title>${String(opts.title).replace(/[<&>]/g, '')}</title>` : '';
  return `<svg class="${opts.cls || 'av-svg'}" viewBox="${vb}" xmlns="http://www.w3.org/2000/svg" role="img"${opts.title ? '' : ' aria-hidden="true"'}>${title}${s.join('')}</svg>`;
}

function frontHair(h) {
  return {
    short: 'M56 88 C52 58 68 35 100 33 C132 35 148 58 144 88 C141 70 134 60 124 55 C112 64 92 64 76 57 C66 62 59 72 56 88Z',
    side: 'M55 92 C49 58 66 33 100 31 C134 33 151 58 145 90 C143 72 138 59 130 51 C112 47 90 54 74 64 C64 70 58 80 55 92Z',
    quiff: 'M57 86 C52 60 64 40 84 33 C92 18 114 16 126 24 C146 34 150 60 144 86 C140 70 134 58 126 53 C110 58 92 58 76 55 C66 60 60 70 57 86Z',
    buzz: 'M58 78 C58 54 74 39 100 38 C126 39 142 54 142 78 C134 62 118 55 100 54 C82 55 66 62 58 78Z',
    pixie: 'M56 90 C50 56 70 33 106 33 C136 35 150 56 144 82 C138 66 128 58 112 60 C98 70 82 70 68 64 C61 72 58 80 56 90Z',
    bob: 'M56 86 C53 56 70 35 100 35 C130 35 147 56 144 86 C134 70 118 63 100 63 C82 63 66 70 56 86Z',
    long: 'M56 98 C50 62 68 35 100 33 C132 35 150 62 144 98 C140 74 126 58 104 51 L100 49 L96 51 C74 58 60 74 56 98Z',
    wavy: 'M56 98 C49 62 70 34 102 33 C134 35 152 62 144 98 C142 78 132 62 118 54 C106 64 88 66 72 60 C63 70 58 82 56 98Z',
    bun: 'M57 82 C56 56 74 40 100 40 C126 40 144 56 143 82 C136 64 118 55 100 54 C82 55 64 64 57 82Z',
    pony: 'M57 82 C56 56 74 40 100 40 C126 40 144 56 143 82 C136 64 118 55 100 54 C82 55 64 64 57 82Z',
  }[h] || '';
}

// Ready-made characters for the sign-in screen (nobody is signed in there yet).
export const CAST = [
  { g: 'f', skin: '#EBB893', face: 'oval', eyes: 'lashes', eyeC: PAL.eye[0], brows: 'arched', makeup: 'liner', makeC: PAL.make[0], nose: 'button', mouth: 'smile', lips: PAL.lips[1], cheeks: 'blush', marks: 'none', hair: 'long', hairC: '#3B2620', stache: 'none', beard: 'none', outfit: 'blazer', outC: PAL.cloth[0], glasses: 'none', ears: 'hoops', head: 'hijab', headC: PAL.cloth[3], bg: 'none' },
  { g: 'm', skin: '#B97C53', face: 'square', eyes: 'happy', eyeC: PAL.eye[1], brows: 'thick', makeup: 'none', makeC: PAL.make[0], nose: 'wide', mouth: 'grin', lips: '', cheeks: 'none', marks: 'lines', hair: 'quiff', hairC: '#1F1A1C', stache: 'chevron', beard: 'short', outfit: 'hoodie', outC: PAL.cloth[1], glasses: 'none', ears: 'none', head: 'none', headC: PAL.cloth[0], bg: 'none' },
  { g: 'f', skin: '#F7CFAF', face: 'heart', eyes: 'big', eyeC: PAL.eye[3], brows: 'natural', makeup: 'shadow', makeC: PAL.make[2], nose: 'dots', mouth: 'laugh', lips: PAL.lips[5], cheeks: 'both', marks: 'none', hair: 'curly', hairC: '#A5432F', stache: 'none', beard: 'none', outfit: 'vneck', outC: PAL.cloth[2], glasses: 'round', ears: 'studs', head: 'none', headC: PAL.cloth[0], bg: 'none' },
  { g: 'm', skin: '#D69C72', face: 'oval', eyes: 'normal', eyeC: PAL.eye[0], brows: 'raised', makeup: 'none', makeC: PAL.make[0], nose: 'pointy', mouth: 'smirk', lips: '', cheeks: 'none', marks: 'mole', hair: 'side', hairC: '#6B4130', stache: 'handlebar', beard: 'none', outfit: 'shirt', outC: PAL.cloth[3], glasses: 'square', ears: 'none', head: 'none', headC: PAL.cloth[0], bg: 'none' },
];
