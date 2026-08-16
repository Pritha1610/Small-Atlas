import * as THREE from 'three';
import type { WonderSite } from './world/wonders';
import type { Landmark } from './world/settlements';
import type { Dialogue } from './story/dialogue';

/**
 * A camera, and an album that outlives the world.
 *
 * The planet is procedural and unseeded, so every page load builds a place that has never
 * existed before and will not exist again. That makes the album the only thing in the game with
 * continuity: photographs of worlds that are gone, kept by the one person who was there. It is
 * the same job the people in this world are already doing with ledgers, copied books and names
 * cut into roof beams, which is why the gallery is written as a record rather than as a folder.
 *
 * Storage is IndexedDB because photographs are far too big for localStorage's ~5MB, and they are
 * kept as JPEG data URLs rather than Blobs so a record survives a structured-clone round trip
 * without any lifetime management.
 */

const DB_NAME = 'wonders-album';
const STORE = 'photos';
const DB_VERSION = 1;
/** Long edge of a saved photo. Full res would be ~1MB each and buy nothing at gallery size. */
const MAX_EDGE = 1280;
const JPEG_QUALITY = 0.78;
/** Width of the gallery thumbnail. The grid cells are 230px, so this covers a 2x display. */
const THUMB_EDGE = 460;
/** Album cap. At ~90KB a photo this is roughly 11MB, which browsers grant without prompting. */
const MAX_PHOTOS = 120;

/** Field of view through the viewfinder. Narrower than play, so raising the camera composes. */
const PHOTO_FOV = 38;

/**
 * Film stocks. Applied with the 2D canvas filter on the captured frame rather than as another
 * shader pass: it costs nothing at all until the shutter fires, and the scene has no textures to
 * fight with. Each also gets a vignette and grain drawn on top, tuned per stock below.
 */
interface Film {
  id: string;
  name: string;
  filter: string;
  vignette: number;
  grain: number;
  wash?: string;
}

const FILMS: Film[] = [
  {
    id: 'plate',
    name: 'Plate',
    filter: 'saturate(0.92) contrast(1.08) brightness(1.02)',
    vignette: 0.34,
    grain: 0.05,
  },
  {
    id: 'salt',
    name: 'Salt',
    filter: 'saturate(0.55) contrast(0.94) brightness(1.12) sepia(0.18)',
    vignette: 0.2,
    grain: 0.08,
    wash: 'rgba(226, 232, 226, 0.14)',
  },
  {
    id: 'ink',
    name: 'Ink',
    filter: 'grayscale(0.86) contrast(1.34) brightness(0.98)',
    vignette: 0.46,
    grain: 0.1,
  },
  {
    id: 'ochre',
    name: 'Ochre',
    filter: 'saturate(0.78) contrast(1.12) sepia(0.42) brightness(1.04)',
    vignette: 0.4,
    grain: 0.07,
    wash: 'rgba(150, 92, 44, 0.1)',
  },
];

export interface Photo {
  id: string;
  /** Which world this was taken in. Worlds are never rebuilt, so this is a headstone. */
  world: number;
  at: number;
  film: string;
  /** 'wonder:Giza', 'place:cave', 'settlement', or null for an unrecorded view. */
  subject: string | null;
  caption: string;
  w: number;
  h: number;
  data: string;
  /**
   * A small copy for the gallery grid. Without it the grid embeds full-size data URLs: six
   * photographs measured 555KB of innerHTML, so a full album of 120 would put roughly 11MB of
   * base64 into the DOM for a wall of 230px thumbnails.
   */
  thumb?: string;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(db: IDBDatabase, mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  return new Promise((resolve, reject) => {
    const req = run(db.transaction(STORE, mode).objectStore(STORE));
    req.onsuccess = () => resolve(req.result as T);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Which world this page load is. Bumped once per boot and kept in localStorage, so the number on
 * an old photograph refers to somewhere that genuinely cannot be visited again.
 */
function claimWorldNumber(): number {
  try {
    const n = Number(localStorage.getItem('wonders.world') ?? '0') + 1;
    localStorage.setItem('wonders.world', String(n));
    return n;
  } catch {
    return 1;
  }
}

export interface Photos {
  /** True while the viewfinder is up; the player still walks, the HUD is hidden. */
  readonly aiming: boolean;
  readonly galleryOpen: boolean;
  toggleAim(): void;
  cycleFilm(): void;
  /** Arms the shutter. The frame is grabbed in afterRender, which is the only safe moment. */
  shoot(): void;
  toggleGallery(): void;
  /** MUST be called in the same task as composer.render, immediately after it. */
  afterRender(): void;
  update(dt: number): void;
}

export interface PhotoDeps {
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  collidables: THREE.Object3D[];
  wonderSites: WonderSite[];
  /** The monuments' own collision geometry, so a ray that lands ON one counts as seeing it. */
  wonderMesh: THREE.Object3D;
  landmarks: Landmark[];
  caveSites: THREE.Vector3[];
  dialogue: Dialogue;
  playFov: number;
  stage(): number;
  /** Raised so the caption can say where you were standing. */
  feet(): THREE.Vector3;
}

export async function createPhotos(deps: PhotoDeps): Promise<Photos> {
  const world = claimWorldNumber();
  let db: IDBDatabase | null = null;
  try {
    db = await openDb();
  } catch (err) {
    // A blocked or unavailable IndexedDB should cost the album, not the game.
    console.error('[photo] album unavailable, photographs will not persist', err);
  }

  let photos: Photo[] = [];
  if (db) {
    try {
      photos = ((await tx<Photo[]>(db, 'readonly', (s) => s.getAll())) ?? []).sort((a, b) => b.at - a.at);
    } catch {
      photos = [];
    }
  }

  let aiming = false;
  let galleryOpen = false;
  let pending = false;
  let film = 0;
  let flashTimer = 0;

  const hud = document.getElementById('hud')!;

  const view = document.createElement('div');
  view.className = 'viewfinder';
  view.innerHTML = `
    <div class="vf-bar top"></div>
    <div class="vf-bar bottom"></div>
    <div class="vf-frame"><i class="tl"></i><i class="tr"></i><i class="bl"></i><i class="br"></i></div>
    <div class="vf-info"><span class="vf-film"></span><span class="vf-hint">drag to aim · click shutter · Tab film · F lower</span></div>
    <div class="vf-subject"></div>
  `;
  hud.appendChild(view);

  const flash = document.createElement('div');
  flash.className = 'shutter-flash';
  hud.appendChild(flash);

  const toast = document.createElement('div');
  toast.className = 'photo-toast';
  hud.appendChild(toast);

  const gallery = document.createElement('div');
  gallery.className = 'gallery';
  document.body.appendChild(gallery);

  const filmLabel = view.querySelector('.vf-film') as HTMLElement;
  const subjectLabel = view.querySelector('.vf-subject') as HTMLElement;

  function setFilmLabel(): void {
    filmLabel.textContent = FILMS[film].name;
  }
  setFilmLabel();

  // ---------------------------------------------------------------- subject

  const ndc = new THREE.Vector3();
  const ray = new THREE.Raycaster();

  /**
   * What the shot is OF. A wonder counts only if it is genuinely framed: on screen, in front,
   * not behind a hill. Occlusion is a single ray, because a monument that is half behind a ridge
   * is still a photograph of that monument and should be treated as one.
   */
  function framedWonder(): WonderSite | null {
    let best: WonderSite | null = null;
    let bestScore = -Infinity;
    const cam = deps.camera;
    for (const site of deps.wonderSites) {
      const up = site.position.clone().normalize();
      // Framing is judged against the monument's BODY, not the patch of ground it stands on.
      // Projecting the site position put Machu Picchu at y=0.90, right on the edge of the gate,
      // because the thing you are actually looking at is twenty units above its own footprint.
      const centre = site.position.clone().addScaledVector(up, 10);
      ndc.copy(centre).project(cam);
      if (ndc.z > 1 || Math.abs(ndc.x) > 0.92 || Math.abs(ndc.y) > 0.92) continue;
      const dist = cam.position.distanceTo(site.position);
      if (dist > 220) continue;

      // Sampled up the monument rather than at one point. These things are 15-35 units tall and
      // several sit on ridges, so a single ray to the base grazes the ridge the monument is
      // standing on and calls it occluded - measured, Machu Picchu struck ground at 44% of the
      // distance while filling the top of the frame. If any height along the body is reachable,
      // you can see it, which is also just what "photographing it" means.
      let visible = false;
      for (const h of [4, 12, 22]) {
        const aim = site.position.clone().addScaledVector(up, h);
        const dir = aim.sub(cam.position);
        const len = dir.length();
        ray.set(cam.position, dir.normalize());
        ray.near = 0;
        ray.far = len;
        ray.firstHitOnly = true;
        const hit = ray.intersectObjects(deps.collidables, false);
        if (hit.length === 0 || hit[0].object === deps.wonderMesh || hit[0].distance >= len * 0.72) {
          visible = true;
          break;
        }
      }
      if (!visible) continue;

      // Centred and close beats peripheral and distant, so aiming at one of two is unambiguous.
      const centred = 1 - Math.hypot(ndc.x, ndc.y) / 1.42;
      const score = centred * 2 - dist / 220;
      if (score > bestScore) {
        bestScore = score;
        best = site;
      }
    }
    return best;
  }

  function framedPlace(): string | null {
    const cam = deps.camera;
    let best: string | null = null;
    let bestD = Infinity;
    const consider = (p: THREE.Vector3, label: string) => {
      ndc.copy(p).project(cam);
      if (ndc.z > 1 || Math.abs(ndc.x) > 0.9 || Math.abs(ndc.y) > 0.9) return;
      const d = cam.position.distanceTo(p);
      if (d < bestD && d < 70) {
        bestD = d;
        best = label;
      }
    };
    for (const c of deps.caveSites) consider(c, 'place:cave');
    for (const l of deps.landmarks) consider(l.position, l.target);
    return best;
  }

  // ---------------------------------------------------------------- capture

  const grainCanvas = document.createElement('canvas');

  function grainPattern(w: number, h: number, amount: number): HTMLCanvasElement {
    grainCanvas.width = Math.max(1, Math.round(w / 3));
    grainCanvas.height = Math.max(1, Math.round(h / 3));
    const g = grainCanvas.getContext('2d')!;
    const img = g.createImageData(grainCanvas.width, grainCanvas.height);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = 128 + (Math.random() - 0.5) * 255 * amount;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    return grainCanvas;
  }

  function thumbnail(src: HTMLCanvasElement): string {
    const w = THUMB_EDGE;
    const h = Math.max(2, Math.round((src.height / src.width) * THUMB_EDGE));
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    c.getContext('2d')!.drawImage(src, 0, 0, w, h);
    return c.toDataURL('image/jpeg', 0.62);
  }

  function develop(): { data: string; thumb: string; w: number; h: number } {
    const src = deps.renderer.domElement;
    const scale = Math.min(1, MAX_EDGE / Math.max(src.width, src.height));
    const w = Math.max(2, Math.round(src.width * scale));
    const h = Math.max(2, Math.round(src.height * scale));
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d')!;
    const f = FILMS[film];

    ctx.filter = f.filter;
    ctx.drawImage(src, 0, 0, w, h);
    ctx.filter = 'none';

    if (f.wash) {
      ctx.fillStyle = f.wash;
      ctx.fillRect(0, 0, w, h);
    }

    if (f.grain > 0) {
      ctx.globalAlpha = f.grain;
      ctx.globalCompositeOperation = 'overlay';
      ctx.drawImage(grainPattern(w, h, 0.9), 0, 0, w, h);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
    }

    const grad = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.28, w / 2, h / 2, Math.max(w, h) * 0.72);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(1, `rgba(12,10,8,${f.vignette})`);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    return { data: c.toDataURL('image/jpeg', JPEG_QUALITY), thumb: thumbnail(c), w, h };
  }

  function showToast(title: string, body: string): void {
    toast.innerHTML = `<b>${title}</b>${body ? `<span>${body}</span>` : ''}`;
    toast.classList.add('on');
    window.setTimeout(() => toast.classList.remove('on'), body ? 9000 : 3200);
  }

  async function capture(): Promise<void> {
    const wonder = framedWonder();
    const place = wonder ? null : framedPlace();
    const shot = develop();

    let subject: string | null = null;
    let caption = '';
    let title = 'Photograph';
    let body = '';

    if (wonder) {
      subject = `wonder:${wonder.name}`;
      title = wonder.name;
      // The capture lore is written per wonder and per stage, so the same monument tells you
      // more the second time you photograph it, once you have seen more of the world.
      body =
        deps.dialogue.pickLore(`capture:${wonder.name}`, deps.stage()) ??
        deps.dialogue.pickLore(`wonder:${wonder.name}`, deps.stage()) ??
        '';
      caption = body;
    } else if (place) {
      subject = place;
      const nice = place.replace('place:', '').replace(/^\w/, (m) => m.toUpperCase());
      title = nice;
      caption = `${nice}. World ${world}.`;
    } else {
      caption = `World ${world}.`;
      title = 'Photograph';
    }

    const rec: Photo = {
      id: `${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`,
      world,
      at: Date.now(),
      film: FILMS[film].id,
      subject,
      caption,
      w: shot.w,
      h: shot.h,
      data: shot.data,
      thumb: shot.thumb,
    };

    photos.unshift(rec);
    if (db) {
      try {
        await tx(db, 'readwrite', (s) => s.put(rec));
        // Oldest first out. The cap exists so the album cannot silently fill the origin's quota.
        while (photos.length > MAX_PHOTOS) {
          const drop = photos.pop()!;
          await tx(db, 'readwrite', (s) => s.delete(drop.id));
        }
      } catch (err) {
        console.error('[photo] could not save', err);
      }
    }

    showToast(title, body);
    if (galleryOpen) renderGallery();
  }

  // ---------------------------------------------------------------- gallery

  function renderGallery(): void {
    if (photos.length === 0) {
      gallery.innerHTML = `
        <div class="gal-head"><h2>The Album</h2><button class="gal-close">Close</button></div>
        <p class="gal-empty">Nothing recorded yet. Raise the camera with <b>F</b> and photograph
        something before this world is gone.</p>`;
    } else {
      const byWorld = new Map<number, Photo[]>();
      for (const p of photos) {
        const list = byWorld.get(p.world) ?? [];
        list.push(p);
        byWorld.set(p.world, list);
      }
      const worlds = [...byWorld.keys()].sort((a, b) => b - a);
      const sections = worlds
        .map((n) => {
          const here = n === world;
          const items = byWorld
            .get(n)!
            .map(
              (p) => `
              <figure class="shot" data-id="${p.id}">
                <img src="${p.thumb ?? p.data}" alt="" loading="lazy">
                <figcaption>${p.subject ? p.subject.split(':').pop() : 'Unrecorded'}</figcaption>
              </figure>`
            )
            .join('');
          return `
            <section>
              <h3>World ${n}${here ? ' <em>· the one you are standing in</em>' : ' <em>· gone</em>'}</h3>
              <div class="grid">${items}</div>
            </section>`;
        })
        .join('');
      gallery.innerHTML = `
        <div class="gal-head">
          <h2>The Album</h2>
          <span class="gal-count">${photos.length} of ${MAX_PHOTOS}</span>
          <button class="gal-close">Close</button>
        </div>
        ${sections}
        <div class="gal-view"><img><div class="gal-cap"></div><button class="gal-del">Discard</button></div>`;
    }

    gallery.querySelector('.gal-close')?.addEventListener('click', () => toggleGallery());

    const viewer = gallery.querySelector('.gal-view') as HTMLElement | null;
    let openId: string | null = null;
    gallery.querySelectorAll<HTMLElement>('.shot').forEach((el) => {
      el.addEventListener('click', () => {
        const p = photos.find((x) => x.id === el.dataset.id);
        if (!p || !viewer) return;
        openId = p.id;
        (viewer.querySelector('img') as HTMLImageElement).src = p.data;
        const when = new Date(p.at);
        (viewer.querySelector('.gal-cap') as HTMLElement).innerHTML =
          `${p.caption}<span>World ${p.world} · ${FILMS.find((f) => f.id === p.film)?.name ?? p.film} · ${when.toLocaleDateString()}</span>`;
        viewer.classList.add('on');
      });
    });
    viewer?.addEventListener('click', (e) => {
      if (e.target === viewer) viewer.classList.remove('on');
    });
    gallery.querySelector('.gal-del')?.addEventListener('click', async () => {
      if (!openId) return;
      photos = photos.filter((p) => p.id !== openId);
      if (db) {
        try {
          await tx(db, 'readwrite', (s) => s.delete(openId!));
        } catch {
          /* the in-memory list is already correct; a failed delete just returns on reload */
        }
      }
      openId = null;
      renderGallery();
    });
  }

  function toggleGallery(): void {
    galleryOpen = !galleryOpen;
    gallery.classList.toggle('on', galleryOpen);
    if (galleryOpen) {
      if (aiming) toggleAim();
      renderGallery();
    }
  }

  // ---------------------------------------------------------------- mode

  function toggleAim(): void {
    aiming = !aiming;
    view.classList.toggle('on', aiming);
    hud.classList.toggle('aiming', aiming);
    deps.camera.fov = aiming ? PHOTO_FOV : deps.playFov;
    deps.camera.updateProjectionMatrix();
  }

  deps.renderer.domElement.addEventListener('click', () => {
    if (aiming && !galleryOpen) shoot();
  });

  function shoot(): void {
    if (pending) return;
    pending = true;
  }

  return {
    get aiming() {
      return aiming;
    },
    get galleryOpen() {
      return galleryOpen;
    },
    toggleAim,
    toggleGallery,
    shoot,
    cycleFilm() {
      film = (film + 1) % FILMS.length;
      setFilmLabel();
    },
    afterRender() {
      if (!pending) return;
      pending = false;
      // Grabbed here and nowhere else: preserveDrawingBuffer is off in production, so the canvas
      // is only readable inside the same task that drew it. One frame later it is already blank.
      void capture();
      flashTimer = 0.42;
      flash.classList.add('on');
    },
    update(dt) {
      if (flashTimer > 0) {
        flashTimer -= dt;
        if (flashTimer <= 0) flash.classList.remove('on');
      }
      if (aiming) {
        const w = framedWonder();
        subjectLabel.textContent = w ? w.name : '';
        subjectLabel.classList.toggle('on', !!w);
      }
    },
  };
}
