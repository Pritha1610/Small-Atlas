const HASH = (x: number, y: number, z: number): number => {
  let n = Math.imul(x, 0x27d4eb2d) ^ Math.imul(y, 0x165667b1) ^ Math.imul(z, 0x9e3779b9);
  n = Math.imul(n ^ (n >>> 15), 0x85ebca6b);
  n = Math.imul(n ^ (n >>> 13), 0xc2b2ae35);
  n ^= n >>> 16;
  return (n >>> 0) / 4294967295;
};

const SMOOTH = (t: number): number => t * t * (3 - 2 * t);

export function valueNoise(x: number, y: number, z: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const zi = Math.floor(z);
  const xf = x - xi;
  const yf = y - yi;
  const zf = z - zi;
  const u = SMOOTH(xf);
  const v = SMOOTH(yf);
  const w = SMOOTH(zf);

  const c000 = HASH(xi, yi, zi);
  const c100 = HASH(xi + 1, yi, zi);
  const c010 = HASH(xi, yi + 1, zi);
  const c110 = HASH(xi + 1, yi + 1, zi);
  const c001 = HASH(xi, yi, zi + 1);
  const c101 = HASH(xi + 1, yi, zi + 1);
  const c011 = HASH(xi, yi + 1, zi + 1);
  const c111 = HASH(xi + 1, yi + 1, zi + 1);

  const x00 = c000 + (c100 - c000) * u;
  const x10 = c010 + (c110 - c010) * u;
  const x01 = c001 + (c101 - c001) * u;
  const x11 = c011 + (c111 - c011) * u;
  const y0 = x00 + (x10 - x00) * v;
  const y1 = x01 + (x11 - x01) * v;
  return y0 + (y1 - y0) * w;
}

export function fbm(
  x: number,
  y: number,
  z: number,
  octaves: number,
  freq: number,
  lacunarity = 2,
  gain = 0.5
): number {
  let sum = 0;
  let amp = 1;
  let norm = 0;
  let f = freq;
  for (let i = 0; i < octaves; i++) {
    sum += valueNoise(x * f, y * f, z * f) * amp;
    norm += amp;
    amp *= gain;
    f *= lacunarity;
  }
  return sum / norm;
}
