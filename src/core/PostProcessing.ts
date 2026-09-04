import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { SSAOPass } from "three/addons/postprocessing/SSAOPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { ColorCorrectionShader } from "three/addons/shaders/ColorCorrectionShader.js";
import { VignetteShader } from "three/addons/shaders/VignetteShader.js";

/** Cheap radial "zoom blur" — reads as speed-lines streaking from the screen center outward. */
const SPEED_BLUR_SHADER = {
  uniforms: {
    tDiffuse: { value: null },
    uStrength: { value: 0 },
    uCenter: { value: new THREE.Vector2(0.5, 0.46) },
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
    uniform float uStrength;
    uniform vec2 uCenter;
    varying vec2 vUv;
    const int SAMPLES = 8;
    void main() {
      vec2 dir = uCenter - vUv;
      float dist = length(dir);
      vec4 sum = texture2D(tDiffuse, vUv);
      for (int i = 1; i <= SAMPLES; i++) {
        float t = (float(i) / float(SAMPLES)) * uStrength * dist;
        vec2 uv2 = clamp(vUv + dir * t, 0.0, 1.0);
        sum += texture2D(tDiffuse, uv2);
      }
      gl_FragColor = sum / float(SAMPLES + 1);
    }
  `,
};

export class PostProcessing {
  private readonly composer: EffectComposer;
  private readonly ssaoPass: SSAOPass;
  private readonly speedBlurPass: ShaderPass;

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, width: number, height: number) {
    this.composer = new EffectComposer(renderer);
    this.composer.addPass(new RenderPass(scene, camera));

    this.ssaoPass = new SSAOPass(scene, camera, Math.max(1, width / 2), Math.max(1, height / 2));
    this.ssaoPass.kernelRadius = 10;
    this.ssaoPass.minDistance = 0.002;
    this.ssaoPass.maxDistance = 0.12;
    this.ssaoPass.output = SSAOPass.OUTPUT.Default;
    this.composer.addPass(this.ssaoPass);

    // Threshold sits above the physically-based sky's typical brightness (it renders surprisingly
    // "hot" in linear HDR) so bloom stays reserved for genuine highlights — the sun disc and the
    // cars' emissive lights, which are tuned bright enough on purpose to clear this bar.
    const bloomPass = new UnrealBloomPass(new THREE.Vector2(width, height), 0.3, 0.3, 4.2);
    this.composer.addPass(bloomPass);

    // Tonemap + sRGB-encode HERE, right after bloom — everything below expects display-referred
    // [0,1] color, not raw linear HDR. Grading/vignette/blur before this point (on unclamped HDR
    // values) is what washes the whole image out toward white.
    this.composer.addPass(new OutputPass());

    const colorGrade = new ShaderPass(ColorCorrectionShader);
    colorGrade.uniforms.powRGB.value.set(1.02, 0.99, 0.95);
    colorGrade.uniforms.mulRGB.value.set(1.06, 1.02, 0.97);
    colorGrade.uniforms.addRGB.value.set(0.0, 0.0, 0.01);
    this.composer.addPass(colorGrade);

    const vignette = new ShaderPass(VignetteShader);
    vignette.uniforms.offset.value = 1.05;
    vignette.uniforms.darkness.value = 1.15;
    this.composer.addPass(vignette);

    this.speedBlurPass = new ShaderPass(SPEED_BLUR_SHADER);
    this.composer.addPass(this.speedBlurPass);
  }

  /** 0 = no effect, ~0.3-0.5 = a noticeable high-speed radial streak. */
  setSpeedBlur(strength: number): void {
    this.speedBlurPass.uniforms.uStrength.value = strength;
  }

  setSize(width: number, height: number): void {
    this.composer.setSize(width, height);
    // EffectComposer.setSize resizes every pass to the full resolution, which would undo the
    // half-res AO target we set up for performance — shrink it back down afterwards.
    this.ssaoPass.setSize(Math.max(1, Math.round(width / 2)), Math.max(1, Math.round(height / 2)));
  }

  render(): void {
    this.composer.render();
  }
}
