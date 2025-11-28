import { initWebGPU, loadShaderFromFile } from './utils/webgpu';
import { Renderer } from './Renderer';
import { Cloth } from './Cloth';
import { Ground } from './Ground';
import { Camera } from './Camera';
import { vec3 } from 'gl-matrix';

// Global state
let device: GPUDevice;
let renderer: Renderer;
let cloth: Cloth;
let camera: Camera;
let canvas: HTMLCanvasElement;
let isRunning: boolean = false;
let leftMouseDown: boolean = false;
let rightMouseDown: boolean = false;
let mouseX: number = 0;
let mouseY: number = 0;

// UI callbacks
let translateFixedFn: ((axis: number, shift: number) => void) | null = null;
let rotateFixedFn: ((axis: number, shift: number) => void) | null = null;
let resetCameraFn: (() => void) | null = null;

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

    // Create ground
    const ground = new Ground([-5.0, 0.0, -5.0], 10.0, device);

    // Create cloth
    cloth = new Cloth(
        4.0, // size
        100.0, // mass
        25, // N particles
        [-2.0, 3.0, 0.0], // top left position
        [1.0, 0.0, 0.0], // horizontal direction
        [0.0, -1.0, 0.0], // vertical direction
        device,
        ground
    );

    // Setup UI callbacks
    setupUICallbacks();
    setupUIControls();

    // Setup event listeners
    setupEventListeners();

    // Start render loop
    isRunning = true;
    requestAnimationFrame(renderLoop);
}

function setupUICallbacks(): void {
    translateFixedFn = (axis: number, shift: number) => {
        cloth.translateFixedParticles(axis, shift);
    };

    rotateFixedFn = (axis: number, shift: number) => {
        cloth.rotateFixedParticles(axis, shift);
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
    if (window.setupUIControls) {
        window.setupUIControls(
            (id: string, value: number) => {
                switch (id) {
                    case 'mass':
                        cloth.setMass(value);
                        break;
                    case 'gravity':
                        cloth.setGravityAcce(value);
                        break;
                    case 'ground':
                        cloth.setGroundPos(value);
                        break;
                    case 'springConst':
                        cloth.setSpringConst(value);
                        break;
                    case 'dampingConst':
                        cloth.setDampingConst(value);
                        break;
                    case 'windX':
                    case 'windY':
                    case 'windZ': {
                        const wind = cloth.getWindVelocity();
                        if (id === 'windX') wind[0] = value;
                        else if (id === 'windY') wind[1] = value;
                        else if (id === 'windZ') wind[2] = value;
                        cloth.setWindVelocity(wind);
                        break;
                    }
                    case 'fluidDensity':
                        cloth.setFluidDensity(value);
                        break;
                    case 'dragConst':
                        cloth.setDragConst(value);
                        break;
                }
            },
            updateLighting,
            updateColors
        );
    }
    
    // Initialize lighting and colors from UI defaults
    updateLighting();
    updateColors();
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

    // Update
    cloth.update();

    // Render
    renderer.render(cloth, camera);

    // Update FPS
    if (window.updateFPS) {
        window.updateFPS(cloth.getFPS());
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

