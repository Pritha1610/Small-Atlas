import * as THREE from 'three';

/**
 * Seconds for one full round trip: early morning -> midday -> late afternoon -> back again.
 * The one dial. Below ~180s the flat-shaded facets visibly pop as a toon band boundary sweeps
 * across them.
 */
export const DAY_SECONDS = 300;

// Elevation is measured off the world XZ plane and stays strictly positive at both ends, so
// the sun is never below the world horizon.
//
// Inherent caveat, not a bug: because elevation never goes negative and azimuth is bounded,
// roughly a tenth of the globe opposite the sun's patch never receives direct light at any
// phase, and a symmetric tenth is always lit. Widening the azimuth does not help; only letting
// the sun actually set would, which is the thing that was ruled out. The fill light below is
// what keeps that cap readable.
const EL_MIN = THREE.MathUtils.degToRad(8);
const EL_MAX = THREE.MathUtils.degToRad(62);
const AZ_FROM = THREE.MathUtils.degToRad(-70);
const AZ_TO = THREE.MathUtils.degToRad(70);
const SUN_DIST = 140;

// How far fog is pulled off the horizon colour toward the zenith. The sky shader blends
// horizon->zenith with smoothstep(-0.05, 0.55, y), so at the eye-level band it is already part
// zenith; this makes fog match what is actually painted behind the ridges.
const FOG_LIFT = 0.18;

// Keyframes are PRE-GRADE (scene-referred). Measured through the real grade chain rather than
// assumed: the exposure lift happens in linear space inside ACES and the tone curve compresses
// almost all of it back out, so the net effect is a modest lift plus a little chroma. Author
// these at roughly the value you want to see; pre-darkening makes the low sun read as dusk,
// which is the one thing this feature must not do.
//
// The high-sun set is byte-for-byte what shipped before, so midday cannot regress.
const LO = {
  sun: new THREE.Color(0xffb46a),
  sunI: 1.55,
  hemiSky: new THREE.Color(0x8fb3e8),
  hemiGround: new THREE.Color(0x6a5c48),
  hemiI: 0.92,
  fill: new THREE.Color(0x5f79bc),
  fillI: 0.8,
  zenith: new THREE.Color(0x4272a8),
  horizon: new THREE.Color(0xdfa066),
  below: new THREE.Color(0xb87d63),
};

const HI = {
  sun: new THREE.Color(0xffe3bd),
  sunI: 2.0,
  hemiSky: new THREE.Color(0xbfd4ff),
  hemiGround: new THREE.Color(0x8a7a5f),
  hemiI: 1.0,
  fill: new THREE.Color(0x6d86c8),
  fillI: 0.6,
  zenith: new THREE.Color(0x4a90d9),
  horizon: new THREE.Color(0xf0d9a8),
  below: new THREE.Color(0xc88b6a),
};

export function updateDaylight(
  elapsed: number,
  sun: THREE.DirectionalLight,
  fill: THREE.HemisphereLight,
  hemi: THREE.HemisphereLight,
  skyMat: THREE.ShaderMaterial,
  fog: THREE.Fog
): void {
  // p is the only sawtooth. s = 0.5 - 0.5*cos(2*pi*p) is both smooth and 1-periodic in p, and
  // everything downstream is a smooth function of s, so the loop is seamless in value AND in
  // velocity: the sun eases to a stop at dawn and reverses. A triangle wave would keep the
  // value continuous but flip the derivative, and the sun would visibly bounce.
  const p = (elapsed / DAY_SECONDS + 0.12) % 1;
  const s = 0.5 - 0.5 * Math.cos(p * Math.PI * 2);

  // Normalised elevation: 0 at both extremes, 1 at midday. Everything visual keys to this
  // rather than to phase, so morning and afternoon match from a single keyframe pair.
  const k = Math.sin(Math.PI * s);
  // Smoothstep: golden holds while the sun is low, swings through quickly, settles at midday.
  const w = k * k * (3 - 2 * k);

  const el = EL_MIN + (EL_MAX - EL_MIN) * k;
  const az = AZ_FROM + (AZ_TO - AZ_FROM) * s;
  const ce = Math.cos(el);
  sun.position.set(ce * Math.sin(az), Math.sin(el), ce * Math.cos(az)).multiplyScalar(SUN_DIST);
  // three aims a hemisphere light by its position, so parking this opposite the sun makes it
  // peak on the dark side and fall to nothing at the sub-solar point.
  fill.position.copy(sun.position).negate();

  // Colors hold linear-sRGB, so these blends are physically linear. Lerping in sRGB would put
  // grey-brown mud in the middle of the blue-to-gold zenith transition.
  sun.color.lerpColors(LO.sun, HI.sun, w);
  sun.intensity = LO.sunI + (HI.sunI - LO.sunI) * w;
  fill.color.lerpColors(LO.fill, HI.fill, w);
  fill.intensity = LO.fillI + (HI.fillI - LO.fillI) * w;
  hemi.color.lerpColors(LO.hemiSky, HI.hemiSky, w);
  hemi.groundColor.lerpColors(LO.hemiGround, HI.hemiGround, w);
  hemi.intensity = LO.hemiI + (HI.hemiI - LO.hemiI) * w;

  // Mutating uniform.value in place is all that is needed; three re-uploads uniforms every
  // draw. Setting skyMat.needsUpdate would recompile the sky shader every frame.
  const zenith = skyMat.uniforms.uZenith.value as THREE.Color;
  const horizon = skyMat.uniforms.uHorizon.value as THREE.Color;
  zenith.lerpColors(LO.zenith, HI.zenith, w);
  horizon.lerpColors(LO.horizon, HI.horizon, w);
  (skyMat.uniforms.uBelow.value as THREE.Color).lerpColors(LO.below, HI.below, w);

  // THREE.Fog copies into its own Color, so fog was never aliased to the sky uniform and this
  // write is mandatory. Skip it and fog sits frozen at midday cream while the sky swings gold.
  fog.color.copy(horizon).lerp(zenith, FOG_LIFT);
}
