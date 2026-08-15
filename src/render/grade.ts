import * as THREE from 'three';

// One fullscreen pass that does the anime glow, tone mapping, colour grade, vignette, dither
// and the sRGB conversion. There is deliberately no OutputPass after it: three only tone maps
// and converts colour space when drawing to the default framebuffer, so under a composer that
// work has to happen somewhere, and folding it in here saves a whole pass plus a second full
// mipmap regeneration every frame.

/** Grading master dial. 0 = untouched ACES image, 1 = full look. */
export const GRADE = 1.0;
/** Anime diffusion glow. 0 compiles the mip taps out and lets main.ts drop the mip chain. */
export const GLOW = 0.22;
/** Corner darkening. 0 = off, 1 = heavy. */
export const VIGNETTE = 0.42;
/** Ordered dither amplitude in 8-bit steps. 1 kills sky banding; 0 = off. */
export const DITHER = 1.0;

export const GradeShader = {
  name: 'ToonGradeShader',

  defines: {
    GLOW_ON: GLOW > 0 ? 1 : 0,
  },

  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    toneMappingExposure: { value: 1.05 },
    uGrade: { value: GRADE },
    uGlow: { value: GLOW },
    uVignette: { value: VIGNETTE },
    uDither: { value: DITHER },
  },

  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,

  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uGrade;
    uniform float uGlow;
    uniform float uVignette;
    uniform float uDither;
    varying vec2 vUv;

    // Pulls in three's own ACESFilmicToneMapping() so the tone curve stays identical to what
    // renderer.toneMapping used to do. Do NOT also include <colorspace_pars_fragment>: three
    // already injects it into every ShaderMaterial and a second include fails to compile.
    #include <tonemapping_pars_fragment>

    const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);

    const vec3  WARMTH        = vec3(1.045, 1.000, 0.925);
    const float GLOW_KNEE     = 0.55;
    const vec3  SHADOW_TINT   = vec3(0.920, 0.970, 1.100);
    const vec3  HIGH_TINT     = vec3(1.060, 1.015, 0.920);
    const float CONTRAST      = 0.18;
    const float SATURATION    = 1.14;
    const vec3  LIFT          = vec3(0.028, 0.032, 0.050);
    const vec3  VIGNETTE_TINT = vec3(0.52, 0.50, 0.62);

    void main() {
      vec3 hdr = texture2D(tDiffuse, vUv).rgb;

      // The composer target's mip chain is the blur pyramid, regenerated for free when three
      // unbinds the target, so the glow costs three taps rather than a blur pass.
      #if GLOW_ON
        vec3 blur = texture2DLodEXT(tDiffuse, vUv, 2.0).rgb * 0.30
                  + texture2DLodEXT(tDiffuse, vUv, 4.0).rgb * 0.40
                  + texture2DLodEXT(tDiffuse, vUv, 6.0).rgb * 0.30;
        vec3 bright = max(blur - vec3(GLOW_KNEE), vec3(0.0)) / (1.0 - GLOW_KNEE);
        hdr += bright * uGlow;
      #endif

      vec3 neutral = ACESFilmicToneMapping(hdr);
      vec3 c       = ACESFilmicToneMapping(hdr * WARMTH);

      float l = dot(c, LUMA);
      c *= mix(SHADOW_TINT, HIGH_TINT, smoothstep(0.12, 0.78, l));
      c = clamp(c, 0.0, 1.0);

      // Monotonic S-curve: maps 0->0 and 1->1 so it cannot clip. A pivot contrast crushed the
      // toon shadow band to solid black.
      c = mix(c, c * c * (3.0 - 2.0 * c), CONTRAST);

      c = mix(vec3(dot(c, LUMA)), c, SATURATION);
      c = LIFT + clamp(c, 0.0, 1.0) * (1.0 - LIFT);

      vec2 d = vUv - 0.5;
      float vig = smoothstep(0.78, 0.12, dot(d, d) * 2.0);
      c = mix(c * VIGNETTE_TINT, c, mix(1.0, vig, uVignette));

      c = mix(neutral, c, uGrade);

      vec4 outColor = sRGBTransferOETF(vec4(c, 1.0));

      // R2 ordered dither, half an 8-bit step, against banding in the sky gradient.
      float n = fract(dot(gl_FragCoord.xy, vec2(0.7548776662, 0.5698402910)));
      outColor.rgb += (n - 0.5) * uDither / 255.0;

      gl_FragColor = vec4(outColor.rgb, 1.0);
    }
  `,
};
