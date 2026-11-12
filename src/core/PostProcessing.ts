import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import type { ColorGrade } from "../track/TrackCatalog";

/**
 * Threshold sits above anything daylight alone can produce — a white kerb in full sun lands near
 * 1.5 in HDR — so only a mirrored sun in a clearcoat panel, chrome, glass and the exhaust flame
 * ever bloom. Lower it and the whole circuit hazes over.
 */
const BLOOM_THRESHOLD = 2.4;
const BLOOM_STRENGTH = 0.55;
const BLOOM_RADIUS = 0.4;
/** Bloom runs at half resolution. It is a blur of the brightest pixels; nobody can tell. */
const BLOOM_SCALE = 0.5;
/**
 * The most a single pixel may feed into the bloom. With the sun low, a flat lacquered panel
 * mirrors it straight at the camera at thousands of times white, and unclamped that one glint
 * blooms into a ball of light bigger than the car. The glint itself is left alone.
 */
const BLOOM_CEILING = 6;

/**
 * The look of each circuit's hour of day, applied to the finished display-space image: a split
 * tone (cool shadows against warm highlights, or the reverse), saturation, contrast and a vignette.
 * It runs after tone mapping on purpose — these are picture adjustments, not lighting.
 */
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null }, saturation: { value: 1 }, contrast: { value: 1 }, vignette: { value: 0 },
    shadows: { value: new THREE.Vector3(1, 1, 1) }, highlights: { value: new THREE.Vector3(1, 1, 1) },
  },
  vertexShader: "varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float saturation;
    uniform float contrast;
    uniform float vignette;
    uniform vec3 shadows;
    uniform vec3 highlights;
    varying vec2 vUv;
    void main() {
      vec3 color = texture2D(tDiffuse, vUv).rgb;
      float luma = dot(color, vec3(0.2126, 0.7152, 0.0722));
      color *= mix(shadows, highlights, smoothstep(0.12, 0.78, luma));
      color = mix(vec3(luma), color, saturation);
      color = (color - 0.5) * contrast + 0.5;
      color *= 1.0 - vignette * smoothstep(0.35, 0.95, distance(vUv, vec2(0.5)) * 1.25);
      gl_FragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
    }`,
};

/** Multisampled HDR render target: crisp daylight without full-screen blur or dark AO halos. */
export class PostProcessing {
  private readonly composer: EffectComposer;
  private readonly bloom: UnrealBloomPass;
  private readonly grade = new ShaderPass(GradeShader);

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, width: number, height: number) {
    const target = new THREE.WebGLRenderTarget(width, height, { type: THREE.HalfFloatType });
    target.samples = Math.min(4, renderer.capabilities.maxSamples);
    this.composer = new EffectComposer(renderer, target);
    this.composer.setPixelRatio(renderer.getPixelRatio());
    this.composer.addPass(new RenderPass(scene, camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(width * BLOOM_SCALE, height * BLOOM_SCALE),
      BLOOM_STRENGTH, BLOOM_RADIUS, BLOOM_THRESHOLD);
    // ponytail: patches one line of three's own high-pass shader. If an upgrade rewords that line
    // the clamp silently stops applying and the flare comes back; write our own high-pass then.
    const highPass = this.bloom.materialHighPassFilter;
    highPass.fragmentShader = highPass.fragmentShader.replace("mix( outputColor, texel, alpha )",
      `mix( outputColor, min( texel, vec4( ${BLOOM_CEILING.toFixed(1)} ) ), alpha )`);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.composer.addPass(this.grade);
    this.setSize(width, height);
  }

  setSize(width: number, height: number): void {
    this.composer.setSize(width, height);
    this.bloom.setSize(width * BLOOM_SCALE, height * BLOOM_SCALE);
  }
  setGrade(grade: ColorGrade): void {
    const uniforms = this.grade.uniforms;
    uniforms.saturation.value = grade.saturation;
    uniforms.contrast.value = grade.contrast;
    uniforms.vignette.value = grade.vignette;
    uniforms.shadows.value.fromArray(grade.shadows);
    uniforms.highlights.value.fromArray(grade.highlights);
  }
  render(): void { this.composer.render(); }
}
