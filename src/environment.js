import * as THREE from 'three';
import { ShaderMaterial, SphereGeometry, Mesh, BackSide, BufferAttribute } from 'three';

// Perlin noise function for procedural textures
const noise = `
    vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
    vec2 mod289(vec2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
    vec3 permute(vec3 x) { return mod289(((x*34.0)+1.0)*x); }
    float snoise(vec2 v) {
        const vec4 C = vec4(0.211324865405187, 0.366025403784439, -0.577350269189626, 0.024390243902439);
        vec2 i  = floor(v + dot(v, C.yy));
        vec2 x0 = v - i + dot(i, C.xx);
        vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
        vec4 x12 = x0.xyxy + C.xxzz;
        x12.xy -= i1;
        i = mod289(i);
        vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
        vec3 m = max(0.5 - vec3(dot(x0,x0), dot(x12.xy,x12.xy), dot(x12.zw,x12.zw)), 0.0);
        m = m*m; m = m*m;
        vec3 x = 2.0 * fract(p * C.www) - 1.0;
        vec3 h = abs(x) - 0.5;
        vec3 ox = floor(x + 0.5);
        vec3 a0 = x - ox;
        m *= 1.79284291400159 - 0.85373472095314 * (a0*a0 + h*h);
        vec3 g;
        g.x  = a0.x * x0.x + h.x * x0.y;
        g.yz = a0.yz * x12.xz + h.yz * x12.yw;
        return 130.0 * dot(m, g);
    }
`;

export function createEnhancedEnvironment(scene, renderer) {
    let skyMesh, stars, clouds, moon;

    // Adjust scene fog to blend with vibrant horizon color
    scene.fog.color.set(0x2a2a4e); // Brighter blue-purple to match new horizon
    scene.fog.near = 20;
    scene.fog.far = 120;

    // Sky with vibrant gradient, aurora, and moon glow
    const skyGeometry = new SphereGeometry(500, 64, 64);
    const skyMaterial = new ShaderMaterial({
        uniforms: {
            time: { value: 0.0 },
            horizonColor: { value: new THREE.Color(0x2a2a4e) }, // Vibrant blue-purple
            zenithColor: { value: new THREE.Color(0x0a0a1a) }, // Darker at zenith
            moonGlow: { value: new THREE.Color(0x9ab8d8) }, // Brighter moonlight
            glowIntensity: { value: 0.7 }, // Increased glow
            auroraIntensity: { value: 0.2 } // Aurora effect
        },
        vertexShader: `
            varying vec3 vPosition;
            varying vec2 vUv;
            void main() {
                vPosition = position;
                vUv = uv;
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
        `,
        fragmentShader: `
            ${noise}
            uniform vec3 horizonColor;
            uniform vec3 zenithColor;
            uniform vec3 moonGlow;
            uniform float glowIntensity;
            uniform float auroraIntensity;
            uniform float time;
            varying vec3 vPosition;
            varying vec2 vUv;
            void main() {
                float t = (vPosition.y + 500.0) / 1000.0;
                vec3 color = mix(horizonColor, zenithColor, t);
                // Moon glow
                vec2 moonPos = vec2(0.7, 0.8);
                float dist = distance(vUv, moonPos);
                float glow = exp(-dist * 8.0) * glowIntensity;
                color += moonGlow * glow;
                // Aurora effect near horizon
                float aurora = auroraIntensity * (1.0 - t) * (0.5 + 0.5 * sin(time * 0.5 + vUv.x * 5.0));
                float n = snoise(vUv * 3.0 + time * 0.2);
                color += vec3(0.2, 0.4, 0.6) * aurora * (0.5 + 0.5 * n);
                gl_FragColor = vec4(color, 1.0);
            }
        `,
        side: BackSide
    });
    skyMesh = new Mesh(skyGeometry, skyMaterial);
    scene.add(skyMesh);

    // Stars with varied colors and faster twinkling
    const starGeometry = new THREE.BufferGeometry();
    const starCount = 1500; // Balanced for performance and density
    const starPositions = new Float32Array(starCount * 3);
    const starScales = new Float32Array(starCount);
    const starTwinkle = new Float32Array(starCount);
    const starColors = new Float32Array(starCount * 3);
    for (let i = 0; i < starCount; i++) {
        const theta = Math.random() * 2 * Math.PI;
        const phi = Math.acos(2 * Math.random() - 1);
        const radius = 490;
        starPositions[i * 3] = radius * Math.sin(phi) * Math.cos(theta);
        starPositions[i * 3 + 1] = radius * Math.sin(phi) * Math.sin(theta);
        starPositions[i * 3 + 2] = radius * Math.cos(phi);
        starScales[i] = 0.15 + Math.random() * 0.35; // Slightly larger stars
        starTwinkle[i] = Math.random();
        // Varied star colors
        const color = Math.random() < 0.5 ? new THREE.Color(0xffffff) : // White
                     Math.random() < 0.5 ? new THREE.Color(0xaabbff) : // Blue
                     Math.random() < 0.5 ? new THREE.Color(0xffaaaa) : // Red
                     Math.random() < 0.5 ? new THREE.Color(0xffffaa) : // Yellow
                     new THREE.Color(0xaaffff); // Cyan
        starColors[i * 3] = color.r;
        starColors[i * 3 + 1] = color.g;
        starColors[i * 3 + 2] = color.b;
    }
    starGeometry.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
    starGeometry.setAttribute('scale', new THREE.BufferAttribute(starScales, 1));
    starGeometry.setAttribute('twinkle', new THREE.BufferAttribute(starTwinkle, 1));
    starGeometry.setAttribute('color', new THREE.BufferAttribute(starColors, 3));
    const starMaterial = new ShaderMaterial({
        uniforms: {
            time: { value: 0.0 }
        },
        vertexShader: `
            attribute float scale;
            attribute float twinkle;
            attribute vec3 color;
            varying float vTwinkle;
            varying vec3 vColor;
            void main() {
                vTwinkle = twinkle;
                vColor = color;
                vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
                gl_PointSize = scale * (300.0 / -mvPosition.z);
                gl_Position = projectionMatrix * mvPosition;
            }
        `,
        fragmentShader: `
            uniform float time;
            varying float vTwinkle;
            varying vec3 vColor;
            void main() {
                float brightness = 0.6 + 0.4 * sin(time * 2.0 + vTwinkle * 6.28); // Faster twinkling
                gl_FragColor = vec4(vColor * brightness, 1.0);
            }
        `,
        transparent: true
    });
    stars = new THREE.Points(starGeometry, starMaterial);
    scene.add(stars);

    // Procedural clouds with layered noise and pulsation
    const cloudGeometry = new SphereGeometry(495, 32, 32);
    const cloudMaterial = new ShaderMaterial({
        uniforms: {
            time: { value: 0.0 },
            cloudOpacity: { value: 0.3 }, // Increased opacity
            cloudColor: { value: new THREE.Color(0xaab8d8) } // Tinted with moonlight
        },
        vertexShader: `
            varying vec2 vUv;
            void main() {
                vUv = uv;
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
        `,
        fragmentShader: `
            ${noise}
            uniform float time;
            uniform float cloudOpacity;
            uniform vec3 cloudColor;
            varying vec2 vUv;
            void main() {
                vec2 uv = vUv;
                uv.x += time * 0.015; // Faster drift
                float n1 = snoise(uv * 5.0 + time * 0.1);
                float n2 = snoise(uv * 10.0 + time * 0.05);
                float n = 0.5 * n1 + 0.5 * n2; // Balanced layers
                float alpha = smoothstep(0.3, 0.8, n) * cloudOpacity * (0.8 + 0.2 * sin(time * 0.5 + uv.y * 5.0));
                vec3 color = cloudColor * (0.9 + 0.1 * n2); // Subtle color variation
                gl_FragColor = vec4(color, alpha);
            }
        `,
        transparent: true,
        side: BackSide
    });
    clouds = new Mesh(cloudGeometry, cloudMaterial);
    scene.add(clouds);

    // Procedural moon with enhanced detail
    const moonGeometry = new SphereGeometry(20, 64, 64);
    const moonMaterial = new ShaderMaterial({
        uniforms: {
            time: { value: 0.0 },
            moonColor: { value: new THREE.Color(0x9ab8d8) }, // Brighter moon
            emissiveIntensity: { value: 0.5 } // Stronger glow
        },
        vertexShader: `
            varying vec2 vUv;
            varying vec3 vNormal;
            void main() {
                vUv = uv;
                vNormal = normalize(normalMatrix * normal);
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
        `,
        fragmentShader: `
            ${noise}
            uniform vec3 moonColor;
            uniform float time;
            uniform float emissiveIntensity;
            varying vec2 vUv;
            varying vec3 vNormal;
            void main() {
                vec2 uv = vUv;
                float n1 = snoise(uv * 15.0); // Finer craters
                float n2 = snoise(uv * 2.0); // Mare
                float craters = smoothstep(0.4, 0.7, n1);
                float mare = smoothstep(0.2, 0.8, n2);
                vec3 color = moonColor * (0.5 + 0.3 * craters + 0.2 * mare);
                vec3 emissive = moonColor * emissiveIntensity * (0.6 + 0.4 * craters);
                float light = max(dot(vNormal, normalize(vec3(1.0, 0.5, 1.0))), 0.0);
                color *= (0.3 + 0.7 * light); // Enhanced lighting
                gl_FragColor = vec4(color + emissive, 1.0);
            }
        `
    });
    moon = new Mesh(moonGeometry, moonMaterial);
    moon.position.set(300, 200, 300);
    scene.add(moon);

    // Enhanced moonlight
    const moonLight = new THREE.PointLight(0x9ab8d8, 1.0, 1000); // Brighter light
    moonLight.position.copy(moon.position);
    scene.add(moonLight);

    // Subtle ambient light for overall scene brightness
    const ambientLight = new THREE.AmbientLight(0x2a2a4e, 0.3); // Matches horizon
    scene.add(ambientLight);

    // Update function for animations
    function updateEnvironment(now, camera) {
        const time = now * 0.001;
        skyMaterial.uniforms.time.value = time;
        starMaterial.uniforms.time.value = time;
        cloudMaterial.uniforms.time.value = time;
        moonMaterial.uniforms.time.value = time;
        moon.position.x = 300 * Math.cos(time * 0.05);
        moon.position.z = 300 * Math.sin(time * 0.05);
        moonLight.position.copy(moon.position);
        skyMesh.position.copy(camera.position);
        stars.position.copy(camera.position);
        clouds.position.copy(camera.position);
    }

    return {
        updateEnvironment
    };
}