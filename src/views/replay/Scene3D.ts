import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { onDark } from '../../lib/format';
import { carPosition, type LiveTiming } from '../../lib/live';
import type { CameraMode } from '../../lib/store';
import { TrackGeo } from '../../lib/track';
import type { Session } from '../../lib/types';

const TRAIL_POINTS = 30;
const TRAIL_STEP = 0.11; // seconds of race time between trail points
const BG = 0x07080a;

interface Car {
  n: number;
  index: number;
  colour: THREE.Color;
  core: THREE.Sprite;
  glow: THREE.Sprite;
  trail: THREE.Line;
  trailPos: Float32Array;
  tag: HTMLDivElement | null;
  hint: number;
  world: THREE.Vector3;
  screen: { x: number; y: number; visible: boolean };
  out: boolean;
  speed: number;
}

export interface SceneOptions {
  /** Decorative mode: no labels, no interaction, slow auto-orbit. */
  ambient?: boolean;
  time: () => number;
  onSelect?: (n: number) => void;
  onHover?: (hover: { n: number; x: number; y: number; speed: number } | null) => void;
}

function discTexture(ring: boolean): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 96;
  const g = c.getContext('2d')!;
  g.fillStyle = '#07080a';
  g.beginPath();
  g.arc(48, 48, 40, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#ffffff';
  g.beginPath();
  g.arc(48, 48, 32, 0, Math.PI * 2);
  g.fill();
  if (ring) {
    g.fillStyle = '#07080a';
    g.beginPath();
    g.arc(48, 48, 15, 0, Math.PI * 2);
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function glowTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,255,255,0.9)');
  grad.addColorStop(0.25, 'rgba(255,255,255,0.35)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class Scene3D {
  private renderer: THREE.WebGLRenderer;
  private composer: EffectComposer;
  private bloom: UnrealBloomPass;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private overlay: HTMLDivElement;
  private geo: TrackGeo;
  private cars: Car[] = [];
  private byNum = new Map<number, Car>();
  private cornerEls: { el: HTMLDivElement; world: THREE.Vector3 }[] = [];
  private ring: THREE.Mesh;
  private beam: THREE.Line;
  private relief: number;
  private width: number;
  private raf = 0;
  private active = true;
  private disposed = false;
  private selected: number | null = null;
  private mode: CameraMode = 'circuit';
  private zoomGoal: number | null = null;
  private targetGoal: THREE.Vector3 | null = null;
  private showLabels = true;
  private lastT = -1;
  private lastWall = performance.now();
  private size = { w: 1, h: 1 };
  private resizeObserver: ResizeObserver;
  private visibilityObserver: IntersectionObserver;
  private pointerDown: { x: number; y: number } | null = null;
  private hovered: number | null = null;
  private tmp = new THREE.Vector3();
  private tmp2 = new THREE.Vector3();
  private p2 = { x: 0, y: 0 };
  private chasePos = new THREE.Vector3();
  private chaseLook = new THREE.Vector3();
  private home = new THREE.Vector3();
  private disposables: { dispose: () => void }[] = [];

  constructor(
    private host: HTMLElement,
    private session: Session,
    private live: LiveTiming,
    private opts: SceneOptions,
  ) {
    this.geo = new TrackGeo(session.meta.track);
    const extent = this.geo.extent;
    this.width = Math.min(26, Math.max(11, extent * 0.011));
    this.relief = this.geo.maxZ > 1 ? Math.min(4, Math.max(1.6, (0.07 * extent) / this.geo.maxZ)) : 1;

    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(BG, 1);
    this.renderer.domElement.className = 'scene-canvas';
    host.appendChild(this.renderer.domElement);

    this.overlay = document.createElement('div');
    this.overlay.className = 'scene-overlay';
    host.appendChild(this.overlay);

    this.scene.background = new THREE.Color(BG);
    this.scene.fog = new THREE.Fog(BG, extent * 2.2, extent * 6.5);

    this.camera = new THREE.PerspectiveCamera(30, 1, 5, extent * 12);
    const azimuth = (-(session.meta.track.rotation || 0) * Math.PI) / 180;
    const polar = (opts.ambient ? 62 : 50) * (Math.PI / 180);
    const dist = extent * (opts.ambient ? 1.5 : 1.7);
    this.home.set(Math.sin(azimuth) * Math.sin(polar) * dist, Math.cos(polar) * dist, Math.cos(azimuth) * Math.sin(polar) * dist);
    this.camera.position.copy(this.home);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = extent * 0.08;
    this.controls.maxDistance = extent * 4;
    this.controls.maxPolarAngle = Math.PI * 0.47;
    this.controls.zoomSpeed = 0.8;
    this.controls.rotateSpeed = 0.6;
    this.controls.target.set(0, (this.geo.maxZ * this.relief) / 2, 0);
    this.controls.addEventListener('start', () => {
      this.zoomGoal = null;
      this.targetGoal = null;
    });
    if (opts.ambient) {
      this.controls.enabled = false;
      this.controls.autoRotate = true;
      this.controls.autoRotateSpeed = 0.5;
    }

    const target = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(this.renderer, target);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.5, 0.75, 0.5);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    this.buildGround(extent);
    this.buildTrack();
    this.buildCars();
    if (!opts.ambient) this.buildCorners();

    const ringGeo = new THREE.RingGeometry(this.width * 1.25, this.width * 1.5, 48);
    ringGeo.rotateX(-Math.PI / 2);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide });
    this.ring = new THREE.Mesh(ringGeo, ringMat);
    this.ring.visible = false;
    this.scene.add(this.ring);
    const beamGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, extent * 0.09, 0)]);
    beamGeo.setAttribute('color', new THREE.Float32BufferAttribute([1, 1, 1, 0, 0, 0], 3));
    this.beam = new THREE.Line(beamGeo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.beam.visible = false;
    this.scene.add(this.beam);
    this.disposables.push(ringGeo, ringMat, beamGeo, this.beam.material as THREE.Material);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(host);
    this.visibilityObserver = new IntersectionObserver((entries) => {
      this.active = entries[0].isIntersecting;
      if (this.active) this.start();
    });
    this.visibilityObserver.observe(host);
    this.resize();

    if (!opts.ambient) {
      const el = this.renderer.domElement;
      el.addEventListener('pointerdown', this.onPointerDown);
      el.addEventListener('pointerup', this.onPointerUp);
      el.addEventListener('pointermove', this.onPointerMove);
      el.addEventListener('pointerleave', this.onPointerLeave);
    }
    this.start();
  }

  // ---- world helpers ----------------------------------------------------------------

  private toWorld(x: number, y: number, z: number, out: THREE.Vector3) {
    return out.set(x - this.geo.cx, z * this.relief, -(y - this.geo.cy));
  }

  private buildGround(extent: number) {
    const geo = new THREE.PlaneGeometry(extent * 9, extent * 9);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: {
        uCell: { value: Math.max(50, Math.round(extent / 28 / 50) * 50) },
        uRadius: { value: extent * 2.6 },
        uColor: { value: new THREE.Color(0x8fa1bd) },
      },
      vertexShader: /* glsl */ `
        varying vec3 vWorld;
        void main() {
          vec4 w = modelMatrix * vec4(position, 1.0);
          vWorld = w.xyz;
          gl_Position = projectionMatrix * viewMatrix * w;
        }`,
      fragmentShader: /* glsl */ `
        uniform float uCell;
        uniform float uRadius;
        uniform vec3 uColor;
        varying vec3 vWorld;
        float grid(vec2 p, float cell) {
          vec2 c = p / cell;
          vec2 g = abs(fract(c - 0.5) - 0.5) / fwidth(c);
          return 1.0 - min(min(g.x, g.y), 1.0);
        }
        void main() {
          float fine = grid(vWorld.xz, uCell) * 0.35;
          float coarse = grid(vWorld.xz, uCell * 5.0) * 0.65;
          float fade = 1.0 - smoothstep(uRadius * 0.15, uRadius, length(vWorld.xz));
          gl_FragColor = vec4(uColor, (fine + coarse) * fade * 0.2);
        }`,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.y = -1;
    mesh.renderOrder = -2;
    this.scene.add(mesh);
    this.disposables.push(geo, mat);
  }

  private buildTrack() {
    const g = this.geo;
    const n = g.n;
    const half = this.width / 2;
    const edgeW = this.width * 0.09;

    const centre: THREE.Vector3[] = [];
    const normal: THREE.Vector3[] = [];
    for (let i = 0; i < n; i++) centre.push(this.toWorld(g.x[i], g.y[i], g.z[i], new THREE.Vector3()));
    for (let i = 0; i < n; i++) {
      const a = centre[(i - 1 + n) % n];
      const b = centre[(i + 1) % n];
      const tx = b.x - a.x;
      const tz = b.z - a.z;
      const len = Math.hypot(tx, tz) || 1;
      normal.push(new THREE.Vector3(-tz / len, 0, tx / len));
    }

    const strip = (inner: number, outer: number, lift: number) => {
      const pos = new Float32Array((n + 1) * 6);
      for (let k = 0; k <= n; k++) {
        const i = k % n;
        const c = centre[i];
        const nn = normal[i];
        pos.set([c.x + nn.x * inner, c.y + lift, c.z + nn.z * inner, c.x + nn.x * outer, c.y + lift, c.z + nn.z * outer], k * 6);
      }
      const idx: number[] = [];
      for (let k = 0; k < n; k++) {
        const a = k * 2;
        idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setIndex(idx);
      this.disposables.push(geo);
      return geo;
    };

    const add = (geo: THREE.BufferGeometry, mat: THREE.Material, order = 0) => {
      const mesh = new THREE.Mesh(geo, mat);
      mesh.renderOrder = order;
      this.scene.add(mesh);
      this.disposables.push(mat);
      return mesh;
    };

    // soft halo under the asphalt
    add(strip(-half * 2.6, half * 2.6, -0.6), new THREE.MeshBasicMaterial({ color: 0x5d7190, transparent: true, opacity: 0.07, depthWrite: false, side: THREE.DoubleSide }), -1);
    // asphalt
    add(strip(-half, half, 0), new THREE.MeshBasicMaterial({ color: 0x1b1f26, side: THREE.DoubleSide }));
    // kerb lines
    const edgeMat = () => new THREE.MeshBasicMaterial({ color: 0xdfe3ea, transparent: true, opacity: 0.82, side: THREE.DoubleSide });
    add(strip(-half - edgeW, -half, 0.3), edgeMat(), 1);
    add(strip(half, half + edgeW, 0.3), edgeMat(), 1);

    // curtain from the track down to the ground: makes the elevation readable
    {
      const pos = new Float32Array((n + 1) * 6);
      const col = new Float32Array((n + 1) * 8);
      for (let k = 0; k <= n; k++) {
        const c = centre[k % n];
        pos.set([c.x, c.y - 0.5, c.z, c.x, -1, c.z], k * 6);
        const top = 0.05 + 0.2 * Math.min(1, c.y / (g.maxZ * this.relief || 1));
        col.set([0.56, 0.64, 0.78, top, 0.56, 0.64, 0.78, 0], k * 8);
      }
      const idx: number[] = [];
      for (let k = 0; k < n; k++) {
        const a = k * 2;
        idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setAttribute('color', new THREE.BufferAttribute(col, 4));
      geo.setIndex(idx);
      this.disposables.push(geo);
      add(geo, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide }), -1);

      // stilts every ~120 m
      const every = Math.max(1, Math.round(120 / g.step));
      const pts: number[] = [];
      const cols: number[] = [];
      for (let i = 0; i < n; i += every) {
        const c = centre[i];
        if (c.y < 3) continue;
        pts.push(c.x, c.y, c.z, c.x, -1, c.z);
        cols.push(0.3, 0.35, 0.44, 0.04, 0.05, 0.06);
      }
      const lg = new THREE.BufferGeometry();
      lg.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
      lg.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
      const lm = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
      this.scene.add(new THREE.LineSegments(lg, lm));
      this.disposables.push(lg, lm);
    }

    // start/finish line
    {
      const c = centre[0];
      const nn = normal[0];
      const fwd = new THREE.Vector3(nn.z, 0, -nn.x).multiplyScalar(this.width * 0.16);
      const a = half + edgeW;
      const pts = new Float32Array([
        c.x - nn.x * a - fwd.x, c.y + 0.5, c.z - nn.z * a - fwd.z,
        c.x + nn.x * a - fwd.x, c.y + 0.5, c.z + nn.z * a - fwd.z,
        c.x - nn.x * a + fwd.x, c.y + 0.5, c.z - nn.z * a + fwd.z,
        c.x + nn.x * a + fwd.x, c.y + 0.5, c.z + nn.z * a + fwd.z,
      ]);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pts, 3));
      geo.setIndex([0, 1, 2, 1, 3, 2]);
      this.disposables.push(geo);
      add(geo, new THREE.MeshBasicMaterial({ color: 0xff4b1f, side: THREE.DoubleSide }), 2);
    }
  }

  private buildCars() {
    const { meta, teammateIndex } = this.session;
    const solid = discTexture(false);
    const ring = discTexture(true);
    const glow = glowTexture();
    this.disposables.push(solid, ring, glow);

    meta.pos.order.forEach((n, index) => {
      const d = this.session.byNum.get(n);
      if (!d) return;
      const colour = new THREE.Color(onDark(d.colour));

      const coreMat = new THREE.SpriteMaterial({ map: teammateIndex.get(n) ? ring : solid, color: colour, sizeAttenuation: false, depthTest: false, transparent: true });
      const core = new THREE.Sprite(coreMat);
      core.scale.setScalar(0.017);
      core.renderOrder = 10;

      const glowMat = new THREE.SpriteMaterial({ map: glow, color: colour, sizeAttenuation: false, depthTest: false, depthWrite: false, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending });
      const glowSprite = new THREE.Sprite(glowMat);
      glowSprite.scale.setScalar(0.05);
      glowSprite.renderOrder = 9;

      const trailPos = new Float32Array(TRAIL_POINTS * 3);
      const trailCol = new Float32Array(TRAIL_POINTS * 3);
      for (let i = 0; i < TRAIL_POINTS; i++) {
        const k = (1 - i / (TRAIL_POINTS - 1)) ** 1.6;
        trailCol.set([colour.r * k, colour.g * k, colour.b * k], i * 3);
      }
      const trailGeo = new THREE.BufferGeometry();
      trailGeo.setAttribute('position', new THREE.BufferAttribute(trailPos, 3));
      trailGeo.setAttribute('color', new THREE.BufferAttribute(trailCol, 3));
      const trailMat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
      const trail = new THREE.Line(trailGeo, trailMat);
      trail.frustumCulled = false;
      trail.renderOrder = 8;

      this.scene.add(trail, glowSprite, core);
      this.disposables.push(coreMat, glowMat, trailGeo, trailMat);

      let tag: HTMLDivElement | null = null;
      if (!this.opts.ambient) {
        tag = document.createElement('div');
        tag.className = 'car-tag';
        tag.textContent = d.code;
        tag.style.setProperty('--c', onDark(d.colour));
        this.overlay.appendChild(tag);
      }

      const car: Car = { n, index, colour, core, glow: glowSprite, trail, trailPos, tag, hint: -1, world: new THREE.Vector3(), screen: { x: 0, y: 0, visible: false }, out: false, speed: 0 };
      this.cars.push(car);
      this.byNum.set(n, car);
    });
  }

  private buildCorners() {
    const g = this.geo;
    for (const c of this.session.meta.track.corners) {
      const idx = g.nearest(c.x, c.y);
      const a = (c.a * Math.PI) / 180;
      const off = this.width * 2.4;
      const world = this.toWorld(c.x + Math.cos(a) * off, c.y + Math.sin(a) * off, g.z[idx], new THREE.Vector3());
      const el = document.createElement('div');
      el.className = 'corner-tag';
      el.textContent = c.label;
      this.overlay.appendChild(el);
      this.cornerEls.push({ el, world });
    }
  }

  // ---- public API -------------------------------------------------------------------

  setSelected(n: number | null) {
    this.selected = n;
    for (const car of this.cars) {
      const on = car.n === n;
      car.core.scale.setScalar(on ? 0.023 : 0.017);
      car.core.renderOrder = on ? 12 : 10;
      (car.glow.material as THREE.SpriteMaterial).opacity = n == null ? 0.5 : on ? 0.85 : 0.28;
      car.glow.scale.setScalar(on ? 0.075 : 0.05);
      car.tag?.classList.toggle('is-selected', on);
    }
    if (n == null && this.mode !== 'circuit') this.setCamera('circuit');
  }

  setCamera(mode: CameraMode) {
    const prev = this.mode;
    this.mode = mode;
    const car = this.selected != null ? this.byNum.get(this.selected) : null;
    if (prev === 'chase' && mode !== 'chase') {
      this.controls.enabled = true;
      if (car) this.controls.target.copy(car.world);
    }
    if (mode === 'circuit') {
      this.targetGoal = new THREE.Vector3(0, (this.geo.maxZ * this.relief) / 2, 0);
      this.zoomGoal = this.home.length();
    } else if (mode === 'follow') {
      this.targetGoal = null;
      this.zoomGoal = this.geo.extent * 0.55;
    } else {
      this.controls.enabled = false;
      this.zoomGoal = null;
      this.targetGoal = null;
      this.chasePos.copy(this.camera.position);
      if (car) this.chaseLook.copy(car.world);
    }
  }

  setLabels(on: boolean) {
    this.showLabels = on;
    this.overlay.classList.toggle('labels-off', !on);
  }

  // ---- interaction ------------------------------------------------------------------

  private carNear(clientX: number, clientY: number): Car | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    let best: Car | null = null;
    let bestD = 22 * 22;
    for (const car of this.cars) {
      if (!car.screen.visible || car.out) continue;
      const d = (car.screen.x - x) ** 2 + (car.screen.y - y) ** 2;
      if (d < bestD) {
        bestD = d;
        best = car;
      }
    }
    return best;
  }

  private onPointerDown = (e: PointerEvent) => {
    this.pointerDown = { x: e.clientX, y: e.clientY };
  };

  private onPointerUp = (e: PointerEvent) => {
    const down = this.pointerDown;
    this.pointerDown = null;
    if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) return;
    const car = this.carNear(e.clientX, e.clientY);
    if (car) this.opts.onSelect?.(car.n);
  };

  private onPointerMove = (e: PointerEvent) => {
    if (this.pointerDown) return;
    const car = this.carNear(e.clientX, e.clientY);
    const n = car?.n ?? null;
    if (n !== this.hovered) {
      if (this.hovered != null) this.byNum.get(this.hovered)?.tag?.classList.remove('is-hover');
      car?.tag?.classList.add('is-hover');
      this.hovered = n;
      this.renderer.domElement.style.cursor = car ? 'pointer' : '';
    }
    this.opts.onHover?.(car ? { n: car.n, x: car.screen.x, y: car.screen.y, speed: car.speed } : null);
  };

  private onPointerLeave = () => {
    if (this.hovered != null) this.byNum.get(this.hovered)?.tag?.classList.remove('is-hover');
    this.hovered = null;
    this.opts.onHover?.(null);
  };

  // ---- frame loop -------------------------------------------------------------------

  private start() {
    if (this.raf || this.disposed) return;
    this.lastWall = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  private resize() {
    const w = Math.max(1, this.host.clientWidth);
    const h = Math.max(1, this.host.clientHeight);
    this.size = { w, h };
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    this.composer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.lastT = -1;
  }

  private updateCars(t: number) {
    const pos = this.session.positions;
    const g = this.geo;
    for (const car of this.cars) {
      const out = this.live.isOut(car.n, t);
      if (out !== car.out) {
        car.out = out;
        car.core.visible = car.glow.visible = car.trail.visible = !out;
      }
      if (out) continue;

      carPosition(pos, car.index, t, this.p2);
      car.hint = g.nearest(this.p2.x, this.p2.y, car.hint);
      this.toWorld(this.p2.x, this.p2.y, g.z[car.hint], car.world);
      car.world.y += 1.5;
      car.core.position.copy(car.world);
      car.glow.position.copy(car.world);

      const x0 = this.p2.x;
      const y0 = this.p2.y;
      carPosition(pos, car.index, Math.max(0, t - 0.5), this.p2);
      car.speed = (Math.hypot(x0 - this.p2.x, y0 - this.p2.y) / 0.5) * 3.6;

      let hint = car.hint;
      const arr = car.trailPos;
      arr[0] = car.world.x;
      arr[1] = car.world.y;
      arr[2] = car.world.z;
      for (let i = 1; i < TRAIL_POINTS; i++) {
        carPosition(pos, car.index, Math.max(0, t - i * TRAIL_STEP), this.p2);
        hint = g.nearest(this.p2.x, this.p2.y, hint, 12);
        arr[i * 3] = this.p2.x - g.cx;
        arr[i * 3 + 1] = g.z[hint] * this.relief + 1.5;
        arr[i * 3 + 2] = -(this.p2.y - g.cy);
      }
      (car.trail.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    }
  }

  private updateCamera(dt: number, t: number) {
    const car = this.selected != null ? this.byNum.get(this.selected) : null;
    const ease = 1 - Math.exp(-dt * 4);

    if (this.mode === 'chase' && car && !car.out) {
      carPosition(this.session.positions, car.index, t + 0.45, this.p2);
      const ax = this.p2.x;
      const ay = this.p2.y;
      carPosition(this.session.positions, car.index, Math.max(0, t - 0.45), this.p2);
      let hx = ax - this.p2.x;
      let hy = ay - this.p2.y;
      const len = Math.hypot(hx, hy);
      if (len > 0.5) {
        hx /= len;
        hy /= len;
        const back = this.width * 13;
        const up = this.width * 5.5;
        this.tmp.set(car.world.x - hx * back, car.world.y + up, car.world.z + hy * back);
        this.chasePos.lerp(this.tmp, 1 - Math.exp(-dt * 2.6));
        this.tmp2.set(car.world.x + hx * this.width * 5, car.world.y, car.world.z - hy * this.width * 5);
        this.chaseLook.lerp(this.tmp2, 1 - Math.exp(-dt * 5));
      }
      this.camera.position.copy(this.chasePos);
      this.camera.lookAt(this.chaseLook);
      return;
    }

    if (this.mode === 'follow' && car && !car.out) {
      // keep the camera offset, move the pivot with the car
      this.tmp.copy(car.world).sub(this.controls.target).multiplyScalar(Math.min(1, ease * 1.6));
      this.controls.target.add(this.tmp);
      this.camera.position.add(this.tmp);
    } else if (this.targetGoal) {
      this.tmp.copy(this.targetGoal).sub(this.controls.target).multiplyScalar(ease);
      this.controls.target.add(this.tmp);
      this.camera.position.add(this.tmp);
      if (this.tmp.lengthSq() < 0.01) this.targetGoal = null;
    }

    if (this.zoomGoal != null) {
      this.tmp.copy(this.camera.position).sub(this.controls.target);
      const d = this.tmp.length();
      const next = d + (this.zoomGoal - d) * ease;
      this.tmp.multiplyScalar(next / d);
      this.camera.position.copy(this.controls.target).add(this.tmp);
      if (Math.abs(next - this.zoomGoal) < this.geo.extent * 0.004) this.zoomGoal = null;
    }
    this.controls.update();
  }

  private project(world: THREE.Vector3, out: { x: number; y: number; visible: boolean }) {
    this.tmp.copy(world).project(this.camera);
    out.visible = this.tmp.z > -1 && this.tmp.z < 1 && Math.abs(this.tmp.x) < 1.05 && Math.abs(this.tmp.y) < 1.05;
    out.x = (this.tmp.x * 0.5 + 0.5) * this.size.w;
    out.y = (-this.tmp.y * 0.5 + 0.5) * this.size.h;
  }

  private updateOverlay() {
    const placed: { x: number; y: number }[] = [];
    const ordered = this.selected != null ? [...this.cars].sort((a, b) => Number(b.n === this.selected) - Number(a.n === this.selected)) : this.cars;
    for (const car of ordered) {
      this.project(car.world, car.screen);
      const tag = car.tag;
      if (!tag) continue;
      let show = car.screen.visible && !car.out && this.showLabels;
      if (show && car.n !== this.selected && car.n !== this.hovered) {
        for (const p of placed) {
          if (Math.abs(p.x - car.screen.x) < 34 && Math.abs(p.y - car.screen.y) < 15) {
            show = false;
            break;
          }
        }
      }
      if (show) {
        placed.push({ x: car.screen.x, y: car.screen.y });
        tag.style.transform = `translate3d(${car.screen.x.toFixed(1)}px, ${car.screen.y.toFixed(1)}px, 0) translate(-50%, -175%)`;
      }
      tag.style.opacity = show ? '1' : '0';
    }
    const s = { x: 0, y: 0, visible: false };
    for (const c of this.cornerEls) {
      this.project(c.world, s);
      const show = s.visible && this.showLabels && this.mode !== 'chase';
      c.el.style.opacity = show ? '1' : '0';
      if (show) c.el.style.transform = `translate3d(${s.x.toFixed(1)}px, ${s.y.toFixed(1)}px, 0) translate(-50%, -50%)`;
    }
  }

  private frame = (now: number) => {
    this.raf = 0;
    if (this.disposed) return;
    if (!this.active || document.hidden) {
      // idle until visible again
      if (this.active) this.raf = requestAnimationFrame(this.frame);
      return;
    }
    const dt = Math.min(0.1, (now - this.lastWall) / 1000);
    this.lastWall = now;

    const t = this.opts.time();
    if (t !== this.lastT) {
      this.updateCars(t);
      this.lastT = t;
    }

    const car = this.selected != null ? this.byNum.get(this.selected) : null;
    const showRing = !!car && !car.out;
    this.ring.visible = this.beam.visible = showRing;
    if (car && showRing) {
      this.ring.position.copy(car.world);
      this.beam.position.copy(car.world);
      const pulse = 1 + 0.12 * Math.sin(now / 260);
      this.ring.scale.setScalar(pulse);
      (this.ring.material as THREE.MeshBasicMaterial).color.copy(car.colour);
    }

    this.updateCamera(dt, t);
    this.updateOverlay();
    this.composer.render(dt);
    this.raf = requestAnimationFrame(this.frame);
  };

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.resizeObserver.disconnect();
    this.visibilityObserver.disconnect();
    const el = this.renderer.domElement;
    el.removeEventListener('pointerdown', this.onPointerDown);
    el.removeEventListener('pointerup', this.onPointerUp);
    el.removeEventListener('pointermove', this.onPointerMove);
    el.removeEventListener('pointerleave', this.onPointerLeave);
    this.controls.dispose();
    for (const d of this.disposables) d.dispose();
    this.composer.dispose();
    this.renderer.dispose();
    el.remove();
    this.overlay.remove();
  }
}
