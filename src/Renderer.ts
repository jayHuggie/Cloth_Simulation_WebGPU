import { mat4 } from 'gl-matrix';
import { mat4ToArray } from './utils/math';
import { Cloth } from './Cloth';
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
    private uniformBuffer: GPUBuffer | null = null;
    private lightingBuffer: GPUBuffer | null = null;

    private vertexShader: GPUShaderModule | null = null;
    private fragmentShader: GPUShaderModule | null = null;

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

        // Create render pipeline
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

    render(cloth: Cloth, camera: Camera): void {
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

        // Update lighting buffer
        const lightingData = new Float32Array(64); // 256 bytes / 4
        // Ambient color (lowered to make colors more vibrant)
        lightingData[0] = 0.15;
        lightingData[1] = 0.15;
        lightingData[2] = 0.15;
        // Light 1 direction (normalized)
        lightingData[4] = light1Len > 0 ? this.light1Position[0] / light1Len : 0;
        lightingData[5] = light1Len > 0 ? this.light1Position[1] / light1Len : 0;
        lightingData[6] = light1Len > 0 ? this.light1Position[2] / light1Len : 0;
        // Light 1 color
        lightingData[8] = this.light1Color[0];
        lightingData[9] = this.light1Color[1];
        lightingData[10] = this.light1Color[2];
        // Light 2 direction (normalized)
        lightingData[12] = light2Len > 0 ? this.light2Position[0] / light2Len : 0;
        lightingData[13] = light2Len > 0 ? this.light2Position[1] / light2Len : 0;
        lightingData[14] = light2Len > 0 ? this.light2Position[2] / light2Len : 0;
        // Light 2 color
        lightingData[16] = this.light2Color[0];
        lightingData[17] = this.light2Color[1];
        lightingData[18] = this.light2Color[2];
        // Diffuse color (cloth color)
        lightingData[20] = this.clothColor[0];
        lightingData[21] = this.clothColor[1];
        lightingData[22] = this.clothColor[2];

        this.device.queue.writeBuffer(this.lightingBuffer!, 0, lightingData);

        // Get current texture from canvas
        const texture = this.context.getCurrentTexture();
        const textureView = texture.createView();

        // Create command encoder
        const encoder = this.device.createCommandEncoder();
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

        // Render cloth
        pass.setPipeline(this.renderPipeline!);
        pass.setBindGroup(0, this.createBindGroup());
        pass.setVertexBuffer(0, cloth.getPositionBuffer());
        pass.setVertexBuffer(1, cloth.getNormalBuffer());
        pass.setIndexBuffer(cloth.getIndexBuffer(), 'uint32');
        pass.drawIndexed(cloth.getIndexCount());

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

    private createBindGroup(): GPUBindGroup {
        return this.device.createBindGroup({
            layout: this.renderPipeline!.getBindGroupLayout(0),
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

