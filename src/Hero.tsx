import React, { useEffect, useRef } from "react";
import * as THREE from "three";

// Shaders
const vertexShader = `
varying vec2 vUv;

void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const fluidFragmentShader = `
uniform sampler2D uPrevTrails;
uniform vec2 uMouse;
uniform vec2 uPrevMouse;
uniform vec2 uResolution;
uniform float uDecay;
uniform bool uIsMoving;

varying vec2 vUv;

void main() {
  vec4 prevState = texture2D(uPrevTrails, vUv);
  float newValue = prevState.r * uDecay;
  
  if (uIsMoving) {
    vec2 mouseDirection = uMouse - uPrevMouse;
    float lineLength = length(mouseDirection);
    
    if (lineLength > 0.001) {
      vec2 mouseDir = mouseDirection / lineLength;
      vec2 toPixel = vUv - uPrevMouse;
      float projAlong = dot(toPixel, mouseDir);
      projAlong = clamp(projAlong, 0.0, lineLength);
      
      vec2 closestPoint = uPrevMouse + projAlong * mouseDir;
      float dist = length(vUv - closestPoint);
      
      float lineWidth = 0.09;
      float intensity = smoothstep(lineWidth, 0.0, dist) * 0.3;
      newValue += intensity;
    }
  }
  
  gl_FragColor = vec4(newValue, 0.0, 0.0, 1.0);
}
`;

const displayFragmentShader = `
uniform sampler2D uFluid;
uniform sampler2D uTopTexture;
uniform sampler2D uBottomTexture;
uniform vec2 uResolution;
uniform float uDpr;
uniform vec2 uTopTextureSize;
uniform vec2 uBottomTextureSize;

varying vec2 vUv;

vec2 getCoverUV(vec2 uv, vec2 textureSize) {
  if (textureSize.x < 1.0 || textureSize.y < 1.0) return uv;
  
  vec2 s = uResolution / textureSize;
  float scale = max(s.x, s.y);
  vec2 scaledSize = textureSize * scale;
  vec2 offset = (uResolution - scaledSize) * 0.5;
  
  return (uv * scaledSize + offset) / uResolution;
}

void main() {
  float fluid = texture2D(uFluid, vUv).r;
  
  vec2 topUV = getCoverUV(vUv, uTopTextureSize);
  vec2 bottomUV = getCoverUV(vUv, uBottomTextureSize);
  
  vec4 topColor = texture2D(uTopTexture, topUV);
  vec4 bottomColor = texture2D(uBottomTexture, bottomUV);
  
  float threshold = 0.02;
  float edgeWidth = 0.004 / uDpr;
  float t = smoothstep(threshold, threshold + edgeWidth, fluid);
  
  vec4 finalColor = mix(topColor, bottomColor, t);
  gl_FragColor = finalColor;
}
`;

const FluidCursorTrail: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!canvasRef.current) return;

    const canvas = canvasRef.current;
    const renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      precision: "highp",
    });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    // Mouse state
    const mouse = new THREE.Vector2(0.5, 0.5);
    const prevMouse = new THREE.Vector2(0.5, 0.5);
    let isMoving = false;
    let lastMoveTime = 0;
    let isInsideCanvas = false;

    // Simulation setup
    const simSize = 512;
    const renderTargetA = new THREE.WebGLRenderTarget(simSize, simSize, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
    });
    const renderTargetB = new THREE.WebGLRenderTarget(simSize, simSize, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
    });
    let currentTarget = 0;

    // Create placeholder textures
    const createPlaceholderTexture = (color: string) => {
      const tempCanvas = document.createElement("canvas");
      tempCanvas.width = 256;
      tempCanvas.height = 256;
      const ctx = tempCanvas.getContext("2d")!;
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, 256, 256);
      const texture = new THREE.CanvasTexture(tempCanvas);
      texture.minFilter = THREE.LinearFilter;
      texture.magFilter = THREE.LinearFilter;
      return texture;
    };

    // Initialize with placeholder textures
    let topTexture = createPlaceholderTexture("#f5f5f5");
    let bottomTexture = createPlaceholderTexture("#1a1a1a");
    const topTextureSize = new THREE.Vector2(256, 256);
    const bottomTextureSize = new THREE.Vector2(256, 256);

    // Trail material
    const trailMaterial = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader: fluidFragmentShader,
      uniforms: {
        uPrevTrails: { value: renderTargetA.texture },
        uMouse: { value: mouse },
        uPrevMouse: { value: prevMouse },
        uResolution: { value: new THREE.Vector2(simSize, simSize) },
        uDecay: { value: 0.91 },
        uIsMoving: { value: false },
      },
    });

    // Display material
    const displayMaterial = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader: displayFragmentShader,
      uniforms: {
        uFluid: { value: renderTargetA.texture },
        uTopTexture: { value: topTexture },
        uBottomTexture: { value: bottomTexture },
        uResolution: { value: new THREE.Vector2(window.innerWidth, window.innerHeight) },
        uDpr: { value: renderer.getPixelRatio() },
        uTopTextureSize: { value: topTextureSize },
        uBottomTextureSize: { value: bottomTextureSize },
      },
    });

    // Load image function
    const loadImage = (url: string, isTop: boolean) => {
      const loader = new THREE.TextureLoader();
      loader.load(
        url,
        (texture) => {
          const img = texture.image;
          const width = img.width;
          const height = img.height;

          console.log(`Loaded ${isTop ? "top" : "bottom"} image: ${width}x${height}`);

          // Update texture size
          if (isTop) {
            topTextureSize.set(width, height);
            displayMaterial.uniforms.uTopTextureSize.value.set(width, height);
          } else {
            bottomTextureSize.set(width, height);
            displayMaterial.uniforms.uBottomTextureSize.value.set(width, height);
          }

          // Set texture properties
          texture.minFilter = THREE.LinearFilter;
          texture.magFilter = THREE.LinearFilter;

          // Update material uniform
          if (isTop) {
            displayMaterial.uniforms.uTopTexture.value = texture;
            topTexture = texture;
          } else {
            displayMaterial.uniforms.uBottomTexture.value = texture;
            bottomTexture = texture;
          }

          displayMaterial.needsUpdate = true;
        },
        undefined,
        (error) => {
          console.error(`Error loading ${isTop ? "top" : "bottom"} image:`, error);
        }
      );
    };

    // Load both images - replace these URLs with your actual image paths
    // Top image: visible by default (lighter background)
    loadImage("/s4.png", true);

    // Bottom image: revealed by cursor trail (darker background)
    loadImage("/s3.png", false);

    // Geometry
    const geometry = new THREE.PlaneGeometry(2, 2);
    const displayMesh = new THREE.Mesh(geometry, displayMaterial);
    scene.add(displayMesh);

    const simScene = new THREE.Scene();
    const simMesh = new THREE.Mesh(geometry, trailMaterial);
    simScene.add(simMesh);

    // Clear render targets
    renderer.setRenderTarget(renderTargetA);
    renderer.clear();
    renderer.setRenderTarget(renderTargetB);
    renderer.clear();
    renderer.setRenderTarget(null);

    // Mouse handlers
    const handleMouseMove = (e: MouseEvent) => {
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX;
      const y = e.clientY;

      if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
        isInsideCanvas = true;
        prevMouse.copy(mouse);
        mouse.x = (x - rect.left) / rect.width;
        mouse.y = 1 - (y - rect.top) / rect.height;
        isMoving = true;
        lastMoveTime = Date.now();
      } else {
        isInsideCanvas = false;
        isMoving = false;
      }
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (!canvas || e.touches.length === 0) return;
      e.preventDefault();
      const touch = e.touches[0];
      const rect = canvas.getBoundingClientRect();
      const x = touch.clientX;
      const y = touch.clientY;

      if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
        isInsideCanvas = true;
        prevMouse.copy(mouse);
        mouse.x = (x - rect.left) / rect.width;
        mouse.y = 1 - (y - rect.top) / rect.height;
        isMoving = true;
        lastMoveTime = Date.now();
      } else {
        isInsideCanvas = false;
        isMoving = false;
      }
    };

    const handleResize = () => {
      renderer.setSize(window.innerWidth, window.innerHeight);
      displayMaterial.uniforms.uResolution.value.set(window.innerWidth, window.innerHeight);
      displayMaterial.uniforms.uDpr.value = renderer.getPixelRatio();
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("touchmove", handleTouchMove, { passive: false });
    window.addEventListener("resize", handleResize);

    // Animation loop
    const animate = () => {
      requestAnimationFrame(animate);

      if (Date.now() - lastMoveTime > 50) {
        isMoving = false;
      }

      // Ping-pong rendering
      const readTarget = currentTarget === 0 ? renderTargetA : renderTargetB;
      const writeTarget = currentTarget === 0 ? renderTargetB : renderTargetA;
      currentTarget = 1 - currentTarget;

      // Update trail
      trailMaterial.uniforms.uPrevTrails.value = readTarget.texture;
      trailMaterial.uniforms.uMouse.value.copy(mouse);
      trailMaterial.uniforms.uPrevMouse.value.copy(prevMouse);
      trailMaterial.uniforms.uIsMoving.value = isMoving;

      renderer.setRenderTarget(writeTarget);
      renderer.render(simScene, camera);

      // Update display
      displayMaterial.uniforms.uFluid.value = writeTarget.texture;

      renderer.setRenderTarget(null);
      renderer.render(scene, camera);
    };

    animate();

    // Cleanup
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("touchmove", handleTouchMove);
      window.removeEventListener("resize", handleResize);
      renderer.dispose();
      geometry.dispose();
      trailMaterial.dispose();
      displayMaterial.dispose();
      renderTargetA.dispose();
      renderTargetB.dispose();
      topTexture.dispose();
      bottomTexture.dispose();
    };
  }, []);

  return (
    <div ref={containerRef} className="relative w-full h-screen bg-black overflow-hidden">
      {/* Nav */}
      <nav className="fixed top-0 left-0 right-0 z-10 flex items-start justify-between p-6">
        <div className="font-bold text-white text-2xl uppercase tracking-tight">
          <a href="#" className="no-underline">
            FLUID
          </a>
        </div>
        <div className="px-4 py-2 bg-white text-black font-bold uppercase text-sm rounded">MENU</div>
      </nav>

      {/* Canvas */}
      <canvas ref={canvasRef} className="absolute inset-0 z-0" />

      {/* Footer */}
      <div className="absolute bottom-0 left-0 right-0 z-10 flex items-end justify-between p-6 text-white text-xs uppercase font-bold">
        <p>Move your cursor to reveal</p>
        <p>Interactive demo</p>
      </div>
    </div>
  );
};

export default FluidCursorTrail;
