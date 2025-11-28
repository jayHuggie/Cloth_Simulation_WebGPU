// Fragment shader for cloth rendering

struct LightingUniforms {
    ambientColor: vec3<f32>,
    lightDirection: vec3<f32>,
    lightColor: vec3<f32>,
    lightDirection2: vec3<f32>,
    lightColor2: vec3<f32>,
    diffuseColor: vec3<f32>,
}

@group(0) @binding(1) var<uniform> lighting: LightingUniforms;

struct FragmentInput {
    @location(0) fragNormal: vec3<f32>,
}

@fragment
fn main(input: FragmentInput) -> @location(0) vec4<f32> {
    // Normalize the normal
    let normal = normalize(input.fragNormal);
    
    // Compute irradiance (sum of ambient & direct lighting)
    let irradiance = lighting.ambientColor + 
                     lighting.lightColor * max(0.0, dot(lighting.lightDirection, normal)) +
                     lighting.lightColor2 * max(0.0, dot(lighting.lightDirection2, normal));
    
    // Diffuse reflectance
    let reflectance = irradiance * lighting.diffuseColor;
    
    // Gamma correction
    return vec4<f32>(sqrt(reflectance), 1.0);
}
