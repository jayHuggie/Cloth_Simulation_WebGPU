import { vec3 } from 'gl-matrix';

const EPSILON = 1e-6;
const COLLISION_MARGIN = 0.02; // Visual margin to keep cloth above surface

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
                const toNewPos = vec3.create();
                vec3.sub(toNewPos, newPos, this.sphereCenter);
                const newDistance = vec3.length(toNewPos);
                
                if (newDistance < this.sphereRadius + COLLISION_MARGIN) {
                    // Clamp movement to prevent penetration
                    vec3.normalize(toNewPos, toNewPos);
                    vec3.scaleAndAdd(newPos, this.sphereCenter, toNewPos, this.sphereRadius + COLLISION_MARGIN);
                    
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

    resetNormal(): void {
        vec3.zero(this.normal);
    }

    addNormal(n: vec3): void {
        vec3.add(this.normal, this.normal, n);
    }

    groundCollision(): void {
        if (this.sphereCenter && this.sphereRadius !== null) {
            // Sphere collision - safety net for any particles that still penetrate
            const toParticle = vec3.create();
            vec3.sub(toParticle, this.position, this.sphereCenter);
            const distance = vec3.length(toParticle);
            
            if (distance < this.sphereRadius + COLLISION_MARGIN) {
                // Push particle to sphere surface with margin
                if (distance < EPSILON) {
                    // Handle case where particle is at sphere center (shouldn't happen, but safety)
                    vec3.set(toParticle, 0, 1, 0);
                } else {
                    vec3.normalize(toParticle, toParticle);
                }
                vec3.scaleAndAdd(this.position, this.sphereCenter, toParticle, this.sphereRadius + COLLISION_MARGIN);
                
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
            if (this.position[1] < this.groundPos + COLLISION_MARGIN) {
                this.position[1] = this.groundPos + COLLISION_MARGIN;
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

