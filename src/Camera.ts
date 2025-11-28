import { mat4, vec3 } from 'gl-matrix';
import { perspective, eulerAngleX, eulerAngleY, translate, multiply, inverse } from './utils/math';

export class Camera {
    private fov: number = 45.0;
    private aspect: number = 1.33;
    private nearClip: number = 0.1;
    private farClip: number = 100.0;

    private distance: number = 10.0;
    private azimuth: number = 0.0;
    private incline: number = 20.0;

    private viewProjectMtx: mat4 = mat4.create();

    constructor() {
        this.reset();
    }

    update(): void {
        // Compute camera world matrix
        // Start with translation along Z axis
        const world = mat4.create();
        mat4.translate(world, world, [0, 0, this.distance]);
        
        // Apply rotations (Y first, then X)
        const rotY = eulerAngleY(-this.azimuth * Math.PI / 180);
        const rotX = eulerAngleX(-this.incline * Math.PI / 180);
        const rotYX = multiply(rotY, rotX);
        const worldFinal = multiply(rotYX, world);

        // Compute view matrix (inverse of world matrix)
        const view = inverse(worldFinal);

        // Compute perspective projection matrix
        const project = perspective(this.fov, this.aspect, this.nearClip, this.farClip);

        // Compute final view-projection matrix
        this.viewProjectMtx = multiply(project, view);
    }

    reset(): void {
        this.fov = 45.0;
        this.aspect = 1.33;
        this.nearClip = 0.1;
        this.farClip = 100.0;
        this.distance = 10.0;
        this.azimuth = 0.0;
        this.incline = 20.0;
    }

    setAspect(aspect: number): void {
        this.aspect = aspect;
    }

    setDistance(distance: number): void {
        this.distance = distance;
    }

    setAzimuth(azimuth: number): void {
        this.azimuth = azimuth;
    }

    setIncline(incline: number): void {
        this.incline = incline;
    }

    getDistance(): number {
        return this.distance;
    }

    getAzimuth(): number {
        return this.azimuth;
    }

    getIncline(): number {
        return this.incline;
    }

    getViewProjectMtx(): mat4 {
        return this.viewProjectMtx;
    }
}

