import { vec3 } from 'gl-matrix';

const EPSILON = 1e-6;

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
            vec3.add(this.position, this.position, deltaP);
            
            vec3.copy(this.prevForce, this.force);
        }
        
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
            // Sphere collision
            const toParticle = vec3.create();
            vec3.sub(toParticle, this.position, this.sphereCenter);
            const distance = vec3.length(toParticle);
            
            if (distance < this.sphereRadius + EPSILON) {
                // Push particle to sphere surface
                vec3.normalize(toParticle, toParticle);
                vec3.scaleAndAdd(this.position, this.sphereCenter, toParticle, this.sphereRadius + EPSILON);
                
                // Remove velocity component toward sphere center
                const normal = vec3.clone(toParticle);
                const velDotNormal = vec3.dot(this.velocity, normal);
                if (velDotNormal < 0) {
                    const correction = vec3.create();
                    vec3.scale(correction, normal, velDotNormal);
                    vec3.sub(this.velocity, this.velocity, correction);
                }
            }
        } else {
            // Plane collision (original behavior)
            if (this.position[1] < this.groundPos + EPSILON) {
                this.position[1] = this.groundPos + EPSILON;
                this.velocity[1] = 0.0;
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

