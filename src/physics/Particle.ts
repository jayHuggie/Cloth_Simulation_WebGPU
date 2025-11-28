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

    constructor(
        position: vec3,
        normal: vec3,
        mass: number,
        gravityAcce: number,
        groundPos: number
    ) {
        this.position = position;
        this.normal = normal;
        this.mass = mass;
        this.gravityAcce = gravityAcce;
        this.groundPos = groundPos;
        this.velocity = vec3.create();
        this.force = vec3.create();
        this.prevForce = vec3.create();
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
        if (this.position[1] < this.groundPos + EPSILON) {
            this.position[1] = this.groundPos + EPSILON;
            this.velocity[1] = 0.0;
        }
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

