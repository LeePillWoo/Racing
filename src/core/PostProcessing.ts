import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";

/** Multisampled HDR render target: crisp daylight without full-screen blur or dark AO halos. */
export class PostProcessing {
  private readonly composer: EffectComposer;

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, width: number, height: number) {
    const target = new THREE.WebGLRenderTarget(width, height, { type: THREE.HalfFloatType });
    target.samples = Math.min(4, renderer.capabilities.maxSamples);
    this.composer = new EffectComposer(renderer, target);
    this.composer.setPixelRatio(renderer.getPixelRatio());
    this.composer.addPass(new RenderPass(scene, camera));
    this.composer.addPass(new OutputPass());
    this.setSize(width, height);
  }

  setSize(width: number, height: number): void { this.composer.setSize(width, height); }
  render(): void { this.composer.render(); }
}
