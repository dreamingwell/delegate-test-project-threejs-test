import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { BaseDemo } from "../engine/BaseDemo.js";

/**
 * Shaders demo — "SDF Raymarch", a real custom GLSL `THREE.ShaderMaterial`.
 *
 * This is the second big capability gap the gallery left open: none of
 * frontier/local/horizon/instancing uses a CUSTOM shader — they all rely on
 * three's built-in materials. Here the whole visible image is produced by a
 * hand-written GLSL fragment shader that raymarches a signed-distance-field
 * (SDF) scene in screen space. No three geometry (other than a single
 * full-screen quad) and no three lighting: the lighting, soft shadows,
 * ambient occlusion, fresnel, distance fog and tonemapping are all computed
 * per-pixel in GLSL.
 *
 * How it is built (the engine contract, see engine/Engine.js):
 *   - A single full-screen quad (THREE.PlaneGeometry(2,2)) is added to the
 *     shared scene. Its vertex shader writes clip coordinates directly
 *     (`gl_Position = vec4(position.xy, 0.0, 1.0)`), so the quad always
 *     covers the whole screen regardless of camera transform or world
 *     placement — the canonical full-screen-quad trick. (Because we override
 *     gl_Position, the quad's world position is irrelevant; it does not need
 *     to be pinned to the camera.)
 *   - The fragment shader UNPROJECTS each pixel into a world-space ray using
 *     the camera's inverse view-projection (a uniform updated every frame),
 *     then raymarches an animated SDF scene (a morphing smooth-union cluster
 *     over an infinite grid floor) with soft shadows, ambient occlusion,
 *     fresnel, distance fog and an ACES-ish tonemap.
 *   - Because the rays come from the REAL camera, OrbitControls (which
 *     orbits the engine camera) genuinely orbits the raymarched scene — the
 *     custom shader and the shared camera/engine contract work together.
 *
 * Built on the shared engine + the BaseDemo scaffold (engine/BaseDemo.js).
 * Builds into container.engine.scene/.camera/.renderer and registers
 * per-frame work with the engine's single rAF loop. The shared boilerplate
 * (active guard, HUD management, fog/background clear) is inherited; this
 * subclass adds only the quad + ShaderMaterial build, the per-frame uniform
 * + inverse-view-projection update, and the teardown the engine cannot infer
 * (OrbitControls.dispose() removes its own canvas listeners; the quad
 * geometry + ShaderMaterial are disposed here and again by the engine's
 * reset()).
 *
 * No performance number is claimed here — a 60fps@1080p measurement is
 * #TJL-10's job with a real GL context. The headless harness (verify/run.mjs)
 * runs this demo's real JS lifecycle (init/mount/update/destroy) against a
 * faithful DOM/WebGL stub and proves it loads clean and unloads leak-free; it
 * does NOT compile the GLSL (it drives update(), not composer.render()).
 *
 * Demo contract (see engine/Engine.js):
 *   export function init(container) -> { update, destroy }
 */

// ---------------------------------------------------------------------------
// GLSL sources. Written for three's DEFAULT ShaderMaterial (no `#version`
// line => GLSL ES 1.00 style: `attribute`/`varying`/`gl_FragColor`), which is
// what three emits by default even on a WebGL2 context. Deliberately avoids
// `fwidth`/derivatives so it compiles on both WebGL1 and WebGL2 contexts.
// ---------------------------------------------------------------------------

const VERT = /* glsl */ `
  // Full-screen quad. The quad is PlaneGeometry(2,2), whose vertices already
  // span [-1,1] in x/y. Writing clip coordinates directly (w = 1) makes the
  // quad cover the entire screen for any camera transform — we deliberately
  // ignore modelViewProjectionMatrix here.
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const FRAG = /* glsl */ `
  precision highp float;

  uniform float uTime;
  uniform vec2  uResolution;   // drawing-buffer size (px)
  uniform vec3  uCamPos;       // camera world position
  uniform mat4  uInvViewProj;  // inverse of (projection * view)

  varying vec2 vUv;

  // ---- small math helpers ----
  vec2 opU(vec2 a, vec2 b) { return b.y - a.y < 0.0 ? b : a; } // keep min 2nd
  float smin(float a, float b, float k) {
    float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
    return mix(b, a, h) - k * h * (1.0 - h);
  }
  float hash11(float p) {
    p = fract(p * 0.1031);
    p *= p + 33.33;
    p *= p + p;
    return fract(p);
  }

  // ---- SDF primitives ----
  float sdSphere(vec3 p, float r) { return length(p) - r; }
  float sdTorus(vec3 p, vec2 t) {
    vec2 q = vec2(length(p.xz) - t.x, p.y);
    return length(q) - t.y;
  }
  float sdRoundBox(vec3 p, vec3 b, float r) {
    vec3 q = abs(p) - b;
    return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0) - r;
  }

  // ---- the SDF scene: a morphing smooth-union cluster over an infinite
  //      grid floor. Returns (distance, material). Material 1 = object,
  //      2 = floor. ----
  const float MAT_OBJ = 1.0;
  const float MAT_FLOOR = 2.0;

  vec2 map(vec3 p) {
    float t = uTime;

    // Morphing cluster: three smooth-blended primitives that drift and pulse
    // so the SDF is continuously deforming (shows a live raymarch).
    float s = 0.62 + 0.12 * sin(t * 0.9);
    vec3 a = vec3(sin(t * 0.60), cos(t * 0.50) * 0.25, cos(t * 0.80)) * (0.7 * s);
    vec3 b = vec3(cos(t * 0.45) * 0.7, sin(t * 0.70) * 0.25, sin(t * 0.65)) * s;
    vec3 c = vec3(0.0, sin(t * 0.5) * 0.2, 0.0);

    float d = 1e5;
    d = smin(d, sdSphere(p - a, s * 0.95), 0.28);
    d = smin(d, sdTorus(vec3(p.x, p.z - b.y, p.y), vec2(1.05 * s, 0.28)), 0.30);
    d = smin(d, sdRoundBox(p - c, vec3(0.55 * s), 0.22), 0.30);

    vec2 res = vec2(d, MAT_OBJ);

    // Infinite grid floor at y = -1.1.
    res = opU(res, vec2(p.y + 1.1, MAT_FLOOR));

    return res;
  }

  // surface normal via a compact 4-tap gradient
  vec3 calcNormal(vec3 p) {
    const vec2 e = vec2(1.0, -1.0) * 0.0008;
    return normalize(
      e.xyy * map(p + e.xyy).x +
      e.yyx * map(p + e.yyx).x +
      e.yxy * map(p + e.yxy).x +
      e.xxx * map(p + e.xxx).x
    );
  }

  // soft shadow (progressive)
  float softShadow(vec3 ro, vec3 rd, float mint, float maxt, float k) {
    float res = 1.0;
    float t = mint;
    for (int i = 0; i < 24; i++) {
      float h = map(ro + rd * t).x;
      res = min(res, k * h / t);
      t += clamp(h, 0.02, 0.18);
      if (res < 0.005 || t > maxt) break;
    }
    return clamp(res, 0.0, 1.0);
  }

  // ambient occlusion (progressive)
  float calcAO(vec3 p, vec3 n) {
    float occ = 0.0;
    float sca = 1.0;
    for (int i = 0; i < 5; i++) {
      float h = 0.01 + 0.12 * float(i) / 4.0;
      float d = map(p + n * h).x;
      occ += (d - h) * sca;
      sca *= 0.85;
    }
    return clamp(1.0 - 2.2 * occ, 0.0, 1.0);
  }

  // grid line strength for the floor (derivative-free; avoids fwidth so the
  // shader compiles on both WebGL1 and WebGL2 contexts)
  float grid(vec2 p) {
    vec2 i = fract(p);
    vec2 g = abs(i - 0.5);
    float line = min(g.x, g.y);
    return 1.0 - smoothstep(0.40, 0.5, line);
  }

  // ACES-ish tonemap
  vec3 aces(vec3 x) {
    float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
    return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
  }

  // material shading for a hit point
  vec3 shade(vec3 p, vec3 n, vec3 rd, float mat) {
    const vec3 sunDir = normalize(vec3(-0.6, 0.7, -0.35));
    const vec3 sunCol = vec3(1.0, 0.96, 0.9);

    vec3 albedo;
    float roughness;
    if (mat < 1.5) {
      // object: cool teal -> magenta by normal
      albedo = mix(vec3(0.16, 0.55, 0.62), vec3(0.72, 0.25, 0.85), n.z * 0.5 + 0.5);
      roughness = 0.30;
    } else {
      // floor: dark with a subtle grid
      float gline = grid(p.xz);
      albedo = vec3(0.05, 0.06, 0.09) + vec3(0.22, 0.42, 0.75) * gline;
      roughness = 0.55;
    }

    float dif = clamp(dot(n, sunDir), 0.0, 1.0);
    float sha = softShadow(p + n * 0.001, sunDir, 0.02, 6.0, 16.0);
    float ao = calcAO(p, n);
    float fre = pow(clamp(1.0 + dot(n, -rd), 0.0, 1.0), 3.0);

    // spec (Blinn-Phong-ish)
    vec3 h = normalize(sunDir - rd);
    float spe = pow(clamp(dot(n, h), 0.0, 1.0), mix(48.0, 8.0, roughness));

    vec3 col = vec3(0.0);
    // sky/ambient
    vec3 sky = mix(vec3(0.05, 0.07, 0.12), vec3(0.28, 0.42, 0.66), 0.5 + 0.5 * rd.y);
    col += albedo * (0.35 + 0.65 * ao) * sky * (mat < 1.5 ? 0.6 : 1.0);
    // sun
    col += albedo * dif * sha * sunCol * (mat < 1.5 ? 1.1 : 0.7);
    // spec + fresnel rim
    col += sunCol * spe * (1.0 - roughness) * (mat < 1.5 ? 0.9 : 0.35);
    col += fre * (mat < 1.5 ? vec3(0.5, 0.7, 1.0) : vec3(0.15, 0.25, 0.4)) * ao;

    return col;
  }

  void main() {
    vec2 uv = vUv * 2.0 - 1.0;
    uv.x *= uResolution.x / uResolution.y; // aspect-correct

    // Unproject the pixel into a world-space ray (using the real camera).
    vec4 clip = vec4(uv, 1.0, 1.0);
    vec4 wp = uInvViewProj * clip;
    vec3 ro = uCamPos;
    vec3 rd = normalize(wp.xyz / wp.w - ro);

    // ---- raymarch ----
    float t = 0.0;
    float mat = -1.0;
    for (int i = 0; i < 96; i++) {
      vec3 p = ro + rd * t;
      vec2 h = map(p);
      if (h.x < 0.0012 * t + 0.0008) { mat = h.y; break; }
      t += h.x;
      if (t > 30.0) break;
    }

    // background: vertical sky + faint starfield for depth
    vec3 bg = mix(vec3(0.03, 0.04, 0.07), vec3(0.10, 0.16, 0.28), 0.5 + 0.5 * rd.y);
    float stars = step(0.997, hash11(dot(floor(rd * 320.0), 7.13))) * 0.4;
    bg += vec3(stars) * (0.5 + 0.5 * rd.y);

    vec3 col;
    if (mat < 0.0) {
      col = bg;
    } else {
      vec3 p = ro + rd * t;
      vec3 n = calcNormal(p);
      col = shade(p, n, rd, mat);
      // distance fog
      float fog = 1.0 - exp(-0.0009 * t * t);
      col = mix(col, bg, fog);
    }

    col = aces(col * 1.15);
    col = pow(col, vec3(1.0 / 2.2));

    // vignette (center ~1.0, corners ~0.45)
    vec2 q = vUv - 0.5;
    col *= 1.0 - 0.55 * dot(q, q) * 2.0;
    col = clamp(col, 0.0, 1.0);

    gl_FragColor = vec4(col, 1.0);
  }
`;

class Shaders extends BaseDemo {
  mount(engine) {
    const { scene, camera, renderer } = engine;
    this.scene = scene;
    this.camera = camera;
    this._renderer = renderer;

    // ---- Scene setup ----
    // The whole image is the shader; no scene fog/background needed. Set a
    // clear color so the canvas isn't transparent before the first frame.
    renderer.setClearColor(0x05060c);
    camera.position.set(0, 1.1, 5.2);
    camera.near = 0.1;
    camera.far = 100;
    camera.updateProjectionMatrix();

    // Orbit controls bound to the shared canvas. It attaches its own
    // pointer/wheel listeners directly to renderer.domElement — unmount()
    // calls controls.dispose() to remove them. Because the shader's rays
    // come from this camera, orbiting genuinely orbits the raymarched scene.
    this.controls = new OrbitControls(camera, renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.06;
    this.controls.minDistance = 2.2;
    this.controls.maxDistance = 14.0;
    this.controls.maxPolarAngle = Math.PI * 0.49; // stay just above the floor
    this.controls.autoRotate = true;
    this.controls.autoRotateSpeed = 0.5;
    this.controls.target.set(0, 0.0, 0);

    // ---- Full-screen quad + custom ShaderMaterial ----
    this.geo = new THREE.PlaneGeometry(2, 2);
    this._res = new THREE.Vector2(1, 1);
    this._m = new THREE.Matrix4();
    this._m2 = new THREE.Matrix4();
    this.uniforms = {
      uTime: { value: 0 },
      uResolution: { value: new THREE.Vector2(1, 1) },
      uCamPos: { value: new THREE.Vector3() },
      uInvViewProj: { value: new THREE.Matrix4() },
    };
    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: VERT,
      fragmentShader: FRAG,
      depthTest: false,
      depthWrite: false,
    });
    this.quad = new THREE.Mesh(this.geo, this.material);
    this.quad.frustumCulled = false;
    // The vertex shader writes clip coords directly, so the quad fills the
    // screen regardless of where it sits; a plain scene child is enough and
    // lets the engine's reset() remove + dispose it normally.
    scene.add(this.quad);

    // Seed the resolution uniform with the current drawing-buffer size.
    renderer.getDrawingBufferSize(this._res);
    this.uniforms.uResolution.value.copy(this._res);

    // ---- HUD (title + hint). Scoped to the demo container by the BaseDemo
    //      scaffold and removed on destroy(). The "back to demos" affordance
    //      is provided by the gallery shell. ----
    this.createHud({
      id: "shaders-hud",
      cssText:
        "position:absolute;top:14px;left:16px;color:#cfe8ff;" +
        "font:13px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;" +
        "text-shadow:0 0 6px rgba(120,140,255,0.7);" +
        "pointer-events:none;user-select:none;",
      html:
        '<div><b style="color:#fff">SDF Raymarch</b> — a custom GLSL <code>ShaderMaterial</code></div>' +
        "<div>per-pixel raymarched signed-distance fields &middot; soft shadows &middot; AO &middot; tonemap</div>" +
        "<div>drag to orbit &middot; scroll to zoom</div>",
    });
  }

  update(_delta, elapsed) {
    const cam = this.camera;
    this.uniforms.uTime.value = elapsed;

    // Finalize the camera pose for this frame first, then sample it.
    this.controls.update();

    // Keep the resolution uniform in sync with the drawing buffer (handles
    // the engine's window-resize for free).
    this._renderer.getDrawingBufferSize(this._res);
    this.uniforms.uResolution.value.copy(this._res);

    // Pass the real camera's world position + inverse view-projection so the
    // fragment shader can unproject each pixel into a world-space ray.
    cam.updateMatrixWorld();
    // View = inverse(camera world matrix);  ViewProj = projection * view.
    const V = this._m.copy(cam.matrixWorld).invert();
    const VP = this._m2.copy(cam.projectionMatrix).multiply(V);
    this.uniforms.uInvViewProj.value.copy(VP).invert(); // (projection*view)^-1
    this.uniforms.uCamPos.value.copy(cam.position);
  }

  unmount() {
    // OrbitControls owns its own pointer/wheel listeners on renderer.domElement
    // — dispose() removes them (the engine's reset() cannot reach them).
    this.controls.dispose();
    // Remove the quad (a scene child). The engine's reset() also sweeps the
    // scene and disposes it idempotently; this is explicit and order-safe.
    if (this.quad.parent) this.quad.parent.remove(this.quad);
    // Dispose the geometry + custom ShaderMaterial.
    this.geo.dispose();
    this.material.dispose();
  }
}

export function init(container) {
  return new Shaders().init(container);
}
