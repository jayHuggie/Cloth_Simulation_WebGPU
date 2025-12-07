import { mat4 } from 'gl-matrix';
import { mat4ToArray } from './utils/math';
import { Cloth } from './Cloth';
import { SimpleCloth } from './SimpleCloth';
import { Ground } from './Ground';
import { Camera } from './Camera';

export class Renderer {
    private device: GPUDevice;
    private context: GPUCanvasContext;
    private format: GPUTextureFormat;
    private depthTexture: GPUTexture;
    private depthTextureView: GPUTextureView;
    private canvas: HTMLCanvasElement;

    private renderPipeline: GPURenderPipeline | null = null;
    private wireframePipeline: GPURenderPipeline | null = null;
    private uniformBuffer: GPUBuffer | null = null;
    private lightingBuffer: GPUBuffer | null = null;

    private vertexShader: GPUShaderModule | null = null;
    private fragmentShader: GPUShaderModule | null = null;
    
    private wireframeMode: boolean = false;
    private wireframeColor: [number, number, number] = [0.0, 1.0, 1.0]; // Bright cyan wireframe

    // inital lighting and color parameters
    private light1Color: [number, number, number] = [1.0, 0.0, 0.0];
    private light1Position: [number, number, number] = [1, -1.5, 2];
    private light2Color: [number, number, number] = [0.4, 0.4, 0.4];
    private light2Position: [number, number, number] = [-1, 5, -2];
    private clothColor: [number, number, number] = [0.9, 0.01, 0.01];
    private groundColor: [number, number, number] = [0.5, 0.4, 0.35];

    constructor(
        device: GPUDevice,
        context: GPUCanvasContext,
        format: GPUTextureFormat,
        depthTexture: GPUTexture,
        depthTextureView: GPUTextureView,
        canvas: HTMLCanvasElement
    ) {
        this.device = device;
        this.context = context;
        this.format = format;
        this.depthTexture = depthTexture;
        this.depthTextureView = depthTextureView;
        this.canvas = canvas;
    }

    async initialize(vertexShaderCode: string, fragmentShaderCode: string): Promise<void> {
        // Create shader modules
        this.vertexShader = this.device.createShaderModule({ code: vertexShaderCode });
        this.fragmentShader = this.device.createShaderModule({ code: fragmentShaderCode });

        // Create uniform buffers
        // Uniforms: viewProj (16 floats) + model (16 floats) = 32 floats * 4 bytes = 128 bytes
        this.uniformBuffer = this.device.createBuffer({
            size: 128,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });

        // Lighting uniforms: 6 vec3s = 18 floats * 4 bytes = 72 bytes, but align to 256 for safety
        this.lightingBuffer = this.device.createBuffer({
            size: 256,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });

        // Create render pipeline (filled triangles)
        this.renderPipeline = this.device.createRenderPipeline({
            layout: 'auto',
            vertex: {
                module: this.vertexShader,
                entryPoint: 'main',
                buffers: [
                    {
                        arrayStride: 12, // 3 floats * 4 bytes
                        attributes: [
                            { shaderLocation: 0, offset: 0, format: 'float32x3' }, // position
                        ],
                    },
                    {
                        arrayStride: 12, // 3 floats * 4 bytes
                        attributes: [
                            { shaderLocation: 1, offset: 0, format: 'float32x3' }, // normal
                        ],
                    },
                ],
            },
            fragment: {
                module: this.fragmentShader,
                entryPoint: 'main',
                targets: [{ format: this.format }],
            },
            primitive: {
                topology: 'triangle-list',
                cullMode: 'none',
            },
            depthStencil: {
                depthWriteEnabled: true,
                depthCompare: 'less-equal',
                format: 'depth24plus',
            },
        });

        // Create wireframe pipeline (triangles for quad-based wireframe)
        this.wireframePipeline = this.device.createRenderPipeline({
            layout: 'auto',
            vertex: {
                module: this.vertexShader,
                entryPoint: 'main',
                buffers: [
                    {
                        arrayStride: 12, // 3 floats * 4 bytes
                        attributes: [
                            { shaderLocation: 0, offset: 0, format: 'float32x3' }, // position
                        ],
                    },
                    {
                        arrayStride: 12, // 3 floats * 4 bytes
                        attributes: [
                            { shaderLocation: 1, offset: 0, format: 'float32x3' }, // normal
                        ],
                    },
                ],
            },
            fragment: {
                module: this.fragmentShader,
                entryPoint: 'main',
                targets: [{ format: this.format }],
            },
            primitive: {
                topology: 'triangle-list', // Use triangles for quad-based wireframe
                cullMode: 'none',
            },
            depthStencil: {
                depthWriteEnabled: false, // Don't write depth for wireframe
                depthCompare: 'less', // Render wireframe when closer or equal (ensures it's visible)
                format: 'depth24plus',
            },
        });
    }

    resize(width: number, height: number): void {
        this.canvas.width = width;
        this.canvas.height = height;

        // Recreate depth texture
        this.depthTexture.destroy();
        this.depthTexture = this.device.createTexture({
            size: [width, height],
            format: 'depth24plus',
            usage: GPUTextureUsage.RENDER_ATTACHMENT,
        });
        this.depthTextureView = this.depthTexture.createView();
    }

    setLight1Color(r: number, g: number, b: number): void {
        this.light1Color = [r, g, b];
    }

    setLight1Position(x: number, y: number, z: number): void {
        this.light1Position = [x, y, z];
    }

    setLight2Color(r: number, g: number, b: number): void {
        this.light2Color = [r, g, b];
    }

    setLight2Position(x: number, y: number, z: number): void {
        this.light2Position = [x, y, z];
    }

    setClothColor(r: number, g: number, b: number): void {
        this.clothColor = [r, g, b];
    }

    setGroundColor(r: number, g: number, b: number): void {
        this.groundColor = [r, g, b];
    }

    setWireframeMode(enabled: boolean): void {
        this.wireframeMode = enabled;
    }

    getWireframeMode(): boolean {
        return this.wireframeMode;
    }

    render(cloth: Cloth | SimpleCloth, camera: Camera): void {
        const viewProj = camera.getViewProjectMtx();
        const model = cloth.getModelMatrix();

        // Update uniform buffer
        const uniformData = new Float32Array(32);
        uniformData.set(mat4ToArray(viewProj), 0);
        uniformData.set(mat4ToArray(model), 16);
        this.device.queue.writeBuffer(this.uniformBuffer!, 0, uniformData);

        // Normalize light directions
        const light1Len = Math.sqrt(
            this.light1Position[0] ** 2 + 
            this.light1Position[1] ** 2 + 
            this.light1Position[2] ** 2
        );
        const light2Len = Math.sqrt(
            this.light2Position[0] ** 2 + 
            this.light2Position[1] ** 2 + 
            this.light2Position[2] ** 2
        );

        // Update lighting buffer - prepare base lighting data
        // In WGSL, vec3 is aligned to 16 bytes (4 floats), so layout is:
        // ambientColor: offset 0 (indices 0-2, padding at 3)
        // lightDirection: offset 16 (indices 4-6, padding at 7)
        // lightColor: offset 32 (indices 8-10, padding at 11)
        // lightDirection2: offset 48 (indices 12-14, padding at 15)
        // lightColor2: offset 64 (indices 16-18, padding at 19)
        // diffuseColor: offset 80 (indices 20-22, padding at 23)
        const lightingData = new Float32Array(64); // 256 bytes / 4
        
        // Always use normal lighting for the cloth (same as when wireframe is off)
        // Wireframe will have its own special lighting settings when rendered
        lightingData[0] = 0.15;
        lightingData[1] = 0.15;
        lightingData[2] = 0.15;
        lightingData[3] = 0.0; // padding
        // Light 1 direction (normalized)
        lightingData[4] = light1Len > 0 ? this.light1Position[0] / light1Len : 0;
        lightingData[5] = light1Len > 0 ? this.light1Position[1] / light1Len : 0;
        lightingData[6] = light1Len > 0 ? this.light1Position[2] / light1Len : 0;
        lightingData[7] = 0.0; // padding
        // Light 1 color
        lightingData[8] = this.light1Color[0];
        lightingData[9] = this.light1Color[1];
        lightingData[10] = this.light1Color[2];
        lightingData[11] = 0.0; // padding
        // Light 2 direction (normalized)
        lightingData[12] = light2Len > 0 ? this.light2Position[0] / light2Len : 0;
        lightingData[13] = light2Len > 0 ? this.light2Position[1] / light2Len : 0;
        lightingData[14] = light2Len > 0 ? this.light2Position[2] / light2Len : 0;
        lightingData[15] = 0.0; // padding
        // Light 2 color
        lightingData[16] = this.light2Color[0];
        lightingData[17] = this.light2Color[1];
        lightingData[18] = this.light2Color[2];
        lightingData[19] = 0.0; // padding
        // Diffuse color (cloth color)
        lightingData[20] = this.clothColor[0];
        lightingData[21] = this.clothColor[1];
        lightingData[22] = this.clothColor[2];
        lightingData[23] = 0.0; // padding

        // Write the buffer - WebGPU queue operations are automatically ordered
        // However, to ensure the write completes before rendering, we'll write it and then
        // create the encoder (which should ensure ordering)
        this.device.queue.writeBuffer(this.lightingBuffer!, 0, lightingData);

        // Get current texture from canvas
        const texture = this.context.getCurrentTexture();
        const textureView = texture.createView();

        // Create command encoder AFTER buffer write
        // In WebGPU, queue operations are ordered, so writes complete before commands execute
        const encoder = this.device.createCommandEncoder();
        
        // IMPORTANT: Create bind group AFTER buffer write to ensure it references updated buffer
        // Note: Bind groups just reference the buffer, they don't cache data
        const clothBindGroup = this.createBindGroup(this.renderPipeline!);
        
        const pass = encoder.beginRenderPass({
            colorAttachments: [
                {
                    view: textureView,
                    clearValue: { r: 0.0, g: 0.0, b: 0.0, a: 1.0 },
                    loadOp: 'clear',
                    storeOp: 'store',
                },
            ],
            depthStencilAttachment: {
                view: this.depthTextureView,
                depthClearValue: 1.0,
                depthLoadOp: 'clear',
                depthStoreOp: 'store',
            },
        });

        // Render cloth - check if buffers are valid
        const positionBuffer = cloth.getPositionBuffer();
        const normalBuffer = cloth.getNormalBuffer();
        const indexBuffer = cloth.getIndexBuffer();
        
        if (!positionBuffer || !normalBuffer || !indexBuffer) {
            console.warn('Cloth buffers not ready, skipping render');
            pass.end();
            this.device.queue.submit([encoder.finish()]);
            return;
        }

        // Always render filled triangles first
        // (Cloth uses normal lighting regardless of wireframe mode)
        // Bind group was created AFTER buffer write to ensure it uses updated data
        pass.setPipeline(this.renderPipeline!);
        pass.setBindGroup(0, clothBindGroup);
        pass.setVertexBuffer(0, positionBuffer);
        pass.setVertexBuffer(1, normalBuffer);
        pass.setIndexBuffer(indexBuffer, cloth.getIndexFormat());
        pass.drawIndexed(cloth.getIndexCount());

        // If wireframe mode is enabled, overlay wireframe quads on top
        if (this.wireframeMode && this.wireframePipeline) {
            const wireframeBuffers = cloth.getWireframeBuffers();
            if (wireframeBuffers && wireframeBuffers.indexCount > 0) {
                // Create wireframe lighting data with bright cyan color
                const wireframeLightingData = new Float32Array(64);
                wireframeLightingData.set(lightingData);
                // Set diffuse color to bright cyan for wireframe
                wireframeLightingData[20] = this.wireframeColor[0];
                wireframeLightingData[21] = this.wireframeColor[1];
                wireframeLightingData[22] = this.wireframeColor[2];
                // Make ambient VERY high so wireframe is always bright and visible
                wireframeLightingData[0] = 2.0; // Overbright for maximum visibility
                wireframeLightingData[1] = 2.0;
                wireframeLightingData[2] = 2.0;
                // Disable directional lights for wireframe (make it pure bright cyan)
                wireframeLightingData[8] = 0.0;
                wireframeLightingData[9] = 0.0;
                wireframeLightingData[10] = 0.0;
                wireframeLightingData[16] = 0.0;
                wireframeLightingData[17] = 0.0;
                wireframeLightingData[18] = 0.0;
                this.device.queue.writeBuffer(this.lightingBuffer!, 0, wireframeLightingData);
                
                // Render wireframe quads (triangles) on top
                pass.setPipeline(this.wireframePipeline);
                pass.setBindGroup(0, this.createBindGroup(this.wireframePipeline));
                pass.setVertexBuffer(0, wireframeBuffers.positionBuffer);
                pass.setVertexBuffer(1, wireframeBuffers.normalBuffer);
                pass.setIndexBuffer(wireframeBuffers.indexBuffer, wireframeBuffers.indexFormat);
                pass.drawIndexed(wireframeBuffers.indexCount);
            } else {
                // Fallback: disable wireframe if buffers not available
                console.warn('Wireframe buffers not available, disabling wireframe mode');
                this.wireframeMode = false;
                const wireframeToggle = document.getElementById('wireframeToggle') as HTMLInputElement;
                if (wireframeToggle) wireframeToggle.checked = false;
            }
        }

        // Render ground
        const ground = cloth.getGround();
        const groundModel = ground.getModelMatrix();
        const groundUniformData = new Float32Array(32);
        groundUniformData.set(mat4ToArray(viewProj), 0);
        groundUniformData.set(mat4ToArray(groundModel), 16);
        this.device.queue.writeBuffer(this.uniformBuffer!, 0, groundUniformData);

        // Ground color
        const groundLightingData = new Float32Array(64);
        groundLightingData.set(lightingData);
        groundLightingData[20] = this.groundColor[0];
        groundLightingData[21] = this.groundColor[1];
        groundLightingData[22] = this.groundColor[2];
        this.device.queue.writeBuffer(this.lightingBuffer!, 0, groundLightingData);

        pass.setVertexBuffer(0, ground.getPositionBuffer());
        pass.setVertexBuffer(1, ground.getNormalBuffer());
        pass.setIndexBuffer(ground.getIndexBuffer(), 'uint32');
        pass.drawIndexed(ground.getIndexCount());

        pass.end();
        this.device.queue.submit([encoder.finish()]);
    }

    private createBindGroup(pipeline: GPURenderPipeline): GPUBindGroup {
        return this.device.createBindGroup({
            layout: pipeline.getBindGroupLayout(0),
            entries: [
                {
                    binding: 0,
                    resource: {
                        buffer: this.uniformBuffer!,
                    },
                },
                {
                    binding: 1,
                    resource: {
                        buffer: this.lightingBuffer!,
                    },
                },
            ],
        });
    }
}

