import { vec3, mat4 } from 'gl-matrix';
import { translate, identity } from './utils/math';

const EPSILON = 0.01;

export class SphericalGround {
    private points: vec3[] = [];
    private normals: vec3[] = [];
    private indices: number[] = [];
    private model: mat4 = identity();
    private center: vec3;
    private radius: number;

    // WebGPU resources
    private positionBuffer: GPUBuffer | null = null;
    private normalBuffer: GPUBuffer | null = null;
    private indexBuffer: GPUBuffer | null = null;
    private indexCount: number = 0;

    constructor(center: vec3, radius: number, device: GPUDevice, segments: number = 32) {
        this.center = center;
        this.radius = radius;
        // Use identity matrix since vertex positions already include center offset
        this.model = identity();

        // Generate sphere mesh
        this.generateSphere(segments);

        // Create WebGPU buffers
        this.createBuffers(device);
    }

    private generateSphere(segments: number): void {
        const rings = segments;
        const sectors = segments;

        // Generate vertices
        for (let i = 0; i <= rings; i++) {
            const theta = (i * Math.PI) / rings; // 0 to PI
            const sinTheta = Math.sin(theta);
            const cosTheta = Math.cos(theta);

            for (let j = 0; j <= sectors; j++) {
                const phi = (j * 2 * Math.PI) / sectors; // 0 to 2*PI
                const sinPhi = Math.sin(phi);
                const cosPhi = Math.cos(phi);

                // Position on unit sphere
                const x = cosPhi * sinTheta;
                const y = cosTheta;
                const z = sinPhi * sinTheta;

                // Scale by radius and translate by center
                const point: vec3 = [
                    this.center[0] + x * this.radius,
                    this.center[1] + y * this.radius,
                    this.center[2] + z * this.radius
                ];

                // Normal (same as position relative to center, normalized)
                const normal: vec3 = [x, y, z];

                this.points.push(point);
                this.normals.push(normal);
            }
        }

        // Generate indices
        for (let i = 0; i < rings; i++) {
            for (let j = 0; j < sectors; j++) {
                const first = i * (sectors + 1) + j;
                const second = first + sectors + 1;

                // First triangle
                this.indices.push(first);
                this.indices.push(second);
                this.indices.push(first + 1);

                // Second triangle
                this.indices.push(second);
                this.indices.push(second + 1);
                this.indices.push(first + 1);
            }
        }

        this.indexCount = this.indices.length;
    }

    private createBuffers(device: GPUDevice): void {
        // Position buffer
        const positions = new Float32Array(this.points.length * 3);
        for (let i = 0; i < this.points.length; i++) {
            positions[i * 3] = this.points[i][0];
            positions[i * 3 + 1] = this.points[i][1];
            positions[i * 3 + 2] = this.points[i][2];
        }

        this.positionBuffer = device.createBuffer({
            size: positions.byteLength,
            usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
        });
        device.queue.writeBuffer(this.positionBuffer, 0, positions);

        // Normal buffer
        const normals = new Float32Array(this.normals.length * 3);
        for (let i = 0; i < this.normals.length; i++) {
            normals[i * 3] = this.normals[i][0];
            normals[i * 3 + 1] = this.normals[i][1];
            normals[i * 3 + 2] = this.normals[i][2];
        }

        this.normalBuffer = device.createBuffer({
            size: normals.byteLength,
            usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
        });
        device.queue.writeBuffer(this.normalBuffer, 0, normals);

        // Index buffer
        const indices = new Uint32Array(this.indices);
        this.indexBuffer = device.createBuffer({
            size: indices.byteLength,
            usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
        });
        device.queue.writeBuffer(this.indexBuffer, 0, indices);
    }

    getModelMatrix(): mat4 {
        return this.model;
    }

    getPositionBuffer(): GPUBuffer {
        return this.positionBuffer!;
    }

    getNormalBuffer(): GPUBuffer {
        return this.normalBuffer!;
    }

    getIndexBuffer(): GPUBuffer {
        return this.indexBuffer!;
    }

    getIndexCount(): number {
        return this.indexCount;
    }

    getCenter(): vec3 {
        return this.center;
    }

    getRadius(): number {
        return this.radius;
    }

    destroy(): void {
        // Buffers will be garbage collected, but we could explicitly destroy them if needed
    }
}

