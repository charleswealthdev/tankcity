import * as THREE from 'three';

const directions = [[1, 0], [0, 1], [-1, 0], [0, -1]];

const colors = {
  spark: 0xffff00,
  shockwave: 0x00ffff,
  explosion: 0xff8800,
  particle: 0xff4400,
  debris: 0x666666,
  smoke: 0x555555
};

const particleConfig = {
  spark: {
    geometry: () => new THREE.SphereGeometry(0.08, 10, 10),
    material: () => new THREE.MeshBasicMaterial({ color: colors.spark, transparent: true, opacity: 0.9 }),
    life: 60
  },
  particle: {
    geometry: size => new THREE.SphereGeometry(0.04 + Math.random() * 0.03 * size, 6, 6),
    material: () => new THREE.MeshBasicMaterial({ color: colors.particle, transparent: true, opacity: 1.0 }),
    life: 120
  },
  debris: {
    geometry: () => new THREE.BoxGeometry(0.05 + Math.random() * 0.15, 0.05 + Math.random() * 0.15, 0.05 + Math.random() * 0.15),
    material: () => new THREE.MeshStandardMaterial({ color: colors.debris, metalness: 0.5, roughness: 0.7 }),
    life: 200
  },
  smoke: {
    geometry: size => new THREE.SphereGeometry(0.3 * size, 8, 8),
    material: () => new THREE.MeshBasicMaterial({ color: colors.smoke, transparent: true, opacity: 0.7 }),
    life: 180
  },
  shockwave: {
    geometry: size => new THREE.RingGeometry(0.3, 1.5 * size, 32),
    material: () => new THREE.MeshBasicMaterial({ color: colors.shockwave, transparent: true, opacity: 0.9 }),
    life: 60
  }
};

const particlePool = {
  pool: [],
  maxSize: 100,
  create(type, size = 1) {
    const config = particleConfig[type];
    if (!config) return null;
    let particle = this.pool.find(p => p.type === type && !p.isActive) || null;
    if (particle) {
      particle.mesh.visible = true;
      particle.mesh.scale.setScalar(1);
      particle.mesh.material.opacity = type === 'shockwave' ? 0.9 : type === 'smoke' ? 0.7 : 1.0;
      particle.life = config.life;
      particle.maxLife = config.life;
      particle.isActive = true;
    } else {
      const geometry = config.geometry(size);
      const material = config.material();
      const mesh = new THREE.Mesh(geometry, material);
      mesh.castShadow = type === 'debris';
      particle = { mesh, geometry, material, type, life: config.life, maxLife: config.life, isActive: true, velocity: new THREE.Vector3(), rotationSpeed: type === 'debris' ? new THREE.Vector3() : null };
    }
    return particle;
  },
  release(particle) {
    if (!particle) return;
    particle.isActive = false;
    particle.mesh.visible = false;
    if (particle.mesh.parent) particle.mesh.parent.remove(particle.mesh);
    if (this.pool.length < this.maxSize) {
      this.pool.push(particle);
    } else {
      if (particle.geometry) particle.geometry.dispose();
      if (particle.material) particle.material.dispose();
    }
  },
  dispose() {
    this.pool.forEach(p => {
      if (p.mesh?.parent) p.mesh.parent.remove(p.mesh);
      if (p.geometry) p.geometry.dispose();
      if (p.material) p.material.dispose();
    });
    this.pool = [];
  }
};

const createBrick = (x, y, type, tileSize, gridWidth, gridHeight, materials, isFence = false) => {
  const brickType = Math.min(4, Math.max(0, Math.floor(type)));
  const height = brickType === 2 ? 1.3 : 1.2;
  // Fence: 2x1 or 1x2; Inner bricks: 3x1 or 1x3
  const isHorizontal = Math.random() < 0.5;
  const width = isHorizontal ? tileSize * (isFence ? 2 : 3) : tileSize;
  const depth = isHorizontal ? tileSize : tileSize * (isFence ? 2 : 3);
  const geometry = new THREE.BoxGeometry(width, height, depth);
  const material = materials[brickType] || new THREE.MeshStandardMaterial({ color: 0x888888 });
  const mesh = new THREE.Mesh(geometry, material);
  // Adjust position to center the larger brick
  const offsetX = isHorizontal ? (isFence ? 0.5 : 1.0) : 0;
  const offsetZ = isHorizontal ? 0 : (isFence ? 0.5 : 1.0);
  mesh.position.set(x - gridWidth / 2 + 0.5 + offsetX, height / 2, y - gridHeight / 2 + 0.5 + offsetZ);
  mesh.receiveShadow = true;
  mesh.castShadow = true;
  mesh.visible = true;
  // Store occupied cells
  const cells = [];
  if (isHorizontal) {
    for (let i = 0; i < (isFence ? 2 : 3); i++) {
      if (x + i < gridWidth) cells.push([x + i, y]);
    }
  } else {
    for (let i = 0; i < (isFence ? 2 : 3); i++) {
      if (y + i < gridHeight) cells.push([x, y + i]);
    }
  }
  mesh.userData = { x, y, type: brickType, destructible: brickType === 1, isHorizontal, cells };
  return { mesh, geometry, material, type: brickType };
};

const disposeBrick = brick => {
  if (!brick?.mesh?.parent) return;
  brick.mesh.parent.remove(brick.mesh);
  if (brick.geometry) brick.geometry.dispose();
  if (brick.material) {
    if (Array.isArray(brick.material)) {
      brick.material.forEach(mat => mat?.dispose());
    } else {
      brick.material?.dispose();
    }
  }
  brick.mesh = null;
  brick.geometry = null;
  brick.material = null;
};

const generateTerrain = (gridWidth, gridHeight) => {
  const terrain = Array(gridHeight).fill().map(() => Array(gridWidth).fill(0));

  // Base (1 brick)
  terrain[59][30] = 4;

  // Enhanced base protection (30 bricks)
  const baseProtection = [
    [27, 55, 2], [28, 55, 1], [29, 55, 1], [30, 55, 2], [31, 55, 1], [32, 55, 1], [33, 55, 2],
    [27, 56, 2], [28, 56, 1], [29, 56, 1], [30, 56, 2], [31, 56, 1], [32, 56, 1], [33, 56, 2],
    [27, 57, 1], [28, 57, 1], [29, 57, 1], [30, 57, 1], [31, 57, 1], [32, 57, 1], [33, 57, 1],
    [27, 58, 2], [28, 58, 1], [29, 58, 1], [31, 58, 1], [32, 58, 1], [33, 58, 2],
    [28, 59, 1], [29, 59, 1], [31, 59, 1], [32, 59, 1]
  ];
  baseProtection.forEach(([x, y, type]) => {
    if (x >= 0 && x < gridWidth && y >= 0 && y < gridHeight) {
      terrain[y][x] = type;
    }
  });

  // Boundary fence (~70 bricks, type 2, 2x1 or 1x2)
  const placed = new Set();
  const addFenceBrick = (x, y, isHorizontal) => {
    const cells = isHorizontal ? [[x, y], [x + 1, y]] : [[x, y], [x, y + 1]];
    if (cells.every(([cx, cy]) => cx >= 0 && cx < gridWidth && cy >= 0 && cy < gridHeight && !placed.has(`${cx},${cy}`))) {
      terrain[y][x] = 2;
      cells.forEach(([cx, cy]) => placed.add(`${cx},${cy}`));
      return true;
    }
    return false;
  };

  // Top and bottom edges (y=0, y=60), skip spawn areas
  for (let x = 0; x < gridWidth - 1; x += 2) {
    if ((x < 18 || x > 22) && (x < 38 || x > 42)) {
      addFenceBrick(x, 0, true);
      addFenceBrick(x, gridHeight - 1, true);
    }
  }
  // Left and right edges (x=0, x=60)
  for (let y = 0; y < gridHeight - 1; y += 2) {
    if (y < 57 || y > 59) {
      addFenceBrick(0, y, false);
      addFenceBrick(gridWidth - 1, y, false);
    }
  }

  // Random bricks (69–119 to reach 100–150 total)
  const innerWidth = gridWidth - 8;
  const innerHeight = gridHeight - 8;
  const randomBrickCount = Math.floor(Math.random() * 51) + 69; // 69 to 119 bricks
  const avoidAreas = [
    { x: 20, y: 59, radius: 3 }, // Player 1 spawn
    { x: 40, y: 59, radius: 3 }, // Player 2 spawn
    { x: 30, y: 59, radius: 5 }  // Base area
  ];

  const isValidPosition = (x, y, isHorizontal) => {
    const cells = isHorizontal ? [[x, y], [x + 1, y], [x + 2, y]] : [[x, y], [x, y + 1], [x, y + 2]];
    if (cells.some(([cx, cy]) => cx < 0 || cx >= gridWidth || cy < 0 || cy >= gridHeight)) return false;
    if (cells.some(([cx, cy]) => terrain[cy][cx] !== 0 || placed.has(`${cx},${cy}`))) return false;
    for (const area of avoidAreas) {
      if (cells.some(([cx, cy]) => {
        const dx = cx - area.x;
        const dy = cy - area.y;
        return Math.sqrt(dx * dx + dy * dy) < area.radius;
      })) return false;
    }
    return true;
  };

  let placedCount = 0;
  while (placedCount < randomBrickCount) {
    const x = Math.floor(Math.random() * (innerWidth - 2)) + 4;
    const y = Math.floor(Math.random() * (innerHeight - 2)) + 4;
    const isHorizontal = Math.random() < 0.5;
    if (isValidPosition(x, y, isHorizontal)) {
      const type = Math.random() < 0.6 ? 1 : Math.random() < 0.5 ? 2 : 3;
      terrain[y][x] = type;
      const cells = isHorizontal ? [[x, y], [x + 1, y], [x + 2, y]] : [[x, y], [x, y + 1], [x, y + 2]];
      cells.forEach(([cx, cy]) => {
        if (cx >= 0 && cx < gridWidth && cy >= 0 && cy < gridHeight) {
          terrain[cy][cx] = type;
          placed.add(`${cx},${cy}`);
        }
      });
      placedCount++;
    }
  }

  // Clear player spawn areas
  for (let y = 57; y <= 59; y++) {
    for (let x = 18; x <= 22; x++) terrain[y][x] = 0;
    for (let x = 38; x <= 42; x++) terrain[y][x] = 0;
  }

  return terrain;
};

const createExplosion = (x, y, z, size, scene, gameState, soundEffects) => {
  if (!gameState.particles) gameState.particles = [];
  const explosionSize = Math.max(0.5, Math.min(3.0, size));
  const particleCount = Math.floor(40 + explosionSize * 20);
  const debrisCount = Math.floor(15 * explosionSize);
  const smokeCount = Math.floor(20 * explosionSize);
  const particles = [];

  for (let i = 0; i < particleCount; i++) {
    const particle = particlePool.create('particle', explosionSize);
    if (particle) {
      particle.mesh.position.set(x, y, z);
      particle.velocity = new THREE.Vector3((Math.random() - 0.5) * 0.8, Math.random() * 0.6 + 0.3, (Math.random() - 0.5) * 0.8);
      scene.add(particle.mesh);
      particles.push(particle);
    }
  }

  for (let i = 0; i < debrisCount; i++) {
    const debris = particlePool.create('debris', explosionSize);
    if (debris) {
      debris.mesh.position.set(x, y, z);
      debris.velocity = new THREE.Vector3((Math.random() - 0.5) * 0.6, Math.random() * 0.5 + 0.2, (Math.random() - 0.5) * 0.6);
      debris.rotationSpeed = new THREE.Vector3((Math.random() - 0.5) * 0.15, (Math.random() - 0.5) * 0.15, (Math.random() - 0.5) * 0.15);
      scene.add(debris.mesh);
      particles.push(debris);
    }
  }

  for (let i = 0; i < smokeCount; i++) {
    const smoke = particlePool.create('smoke', explosionSize);
    if (smoke) {
      smoke.mesh.position.set(x, y, z);
      smoke.velocity = new THREE.Vector3((Math.random() - 0.5) * 0.4, Math.random() * 0.3 + 0.15, (Math.random() - 0.5) * 0.4);
      smoke.growth = 1 + Math.random() * 0.5;
      scene.add(smoke.mesh);
      particles.push(smoke);
    }
  }

  const shockwave = particlePool.create('shockwave', explosionSize);
  if (shockwave) {
    shockwave.mesh.position.set(x, y, z);
    shockwave.mesh.rotation.x = -Math.PI / 2;
    shockwave.initialScale = 0.1;
    shockwave.targetScale = explosionSize * 2;
    scene.add(shockwave.mesh);
    particles.push(shockwave);
    setTimeout(() => particlePool.release(shockwave), shockwave.maxLife * 16.67);
  }

  gameState.particles.push(...particles);
  gameState.cameraShake = Math.min(gameState.cameraShake + explosionSize * 10, 30);

  if (soundEffects?.explosion?.play) {
    soundEffects.explosion.setVolume(0.6);
    soundEffects.explosion.play();
  }
};

const createSpark = (x, y, z, scene, gameState) => {
  if (!gameState.particles) gameState.particles = [];
  const sparkCount = 3 + Math.floor(Math.random() * 3);
  const particles = [];

  for (let i = 0; i < sparkCount; i++) {
    const spark = particlePool.create('spark');
    if (spark) {
      spark.mesh.position.set(x, y, z);
      spark.velocity = new THREE.Vector3((Math.random() - 0.5) * 0.5, Math.random() * 0.4 + 0.2, (Math.random() - 0.5) * 0.5);
      scene.add(spark.mesh);
      particles.push(spark);
    }
  }

  gameState.particles.push(...particles);
};

const createMuzzleFlash = (x, y, z, dir, scene) => {
  const flash = particlePool.create('spark');
  if (!flash) return;
  const offset = directions[dir];
  flash.mesh.position.set(x + offset[0] * 0.4, y, z + offset[1] * 0.4);
  flash.mesh.scale.setScalar(0.5);
  flash.velocity = new THREE.Vector3(offset[0] * 0.3, 0.1, offset[1] * 0.3);
  flash.life = 10;
  flash.maxLife = 10;
  scene.add(flash.mesh);
  setTimeout(() => particlePool.release(flash), 150);
};

const createHitEffect = (x, y, z, scene, gameState) => {
  if (!gameState.particles) gameState.particles = [];
  const sparkCount = 2 + Math.floor(Math.random() * 2);
  const particles = [];

  for (let i = 0; i < sparkCount; i++) {
    const spark = particlePool.create('spark');
    if (spark) {
      spark.mesh.position.set(x, y, z);
      spark.velocity = new THREE.Vector3((Math.random() - 0.5) * 0.3, Math.random() * 0.2 + 0.1, (Math.random() - 0.5) * 0.3);
      scene.add(spark.mesh);
      particles.push(spark);
    }
  }

  gameState.particles.push(...particles);
};

export { createBrick, generateTerrain, createExplosion, createSpark, createMuzzleFlash, createHitEffect, disposeBrick, particlePool };