import { vec3 } from 'gl-matrix';

const EPSILON = 1e-6;
const BASE_COLLISION_MARGIN = 0.05; // Base margin for plane collision

export class Particle {
    public position: vec3;
    public normal: vec3;
    private velocity: vec3;
    private force: vec3;
    private prevForce: vec3;
    private isFixed: boolean = false;

    private mass: number;
    private gravityAcce: number;
    private groundPos: number;
    private sphereCenter: vec3 | null = null;
    private sphereRadius: number | null = null;
    private edgeLength: number = 0; // Distance to adjacent particles (for adaptive margin)

    constructor(
        position: vec3,
        normal: vec3,
        mass: number,
        gravityAcce: number,
        groundPos: number,
        sphereCenter?: vec3,
        sphereRadius?: number
    ) {
        this.position = position;
        this.normal = normal;
        this.mass = mass;
        this.gravityAcce = gravityAcce;
        this.groundPos = groundPos;
        this.velocity = vec3.create();
        this.force = vec3.create();
        this.prevForce = vec3.create();
        
        if (sphereCenter && sphereRadius !== undefined) {
            this.sphereCenter = sphereCenter;
            this.sphereRadius = sphereRadius;
        }
    }

    applyForce(f: vec3): void {
        vec3.add(this.force, this.force, f);
    }

    applyGravity(): void {
        this.force[1] -= this.mass * this.gravityAcce;
    }

    integrate(deltaTime: number): void {
        if (this.isFixed) return;

        this.applyGravity();

        const a = vec3.create();
        vec3.scale(a, this.force, 1.0 / this.mass);
        
        const accelLength = vec3.length(a);
        if (accelLength > EPSILON) {
            const deltaV = vec3.create();
            vec3.scale(deltaV, a, deltaTime);
            vec3.add(this.velocity, this.velocity, deltaV);
            
            if (vec3.length(this.velocity) < EPSILON) {
                vec3.zero(this.velocity);
            }
            
            const deltaP = vec3.create();
            vec3.scale(deltaP, this.velocity, deltaTime);
            
            // Continuous collision detection: check if movement would cause penetration
            const newPos = vec3.create();
            vec3.add(newPos, this.position, deltaP);
            
            // Check collision before moving to prevent penetration
            if (this.sphereCenter && this.sphereRadius !== null) {
                const margin = this.getSphereCollisionMargin();
                const toNewPos = vec3.create();
                vec3.sub(toNewPos, newPos, this.sphereCenter);
                const newDistance = vec3.length(toNewPos);
                
                if (newDistance < this.sphereRadius + margin) {
                    // Clamp movement to prevent penetration
                    vec3.normalize(toNewPos, toNewPos);
                    vec3.scaleAndAdd(newPos, this.sphereCenter, toNewPos, this.sphereRadius + margin);
                    
                    // Update deltaP to the clamped movement
                    vec3.sub(deltaP, newPos, this.position);
                    
                    // Strongly dampen velocity toward sphere
                    const normal = vec3.clone(toNewPos);
                    const velDotNormal = vec3.dot(this.velocity, normal);
                    if (velDotNormal < 0) {
                        // Remove all velocity toward sphere and add a small push away
                        const correction = vec3.create();
                        vec3.scale(correction, normal, velDotNormal);
                        vec3.sub(this.velocity, this.velocity, correction);
                        // Add small push-away velocity to prevent sticking
                        vec3.scaleAndAdd(this.velocity, this.velocity, normal, 0.1);
                    }
                }
            }
            
            vec3.add(this.position, this.position, deltaP);
            
            vec3.copy(this.prevForce, this.force);
        }
        
        // Final collision check and correction (safety net)
        this.groundCollision();
        vec3.zero(this.force);
    }

    resetForce(): void {
        vec3.zero(this.force);
    }

    getVelocity(): vec3 {
        return this.velocity;
    }

    getPosition(): vec3 {
        return this.position;
    }

    // Strong projection to keep particle outside sphere after integration
    enforceSphereContact(): void {
        if (this.sphereCenter && this.sphereRadius !== null) {
            const margin = this.getSphereCollisionMargin();
            const toParticle = vec3.create();
            vec3.sub(toParticle, this.position, this.sphereCenter);
            let distance = vec3.length(toParticle);
            const targetDist = this.sphereRadius + margin;
            if (distance < targetDist) {
                if (distance < EPSILON) {
                    vec3.set(toParticle, 0, 1, 0);
                    distance = 1.0;
                } else {
                    vec3.scale(toParticle, toParticle, 1.0 / distance);
                }
                vec3.scaleAndAdd(this.position, this.sphereCenter, toParticle, targetDist);

                // Remove any velocity component toward sphere center
                const velDotNormal = vec3.dot(this.velocity, toParticle);
                if (velDotNormal < 0) {
                    const correction = vec3.create();
                    vec3.scale(correction, toParticle, velDotNormal);
                    vec3.sub(this.velocity, this.velocity, correction);
                }
            }
        }
    }

    resetNormal(): void {
        vec3.zero(this.normal);
    }

    addNormal(n: vec3): void {
        vec3.add(this.normal, this.normal, n);
    }

    groundCollision(): void {
        if (this.sphereCenter && this.sphereRadius !== null) {
            // Sphere collision - safety net for any particles that still penetrate
            const margin = this.getSphereCollisionMargin();
            const toParticle = vec3.create();
            vec3.sub(toParticle, this.position, this.sphereCenter);
            const distance = vec3.length(toParticle);
            
            if (distance < this.sphereRadius + margin) {
                // Push particle to sphere surface with margin
                if (distance < EPSILON) {
                    // Handle case where particle is at sphere center (shouldn't happen, but safety)
                    vec3.set(toParticle, 0, 1, 0);
                } else {
                    vec3.normalize(toParticle, toParticle);
                }
                vec3.scaleAndAdd(this.position, this.sphereCenter, toParticle, this.sphereRadius + margin);
                
                // Strongly remove velocity component toward sphere center
                const normal = vec3.clone(toParticle);
                const velDotNormal = vec3.dot(this.velocity, normal);
                if (velDotNormal < 0) {
                    // Remove all velocity toward sphere
                    const correction = vec3.create();
                    vec3.scale(correction, normal, velDotNormal);
                    vec3.sub(this.velocity, this.velocity, correction);
                    // Add push-away velocity to prevent sticking
                    vec3.scaleAndAdd(this.velocity, this.velocity, normal, 0.05);
                }
            }
        } else {
            // Plane collision (original behavior)
            if (this.position[1] < this.groundPos + BASE_COLLISION_MARGIN) {
                this.position[1] = this.groundPos + BASE_COLLISION_MARGIN;
                // Dampen downward velocity
                if (this.velocity[1] < 0) {
                    this.velocity[1] = 0.0;
                }
            }
        }
    }
    
    setSphereCollision(center: vec3, radius: number): void {
        this.sphereCenter = center;
        this.sphereRadius = radius;
    }
    
    clearSphereCollision(): void {
        this.sphereCenter = null;
        this.sphereRadius = null;
    }
    
    setEdgeLength(length: number): void {
        this.edgeLength = length;
    }
    
    // Calculate adaptive collision margin based on edge length
    // This ensures that when two adjacent vertices are on the collision surface,
    // the midpoint of the edge between them is also outside the sphere
    private getSphereCollisionMargin(): number {
        if (this.sphereRadius === null || this.edgeLength <= 0) {
            return BASE_COLLISION_MARGIN;
        }
        
        const r = this.sphereRadius;
        const d = this.edgeLength;
        
        // For a chord of length d with vertices at radius R from center,
        // the midpoint is at distance sqrt(R² - (d/2)²) from center.
        // To keep midpoint at least at radius r, we need:
        // margin = sqrt(r² + (d/2)²) - r
        const halfEdge = d / 2;
        const margin = Math.sqrt(r * r + halfEdge * halfEdge) - r;
        
        // Add a small base margin and ensure minimum
        return Math.max(margin + 0.01, BASE_COLLISION_MARGIN);
    }

    setFixed(fixed: boolean): void {
        this.isFixed = fixed;
    }

    isFixedParticle(): boolean {
        return this.isFixed;
    }

    setMass(mass: number): void {
        this.mass = mass;
    }

    setGravityAcce(gravity: number): void {
        this.gravityAcce = gravity;
    }

    setGroundPos(groundPos: number): void {
        this.groundPos = groundPos;
    }
}

