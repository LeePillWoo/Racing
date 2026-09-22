import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";

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

/** Multisampled HDR render target: crisp daylight without full-screen blur or dark AO halos. */
export class PostProcessing {
  private readonly composer: EffectComposer;
  private readonly bloom: UnrealBloomPass;

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, width: number, height: number) {
    const target = new THREE.WebGLRenderTarget(width, height, { type: THREE.HalfFloatType });
    target.samples = Math.min(4, renderer.capabilities.maxSamples);
    this.composer = new EffectComposer(renderer, target);
    this.composer.setPixelRatio(renderer.getPixelRatio());
    this.composer.addPass(new RenderPass(scene, camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(width * BLOOM_SCALE, height * BLOOM_SCALE),
      BLOOM_STRENGTH, BLOOM_RADIUS, BLOOM_THRESHOLD);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.setSize(width, height);
  }

  setSize(width: number, height: number): void {
    this.composer.setSize(width, height);
    this.bloom.setSize(width * BLOOM_SCALE, height * BLOOM_SCALE);
  }
  render(): void { this.composer.render(); }
}
