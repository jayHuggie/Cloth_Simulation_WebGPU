import { vec3, mat4 } from 'gl-matrix';
import { Particle } from './physics/Particle';
import { SpringDamper } from './physics/SpringDamper';
import { Triangle } from './physics/Triangle';
import { Ground } from './Ground';
import { SphericalGround } from './SphericalGround';
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
    private gridSize: number = 0; // Grid resolution (will be calculated from numTriangles)
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

    private ground: Ground | SphericalGround;
    private isSphericalGround: boolean = false;

    // Timing
    private prevT: number = 0;
    private interval: number = 0;
    private fpsCount: number = 0;
    private fps: number = 0;
    
    // Drop control for Scene 2
    private isDropped: boolean = false;
    private initialPositions: vec3[] = [];

    // WebGPU buffers
    private positionBuffer: GPUBuffer | null = null;
    private normalBuffer: GPUBuffer | null = null;
    private indexBuffer: GPUBuffer | null = null;
    // Quad-based wireframe buffers
    private wireframePositionBuffer: GPUBuffer | null = null;
    private wireframeNormalBuffer: GPUBuffer | null = null;
    private wireframeIndexBuffer: GPUBuffer | null = null;
    private wireframeIndexCount: number = 0;
    private wireframeIndexFormat: GPUIndexFormat = 'uint32';
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
        ground: Ground | SphericalGround
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
        this.isSphericalGround = ground instanceof SphericalGround;

        this.initialize();
        this.prevT = 0; // Set to 0 so first frame is skipped
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

                let particle: Particle;
                if (this.isSphericalGround) {
                    const sphereGround = this.ground as SphericalGround;
                    particle = new Particle(
                        this.positions[i],
                        this.normals[i],
                        this.particleMass,
                        this.gravityAcce,
                        this.groundPos,
                        sphereGround.getCenter(),
                        sphereGround.getRadius()
                    );
                } else {
                    particle = new Particle(
                        this.positions[i],
                        this.normals[i],
                        this.particleMass,
                        this.gravityAcce,
                        this.groundPos
                    );
                }
                this.particles.push(particle);
            }
        }

        // Push particles outside sphere BEFORE creating springs (if spherical ground)
        // This ensures springs are created with correct rest lengths
        if (this.isSphericalGround) {
            const sphereGround = this.ground as SphericalGround;
            const sphereCenter = sphereGround.getCenter();
            const sphereRadius = sphereGround.getRadius();
            
            // Ensure all particles have sphere collision data set
            this.ensureSphereCollisionData();
            
            for (const particle of this.particles) {
                const pos = particle.getPosition();
                const toParticle = vec3.create();
                vec3.sub(toParticle, pos, sphereCenter);
                const distance = vec3.length(toParticle);
                
                if (distance < sphereRadius + EPSILON) {
                    // Push particle to sphere surface
                    vec3.normalize(toParticle, toParticle);
                    vec3.scaleAndAdd(pos, sphereCenter, toParticle, sphereRadius + EPSILON);
                }
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
        // For sphere ground, use actual distances (after adjustment)
        // For flat ground, use theoretical rest lengths (more precise for perfect grid)
        for (let y = 0; y < this.gridSize - 1; y++) {
            for (let x = 0; x < this.gridSize - 1; x++) {
                const topLeftIdx = x + y * this.gridSize;
                const topRightIdx = topLeftIdx + 1;
                const bottomLeftIdx = topLeftIdx + this.gridSize;
                const bottomRightIdx = bottomLeftIdx + 1;

                let restLen1: number, restLen2: number, restLen3: number, restLen4: number;
                
                if (this.isSphericalGround) {
                    // Use actual distances after sphere adjustment
                    const p1 = this.particles[topLeftIdx].getPosition();
                    const p2 = this.particles[topRightIdx].getPosition();
                    const p3 = this.particles[bottomLeftIdx].getPosition();
                    const p4 = this.particles[bottomRightIdx].getPosition();
                    
                    restLen1 = vec3.distance(p1, p2);
                    restLen2 = vec3.distance(p1, p3);
                    restLen3 = vec3.distance(p1, p4);
                    restLen4 = vec3.distance(p3, p2);
                } else {
                    // Use theoretical rest lengths for perfect grid (more precise)
                    restLen1 = this.restLength;
                    restLen2 = this.restLength;
                    restLen3 = this.restLengthDiag;
                    restLen4 = this.restLengthDiag;
                }

                this.connections.push(
                    new SpringDamper(
                        this.particles[topLeftIdx],
                        this.particles[topRightIdx],
                        this.springConst,
                        this.dampingConst,
                        restLen1
                    )
                );
                this.connections.push(
                    new SpringDamper(
                        this.particles[topLeftIdx],
                        this.particles[bottomRightIdx],
                        this.springConst,
                        this.dampingConst,
                        restLen3
                    )
                );
                this.connections.push(
                    new SpringDamper(
                        this.particles[topLeftIdx],
                        this.particles[bottomLeftIdx],
                        this.springConst,
                        this.dampingConst,
                        restLen2
                    )
                );
                this.connections.push(
                    new SpringDamper(
                        this.particles[bottomLeftIdx],
                        this.particles[topRightIdx],
                        this.springConst,
                        this.dampingConst,
                        restLen4
                    )
                );

                if (x === this.gridSize - 2) {
                    const restLen5 = this.isSphericalGround 
                        ? vec3.distance(this.particles[topRightIdx].getPosition(), this.particles[bottomRightIdx].getPosition())
                        : this.restLength;
                    this.connections.push(
                        new SpringDamper(
                            this.particles[topRightIdx],
                            this.particles[bottomRightIdx],
                            this.springConst,
                            this.dampingConst,
                            restLen5
                        )
                    );
                }
                if (y === this.gridSize - 2) {
                    const restLen6 = this.isSphericalGround
                        ? vec3.distance(this.particles[bottomLeftIdx].getPosition(), this.particles[bottomRightIdx].getPosition())
                        : this.restLength;
                    this.connections.push(
                        new SpringDamper(
                            this.particles[bottomLeftIdx],
                            this.particles[bottomRightIdx],
                            this.springConst,
                            this.dampingConst,
                            restLen6
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

        // Store initial positions for reset functionality
        this.storeInitialPositions();

        // Create WebGPU buffers
        this.createBuffers();
        this.createEdgeBuffers();
    }
    
    private storeInitialPositions(): void {
        this.initialPositions = [];
        for (const particle of this.particles) {
            const pos = particle.getPosition();
            this.initialPositions.push(vec3.clone(pos));
        }
    }
    
    resetToInitialState(): void {
        // Ensure sphere collision data is set for Scene 2
        if (this.isSphericalGround) {
            this.ensureSphereCollisionData();
        }
        
        // Reset all particles to initial positions
        for (let i = 0; i < this.particles.length; i++) {
            const particle = this.particles[i];
            const initialPos = this.initialPositions[i];
            const currentPos = particle.getPosition();
            vec3.copy(currentPos, initialPos);
            
            // Reset velocity
            const vel = particle.getVelocity();
            vec3.zero(vel);
            
            // Reset force
            particle.resetForce();
        }
        
        // Re-fix top row particles
        for (const idx of this.fixedParticleIdx) {
            this.particles[idx].setFixed(true);
        }
        
        // Reset timing
        this.prevT = 0;
        this.isDropped = false;
        
        // Update buffers
        this.updateBuffers();
    }
    
    // Ensure all particles have sphere collision data set (safety check for Scene 2)
    private ensureSphereCollisionData(): void {
        if (!this.isSphericalGround) return;
        
        const sphereGround = this.ground as SphericalGround;
        const sphereCenter = sphereGround.getCenter();
        const sphereRadius = sphereGround.getRadius();
        
        for (const particle of this.particles) {
            // Use setSphereCollision to ensure data is set (even if already set)
            particle.setSphereCollision(sphereCenter, sphereRadius);
            // Set edge length for adaptive collision margin calculation
            particle.setEdgeLength(this.restLength);
        }
    }
    
    // Project triangle centroids to ensure face centers stay outside sphere
    private enforceTriangleCentroidProjection(): void {
        if (!this.isSphericalGround) return;
        
        const sphereGround = this.ground as SphericalGround;
        const sphereCenter = sphereGround.getCenter();
        const sphereRadius = sphereGround.getRadius();
        const minDistance = sphereRadius + 0.01; // Small margin above sphere surface
        
        // Process each triangle
        for (let i = 0; i < this.indices.length; i += 3) {
            const i0 = this.indices[i];
            const i1 = this.indices[i + 1];
            const i2 = this.indices[i + 2];
            
            const p0 = this.particles[i0].getPosition();
            const p1 = this.particles[i1].getPosition();
            const p2 = this.particles[i2].getPosition();
            
            // Compute centroid
            const centroid = vec3.create();
            vec3.add(centroid, p0, p1);
            vec3.add(centroid, centroid, p2);
            vec3.scale(centroid, centroid, 1/3);
            
            // Check if centroid is inside sphere
            const toCentroid = vec3.create();
            vec3.sub(toCentroid, centroid, sphereCenter);
            const distance = vec3.length(toCentroid);
            
            if (distance < minDistance) {
                // Calculate how much to push outward
                const pushAmount = (minDistance - distance) / 3 + 0.01; // Divide by 3 since we push all 3 vertices
                
                // Push direction (from sphere center through centroid)
                if (distance < EPSILON) {
                    vec3.set(toCentroid, 0, 1, 0);
                } else {
                    vec3.normalize(toCentroid, toCentroid);
                }
                
                // Push each vertex outward (only if not fixed)
                if (!this.particles[i0].isFixedParticle()) {
                    vec3.scaleAndAdd(p0, p0, toCentroid, pushAmount);
                }
                if (!this.particles[i1].isFixedParticle()) {
                    vec3.scaleAndAdd(p1, p1, toCentroid, pushAmount);
                }
                if (!this.particles[i2].isFixedParticle()) {
                    vec3.scaleAndAdd(p2, p2, toCentroid, pushAmount);
                }
            }
        }
    }
    
    drop(): void {
        // Ensure sphere collision data is set for Scene 2 before dropping
        if (this.isSphericalGround) {
            this.ensureSphereCollisionData();
        }
        
        this.isDropped = true;
        // Release fixed particles (top row) to allow dropping
        for (const idx of this.fixedParticleIdx) {
            this.particles[idx].setFixed(false);
        }
        // Update buffers to ensure they're in sync when dropping starts
        this.updateBuffers();
    }
    
    enablePhysics(): void {
        // Enable physics simulation while keeping top row fixed (for Scene 1)
        this.isDropped = true;
    }
    
    isClothDropped(): boolean {
        return this.isDropped;
    }

    // Store edge pairs for wireframe generation
    private wireframeEdgePairs: [number, number][] = [];
    
    private createEdgeBuffers(): void {
        // Clean up old wireframe buffers if they exist
        if (this.wireframePositionBuffer) {
            this.wireframePositionBuffer.destroy();
            this.wireframePositionBuffer = null;
        }
        if (this.wireframeNormalBuffer) {
            this.wireframeNormalBuffer.destroy();
            this.wireframeNormalBuffer = null;
        }
        if (this.wireframeIndexBuffer) {
            this.wireframeIndexBuffer.destroy();
            this.wireframeIndexBuffer = null;
        }
        
        // Extract unique edges from triangle indices
        const edgeSet = new Set<string>();
        this.wireframeEdgePairs = [];
        
        // For each triangle, add its 3 edges
        for (let i = 0; i < this.indices.length; i += 3) {
            const i0 = this.indices[i];
            const i1 = this.indices[i + 1];
            const i2 = this.indices[i + 2];
            
            // Create edges (always store in sorted order to avoid duplicates)
            const edgesToAdd: [number, number][] = [
                [Math.min(i0, i1), Math.max(i0, i1)],
                [Math.min(i1, i2), Math.max(i1, i2)],
                [Math.min(i2, i0), Math.max(i2, i0)]
            ];
            
            for (const [v0, v1] of edgesToAdd) {
                const edgeKey = `${v0},${v1}`;
                if (!edgeSet.has(edgeKey)) {
                    edgeSet.add(edgeKey);
                    this.wireframeEdgePairs.push([v0, v1]);
                }
            }
        }
        
        if (this.wireframeEdgePairs.length === 0) {
            console.warn('No edges found for wireframe rendering');
            return;
        }
        
        // Create initial wireframe buffers
        this.updateWireframeBuffers();
    }
    
    private updateWireframeBuffers(): void {
        if (this.wireframeEdgePairs.length === 0) return;
        
        // Create quad geometry for each edge (thin rectangles)
        const wireframeThickness = 0.03; // Thickness of wireframe lines in world space (increased from 0.01)
        const wireframePositions: number[] = [];
        const wireframeNormals: number[] = [];
        const wireframeIndices: number[] = [];
        
        for (const [v0Idx, v1Idx] of this.wireframeEdgePairs) {
            const v0 = this.positions[v0Idx];
            const v1 = this.positions[v1Idx];
            
            // Calculate edge direction
            const edgeDir = vec3.create();
            vec3.sub(edgeDir, v1, v0);
            const edgeLen = vec3.length(edgeDir);
            if (edgeLen < EPSILON) continue;
            vec3.normalize(edgeDir, edgeDir);
            
            // Calculate perpendicular vector for expansion
            // Use a default up vector and cross product to get perpendicular
            const up = vec3.fromValues(0, 1, 0);
            let perp = vec3.create();
            vec3.cross(perp, edgeDir, up);
            const perpLen = vec3.length(perp);
            
            // If edge is parallel to up vector, use a different reference
            if (perpLen < EPSILON) {
                const right = vec3.fromValues(1, 0, 0);
                vec3.cross(perp, edgeDir, right);
                vec3.normalize(perp, perp);
            } else {
                vec3.normalize(perp, perp);
            }
            
            // Scale perpendicular by half thickness
            vec3.scale(perp, perp, wireframeThickness * 0.5);
            
            // Create 4 vertices for the quad
            const baseIdx = wireframePositions.length / 3;
            
            // Vertex 0: v0 - perp
            const v0a = vec3.create();
            vec3.sub(v0a, v0, perp);
            wireframePositions.push(v0a[0], v0a[1], v0a[2]);
            
            // Vertex 1: v0 + perp
            const v0b = vec3.create();
            vec3.add(v0b, v0, perp);
            wireframePositions.push(v0b[0], v0b[1], v0b[2]);
            
            // Vertex 2: v1 - perp
            const v1a = vec3.create();
            vec3.sub(v1a, v1, perp);
            wireframePositions.push(v1a[0], v1a[1], v1a[2]);
            
            // Vertex 3: v1 + perp
            const v1b = vec3.create();
            vec3.add(v1b, v1, perp);
            wireframePositions.push(v1b[0], v1b[1], v1b[2]);
            
            // All normals point in edge direction (for flat shading)
            const normal = vec3.clone(edgeDir);
            for (let i = 0; i < 4; i++) {
                wireframeNormals.push(normal[0], normal[1], normal[2]);
            }
            
            // Create two triangles for the quad
            // Triangle 1: 0, 1, 2
            wireframeIndices.push(baseIdx, baseIdx + 1, baseIdx + 2);
            // Triangle 2: 1, 3, 2
            wireframeIndices.push(baseIdx + 1, baseIdx + 3, baseIdx + 2);
        }
        
        if (wireframePositions.length === 0) {
            console.warn('No wireframe quads generated');
            return;
        }
        
        try {
            // Create or update position buffer
            const positions = new Float32Array(wireframePositions);
            const positionsSize = positions.byteLength;
            
            if (!this.wireframePositionBuffer || this.wireframePositionBuffer.size !== positionsSize) {
                // Destroy old buffer if size changed
                if (this.wireframePositionBuffer) {
                    this.wireframePositionBuffer.destroy();
                }
                this.wireframePositionBuffer = this.device.createBuffer({
                    size: positionsSize,
                    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
                });
            }
            this.device.queue.writeBuffer(this.wireframePositionBuffer, 0, positions);
            
            // Create or update normal buffer
            const normals = new Float32Array(wireframeNormals);
            const normalsSize = normals.byteLength;
            
            if (!this.wireframeNormalBuffer || this.wireframeNormalBuffer.size !== normalsSize) {
                // Destroy old buffer if size changed
                if (this.wireframeNormalBuffer) {
                    this.wireframeNormalBuffer.destroy();
                }
                this.wireframeNormalBuffer = this.device.createBuffer({
                    size: normalsSize,
                    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
                });
            }
            this.device.queue.writeBuffer(this.wireframeNormalBuffer, 0, normals);
            
            // Create or recreate index buffer if size changed
            const numVertices = wireframePositions.length / 3;
            const maxIndex = numVertices - 1;
            const indexArray = maxIndex <= 65535 
                ? new Uint16Array(wireframeIndices)
                : new Uint32Array(wireframeIndices);
            const indicesSize = indexArray.byteLength;
            const indexFormat = maxIndex <= 65535 ? 'uint16' : 'uint32';
            
            if (!this.wireframeIndexBuffer || 
                this.wireframeIndexBuffer.size !== indicesSize || 
                this.wireframeIndexFormat !== indexFormat) {
                // Destroy old buffer if size or format changed
                if (this.wireframeIndexBuffer) {
                    this.wireframeIndexBuffer.destroy();
                }
                this.wireframeIndexFormat = indexFormat;
                this.wireframeIndexBuffer = this.device.createBuffer({
                    size: indicesSize,
                    usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
                });
                this.device.queue.writeBuffer(this.wireframeIndexBuffer, 0, indexArray.buffer);
                this.wireframeIndexCount = wireframeIndices.length;
            }
        } catch (error) {
            console.error('Failed to create/update wireframe quad buffers:', error);
            this.wireframePositionBuffer = null;
            this.wireframeNormalBuffer = null;
            this.wireframeIndexBuffer = null;
            this.wireframeIndexCount = 0;
        }
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
            
            // Ensure initial position and normal data is written
            this.updateBuffers();
        } catch (error) {
            console.error('Failed to create buffers:', error);
            throw new Error(`Failed to create simple cloth buffers. Triangle count might be too high (${this.numTriangles}). Try a lower value.`);
        }
    }

    update(): void {
        const currT = performance.now();
        this.fpsCount++;
        
        // If not dropped yet, don't update physics
        if (!this.isDropped) {
            if (this.prevT === 0) {
                this.prevT = currT;
            }
            return;
        }
        
        // Handle first frame - if prevT is 0, skip physics update
        if (this.prevT === 0) {
            this.prevT = currT;
            return;
        }
        
        this.interval += currT - this.prevT;

        if (this.interval >= 1000) {
            this.fps = this.fpsCount;
            this.interval = 0;
            this.fpsCount = 0;
        }

        let deltaT = (currT - this.prevT) / 1000.0;
        // Clamp deltaT to prevent huge jumps (e.g., if tab was inactive)
        deltaT = Math.min(deltaT, 0.03); // Max 30ms to reduce large steps
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

        // Post-integration collision projection (helps for bent faces)
        for (let iter = 0; iter < 2; iter++) {
            for (const p of this.particles) {
                p.enforceSphereContact();
            }
        }
        
        // Project triangle centroids to ensure face centers stay outside sphere
        if (this.isSphericalGround) {
            this.enforceTriangleCentroidProjection();
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
        
        // Update wireframe quads with current positions (only if buffers exist)
        if (this.wireframeEdgePairs.length > 0 && this.wireframePositionBuffer && this.wireframeNormalBuffer) {
            this.updateWireframeBuffers();
        }
    }

    setNumTriangles(numTriangles: number): void {
        if (this.numTriangles === numTriangles) return;
        
        this.numTriangles = numTriangles;
        
        // Clean up old buffers
        this.destroy();
        
        // Clear wireframe edge pairs
        this.wireframeEdgePairs = [];
        
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

    getGround(): Ground | SphericalGround {
        return this.ground;
    }

    // Reset timing to prevent huge deltaT when scene is switched to
    resetTiming(): void {
        this.prevT = 0;
        this.fpsCount = 0;
        this.interval = 0;
        
        // Also reset all particle velocities and forces for a calm start
        for (const particle of this.particles) {
            const vel = particle.getVelocity();
            vec3.zero(vel);
            particle.resetForce();
        }
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

    getWireframeBuffers(): { 
        positionBuffer: GPUBuffer; 
        normalBuffer: GPUBuffer; 
        indexBuffer: GPUBuffer; 
        indexFormat: GPUIndexFormat; 
        indexCount: number 
    } | null {
        if (!this.wireframePositionBuffer || !this.wireframeNormalBuffer || !this.wireframeIndexBuffer) {
            return null;
        }
        return {
            positionBuffer: this.wireframePositionBuffer,
            normalBuffer: this.wireframeNormalBuffer,
            indexBuffer: this.wireframeIndexBuffer,
            indexFormat: this.wireframeIndexFormat,
            indexCount: this.wireframeIndexCount
        };
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
        // Update all existing springs
        for (const spring of this.connections) {
            spring.setSpringConst(this.springConst);
        }
    }

    getSpringConst(): number {
        return this.springConst;
    }

    setDampingConst(c: number): void {
        this.dampingConst = Math.abs(c);
        // Update all existing springs
        for (const spring of this.connections) {
            spring.setDampingConst(this.dampingConst);
        }
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
        if (this.wireframePositionBuffer) {
            this.wireframePositionBuffer.destroy();
            this.wireframePositionBuffer = null;
        }
        if (this.wireframeNormalBuffer) {
            this.wireframeNormalBuffer.destroy();
            this.wireframeNormalBuffer = null;
        }
        if (this.wireframeIndexBuffer) {
            this.wireframeIndexBuffer.destroy();
            this.wireframeIndexBuffer = null;
        }
    }
}

