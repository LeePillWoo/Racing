// three.js ships its `examples/jsm` addons (aliased as `three/addons/*`) without bundled .d.ts
// files. These loose ambient declarations just unblock `tsc` for the exact modules we import —
// full fidelity isn't needed since we only touch a handful of documented properties/methods.

declare module "three/addons/postprocessing/EffectComposer.js" {
  export class EffectComposer {
    constructor(renderer?: any, renderTarget?: any);
    readonly [key: string]: any;
  }
}

declare module "three/addons/postprocessing/Pass.js" {
  export class Pass {
    enabled: boolean;
    needsSwap: boolean;
    readonly [key: string]: any;
  }
  export class FullScreenQuad {
    constructor(material?: any);
    readonly [key: string]: any;
  }
}

declare module "three/addons/postprocessing/RenderPass.js" {
  import { Pass } from "three/addons/postprocessing/Pass.js";
  export class RenderPass extends Pass {
    constructor(scene: any, camera: any);
  }
}

declare module "three/addons/postprocessing/UnrealBloomPass.js" {
  import { Pass } from "three/addons/postprocessing/Pass.js";
  export class UnrealBloomPass extends Pass {
    constructor(resolution?: any, strength?: number, radius?: number, threshold?: number);
    strength: number;
    radius: number;
    threshold: number;
  }
}

declare module "three/addons/postprocessing/SSAOPass.js" {
  import { Pass } from "three/addons/postprocessing/Pass.js";
  export class SSAOPass extends Pass {
    constructor(scene: any, camera: any, width?: number, height?: number, kernelSize?: number);
    static OUTPUT: { Default: number; SSAO: number; Blur: number; Depth: number; Normal: number };
    output: number;
    kernelRadius: number;
    minDistance: number;
    maxDistance: number;
  }
}

declare module "three/addons/postprocessing/ShaderPass.js" {
  import { Pass } from "three/addons/postprocessing/Pass.js";
  export class ShaderPass extends Pass {
    constructor(shader: any, textureID?: string);
    uniforms: Record<string, { value: any }>;
    material: any;
  }
}

declare module "three/addons/postprocessing/OutputPass.js" {
  import { Pass } from "three/addons/postprocessing/Pass.js";
  export class OutputPass extends Pass {
    constructor();
  }
}

declare module "three/addons/shaders/ColorCorrectionShader.js" {
  export const ColorCorrectionShader: {
    uniforms: Record<string, { value: any }>;
    vertexShader: string;
    fragmentShader: string;
  };
}

declare module "three/addons/shaders/VignetteShader.js" {
  export const VignetteShader: {
    uniforms: Record<string, { value: any }>;
    vertexShader: string;
    fragmentShader: string;
  };
}

declare module "three/addons/objects/Sky.js" {
  import { Mesh } from "three";
  export class Sky extends Mesh {
    constructor();
    static SkyShader: any;
    readonly [key: string]: any;
  }
}

declare module "three/addons/geometries/RoundedBoxGeometry.js" {
  import { BufferGeometry } from "three";
  export class RoundedBoxGeometry extends BufferGeometry {
    constructor(width?: number, height?: number, depth?: number, segments?: number, radius?: number);
  }
}
