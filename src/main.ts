import { initWebGPU, loadShaderFromFile } from './utils/webgpu';
import { Renderer } from './Renderer';
import { Cloth } from './Cloth';
import { SimpleCloth } from './SimpleCloth';
import { Ground } from './Ground';
import { Camera } from './Camera';
import { vec3 } from 'gl-matrix';

// Global state
let device: GPUDevice;
let renderer: Renderer;
let cloth: Cloth | SimpleCloth;
let camera: Camera;
let canvas: HTMLCanvasElement;
let isRunning: boolean = false;
let leftMouseDown: boolean = false;
let rightMouseDown: boolean = false;
let mouseX: number = 0;
let mouseY: number = 0;

// Mode state
type ClothMode = 'physics' | 'simple';
let currentMode: ClothMode = 'physics';

// UI callbacks
let translateFixedFn: ((axis: number, shift: number) => void) | null = null;
let rotateFixedFn: ((axis: number, shift: number) => void) | null = null;
let resetCameraFn: (() => void) | null = null;

function createCloth(numParticles: number): Cloth {
    const ground = new Ground([-5.0, 0.0, -5.0], 10.0, device);
    return new Cloth(
        4.0, // size
        100.0, // mass
        numParticles, // N particles
        [-2.0, 3.8, 0.0], // top left position
        [1.0, 0.0, 0.0], // horizontal direction
        [0.0, -1.0, 0.0], // vertical direction
        device,
        ground
    );
}

function createSimpleCloth(numTriangles: number): SimpleCloth {
    const ground = new Ground([-5.0, 0.0, -5.0], 10.0, device);
    return new SimpleCloth(
        4.0, // size
        numTriangles, // target number of triangles
        [-2.0, 3.8, 0.0], // top left position
        [1.0, 0.0, 0.0], // horizontal direction
        [0.0, -1.0, 0.0], // vertical direction
        device,
        ground
    );
}

function recreateCloth(numParticles: number): void {
    if (cloth) {
        cloth.destroy();
    }
    cloth = createCloth(numParticles);
    // Update triangle count display
    const triangleCount = 2 * (numParticles - 1) * (numParticles - 1);
    if (window.updateTriangleCount) {
        window.updateTriangleCount(triangleCount);
    }
}

function recreateSimpleCloth(numTriangles: number): void {
    if (cloth instanceof SimpleCloth) {
        // Use setNumTriangles if it's already a SimpleCloth (more efficient)
        cloth.setNumTriangles(numTriangles);
        const actualTriangleCount = cloth.getNumTriangles();
        if (window.updateTriangleCount) {
            window.updateTriangleCount(actualTriangleCount);
        }
    } else {
        // Need to recreate if it's a different type
        if (cloth) {
            cloth.destroy();
        }
        cloth = createSimpleCloth(numTriangles);
        if (cloth instanceof SimpleCloth) {
            const actualTriangleCount = cloth.getNumTriangles();
            if (window.updateTriangleCount) {
                window.updateTriangleCount(actualTriangleCount);
            }
        }
    }
}

function switchMode(mode: ClothMode): void {
    if (currentMode === mode) return;
    
    currentMode = mode;
    
    if (cloth) {
        cloth.destroy();
    }
    
    if (mode === 'physics') {
        cloth = createCloth(25);
        const triangleCount = 2 * (25 - 1) * (25 - 1);
        if (window.updateTriangleCount) {
            window.updateTriangleCount(triangleCount);
        }
        // Update UI input value
        const numParticlesInput = document.getElementById('numParticles') as HTMLInputElement;
        if (numParticlesInput) numParticlesInput.value = '25';
        // Disable wireframe mode when switching to physics
        if (renderer) {
            renderer.setWireframeMode(false);
        }
        const wireframeToggle = document.getElementById('wireframeToggle') as HTMLInputElement;
        if (wireframeToggle) wireframeToggle.checked = false;
    } else {
        cloth = createSimpleCloth(1000);
        if (cloth instanceof SimpleCloth) {
            const actualTriangleCount = cloth.getNumTriangles();
            if (window.updateTriangleCount) {
                window.updateTriangleCount(actualTriangleCount);
            }
        }
        // Enable wireframe mode by default when switching to simple mode
        if (renderer) {
            renderer.setWireframeMode(true);
        }
        const wireframeToggle = document.getElementById('wireframeToggle') as HTMLInputElement;
        if (wireframeToggle) wireframeToggle.checked = true;
    }
    
    // Update UI visibility
    updateUIVisibility();
}

function updateUIVisibility(): void {
    const physicsControls = document.getElementById('cloth-coeffs');
    const springDamperControls = document.getElementById('spring-damper');
    const aerodynamicsControls = document.getElementById('aerodynamics');
    const simpleControls = document.getElementById('simple-cloth-controls');
    const numParticlesInput = document.getElementById('numParticles')?.parentElement;
    
    if (currentMode === 'physics') {
        if (physicsControls) physicsControls.style.display = 'block';
        if (numParticlesInput) numParticlesInput.style.display = 'block';
        if (springDamperControls) springDamperControls.style.display = 'block';
        if (aerodynamicsControls) aerodynamicsControls.style.display = 'block';
        if (simpleControls) simpleControls.style.display = 'none';
    } else {
        // Simple mode - hide particle count but show other physics controls
        if (physicsControls) physicsControls.style.display = 'block';
        if (numParticlesInput) numParticlesInput.style.display = 'none';
        if (springDamperControls) springDamperControls.style.display = 'block';
        if (aerodynamicsControls) aerodynamicsControls.style.display = 'block';
        if (simpleControls) simpleControls.style.display = 'block';
    }
}

async function init(): Promise<void> {
    canvas = document.getElementById('canvas') as HTMLCanvasElement;
    if (!canvas) {
        throw new Error('Canvas not found');
    }

    // Set canvas size
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    // Initialize WebGPU
    const webgpu = await initWebGPU(canvas);
    device = webgpu.device;

    // Load shaders
    const vertexShaderResponse = await fetch('/src/shaders/cloth.vert.wgsl');
    const vertexShaderCode = await vertexShaderResponse.text();
    const fragmentShaderResponse = await fetch('/src/shaders/cloth.frag.wgsl');
    const fragmentShaderCode = await fragmentShaderResponse.text();

    // Create renderer
    renderer = new Renderer(
        device,
        webgpu.context,
        webgpu.format,
        webgpu.depthTexture,
        webgpu.depthTextureView,
        canvas
    );
    await renderer.initialize(vertexShaderCode, fragmentShaderCode);

    // Create camera
    camera = new Camera();
    camera.setAspect(canvas.width / canvas.height);
    camera.update();

    // Create cloth
    cloth = createCloth(25);
    
    // Initialize triangle count display
    const triangleCount = 2 * (25 - 1) * (25 - 1);
    if (window.updateTriangleCount) {
        window.updateTriangleCount(triangleCount);
    }

    // Setup UI callbacks
    setupUICallbacks();
    setupUIControls();

    // Setup event listeners
    setupEventListeners();

    // Ensure buffers are ready before starting render loop
    // Wait one frame to ensure all WebGPU operations are complete
    await new Promise(resolve => requestAnimationFrame(resolve));

    // Start render loop
    isRunning = true;
    requestAnimationFrame(renderLoop);
}

function setupUICallbacks(): void {
    translateFixedFn = (axis: number, shift: number) => {
        if (cloth instanceof Cloth) {
            cloth.translateFixedParticles(axis, shift);
        } else if (cloth instanceof SimpleCloth) {
            cloth.translateFixedParticles(axis, shift);
        }
    };

    rotateFixedFn = (axis: number, shift: number) => {
        if (cloth instanceof Cloth) {
            cloth.rotateFixedParticles(axis, shift);
        } else if (cloth instanceof SimpleCloth) {
            cloth.rotateFixedParticles(axis, shift);
        }
    };

    resetCameraFn = () => {
        camera.reset();
        camera.setAspect(canvas.width / canvas.height);
        camera.update();
    };

    if (window.setupUICallbacks) {
        window.setupUICallbacks({
            translateFixed: translateFixedFn,
            rotateFixed: rotateFixedFn,
            resetCamera: resetCameraFn,
        });
    }
}

function updateLighting(): void {
    const light1R = parseFloat((document.getElementById('light1R') as HTMLInputElement)?.value || '0.5');
    const light1G = parseFloat((document.getElementById('light1G') as HTMLInputElement)?.value || '0.5');
    const light1B = parseFloat((document.getElementById('light1B') as HTMLInputElement)?.value || '0.0');
    const light1X = parseFloat((document.getElementById('light1X') as HTMLInputElement)?.value || '1');
    const light1Y = parseFloat((document.getElementById('light1Y') as HTMLInputElement)?.value || '5');
    const light1Z = parseFloat((document.getElementById('light1Z') as HTMLInputElement)?.value || '2');
    
    const light2R = parseFloat((document.getElementById('light2R') as HTMLInputElement)?.value || '0.5');
    const light2G = parseFloat((document.getElementById('light2G') as HTMLInputElement)?.value || '0.0');
    const light2B = parseFloat((document.getElementById('light2B') as HTMLInputElement)?.value || '0.0');
    const light2X = parseFloat((document.getElementById('light2X') as HTMLInputElement)?.value || '-1');
    const light2Y = parseFloat((document.getElementById('light2Y') as HTMLInputElement)?.value || '-5');
    const light2Z = parseFloat((document.getElementById('light2Z') as HTMLInputElement)?.value || '-2');
    
    renderer.setLight1Color(light1R, light1G, light1B);
    renderer.setLight1Position(light1X, light1Y, light1Z);
    renderer.setLight2Color(light2R, light2G, light2B);
    renderer.setLight2Position(light2X, light2Y, light2Z);
}

function toggleWireframe(): void {
    const wireframeToggle = document.getElementById('wireframeToggle') as HTMLInputElement;
    if (wireframeToggle && renderer) {
        renderer.setWireframeMode(wireframeToggle.checked);
    }
}

// Export to window
if (typeof window !== 'undefined') {
    (window as any).toggleWireframe = toggleWireframe;
}

function updateColors(): void {
    const clothR = parseFloat((document.getElementById('clothR') as HTMLInputElement)?.value || '0.9');
    const clothG = parseFloat((document.getElementById('clothG') as HTMLInputElement)?.value || '0.01');
    const clothB = parseFloat((document.getElementById('clothB') as HTMLInputElement)?.value || '0.01');
    
    const groundR = parseFloat((document.getElementById('groundR') as HTMLInputElement)?.value || '0.3');
    const groundG = parseFloat((document.getElementById('groundG') as HTMLInputElement)?.value || '0.3');
    const groundB = parseFloat((document.getElementById('groundB') as HTMLInputElement)?.value || '0.35');
    
    renderer.setClothColor(clothR, clothG, clothB);
    renderer.setGroundColor(groundR, groundG, groundB);
}

function setupUIControls(): void {
    // Setup wireframe toggle
    const wireframeToggle = document.getElementById('wireframeToggle') as HTMLInputElement;
    if (wireframeToggle) {
        wireframeToggle.addEventListener('change', () => {
            if (renderer) {
                renderer.setWireframeMode(wireframeToggle.checked);
            }
        });
    }
    
    if (window.setupUIControls) {
        window.setupUIControls(
            (id: string, value: number) => {
                switch (id) {
                    case 'numParticles':
                        if (currentMode === 'physics') {
                            const numParticles = Math.max(5, Math.min(39, Math.round(value)));
                            recreateCloth(numParticles);
                        }
                        break;
                    case 'numTriangles':
                        if (currentMode === 'simple') {
                            const numTriangles = Math.max(2, Math.min(10000, Math.round(value)));
                            recreateSimpleCloth(numTriangles);
                        }
                        break;
                    case 'mass':
                        if (cloth instanceof Cloth) {
                            cloth.setMass(value);
                        } else if (cloth instanceof SimpleCloth) {
                            cloth.setMass(value);
                        }
                        break;
                    case 'gravity':
                        if (cloth instanceof Cloth) {
                            cloth.setGravityAcce(value);
                        } else if (cloth instanceof SimpleCloth) {
                            cloth.setGravityAcce(value);
                        }
                        break;
                    case 'ground':
                        if (cloth instanceof Cloth) {
                            cloth.setGroundPos(value);
                        } else if (cloth instanceof SimpleCloth) {
                            cloth.setGroundPos(value);
                        }
                        break;
                    case 'springConst':
                        if (cloth instanceof Cloth) {
                            cloth.setSpringConst(value);
                        } else if (cloth instanceof SimpleCloth) {
                            cloth.setSpringConst(value);
                        }
                        break;
                    case 'dampingConst':
                        if (cloth instanceof Cloth) {
                            cloth.setDampingConst(value);
                        } else if (cloth instanceof SimpleCloth) {
                            cloth.setDampingConst(value);
                        }
                        break;
                    case 'windX':
                    case 'windY':
                    case 'windZ': {
                        if (cloth instanceof Cloth) {
                            const wind = cloth.getWindVelocity();
                            if (id === 'windX') wind[0] = value;
                            else if (id === 'windY') wind[1] = value;
                            else if (id === 'windZ') wind[2] = value;
                            cloth.setWindVelocity(wind);
                        } else if (cloth instanceof SimpleCloth) {
                            const wind = cloth.getWindVelocity();
                            if (id === 'windX') wind[0] = value;
                            else if (id === 'windY') wind[1] = value;
                            else if (id === 'windZ') wind[2] = value;
                            cloth.setWindVelocity(wind);
                        }
                        break;
                    }
                    case 'fluidDensity':
                        if (cloth instanceof Cloth) {
                            cloth.setFluidDensity(value);
                        } else if (cloth instanceof SimpleCloth) {
                            cloth.setFluidDensity(value);
                        }
                        break;
                    case 'dragConst':
                        if (cloth instanceof Cloth) {
                            cloth.setDragConst(value);
                        } else if (cloth instanceof SimpleCloth) {
                            cloth.setDragConst(value);
                        }
                        break;
                }
            },
            updateLighting,
            updateColors,
            switchMode
        );
    }
    
    // Initialize lighting and colors from UI defaults
    updateLighting();
    updateColors();
    updateUIVisibility();
}

function setupEventListeners(): void {
    // Keyboard
    window.addEventListener('keydown', (e) => {
        switch (e.key) {
            case 'Escape':
                isRunning = false;
                break;
            case 'r':
            case 'R':
                resetCameraFn?.();
                break;
            case 'z':
            case 'Z':
                camera.setDistance(Math.max(camera.getDistance() - 1.0, 1.0));
                camera.update();
                break;
            case 'x':
            case 'X':
                camera.setDistance(camera.getDistance() + 1.0);
                camera.update();
                break;
        }
    });

    // Mouse
    canvas.addEventListener('mousedown', (e) => {
        if (e.button === 0) leftMouseDown = true;
        if (e.button === 2) rightMouseDown = true;
    });

    canvas.addEventListener('mouseup', (e) => {
        if (e.button === 0) leftMouseDown = false;
        if (e.button === 2) rightMouseDown = false;
    });

    canvas.addEventListener('mousemove', (e) => {
        const maxDelta = 100;
        const dx = Math.max(-maxDelta, Math.min(maxDelta, e.clientX - mouseX));
        const dy = Math.max(-maxDelta, Math.min(maxDelta, -(e.clientY - mouseY)));

        mouseX = e.clientX;
        mouseY = e.clientY;

        if (leftMouseDown) {
            const rate = 1.0;
            camera.setAzimuth(camera.getAzimuth() + dx * rate);
            camera.setIncline(Math.max(-90, Math.min(90, camera.getIncline() - dy * rate)));
            camera.update();
        }

        if (rightMouseDown) {
            const rate = 0.005;
            const dist = Math.max(0.01, Math.min(1000, camera.getDistance() * (1.0 - dx * rate)));
            camera.setDistance(dist);
            camera.update();
        }
    });

    canvas.addEventListener('contextmenu', (e) => {
        e.preventDefault();
    });

    // Resize
    window.addEventListener('resize', () => {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
        camera.setAspect(canvas.width / canvas.height);
        camera.update();
        renderer.resize(canvas.width, canvas.height);
    });
}

function renderLoop(): void {
    if (!isRunning) return;

    try {
        // Check if buffers are initialized
        if (!cloth.getPositionBuffer() || !cloth.getNormalBuffer() || !cloth.getIndexBuffer()) {
            console.warn('Buffers not ready, skipping frame');
            requestAnimationFrame(renderLoop);
            return;
        }

        // Update (both modes have physics now)
        cloth.update();
        
        // Update FPS
        if (window.updateFPS) {
            if (cloth instanceof Cloth) {
                window.updateFPS(cloth.getFPS());
            } else if (cloth instanceof SimpleCloth) {
                window.updateFPS(cloth.getFPS());
            }
        }

        // Render
        renderer.render(cloth, camera);
    } catch (error) {
        console.error('Error in render loop:', error);
        // Continue render loop even if there's an error
    }

    requestAnimationFrame(renderLoop);
}

// Start application
init().catch((error) => {
    console.error('Failed to initialize:', error);
    document.body.innerHTML = `<div style="color: red; padding: 20px;">
        <h1>WebGPU Initialization Failed</h1>
        <p>${error.message}</p>
        <p>Make sure you're using a browser that supports WebGPU (Chrome 113+, Edge 113+, or Safari 18+).</p>
    </div>`;
});

