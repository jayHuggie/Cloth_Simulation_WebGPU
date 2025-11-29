import { vec3, mat4 } from 'gl-matrix';
import { Particle } from './physics/Particle';
import { SpringDamper } from './physics/SpringDamper';
import { Triangle } from './physics/Triangle';
import { Ground } from './Ground';
import { identity } from './utils/math';

const EPSILON = 1e-6;

export class SimpleCloth {
    private positions: vec3[] = [];
    private normals: vec3[] = [];
    private indices: number[] = [];

    private particles: Particle[] = [];
    private connections: SpringDamper[] = [];
    private triangles: Triangle[] = [];
    private fixedParticleIdx: number[] = [];

    private topLeftPos: vec3;
    private horiDir: vec3;
    private vertDir: vec3;

    private size: number;
    private mass: number;
    private numTriangles: number; // Target number of triangles
    private gridSize: number; // Grid resolution (will be calculated from numTriangles)
    private numOfOversamples: number = 20;

    // Physics parameters
    private fluidDensity: number = 1.225;
    private c_d: number = 1.0;
    private windVelocity: vec3 = [0.5, 0.5, -2.5];
    private springConst: number = 1000.0;
    private dampingConst: number = 3.5;
    private restLength: number = 0;
    private restLengthDiag: number = 0;
    private particleMass: number = 0;
    private gravityAcce: number = 2.0;
    private groundPos: number = 0.0;

    private ground: Ground;

    // Timing
    private prevT: number = 0;
    private interval: number = 0;
    private fpsCount: number = 0;
    private fps: number = 0;

    // WebGPU buffers
    private positionBuffer: GPUBuffer | null = null;
    private normalBuffer: GPUBuffer | null = null;
    private indexBuffer: GPUBuffer | null = null;
    private indexCount: number = 0;
    private indexFormat: GPUIndexFormat = 'uint32';
    private device: GPUDevice;

    constructor(
        size: number,
        numTriangles: number,
        pos: vec3,
        hori: vec3,
        vert: vec3,
        device: GPUDevice,
        ground: Ground
    ) {
        this.size = size;
        this.mass = 100.0;
        this.numTriangles = numTriangles;
        this.topLeftPos = pos;
        this.horiDir = vec3.create();
        vec3.normalize(this.horiDir, hori);
        this.vertDir = vec3.create();
        vec3.normalize(this.vertDir, vert);
        this.device = device;
        this.ground = ground;

        this.initialize();
        this.prevT = performance.now();
    }

    private initialize(): void {
        // Calculate grid size from target triangle count
        // Each quad has 2 triangles, so we need sqrt(numTriangles / 2) quads per side
        // Round up to ensure we have at least the target number
        const quadsPerSide = Math.ceil(Math.sqrt(this.numTriangles / 2));
        this.gridSize = quadsPerSide + 1; // +1 for vertices per side
        
        const gridLength = this.size / (this.gridSize - 1);
        this.restLength = gridLength;
        this.restLengthDiag = gridLength * Math.sqrt(2.0);
        this.particleMass = this.mass / (this.gridSize * this.gridSize);

        if (this.groundPos > this.topLeftPos[1]) {
            this.groundPos = this.topLeftPos[1] - EPSILON;
        }

        // Calculate plane normal
        const planeDir = vec3.create();
        vec3.cross(planeDir, this.horiDir, this.vertDir);
        planeDir[1] = 0.0;
        vec3.normalize(planeDir, planeDir);

        const norm = vec3.create();
        vec3.cross(norm, this.vertDir, this.horiDir);
        vec3.normalize(norm, norm);

        // Create particles and vertices in a grid
        for (let y = 0; y < this.gridSize; y++) {
            for (let x = 0; x < this.gridSize; x++) {
                const i = x + y * this.gridSize;
                const pos = vec3.create();
                vec3.scaleAndAdd(pos, this.topLeftPos, this.horiDir, x * gridLength);
                vec3.scaleAndAdd(pos, pos, this.vertDir, y * gridLength);
                this.positions[i] = pos;

                if (pos[1] < this.groundPos) {
                    const j = i - this.gridSize;
                    if (j >= 0) {
                        vec3.scaleAndAdd(pos, this.positions[j], planeDir, gridLength);
                    }
                    this.normals[i] = [0.0, -1.0, 0.0];
                } else {
                    this.normals[i] = [...norm];
                }

                const particle = new Particle(
                    this.positions[i],
                    this.normals[i],
                    this.particleMass,
                    this.gravityAcce,
                    this.groundPos
                );
                this.particles.push(particle);
            }
        }

        // Create triangles (quads split into 2 triangles)
        for (let y = 0; y < this.gridSize - 1; y++) {
            for (let x = 0; x < this.gridSize - 1; x++) {
                const topLeftIdx = x + y * this.gridSize;
                const topRightIdx = topLeftIdx + 1;
                const bottomLeftIdx = topLeftIdx + this.gridSize;
                const bottomRightIdx = bottomLeftIdx + 1;

                // First triangle
                this.indices.push(topLeftIdx, bottomLeftIdx, bottomRightIdx);
                // Second triangle
                this.indices.push(topLeftIdx, bottomRightIdx, topRightIdx);

                const tri1 = new Triangle(
                    this.particles[topLeftIdx],
                    this.particles[bottomLeftIdx],
                    this.particles[bottomRightIdx],
                    this.fluidDensity,
                    this.c_d,
                    this.windVelocity
                );
                this.triangles.push(tri1);

                const tri2 = new Triangle(
                    this.particles[topLeftIdx],
                    this.particles[bottomRightIdx],
                    this.particles[topRightIdx],
                    this.fluidDensity,
                    this.c_d,
                    this.windVelocity
                );
                this.triangles.push(tri2);
            }
        }

        // Create spring dampers
        for (let y = 0; y < this.gridSize - 1; y++) {
            for (let x = 0; x < this.gridSize - 1; x++) {
                const topLeftIdx = x + y * this.gridSize;
                const topRightIdx = topLeftIdx + 1;
                const bottomLeftIdx = topLeftIdx + this.gridSize;
                const bottomRightIdx = bottomLeftIdx + 1;

                this.connections.push(
                    new SpringDamper(
                        this.particles[topLeftIdx],
                        this.particles[topRightIdx],
                        this.springConst,
                        this.dampingConst,
                        this.restLength
                    )
                );
                this.connections.push(
                    new SpringDamper(
                        this.particles[topLeftIdx],
                        this.particles[bottomRightIdx],
                        this.springConst,
                        this.dampingConst,
                        this.restLengthDiag
                    )
                );
                this.connections.push(
                    new SpringDamper(
                        this.particles[topLeftIdx],
                        this.particles[bottomLeftIdx],
                        this.springConst,
                        this.dampingConst,
                        this.restLength
                    )
                );
                this.connections.push(
                    new SpringDamper(
                        this.particles[bottomLeftIdx],
                        this.particles[topRightIdx],
                        this.springConst,
                        this.dampingConst,
                        this.restLengthDiag
                    )
                );

                if (x === this.gridSize - 2) {
                    this.connections.push(
                        new SpringDamper(
                            this.particles[topRightIdx],
                            this.particles[bottomRightIdx],
                            this.springConst,
                            this.dampingConst,
                            this.restLength
                        )
                    );
                }
                if (y === this.gridSize - 2) {
                    this.connections.push(
                        new SpringDamper(
                            this.particles[bottomLeftIdx],
                            this.particles[bottomRightIdx],
                            this.springConst,
                            this.dampingConst,
                            this.restLength
                        )
                    );
                }
            }
        }

        // Set fixed particles (top row)
        for (let i = 0; i < this.gridSize; i++) {
            this.fixedParticleIdx.push(i);
            this.particles[i].setFixed(true);
        }

        // Create WebGPU buffers
        this.createBuffers();
    }

    private createBuffers(): void {
        const numVertices = this.positions.length;
        const positionSize = numVertices * 3 * 4; // vec3 * float32
        const normalSize = numVertices * 3 * 4;

        try {
            // Create position buffer and write data
            const positions = new Float32Array(numVertices * 3);
            for (let i = 0; i < numVertices; i++) {
                positions[i * 3] = this.positions[i][0];
                positions[i * 3 + 1] = this.positions[i][1];
                positions[i * 3 + 2] = this.positions[i][2];
            }
            
            this.positionBuffer = this.device.createBuffer({
                size: positionSize,
                usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
            });
            this.device.queue.writeBuffer(this.positionBuffer, 0, positions);

            // Create normal buffer and write data
            const normals = new Float32Array(numVertices * 3);
            for (let i = 0; i < numVertices; i++) {
                normals[i * 3] = this.normals[i][0];
                normals[i * 3 + 1] = this.normals[i][1];
                normals[i * 3 + 2] = this.normals[i][2];
            }
            
            this.normalBuffer = this.device.createBuffer({
                size: normalSize,
                usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
            });
            this.device.queue.writeBuffer(this.normalBuffer, 0, normals);

            // Use Uint16 for indices if possible (saves memory), otherwise Uint32
            const maxIndex = numVertices - 1;
            if (maxIndex <= 65535) {
                const indexArray = new Uint16Array(this.indices);
                this.indexFormat = 'uint16';
                this.indexBuffer = this.device.createBuffer({
                    size: indexArray.byteLength,
                    usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
                });
                this.device.queue.writeBuffer(this.indexBuffer, 0, new Uint16Array(this.indices).buffer);
            } else {
                const indexArray = new Uint32Array(this.indices);
                this.indexFormat = 'uint32';
                this.indexBuffer = this.device.createBuffer({
                    size: indexArray.byteLength,
                    usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
                });
                this.device.queue.writeBuffer(this.indexBuffer, 0, new Uint32Array(this.indices).buffer);
            }
            this.indexCount = this.indices.length;
        } catch (error) {
            console.error('Failed to create buffers:', error);
            throw new Error(`Failed to create simple cloth buffers. Triangle count might be too high (${this.numTriangles}). Try a lower value.`);
        }
    }

    update(): void {
        const currT = performance.now();
        this.fpsCount++;
        this.interval += currT - this.prevT;

        if (this.interval >= 1000) {
            this.fps = this.fpsCount;
            this.interval = 0;
            this.fpsCount = 0;
        }

        let deltaT = (currT - this.prevT) / 1000.0;
        this.prevT = currT;

        deltaT /= this.numOfOversamples;

        // Physics simulation with oversampling
        for (let i = 0; i < this.numOfOversamples; i++) {
            // Compute spring damper forces
            for (const sp of this.connections) {
                sp.computeForce();
            }

            // Compute aerodynamic forces
            for (const tri of this.triangles) {
                tri.computeAerodynamicForce();
            }

            // Integrate particles
            for (const p of this.particles) {
                p.integrate(deltaT);
            }
        }

        // Update positions from particles
        for (let i = 0; i < this.particles.length; i++) {
            vec3.copy(this.positions[i], this.particles[i].getPosition());
        }

        // Reset and recompute normals
        for (const n of this.normals) {
            n[0] = 0.0;
            n[1] = 0.0;
            n[2] = 0.0;
        }

        for (const tri of this.triangles) {
            tri.computeNormal();
        }

        // Normalize normals
        for (const n of this.normals) {
            const len = Math.sqrt(n[0] * n[0] + n[1] * n[1] + n[2] * n[2]);
            if (len > EPSILON) {
                n[0] /= len;
                n[1] /= len;
                n[2] /= len;
            }
        }

        // Update GPU buffers
        this.updateBuffers();
    }

    private updateBuffers(): void {
        const numVertices = this.positions.length;
        const positions = new Float32Array(numVertices * 3);
        const normals = new Float32Array(numVertices * 3);

        for (let i = 0; i < numVertices; i++) {
            positions[i * 3] = this.positions[i][0];
            positions[i * 3 + 1] = this.positions[i][1];
            positions[i * 3 + 2] = this.positions[i][2];

            normals[i * 3] = this.normals[i][0];
            normals[i * 3 + 1] = this.normals[i][1];
            normals[i * 3 + 2] = this.normals[i][2];
        }

        this.device.queue.writeBuffer(this.positionBuffer!, 0, positions);
        this.device.queue.writeBuffer(this.normalBuffer!, 0, normals);
    }

    setNumTriangles(numTriangles: number): void {
        if (this.numTriangles === numTriangles) return;
        
        this.numTriangles = numTriangles;
        
        // Clean up old buffers
        this.destroy();
        
        // Reinitialize with new triangle count
        this.positions = [];
        this.normals = [];
        this.indices = [];
        this.particles = [];
        this.connections = [];
        this.triangles = [];
        this.fixedParticleIdx = [];
        this.initialize();
    }

    getNumTriangles(): number {
        return this.indexCount / 3; // Each triangle has 3 indices
    }

    getFPS(): number {
        return this.fps;
    }

    getModelMatrix(): mat4 {
        return identity();
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

    getIndexFormat(): GPUIndexFormat {
        return this.indexFormat;
    }

    getGround(): Ground {
        return this.ground;
    }

    // Getters and setters for parameters
    setMass(m: number): void {
        this.mass = m;
        this.particleMass = this.mass / (this.gridSize * this.gridSize);
        // Update all particles' mass
        for (const p of this.particles) {
            p.setMass(this.particleMass);
        }
    }

    getMass(): number {
        return this.mass;
    }

    setGravityAcce(g: number): void {
        this.gravityAcce = Math.abs(g);
        // Update all particles
        for (const p of this.particles) {
            p.setGravityAcce(this.gravityAcce);
        }
    }

    getGravityAcce(): number {
        return this.gravityAcce;
    }

    setGroundPos(h: number): void {
        this.groundPos = h;
        this.ground.setGroundLevel(h);
        // Update all particles
        for (const p of this.particles) {
            p.setGroundPos(this.groundPos);
        }
    }

    getGroundPos(): number {
        return this.groundPos;
    }

    setSpringConst(k: number): void {
        this.springConst = Math.abs(k);
    }

    getSpringConst(): number {
        return this.springConst;
    }

    setDampingConst(c: number): void {
        this.dampingConst = Math.abs(c);
    }

    getDampingConst(): number {
        return this.dampingConst;
    }

    setWindVelocity(v: vec3): void {
        vec3.copy(this.windVelocity, v);
        // Update triangles
        for (const tri of this.triangles) {
            tri.setWindVelocity(v);
        }
    }

    getWindVelocity(): vec3 {
        return this.windVelocity;
    }

    setFluidDensity(rho: number): void {
        this.fluidDensity = Math.abs(rho);
        // Update triangles
        for (const tri of this.triangles) {
            tri.setFluidDensity(this.fluidDensity);
        }
    }

    getFluidDensity(): number {
        return this.fluidDensity;
    }

    setDragConst(c: number): void {
        this.c_d = Math.abs(c);
        // Update triangles
        for (const tri of this.triangles) {
            tri.setDragConst(this.c_d);
        }
    }

    getDragConst(): number {
        return this.c_d;
    }

    translateFixedParticles(axis: number, shift: number): void {
        for (const idx of this.fixedParticleIdx) {
            this.positions[idx][axis] += shift;
            vec3.copy(this.particles[idx].getPosition(), this.positions[idx]);
        }
    }

    rotateFixedParticles(axis: number, shift: number): void {
        // Calculate midpoint
        const first = this.positions[this.fixedParticleIdx[0]];
        const last = this.positions[this.fixedParticleIdx[this.fixedParticleIdx.length - 1]];
        const midPoint = vec3.create();
        vec3.add(midPoint, first, last);
        vec3.scale(midPoint, midPoint, 0.5);

        // Create rotation matrix
        const rotMat = mat4.create();
        if (axis === 0) {
            mat4.rotateX(rotMat, rotMat, shift);
        } else if (axis === 1) {
            mat4.rotateY(rotMat, rotMat, shift);
        } else if (axis === 2) {
            mat4.rotateZ(rotMat, rotMat, shift);
        }

        // Apply rotation around midpoint
        for (const idx of this.fixedParticleIdx) {
            const pos = this.positions[idx];
            const relative = vec3.create();
            vec3.sub(relative, pos, midPoint);
            const rotated = vec3.create();
            vec3.transformMat4(rotated, relative, rotMat);
            vec3.add(pos, midPoint, rotated);
            vec3.copy(this.particles[idx].getPosition(), pos);
        }
    }

    destroy(): void {
        // Clean up WebGPU buffers
        if (this.positionBuffer) {
            this.positionBuffer.destroy();
            this.positionBuffer = null;
        }
        if (this.normalBuffer) {
            this.normalBuffer.destroy();
            this.normalBuffer = null;
        }
        if (this.indexBuffer) {
            this.indexBuffer.destroy();
            this.indexBuffer = null;
        }
    }
}

