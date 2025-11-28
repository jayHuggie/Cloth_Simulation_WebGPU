import { vec3 } from 'gl-matrix';
import { Particle } from './Particle';

const EPSILON = 1e-6;

export class Triangle {
    private p1: Particle;
    private p2: Particle;
    private p3: Particle;
    private fluidDensity: number;
    private c_d: number;
    private windVelocity: vec3;

    constructor(
        p1: Particle,
        p2: Particle,
        p3: Particle,
        fluidDensity: number,
        c_d: number,
        windVelocity: vec3
    ) {
        this.p1 = p1;
        this.p2 = p2;
        this.p3 = p3;
        this.fluidDensity = fluidDensity;
        this.c_d = c_d;
        this.windVelocity = windVelocity;
    }

    setFluidDensity(rho: number): void {
        this.fluidDensity = rho;
    }

    setDragConst(c: number): void {
        this.c_d = c;
    }

    setWindVelocity(v: vec3): void {
        vec3.copy(this.windVelocity, v);
    }

    computeAerodynamicForce(): void {
        // Average velocity of triangle surface
        const v1 = this.p1.getVelocity();
        const v2 = this.p2.getVelocity();
        const v3 = this.p3.getVelocity();
        
        const surfaceVelocity = vec3.create();
        vec3.add(surfaceVelocity, v1, v2);
        vec3.add(surfaceVelocity, surfaceVelocity, v3);
        vec3.scale(surfaceVelocity, surfaceVelocity, 1.0 / 3.0);

        // Relative velocity
        const v_dir = vec3.create();
        vec3.sub(v_dir, surfaceVelocity, this.windVelocity);
        const v_scale = vec3.length(v_dir);
        
        if (v_scale < EPSILON) return;
        
        vec3.normalize(v_dir, v_dir);

        // Calculate normal and area
        const edge1 = vec3.create();
        const edge2 = vec3.create();
        vec3.sub(edge1, this.p2.getPosition(), this.p1.getPosition());
        vec3.sub(edge2, this.p3.getPosition(), this.p1.getPosition());
        
        const n = vec3.create();
        vec3.cross(n, edge1, edge2);
        const area = vec3.length(n);
        vec3.normalize(n, n);
        const actualArea = area / 2.0;

        // Effective area exposed to wind
        const crossArea = actualArea * vec3.dot(v_dir, n);

        // Aerodynamic force: F = -0.5 * rho * v^2 * C_d * A * n
        const force = vec3.create();
        vec3.scale(force, n, -0.5 * this.fluidDensity * v_scale * v_scale * this.c_d * crossArea);
        
        // Distribute force equally
        vec3.scale(force, force, 1.0 / 3.0);
        this.p1.applyForce(force);
        this.p2.applyForce(force);
        this.p3.applyForce(force);
    }

    computeNormal(): void {
        const edge1 = vec3.create();
        const edge2 = vec3.create();
        vec3.sub(edge1, this.p2.getPosition(), this.p1.getPosition());
        vec3.sub(edge2, this.p3.getPosition(), this.p1.getPosition());
        
        const n = vec3.create();
        vec3.cross(n, edge1, edge2);
        
        if (vec3.length(n) < EPSILON) return;
        
        vec3.normalize(n, n);
        this.p1.addNormal(n);
        this.p2.addNormal(n);
        this.p3.addNormal(n);
    }
}

