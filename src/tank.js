import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { createExplosion, createHitEffect, createMuzzleFlash } from './brick.js';

const colors = {
  bullet: 0xffff00,
  damage: 0xff0000,
  shield: 0x00ffff,
  muzzleFlash: 0xffaa00,
  explosion: 0xff4400,
  bulletTrail: 0xffffff
};

const directions = [[1, 0], [0, 1], [-1, 0], [0, -1]]; // Right, Down, Left, Up

const modelCache = {
  player: null,
  enemy: null,
  powerUp: null,
  loader: new GLTFLoader()
};

const bulletPool = {
  pool: [],
  maxSize: 50,

  create(power = 1) {
    let bullet;
    if (this.pool.length > 0) {
      bullet = this.pool.pop();
      bullet.mesh.visible = true;
      bullet.mesh.scale.set(Math.max(0.3, power * 0.5), Math.max(0.3, power * 0.5), Math.max(0.3, power * 0.5));
    } else {
      const bulletRadius = 0.05 * Math.max(0.3, power);
      const geometry = new THREE.SphereGeometry(bulletRadius, 8, 8);
      const material = new THREE.MeshStandardMaterial({
        color: colors.bullet,
        emissive: 0x444400,
        metalness: 0.7,
        roughness: 0.2,
        transparent: true,
        opacity: 0.9
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.castShadow = true;
      bullet = {
        mesh,
        geometry,
        material,
        isActive: true
      };
    }
    return bullet;
  },

  release(bullet) {
    if (!bullet) return;
    bullet.isActive = false;
    bullet.mesh.visible = false;
    if (this.pool.length < this.maxSize) {
      this.pool.push(bullet);
    } else {
      if (bullet.mesh?.parent) bullet.mesh.parent.remove(bullet.mesh);
      if (bullet.geometry) bullet.geometry.dispose();
      if (bullet.material) bullet.material.dispose();
    }
  },

  dispose() {
    this.pool.forEach(bullet => {
      if (bullet.mesh?.parent) bullet.mesh.parent.remove(bullet.mesh);
      if (bullet.geometry) bullet.geometry.dispose();
      if (bullet.material) bullet.material.dispose();
    });
    this.pool = [];
  },

  updateBullet(bullet, scene, tanks, terrainGrid, gridWidth, gridHeight, soundEffects, score) {
    if (!bullet?.isActive || !bullet.mesh?.parent) return { hit: false };

    bullet.lifeTime++;
    bullet.distanceTraveled += bullet.speed;

    const dir = directions[bullet.dir];
    bullet.x += dir[0] * bullet.speed;
    bullet.y += dir[1] * bullet.speed;

    bullet.mesh.position.set(
      bullet.x - gridWidth / 2 + 0.5,
      bullet.mesh.position.y,
      bullet.y - gridHeight / 2 + 0.5
    );

    if (bullet.distanceTraveled > bullet.range || bullet.x < 0 || bullet.x >= gridWidth || bullet.y < 0 || bullet.y >= gridHeight) {
      this.destroyBullet(bullet, scene);
      return { hit: true, type: 'boundary' };
    }

    const gridX = Math.floor(bullet.x);
    const gridY = Math.floor(bullet.y);

    if (gridX >= 0 && gridX < gridWidth && gridY >= 0 && gridY < gridHeight && terrainGrid?.[gridY]?.[gridX] !== 0) {
      const terrain = terrainGrid[gridY][gridX];
      if (terrain === 1 || terrain === 2) {
        if (terrain === 1 || (terrain === 2 && bullet.power >= 2)) {
          this.destroyBullet(bullet, scene);
          return { hit: true, type: 'terrain', x: gridX, y: gridY };
        }
      } else if (terrain === 4) {
        this.destroyBullet(bullet, scene);
        return { hit: true, type: 'base', x: gridX, y: gridY };
      }
    }

    for (const tank of tanks) {
      if (!tank?.mesh?.parent || tank === bullet.owner) continue;

      const dx = tank.x - bullet.x;
      const dy = tank.y - bullet.y;
      const distance = Math.sqrt(dx * dx + dy * dy);

      const hitRadius = tank.isPlayer ? 0.6 : 0.5;

      if (distance < hitRadius) {
        const hitResult = handleTankHit(tank, bullet, score, soundEffects, scene);
        this.destroyBullet(bullet, scene);
        return { hit: true, type: 'tank', tank, ...hitResult };
      }
    }

    if (bullet.lifeTime > bullet.maxLifeTime) {
      this.destroyBullet(bullet, scene);
      return { hit: true, type: 'timeout' };
    }

    return { hit: false };
  },

  destroyBullet(bullet, scene) {
    if (bullet?.mesh?.parent) {
      scene.remove(bullet.mesh);
    }
    this.release(bullet);
  }
};

const powerUpTypes = {
  H: {
    color: 0xff0000,
    name: 'Health',
    effect: player => {
      if (player.lives < 5) {
        player.lives++;
        return true;
      }
      return false;
    },
    score: 500
  },
  B: {
    color: 0x00ff00,
    name: 'Bomb',
    effect: () => true,
    score: 1000
  },
  C: {
    color: 0x0000ff,
    name: 'Clock',
    effect: () => true,
    score: 500
  },
  S: {
    color: 0xffff00,
    name: 'Shield',
    effect: player => {
      player.invincible = true;
      player.shieldTime = 600;
      if (player.shield?.mesh) {
        player.scene.remove(player.shield.mesh);
        player.shield.geometry?.dispose();
        player.shield.material?.dispose();
      }
      player.shield = createShield(player);
      return true;
    },
    score: 500
  },
  R: {
    color: 0xff00ff,
    name: 'Rapid Fire',
    effect: player => {
      clearTimeout(player.rapidFireTimeout);
      player.rapidFire = true;
      player.maxBullets = 3;
      player.bulletSpeed = 0.18;
      player.fireRate = 150;
      player.rapidFireTimeout = setTimeout(() => {
        player.rapidFire = false;
        player.maxBullets = 1;
        player.bulletSpeed = 0.12;
        player.fireRate = 300;
        player.rapidFireTimeout = null;
      }, 10000);
      return true;
    },
    score: 500
  },
  P: {
    color: 0x00ffff,
    name: 'Power',
    effect: player => {
      clearTimeout(player.powerTimeout);
      player.bulletPower = 2;
      player.powerTimeout = setTimeout(() => {
        player.bulletPower = 1;
        player.powerTimeout = null;
      }, 8000);
      return true;
    },
    score: 500
  },
  L: {
    color: 0xffffff,
    name: 'Life',
    effect: player => {
      player.lives = Math.min(5, player.lives + 1);
      return true;
    },
    score: 500
  },
  C2: {
    color: 0x6600ff,
    name: 'Cooldown',
    effect: player => {
      clearTimeout(player.cooldownTimeout);
      player.moveSpeed = Math.max(3, player.moveSpeed - 2);
      player.cooldownTimeout = setTimeout(() => {
        player.moveSpeed = 6;
        player.cooldownTimeout = null;
      }, 5000);
      return true;
    },
    score: 500
  }
};

const enemyTypes = {
  basic: {
    armor: 1,
    moveSpeed: 12,
    shootChance: 0.008,
    score: 100,
    scale: 1.0,
    color: 0x888888,
    bulletSpeed: 0.08,
    fireRate: 400
  },
  armored: {
    armor: 3,
    moveSpeed: 18,
    shootChance: 0.01,
    score: 200,
    scale: 1.0,
    color: 0x666666,
    bulletSpeed: 0.10,
    fireRate: 350
  },
  fast: {
    armor: 1,
    moveSpeed: 6,
    shootChance: 0.015,
    score: 300,
    scale: 1.0,
    color: 0xaaaaaa,
    bulletSpeed: 0.12,
    fireRate: 250
  },
  heavy: {
    armor: 5,
    moveSpeed: 20,
    shootChance: 0.007,
    score: 400,
    scale: 1.0,
    color: 0x444444,
    bulletSpeed: 0.15,
    fireRate: 500
  }
};

const powerUpUtils = {
  update(powerUp, delta) {
    if (!powerUp?.mesh?.parent) return;
    powerUp.mesh.rotation.y += powerUp.mesh.userData.rotationSpeed;
    powerUp.mesh.userData.pulse += delta * 0.05;
    powerUp.mesh.scale.setScalar(1 + Math.sin(powerUp.mesh.userData.pulse) * 0.1);
  },

  dispose(powerUp) {
    if (!powerUp?.mesh?.parent) return;
    powerUp.mesh.parent.remove(powerUp.mesh);
    if (powerUp.baseGeometry) powerUp.baseGeometry.dispose();
    if (powerUp.baseMaterial) powerUp.baseMaterial.dispose();
    if (powerUp.symbolGeometry) powerUp.symbolGeometry.dispose();
    if (powerUp.symbolMaterial) powerUp.symbolMaterial.dispose();
    if (powerUp.glowGeometry) powerUp.glowGeometry.dispose();
    if (powerUp.glowMaterial) powerUp.glowMaterial.dispose();
  }
};

const createTank = async (x, y, dir, isPlayer, isPlayer2, enemyType, scene, gridWidth, gridHeight, level = 1) => {
  const group = new THREE.Group();
  const scale = isPlayer ? 1.45 : (enemyTypes[enemyType]?.scale || 1.45);

  const baseDestroyerChance = 0.3 + (level - 1) * 0.05;
  const enemyRole = !isPlayer && Math.random() < baseDestroyerChance ? 'baseDestroyer' : 'playerHunter';

  const modelPath = isPlayer ? '/tank_1990.glb' : '/tank_1990.glb';
  let model = isPlayer ? modelCache.player : modelCache.enemy;

  if (!model) {
    try {
      const gltf = await modelCache.loader.loadAsync(modelPath);
      model = gltf.scene;
      model.traverse(child => {
        if (child.isMesh) {
          child.castShadow = true;
          child.receiveShadow = true;
          child.visible = true;
          child.material = child.material.clone();
          child.material.color.setHex(isPlayer ? (isPlayer2 ? 0x00aa00 : 0xaaaa00) : (enemyTypes[enemyType]?.color || 0x888888));
          child.material.needsUpdate = true;
        }
      });
      if (isPlayer) modelCache.player = model;
      else modelCache.enemy = model;
    } catch (error) {
      console.warn(`Failed to load ${isPlayer ? 'player' : 'enemy'} tank model (${modelPath}), using fallback:`, error);
      const geometry = isPlayer
        ? new THREE.BoxGeometry(0.8, 0.4, 1.2)
        : new THREE.BoxGeometry(0.8, 0.4, 0.8);
      const material = new THREE.MeshStandardMaterial({
        color: isPlayer ? (isPlayer2 ? 0x00aa00 : 0xaaaa00) : (enemyTypes[enemyType]?.color || 0x888888),
        metalness: 0.7,
        roughness: 0.3
      });
      model = new THREE.Mesh(geometry, material);
      model.castShadow = true;
      model.receiveShadow = true;
      model.visible = true;
      if (!isPlayer) {
        const barrelGeometry = new THREE.CylinderGeometry(0.05, 0.05, 0.6, 8);
        const barrelMaterial = new THREE.MeshStandardMaterial({ color: 0x333333 });
        const barrel = new THREE.Mesh(barrelGeometry, barrelMaterial);
        barrel.position.set(0, 0.4, 0.5);
        barrel.rotation.x = Math.PI / 2;
        model.add(barrel);
      }
    }
  }

  const tank = model.clone();
  tank.scale.set(scale, scale, scale);
  tank.position.y = 0.5;
  tank.visible = true;
  group.add(tank);

  const barrelTip = new THREE.Object3D();
  barrelTip.position.set(0, 0.3, 0.8);
  group.add(barrelTip);

  group.position.set(x - gridWidth / 2 + 0.5, 0, y - gridHeight / 2 + 0.5);
  group.rotation.y = (dir * Math.PI / 2);
  group.userData = { barrelTip, scale, gridWidth, gridHeight, type: enemyType || 'player', enemyRole };
  group.visible = true;
  scene.add(group);

  if (isPlayer) {
    group.lives = 3;
  }

  if (!group.parent) {
    console.error(`Failed to add ${isPlayer ? 'player' : 'enemy'} tank to scene at (${x}, ${y})`);
    return null;
  }

  return group;
};

const createPowerUp = async (x, y, type, scene, gridWidth, gridHeight) => {
  const group = new THREE.Group();
  const scale = 0.5;

  const modelPath = '/power_star.glb';
  let model = modelCache.powerUp;

  if (!model) {
    try {
      const gltf = await modelCache.loader.loadAsync(modelPath);
      model = gltf.scene;
      model.traverse(child => {
        if (child.isMesh) {
          child.castShadow = true;
          child.receiveShadow = true;
          child.visible = true;
          child.material = child.material.clone();
          child.material.color.setHex(powerUpTypes[type].color);
          child.material.emissive.setHex(powerUpTypes[type].color);
          child.material.emissiveIntensity = 0.3;
          child.material.needsUpdate = true;
        }
      });
      modelCache.powerUp = model;
    } catch (error) {
      console.warn(`Failed to load power-up model (${modelPath}), using fallback:`, error);
      const baseGeometry = new THREE.BoxGeometry(0.4, 0.4, 0.4);
      const baseMaterial = new THREE.MeshStandardMaterial({
        color: powerUpTypes[type].color,
        emissive: powerUpTypes[type].color,
        emissiveIntensity: 0.5,
        metalness: 0.2,
        roughness: 0.8,
        transparent: true,
        opacity: 0.9
      });
      const baseMesh = new THREE.Mesh(baseGeometry, baseMaterial);
      baseMesh.castShadow = true;
      baseMesh.receiveShadow = true;

      const symbolGeometry = new THREE.TextGeometry(powerUpTypes[type].name[0], {
        font: new THREE.Font({}),
        size: 0.3,
        height: 0.1
      });
      const symbolMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff });
      const symbolMesh = new THREE.Mesh(symbolGeometry, symbolMaterial);
      symbolMesh.position.set(0, 0.2, 0.21);
      baseMesh.add(symbolMesh);

      const glowGeometry = new THREE.SphereGeometry(0.6, 16, 16);
      const glowMaterial = new THREE.MeshBasicMaterial({
        color: powerUpTypes[type].color,
        transparent: true,
        opacity: 0.3
      });
      const glowMesh = new THREE.Mesh(glowGeometry, glowMaterial);
      baseMesh.add(glowMesh);

      model = baseMesh;
    }
  }

  const powerUpMesh = model.clone();
  powerUpMesh.scale.set(scale, scale, scale);
  powerUpMesh.position.y = 0.3;
  powerUpMesh.visible = true;
  powerUpMesh.userData = { rotationSpeed: 0.02, pulse: 0 };
  group.add(powerUpMesh);

  group.position.set(x - gridWidth / 2 + 0.5, 0, y - gridHeight / 2 + 0.5);
  group.visible = true;
  scene.add(group);

  if (!group.parent) {
    console.error(`Failed to add power-up ${type} to scene at (${x}, ${y})`);
    return null;
  }

  return {
    mesh: group,
    x,
    y,
    type,
    scene,
    baseGeometry: model.isMesh ? model.geometry : null,
    baseMaterial: model.isMesh ? model.material : null,
    symbolGeometry: model.children?.[0]?.geometry || null,
    symbolMaterial: model.children?.[0]?.material || null,
    glowGeometry: model.children?.[1]?.geometry || null,
    glowMaterial: model.children?.[1]?.material || null
  };
};

const createShield = tank => {
  if (!tank?.mesh?.parent) return null;

  const geometry = new THREE.SphereGeometry(1.2, 16, 16);
  const material = new THREE.MeshStandardMaterial({
    color: colors.shield,
    transparent: true,
    opacity: 0.3,
    metalness: 0.2,
    roughness: 0.8,
    emissive: 0x003333,
    emissiveIntensity: 0.2
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.copy(tank.mesh.position);
  mesh.position.y += 0.5;
  mesh.visible = true;
  tank.scene.add(mesh);

  return { mesh, geometry, material };
};

const createDamageIndicator = tank => {
  if (!tank?.mesh?.parent) return null;

  const geometry = new THREE.RingGeometry(0.3, 0.9, 8);
  const material = new THREE.MeshBasicMaterial({
    color: colors.damage,
    transparent: true,
    opacity: 0.8,
    side: THREE.DoubleSide
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.copy(tank.mesh.position);
  mesh.position.y += 0.1;
  mesh.rotation.x = -Math.PI / 2;
  mesh.visible = true;
  tank.scene.add(mesh);

  return { mesh, geometry, material };
};

const moveTank = (tank, dx, dy, canMove, newDir = null) => {
  if (!tank?.mesh?.parent) return false;

  if (newDir !== null && newDir !== tank.dir) {
    tank.dir = newDir;
    tank.mesh.rotation.y = (newDir * Math.PI / 2);
  }

  if (tank.moveCooldown > 0) {
    tank.moveCooldown--;
    return false;
  }

  const newX = tank.x + dx;
  const newY = tank.y + dy;

  if (canMove(newX, newY, tank)) {
    tank.lastX = tank.x;
    tank.lastY = tank.y;
    tank.x = newX;
    tank.y = newY;

    tank.mesh.position.set(
      tank.x - tank.mesh.userData.gridWidth / 2 + 0.5,
      0,
      tank.y - tank.mesh.userData.gridHeight / 2 + 0.5
    );

    tank.moveCooldown = tank.isPlayer ?
      (tank.moveSpeed || 6) :
      (enemyTypes[tank.type || 'basic']?.moveSpeed || 12);

    return true;
  }

  return false;
};

const shoot = (shooter, isPlayer, scene, gridWidth, gridHeight, soundEffects) => {
  if (!shooter?.canShoot ||
      (shooter.currentBullets || 0) >= shooter.maxBullets ||
      !shooter.mesh?.parent) {
    return null;
  }

  const dir = shooter.dir;
  const scale = shooter.mesh.userData.scale || 1.0;

  const barrelTipLocal = new THREE.Vector3(0, 0.3, 0.8);
  const barrelTipWorld = barrelTipLocal.clone();
  shooter.mesh.localToWorld(barrelTipWorld);

  const bullet = bulletPool.create(shooter.bulletPower || 1);

  bullet.x = barrelTipWorld.x + gridWidth / 2 - 0.5;
  bullet.y = barrelTipWorld.z + gridHeight / 2 - 0.5;
  bullet.dir = dir;
  bullet.player = isPlayer;
  bullet.power = shooter.bulletPower || 1;
  bullet.speed = shooter.bulletSpeed || (isPlayer ? 0.12 : enemyTypes[shooter.type || 'basic']?.bulletSpeed || 0.08);
  bullet.owner = shooter;
  bullet.lifeTime = 0;
  bullet.maxLifeTime = 300;
  bullet.distanceTraveled = 0;

  bullet.mesh.position.copy(barrelTipWorld);
  bullet.mesh.visible = true;
  scene.add(bullet.mesh);

  shooter.currentBullets = (shooter.currentBullets || 0) + 1;

  createMuzzleFlash(barrelTipWorld.x, barrelTipWorld.y, barrelTipWorld.z, dir, scene);

  if (soundEffects?.shoot) {
    soundEffects.shoot.setVolume(0.3);
    soundEffects.shoot.play();
  }

  shooter.canShoot = false;
  const fireRate = shooter.fireRate || (shooter.rapidFire ? 150 : enemyTypes[shooter.type || 'basic']?.fireRate || 300);

  shooter.shootTimeout = setTimeout(() => {
    shooter.canShoot = true;
    shooter.currentBullets = Math.max(0, shooter.currentBullets - 1);
    shooter.shootTimeout = null;
  }, fireRate);

  return bullet;
};

const applyPowerUp = (tank, type, score, soundEffects) => {
  if (!tank || !powerUpTypes[type]) return false;

  const success = powerUpTypes[type].effect(tank);
  if (success && score) {
    score.value += powerUpTypes[type].score;
  }

  if (soundEffects?.powerUp) {
    soundEffects.powerUp.play();
  }

  return success;
};

const handleTankHit = (tank, bullet, score, soundEffects, scene) => {
  if (!tank?.mesh?.parent || tank.invincible) return { destroyed: false };

  tank.armor = tank.armor ?? (tank.isPlayer ? tank.lives : enemyTypes[tank.type || 'basic'].armor);
  tank.armor -= bullet.power;

  if (tank.isPlayer) {
    tank.lives = Math.max(0, tank.armor);
    if (tank.lives <= 0) {
      tank.damageIndicator = createDamageIndicator(tank);
      return { destroyed: true };
    } else {
      tank.damageIndicator = createDamageIndicator(tank);
      soundEffects?.hit?.play();
      return { destroyed: false };
    }
  } else {
    if (tank.armor <= 0) {
      score.value += enemyTypes[tank.type].score;
      createExplosion(tank.mesh.position.x, tank.mesh.position.y + 0.5, tank.mesh.position.z, 2, scene, {}, soundEffects);
      return { destroyed: true };
    } else {
      tank.hitEffect = createHitEffect(tank.mesh.position.x, tank.mesh.position.y + 0.3, tank.mesh.position.z, scene);
      soundEffects?.hit?.play();
      return { destroyed: false };
    }
  }
};

const respawnPlayer = async (tank, scene, gridWidth, gridHeight) => {
  if (!tank || tank.lives <= 0) {
    console.log(`Player ${tank.isPlayer1 ? '1' : '2'} cannot respawn: no lives remaining`);
    return false;
  }

  if (tank.mesh?.parent) {
    disposeTank(tank);
  }

  tank.invincible = true;
  tank.shieldTime = 600;
  tank.x = tank.isPlayer1 ? 20 : 40;
  tank.y = 59;
  tank.dir = 3;
  tank.currentBullets = 0;
  tank.moveCooldown = 0;
  tank.moveSpeed = 6;
  tank.bulletPower = 1;
  tank.bulletSpeed = 0.12;
  tank.maxBullets = 1;
  tank.fireRate = 300;
  tank.rapidFire = false;
  tank.armor = tank.lives;

  clearTimeout(tank.rapidFireTimeout);
  clearTimeout(tank.powerTimeout);
  clearTimeout(tank.cooldownTimeout);
  clearTimeout(tank.shootTimeout);

  const canMove = (x, y, exclude = null) => {
    if (x < 0 || x >= gridWidth || y < 0 || y >= gridHeight) return false;
    return !scene.children.some(child => {
      if (child === exclude || !child.userData || !child.position) return false;
      const dx = Math.abs(child.position.x - (x - gridWidth / 2 + 0.5));
      const dz = Math.abs(child.position.z - (y - gridHeight / 2 + 0.5));
      return dx < 0.5 && dz < 0.5;
    });
  };

  if (!canMove(tank.x, tank.y)) {
    console.warn(`Spawn point (${tank.x}, ${tank.y}) blocked for player ${tank.isPlayer1 ? '1' : '2'}, trying nearby positions`);
    const possibleSpawns = [
      [tank.x - 1, tank.y], [tank.x + 1, tank.y], [tank.x, tank.y - 1], [tank.x, tank.y + 1]
    ];
    const validSpawn = possibleSpawns.find(([x, y]) => canMove(x, y));
    if (validSpawn) {
      [tank.x, tank.y] = validSpawn;
    } else {
      console.error(`No valid spawn point found for player ${tank.isPlayer1 ? '1' : '2'}`);
      return false;
    }
  }

  try {
    tank.mesh = await createTank(
      tank.x, tank.y, tank.dir,
      true, !tank.isPlayer1, 'basic',
      scene, gridWidth, gridHeight
    );
    if (!tank.mesh) {
      console.error(`Failed to create tank for player ${tank.isPlayer1 ? '1' : '2'} at (${tank.x}, ${tank.y})`);
      return false;
    }
  } catch (error) {
    console.error(`Failed to respawn player ${tank.isPlayer1 ? '1' : '2'}:`, error);
    return false;
  }

  tank.canShoot = true;
  tank.shield = createShield(tank);
  tank.respawnTimer = 0;

  console.log(`Player ${tank.isPlayer1 ? '1' : '2'} respawned at (${tank.x}, ${tank.y})`);
  return true;
};

const disposeTank = tank => {
  if (!tank?.mesh?.parent) return;

  if (tank.mesh.parent) {
    tank.mesh.parent.remove(tank.mesh);
  }

  tank.mesh.traverse(child => {
    if (child.isMesh) {
      if (child.geometry) child.geometry.dispose();
      if (child.material) {
        if (Array.isArray(child.material)) {
          child.material.forEach(material => material?.dispose());
        } else {
          child.material?.dispose();
        }
      }
    }
  });

  tank.mesh = null;

  if (tank.shield?.mesh?.parent) {
    tank.shield.mesh.parent.remove(tank.shield.mesh);
    if (tank.shield.geometry) tank.shield.geometry.dispose();
    if (tank.shield.material) tank.shield.material.dispose();
    tank.shield = null;
  }

  if (tank.damageIndicator?.mesh?.parent) {
    tank.damageIndicator.mesh.parent.remove(tank.damageIndicator.mesh);
    if (tank.damageIndicator.geometry) tank.damageIndicator.geometry.dispose();
    if (tank.damageIndicator.material) tank.damageIndicator.material.dispose();
    tank.damageIndicator = null;
  }

  if (tank.hitEffect?.mesh?.parent) {
    tank.hitEffect.mesh.parent.remove(tank.hitEffect.mesh);
    if (tank.hitEffect.geometry) tank.hitEffect.geometry.dispose();
    if (tank.hitEffect.material) tank.hitEffect.material.dispose();
    tank.hitEffect = null;
  }

  clearTimeout(tank.rapidFireTimeout);
  clearTimeout(tank.powerTimeout);
  clearTimeout(tank.cooldownTimeout);
  clearTimeout(tank.shootTimeout);
};

const findPathToBase = (startX, startY, gridWidth, gridHeight, canMove) => {
  const baseX = 30, baseY = 59;
  const queue = [{ x: startX, y: startY, path: [] }];
  const visited = new Set();
  visited.add(`${startX},${startY}`);

  const directions = [[0, -1], [0, 1], [-1, 0], [1, 0]]; // Up, Down, Left, Right

  while (queue.length > 0) {
    const { x, y, path } = queue.shift();
    if (x === baseX && y === baseY) return path;

    for (const [dx, dy] of directions) {
      const newX = x + dx;
      const newY = y + dy;
      const key = `${newX},${newY}`;

      if (
        newX >= 0 && newX < gridWidth &&
        newY >= 0 && newY < gridHeight &&
        canMove(newX, newY) &&
        !visited.has(key)
      ) {
        visited.add(key);
        queue.push({ x: newX, y: newY, path: [...path, [dx, dy]] });
      }
    }
  }

  return null;
};

const updateEnemyAI = (enemy, player, player2, gameState, terrainGroup, level) => {
  if (!enemy?.mesh?.parent || enemy.frozen > 0) return null;

  enemy.aiTimer++;
  if (enemy.aiTimer < enemyTypes[enemy.type].moveSpeed) return null;

  enemy.aiTimer = 0;

  const target = enemy.mesh.userData.enemyRole === 'baseDestroyer'
    ? { x: 30, y: 59 }
    : (gameState.twoPlayer && player2.mesh?.parent ? enemy.targetPlayer : player);

  if (!target?.mesh?.parent && enemy.mesh.userData.enemyRole !== 'baseDestroyer') {
    enemy.targetPlayer = player2.mesh?.parent ? player2 : player;
    target = enemy.targetPlayer;
  }

  const path = findPathToBase(enemy.x, enemy.y, enemy.gridWidth, enemy.gridHeight, enemy.canMove);
  let dx = 0, dy = 0;

  if (path && path.length > 0) {
    [dx, dy] = path[0];
  } else {
    const directions = [[0, -1], [0, 1], [-1, 0], [1, 0]];
    const validMoves = directions.filter(([dX, dY]) => enemy.canMove(enemy.x + dX, enemy.y + dY, enemy));
    if (validMoves.length > 0) {
      [dx, dy] = validMoves[Math.floor(Math.random() * validMoves.length)];
    }
  }

  if (dx !== 0 || dy !== 0) {
    const dirMap = { '0,-1': 3, '0,1': 1, '-1,0': 2, '1,0': 0 };
    const newDir = dirMap[`${dx},${dy}`];
    if (newDir !== undefined) {
      moveTank(enemy, dx, dy, enemy.canMove, newDir);
    }
  }

  if (Math.random() < enemyTypes[enemy.type].shootChance * (1 + level * 0.1)) {
    const bullet = shoot(enemy, false, enemy.scene, enemy.gridWidth, enemy.gridHeight, enemy.soundEffects);
    return bullet;
  }

  return null;
};

export {
  createTank,
  moveTank,
  shoot,
  updateEnemyAI,
  applyPowerUp,
  respawnPlayer,
  disposeTank,
  bulletPool,
  enemyTypes,
  powerUpTypes,
  createShield,
  createDamageIndicator,
  directions,
  createPowerUp,
  powerUpUtils
};