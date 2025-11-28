// WebGPU device initialization and utilities

export async function initWebGPU(canvas: HTMLCanvasElement): Promise<{
    device: GPUDevice;
    context: GPUCanvasContext;
    format: GPUTextureFormat;
    depthTexture: GPUTexture;
    depthTextureView: GPUTextureView;
}> {
    // Check for WebGPU support
    if (!navigator.gpu) {
        throw new Error('WebGPU is not supported in this browser');
    }

    // Request adapter
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) {
        throw new Error('Failed to get GPU adapter');
    }

    // Request device
    const device = await adapter.requestDevice();

    // Get canvas context
    const context = canvas.getContext('webgpu');
    if (!context) {
        throw new Error('Failed to get WebGPU context');
    }

    // Get preferred format
    const format = navigator.gpu.getPreferredCanvasFormat();

    // Configure canvas
    context.configure({
        device,
        format,
        alphaMode: 'premultiplied',
    });

    // Create depth texture
    const depthTexture = device.createTexture({
        size: [canvas.width, canvas.height],
        format: 'depth24plus',
        usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });

    const depthTextureView = depthTexture.createView();

    return { device, context, format, depthTexture, depthTextureView };
}

export async function loadShaderModule(
    device: GPUDevice,
    code: string
): Promise<GPUShaderModule> {
    return device.createShaderModule({
        code,
    });
}

export async function loadShaderFromFile(
    device: GPUDevice,
    path: string
): Promise<GPUShaderModule> {
    const response = await fetch(path);
    const code = await response.text();
    return loadShaderModule(device, code);
}

