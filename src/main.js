import * as THREE from 'three';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';
import { createTank, moveTank, shoot, updateEnemyAI, applyPowerUp, respawnPlayer, disposeTank, bulletPool, enemyTypes, powerUpTypes, createShield, createDamageIndicator, directions, createPowerUp, powerUpUtils } from './tank.js';
import { createBrick, generateTerrain, createExplosion, createSpark, disposeBrick, particlePool } from './brick.js';

// Scene setup
const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0x2a2a2a, 10, 100);
const camera = new THREE.PerspectiveCamera(85, window.innerWidth / window.innerHeight, 0.1, 1000);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
document.body.appendChild(renderer.domElement);

// Handle window resize
window.addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
});

// Load HDRI environment
const rgbeLoader = new RGBELoader();
rgbeLoader.load('/satara_night_1k.hdr', (texture) => {
  texture.mapping = THREE.EquirectangularReflectionMapping;
  scene.environment = texture;
  scene.background = texture;
}, undefined, (error) => console.error('Failed to load HDRI:', error));

const textureLoader = new THREE.TextureLoader();
const fallbackTexture = new THREE.TextureLoader().load('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQYA4eB4YgAAAABJRU5ErkJggg==');

const groundTextures = {
  basecolor: textureLoader.load('/Poliigon_StoneQuartzite_8060/1K/Poliigon_StoneQuartzite_8060_BaseColor.jpg', undefined, undefined, (error) => console.error('Failed to load ground basecolor:', error)) || fallbackTexture,
  roughness: textureLoader.load('/Poliigon_StoneQuartzite_8060/1K/Poliigon_StoneQuartzite_8060_Roughness.jpg', undefined, undefined, (error) => console.error('Failed to load ground roughness:', error)) || fallbackTexture,
  normal: textureLoader.load('/Poliigon_StoneQuartzite_8060/1K/Poliigon_StoneQuartzite_8060_Normal.png', undefined, undefined, (error) => console.error('Failed to load ground normal:', error)) || fallbackTexture
};
Object.values(groundTextures).forEach(tex => {
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(48, 48);
});
const floor = new THREE.Mesh(
  new THREE.PlaneGeometry(150, 150),
  new THREE.MeshStandardMaterial({
    map: groundTextures.basecolor,
    roughnessMap: groundTextures.roughness,
    normalMap: groundTextures.normal,
    roughness: 0.9,
    metalness: 0.1
  })
);
floor.rotation.x = -Math.PI / 2;
floor.position.y = -0.1;
floor.receiveShadow = true;
scene.add(floor);

// Audio setup
const listener = new THREE.AudioListener();
camera.add(listener);
const audioLoader = new THREE.AudioLoader();
const soundEffects = {
  explosion: new THREE.Audio(listener),
  shoot: new THREE.Audio(listener),
  hit: new THREE.Audio(listener),
  powerUp: new THREE.Audio(listener),
  baseHit: new THREE.Audio(listener),
  bgm: new THREE.Audio(listener)
};
const audioFiles = {
  explosion: '/182429__qubodup__explosion.flac',
  shoot: '/gunshot-37055.mp3',
  hit: '/metal-hit-92-200420.mp3',
  powerUp: '/mech-power-up-37453.mp3',
  baseHit: '/explosion.wav',
  bgm: '/background-music-224633.mp3'
};
const audioLoaded = {
  explosion: false,
  shoot: false,
  hit: false,
  powerUp: false,
  baseHit: false,
  bgm: false
};

// Function to safely play a sound
const playSound = (sound, volume = null) => {
  if (sound && audioLoaded[sound.name] && sound.buffer && !sound.isPlaying) {
    if (volume !== null) sound.setVolume(volume);
    try {
      sound.play();
    } catch (error) {
      console.warn(`Failed to play sound ${sound.name}:`, error);
    }
  }
};

// Resume audio context on user interaction
const resumeAudioContext = () => {
  if (THREE.AudioContext.getContext().state === 'suspended') {
    THREE.AudioContext.getContext().resume().then(() => {
      console.log('Audio context resumed');
      if (gameState.running && !gameState.paused && audioLoaded.bgm) {
        playSound(soundEffects.bgm, 0.3);
      }
    }).catch(err => console.error('Failed to resume audio context:', err));
  }
};

// Load audio files with retry mechanism
const loadAudioWithRetry = (url, sound, key, retries = 3, delay = 1000) => {
  audioLoader.load(
    url,
    buffer => {
      sound.name = key; // Assign name for reference in playSound
      sound.setBuffer(buffer);
      audioLoaded[key] = true;
      if (key === 'bgm') {
        sound.setLoop(true);
        sound.setVolume(0.3);
      }
      console.log(`Loaded audio: ${url}`);
    },
    undefined,
    error => {
      console.error(`Failed to load audio ${url}:`, error);
      if (retries > 0) {
        console.log(`Retrying ${url} (${retries} attempts left)`);
        setTimeout(() => loadAudioWithRetry(url, sound, key, retries - 1, delay * 2), delay);
      } else {
        // Fallback to a silent buffer to prevent errors
        const silentBuffer = THREE.AudioContext.getContext().createBuffer(1, 1, 22050);
        sound.setBuffer(silentBuffer);
        audioLoaded[key] = true;
        console.warn(`Using silent buffer for ${key} after retries failed`);
      }
    }
  );
};

// Load all audio files
Object.keys(audioFiles).forEach(key => {
  loadAudioWithRetry(audioFiles[key], soundEffects[key], key);
});

// Set volumes (redundant but kept for consistency)
soundEffects.explosion.setVolume(0.6);
soundEffects.shoot.setVolume(0.3);
soundEffects.hit.setVolume(0.4);
soundEffects.powerUp.setVolume(0.4);
soundEffects.baseHit.setVolume(0.6);

// Game grid and terrain
const tileSize = 1;
const gridWidth = 61;
const gridHeight = 61;

// Lighting
const ambientLight = new THREE.AmbientLight(0x404040, 0.6);
const directionalLight = new THREE.DirectionalLight(0xffffff, 0.9);
directionalLight.position.set(45, 75, 45);
directionalLight.castShadow = true;
directionalLight.shadow.mapSize.set(2048, 2048);
directionalLight.shadow.camera.left = -90;
directionalLight.shadow.camera.right = 90;
directionalLight.shadow.camera.top = 90;
directionalLight.shadow.camera.bottom = -90;
scene.add(ambientLight, directionalLight);

// Brick textures
const brickTextures = {
  basecolor: textureLoader.load('/Bricks080C_1K-JPG/Bricks080C_1K-JPG_Color.jpg', undefined, undefined, (error) => console.error('Failed to load brick basecolor:', error)) || fallbackTexture,
  roughness: textureLoader.load('/Bricks080C_1K-JPG/Bricks080C_1K-JPG_Roughness.jpg', undefined, undefined, (error) => console.error('Failed to load brick roughness:', error)) || fallbackTexture,
  normal: textureLoader.load('/Bricks080C_1K-JPG/Bricks080C_1K-JPG_NormalGL.jpg', undefined, undefined, (error) => console.error('Failed to load brick normal:', error)) || fallbackTexture
};
Object.values(brickTextures).forEach(tex => {
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(1, 1);
});

const materials = {
  0: new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0 }),
  1: new THREE.MeshStandardMaterial({
    map: brickTextures.basecolor,
    roughnessMap: brickTextures.roughness,
    normalMap: brickTextures.normal,
    roughness: 0.8,
    metalness: 0.2
  }),
  2: new THREE.MeshStandardMaterial({ color: 0x4a4a4a, metalness: 0.9, roughness: 0.1 }),
  3: new THREE.MeshStandardMaterial({ color: 0x006994, transparent: true, opacity: 0.7, roughness: 0.95, emissive: 0x002244 }),
  4: new THREE.MeshStandardMaterial({ color: 0xff6600, emissive: 0x331100, metalness: 0.3, roughness: 0.7 })
};

// Generate terrain
const terrain = generateTerrain(gridWidth, gridHeight);
const brickHealth = Array(gridHeight).fill().map(() => Array(gridWidth).fill(0));
terrain.forEach((row, y) => row.forEach((type, x) => { if (type === 1) brickHealth[y][x] = 2; }));

const terrainGroup = new THREE.Group();
const bricks = [];
terrain.forEach((row, y) => {
  row.forEach((type, x) => {
    if (type === 0) return;
    const brick = createBrick(x, y, type, tileSize, gridWidth, gridHeight, materials);
    terrainGroup.add(brick.mesh);
    if (type === 1) bricks.push({ x, y, mesh: brick.mesh, geometry: brick.geometry, material: brick.material });
  });
});
scene.add(terrainGroup);

// Game state
let gameState = {
  running: false,
  over: false,
  twoPlayer: false,
  paused: false,
  wave: 1,
  waveTimer: 0,
  cameraShake: 0,
  particles: [],
  levelProgress: 0,
  killStreak: 0
};

let player = {
  x: 20, y: 59, dir: 3, lives: 3, invincible: false, shieldTime: 0,
  mesh: null, moveCooldown: 0, canShoot: true, bulletSpeed: 0.2,
  bulletPower: 1, maxBullets: 1, currentBullets: 0, rapidFire: false,
  shield: null, lastX: 20, lastY: 59, damageIndicator: null,
  healthRegen: 0, respawnTimer: 0, isPlayer: true, isPlayer1: true,
  scene, gridWidth, gridHeight, directions, soundEffects
};

let player2 = {
  x: 40, y: 59, dir: 3, lives: 3, invincible: false, shieldTime: 0,
  mesh: null, moveCooldown: 0, canShoot: true, bulletSpeed: 0.2,
  bulletPower: 1, maxBullets: 1, currentBullets: 0, rapidFire: false,
  shield: null, lastX: 40, lastY: 59, damageIndicator: null,
  healthRegen: 0, respawnTimer: 0, isPlayer: true, isPlayer1: false,
  scene, gridWidth, gridHeight, directions, soundEffects
};

let base = { x: 30, y: 59, mesh: null, health: 3, maxHealth: 3 };
let enemies = [];
let bullets = [];
let powerUps = [];
let level = 1;
let score = { value: 0 };
let highScore = parseInt(localStorage.getItem('highScore')) || 0;
let enemiesSpawned = 0;
let flashTimer = 0;

const levelConfig = {
  1: { maxEnemies: 6, spawnInterval: 120, maxPerWave: 20, shootCooldownMin: 120, shootCooldownMax: 180 },
  2: { maxEnemies: 8, spawnInterval: 100, maxPerWave: 22, shootCooldownMin: 105, shootCooldownMax: 165 },
  3: { maxEnemies: 10, spawnInterval: 80, maxPerWave: 24, shootCooldownMin: 90, shootCooldownMax: 150 },
  4: { maxEnemies: 12, spawnInterval: 60, maxPerWave: 26, shootCooldownMin: 75, shootCooldownMax: 135 },
  5: { maxEnemies: 15, spawnInterval: 50, maxPerWave: 30, shootCooldownMin: 60, shootCooldownMax: 90 }
};

const canMove = (x, y, excludeEntity = null) => {
  if (x < 0 || x >= gridWidth || y < 0 || y >= gridHeight) return false;
  if (terrain[y][x] !== 0) return false;
  const entities = [player, ...(gameState.twoPlayer ? [player2] : []), ...enemies];
  return !entities.some(entity => entity !== excludeEntity && entity.mesh && entity.mesh.parent && entity.x === x && entity.y === y);
};

// Mobile controls (joystick and shoot button)
let joystick, shootButton;
const touchControls = { direction: null, shoot: false };

const setupMobileControls = () => {
  // Remove existing controls to prevent duplicates
  let joystickZone = document.getElementById('joystickZone');
  if (joystickZone) joystickZone.remove();
  let existingShootButton = document.getElementById('shootButton');
  if (existingShootButton) existingShootButton.remove();
  let existingStyle = document.getElementById('mobileControlsStyle');
  if (existingStyle) existingStyle.remove();

  // Create joystick container
  joystickZone = document.createElement('div');
  joystickZone.id = 'joystickZone';
  joystickZone.style.position = 'fixed';
  joystickZone.style.left = '20px';
  joystickZone.style.bottom = '20px';
  joystickZone.style.width = '120px';
  joystickZone.style.height = '120px';
  joystickZone.style.zIndex = '10000';
  document.body.appendChild(joystickZone);

  // Create shoot button
  shootButton = document.createElement('div');
  shootButton.id = 'shootButton';
  shootButton.style.position = 'fixed';
  shootButton.style.right = '20px';
  shootButton.style.bottom = '20px';
  shootButton.style.width = '80px';
  shootButton.style.height = '80px';
  shootButton.style.background = 'rgba(255, 0, 0, 0.5)';
  shootButton.style.borderRadius = '50%';
  shootButton.style.border = '2px solid #fff';
  shootButton.style.zIndex = '10000';
  document.body.appendChild(shootButton);

  // CSS for mobile controls
  const style = document.createElement('style');
  style.id = 'mobileControlsStyle';
  style.textContent = `
    #joystickZone, #shootButton {
      display: none !important;
    }
    @media (max-width: 768px) {
      #joystickZone, #shootButton {
        display: block !important;
        visibility: visible !important;
      }
    }
  `;
  document.head.appendChild(style);

  // Load nipplejs dynamically
  const script = document.createElement('script');
  script.src = 'https://cdn.jsdelivr.net/npm/nipplejs@0.10.0/dist/nipplejs.min.js';
  script.onerror = () => console.error('Failed to load nipplejs');
  script.onload = () => {
    try {
      if (window.nipplejs) {
        if (joystick) joystick.destroy();
        joystick = window.nipplejs.create({
          zone: joystickZone,
          mode: 'static',
          position: { left: '50%', top: '50%' },
          size: 120,
          color: 'white',
          restOpacity: 0.5
        });

        joystick.on('move', (evt, data) => {
          touchControls.direction = data.vector;
          resumeAudioContext(); // Resume audio on joystick interaction
        });

        joystick.on('end', () => {
          touchControls.direction = null;
        });
      } else {
        console.error('nipplejs not available after script load');
      }
    } catch (error) {
      console.error('Error initializing joystick:', error);
    }
  };
  document.head.appendChild(script);

  // Shoot button events
  shootButton.addEventListener('touchstart', (e) => {
    e.preventDefault();
    touchControls.shoot = true;
    resumeAudioContext(); // Resume audio on shoot button touch
  }, { passive: false });
  shootButton.addEventListener('touchend', (e) => {
    e.preventDefault();
    touchControls.shoot = false;
  }, { passive: false });
};

const spawnEnemy = async () => {
  const config = levelConfig[Math.min(level, 5)];
  if (enemies.length >= config.maxEnemies || enemiesSpawned >= config.maxPerWave) return;
  const spawnPoints = [[5, 50], [30, 50], [55, 50]];
  const spawn = spawnPoints[Math.floor(Math.random() * spawnPoints.length)];
  const [x, y] = spawn;
  if (!canMove(x, y)) return;
  const typeKey = Object.keys(enemyTypes)[Math.floor(Math.random() * Object.keys(enemyTypes).length)];
  const type = enemyTypes[typeKey];
  try {
    const mesh = await createTank(x, y, 1, false, false, typeKey, scene, gridWidth, gridHeight, level);
    if (!mesh) return;
    const enemy = {
      x, y, dir: 1, armor: type.armor, maxArmor: type.armor, canShoot: true, moveCooldown: 0,
      shootCooldown: Math.floor(Math.random() * (config.shootCooldownMax - config.shootCooldownMin + 1) + config.shootCooldownMin),
      type: typeKey, mesh, aiTimer: 0,
      targetPlayer: Math.random() < 0.5 ? player : (gameState.twoPlayer ? player2 : player),
      hitEffect: null, frozen: 0, scene, gridWidth, gridHeight, directions, canMove, soundEffects
    };
    enemies.push(enemy);
    enemiesSpawned++;
  } catch (error) {
    console.error(`Failed to spawn enemy at (${x}, ${y}):`, error);
  }
};

const update = () => {
  if (!gameState.running || gameState.paused) return;

  if (flashTimer > 0) {
    flashTimer--;
    const flash = document.getElementById('flash');
    if (flash) flash.style.background = `rgba(255, 0, 0, ${flashTimer / 10})`;
  }

  gameState.particles = gameState.particles.filter(p => p?.mesh?.parent);
  gameState.particles.forEach(particle => {
    if (particle?.mesh?.position && particle.velocity) {
      particle.mesh.position.add(particle.velocity);
      particle.velocity.y -= 0.005;
      particle.life--;
      particle.mesh.material.opacity = particle.life / particle.maxLife;
      const t = 1 - particle.life / particle.maxLife;
      if (particle.type === 'shockwave') {
        particle.mesh.scale.setScalar(particle.initialScale + t * (particle.targetScale - particle.initialScale));
      } else if (particle.type === 'debris' && particle.rotationSpeed) {
        particle.mesh.rotation.x += particle.rotationSpeed.x;
        particle.mesh.rotation.y += particle.rotationSpeed.y;
        particle.mesh.rotation.z += particle.rotationSpeed.z;
      } else if (particle.type === 'smoke' && particle.growth) {
        particle.mesh.scale.setScalar(1 + t * particle.growth);
      }
      if (particle.life <= 0) particlePool.release(particle);
    }
  });
  gameState.particles = gameState.particles.filter(p => p.life > 0);

  [player, ...(gameState.twoPlayer ? [player2] : [])].forEach(p => {
    if (p.moveCooldown > 0) p.moveCooldown--;
    if (p.respawnTimer > 0) p.respawnTimer--;
    if (p.shieldTime > 0) {
      p.shieldTime--;
      if (p.shield?.mesh) {
        p.shield.mesh.position.copy(p.mesh.position);
        p.shield.mesh.position.y += 0.15 * (p.mesh.userData.scale || 0.006) / 0.006;
        p.shield.mesh.rotation.y += 0.1;
        p.shield.mesh.material.opacity = 0.4 + Math.sin(Date.now() * 0.01) * 0.1;
      }
      if (p.shieldTime <= 0) {
        p.invincible = false;
        if (p.shield?.mesh) {
          p.shield.mesh.parent.remove(p.shield.mesh);
          p.shield.geometry.dispose();
          p.shield.material.dispose();
          p.shield = null;
        }
      }
    }
    if (p.damageIndicator?.mesh) {
      p.damageIndicator.mesh.material.opacity -= 0.01;
      if (p.damageIndicator.mesh.material.opacity <= 0) {
        p.damageIndicator.mesh.parent.remove(p.damageIndicator.mesh);
        p.damageIndicator.geometry.dispose();
        p.damageIndicator.material.dispose();
        p.damageIndicator = null;
      }
    }
  });

  const handlePlayerMovement = (p, controls) => {
    if (p.respawnTimer > 0 || !p.mesh?.parent) return;
    let moved = false;

    // Handle joystick input
    if (controls.direction && p.moveCooldown === 0) {
      const { x, y } = controls.direction;
      const threshold = 0.3;
      let newDir = p.dir;

      if (Math.abs(x) > Math.abs(y)) {
        if (x > threshold) { newDir = 0; moved = moveTank(p, 1, 0, canMove, 0); }
        else if (x < -threshold) { newDir = 2; moved = moveTank(p, -1, 0, canMove, 2); }
      } else {
        if (y > threshold) { newDir = 3; moved = moveTank(p, 0, -1, canMove, 3); }
        else if (y < -threshold) { newDir = 1; moved = moveTank(p, 0, 1, canMove, 1); }
      }

      if (moved) p.dir = newDir;
    }

    // Handle keyboard/gamepad input
    if (controls.left && p.moveCooldown === 0) { p.dir = 2; moved = moveTank(p, -1, 0, canMove, 0); }
    else if (controls.right && p.moveCooldown === 0) { p.dir = 0; moved = moveTank(p, 1, 0, canMove, 2); }
    else if (controls.up && p.moveCooldown === 0) { p.dir = 3; moved = moveTank(p, 0, -1, canMove, 3); }
    else if (controls.down && p.moveCooldown === 0) { p.dir = 1; moved = moveTank(p, 0, 1, canMove, 1); }

    if (moved) p.mesh.rotation.y = p.dir * Math.PI / 2;

    if (controls.shoot && p.canShoot) {
      const bullet = shoot(p, true, scene, gridWidth, gridHeight, soundEffects);
      if (bullet) {
        bullet.range = 20;
        bullet.distanceTraveled = 0;
        bullets.push(bullet);
        playSound(soundEffects.shoot, 0.3);
      }
    }
    p.healthRegen++;
    if (p.healthRegen > 300 && p.lives < 5) {
      p.lives++;
      p.healthRegen = 0;
    }
  };

  const gamepad = navigator.getGamepads()[0];
  const gamepadControls = gamepad ? {
    left: gamepad.axes[0] < -0.5 || gamepad.buttons[14].pressed,
    right: gamepad.axes[0] > 0.5 || gamepad.buttons[15].pressed,
    up: gamepad.axes[1] < -0.5 || gamepad.buttons[12].pressed,
    down: gamepad.axes[1] > 0.5 || gamepad.buttons[13].pressed,
    shoot: gamepad.buttons[0].pressed
  } : {};

  handlePlayerMovement(player, {
    left: keys.ArrowLeft || keys.a || gamepadControls.left,
    right: keys.ArrowRight || keys.d || gamepadControls.right,
    up: keys.ArrowUp || keys.w || gamepadControls.up,
    down: keys.ArrowDown || keys.s || gamepadControls.down,
    shoot: keys.Space || gamepadControls.shoot || touchControls.shoot,
    direction: touchControls.direction
  });

  if (gameState.twoPlayer && player2.mesh?.parent) {
    handlePlayerMovement(player2, {
      left: keys.KeyJ,
      right: keys.KeyL,
      up: keys.KeyI,
      down: keys.KeyK,
      shoot: keys.KeyU
    });
  }

  enemies = enemies.filter(e => e.mesh?.parent);
  enemies.forEach(enemy => {
    if (enemy.frozen > 0) {
      enemy.frozen--;
      if (enemy.frozen <= 0) {
        enemy.mesh.traverse(child => {
          if (child.isMesh) child.material = child.material.clone().setValues({ color: enemyTypes[enemy.type].color });
        });
      }
    } else {
      const bullet = updateEnemyAI(enemy, player, player2, gameState, terrainGroup, level);
      if (bullet) {
        bullet.range = 10;
        bullet.distanceTraveled = 0;
        bullets.push(bullet);
        playSound(soundEffects.shoot, 0.3);
      }
    }
    if (enemy.hitEffect?.mesh) {
      enemy.hitEffect.mesh.material.opacity -= 0.02;
      if (enemy.hitEffect.mesh.material.opacity <= 0) {
        enemy.hitEffect.mesh.parent.remove(enemy.hitEffect.mesh);
        enemy.hitEffect.geometry.dispose();
        enemy.hitEffect.material.dispose();
        enemy.hitEffect = null;
      }
    }
  });

  bullets = bullets.filter(b => b.mesh?.parent);
  bullets.forEach((bullet, i) => {
    const result = bulletPool.updateBullet(bullet, scene, [player, ...(gameState.twoPlayer ? [player2] : []), ...enemies], terrain, gridWidth, gridHeight, soundEffects, score);
    if (result.hit) {
      if (result.type === 'terrain' && terrain[result.y][result.x] === 1) {
        brickHealth[result.y][result.x] -= bullet.power;
        if (brickHealth[result.y][result.x] <= 0) {
          terrain[result.y][result.x] = 0;
          const hitBrick = bricks.find(b => b.x === result.x && b.y === result.y);
          if (hitBrick) {
            createExplosion(bullet.mesh.position.x, bullet.mesh.position.y, bullet.mesh.position.z, 1, scene, gameState, soundEffects);
            disposeBrick(hitBrick);
            bricks.splice(bricks.indexOf(hitBrick), 1);
            if (Math.random() < 0.2) {
              const type = Object.keys(powerUpTypes)[Math.floor(Math.random() * Object.keys(powerUpTypes).length)];
              powerUps.push(createPowerUp(result.x, result.y, type, scene, gridWidth, gridHeight));
            }
          }
        } else {
          createSpark(bullet.mesh.position.x, bullet.mesh.position.y, bullet.mesh.position.z, scene, gameState);
          playSound(soundEffects.hit, 0.4);
        }
      } else if (result.type === 'base') {
        base.health -= bullet.power;
        flashTimer = 10;
        createExplosion(base.mesh.position.x, base.mesh.position.y + 0.5, base.mesh.position.z, 1.5, scene, gameState, soundEffects);
        playSound(soundEffects.baseHit, 0.6);
        if (base.health <= 0) gameOver();
      } else if (result.type === 'tank' && result.tank) {
        if (result.destroyed && !result.tank.isPlayer) {
          createExplosion(result.tank.mesh.position.x, result.tank.mesh.position.y + 0.5, result.tank.mesh.position.z, 2, scene, gameState, soundEffects);
          disposeTank(result.tank);
          enemies = enemies.filter(e => e !== result.tank);
          gameState.killStreak++;
          score.value += enemyTypes[result.tank.type].score * (gameState.killStreak + 1);
          if (Math.random() < 0.15) {
            const type = Object.keys(powerUpTypes)[Math.floor(Math.random() * Object.keys(powerUpTypes).length)];
            powerUps.push(createPowerUp(result.tank.x, result.tank.y, type, scene, gridWidth, gridHeight));
          }
        } else if (result.tank.isPlayer) {
          createSpark(bullet.mesh.position.x, bullet.mesh.position.y + 0.3, bullet.mesh.position.z, scene, gameState);
          playSound(soundEffects.hit, 0.4);
          createExplosion(result.tank.mesh.position.x, result.tank.mesh.position.y + 0.5, result.tank.mesh.position.z, 2, scene, gameState, soundEffects);
          disposeTank(result.tank);
          result.tank.mesh = null;
          result.tank.respawnTimer = 120;
        }
      }
      bulletPool.destroyBullet(bullet, scene);
      bullets.splice(i, 1);
      if (bullet.owner) bullet.owner.currentBullets--;
    }
  });

  powerUps = powerUps.filter(pu => pu.mesh?.parent);
  powerUps.forEach((pu, i) => {
    powerUpUtils.update(pu, 1 / 60);
    [player, ...(gameState.twoPlayer ? [player2] : [])].forEach(p => {
      if (!p.mesh || !pu.mesh) return;
      const dist = Math.hypot(p.x - pu.x, p.y - pu.y);
      if (dist < 0.5) {
        if (pu.type === 'B') {
          enemies.forEach(e => {
            if (e.mesh) {
              createExplosion(e.mesh.position.x, e.mesh.position.y + 0.5, e.mesh.position.z, 2, scene, gameState, soundEffects);
              disposeTank(e);
            }
          });
          enemies = [];
          score.value += 1000;
          playSound(soundEffects.powerUp, 0.4);
        } else if (pu.type === 'C') {
          enemies.forEach(e => {
            e.frozen = 300;
            e.mesh.traverse(child => {
              if (child.isMesh) child.material = new THREE.MeshStandardMaterial({ color: 0x88ccff });
            });
          });
          score.value += powerUpTypes[pu.type].score;
          playSound(soundEffects.powerUp, 0.4);
        } else {
          applyPowerUp(p, pu.type, score, soundEffects);
        }
        powerUpUtils.dispose(pu);
        powerUps.splice(i, 1);
      }
    });
  });

  [player, ...(gameState.twoPlayer ? [player2] : [])].forEach(p => {
    if (p.respawnTimer === 1 && p.lives > 0) {
      respawnPlayer(p, scene, gridWidth, gridHeight).then(success => {
        if (!success) {
          p.lives = 0;
          if (!gameState.twoPlayer || (player.lives <= 0 && player2.lives <= 0)) gameOver();
        }
      });
    }
  });

  gameState.waveTimer++;
  const config = levelConfig[Math.min(level, 5)];
  if (enemiesSpawned < config.maxPerWave && gameState.waveTimer % config.spawnInterval === 0) spawnEnemy();
  if (enemiesSpawned >= config.maxPerWave && enemies.length === 0) {
    gameState.wave++;
    gameState.waveTimer = 0;
    enemiesSpawned = 0;
    level++;
    terrainGroup.children = terrainGroup.children.filter(child => child?.parent);
    terrain.forEach((row, y) => {
      row.forEach((type, x) => {
        if (type === 0 || bricks.find(b => b.x === x && b.y === y)) return;
        const brick = createBrick(x, y, type, tileSize, gridWidth, gridHeight, materials);
        terrainGroup.add(brick.mesh);
        if (type === 1) {
          bricks.push({ x, y, mesh: brick.mesh, geometry: brick.geometry, material: brick.material });
          brickHealth[y][x] = 2;
        }
      });
    });
  }

  if (Math.random() < 0.005 && powerUps.length < 3) {
    const x = Math.floor(Math.random() * (gridWidth - 2)) + 1;
    const y = Math.floor(Math.random() * (gridHeight - 2)) + 1;
    if (terrain[y][x] === 0 && !powerUps.some(pu => pu.x === x && pu.y === y) && canMove(x, y)) {
      const type = Object.keys(powerUpTypes)[Math.floor(Math.random() * Object.keys(powerUpTypes).length)];
      powerUps.push(createPowerUp(x, y, type, scene, gridWidth, gridHeight));
    }
  }

  if (player.mesh?.parent) {
    const aspect = window.innerWidth / window.innerHeight;
    const zoom = aspect < 1 ? 8 : 6;
    camera.position.set(player.mesh.position.x - zoom, zoom * 1.5, player.mesh.position.z + zoom);
    camera.lookAt(player.mesh.position);
  }
  if (gameState.cameraShake > 0) {
    camera.position.x += (Math.random() - 0.5) * 0.2;
    camera.position.z += (Math.random() - 0.5) * 0.2;
    gameState.cameraShake--;
  }

  const hud = document.getElementById('hud');
  if (hud) hud.textContent = `Lives: ${player.lives}${gameState.twoPlayer ? ' | P2: ' + player2.lives : ''} | Score: ${score.value} | Level: ${level} | Wave: ${gameState.wave} | Multiplier: x${gameState.killStreak + 1}`;
  const baseHealthBar = document.getElementById('baseHealthBar');
  if (baseHealthBar) baseHealthBar.style.width = `${(base.health / base.maxHealth) * 100}%`;

  renderer.render(scene, camera);
};

const gameOver = () => {
  gameState.running = false;
  gameState.over = true;
  if (score.value > highScore) {
    highScore = score.value;
    localStorage.setItem('highScore', highScore);
  }
  const gameOverElement = document.getElementById('gameOver');
  if (gameOverElement) gameOverElement.style.display = 'block';
  const finalScore = document.getElementById('finalScore');
  if (finalScore) finalScore.textContent = `Final Score: ${score.value}`;
  const highScoreElement = document.getElementById('highScore');
  if (highScoreElement) highScoreElement.textContent = `High Score: ${highScore}`;
  const hud = document.getElementById('hud');
  if (hud) hud.style.display = 'none';
  if (audioLoaded.bgm) soundEffects.bgm.stop();
};

const keys = {};
const keyHandler = e => { keys[e.code] = e.type === 'keydown'; };
document.addEventListener('keydown', keyHandler);
document.addEventListener('keyup', keyHandler);
document.addEventListener('keydown', e => {
  if (e.code === 'Escape' && gameState.running && !gameState.over) {
    gameState.paused = !gameState.paused;
    const pauseMenu = document.getElementById('pauseMenu');
    const hud = document.getElementById('hud');
    if (pauseMenu) pauseMenu.style.display = gameState.paused ? 'block' : 'none';
    if (hud) hud.style.display = gameState.paused ? 'none' : 'block';
    if (gameState.paused && audioLoaded.bgm) {
      soundEffects.bgm.pause();
    } else if (audioLoaded.bgm) {
      playSound(soundEffects.bgm, 0.3);
    }
  }
});

const resetGame = async () => {
  gameState.running = false;
  gameState.over = false;
  gameState.paused = false;
  [player, player2, base].concat(enemies, bullets, powerUps).forEach(entity => {
    if (entity.mesh) disposeTank(entity);
    if (entity.mesh?.baseGeometry) powerUpUtils.dispose(entity);
  });
  gameState.particles.forEach(p => particlePool.release(p));
  gameState.particles = [];
  bullets = [];
  enemies = [];
  powerUps = [];
  enemiesSpawned = 0;
  gameState.wave = 1;
  gameState.waveTimer = 0;
  gameState.killStreak = 0;
  level = 1;
  score.value = 0;
  player = {
    x: 20, y: 59, dir: 3, lives: 3, invincible: false, shieldTime: 0,
    mesh: null, moveCooldown: 0, canShoot: true, bulletSpeed: 0.2,
    bulletPower: 1, maxBullets: 1, currentBullets: 0, rapidFire: false,
    shield: null, lastX: 20, lastY: 59, damageIndicator: null,
    healthRegen: 0, respawnTimer: 0, isPlayer: true, isPlayer1: true,
    scene, gridWidth, gridHeight, directions, soundEffects
  };
  player2 = {
    x: 40, y: 59, dir: 3, lives: 3, invincible: false, shieldTime: 0,
    mesh: null, moveCooldown: 0, canShoot: true, bulletSpeed: 0.2,
    bulletPower: 1, maxBullets: 1, currentBullets: 0, rapidFire: false,
    shield: null, lastX: 40, lastY: 59, damageIndicator: null,
    healthRegen: 0, respawnTimer: 0, isPlayer: true, isPlayer1: false,
    scene, gridWidth, gridHeight, directions, soundEffects
  };
  base = { x: 30, y: 59, mesh: null, health: 3, maxHealth: 3 };
  terrainGroup.children = [];
  bricks.length = 0;
  const newTerrain = generateTerrain(gridWidth, gridHeight);
  terrain.forEach((row, y) => row.forEach((_, x) => terrain[y][x] = newTerrain[y][x]));
  terrain.forEach((row, y) => {
    row.forEach((type, x) => {
      if (type === 0) return;
      const brick = createBrick(x, y, type, tileSize, gridWidth, gridHeight, materials);
      terrainGroup.add(brick.mesh);
      if (type === 1) {
        bricks.push({ x, y, mesh: brick.mesh, geometry: brick.geometry, material: brick.material });
        brickHealth[y][x] = 2;
      }
    });
  });
  const gameOverElement = document.getElementById('gameOver');
  if (gameOverElement) gameOverElement.style.display = 'none';
  const menu = document.getElementById('menu');
  if (menu) menu.style.display = 'block';
  if (audioLoaded.bgm) playSound(soundEffects.bgm, 0.3);
  setupMobileControls();
};

const init = async () => {
  try {
    player.mesh = await createTank(player.x, player.y, player.dir, true, false, 'basic', scene, gridWidth, gridHeight);
    if (gameState.twoPlayer) {
      player2.mesh = await createTank(player2.x, player2.y, player2.dir, true, true, 'basic', scene, gridWidth, gridHeight);
    }
    base.mesh = createBrick(base.x, base.y, 4, tileSize, gridWidth, gridHeight, materials).mesh;
    scene.add(base.mesh);
    player.shield = createShield(player);
    player.invincible = true;
    player.shieldTime = 180;
    if (gameState.twoPlayer) {
      player2.shield = createShield(player2);
      player2.invincible = true;
      player2.shieldTime = 180;
    }
    gameState.running = true;
    if (audioLoaded.bgm) playSound(soundEffects.bgm, 0.3);
    setupMobileControls();
  } catch (error) {
    console.error('Failed to initialize game:', error);
    gameOver();
  }
};

document.addEventListener('DOMContentLoaded', () => {
  const startButton = document.getElementById('startButton');
  const twoPlayerButton = document.getElementById('twoPlayerButton');
  const helpButton = document.getElementById('helpButton');
  const helpButtonGameOver = document.getElementById('helpButtonGameOver');
  const resumeButton = document.getElementById('resumeButton');
  const restartButton = document.getElementById('restartButton');
  const quitButton = document.getElementById('quitButton');

  startButton?.addEventListener('click', () => {
    resumeAudioContext();
    gameState.twoPlayer = false;
    document.getElementById('menu').style.display = 'none';
    document.getElementById('hud').style.display = 'block';
    init();
  });

  twoPlayerButton?.addEventListener('click', () => {
    resumeAudioContext();
    gameState.twoPlayer = true;
    document.getElementById('menu').style.display = 'none';
    document.getElementById('hud').style.display = 'block';
    init();
  });

  helpButton?.addEventListener('click', () => {
    resumeAudioContext();
    document.getElementById('helpModal').style.display = 'block';
  });

  helpButtonGameOver?.addEventListener('click', () => {
    resumeAudioContext();
    document.getElementById('helpModal').style.display = 'block';
  });

  resumeButton?.addEventListener('click', () => {
    resumeAudioContext();
    gameState.paused = false;
    document.getElementById('pauseMenu').style.display = 'none';
    document.getElementById('hud').style.display = 'block';
    if (audioLoaded.bgm) playSound(soundEffects.bgm, 0.3);
    setupMobileControls();
  });

  restartButton?.addEventListener('click', () => {
    resumeAudioContext();
    resetGame();
  });

  quitButton?.addEventListener('click', () => {
    resumeAudioContext();
    resetGame();
  });
});

const animate = () => {
  requestAnimationFrame(animate);
  update();
};
animate();