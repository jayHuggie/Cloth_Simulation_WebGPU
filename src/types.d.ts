// WebGPU type declarations
/// <reference types="@webgpu/types" />

// Extend Window interface for UI callbacks
interface Window {
    setupUICallbacks?: (callbacks: {
        translateFixed: (axis: number, shift: number) => void;
        rotateFixed: (axis: number, shift: number) => void;
        resetCamera: () => void;
    }) => void;
    updateFPS?: (fps: number) => void;
    setupUIControls?: (
        updateCloth: (id: string, value: number) => void,
        updateLighting: () => void,
        updateColors: () => void
    ) => void;
}

