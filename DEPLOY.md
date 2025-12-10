# Netlify Deployment Guide

This project is configured for deployment on Netlify.

## Build Configuration

The project uses Vite for building. The build process:
1. Compiles TypeScript (`tsc`)
2. Bundles the application with Vite (`vite build`)
3. Outputs to the `dist` folder

## Netlify Setup

1. **Connect your repository** to Netlify
2. **Build settings** (should be auto-detected):
   - Build command: `npm run build`
   - Publish directory: `dist`
3. **Environment variables**: None required

## Important Notes

- **WebGPU requires HTTPS**: Netlify automatically provides HTTPS, which is required for WebGPU
- **Browser compatibility**: WebGPU is supported in:
  - Chrome 113+
  - Edge 113+
  - Safari 18+
- The shaders are bundled into the JavaScript, so no separate shader files are needed

## Troubleshooting

If you only see the UI but no rendering:
1. Check the browser console for WebGPU errors
2. Ensure you're using a supported browser
3. Verify the build completed successfully
4. Check that HTTPS is enabled (Netlify does this automatically)

## Local Testing

To test the production build locally:
```bash
npm run build
npm run preview
```

